import type {
  CivitaiAiRecommendationResponse,
  SelectedCivitaiResourcePreview,
  SelectedCivitaiResourcesPreview,
} from "@/features/civitai-lora-library/types";
import { resolveComfyUiGenerationSettings } from "@/features/editor/ai-prompt/comfyui-generation-params";

import type {
  AgentDraftErrorCode,
  AgentGenerationDefaults,
  AgentSingleImageComfyUiDraftRequest,
  AgentSingleImageDraftComposeRequest,
  AgentSingleImageDraftResponse,
} from "./types";

const MAX_USER_REQUEST_LENGTH = 8_000;
const MAX_PROMPT_LENGTH = 12_000;
const MAX_WARNING_LENGTH = 1_000;
const DEFAULT_NEGATIVE_PROMPT =
  "lowres, blurry, bad anatomy, bad hands, extra fingers, missing fingers, malformed hands, text, watermark";

type AgentDraftErrorOptions = {
  code: AgentDraftErrorCode;
  details?: unknown;
  statusCode: number;
};

type DraftValidationResult =
  | {
      ok: true;
      request: AgentSingleImageDraftComposeRequest;
    }
  | {
      ok: false;
      message: string;
      details?: unknown;
    };

export class AgentDraftError extends Error {
  readonly code: AgentDraftErrorCode;
  readonly details?: unknown;
  readonly statusCode: number;

  constructor(message: string, options: AgentDraftErrorOptions) {
    super(message);
    this.name = "AgentDraftError";
    this.code = options.code;
    this.details = options.details;
    this.statusCode = options.statusCode;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isOptionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === "boolean";
}

function createDraftId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizePromptText(value: unknown, field: string): string {
  if (!hasNonEmptyString(value)) {
    throw new AgentDraftError(`${field} must be a non-empty string.`, {
      code: "agent_request_invalid",
      statusCode: 400,
    });
  }

  const trimmed = value.trim();
  if (trimmed.length > MAX_PROMPT_LENGTH) {
    throw new AgentDraftError(`${field} is too long.`, {
      code: "agent_request_invalid",
      statusCode: 400,
      details: { maxLength: MAX_PROMPT_LENGTH },
    });
  }

  return trimmed;
}

function normalizeOptionalPromptText(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new AgentDraftError("negativePrompt must be a string when provided.", {
      code: "agent_request_invalid",
      statusCode: 400,
    });
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeOptionalTitle(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 120) : undefined;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim().slice(0, MAX_WARNING_LENGTH))
    .filter(Boolean);
}

function normalizeResource(value: unknown, field: string): SelectedCivitaiResourcePreview {
  if (!isRecord(value)) {
    throw new AgentDraftError(`${field} must be a Civitai resource preview.`, {
      code: "agent_request_invalid",
      statusCode: 400,
    });
  }

  if (!hasNonEmptyString(value.id) || !hasNonEmptyString(value.name) || !hasNonEmptyString(value.modelFileName)) {
    throw new AgentDraftError(`${field} must include id, name, and modelFileName.`, {
      code: "agent_request_invalid",
      statusCode: 400,
    });
  }

  if (value.resourceType !== "lora" && value.resourceType !== "model") {
    throw new AgentDraftError(`${field} must be a model or LoRA resource.`, {
      code: "agent_request_invalid",
      statusCode: 400,
    });
  }

  return value as SelectedCivitaiResourcePreview;
}

function normalizeRecommendation(value: unknown): CivitaiAiRecommendationResponse {
  if (!isRecord(value)) {
    throw new AgentDraftError("recommendation must be an object.", {
      code: "agent_request_invalid",
      statusCode: 400,
    });
  }

  if (!isRecord(value.checkpoint)) {
    throw new AgentDraftError("recommendation.checkpoint is required.", {
      code: "agent_request_invalid",
      statusCode: 400,
    });
  }

  const checkpoint = {
    ...value.checkpoint,
    resource: normalizeResource(value.checkpoint.resource, "recommendation.checkpoint.resource"),
    reason: typeof value.checkpoint.reason === "string" ? value.checkpoint.reason : "",
  };

  if (checkpoint.resource.resourceType !== "model") {
    throw new AgentDraftError("recommendation.checkpoint.resource must be a model.", {
      code: "agent_request_invalid",
      statusCode: 400,
    });
  }

  const loras = Array.isArray(value.loras)
    ? value.loras.map((entry, index) => {
        if (!isRecord(entry)) {
          throw new AgentDraftError(`recommendation.loras[${index}] must be an object.`, {
            code: "agent_request_invalid",
            statusCode: 400,
          });
        }

        const resource = normalizeResource(entry.resource, `recommendation.loras[${index}].resource`);
        if (resource.resourceType !== "lora") {
          throw new AgentDraftError(`recommendation.loras[${index}].resource must be a LoRA.`, {
            code: "agent_request_invalid",
            statusCode: 400,
          });
        }

        const suggestedWeight =
          typeof entry.suggestedWeight === "number" && Number.isFinite(entry.suggestedWeight)
            ? Math.min(2, Math.max(-2, Number(entry.suggestedWeight.toFixed(2))))
            : null;

        return {
          resource,
          suggestedWeight,
          reason: typeof entry.reason === "string" ? entry.reason : "",
        };
      })
    : [];

  return {
    checkpoint,
    loras,
    recommendationReason: typeof value.recommendationReason === "string" ? value.recommendationReason : "",
    overallEffect: typeof value.overallEffect === "string" ? value.overallEffect : "",
    warnings: normalizeStringArray(value.warnings),
  };
}

