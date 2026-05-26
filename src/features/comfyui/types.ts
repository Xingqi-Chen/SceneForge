import type {
  ComfyUiFaceDetailerSamDetectionHint,
  ComfyUiFaceDetailerSamMaskHintUseNegative,
} from "./face-detailer";
import type { ComfyUiInpaintMode } from "./inpaint";
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
  handDetailer?: ComfyUiHandDetailerConfig;
  controlNet?: ComfyUiControlNetConfig;
  controlNets?: ComfyUiControlNetUnitConfig[];
};

export type ComfyUiInpaintRequest = {
  checkpointName: string;
  positivePrompt: string;
  negativePrompt?: string;
  loras?: ComfyUiLoraInput[];
  seed?: number;
  steps?: number;
  cfg?: number;
  samplerName?: string;
  scheduler?: string;
  denoise?: number;
  promptWrapper?: ComfyUiPromptWrapper;
  outputPrefix?: string;
  sourceImage?: ComfyUiViewImageReference;
  imageWidth?: number;
  imageHeight?: number;
  imageName?: string;
  maskDataUrl?: string;
  maskName?: string;
  inpaintMode?: ComfyUiInpaintMode;
  growMaskBy?: number;
  faceDetailer?: ComfyUiFaceDetailerConfig;
  handDetailer?: ComfyUiHandDetailerConfig;
  upscaleBeforeInpaint?: ComfyUiInpaintUpscaleConfig;
};

export type ComfyUiInpaintUpscaleMode = "lanczos" | "real-esrgan-x2" | "aniscale2-x2";
export type ComfyUiInpaintUpscaleStrategy = "full-image" | "local-region";
export type ComfyUiInpaintLocalRegionSource = "mask-bounds" | "box";

export type ComfyUiInpaintLocalRegionConfig = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  source?: ComfyUiInpaintLocalRegionSource;
  padding?: number;
  feather?: number;
  harmonizeAfter?: {
    enabled?: boolean;
    denoise?: number;
  };
};

export type ResolvedComfyUiInpaintLocalRegionConfig = {
  x: number;
  y: number;
  width: number;
  height: number;
  source: ComfyUiInpaintLocalRegionSource;
  padding: number;
  feather: number;
  harmonizeAfter: {
    enabled: boolean;
    denoise: number;
  };
};

export type ComfyUiInpaintUpscaleConfig = {
  enabled?: boolean;
  mode?: ComfyUiInpaintUpscaleMode;
  scaleBy?: number;
  modelName?: string;
  strategy?: ComfyUiInpaintUpscaleStrategy;
  localRegion?: ComfyUiInpaintLocalRegionConfig;
};

export type ComfyUiSam2Device = "cuda" | "cpu" | "mps";

export type ComfyUiSam2Precision = "fp16" | "bf16" | "fp32";

export type ComfyUiSam2Point = {
  x: number;
  y: number;
};

export type ComfyUiSam2Bbox = {
  height: number;
  width: number;
  x: number;
  y: number;
};

