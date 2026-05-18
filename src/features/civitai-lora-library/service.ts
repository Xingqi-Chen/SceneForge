import type { CivitaiClient } from "./client";
import { createCivitaiClient } from "./client";
import { applyCivitaiEnrichment, enrichCivitaiResource } from "./enrichment";
import {
  cacheCivitaiImageUrl,
  cacheSelectedOfficialImages,
  cleanupLegacyOriginalCachedImages,
  cleanupUnreferencedCachedImages,
  extractCivitaiImageUrls,
  extractCivitaiImageSourceUrls,
} from "./image-assets";
import {
  findPromptLoraWeight,
  findTriggerWordsUsed,
  normalizeName,
  parseCivitaiImageIdFromUrl,
  parseLoraWeightsFromPrompt,
} from "./parsing";
import { mergeResourceVersion } from "./normalize";
import type {
  CivitaiParseIgnoredResource,
  CivitaiImportResult,
  CivitaiParsePreview,
  CivitaiResourceRecord,
  CivitaiResolveStatus,
  CivitaiResourceUpsertInput,
  NormalizedCivitaiImage,
  NormalizedCivitaiImageResource,
} from "./types";
import type { SceneForgeSqliteDatabase } from "@/features/persistence/sqlite-storage";
import {
  deleteImageResourceUsagesExceptFromSqlite,
  findCivitaiResourceByUpsertInputFromSqlite,
  listReferencedCivitaiLocalImageUrlsFromSqlite,
  upsertCivitaiResourceToSqlite,
  upsertImportedCivitaiImageToSqlite,
  upsertImageResourceUsageToSqlite,
} from "@/features/persistence/sqlite-storage";

const IMPORT_METADATA_MESSAGE =
  "已从 Civitai 图片公开元数据中识别资源；部分资源可能因隐藏元数据、权限限制或 API 返回不完整而无法解析。";

type CivitaiResourceEnricher = typeof enrichCivitaiResource;
type SelectedOfficialImageRef = { resourceKey: string; url: string };

async function resolveResourceByModelVersionId(
  client: CivitaiClient,
  resource: NormalizedCivitaiImageResource,
): Promise<Awaited<ReturnType<CivitaiClient["getModelVersion"]>> | null> {
  if (resource.modelVersionId === null) {
    return null;
  }

  try {
    return await client.getModelVersion(resource.modelVersionId);
  } catch {
    return null;
  }
}

async function resolveResourceByHash(
  client: CivitaiClient,
  resource: NormalizedCivitaiImageResource,
): Promise<Awaited<ReturnType<CivitaiClient["getModelVersionByHash"]>> | null> {
  if (!resource.hash) {
    return null;
  }

  try {
    return await client.getModelVersionByHash(resource.hash);
  } catch {
    return null;
  }
}

function getResourceWeightByModelVersionId(
  resources: NormalizedCivitaiImageResource[],
  modelVersionId: number,
) {
  return resources.find((resource) => resource.modelVersionId === modelVersionId)?.weight ?? null;
}

function getResourceRawByModelVersionId(
  resources: NormalizedCivitaiImageResource[],
  modelVersionId: number,
) {
  const matches = resources.filter((resource) => resource.modelVersionId === modelVersionId);
  if (matches.length === 0) {
    return { source: "model_version_ids", modelVersionId };
  }

  return { source: "model_version_id", modelVersionId, resources: matches.map((resource) => resource.raw) };
}

function getResourceNameByModelVersionId(
  resources: NormalizedCivitaiImageResource[],
  modelVersionId: number,
) {
  return resources.find((resource) => resource.modelVersionId === modelVersionId && resource.name)?.name ?? null;
}

function getModelVersionCandidates(image: NormalizedCivitaiImage): NormalizedCivitaiImageResource[] {
  const candidates: NormalizedCivitaiImageResource[] = [];
  const ids = new Set<number>();
  const hashOnlyKeys = new Set<string>();

  for (const id of image.modelVersionIds) {
    ids.add(id);
  }
  for (const resource of image.resources) {
    if (resource.modelVersionId !== null) {
      ids.add(resource.modelVersionId);
    }
  }

  for (const modelVersionId of ids) {
    candidates.push({
      type: "other" as const,
      name: getResourceNameByModelVersionId(image.resources, modelVersionId),
      hash: null,
      modelVersionId,
      modelId: null,
      weight: getResourceWeightByModelVersionId(image.resources, modelVersionId),
      raw: getResourceRawByModelVersionId(image.resources, modelVersionId),
    });
  }

  for (const resource of image.resources) {
    if (resource.modelVersionId !== null || !resource.hash) {
      continue;
    }

    const key = `${resource.type}:${normalizeName(resource.hash)}:${normalizeName(resource.name ?? "")}`;
    if (hashOnlyKeys.has(key)) {
      continue;
    }

    hashOnlyKeys.add(key);
    candidates.push(resource);
  }

  return candidates;
}

