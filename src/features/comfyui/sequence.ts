import type {
  ComfyUiCharacterReferenceConfig,
  ComfyUiControlNetConfig,
  ComfyUiControlNetUnitConfig,
  ComfyUiIpAdapterCombineEmbeds,
  ComfyUiIpAdapterReferenceMode,
  ComfyUiTextToImageRequest,
} from "./types";

export type ComfyUiSequenceReferenceImage = {
  id?: string;
  imageDataUrl?: string;
  imageName?: string;
  storedFilename?: string;
  weight?: number;
};

export type ComfyUiSequenceCharacter = {
  id?: string;
  name: string;
  prompt?: string;
  enabled?: boolean;
  mode?: ComfyUiIpAdapterReferenceMode;
  references: ComfyUiSequenceReferenceImage[];
  maskImageName?: string;
  weight?: number;
  weightType?: string;
  combineEmbeds?: ComfyUiIpAdapterCombineEmbeds;
  startPercent?: number;
  endPercent?: number;
  preset?: string;
  loraStrength?: number;
  provider?: string;
  embedsScaling?: string;
};

export type ComfyUiSequenceShot = {
  id?: string;
  title?: string;
  prompt: string;
  cameraPrompt?: string;
  characterIds?: string[];
  characters?: ComfyUiSequenceCharacter[];
  imageCount?: number;
  request?: ComfyUiTextToImageRequest;
  controlNet?: ComfyUiControlNetConfig;
  controlNets?: ComfyUiControlNetUnitConfig[];
};

export type ComfyUiSequenceImageRequest = {
  sequenceId?: string;
  globalPrompt?: string;
  negativePrompt?: string;
  baseSeed?: number;
  imageCount?: number;
  clientId?: string;
  preview?: boolean;
  baseRequest: ComfyUiTextToImageRequest;
  characters: ComfyUiSequenceCharacter[];
  shots: ComfyUiSequenceShot[];
};

export type ComfyUiSequenceImageValidationResult =
  | {
      ok: true;
      request: ComfyUiSequenceImageRequest;
    }
  | {
      ok: false;
      message: string;
      details?: unknown;
    };

const MAX_SEQUENCE_SHOTS = 24;
const MAX_SEQUENCE_CHARACTERS = 8;
const MAX_SEQUENCE_REFERENCES_PER_CHARACTER = 4;
const MAX_SEQUENCE_IMAGE_COUNT = 8;
const MAX_REFERENCE_DATA_URL_LENGTH = 24_000_000;
const IPADAPTER_REFERENCE_MODES = ["ipadapter", "face", "faceid"] as const satisfies readonly ComfyUiIpAdapterReferenceMode[];
const IPADAPTER_COMBINE_EMBEDS = ["concat", "add", "subtract", "average", "norm average"] as const satisfies readonly ComfyUiIpAdapterCombineEmbeds[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || hasNonEmptyString(value);
}

function isOptionalStringValue(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isOptionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === "boolean";
}

function isOptionalFiniteNumber(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === "number" && Number.isFinite(value));
}

function isOptionalPositiveInteger(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === "number" && Number.isInteger(value) && value > 0);
}

function isOptionalSafeSeed(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
}

function isIpAdapterReferenceMode(value: unknown): value is ComfyUiIpAdapterReferenceMode {
  return typeof value === "string" && IPADAPTER_REFERENCE_MODES.includes(value as ComfyUiIpAdapterReferenceMode);
}

function isIpAdapterCombineEmbeds(value: unknown): value is ComfyUiIpAdapterCombineEmbeds {
  return typeof value === "string" && IPADAPTER_COMBINE_EMBEDS.includes(value as ComfyUiIpAdapterCombineEmbeds);
}

function normalizeStringArray(value: unknown): string[] | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    return null;
  }

  const strings = value.map((item) => (hasNonEmptyString(item) ? item.trim() : null));
  return strings.some((item) => item === null) ? null : strings as string[];
}

function normalizeReferenceImage(value: unknown): ComfyUiSequenceReferenceImage | null {
  if (
    !isRecord(value) ||
    (!hasNonEmptyString(value.imageDataUrl) && !hasNonEmptyString(value.imageName) && !hasNonEmptyString(value.storedFilename))
  ) {
    return null;
  }

  if (!isOptionalString(value.id) || !isOptionalFiniteNumber(value.weight)) {
    return null;
  }

  if (typeof value.imageDataUrl === "string" && value.imageDataUrl.length > MAX_REFERENCE_DATA_URL_LENGTH) {
    return null;
  }

  return {
    ...(hasNonEmptyString(value.id) ? { id: value.id.trim() } : {}),
    ...(hasNonEmptyString(value.imageDataUrl) ? { imageDataUrl: value.imageDataUrl.trim() } : {}),
    ...(hasNonEmptyString(value.imageName) ? { imageName: value.imageName.trim() } : {}),
    ...(hasNonEmptyString(value.storedFilename) ? { storedFilename: value.storedFilename.trim() } : {}),
    ...(typeof value.weight === "number" ? { weight: value.weight } : {}),
  };
}

