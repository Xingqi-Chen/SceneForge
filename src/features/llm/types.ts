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
  nsfw?: boolean;
  purpose?:
    | "prompt-library-classification"
    | "scene-prompt-reverse"
    | "prompt-tag-reverse"
    | "stick-figure-pose-generation"
    | "comic-sequence-storyboard"
    | "civitai-resource-enrichment"
    | "civitai-combination-recommendation"
    | "stable-diffusion-prompt-generation"
    | "story-style-reference-analysis"
    | "comfyui-generation-diagnosis"
    | "comfyui-inpaint-diagnosis";
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

export type LlmEmbeddingRequest = {
  input: string | string[];
  model?: string;
};

export type LlmEmbeddingResponse = {
  id?: string;
  model?: string;
  embeddings: number[][];
  usage?: LlmTokenUsage;
};
