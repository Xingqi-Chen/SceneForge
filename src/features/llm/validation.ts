import type {
  LlmChatContent,
  LlmChatMessage,
  LlmChatRequest,
  LlmChatRole,
  LlmImageContentPart,
  LlmResponsesRequest,
  LlmResponsesMessage,
  LlmResponsesTextFormat,
  LlmTextContentPart,
} from "./types";
import { isAuthorizedRunScenePromptResponseFormat } from "./run-scene-prompt-response-format";

const chatRoles = new Set<LlmChatRole>(["system", "user", "assistant"]);
const imageDetails = new Set<NonNullable<LlmImageContentPart["image_url"]["detail"]>>([
  "auto",
  "low",
  "high",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTextContentPart(value: unknown): value is LlmTextContentPart {
  return isRecord(value) && value.type === "text" && typeof value.text === "string" && value.text.trim().length > 0;
}

function isImageContentPart(value: unknown): value is LlmImageContentPart {
  if (!isRecord(value) || value.type !== "image_url" || !isRecord(value.image_url)) {
    return false;
  }

  const { url, detail } = value.image_url;

  return (
    typeof url === "string" &&
    url.startsWith("data:image/") &&
    (detail === undefined || imageDetails.has(detail as NonNullable<LlmImageContentPart["image_url"]["detail"]>))
  );
}

function isChatContent(value: unknown): value is LlmChatContent {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  return Array.isArray(value) && value.length > 0 && value.every((part) => isTextContentPart(part) || isImageContentPart(part));
}

function isChatMessage(value: unknown): value is LlmChatMessage {
  if (!isRecord(value)) {
    return false;
  }

  return chatRoles.has(value.role as LlmChatRole) && isChatContent(value.content);
}

function isOptionalNumber(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === "number" && Number.isFinite(value));
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === "string" && value.trim().length > 0);
}

function isOptionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === "boolean";
}

function isOptionalPurpose(value: unknown): value is LlmChatRequest["purpose"] {
  return (
    value === undefined ||
    value === "prompt-library-classification" ||
    value === "scene-prompt-reverse" ||
    value === "prompt-tag-reverse" ||
    value === "stick-figure-pose-generation" ||
    value === "comic-sequence-storyboard" ||
    value === "civitai-resource-enrichment" ||
    value === "civitai-combination-recommendation" ||
    value === "stable-diffusion-prompt-generation" ||
    value === "story-style-reference-analysis" ||
    value === "single-image-preview-scoring" ||
    value === "single-image-final-review" ||
    value === "single-image-repair-diagnosis" ||
    value === "single-image-repair-verification" ||
    value === "comfyui-generation-diagnosis" ||
    value === "comfyui-inpaint-diagnosis"
  );
}

function isAuthorizedResponseFormat(
  value: unknown,
  purpose: LlmChatRequest["purpose"],
): value is LlmChatRequest["responseFormat"] {
  if (value === undefined) return true;
  return purpose === "stable-diffusion-prompt-generation" &&
    isAuthorizedRunScenePromptResponseFormat(value);
}

function hasValidCommonOptions(value: Record<string, unknown>, authorizeLegacyFormat: boolean) {
  return isOptionalString(value.model) &&
    isOptionalBoolean(value.nsfw) &&
    isOptionalPurpose(value.purpose) &&
    isOptionalNumber(value.temperature) &&
    isOptionalNumber(value.maxTokens) &&
    (value.max_output_tokens === undefined || (
      typeof value.max_output_tokens === "number" && Number.isInteger(value.max_output_tokens) &&
      value.max_output_tokens > 0
    )) &&
    (value.instructions === undefined || typeof value.instructions === "string") &&
    !(value.maxTokens !== undefined && value.max_output_tokens !== undefined) &&
    !(value.responseFormat !== undefined && value.text !== undefined) &&
    (authorizeLegacyFormat
      ? isAuthorizedResponseFormat(value.responseFormat, value.purpose as LlmChatRequest["purpose"])
      : value.responseFormat === undefined || (
          isRecord(value.responseFormat) && value.responseFormat.type === "json_schema" &&
          isRecord(value.responseFormat.json_schema) &&
          isLlmResponsesTextFormat({ ...value.responseFormat.json_schema, type: "json_schema" })
        )) &&
    (value.text === undefined || (isRecord(value.text) && isLlmResponsesTextFormat(value.text.format)));
}

// JSON schemas stay data: reject functions, non-finite numbers, cycles, and excessive nesting.
function isJsonValue(value: unknown, ancestors = new Set<object>(), depth = 0): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || depth > 64 || ancestors.has(value)) return false;
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    return false;
  }
  const nextAncestors = new Set(ancestors).add(value);
  return Object.values(value).every((entry) => isJsonValue(entry, nextAncestors, depth + 1));
}

export function isLlmResponsesTextFormat(value: unknown): value is LlmResponsesTextFormat {
  if (!isRecord(value)) return false;
  if (value.type === "text" || value.type === "json_object") return true;
  return value.type === "json_schema" && typeof value.name === "string" &&
    /^[a-zA-Z0-9_-]{1,64}$/.test(value.name) &&
    isRecord(value.schema) && isJsonValue(value.schema) &&
    (value.description === undefined || typeof value.description === "string") &&
    isOptionalBoolean(value.strict);
}

function isNativeImageUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.startsWith("data:image/")) return true;
  if (!/^https?:\/\//i.test(value) || value.trim() !== value) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname.length > 0;
  } catch {
    return false;
  }
}

function isResponsesMessage(value: unknown): value is LlmResponsesMessage {
  if (!isRecord(value) || (value.type !== undefined && value.type !== "message")) return false;
  if (value.role !== "developer" && !chatRoles.has(value.role as LlmChatRole)) return false;
  if (typeof value.content === "string") return value.content.trim().length > 0;
  return Array.isArray(value.content) && value.content.length > 0 && value.content.every((part) => {
    if (!isRecord(part)) return false;
    if (part.type === "input_text") return typeof part.text === "string" && part.text.trim().length > 0;
    return part.type === "input_image" && isNativeImageUrl(part.image_url) &&
      (part.detail === undefined || imageDetails.has(part.detail as NonNullable<LlmImageContentPart["image_url"]["detail"]>));
  });
}

/** The API keeps the legacy schema whitelist; trusted server callers can use their own schemas. */
export function isLlmResponsesRequest(value: unknown, authorizeLegacyFormat = true): value is LlmResponsesRequest {
  if (!isRecord(value)) {
    return false;
  }

  if (!hasValidCommonOptions(value, authorizeLegacyFormat)) return false;
  if (value.input !== undefined) {
    if (value.messages !== undefined) return false;
    return typeof value.input === "string"
      ? value.input.trim().length > 0
      : Array.isArray(value.input) && value.input.length > 0 && value.input.every(isResponsesMessage);
  }
  return Array.isArray(value.messages) && value.messages.length > 0 && value.messages.every(isChatMessage);
}

export function isLlmChatRequest(value: unknown): value is LlmChatRequest {
  return isRecord(value) && value.input === undefined && isLlmResponsesRequest(value);
}