function normalizeSequenceCharacter(value: unknown): ComfyUiSequenceCharacter | null {
  if (!isRecord(value) || !hasNonEmptyString(value.name) || !Array.isArray(value.references)) {
    return null;
  }

  if (value.references.length < 1 || value.references.length > MAX_SEQUENCE_REFERENCES_PER_CHARACTER) {
    return null;
  }

  const references = value.references.map(normalizeReferenceImage);
  if (references.some((reference) => reference === null)) {
    return null;
  }

  if (!isOptionalString(value.id) || !isOptionalStringValue(value.prompt) || !isOptionalBoolean(value.enabled)) {
    return null;
  }

  if (value.mode !== undefined && !isIpAdapterReferenceMode(value.mode)) {
    return null;
  }

  if (
    !isOptionalString(value.maskImageName) ||
    !isOptionalFiniteNumber(value.weight) ||
    !isOptionalString(value.weightType) ||
    !isOptionalFiniteNumber(value.startPercent) ||
    !isOptionalFiniteNumber(value.endPercent) ||
    !isOptionalString(value.preset) ||
    !isOptionalFiniteNumber(value.loraStrength) ||
    !isOptionalString(value.provider) ||
    !isOptionalString(value.embedsScaling)
  ) {
    return null;
  }

  if (value.combineEmbeds !== undefined && !isIpAdapterCombineEmbeds(value.combineEmbeds)) {
    return null;
  }

  return {
    ...(hasNonEmptyString(value.id) ? { id: value.id.trim() } : {}),
    name: value.name.trim(),
    ...(typeof value.prompt === "string" ? { prompt: value.prompt.trim() } : {}),
    ...(typeof value.enabled === "boolean" ? { enabled: value.enabled } : {}),
    ...(value.mode ? { mode: value.mode } : {}),
    references: references as ComfyUiSequenceReferenceImage[],
    ...(hasNonEmptyString(value.maskImageName) ? { maskImageName: value.maskImageName.trim() } : {}),
    ...(typeof value.weight === "number" ? { weight: value.weight } : {}),
    ...(hasNonEmptyString(value.weightType) ? { weightType: value.weightType.trim() } : {}),
    ...(value.combineEmbeds ? { combineEmbeds: value.combineEmbeds } : {}),
    ...(typeof value.startPercent === "number" ? { startPercent: value.startPercent } : {}),
    ...(typeof value.endPercent === "number" ? { endPercent: value.endPercent } : {}),
    ...(hasNonEmptyString(value.preset) ? { preset: value.preset.trim() } : {}),
    ...(typeof value.loraStrength === "number" ? { loraStrength: value.loraStrength } : {}),
    ...(hasNonEmptyString(value.provider) ? { provider: value.provider.trim() } : {}),
    ...(hasNonEmptyString(value.embedsScaling) ? { embedsScaling: value.embedsScaling.trim() } : {}),
  };
}

function normalizeSequenceShot(value: unknown, index: number): ComfyUiSequenceShot | null {
  if (!isRecord(value) || !hasNonEmptyString(value.prompt)) {
    return null;
  }

  const characterIds = normalizeStringArray(value.characterIds);
  if (characterIds === null) {
    return null;
  }
  const characters = value.characters === undefined
    ? undefined
    : Array.isArray(value.characters) && value.characters.length <= MAX_SEQUENCE_CHARACTERS
      ? value.characters.map(normalizeSequenceCharacter)
      : null;
  if (characters === null || characters?.some((character) => character === null)) {
    return null;
  }

  if (
    !isOptionalString(value.id) ||
    !isOptionalStringValue(value.title) ||
    !isOptionalStringValue(value.cameraPrompt) ||
    !isOptionalPositiveInteger(value.imageCount)
  ) {
    return null;
  }

  if (typeof value.imageCount === "number" && value.imageCount > MAX_SEQUENCE_IMAGE_COUNT) {
    return null;
  }

  return {
    id: hasNonEmptyString(value.id) ? value.id.trim() : `shot-${index + 1}`,
    ...(typeof value.title === "string" ? { title: value.title.trim() } : {}),
    prompt: value.prompt.trim(),
    ...(typeof value.cameraPrompt === "string" ? { cameraPrompt: value.cameraPrompt.trim() } : {}),
    ...(characterIds ? { characterIds } : {}),
    ...(characters ? { characters: characters as ComfyUiSequenceCharacter[] } : {}),
    ...(typeof value.imageCount === "number" ? { imageCount: value.imageCount } : {}),
    ...(isRecord(value.request) ? { request: value.request as ComfyUiTextToImageRequest } : {}),
    ...(isRecord(value.controlNet) ? { controlNet: value.controlNet as ComfyUiControlNetConfig } : {}),
    ...(Array.isArray(value.controlNets) ? { controlNets: value.controlNets as ComfyUiControlNetUnitConfig[] } : {}),
  };
}

