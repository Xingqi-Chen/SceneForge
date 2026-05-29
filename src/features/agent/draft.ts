import {
  createLiteLlmClient,
  LiteLlmError,
  type LlmChatMessage,
  type LlmChatRequest,
} from "@/features/llm";

import type {
  AgentDraftErrorCode,
  AgentGenerationDefaults,
  AgentSingleImageComfyUiDraftRequest,
  AgentSingleImageDraftRequest,
  AgentSingleImageDraftResponse,
} from "./types";

const MAX_USER_REQUEST_LENGTH = 8_000;
const MAX_PROMPT_LENGTH = 12_000;
const LATENT_IMAGE_NODES = new Set(["EmptyLatentImage", "EmptySD3LatentImage"]);

type AgentDraftErrorOptions = {
  code: AgentDraftErrorCode;
  details?: unknown;
  statusCode: number;
};

type DraftValidationResult =
  | {
      ok: true;
      request: AgentSingleImageDraftRequest;
    }
  | {
      ok: false;
      message: string;
      details?: unknown;
    };

type NormalizedDefaults = {
  defaults: AgentGenerationDefaults;
  warnings: string[];
};

type GenerateAgentSingleImageDraftOptions = {
  baseUrl?: string;
  apiKey?: string;
  defaultModel?: string;
  nsfwModel?: string;
};

type RequiredDraftDefaultKey =
  | "checkpointName"
  | "width"
  | "height"
  | "steps"
  | "cfg"
  | "samplerName"
  | "scheduler"
  | "denoise"
  | "batchSize"
  | "latentImageNode"
  | "outputPrefix";

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

function isOptionalIntegerInRange(value: unknown, min: number, max: number): value is number | undefined {
  return value === undefined || (typeof value === "number" && Number.isInteger(value) && value >= min && value <= max);
}

function isOptionalNumberInRange(value: unknown, min: number, max: number): value is number | undefined {
  return value === undefined || (typeof value === "number" && Number.isFinite(value) && value >= min && value <= max);
}

function isOptionalLatentImageNode(value: unknown): value is AgentGenerationDefaults["latentImageNode"] {
  return value === undefined || (typeof value === "string" && LATENT_IMAGE_NODES.has(value));
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
      code: "agent_draft_invalid",
      statusCode: 502,
    });
  }

  const trimmed = value.trim();
  if (trimmed.length > MAX_PROMPT_LENGTH) {
    throw new AgentDraftError(`${field} is too long.`, {
      code: "agent_draft_invalid",
      statusCode: 502,
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
      code: "agent_draft_invalid",
      statusCode: 502,
    });
  }

  return value.trim();
}

function normalizeLoraInput(value: unknown) {
  if (!isRecord(value) || !hasNonEmptyString(value.loraName)) {
    return null;
  }

  if (
    !isOptionalNumberInRange(value.strengthModel, -10, 10) ||
    !isOptionalNumberInRange(value.strengthClip, -10, 10)
  ) {
    return null;
  }

  return {
    loraName: value.loraName.trim(),
    strengthModel: value.strengthModel ?? 0.7,
    strengthClip: value.strengthClip,
  };
}

function normalizePromptWrapper(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    return null;
  }

  if (value.positivePrefix !== undefined && typeof value.positivePrefix !== "string") {
    return null;
  }

  if (value.negativePrefix !== undefined && typeof value.negativePrefix !== "string") {
    return null;
  }

  return {
    ...(typeof value.positivePrefix === "string" ? { positivePrefix: value.positivePrefix } : {}),
    ...(typeof value.negativePrefix === "string" ? { negativePrefix: value.negativePrefix } : {}),
  };
}

