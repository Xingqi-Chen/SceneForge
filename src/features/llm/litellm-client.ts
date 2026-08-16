import type {
  LlmChatContent,
  LlmChatMessage,
  LlmChatRequest,
  LlmChatResponse,
  LlmEmbeddingRequest,
  LlmEmbeddingResponse,
  LlmChatRole,
  LlmResponsesRequest,
  LlmTokenUsage,
} from "./types";
import {
  createStructuredOutputErrorDetails,
  getLlmResponsesOutputShapeDiagnostic,
  summarizeLlmResponseFormatForLog,
  type LlmResponsesOutputShapeDiagnostic,
} from "./run-scene-prompt-response-format";

const LOG_TEXT_PREVIEW_MAX = 400;

function truncateForLog(text: string, max = LOG_TEXT_PREVIEW_MAX): string {
  if (text.length <= max) {
    return text;
  }

  return `${text.slice(0, max)}…`;
}

function summarizeContentForLog(content: LlmChatContent): string | Array<Record<string, unknown>> {
  if (typeof content === "string") {
    return truncateForLog(content);
  }

  return content.map((part) => {
    if (part.type === "text") {
      return {
        type: "text",
        length: part.text.length,
        preview: truncateForLog(part.text, 320),
      };
    }

    return {
      type: "image_url",
      detail: part.image_url.detail ?? "auto",
      dataUrlChars: part.image_url.url.length,
    };
  });
}

/** Safe structured summary for logs (no raw image bytes). */
export function summarizeLlmChatRequestForLog(request: LlmChatRequest): Record<string, unknown> {
  const redactContent = request.purpose === "single-image-preview-scoring" ||
    request.purpose === "single-image-final-review" ||
    request.purpose === "single-image-repair-diagnosis" ||
    request.purpose === "single-image-repair-verification";
  return {
    model: request.model ?? "(default)",
    nsfw: request.nsfw,
    temperature: request.temperature,
    maxTokens: request.maxTokens,
    responseFormat: summarizeLlmResponseFormatForLog(request.responseFormat),
    messageCount: request.messages.length,
    messages: request.messages.map((message: LlmChatMessage) => ({
      role: message.role,
      content: redactContent
        ? typeof message.content === "string"
          ? { type: "text", length: message.content.length }
          : message.content.map((part) => part.type === "text"
              ? { type: "text", length: part.text.length }
              : {
                  type: "image_url",
                  detail: part.image_url.detail ?? "auto",
                  dataUrlChars: part.image_url.url.length,
                })
        : summarizeContentForLog(message.content),
    })),
  };
}

type Fetcher = typeof fetch;

type LiteLlmClientOptions = {
  baseUrl: string;
  apiKey?: string;
  defaultModel?: string;
  fetcher?: Fetcher;
};

type LiteLlmErrorOptions = {
  statusCode?: number;
  details?: unknown;
};

type LiteLlmChoice = {
  message?: {
    role?: string;
    content?: string;
  };
  finish_reason?: string;
};

