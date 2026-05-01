export type LlmChatRole = "system" | "user" | "assistant";

export type LlmChatMessage = {
  role: LlmChatRole;
  content: string;
};

export type LlmChatRequest = {
  model?: string;
  messages: LlmChatMessage[];
  temperature?: number;
  maxTokens?: number;
};

export type LlmTokenUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export type LlmChatResponse = {
  id?: string;
  model?: string;
  content: string;
  role: LlmChatRole;
  finishReason?: string;
  usage?: LlmTokenUsage;
};

