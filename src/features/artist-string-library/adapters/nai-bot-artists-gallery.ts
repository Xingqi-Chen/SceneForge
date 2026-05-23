import {
  formatArtistStringForPlatform,
  normalizeFormattedArtistString,
  parseNovelAiArtistString,
} from "../novelai-artist-string";
import {
  getNaiBotArtistsGalleryCategory,
  NAI_BOT_ARTISTS_GALLERY_PLATFORM,
} from "../platforms";
import type {
  ArtistStringAdapterItem,
  ArtistStringParseStatus,
  ArtistStringPlatformRecord,
  ArtistStringReferenceImageInput,
} from "../types";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type NaiBotArtistsGalleryParseResult = {
  platform: Omit<ArtistStringPlatformRecord, "syncedAt" | "rawMetaJson"> & {
    rawMetaJson: unknown;
  };
  items: ArtistStringAdapterItem[];
};

function decodeHtmlEntities(value: string) {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    const lower = entity.toLocaleLowerCase();
    if (lower === "amp") {
      return "&";
    }
    if (lower === "lt") {
      return "<";
    }
    if (lower === "gt") {
      return ">";
    }
    if (lower === "quot") {
      return "\"";
    }
    if (lower === "apos") {
      return "'";
    }
    if (lower.startsWith("#x")) {
      const codePoint = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    if (lower.startsWith("#")) {
      const codePoint = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    return match;
  });
}

function stripTags(value: string) {
  return decodeHtmlEntities(value.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function getAttribute(tag: string, name: string) {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = pattern.exec(tag);
  return decodeHtmlEntities(match?.[1] ?? match?.[2] ?? match?.[3] ?? "");
}

function getSourceUpdatedAtText(html: string) {
  const match = /更新时间:\s*([^<]+)/i.exec(html);
  return match?.[1] ? stripTags(match[1]) : null;
}

function getImageRole(alt: string, index: number) {
  const role = alt.split(" - ").slice(1).join(" - ").trim();
  return role || `reference ${index + 1}`;
}

function parseReferenceImages(rowHtml: string, sourceUrl: string): ArtistStringReferenceImageInput[] {
  const imageTags = rowHtml.match(/<img\b[^>]*>/gi) ?? [];
  return imageTags
    .map((tag, index) => {
      const src = getAttribute(tag, "src");
      if (!src) {
        return null;
      }
      const alt = getAttribute(tag, "alt");
      return {
        role: getImageRole(alt, index),
        sourceUrl: new URL(src, sourceUrl).toString(),
        alt: alt || null,
        sortOrder: index,
      };
    })
    .filter((image): image is ArtistStringReferenceImageInput => Boolean(image));
}

function parseStatusFromFormattedPrompt(
  formattedPrompt: string,
  warnings: string[],
): { status: ArtistStringParseStatus; error: string | null } {
  if (!formattedPrompt) {
    return { status: "failed", error: "No parseable prompt tokens were found." };
  }
  if (warnings.length > 0) {
    return { status: "partial", error: warnings.join(" ") };
  }
  return { status: "parsed", error: null };
}

export function parseNaiBotArtistsGalleryHtml(
  html: string,
  sourceUrl = NAI_BOT_ARTISTS_GALLERY_PLATFORM.sourceUrl,
): NaiBotArtistsGalleryParseResult {
  const rows = html.match(/<tr\b[^>]*class=(?:"[^"]*\bartist-row\b[^"]*"|'[^']*\bartist-row\b[^']*')[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
  const items: ArtistStringAdapterItem[] = [];

  for (const row of rows) {
    const sequenceMatch = /<td\b[^>]*class=(?:"[^"]*\bsequence\b[^"]*"|'[^']*\bsequence\b[^']*')[^>]*>\s*([0-9]+)\s*<\/td>/i.exec(row);
    const artistMatch = /<span\b[^>]*class=(?:"[^"]*\bartist-text\b[^"]*"|'[^']*\bartist-text\b[^']*')[^>]*>([\s\S]*?)<\/span>/i.exec(row);
    if (!sequenceMatch?.[1] || !artistMatch?.[1]) {
      continue;
    }

    const sourceSequence = Number.parseInt(sequenceMatch[1], 10);
    if (!Number.isFinite(sourceSequence)) {
      continue;
    }

    const rawArtistString = stripTags(artistMatch[1]);
    const structuredArtistString = parseNovelAiArtistString(rawArtistString);
    const formattedPrompt = formatArtistStringForPlatform(structuredArtistString, NAI_BOT_ARTISTS_GALLERY_PLATFORM.promptFormat);
    const parseStatus = parseStatusFromFormattedPrompt(formattedPrompt, structuredArtistString.warnings);
    const category = getNaiBotArtistsGalleryCategory(sourceSequence);

    items.push({
      platformId: NAI_BOT_ARTISTS_GALLERY_PLATFORM.id,
      sourceSequence,
      categoryKey: category.key,
      categoryName: category.name,
      rawArtistString,
      structuredArtistString,
      promptFormat: NAI_BOT_ARTISTS_GALLERY_PLATFORM.promptFormat,
      parseStatus: parseStatus.status,
      parseError: parseStatus.error,
      formattedPrompt,
      sourceUrl,
      referenceImages: parseReferenceImages(row, sourceUrl),
    });
  }

  items.sort((left, right) => left.sourceSequence - right.sourceSequence);

  return {
    platform: {
      ...NAI_BOT_ARTISTS_GALLERY_PLATFORM,
      sourceUpdatedAtText: getSourceUpdatedAtText(html),
      rawMetaJson: {
        parsedItemCount: items.length,
        normalizedPreviewHash: normalizeFormattedArtistString(items[0]?.formattedPrompt ?? ""),
      },
    },
    items,
  };
}

export async function fetchNaiBotArtistsGalleryItems(
  fetchImpl: FetchLike = fetch,
): Promise<NaiBotArtistsGalleryParseResult> {
  const response = await fetchImpl(NAI_BOT_ARTISTS_GALLERY_PLATFORM.sourceUrl, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "SceneForge/1.0 (+https://nai-bot.pages.dev)",
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch nai-bot artists gallery: HTTP ${response.status}.`);
  }

  return parseNaiBotArtistsGalleryHtml(await response.text());
}