type LiteLlmChatCompletion = {
  id?: string;
  model?: string;
  choices?: LiteLlmChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

type LiteLlmEmbeddingItem = {
  embedding?: unknown;
  index?: number;
};

type LiteLlmEmbeddingPayload = {
  id?: string;
  model?: string;
  data?: LiteLlmEmbeddingItem[];
  usage?: LiteLlmChatCompletion["usage"];
};

type LiteLlmResponsesPayload = {
  id?: string;
  model?: string;
  status?: string;
  output?: unknown;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
};

type LiteLlmStreamChoice = {
  delta?: {
    role?: string;
    content?: string | null;
  };
  message?: {
    role?: string;
    content?: string;
  };
  finish_reason?: string | null;
};

type LiteLlmStreamChunk = {
  id?: string;
  model?: string;
  choices?: LiteLlmStreamChoice[];
  usage?: LiteLlmChatCompletion["usage"];
};

export class LiteLlmError extends Error {
  readonly statusCode?: number;
  readonly details?: unknown;

  constructor(message: string, options: LiteLlmErrorOptions = {}) {
    super(message);
    this.name = "LiteLlmError";
    this.statusCode = options.statusCode;
    this.details = options.details;
  }
}

function normalizeLiteLlmBaseUrl(baseUrl: string) {
  const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");

  if (!normalizedBaseUrl) {
    throw new LiteLlmError("LITELLM_BASE_URL is required before calling the LLM API.", { statusCode: 500 });
  }

  return normalizedBaseUrl.endsWith("/v1") ? normalizedBaseUrl : `${normalizedBaseUrl}/v1`;
}

function isLlmChatRole(value: string | undefined): value is LlmChatRole {
  return value === "system" || value === "user" || value === "assistant";
}

function toTokenUsage(usage: LiteLlmChatCompletion["usage"]): LlmTokenUsage | undefined {
  if (!usage) {
    return undefined;
  }

  return {
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
  };
}

function toResponsesTokenUsage(usage: LiteLlmResponsesPayload["usage"]): LlmTokenUsage | undefined {
  if (!usage) {
    return undefined;
  }

  return {
    promptTokens: usage.input_tokens,
    completionTokens: usage.output_tokens,
    totalTokens: usage.total_tokens,
  };
}

export function summarizeLlmResponsesRequestForLog(
  request: LlmResponsesRequest,
): Record<string, unknown> {
  let textPartCount = 0;
  let imagePartCount = 0;
  let textChars = 0;
  let imageUrlChars = 0;

  for (const message of request.messages) {
    if (typeof message.content === "string") {
      textPartCount += 1;
      textChars += message.content.length;
      continue;
    }

    for (const part of message.content) {
      if (part.type === "text") {
        textPartCount += 1;
        textChars += part.text.length;
      } else {
        imagePartCount += 1;
        imageUrlChars += part.image_url.url.length;
      }
    }
  }

  return {
    callType: "responses",
    purpose: getSafeResponsesLogPurpose(request.purpose),
    messageCount: request.messages.length,
    textPartCount,
    imagePartCount,
    textChars,
    imageUrlChars,
    ...(typeof request.maxTokens === "number" && Number.isFinite(request.maxTokens)
      ? { maxOutputTokens: request.maxTokens }
      : {}),
    structuredOutput: request.responseFormat !== undefined,
  };
}

function getSafeResponsesLogPurpose(purpose: LlmChatRequest["purpose"]) {
  switch (purpose) {
    case "prompt-library-classification":
    case "scene-prompt-reverse":
    case "prompt-tag-reverse":
    case "stick-figure-pose-generation":
    case "comic-sequence-storyboard":
    case "civitai-resource-enrichment":
    case "civitai-combination-recommendation":
    case "stable-diffusion-prompt-generation":
    case "story-style-reference-analysis":
    case "single-image-preview-scoring":
    case "single-image-final-review":
    case "single-image-repair-diagnosis":
    case "single-image-repair-verification":
    case "comfyui-generation-diagnosis":
    case "comfyui-inpaint-diagnosis":
      return purpose;
    default:
      return "unspecified";
  }
}

function getSafeTokenUsageForLog(usage: LlmTokenUsage | undefined) {
  if (!usage) return undefined;

  const promptTokens = typeof usage.promptTokens === "number" && Number.isFinite(usage.promptTokens)
    ? usage.promptTokens
    : undefined;
  const completionTokens = typeof usage.completionTokens === "number" && Number.isFinite(usage.completionTokens)
    ? usage.completionTokens
    : undefined;
  const totalTokens = typeof usage.totalTokens === "number" && Number.isFinite(usage.totalTokens)
    ? usage.totalTokens
    : undefined;

  return {
    ...(promptTokens !== undefined ? { promptTokens } : {}),
    ...(completionTokens !== undefined ? { completionTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
  };
}

export function summarizeLlmResponsesCompletionForLog(
  completion: LlmChatResponse,
): Record<string, unknown> {
  return {
    callType: "responses",
    status: "completed",
    role: completion.role,
    contentChars: completion.content.length,
    finishReason: completion.finishReason === "stop" ? "stop" : completion.finishReason ? "other" : "missing",
    usage: getSafeTokenUsageForLog(completion.usage),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getPayloadKind(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value === "object" ? "object" : typeof value;
}

function getContentTypeKind(contentType: string | null): string {
  if (!contentType) return "missing";
  const normalized = contentType.toLowerCase();
  if (normalized.includes("text/event-stream")) return "text/event-stream";
  if (normalized.includes("json")) return "json";
  if (normalized.includes("text/plain")) return "text/plain";
  return "other";
}

function toResponsesInput(messages: LlmChatMessage[]) {
  return messages.map((message) => ({
    role: message.role,
    content: typeof message.content === "string"
      ? message.content
      : message.content.map((part) => part.type === "text"
          ? {
              type: "input_text" as const,
              text: part.text,
            }
          : {
              type: "input_image" as const,
              image_url: part.image_url.url,
              detail: part.image_url.detail ?? "auto",
            }),
  }));
}

type ResponsesSseFailureReason =
  | "completed_missing_response"
  | "done_before_completed"
  | "event_after_completed"
  | "event_after_done"
  | "event_mismatch"
  | "invalid_json"
  | "missing_body"
  | "missing_completed"
  | "missing_type"
  | "read_failed"
  | "terminal_item_duplicate_index"
  | "terminal_item_invalid"
  | "terminal_item_missing"
  | "terminal_item_multiple"
  | "terminal_failure"
  | "unexpected_field";

const responsesSseFailureReasons = new Set<ResponsesSseFailureReason>([
  "completed_missing_response",
  "done_before_completed",
  "event_after_completed",
  "event_after_done",
  "event_mismatch",
  "invalid_json",
  "missing_body",
  "missing_completed",
  "missing_type",
  "read_failed",
  "terminal_item_duplicate_index",
  "terminal_item_invalid",
  "terminal_item_missing",
  "terminal_item_multiple",
  "terminal_failure",
  "unexpected_field",
]);

function createResponsesSseError(
  message: string,
  reason: ResponsesSseFailureReason,
): LiteLlmError {
  return new LiteLlmError(message, {
    statusCode: 502,
    details: { reason },
  });
}

function getResponsesSseFailureReason(error: unknown): ResponsesSseFailureReason {
  if (
    error instanceof LiteLlmError &&
    isRecord(error.details) &&
    responsesSseFailureReasons.has(error.details.reason as ResponsesSseFailureReason)
  ) {
    return error.details.reason as ResponsesSseFailureReason;
  }

  return "read_failed";
}

export function summarizeLlmResponsesErrorForLog(error: unknown): Record<string, unknown> {
  const rawStatusCode = error instanceof LiteLlmError ? error.statusCode : undefined;
  const statusCode = typeof rawStatusCode === "number" && Number.isInteger(rawStatusCode) &&
      rawStatusCode >= 400 && rawStatusCode <= 599
    ? rawStatusCode
    : undefined;
  const details = error instanceof LiteLlmError && isRecord(error.details)
    ? error.details
    : undefined;
  const upstreamStatus = typeof details?.upstreamStatus === "number" && Number.isInteger(details.upstreamStatus) &&
      details.upstreamStatus >= 400 && details.upstreamStatus <= 599
    ? details.upstreamStatus
    : undefined;
  const outputShape = getLlmResponsesOutputShapeDiagnostic(details);
  const reason = details && responsesSseFailureReasons.has(details.reason as ResponsesSseFailureReason)
    ? details.reason as ResponsesSseFailureReason
    : undefined;

  return {
    callType: "responses",
    status: "failed",
    errorKind: error instanceof LiteLlmError ? "upstream" : "unexpected",
    ...(statusCode !== undefined ? { statusCode } : {}),
    ...(upstreamStatus !== undefined ? { upstreamStatus } : {}),
    ...(outputShape ? { outputShape } : {}),
    ...(reason ? { reason } : {}),
  };
}

type ParsedResponsesSseEvent =
  | { kind: "done" }
  | { kind: "event"; payload: Record<string, unknown> };

function isCanonicalCompletedAssistantMessage(item: unknown): item is Record<string, unknown> {
  if (
    !isRecord(item) ||
    item.type !== "message" ||
    item.role !== "assistant" ||
    item.status !== "completed" ||
    !Array.isArray(item.content) ||
    item.content.length !== 1
  ) {
    return false;
  }

  const [part] = item.content;
  return isRecord(part) &&
    part.type === "output_text" &&
    typeof part.text === "string" &&
    part.text.trim().length > 0;
}

function parseResponsesSseEvent(event: string): ParsedResponsesSseEvent | null {
  const dataLines: string[] = [];
  let eventName: string | undefined;

  for (const line of event.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) {
      continue;
    }

    const separatorIndex = line.indexOf(":");
    const field = separatorIndex === -1 ? line : line.slice(0, separatorIndex);
    const rawValue = separatorIndex === -1 ? "" : line.slice(separatorIndex + 1);
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;

    if (field === "data") {
      dataLines.push(value);
      continue;
    }

    if (field === "event" && eventName === undefined) {
      eventName = value;
      continue;
    }

    if (field === "id" || field === "retry") {
      continue;
    }

    throw createResponsesSseError(
      "LiteLLM Responses event stream was malformed.",
      "unexpected_field",
    );
  }

  if (dataLines.length === 0) {
    return null;
  }

  const eventData = dataLines.join("\n");
  if (eventData.trim() === "[DONE]") {
    if (eventName !== undefined && eventName !== "message") {
      throw createResponsesSseError(
        "LiteLLM Responses event stream was malformed.",
        "event_mismatch",
      );
    }
    return { kind: "done" };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(eventData) as unknown;
  } catch {
    throw createResponsesSseError(
      "LiteLLM Responses event stream was malformed.",
      "invalid_json",
    );
  }

  if (!isRecord(payload) || typeof payload.type !== "string") {
    throw createResponsesSseError(
      "LiteLLM Responses event stream was malformed.",
      "missing_type",
    );
  }

  if (eventName !== undefined && eventName !== "message" && eventName !== payload.type) {
    throw createResponsesSseError(
      "LiteLLM Responses event stream was malformed.",
      "event_mismatch",
    );
  }

  return { kind: "event", payload };
}

async function parseResponsesSseResponse(response: Response): Promise<Record<string, unknown>> {
  if (!response.body) {
    throw createResponsesSseError(
      "LiteLLM Responses event stream did not include a response body.",
      "missing_body",
    );
  }

  const streamText = await response.text();
  const events = streamText.split(/\r?\n\r?\n/);
  let completedResponse: Record<string, unknown> | undefined;
  const terminalAssistantMessages = new Map<number, Record<string, unknown>>();
  let invalidTerminalAssistantMessage = false;
  let duplicateTerminalAssistantIndex = false;
  let sawDone = false;

  for (const event of events) {
    if (!event.trim()) {
      continue;
    }

    const parsedEvent = parseResponsesSseEvent(event);
    if (!parsedEvent) {
      continue;
    }

    if (sawDone) {
      throw createResponsesSseError(
        "LiteLLM Responses event stream continued after its terminator.",
        "event_after_done",
      );
    }

    if (parsedEvent.kind === "done") {
      if (!completedResponse) {
        throw createResponsesSseError(
          "LiteLLM Responses event stream ended before completion.",
          "done_before_completed",
        );
      }
      sawDone = true;
      continue;
    }

    const payload = parsedEvent.payload;
    const eventType = payload.type as string;
    if (completedResponse) {
      throw createResponsesSseError(
        "LiteLLM Responses event stream continued after completion.",
        "event_after_completed",
      );
    }

    if (
      eventType === "response.failed" ||
      eventType === "response.incomplete" ||
      eventType === "response.error" ||
      eventType === "error"
    ) {
      throw createResponsesSseError(
        "LiteLLM Responses request did not complete successfully.",
        "terminal_failure",
      );
    }

    if (eventType === "response.completed") {
      if (!isRecord(payload.response)) {
        throw createResponsesSseError(
          "LiteLLM Responses completion event was malformed.",
          "completed_missing_response",
        );
      }
      completedResponse = payload.response;
      continue;
    }

    if (eventType === "response.output_item.done") {
      const item = payload.item;
      if (!isRecord(item) || item.type !== "message") {
        continue;
      }

      if (
        !Number.isInteger(payload.output_index) ||
        (payload.output_index as number) < 0 ||
        !isCanonicalCompletedAssistantMessage(item)
      ) {
        invalidTerminalAssistantMessage = true;
        continue;
      }

      const outputIndex = payload.output_index as number;
      if (terminalAssistantMessages.has(outputIndex)) {
        duplicateTerminalAssistantIndex = true;
        continue;
      }
      terminalAssistantMessages.set(outputIndex, item);
      continue;
    }

    if (!eventType.startsWith("response.")) {
      throw createResponsesSseError(
        "LiteLLM Responses event stream was malformed.",
        "missing_type",
      );
    }
  }

  if (!completedResponse) {
    throw createResponsesSseError(
      "LiteLLM Responses event stream did not include a completed response.",
      "missing_completed",
    );
  }

  if (
    completedResponse.status !== "completed" ||
    !Array.isArray(completedResponse.output) ||
    completedResponse.output.length > 0
  ) {
    return completedResponse;
  }

  if (invalidTerminalAssistantMessage) {
    throw createResponsesSseError(
      "LiteLLM Responses event stream included a malformed terminal assistant message.",
      "terminal_item_invalid",
    );
  }

  if (duplicateTerminalAssistantIndex) {
    throw createResponsesSseError(
      "LiteLLM Responses event stream repeated a terminal assistant message index.",
      "terminal_item_duplicate_index",
    );
  }

  if (terminalAssistantMessages.size === 0) {
    throw createResponsesSseError(
      "LiteLLM Responses event stream omitted its terminal assistant message.",
      "terminal_item_missing",
    );
  }

  if (terminalAssistantMessages.size !== 1) {
    throw createResponsesSseError(
      "LiteLLM Responses event stream included ambiguous terminal assistant messages.",
      "terminal_item_multiple",
    );
  }

  return {
    ...completedResponse,
    output: [...terminalAssistantMessages.values()],
  };
}

function normalizeLiteLlmResponse(payload: unknown): LlmChatResponse {
  if (!isRecord(payload)) {
    throw new LiteLlmError("LiteLLM Responses output was malformed.", {
      statusCode: 502,
      details: { outputShape: "response_not_object" satisfies LlmResponsesOutputShapeDiagnostic },
    });
  }

  const response = payload as LiteLlmResponsesPayload;
  if (response.status !== "completed") {
    throw new LiteLlmError("LiteLLM Responses request did not complete with usable output.", {
      statusCode: 502,
      details: { outputShape: "response_noncompleted" satisfies LlmResponsesOutputShapeDiagnostic },
    });
  }

  if (!Array.isArray(response.output)) {
    throw new LiteLlmError("LiteLLM Responses request did not complete with usable output.", {
      statusCode: 502,
      details: { outputShape: "no_output_array" satisfies LlmResponsesOutputShapeDiagnostic },
    });
  }

  let content: string | undefined;
  let assistantMessageCount = 0;
  let hasAssistantMessage = false;
  let hasCompletedMessage = false;
  let hasMessageContent = false;
  let hasMessageItem = false;
  let refused = false;

  for (const item of response.output) {
    if (!isRecord(item) || item.type !== "message") {
      continue;
    }
    hasMessageItem = true;

    if (item.status !== "completed") {
      continue;
    }
    hasCompletedMessage = true;

    if (item.role !== "assistant") {
      continue;
    }
    hasAssistantMessage = true;
    assistantMessageCount += 1;

    if (!Array.isArray(item.content)) {
      continue;
    }
    hasMessageContent = true;

    if (item.content.some((part) => isRecord(part) && part.type === "refusal")) {
      refused = true;
      continue;
    }

    const validOutputTextParts = item.content.filter((part) => (
      isRecord(part) &&
      part.type === "output_text" &&
      typeof part.text === "string" &&
      part.text.trim().length > 0
    ));

    if (validOutputTextParts.length > 1) {
      throw new LiteLlmError("LiteLLM Responses output included multiple completed assistant text parts.", {
        statusCode: 502,
        details: { outputShape: "multiple_output_text" satisfies LlmResponsesOutputShapeDiagnostic },
      });
    }

    if (item.content.length !== 1) {
      throw new LiteLlmError("LiteLLM Responses output included invalid assistant message content.", {
        statusCode: 502,
        details: { outputShape: "message_content_invalid" satisfies LlmResponsesOutputShapeDiagnostic },
      });
    }

    const [part] = item.content;
    if (
      isRecord(part) &&
      part.type === "output_text" &&
      typeof part.text === "string" &&
      part.text.trim().length > 0
    ) {
      content = part.text;
    }
  }

  if (refused) {
    throw new LiteLlmError("LiteLLM Responses request was refused.", {
      statusCode: 502,
      details: { outputShape: "refusal" satisfies LlmResponsesOutputShapeDiagnostic },
    });
  }

  if (assistantMessageCount > 1) {
    throw new LiteLlmError("LiteLLM Responses output included multiple completed assistant messages.", {
      statusCode: 502,
      details: { outputShape: "multiple_assistant_messages" satisfies LlmResponsesOutputShapeDiagnostic },
    });
  }

  if (!content?.trim()) {
    const outputShape: LlmResponsesOutputShapeDiagnostic = !hasMessageItem
      ? "no_message_item"
      : !hasCompletedMessage
        ? "message_noncompleted"
        : !hasAssistantMessage
          ? "no_assistant_role"
          : !hasMessageContent
            ? "message_content_missing"
            : "no_output_text";
    throw new LiteLlmError("LiteLLM Responses output did not include completed assistant text.", {
      statusCode: 502,
      details: { outputShape },
    });
  }

  return {
    id: typeof response.id === "string" ? response.id : undefined,
    model: typeof response.model === "string" ? response.model : undefined,
    content,
    role: "assistant",
    finishReason: "stop",
    usage: toResponsesTokenUsage(response.usage),
  };
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type");

  if (contentType?.includes("application/json")) {
    return response.json();
  }

  return response.text();
}

function normalizeLiteLlmCompletion(payload: unknown): LlmChatResponse {
  const completion = payload as LiteLlmChatCompletion;
  const firstChoice = completion.choices?.[0];
  const content = firstChoice?.message?.content;

  if (typeof content !== "string") {
    console.info("[SceneForge] [llm] inbound LiteLLM malformed completion", {
      id: completion.id,
      model: completion.model,
    });
    throw new LiteLlmError("LiteLLM response did not include a chat message.", {
      statusCode: 502,
      details: payload,
    });
  }

  const role = isLlmChatRole(firstChoice?.message?.role) ? firstChoice.message.role : "assistant";

  return {
    id: completion.id,
    model: completion.model,
    content,
    role,
    finishReason: firstChoice?.finish_reason,
    usage: toTokenUsage(completion.usage),
  };
}

function normalizeEmbedding(value: unknown): number[] {
  if (!Array.isArray(value)) {
    throw new LiteLlmError("LiteLLM embedding response included a malformed vector.", {
      statusCode: 502,
      details: value,
    });
  }

  const embedding = value.map((entry) => (typeof entry === "number" && Number.isFinite(entry) ? entry : null));
  if (embedding.some((entry) => entry === null)) {
    throw new LiteLlmError("LiteLLM embedding response included a non-finite vector value.", {
      statusCode: 502,
    });
  }

  return embedding as number[];
}

function normalizeLiteLlmEmbedding(payload: unknown): LlmEmbeddingResponse {
  const response = payload as LiteLlmEmbeddingPayload;
  const data = Array.isArray(response.data) ? response.data : null;

  if (!data || data.length === 0) {
    throw new LiteLlmError("LiteLLM response did not include embeddings.", {
      statusCode: 502,
      details: payload,
    });
  }

  return {
    id: response.id,
    model: response.model,
    embeddings: data
      .slice()
      .sort((left, right) => (left.index ?? 0) - (right.index ?? 0))
      .map((entry) => normalizeEmbedding(entry.embedding)),
    usage: toTokenUsage(response.usage),
  };
}

function applyStreamChunk(
  chunk: LiteLlmStreamChunk,
  current: {
    content: string;
    finishReason?: string;
    id?: string;
    model?: string;
    role: LlmChatRole;
    usage?: LlmTokenUsage;
  },
) {
  const firstChoice = chunk.choices?.[0];
  const deltaRole = firstChoice?.delta?.role ?? firstChoice?.message?.role;
  const deltaContent = firstChoice?.delta?.content ?? firstChoice?.message?.content;

  if (chunk.id) {
    current.id = chunk.id;
  }

  if (chunk.model) {
    current.model = chunk.model;
  }

  if (isLlmChatRole(deltaRole)) {
    current.role = deltaRole;
  }

  if (typeof deltaContent === "string") {
    current.content += deltaContent;
  }

  if (typeof firstChoice?.finish_reason === "string") {
    current.finishReason = firstChoice.finish_reason;
  }

  current.usage = toTokenUsage(chunk.usage) ?? current.usage;
}

function processSseEvent(
  event: string,
  current: {
    content: string;
    finishReason?: string;
    id?: string;
    model?: string;
    role: LlmChatRole;
    usage?: LlmTokenUsage;
  },
) {
  const dataLines = event
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.replace(/^data:\s?/, "").trim())
    .filter(Boolean);

  for (const data of dataLines) {
    if (data === "[DONE]") {
      continue;
    }

    try {
      applyStreamChunk(JSON.parse(data) as LiteLlmStreamChunk, current);
    } catch (error) {
      throw new LiteLlmError("LiteLLM stream included an invalid JSON chunk.", {
        statusCode: 502,
        details: {
          chunk: data,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }
}

async function parseStreamResponse(response: Response): Promise<LlmChatResponse> {
  if (!response.body) {
    throw new LiteLlmError("LiteLLM streaming response did not include a response body.", { statusCode: 502 });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const current: {
    content: string;
    finishReason?: string;
    id?: string;
    model?: string;
    role: LlmChatRole;
    usage?: LlmTokenUsage;
  } = {
    content: "",
    role: "assistant",
  };
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() ?? "";

    for (const event of events) {
      processSseEvent(event, current);
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    processSseEvent(buffer, current);
  }

  if (!current.content && !current.id) {
    throw new LiteLlmError("LiteLLM stream did not include a chat message.", {
      statusCode: 502,
    });
  }

  return current;
}

export function createLiteLlmClient(options: LiteLlmClientOptions) {
  const baseUrl = normalizeLiteLlmBaseUrl(options.baseUrl);
  const fetcher = options.fetcher ?? fetch;

  return {
    async completeResponse(request: LlmResponsesRequest): Promise<LlmChatResponse> {
      const model = request.model ?? options.defaultModel;

      if (!model) {
        throw new LiteLlmError("LLM model is required. Pass model in the request or set LITELLM_DEFAULT_MODEL.", {
          statusCode: 400,
        });
      }

      console.info(
        "[SceneForge] [llm] outbound LiteLLM Responses request",
        summarizeLlmResponsesRequestForLog(request),
      );

      let response: Response;
      try {
        response = await fetcher(`${baseUrl}/responses`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
          },
          body: JSON.stringify({
            model,
            input: toResponsesInput(request.messages),
            temperature: request.temperature,
            max_output_tokens: request.maxTokens,
            ...(request.responseFormat
              ? {
                  text: {
                    format: {
                      type: request.responseFormat.type,
                      name: request.responseFormat.json_schema.name,
                      strict: request.responseFormat.json_schema.strict,
                      schema: request.responseFormat.json_schema.schema,
                    },
                  },
                }
              : {}),
            stream: false,
            store: false,
          }),
        });
      } catch {
        throw new LiteLlmError("LiteLLM Responses request failed.", {
          statusCode: 502,
          details: request.responseFormat
            ? createStructuredOutputErrorDetails(request.responseFormat, 502)
            : { upstreamStatus: 502 },
        });
      }

      const contentTypeKind = getContentTypeKind(response.headers.get("content-type"));
      let payload: unknown;
      try {
        if (contentTypeKind === "text/event-stream") {
          if (!response.ok) {
            throw new LiteLlmError("LiteLLM Responses request failed.", {
              statusCode: response.status,
            });
          }
          payload = await parseResponsesSseResponse(response);
        } else if (contentTypeKind === "json") {
          payload = await response.json();
        } else {
          const textPayload = await response.text();
          payload = JSON.parse(textPayload) as unknown;
        }
      } catch (error) {
        console.info("[SceneForge] [llm] inbound LiteLLM Responses shape rejected", {
          contentType: contentTypeKind,
          payloadKind: contentTypeKind === "text/event-stream"
            ? "responses-event-stream"
            : contentTypeKind === "json"
              ? "unparsed"
              : "string",
          ...(contentTypeKind === "text/event-stream"
            ? { reason: getResponsesSseFailureReason(error) }
            : {}),
        });
        throw new LiteLlmError(
          error instanceof LiteLlmError
            ? error.message
            : "LiteLLM Responses request returned malformed data.",
          {
            statusCode: error instanceof LiteLlmError
              ? error.statusCode
              : response.ok
                ? 502
                : response.status,
            details: request.responseFormat
              ? createStructuredOutputErrorDetails(
                  request.responseFormat,
                  response.ok ? 502 : response.status,
                )
              : { upstreamStatus: response.ok ? 502 : response.status },
          },
        );
      }
      if (!response.ok) {
        console.info("[SceneForge] [llm] inbound LiteLLM Responses error", {
          httpStatus: response.status,
          detailsType: typeof payload,
        });
        throw new LiteLlmError("LiteLLM Responses request failed.", {
          statusCode: response.status,
          details: request.responseFormat
            ? createStructuredOutputErrorDetails(request.responseFormat, response.status)
            : { upstreamStatus: response.status },
        });
      }

      let completion: LlmChatResponse;
      try {
        completion = normalizeLiteLlmResponse(payload);
      } catch (error) {
        if (error instanceof LiteLlmError) {
          const outputShape = getLlmResponsesOutputShapeDiagnostic(error.details);
          console.info("[SceneForge] [llm] inbound LiteLLM Responses shape rejected", {
            contentType: contentTypeKind,
            payloadKind: getPayloadKind(payload),
            ...(outputShape ? { outputShape } : {}),
          });
          throw new LiteLlmError(error.message, {
            statusCode: error.statusCode,
            details: request.responseFormat
              ? createStructuredOutputErrorDetails(
                  request.responseFormat,
                  error.statusCode,
                  outputShape,
                )
              : {
                  upstreamStatus: error.statusCode ?? 502,
                  ...(outputShape ? { outputShape } : {}),
                },
          });
        }
        throw error;
      }

      console.info(
        "[SceneForge] [llm] inbound LiteLLM Responses completion",
        summarizeLlmResponsesCompletionForLog(completion),
      );

      return completion;
    },

    async completeChat(request: LlmChatRequest): Promise<LlmChatResponse> {
      const model = request.model ?? options.defaultModel;

      if (!model) {
        throw new LiteLlmError("LLM model is required. Pass model in the request or set LITELLM_DEFAULT_MODEL.", {
          statusCode: 400,
        });
      }

      console.info("[SceneForge] [llm] outbound LiteLLM chat completion", {
        ...summarizeLlmChatRequestForLog(request),
        resolvedModel: model,
      });

      const response = await fetcher(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model,
          messages: request.messages,
          temperature: request.temperature,
          max_tokens: request.maxTokens,
          ...(request.responseFormat ? { response_format: request.responseFormat } : {}),
          stream: true,
        }),
      });

      const contentType = response.headers.get("content-type");
      const payload = response.ok && contentType?.includes("text/event-stream")
        ? null
        : await parseJsonResponse(response);

      if (!response.ok) {
        console.info("[SceneForge] [llm] inbound LiteLLM error response", {
          httpStatus: response.status,
          detailsType: typeof payload,
        });
        throw new LiteLlmError("LiteLLM chat completion request failed.", {
          statusCode: response.status,
          details: request.responseFormat
            ? createStructuredOutputErrorDetails(request.responseFormat, response.status)
            : payload,
        });
      }

      const completion = contentType?.includes("text/event-stream")
        ? await parseStreamResponse(response)
        : normalizeLiteLlmCompletion(payload);

      console.info("[SceneForge] [llm] inbound LiteLLM chat completion", {
        id: completion.id,
        model: completion.model,
        role: completion.role,
        contentChars: completion.content.length,
        ...(request.purpose === "single-image-preview-scoring" || request.purpose === "single-image-final-review" ||
          request.purpose === "single-image-repair-diagnosis" ||
          request.purpose === "single-image-repair-verification"
          ? { contentRedacted: true }
          : { contentPreview: truncateForLog(completion.content, 280) }),
        finishReason: completion.finishReason,
        usage: completion.usage,
      });

      return completion;
    },

    async createEmbedding(request: LlmEmbeddingRequest): Promise<LlmEmbeddingResponse> {
      const model = request.model ?? options.defaultModel;

      if (!model) {
        throw new LiteLlmError(
          "Embedding model is required. Pass model in the request or set LITELLM_CIVITAI_EMBEDDING_MODEL.",
          { statusCode: 400 },
        );
      }

      const inputCount = Array.isArray(request.input) ? request.input.length : 1;
      console.info("[SceneForge] [llm] outbound LiteLLM embedding request", {
        model,
        inputCount,
      });

      const response = await fetcher(`${baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model,
          input: request.input,
        }),
      });
      const payload = await parseJsonResponse(response);

      if (!response.ok) {
        console.info("[SceneForge] [llm] inbound LiteLLM embedding error response", {
          httpStatus: response.status,
          detailsType: typeof payload,
        });
        throw new LiteLlmError("LiteLLM embedding request failed.", {
          statusCode: response.status,
          details: payload,
        });
      }

      const embedding = normalizeLiteLlmEmbedding(payload);
      console.info("[SceneForge] [llm] inbound LiteLLM embedding response", {
        id: embedding.id,
        model: embedding.model,
        embeddingCount: embedding.embeddings.length,
        dimensions: embedding.embeddings[0]?.length ?? 0,
        usage: embedding.usage,
      });

      return embedding;
    },
  };
}
