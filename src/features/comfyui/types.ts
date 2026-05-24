import type {
  ComfyUiFaceDetailerSamDetectionHint,
  ComfyUiFaceDetailerSamMaskHintUseNegative,
} from "./face-detailer";
import type { ComfyUiLatentImageNode } from "./latent-image-node";

export type ComfyUiNodeConnection = [nodeId: string, outputIndex: number];

export type ComfyUiInputValue =
  | string
  | number
  | boolean
  | null
  | ComfyUiNodeConnection
  | ComfyUiInputValue[]
  | { [key: string]: ComfyUiInputValue };

export type ComfyUiNodeInputs = Record<string, ComfyUiInputValue>;

export type ComfyUiWorkflowNode = {
  class_type: string;
  inputs: ComfyUiNodeInputs;
  _meta?: {
    title?: string;
  };
};

export type ComfyUiWorkflow = Record<string, ComfyUiWorkflowNode>;

export type ComfyUiTextToImageRequest = {
  checkpointName: string;
  positivePrompt: string;
  negativePrompt?: string;
  loras?: ComfyUiLoraInput[];
  width?: number;
  height?: number;
  seed?: number;
  steps?: number;
  cfg?: number;
  samplerName?: string;
  scheduler?: string;
  denoise?: number;
  batchSize?: number;
  latentImageNode?: ComfyUiLatentImageNode;
  promptWrapper?: ComfyUiPromptWrapper;
  outputPrefix?: string;
  faceDetailer?: ComfyUiFaceDetailerConfig;
};

export type ComfyUiPromptWrapper = {
  positivePrefix?: string;
  negativePrefix?: string;
};

export type ComfyUiFaceDetailerConfig = {
  bboxCropFactor?: number;
  bboxDilation?: number;
  bboxThreshold?: number;
  cfg?: number;
  cycle?: number;
  denoise?: number;
  enabled?: boolean;
  detectorModelName?: string;
  dropSize?: number;
  feather?: number;
  forceInpaint?: boolean;
  guideSize?: number;
  guideSizeFor?: boolean;
  maxSize?: number;
  noiseMask?: boolean;
  samBBoxExpansion?: number;
  samDetectionHint?: ComfyUiFaceDetailerSamDetectionHint;
  samDilation?: number;
  samMaskHintThreshold?: number;
  samMaskHintUseNegative?: ComfyUiFaceDetailerSamMaskHintUseNegative;
  samThreshold?: number;
  samplerName?: string;
  scheduler?: string;
  steps?: number;
  wildcard?: string;
};

export type ComfyUiLoraInput = {
  loraName: string;
  strengthModel: number;
  strengthClip?: number;
};

export type ResolvedComfyUiLoraInput = {
  loraName: string;
  strengthModel: number;
  strengthClip: number;
};

export type ResolvedComfyUiTextToImageRequest = {
  checkpointName: string;
  positivePrompt: string;
  negativePrompt: string;
  loras: ResolvedComfyUiLoraInput[];
  width: number;
  height: number;
  seed: number;
  steps: number;
  cfg: number;
  samplerName: string;
  scheduler: string;
  denoise: number;
  batchSize: number;
  latentImageNode: ComfyUiLatentImageNode;
  promptWrapper: ResolvedComfyUiPromptWrapper;
  outputPrefix: string;
  faceDetailer: ResolvedComfyUiFaceDetailerConfig;
};

export type ResolvedComfyUiPromptWrapper = {
  positivePrefix: string;
  negativePrefix: string;
};

export type ResolvedComfyUiFaceDetailerConfig = {
  bboxCropFactor: number;
  bboxDilation: number;
  bboxThreshold: number;
  cfg: number;
  cycle: number;
  denoise: number;
  enabled: boolean;
  detectorModelName: string;
  dropSize: number;
  feather: number;
  forceInpaint: boolean;
  guideSize: number;
  guideSizeFor: boolean;
  maxSize: number;
  noiseMask: boolean;
  samBBoxExpansion: number;
  samDetectionHint: ComfyUiFaceDetailerSamDetectionHint;
  samDilation: number;
  samMaskHintThreshold: number;
  samMaskHintUseNegative: ComfyUiFaceDetailerSamMaskHintUseNegative;
  samThreshold: number;
  samplerName: string;
  scheduler: string;
  steps: number;
  wildcard: string;
};

export type BasicTextToImageNodeIds = {
  checkpoint: string;
  loraLoaders: string[];
  positivePrompt: string;
  negativePrompt: string;
  latentImage: string;
  sampler: string;
  vaeDecode: string;
  ultralyticsDetectorProvider?: string;
  faceDetailer?: string;
  saveImage: string;
};

export type BasicTextToImageWorkflow = {
  workflow: ComfyUiWorkflow;
  nodeIds: BasicTextToImageNodeIds;
  outputNodeId: string;
  request: ResolvedComfyUiTextToImageRequest;
};

export type ComfyUiQueuePromptOptions = {
  clientId?: string;
  extraData?: Record<string, unknown>;
};

export type ComfyUiQueuePromptResponse = {
  promptId: string;
  number?: number;
  nodeErrors?: unknown;
  raw: unknown;
};

export type ComfyUiGenerateImageResponse = ComfyUiQueuePromptResponse & BasicTextToImageWorkflow;

export type ComfyUiViewImageReference = {
  filename: string;
  subfolder?: string;
  type?: string;
};

export type ComfyUiGeneratedImage = ComfyUiViewImageReference & {
  nodeId: string;
  url: string;
};

export type ComfyUiPromptHistoryResponse = {
  promptId: string;
  completed: boolean;
  images: ComfyUiGeneratedImage[];
  raw: unknown;
};