export type ComfyUiSam2MaskRequest = {
  sourceImage?: ComfyUiViewImageReference;
  imageName?: string;
  imageWidth: number;
  imageHeight: number;
  positivePoints?: ComfyUiSam2Point[];
  negativePoints?: ComfyUiSam2Point[];
  bbox?: ComfyUiSam2Bbox;
  model?: string;
  device?: ComfyUiSam2Device;
  precision?: ComfyUiSam2Precision;
  keepModelLoaded?: boolean;
  outputPrefix?: string;
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

export type ComfyUiHandDetailerConfig = ComfyUiFaceDetailerConfig;

export type ComfyUiControlNetConfig = {
  enabled?: boolean;
  modelName?: string;
  strength?: number;
  startPercent?: number;
  endPercent?: number;
  openPoseSvg?: string;
  svg?: string;
  imageDataUrl?: string;
  imageName?: string;
};

export type ComfyUiControlNetType = "openpose" | "depth" | "normal";

export type ComfyUiControlNetUnitConfig = {
  type: ComfyUiControlNetType;
  enabled?: boolean;
  modelName?: string;
  strength?: number;
  startPercent?: number;
  endPercent?: number;
  svg?: string;
  imageDataUrl?: string;
  imageName?: string;
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
  handDetailer: ResolvedComfyUiHandDetailerConfig;
  controlNets: ResolvedComfyUiControlNetUnitConfig[];
};

export type ResolvedComfyUiInpaintRequest = {
  checkpointName: string;
  positivePrompt: string;
  negativePrompt: string;
  loras: ResolvedComfyUiLoraInput[];
  seed: number;
  steps: number;
  cfg: number;
  samplerName: string;
  scheduler: string;
  denoise: number;
  promptWrapper: ResolvedComfyUiPromptWrapper;
  outputPrefix: string;
  sourceImage?: ComfyUiViewImageReference;
  imageWidth?: number;
  imageHeight?: number;
  imageName: string;
  maskDataUrl: string;
  maskName: string;
  inpaintMode: ComfyUiInpaintMode;
  growMaskBy: number;
  faceDetailer: ResolvedComfyUiFaceDetailerConfig;
  handDetailer: ResolvedComfyUiHandDetailerConfig;
  upscaleBeforeInpaint: ResolvedComfyUiInpaintUpscaleConfig;
};

export type ResolvedComfyUiInpaintUpscaleConfig = {
  enabled: boolean;
  mode: ComfyUiInpaintUpscaleMode;
  scaleBy: number;
  modelName: string;
  strategy: ComfyUiInpaintUpscaleStrategy;
  localRegion?: ResolvedComfyUiInpaintLocalRegionConfig;
};

export type ResolvedComfyUiSam2MaskRequest = {
  sourceImage?: ComfyUiViewImageReference;
  imageName: string;
  imageWidth: number;
  imageHeight: number;
  positivePoints: ComfyUiSam2Point[];
  negativePoints: ComfyUiSam2Point[];
  bbox?: ComfyUiSam2Bbox;
  model: string;
  device: ComfyUiSam2Device;
  precision: ComfyUiSam2Precision;
  keepModelLoaded: boolean;
  outputPrefix: string;
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

export type ResolvedComfyUiHandDetailerConfig = ResolvedComfyUiFaceDetailerConfig;

export type ResolvedComfyUiControlNetConfig = {
  enabled: boolean;
  modelName: string;
  strength: number;
  startPercent: number;
  endPercent: number;
  openPoseSvg: string;
  svg: string;
  imageDataUrl: string;
  imageName: string;
};

export type ResolvedComfyUiControlNetUnitConfig = {
  type: ComfyUiControlNetType;
  enabled: boolean;
  modelName: string;
  strength: number;
  startPercent: number;
  endPercent: number;
  svg: string;
  imageDataUrl: string;
  imageName: string;
};

export type BasicTextToImageControlNetNodeIds = {
  type: ComfyUiControlNetType;
  image: string;
  loader: string;
  apply: string;
};

export type BasicTextToImageNodeIds = {
  checkpoint: string;
  loraLoaders: string[];
  positivePrompt: string;
  negativePrompt: string;
  controlNets?: BasicTextToImageControlNetNodeIds[];
  controlNetImage?: string;
  controlNetLoader?: string;
  controlNetApply?: string;
  latentImage: string;
  sampler: string;
  vaeDecode: string;
  handUltralyticsDetectorProvider?: string;
  handDetailer?: string;
  ultralyticsDetectorProvider?: string;
  faceDetailer?: string;
  saveImage: string;
};

export type BasicInpaintNodeIds = {
  checkpoint: string;
  loraLoaders: string[];
  positivePrompt: string;
  negativePrompt: string;
  sourceImage: string;
  maskImage: string;
  sourceImageScaleBy?: string;
  maskToImage?: string;
  maskImageScaleBy?: string;
  imageToMask?: string;
  upscaleModelLoader?: string;
  imageUpscaleWithModel?: string;
  sourceImageCrop?: string;
  maskCrop?: string;
  compositeMaskFeather?: string;
  vaeEncode?: string;
  vaeEncodeForInpaint?: string;
  setLatentNoiseMask?: string;
  sampler: string;
  vaeDecode: string;
  localPatchScale?: string;
  localComposite?: string;
  harmonizeVaeEncode?: string;
  harmonizeSampler?: string;
  harmonizeVaeDecode?: string;
  handUltralyticsDetectorProvider?: string;
  handDetailer?: string;
  ultralyticsDetectorProvider?: string;
  faceDetailer?: string;
  saveImage: string;
};

export type BasicSam2MaskNodeIds = {
  sourceImage: string;
  sam2Model: string;
  sam2Segmentation: string;
  maskToImage: string;
  saveImage: string;
};

export type BasicTextToImageWorkflow = {
  workflow: ComfyUiWorkflow;
  nodeIds: BasicTextToImageNodeIds;
  outputNodeId: string;
  request: ResolvedComfyUiTextToImageRequest;
};

export type BasicInpaintWorkflow = {
  workflow: ComfyUiWorkflow;
  nodeIds: BasicInpaintNodeIds;
  outputNodeId: string;
  request: ResolvedComfyUiInpaintRequest;
};

export type BasicSam2MaskWorkflow = {
  workflow: ComfyUiWorkflow;
  nodeIds: BasicSam2MaskNodeIds;
  outputNodeId: string;
  request: ResolvedComfyUiSam2MaskRequest;
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

export type ComfyUiGenerateInpaintResponse = ComfyUiQueuePromptResponse & BasicInpaintWorkflow;

export type ComfyUiGenerateSam2MaskResponse = ComfyUiQueuePromptResponse & BasicSam2MaskWorkflow;

export type ComfyUiViewImageReference = {
  filename: string;
  subfolder?: string;
  type?: string;
};

export type ComfyUiUploadImageRequest = {
  filename: string;
  bytes: Uint8Array;
  mimeType?: string;
  overwrite?: boolean;
  subfolder?: string;
  type?: "input" | "output" | "temp";
};

export type ComfyUiUploadImageResponse = {
  filename: string;
  imageName: string;
  subfolder?: string;
  type?: string;
  raw: unknown;
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