function normalizeGenerationDefaults(value: unknown): NormalizedDefaults | null {
  if (value === undefined) {
    return null;
  }

  if (!isRecord(value)) {
    return null;
  }

  const warnings: string[] = [];
  const defaults: AgentGenerationDefaults = {};

  if (value.checkpointName !== undefined) {
    if (!hasNonEmptyString(value.checkpointName)) {
      return null;
    } else {
      defaults.checkpointName = value.checkpointName.trim();
    }
  }

  if (value.loras !== undefined) {
    if (!Array.isArray(value.loras)) {
      return null;
    } else {
      const loras = value.loras.map(normalizeLoraInput);
      if (loras.some((lora) => lora === null)) {
        return null;
      }
      defaults.loras = loras.filter((lora): lora is NonNullable<typeof lora> => lora !== null);
    }
  }

  if (value.negativePrompt !== undefined) {
    if (typeof value.negativePrompt !== "string") {
      return null;
    }
    defaults.negativePrompt = value.negativePrompt.trim();
  }

  if (!isOptionalIntegerInRange(value.width, 16, 16_384) || !isOptionalIntegerInRange(value.height, 16, 16_384)) {
    return null;
  }

  if (
    (typeof value.width === "number" && value.width % 8 !== 0) ||
    (typeof value.height === "number" && value.height % 8 !== 0)
  ) {
    return null;
  }

  if (!isOptionalIntegerInRange(value.steps, 1, 200) || !isOptionalIntegerInRange(value.batchSize, 1, 16)) {
    return null;
  }

  if (
    !isOptionalNumberInRange(value.cfg, 0, 50) ||
    !isOptionalNumberInRange(value.denoise, 0, 1) ||
    (value.samplerName !== undefined && typeof value.samplerName !== "string") ||
    (value.scheduler !== undefined && typeof value.scheduler !== "string") ||
    (value.outputPrefix !== undefined && typeof value.outputPrefix !== "string") ||
    !isOptionalLatentImageNode(value.latentImageNode)
  ) {
    return null;
  }

  const promptWrapper = normalizePromptWrapper(value.promptWrapper);
  if (promptWrapper === null) {
    return null;
  }

  if (typeof value.width === "number") defaults.width = value.width;
  if (typeof value.height === "number") defaults.height = value.height;
  if (typeof value.steps === "number") defaults.steps = value.steps;
  if (typeof value.cfg === "number") defaults.cfg = value.cfg;
  if (typeof value.samplerName === "string") defaults.samplerName = value.samplerName.trim();
  if (typeof value.scheduler === "string") defaults.scheduler = value.scheduler.trim();
  if (typeof value.denoise === "number") defaults.denoise = value.denoise;
  if (typeof value.batchSize === "number") defaults.batchSize = value.batchSize;
  if (typeof value.latentImageNode === "string") defaults.latentImageNode = value.latentImageNode;
  if (typeof value.outputPrefix === "string") defaults.outputPrefix = value.outputPrefix.trim();
  if (promptWrapper) defaults.promptWrapper = promptWrapper;

  if (Object.keys(value).some((key) => key === "seed")) {
    warnings.push("Ignored LLM-suggested seed; seed selection belongs to the confirmed execution step.");
  }

  return {
    defaults,
    warnings,
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

  return {
    ok: true,
    request: {
      userRequest: value.userRequest.trim(),
      nsfw: value.nsfw,
    },
  };
}

function stripJsonFence(content: string) {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1]?.trim() ?? trimmed;
}

