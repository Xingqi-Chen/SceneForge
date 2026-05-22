export type LlmChatRole = "system" | "user" | "assistant";

export type LlmTextContentPart = {
  type: "text";
  text: string;
};

export type LlmImageContentPart = {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "auto" | "low" | "high";
  };
};

export type LlmChatContent = string | Array<LlmTextContentPart | LlmImageContentPart>;

export type LlmChatMessage = {
  role: LlmChatRole;
  content: LlmChatContent;
};

export type LlmChatRequest = {
  model?: string;
  purpose?:
    | "prompt-library-classification"
    | "stick-figure-pose-generation"
    | "civitai-resource-enrichment"
    | "civitai-combination-recommendation"
    | "stable-diffusion-prompt-generation";
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
