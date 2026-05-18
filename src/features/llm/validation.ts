import type {
  LlmChatContent,
  LlmChatMessage,
  LlmChatRequest,
  LlmChatRole,
  LlmImageContentPart,
  LlmTextContentPart,
} from "./types";

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

function isOptionalPurpose(value: unknown): value is LlmChatRequest["purpose"] {
  return (
    value === undefined ||
    value === "prompt-library-classification" ||
    value === "stick-figure-pose-generation" ||
    value === "civitai-resource-enrichment"
  );
}

export function isLlmChatRequest(value: unknown): value is LlmChatRequest {
  if (!isRecord(value)) {
    return false;
  }

  return (
    Array.isArray(value.messages) &&
    value.messages.length > 0 &&
    value.messages.every(isChatMessage) &&
    isOptionalString(value.model) &&
    isOptionalPurpose(value.purpose) &&
    isOptionalNumber(value.temperature) &&
    isOptionalNumber(value.maxTokens)
  );
}