function makeUnresolvedIgnoredResource(resource: NormalizedCivitaiImageResource): CivitaiParseIgnoredResource {
  return {
    resourceType: "other",
    name: resource.name ?? `Model version ${resource.modelVersionId ?? "unknown"}`,
    modelVersionId: resource.modelVersionId,
    versionName: null,
    weight: resource.weight,
    resolveStatus: "unresolved",
    reason: "Model version id could not be resolved by Civitai.",
  };
}

function makeFilteredIgnoredResource(
  upsertInput: CivitaiResourceUpsertInput,
  resource: NormalizedCivitaiImageResource,
): CivitaiParseIgnoredResource {
  return {
    resourceType: upsertInput.resourceType,
    name: upsertInput.name,
    modelVersionId: upsertInput.civitaiModelVersionId,
    versionName: upsertInput.versionName,
    weight: resource.weight,
    resolveStatus: "resolved_by_model_version_id",
    reason:
      upsertInput.resourceType === "embedding"
        ? "Textual Inversion / embedding is not stored in the LoRA library."
        : upsertInput.resourceType === "vae"
          ? "VAE is not stored in the LoRA library."
          : "Resource type is not LoRA or checkpoint/model.",
  };
}

function getResourceSource() {
  return "civitai_image_meta" as const;
}

function getResolveStatus(resource: NormalizedCivitaiImageResource): CivitaiResolveStatus {
  if (resource.modelVersionId !== null) {
    return "resolved_by_model_version_id";
  }
  return resource.hash ? "metadata_only" : "unresolved";
}

function getPromptWeightForResource(
  promptWeights: ReturnType<typeof parseLoraWeightsFromPrompt>,
  imageResource: NormalizedCivitaiImageResource,
  upsertInput: CivitaiResourceUpsertInput,
) {
  return (
    findPromptLoraWeight(promptWeights, imageResource.name) ??
    findPromptLoraWeight(promptWeights, upsertInput.name) ??
    findPromptLoraWeight(promptWeights, upsertInput.versionName)
  );
}

async function resolveResource(
  client: CivitaiClient,
  resource: NormalizedCivitaiImageResource,
) {
  const version = await resolveResourceByModelVersionId(client, resource);
  if (version) {
    return {
      version,
      status: "resolved_by_model_version_id",
    } as const;
  }

  const versionByHash = await resolveResourceByHash(client, resource);
  if (versionByHash) {
    return {
      version: versionByHash,
      status: "resolved_by_hash",
    } as const;
  }

  return { version: null, status: getResolveStatus(resource) } as const;
}

function makeIgnoredResourceKey(resource: CivitaiParseIgnoredResource) {
  return [
    resource.modelVersionId ?? "no-version",
    resource.resourceType,
    normalizeName(resource.name),
    resource.resolveStatus,
  ].join("|");
}

function makePreviewResourceKey(preview: {
  upsertInput: CivitaiResourceUpsertInput;
  weight: number | null;
}) {
  return [
    preview.upsertInput.civitaiModelVersionId ?? "no-version",
    preview.upsertInput.hash ? normalizeName(preview.upsertInput.hash) : "no-hash",
    preview.upsertInput.resourceType,
    normalizeName(preview.upsertInput.name),
    preview.weight ?? "no-weight",
  ].join("|");
}

function makeOfficialImageResourceKey(input: CivitaiResourceUpsertInput) {
  return [
    input.resourceType,
    input.civitaiModelVersionId ?? "no-version",
    input.hash ?? "no-hash",
    normalizeName(input.name),
  ].join("|");
}