export function validateAgentSingleImageDraftRequest(value: unknown): DraftValidationResult {
  if (!isRecord(value)) {
    return {
      ok: false,
      message: "Request body must be an object.",
    };
  }

  if (!hasNonEmptyString(value.userRequest)) {
    return {
      ok: false,
      message: "userRequest must be a non-empty string.",
    };
  }

  if (value.userRequest.trim().length > MAX_USER_REQUEST_LENGTH) {
    return {
      ok: false,
      message: "userRequest is too long.",
      details: { maxLength: MAX_USER_REQUEST_LENGTH },
    };
  }

  if (!isOptionalBoolean(value.nsfw)) {
    return {
      ok: false,
      message: "nsfw must be a boolean when provided.",
    };
  }

  if (!isRecord(value.prompt)) {
    return {
      ok: false,
      message: "prompt must be an object.",
    };
  }

  let positivePrompt: string;
  let negativePrompt: string | undefined;
  let recommendation: CivitaiAiRecommendationResponse;

  try {
    positivePrompt = normalizePromptText(value.prompt.positivePrompt, "positivePrompt");
    negativePrompt = normalizeOptionalPromptText(value.prompt.negativePrompt);
    recommendation = normalizeRecommendation(value.recommendation);
  } catch (error) {
    if (error instanceof AgentDraftError) {
      return {
        ok: false,
        message: error.message,
        details: error.details,
      };
    }

    throw error;
  }

  return {
    ok: true,
    request: {
      userRequest: value.userRequest.trim(),
      nsfw: value.nsfw,
      prompt: {
        title: normalizeOptionalTitle(value.prompt.title),
        positivePrompt,
        negativePrompt,
        warnings: normalizeStringArray(value.prompt.warnings),
      },
      recommendation,
    },
  };
}

function applySuggestedLoraWeights(
  comfyUiRequest: AgentSingleImageComfyUiDraftRequest,
  recommendation: CivitaiAiRecommendationResponse,
): AgentSingleImageComfyUiDraftRequest {
  if (!comfyUiRequest.loras?.length) {
    return comfyUiRequest;
  }

  return {
    ...comfyUiRequest,
    loras: comfyUiRequest.loras.map((lora, index) => {
      const suggestedWeight = recommendation.loras[index]?.suggestedWeight;
      return suggestedWeight === null || suggestedWeight === undefined
        ? lora
        : {
            ...lora,
            strengthModel: suggestedWeight,
            strengthClip: suggestedWeight,
          };
    }),
  };
}

function buildSelectedResources(recommendation: CivitaiAiRecommendationResponse): SelectedCivitaiResourcesPreview {
  return {
    checkpoint: recommendation.checkpoint.resource,
    loras: recommendation.loras.map((lora) => lora.resource),
  };
}

function buildWarnings(request: AgentSingleImageDraftComposeRequest) {
  return Array.from(new Set([
    ...(request.prompt.warnings ?? []),
    ...request.recommendation.warnings,
  ]));
}

function toAgentGenerationDefaults(request: AgentSingleImageComfyUiDraftRequest): AgentGenerationDefaults {
  return {
    checkpointName: request.checkpointName,
    negativePrompt: request.negativePrompt,
    loras: request.loras,
    width: request.width,
    height: request.height,
    steps: request.steps,
    cfg: request.cfg,
    samplerName: request.samplerName,
    scheduler: request.scheduler,
    denoise: request.denoise,
    batchSize: request.batchSize,
    latentImageNode: request.latentImageNode,
    promptWrapper: request.promptWrapper,
    outputPrefix: request.outputPrefix,
  };
}

export async function generateAgentSingleImageDraft(
  rawRequest: unknown,
): Promise<AgentSingleImageDraftResponse> {
  const validation = validateAgentSingleImageDraftRequest(rawRequest);
  if (!validation.ok) {
    throw new AgentDraftError(validation.message, {
      code: "agent_request_invalid",
      statusCode: 400,
      details: validation.details,
    });
  }

  const request = validation.request;
  const negativePrompt = request.prompt.negativePrompt ?? DEFAULT_NEGATIVE_PROMPT;
  const settings = resolveComfyUiGenerationSettings({
    activePrompt: request.prompt.positivePrompt,
    baseNegativePrompt: negativePrompt,
    selectedResources: buildSelectedResources(request.recommendation),
    aiAdvice: null,
  });
  const resolvedNegativePrompt = settings.request.negativePrompt ?? negativePrompt;
  const comfyUiRequest = applySuggestedLoraWeights(
    {
      ...toAgentGenerationDefaults(settings.request),
      positivePrompt: request.prompt.positivePrompt,
      negativePrompt: resolvedNegativePrompt,
    },
    request.recommendation,
  );

  return {
    draftId: createDraftId(),
    status: "draft",
    title: request.prompt.title,
    positivePrompt: request.prompt.positivePrompt,
    negativePrompt: resolvedNegativePrompt,
    comfyUiRequest,
    confirmationRequired: true,
    warnings: buildWarnings(request),
  };
}
