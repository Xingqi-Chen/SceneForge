import type {
  CivitaiResourceType,
  CivitaiResourceUpsertInput,
  CivitaiResourceUpsertKey,
  CivitaiResolvedVersion,
  NormalizedCivitaiImage,
  NormalizedCivitaiImageResource,
} from "./types";
import { normalizeName } from "./parsing";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }

  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }

  return null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(asString).filter((item): item is string => Boolean(item));
}

function firstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = asString(record[key]);
    if (value) {
      return value;
    }
  }

  return null;
}

function firstNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = asNumber(record[key]);
    if (value !== null) {
      return value;
    }
  }

  return null;
}

function firstRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function normalizeResourceType(value: unknown): CivitaiResourceType {
  const normalized = asString(value)?.toLocaleLowerCase();
  if (normalized === "lora" || normalized === "locon" || normalized === "dora") {
    return "lora";
  }
  if (normalized === "model" || normalized === "checkpoint" || normalized === "checkpoints") {
    return "model";
  }
  if (normalized === "embedding" || normalized === "textualinversion") {
    return "embedding";
  }
  if (normalized === "vae") {
    return "vae";
  }
  return "other";
}

function normalizeImageResource(value: unknown): NormalizedCivitaiImageResource | null {
  if (!isRecord(value)) {
    return null;
  }

  const modelVersionId = firstNumber(value, ["modelVersionId", "modelVersionID", "versionId"]);
  const weight = firstNumber(value, ["weight", "strength"]);

  return {
    type: normalizeResourceType(value.type),
    name: firstString(value, ["name", "modelName", "modelVersionName"]),
    hash: firstString(value, ["hash", "modelHash"]),
    modelVersionId,
    modelId: firstNumber(value, ["modelId", "modelID"]),
    weight,
    raw: value,
  };
}

function getMeta(item: Record<string, unknown>) {
  const meta = item.meta;
  if (!isRecord(meta)) {
    return {};
  }

  return isRecord(meta.meta) ? meta.meta : meta;
}

function getModelVersionIds(item: Record<string, unknown>, meta: Record<string, unknown>) {
  const raw = Array.isArray(item.modelVersionIds)
    ? item.modelVersionIds
    : Array.isArray(meta.modelVersionIds)
      ? meta.modelVersionIds
      : [];

  return raw.map(asNumber).filter((id): id is number => id !== null);
}

export function normalizeCivitaiImageResponse(payload: unknown, imageId: number): NormalizedCivitaiImage {
  if (!isRecord(payload) || !Array.isArray(payload.items) || payload.items.length === 0) {
    throw new Error("Civitai did not return an image for this imageId.");
  }

  const item = payload.items.find((entry) => isRecord(entry) && asNumber(entry.id) === imageId) ?? payload.items[0];
  if (!isRecord(item)) {
    throw new Error("Civitai returned an invalid image payload.");
  }

  const meta = getMeta(item);
  const rawResources = [
    ...(Array.isArray(meta.resources) ? meta.resources : []),
    ...(Array.isArray(meta.civitaiResources) ? meta.civitaiResources : []),
  ];
  const resources = rawResources
    .map(normalizeImageResource)
    .filter((resource): resource is NormalizedCivitaiImageResource => Boolean(resource));

  const imageUrl = firstString(item, ["url", "imageUrl"]);

  return {
    civitaiImageId: asNumber(item.id) ?? imageId,
    civitaiImagePageUrl: `https://civitai.com/images/${asNumber(item.id) ?? imageId}`,
    imageUrl,
    sourceImageUrl: imageUrl,
    width: firstNumber(item, ["width"]),
    height: firstNumber(item, ["height"]),
    nsfw: asBoolean(item.nsfw),
    nsfwLevel: firstNumber(item, ["nsfwLevel"]),
    browsingLevel: firstNumber(item, ["browsingLevel"]),
    createdAtOnCivitai: firstString(item, ["createdAt"]),
    postId: firstNumber(item, ["postId"]),
    username: firstString(item, ["username"]) ?? (isRecord(item.user) ? firstString(item.user, ["username", "name"]) : null),
    baseModel: firstString(item, ["baseModel"]) ?? firstString(meta, ["baseModel", "Base model", "Model"]),
    prompt: firstString(meta, ["prompt", "Prompt"]),
    negativePrompt: firstString(meta, ["negativePrompt", "Negative prompt"]),
    sampler: firstString(meta, ["sampler", "Sampler"]),
    steps: firstNumber(meta, ["steps", "Steps"]),
    cfgScale: firstNumber(meta, ["cfgScale", "CFG scale", "cfg"]),
    seed: firstString(meta, ["seed", "Seed"]),
    modelVersionIds: getModelVersionIds(item, meta),
    resources,
    rawMetaJson: meta,
  };
}

function getPrimaryFileHash(files: unknown): string | null {
  if (!Array.isArray(files)) {
    return null;
  }

  for (const file of files) {
    if (!isRecord(file)) {
      continue;
    }

    const hashes = file.hashes;
    if (isRecord(hashes)) {
      const hash = firstString(hashes, ["AutoV2", "SHA256", "CRC32", "BLAKE3"]);
      if (hash) {
        return hash;
      }
    }
  }

  return null;
}

function getModelVersionPayload(
  payload: Record<string, unknown>,
  preferredModelVersionId?: number,
): Record<string, unknown> {
  const modelVersions = Array.isArray(payload.modelVersions) ? payload.modelVersions : [];
  const version =
    modelVersions
      .map(firstRecord)
      .find((entry): entry is Record<string, unknown> => {
        if (!entry) {
          return false;
        }

        return preferredModelVersionId === undefined || firstNumber(entry, ["id"]) === preferredModelVersionId;
      }) ?? firstRecord(modelVersions.map(firstRecord).find(Boolean));

  return version ?? payload;
}