async function buildResolvedResourcePreviews(options: {
  client: CivitaiClient;
  image: NormalizedCivitaiImage;
  db?: SceneForgeSqliteDatabase;
  enricher?: CivitaiResourceEnricher;
}) {
  const resources = getModelVersionCandidates(options.image);
  const promptWeights = parseLoraWeightsFromPrompt(options.image.prompt);

  const previews: Array<{
    imageResource: NormalizedCivitaiImageResource;
    upsertInput: CivitaiResourceUpsertInput;
    weight: number | null;
    triggerWordsUsed: string[];
    resolveStatus: CivitaiResolveStatus;
    existingResourceId: string | null;
    existingResource: CivitaiResourceRecord | null;
  }> = [];
  const ignoredResources: CivitaiParseIgnoredResource[] = [];

  for (const imageResource of resources) {
    const resolved = await resolveResource(options.client, imageResource);
    let upsertInput = mergeResourceVersion(imageResource, resolved.version);

    if (upsertInput.resourceType !== "lora" && upsertInput.resourceType !== "model") {
      ignoredResources.push(
        resolved.version
          ? makeFilteredIgnoredResource(upsertInput, imageResource)
          : makeUnresolvedIgnoredResource(imageResource),
      );
      continue;
    }

    const enrichment = await (options.enricher ?? enrichCivitaiResource)(upsertInput);
    upsertInput = applyCivitaiEnrichment(upsertInput, enrichment);

    const weight = imageResource.weight ?? getPromptWeightForResource(promptWeights, imageResource, upsertInput);
    const triggerWordsUsed = findTriggerWordsUsed(options.image.prompt, upsertInput.trainedWords);
    const existing = options.db
      ? findCivitaiResourceByUpsertInputFromSqlite(options.db, upsertInput)
      : undefined;

    previews.push({
      imageResource,
      upsertInput,
      weight,
      triggerWordsUsed,
      resolveStatus: resolved.status,
      existingResourceId: existing?.id ?? null,
      existingResource: existing ?? null,
    });
  }

  const unresolvedLoraPreviews = previews.filter(
    (preview) => preview.upsertInput.resourceType === "lora" && preview.weight === null,
  );
  const unusedPromptWeights = promptWeights.filter((promptWeight) => promptWeight.weight !== null);
  if (unresolvedLoraPreviews.length === unusedPromptWeights.length) {
    unresolvedLoraPreviews.forEach((preview, index) => {
      preview.weight = unusedPromptWeights[index]?.weight ?? null;
    });
  }

  const previewByKey = new Map<string, (typeof previews)[number]>();
  for (const preview of previews) {
    previewByKey.set(makePreviewResourceKey(preview), preview);
  }

  const ignoredByKey = new Map<string, CivitaiParseIgnoredResource>();
  for (const resource of ignoredResources) {
    ignoredByKey.set(makeIgnoredResourceKey(resource), resource);
  }

  return { previews: [...previewByKey.values()], ignoredResources: [...ignoredByKey.values()] };
}

export async function parseCivitaiImageUrl(options: {
  db?: SceneForgeSqliteDatabase;
  imageUrl: string;
  client?: CivitaiClient;
  enricher?: CivitaiResourceEnricher;
}): Promise<CivitaiParsePreview> {
  const imageId = parseCivitaiImageIdFromUrl(options.imageUrl);
  if (!imageId) {
    throw new Error("请输入有效的 Civitai image URL，例如 https://civitai.com/images/29900440。");
  }

  const client = options.client ?? createCivitaiClient({ apiKey: process.env.CIVITAI_API_KEY });
  const image = await client.getImageById(imageId);
  const { previews, ignoredResources } = await buildResolvedResourcePreviews({
    client,
    image,
    db: options.db,
    enricher: options.enricher,
  });

  return {
    image,
    resources: previews.map((entry) => ({
      resourceType: entry.upsertInput.resourceType,
      name: entry.upsertInput.name,
      modelVersionId: entry.upsertInput.civitaiModelVersionId,
      versionName: entry.upsertInput.versionName,
      hash: entry.upsertInput.hash,
      baseModel: entry.upsertInput.baseModel,
      trainedWords: entry.upsertInput.trainedWords,
      tags: entry.upsertInput.tags,
      category: entry.upsertInput.category,
      categories: entry.upsertInput.categories,
      usageGuide: entry.upsertInput.usageGuide,
      recommendations: entry.upsertInput.recommendations,
      importResourceKey: makePreviewResourceKey(entry),
      officialImageUrls: extractCivitaiImageUrls(entry.upsertInput.officialImagesJson),
      officialImageExistingUrls: extractCivitaiImageSourceUrls(entry.existingResource?.officialImagesJson),
      officialImageResourceKey: makeOfficialImageResourceKey(entry.upsertInput),
      officialImagesSelectable: true,
      enrichmentStatus: entry.upsertInput.enrichmentStatus,
      enrichmentError: entry.upsertInput.enrichmentError,
      nsfw: entry.upsertInput.nsfw,
      aiNsfwLevel: entry.upsertInput.aiNsfwLevel,
      aiNsfwConfidence: entry.upsertInput.aiNsfwConfidence,
      aiNsfwReason: entry.upsertInput.aiNsfwReason,
      weight: entry.weight,
      triggerWordsUsed: entry.triggerWordsUsed,
      resolveStatus: entry.resolveStatus,
      existingResourceId: entry.existingResourceId,
      rawResourceJson: entry.imageResource.raw,
    })),
    ignoredResources,
    message: IMPORT_METADATA_MESSAGE,
  };
}

