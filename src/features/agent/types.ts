import type { ComfyUiLoraInput, ComfyUiTextToImageRequest } from "@/features/comfyui/types";

export type AgentDraftErrorCode =
  | "agent_request_invalid"
  | "agent_draft_invalid"
  | "llm_config"
  | "llm_upstream"
  | "llm_malformed_response"
  | "agent_unexpected";

export type AgentGenerationDefaults = Partial<
  Pick<
    ComfyUiTextToImageRequest,
    | "checkpointName"
    | "negativePrompt"
    | "loras"
    | "width"
    | "height"
    | "steps"
    | "cfg"
    | "samplerName"
    | "scheduler"
    | "denoise"
    | "batchSize"
    | "latentImageNode"
    | "promptWrapper"
    | "outputPrefix"
  >
>;

export type AgentSingleImageDraftRequest = {
  userRequest: string;
  nsfw?: boolean;
};

export type AgentSingleImageComfyUiDraftRequest = AgentGenerationDefaults & {
  positivePrompt: string;
  negativePrompt?: string;
  loras?: ComfyUiLoraInput[];
};

export type AgentSingleImageDraftResponse = {
  draftId: string;
  status: "draft";
  title?: string;
  positivePrompt: string;
  negativePrompt: string;
  comfyUiRequest: AgentSingleImageComfyUiDraftRequest;
  confirmationRequired: true;
  warnings: string[];
};

export type AgentErrorResponse = {
  error: {
    code: AgentDraftErrorCode;
    message: string;
    details?: unknown;
  };
};