function getModelPayload(payload: Record<string, unknown>): Record<string, unknown> {
  if (isRecord(payload.model)) {
    return payload.model;
  }

  if (Array.isArray(payload.modelVersions)) {
    return payload;
  }

  return {};
}

export function normalizeCivitaiModelVersionResponse(
  payload: unknown,
  options: { preferredModelVersionId?: number } = {},
): CivitaiResolvedVersion {
  if (!isRecord(payload)) {
    throw new Error("Civitai returned an invalid model version payload.");
  }

  const version = getModelVersionPayload(payload, options.preferredModelVersionId);
  const model = getModelPayload(payload);
  const creator = isRecord(model.creator) ? model.creator : isRecord(payload.creator) ? payload.creator : {};
  const files = version.files;
  const modelTags = Array.isArray(model.tags) ? model.tags : payload.tags;

  return {
    resourceType: normalizeResourceType(firstString(model, ["type"]) ?? firstString(version, ["type", "modelType"])),
    civitaiModelId: firstNumber(version, ["modelId"]) ?? firstNumber(model, ["id"]),
    civitaiModelVersionId: firstNumber(version, ["id"]),
    name: firstString(model, ["name"]) ?? firstString(payload, ["modelName", "name"]),
    versionName: firstString(version, ["name"]),
    hash: getPrimaryFileHash(files),
    baseModel: firstString(version, ["baseModel"]),
    trainedWords: asStringArray(version.trainedWords),
    tags: asStringArray(modelTags),
    description: firstString(model, ["description"]) ?? firstString(version, ["description"]),
    creator: firstString(creator, ["username", "name"]),
    downloadUrl: firstString(version, ["downloadUrl"]),
    filesJson: files ?? null,
    officialImagesJson: version.images ?? null,
    nsfw: asBoolean(model.nsfw) ?? asBoolean(version.nsfw),
    rawVersionJson: version,
  };
}

export function chooseResourceUpsertKey(input: Pick<
  CivitaiResourceUpsertInput,
  "civitaiModelId" | "civitaiModelVersionId" | "name" | "versionName" | "hash" | "baseModel"
>): CivitaiResourceUpsertKey {
  if (input.civitaiModelVersionId !== null) {
    return { kind: "civitaiModelVersionId", value: input.civitaiModelVersionId };
  }

  if (input.hash) {
    return { kind: "hash", value: input.hash.toLocaleLowerCase() };
  }

  if (input.civitaiModelId !== null && input.versionName) {
    return {
      kind: "modelVersionName",
      civitaiModelId: input.civitaiModelId,
      versionName: normalizeName(input.versionName),
    };
  }

  return {
    kind: "normalizedNameBaseModel",
    normalizedName: normalizeName(input.name),
    baseModel: input.baseModel ? normalizeName(input.baseModel) : null,
  };
}

export function mergeResourceVersion(
  imageResource: NormalizedCivitaiImageResource,
  resolved: CivitaiResolvedVersion | null,
): CivitaiResourceUpsertInput {
  const name = resolved?.name ?? imageResource.name ?? "Unknown Civitai resource";

  return {
    resourceType: resolved?.resourceType ?? imageResource.type,
    civitaiModelId: resolved?.civitaiModelId ?? imageResource.modelId,
    civitaiModelVersionId: resolved?.civitaiModelVersionId ?? imageResource.modelVersionId,
    name,
    versionName: resolved?.versionName ?? null,
    hash: resolved?.hash ?? imageResource.hash,
    baseModel: resolved?.baseModel ?? null,
    trainedWords: resolved?.trainedWords ?? [],
    tags: resolved?.tags ?? [],
    description: resolved?.description ?? null,
    creator: resolved?.creator ?? null,
    downloadUrl: resolved?.downloadUrl ?? null,
    filesJson: resolved?.filesJson ?? null,
    officialImagesJson: resolved?.officialImagesJson ?? null,
    category: null,
    categories: [],
    usageGuide: null,
    recommendations: [],
    enrichmentStatus: "fallback",
    enrichmentError: null,
    nsfw: resolved?.nsfw ?? null,
    aiNsfwLevel: "unknown",
    aiNsfwConfidence: null,
    aiNsfwReason: null,
    rawVersionJson: resolved?.rawVersionJson ?? null,
  };
}

export function getOfficialPreviewImage(officialImagesJson: unknown): string | null {
  if (!Array.isArray(officialImagesJson)) {
    return null;
  }

  for (const image of officialImagesJson) {
    if (isRecord(image)) {
      const url = firstString(image, ["url", "imageUrl"]);
      if (url && !isVideoReference(image, url)) {
        return url;
      }
    }
  }

  return null;
}

function isVideoReference(entry: Record<string, unknown>, url: string) {
  const type = firstString(entry, ["type"])?.toLocaleLowerCase() ?? "";
  const mimeType = firstString(entry, ["mimeType", "mime"])?.toLocaleLowerCase() ?? "";
  const urlWithoutQuery = url.split("?")[0]?.toLocaleLowerCase() ?? url.toLocaleLowerCase();

  return (
    type === "video" ||
    type === "animated" ||
    mimeType.startsWith("video/") ||
    /\.(mp4|webm|mov|m4v|avi|mkv)$/i.test(urlWithoutQuery)
  );
}
