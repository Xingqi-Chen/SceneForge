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

export type LlmJsonSchemaValue =
  | boolean
  | number
  | string
  | null
  | readonly LlmJsonSchemaValue[]
  | { readonly [key: string]: LlmJsonSchemaValue };

export type LlmJsonSchemaResponseFormat = {
  type: "json_schema";
  json_schema: {
    name: string;
    strict: true;
    schema: { [key: string]: LlmJsonSchemaValue };
  };
};

export type LlmGenerationOptions = {
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
    | "single-image-preview-scoring"
    | "single-image-final-review"
    | "single-image-repair-diagnosis"
    | "single-image-repair-verification"
    | "comfyui-generation-diagnosis"
    | "comfyui-inpaint-diagnosis";
  temperature?: number;
  maxTokens?: number;
  responseFormat?: LlmJsonSchemaResponseFormat;
  instructions?: string;
  max_output_tokens?: number;
  text?: { format: LlmResponsesTextFormat };
};

export type LlmResponsesTextFormat =
  | { type: "text" | "json_object" }
  | {
      type: "json_schema";
      name: string;
      schema: { [key: string]: LlmJsonSchemaValue };
      description?: string;
      strict?: boolean;
    };

export type LlmResponsesMessage = {
  type?: "message";
  role: LlmChatRole | "developer";
  content: string | Array<
    | { type: "input_text"; text: string }
    | { type: "input_image"; image_url: string; detail?: "auto" | "low" | "high" }
  >;
};

/** Compatibility input; generation always uses the Responses transport. */
export type LlmChatRequest = LlmGenerationOptions & {
  messages: LlmChatMessage[];
  input?: never;
};

export type LlmResponsesRequest = LlmGenerationOptions & (
  | { input: string | LlmResponsesMessage[]; messages?: never }
  | { messages: LlmChatMessage[]; input?: never }
);

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