function parseLlmDraftContent(content: string) {
  try {
    return JSON.parse(stripJsonFence(content)) as unknown;
  } catch (error) {
    throw new AgentDraftError("The LLM response was not valid Agent draft JSON.", {
      code: "agent_draft_invalid",
      statusCode: 502,
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function findMissingGenerationDefaultFields(defaults: AgentGenerationDefaults): RequiredDraftDefaultKey[] {
  const missingFields: RequiredDraftDefaultKey[] = [];

  if (!hasNonEmptyString(defaults.checkpointName)) missingFields.push("checkpointName");
  if (typeof defaults.width !== "number") missingFields.push("width");
  if (typeof defaults.height !== "number") missingFields.push("height");
  if (typeof defaults.steps !== "number") missingFields.push("steps");
  if (typeof defaults.cfg !== "number") missingFields.push("cfg");
  if (!hasNonEmptyString(defaults.samplerName)) missingFields.push("samplerName");
  if (!hasNonEmptyString(defaults.scheduler)) missingFields.push("scheduler");
  if (typeof defaults.denoise !== "number") missingFields.push("denoise");
  if (typeof defaults.batchSize !== "number") missingFields.push("batchSize");
  if (defaults.latentImageNode === undefined) missingFields.push("latentImageNode");
  if (!hasNonEmptyString(defaults.outputPrefix)) missingFields.push("outputPrefix");

  return missingFields;
}

function normalizeParsedDraft(
  payload: unknown,
): Omit<AgentSingleImageDraftResponse, "draftId" | "status" | "confirmationRequired"> {
  if (!isRecord(payload)) {
    throw new AgentDraftError("The LLM response must be a JSON object.", {
      code: "agent_draft_invalid",
      statusCode: 502,
    });
  }

  const llmDefaults = normalizeGenerationDefaults(payload.comfyUiRequest);
  if (llmDefaults === null) {
    throw new AgentDraftError("The LLM response included invalid generation defaults.", {
      code: "agent_draft_invalid",
      statusCode: 502,
    });
  }

  const missingDefaultFields = findMissingGenerationDefaultFields(llmDefaults.defaults);
  if (missingDefaultFields.length > 0) {
    throw new AgentDraftError("The LLM response must include editable generation defaults.", {
      code: "agent_draft_invalid",
      statusCode: 502,
      details: { missingFields: missingDefaultFields },
    });
  }

  const positivePrompt = normalizePromptText(payload.positivePrompt, "positivePrompt");
  const parsedNegativePrompt = normalizeOptionalPromptText(payload.negativePrompt);
  const negativePrompt = parsedNegativePrompt ?? llmDefaults.defaults.negativePrompt ?? "";
  const title = typeof payload.title === "string" && payload.title.trim() ? payload.title.trim() : undefined;
  const warnings = [...normalizeStringArray(payload.warnings), ...llmDefaults.warnings];
  const comfyUiRequest: AgentSingleImageComfyUiDraftRequest = {
    ...llmDefaults.defaults,
    positivePrompt,
    negativePrompt,
  };

  return {
    title,
    positivePrompt,
    negativePrompt,
    comfyUiRequest,
    warnings: [...new Set(warnings)],
  };
}

export function buildAgentDraftMessages(request: AgentSingleImageDraftRequest): LlmChatMessage[] {
  return [
    {
      role: "system",
      content: [
        "You draft editable single-image prompts for SceneForge.",
        "Return only strict JSON. Do not wrap it in prose.",
        "Required JSON fields: positivePrompt, negativePrompt, comfyUiRequest.",
        "Optional JSON fields: title, warnings.",
        "comfyUiRequest must include checkpointName, width, height, steps, cfg, samplerName, scheduler, denoise, batchSize, latentImageNode, and outputPrefix.",
        "comfyUiRequest may include loras as an array of { loraName, strengthModel, strengthClip } and promptWrapper.",
        "Choose checkpointName and LoRAs as editable draft candidates based on the user's image goal.",
        "Do not include local directory paths, generated image ids, ComfyUI node ids, or seeds.",
        "If a checkpoint or LoRA choice is uncertain, still provide an editable candidate and add a warning to verify local availability.",
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify({
        userRequest: request.userRequest,
        nsfw: request.nsfw ?? false,
      }),
    },
  ];
}

export function resolveAgentDraftModel(request: AgentSingleImageDraftRequest, options: GenerateAgentSingleImageDraftOptions) {
  return request.nsfw === true ? options.nsfwModel || options.defaultModel : options.defaultModel;
}

function mapLiteLlmError(error: LiteLlmError): AgentDraftError {
  const message = error.message;
  if (
    message.includes("LITELLM_BASE_URL") ||
    message.includes("LLM model is required")
  ) {
    return new AgentDraftError(message, {
      code: "llm_config",
      statusCode: error.statusCode ?? 500,
      details: error.details,
    });
  }

  if (message.includes("did not include a chat message") || message.includes("invalid JSON chunk")) {
    return new AgentDraftError(message, {
      code: "llm_malformed_response",
      statusCode: error.statusCode ?? 502,
      details: error.details,
    });
  }

  return new AgentDraftError("LiteLLM draft request failed.", {
    code: "llm_upstream",
    statusCode: error.statusCode ?? 502,
    details: error.details,
  });
}

export async function generateAgentSingleImageDraft(
  rawRequest: unknown,
  options: GenerateAgentSingleImageDraftOptions = {},
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
  const model = resolveAgentDraftModel(request, {
    defaultModel: options.defaultModel ?? process.env.LITELLM_DEFAULT_MODEL,
    nsfwModel: options.nsfwModel ?? process.env.LITELLM_NSFW_MODEL,
  });
  const chatRequest: LlmChatRequest = {
    model,
    nsfw: request.nsfw,
    messages: buildAgentDraftMessages(request),
    temperature: 0.2,
    maxTokens: 1200,
  };

  try {
    const client = createLiteLlmClient({
      baseUrl: options.baseUrl ?? process.env.LITELLM_BASE_URL ?? "",
      apiKey: options.apiKey ?? process.env.LITELLM_API_KEY,
      defaultModel: model,
    });
    const completion = await client.completeChat(chatRequest);
    const draft = normalizeParsedDraft(parseLlmDraftContent(completion.content));

    return {
      draftId: createDraftId(),
      status: "draft",
      ...draft,
      confirmationRequired: true,
    };
  } catch (error) {
    if (error instanceof AgentDraftError) {
      throw error;
    }

    if (error instanceof LiteLlmError) {
      throw mapLiteLlmError(error);
    }

    throw new AgentDraftError("Unexpected Agent draft failure.", {
      code: "agent_unexpected",
      statusCode: 500,
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
