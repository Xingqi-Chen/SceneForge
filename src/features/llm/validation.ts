import type { LlmChatMessage, LlmChatRequest, LlmChatRole } from "./types";

const chatRoles = new Set<LlmChatRole>(["system", "user", "assistant"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isChatMessage(value: unknown): value is LlmChatMessage {
  if (!isRecord(value)) {
    return false;
  }

  return chatRoles.has(value.role as LlmChatRole) && typeof value.content === "string" && value.content.trim().length > 0;
}

function isOptionalNumber(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === "number" && Number.isFinite(value));
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === "string" && value.trim().length > 0);
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
    isOptionalNumber(value.temperature) &&
    isOptionalNumber(value.maxTokens)
  );
}