export async function importCivitaiImageUrlToSqlite(options: {
  db: SceneForgeSqliteDatabase;
  imageUrl: string;
  selectedOfficialImageUrls?: string[];
  selectedOfficialImages?: SelectedOfficialImageRef[];
  selectedImportResourceKeys?: string[];
  client?: CivitaiClient;
  enricher?: CivitaiResourceEnricher;
  importedByUserId?: string | null;
}): Promise<CivitaiImportResult> {
  const imageId = parseCivitaiImageIdFromUrl(options.imageUrl);
  if (!imageId) {
    throw new Error("请输入有效的 Civitai image URL，例如 https://civitai.com/images/29900440。");
  }

  const client = options.client ?? createCivitaiClient({ apiKey: process.env.CIVITAI_API_KEY });
  const image = await client.getImageById(imageId);
  const { previews } = await buildResolvedResourcePreviews({
    client,
    image,
    db: options.db,
    enricher: options.enricher,
  });
  const selectedImportResourceKeySet =
    options.selectedImportResourceKeys === undefined ? null : new Set(options.selectedImportResourceKeys);
  const resourcePreviews =
    selectedImportResourceKeySet === null
      ? previews
      : previews.filter((preview) => selectedImportResourceKeySet.has(makePreviewResourceKey(preview)));

  if (resourcePreviews.length === 0) {
    throw new Error("请至少选择一个 LoRA 或 checkpoint/model 再导入。");
  }

  const importedResources: CivitaiImportResult["resources"] = [];
  const cachedImageUrl = await cacheCivitaiImageUrl(image.imageUrl, {
    cacheKey: `imported-image:${image.civitaiImageId}`,
    maxSize: 768,
  });
  const imageToImport: NormalizedCivitaiImage = {
    ...image,
    imageUrl: cachedImageUrl,
    sourceImageUrl: image.imageUrl,
  };
  const selectedOfficialImageUrlSet =
    options.selectedOfficialImageUrls === undefined ? null : new Set(options.selectedOfficialImageUrls);
  const selectedOfficialImagesByResource = new Map<string, Set<string>>();
  for (const selectedImage of options.selectedOfficialImages ?? []) {
    if (!selectedImage.resourceKey || !selectedImage.url) {
      continue;
    }

    const urls = selectedOfficialImagesByResource.get(selectedImage.resourceKey) ?? new Set<string>();
    urls.add(selectedImage.url);
    selectedOfficialImagesByResource.set(selectedImage.resourceKey, urls);
  }

  for (const preview of resourcePreviews) {
    const resourceKey = makeOfficialImageResourceKey(preview.upsertInput);
    const selectedUrlsForResource =
      options.selectedOfficialImages === undefined
        ? selectedOfficialImageUrlSet
        : (selectedOfficialImagesByResource.get(resourceKey) ?? new Set<string>());
    preview.upsertInput.officialImagesJson = await cacheSelectedOfficialImages(
      preview.upsertInput.officialImagesJson,
      selectedUrlsForResource,
      { cacheKey: resourceKey },
    );
  }
  await cleanupLegacyOriginalCachedImages();

  options.db.exec("BEGIN IMMEDIATE");
  try {
    const importedImage = upsertImportedCivitaiImageToSqlite(
      options.db,
      imageToImport,
      options.importedByUserId ?? null,
    );
    const importedResourceIds: string[] = [];

    for (const preview of resourcePreviews) {
      const { resource, isNew } = upsertCivitaiResourceToSqlite(options.db, preview.upsertInput);
      importedResourceIds.push(resource.id);
      const usage = upsertImageResourceUsageToSqlite(options.db, {
        importedImageId: importedImage.id,
        resourceId: resource.id,
        weight: preview.weight,
        triggerWordsUsed: preview.triggerWordsUsed,
        source: getResourceSource(),
        resolveStatus: preview.resolveStatus,
        rawResourceJson: preview.imageResource.raw,
      });

      importedResources.push({ resource, usage, isNewResource: isNew });
    }
    if (selectedImportResourceKeySet !== null) {
      deleteImageResourceUsagesExceptFromSqlite(options.db, {
        importedImageId: importedImage.id,
        source: getResourceSource(),
        keepResourceIds: importedResourceIds,
      });
    }

    options.db.exec("COMMIT");
    await cleanupUnreferencedCachedImages(new Set(listReferencedCivitaiLocalImageUrlsFromSqlite(options.db)));
    return {
      importedImage,
      resources: importedResources,
      message: IMPORT_METADATA_MESSAGE,
    };
  } catch (error) {
    options.db.exec("ROLLBACK");
    throw error;
  }
}

export { IMPORT_METADATA_MESSAGE };
