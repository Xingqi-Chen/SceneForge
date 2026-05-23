import { fetchNaiBotArtistsGalleryItems } from "./adapters/nai-bot-artists-gallery";
import {
  cacheArtistStringImageUrl,
  cleanupUnreferencedArtistStringCachedImages,
} from "./image-assets";
import { getArtistStringPlatformDefinition } from "./platforms";
import type {
  ArtistStringAdapterItem,
  ArtistStringPlatformId,
  ArtistStringReferenceImageInput,
  ArtistStringSyncResult,
} from "./types";
import type { SceneForgeSqliteDatabase } from "@/features/persistence/sqlite-storage";
import {
  listReferencedArtistStringLocalImageUrlsFromSqlite,
  upsertArtistStringSyncToSqlite,
} from "@/features/persistence/sqlite-storage";

const IMAGE_CACHE_CONCURRENCY = 6;

type SyncFetchLike = typeof fetch;

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index]!, index);
      }
    }),
  );

  return results;
}

function getAdapter(platformId: ArtistStringPlatformId) {
  if (platformId === "nai_bot_artists_gallery") {
    return fetchNaiBotArtistsGalleryItems;
  }

  throw new Error(`Unsupported artist string platform: ${platformId}.`);
}

async function cacheItemReferenceImages(
  item: ArtistStringAdapterItem,
): Promise<Array<ArtistStringReferenceImageInput & {
  localUrl: string | null;
  width: number | null;
  height: number | null;
}>> {
  return mapWithConcurrency(item.referenceImages, IMAGE_CACHE_CONCURRENCY, async (referenceImage) => {
    const cached = await cacheArtistStringImageUrl(referenceImage.sourceUrl, {
      cacheKey: `${item.platformId}:${item.sourceSequence}:${referenceImage.sortOrder}`,
      referer: item.sourceUrl,
    });
    return {
      ...referenceImage,
      localUrl: cached?.localUrl ?? null,
      width: cached?.width ?? null,
      height: cached?.height ?? null,
    };
  });
}

export async function syncArtistStringPlatformToSqlite(options: {
  db: SceneForgeSqliteDatabase;
  platformId?: ArtistStringPlatformId;
  fetchImpl?: SyncFetchLike;
}): Promise<ArtistStringSyncResult> {
  const platformId = options.platformId ?? "nai_bot_artists_gallery";
  const platformDefinition = getArtistStringPlatformDefinition(platformId);
  if (!platformDefinition) {
    throw new Error(`Unsupported artist string platform: ${platformId}.`);
  }

  const adapter = getAdapter(platformId);
  const parsed = await adapter(options.fetchImpl);
  let imageCount = 0;
  let cachedImageCount = 0;
  let failedImageCount = 0;

  const items = await mapWithConcurrency(parsed.items, 3, async (item) => {
    imageCount += item.referenceImages.length;
    const referenceImages = await cacheItemReferenceImages(item);
    cachedImageCount += referenceImages.filter((image) => Boolean(image.localUrl)).length;
    failedImageCount += referenceImages.filter((image) => !image.localUrl).length;
    return {
      ...item,
      referenceImages,
    };
  });

  const platform = upsertArtistStringSyncToSqlite(options.db, {
    platform: parsed.platform,
    items,
  });

  await cleanupUnreferencedArtistStringCachedImages(
    new Set(listReferencedArtistStringLocalImageUrlsFromSqlite(options.db)),
  );

  return {
    platform,
    itemCount: items.length,
    imageCount,
    cachedImageCount,
    failedImageCount,
    parsedCount: items.filter((item) => item.parseStatus === "parsed").length,
    partialCount: items.filter((item) => item.parseStatus === "partial").length,
    failedParseCount: items.filter((item) => item.parseStatus === "failed").length,
  };
}
