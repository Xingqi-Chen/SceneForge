import type { LlmChatResponse } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isLlmChatResponse(value: unknown): value is LlmChatResponse {
  return isRecord(value) && typeof value.content === "string";
}

export function getLlmProxyErrorMessage(value: unknown) {
  if (isRecord(value) && isRecord(value.error) && typeof value.error.message === "string") {
    return value.error.message;
  }

  return "AI 请求失败，请检查 LiteLLM 配置或稍后重试。";
}