export function validateComfyUiSequenceImageRequest(value: unknown): ComfyUiSequenceImageValidationResult {
  if (!isRecord(value)) {
    return {
      ok: false,
      message: "Request body must be a JSON object.",
    };
  }

  if (!isRecord(value.baseRequest)) {
    return {
      ok: false,
      message: "baseRequest is required.",
    };
  }

  if (!Array.isArray(value.shots) || value.shots.length < 1 || value.shots.length > MAX_SEQUENCE_SHOTS) {
    return {
      ok: false,
      message: `shots must include 1-${MAX_SEQUENCE_SHOTS} shot descriptions.`,
    };
  }

  if (value.characters !== undefined && (!Array.isArray(value.characters) || value.characters.length > MAX_SEQUENCE_CHARACTERS)) {
    return {
      ok: false,
      message: `characters must be an array with at most ${MAX_SEQUENCE_CHARACTERS} characters when provided.`,
    };
  }

  if (
    !isOptionalString(value.sequenceId) ||
    !isOptionalStringValue(value.globalPrompt) ||
    !isOptionalStringValue(value.negativePrompt) ||
    !isOptionalSafeSeed(value.baseSeed) ||
    !isOptionalPositiveInteger(value.imageCount) ||
    !isOptionalString(value.clientId) ||
    !isOptionalBoolean(value.preview)
  ) {
    return {
      ok: false,
      message: "sequenceId, prompts, seed, imageCount, clientId, and preview must use valid values when provided.",
    };
  }

  if (typeof value.imageCount === "number" && value.imageCount > MAX_SEQUENCE_IMAGE_COUNT) {
    return {
      ok: false,
      message: `imageCount must be ${MAX_SEQUENCE_IMAGE_COUNT} or less.`,
    };
  }

  const characters = (value.characters ?? []).map(normalizeSequenceCharacter);
  if (characters.some((character) => character === null)) {
    return {
      ok: false,
      message: "Each character must include a name and 1-4 valid reference images.",
    };
  }

  const shots = value.shots.map(normalizeSequenceShot);
  if (shots.some((shot) => shot === null)) {
    return {
      ok: false,
      message: "Each shot must include a prompt and valid optional settings.",
    };
  }

  return {
    ok: true,
    request: {
      sequenceId: hasNonEmptyString(value.sequenceId) ? value.sequenceId.trim() : undefined,
      globalPrompt: typeof value.globalPrompt === "string" ? value.globalPrompt.trim() : undefined,
      negativePrompt: typeof value.negativePrompt === "string" ? value.negativePrompt.trim() : undefined,
      baseSeed: typeof value.baseSeed === "number" ? value.baseSeed : undefined,
      imageCount: typeof value.imageCount === "number" ? value.imageCount : undefined,
      clientId: hasNonEmptyString(value.clientId) ? value.clientId.trim() : undefined,
      preview: typeof value.preview === "boolean" ? value.preview : undefined,
      baseRequest: value.baseRequest as ComfyUiTextToImageRequest,
      characters: characters as ComfyUiSequenceCharacter[],
      shots: shots as ComfyUiSequenceShot[],
    },
  };
}

export function buildComfyUiSequenceCharacterReference(
  character: ComfyUiSequenceCharacter,
  images: ComfyUiCharacterReferenceConfig["images"],
): ComfyUiCharacterReferenceConfig {
  return {
    id: character.id,
    name: character.name,
    prompt: character.prompt,
    enabled: character.enabled,
    mode: character.mode,
    images,
    maskImageName: character.maskImageName,
    weight: character.weight,
    weightType: character.weightType,
    combineEmbeds: character.combineEmbeds,
    startPercent: character.startPercent,
    endPercent: character.endPercent,
    preset: character.preset,
    loraStrength: character.loraStrength,
    provider: character.provider,
    embedsScaling: character.embedsScaling,
  };
}
