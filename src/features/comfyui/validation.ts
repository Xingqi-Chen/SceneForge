import type {
  ComfyUiLoraInput,
  ComfyUiTextToImageRequest,
  ResolvedComfyUiTextToImageRequest,
} from "./types";

const DEFAULT_TEXT_TO_IMAGE_REQUEST = {
  negativePrompt: "",
  loras: [],
  width: 1024,
  height: 1024,
  steps: 30,
  cfg: 7,
  samplerName: "euler",
  scheduler: "normal",
  denoise: 1,
  batchSize: 1,
  outputPrefix: "SceneForge",
} satisfies Omit<ResolvedComfyUiTextToImageRequest, "checkpointName" | "positivePrompt" | "seed">;

export type ComfyUiTextToImageValidationResult =
  | {
      ok: true;
      request: ComfyUiTextToImageRequest;
    }
  | {
      ok: false;
      message: string;
      details?: unknown;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || hasNonEmptyString(value);
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

function getString(value: unknown, fallback: string) {
  return typeof value === "string" ? value.trim() : fallback;
}

function getOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function normalizeLoraInput(value: unknown): ComfyUiLoraInput | null {
  if (!isRecord(value) || !hasNonEmptyString(value.loraName)) {
    return null;
  }

  if (!isOptionalFiniteNumber(value.strengthModel) || !isOptionalFiniteNumber(value.strengthClip)) {
    return null;
  }

  return {
    loraName: value.loraName.trim(),
    strengthModel: value.strengthModel ?? 0.7,
    strengthClip: value.strengthClip,
  };
}

function normalizeOptionalLoras(value: unknown): ComfyUiLoraInput[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.map(normalizeLoraInput).filter((lora): lora is ComfyUiLoraInput => lora !== null);
}

function createRandomSeed() {
  return Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
}

export function validateComfyUiTextToImageRequest(value: unknown): ComfyUiTextToImageValidationResult {
  if (!isRecord(value)) {
    return {
      ok: false,
      message: "Request body must be a JSON object.",
    };
  }

  if (!hasNonEmptyString(value.checkpointName)) {
    return {
      ok: false,
      message: "checkpointName is required.",
    };
  }

  if (!hasNonEmptyString(value.positivePrompt)) {
    return {
      ok: false,
      message: "positivePrompt is required.",
    };
  }

  if (value.negativePrompt !== undefined && typeof value.negativePrompt !== "string") {
    return {
      ok: false,
      message: "negativePrompt must be a string when provided.",
    };
  }

  if (value.loras !== undefined) {
    if (!Array.isArray(value.loras)) {
      return {
        ok: false,
        message: "loras must be an array when provided.",
      };
    }

    for (const lora of value.loras) {
      if (!normalizeLoraInput(lora)) {
        return {
          ok: false,
          message: "Each LoRA must include loraName and finite strength values when provided.",
        };
      }
    }
  }

  if (!isOptionalString(value.samplerName)) {
    return {
      ok: false,
      message: "samplerName must be a non-empty string when provided.",
    };
  }

  if (!isOptionalString(value.scheduler)) {
    return {
      ok: false,
      message: "scheduler must be a non-empty string when provided.",
    };
  }

  if (!isOptionalString(value.outputPrefix)) {
    return {
      ok: false,
      message: "outputPrefix must be a non-empty string when provided.",
    };
  }

  for (const field of ["width", "height", "batchSize", "steps"] as const) {
    if (!isOptionalPositiveInteger(value[field])) {
      return {
        ok: false,
        message: `${field} must be a positive integer when provided.`,
      };
    }
  }

  if (!isOptionalSafeSeed(value.seed)) {
    return {
      ok: false,
      message: "seed must be a non-negative safe integer when provided.",
    };
  }

  for (const field of ["cfg", "denoise"] as const) {
    if (!isOptionalFiniteNumber(value[field])) {
      return {
        ok: false,
        message: `${field} must be a finite number when provided.`,
      };
    }
  }

  if (typeof value.denoise === "number" && (value.denoise < 0 || value.denoise > 1)) {
    return {
      ok: false,
      message: "denoise must be between 0 and 1.",
    };
  }

  return {
    ok: true,
    request: {
      checkpointName: value.checkpointName.trim(),
      positivePrompt: value.positivePrompt.trim(),
      negativePrompt: typeof value.negativePrompt === "string" ? value.negativePrompt.trim() : undefined,
      loras: normalizeOptionalLoras(value.loras),
      width: getOptionalNumber(value.width),
      height: getOptionalNumber(value.height),
      seed: getOptionalNumber(value.seed),
      steps: getOptionalNumber(value.steps),
      cfg: getOptionalNumber(value.cfg),
      samplerName: value.samplerName?.trim(),
      scheduler: value.scheduler?.trim(),
      denoise: getOptionalNumber(value.denoise),
      batchSize: getOptionalNumber(value.batchSize),
      outputPrefix: value.outputPrefix?.trim(),
    },
  };
}

export function resolveComfyUiTextToImageRequest(
  request: ComfyUiTextToImageRequest,
): ResolvedComfyUiTextToImageRequest {
  return {
    checkpointName: request.checkpointName.trim(),
    positivePrompt: request.positivePrompt.trim(),
    negativePrompt: getString(request.negativePrompt, DEFAULT_TEXT_TO_IMAGE_REQUEST.negativePrompt),
    loras: (request.loras ?? []).map((lora) => ({
      loraName: lora.loraName.trim(),
      strengthModel: lora.strengthModel,
      strengthClip: lora.strengthClip ?? lora.strengthModel,
    })),
    width: request.width ?? DEFAULT_TEXT_TO_IMAGE_REQUEST.width,
    height: request.height ?? DEFAULT_TEXT_TO_IMAGE_REQUEST.height,
    seed: request.seed ?? createRandomSeed(),
    steps: request.steps ?? DEFAULT_TEXT_TO_IMAGE_REQUEST.steps,
    cfg: request.cfg ?? DEFAULT_TEXT_TO_IMAGE_REQUEST.cfg,
    samplerName: getString(request.samplerName, DEFAULT_TEXT_TO_IMAGE_REQUEST.samplerName),
    scheduler: getString(request.scheduler, DEFAULT_TEXT_TO_IMAGE_REQUEST.scheduler),
    denoise: request.denoise ?? DEFAULT_TEXT_TO_IMAGE_REQUEST.denoise,
    batchSize: request.batchSize ?? DEFAULT_TEXT_TO_IMAGE_REQUEST.batchSize,
    outputPrefix: getString(request.outputPrefix, DEFAULT_TEXT_TO_IMAGE_REQUEST.outputPrefix),
  };
}
