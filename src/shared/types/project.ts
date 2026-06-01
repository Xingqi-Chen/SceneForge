import type { PromptTag, PromptTagCategory, PromptTagSubcategory, Scene } from "./scene";

export type PromptModelFormat = "generic" | "stable-diffusion";
export type ArtistStringPromptRenderMode = "novelai" | "artist-weight" | "by-weight";
export type SavedComfyUiGenerationSeedMode = "random" | "fixed";
export type SavedComfyUiWorkflowProfile = "default" | "anima";
export type SavedComfyUiModelStorageKind = "checkpoint" | "diffusion";

export type SavedComfyUiGenerationLoraParams = {
  loraName: string;
  enabled: boolean;
  strengthModel: number;
  strengthClip: number;
};

export type SavedComfyUiPromptWrapper = {
  positivePrefix?: string;
  negativePrefix?: string;
};

export type SavedComfyUiInpaintParams = {
  denoise?: number;
  growMaskBy?: number;
  mode?: "latent-noise-mask" | "vae-inpaint";
};

export type SavedComfyUiFaceDetailerParams = {
  bboxCropFactor?: number;
  bboxDilation?: number;
  bboxThreshold?: number;
  cfg?: number;
  cycle?: number;
  denoise?: number;
  enabled: boolean;
  detectorModelName?: string;
  dropSize?: number;
  feather?: number;
  forceInpaint?: boolean;
  guideSize?: number;
  guideSizeFor?: boolean;
  maxSize?: number;
  noiseMask?: boolean;
  samBBoxExpansion?: number;
  samDetectionHint?: string;
  samDilation?: number;
  samMaskHintThreshold?: number;
  samMaskHintUseNegative?: string;
  samThreshold?: number;
  samplerName?: string;
  scheduler?: string;
  steps?: number;
  wildcard?: string;
};

export type SavedComfyUiHandDetailerParams = SavedComfyUiFaceDetailerParams;

export type SavedComfyUiGenerationParams = {
  workflowProfile?: SavedComfyUiWorkflowProfile;
  modelBaseModel?: string;
  modelStorageKind?: SavedComfyUiModelStorageKind;
  clipName?: string;
  clipDevice?: string;
  vaeName?: string;
  unetWeightDtype?: string;
  width: number;
  height: number;
  seed: number;
  seedMode: SavedComfyUiGenerationSeedMode;
  steps: number;
  cfg: number;
  samplerName: string;
  scheduler: string;
  denoise: number;
  imageCount: number;
  latentImageNode?: "EmptyLatentImage" | "EmptySD3LatentImage";
  promptWrapper?: SavedComfyUiPromptWrapper;
  inpaint?: SavedComfyUiInpaintParams;
  outputPrefix: string;
  faceDetailer?: SavedComfyUiFaceDetailerParams;
  handDetailer?: SavedComfyUiHandDetailerParams;
  loras: SavedComfyUiGenerationLoraParams[];
  savedAt: string;
};

export type SavedComfyUiGeneratedImageSource = "text-to-image" | "inpaint" | "sequence";
export type SavedComfyUiGeneratedImageStorage = "sceneforge" | "comfyui";

export type SavedComicSequenceControlNetType = "openpose" | "depth" | "normal";

export type SavedComicSequenceControlNetParams = {
  type: SavedComicSequenceControlNetType;
  enabled: boolean;
  modelName: string;
  strength: number;
  startPercent: number;
  endPercent: number;
};

export type SavedComicSequenceReferenceImage =
  | {
      id: string;
      source: "history";
      imageId: string;
    }
  | {
      id: string;
      source: "upload";
      filename: string;
      name: string;
      url: string;
    };

export type SavedComicSequenceReferenceChannelParams = {
  enabled: boolean;
  mode: "ipadapter" | "face" | "faceid";
  weight: number;
  startAt: number;
  endAt: number;
  images: SavedComicSequenceReferenceImage[];
};

export type SavedComicSequenceReferenceParams = {
  characterName: string;
  characterPrompt: string;
  face: SavedComicSequenceReferenceChannelParams;
  character: SavedComicSequenceReferenceChannelParams;
  mode: "ipadapter" | "face" | "faceid";
  weight: number;
  startAt: number;
  endAt: number;
  images: SavedComicSequenceReferenceImage[];
};

export type SavedComicSequencePreviousShotReference = {
  mode: "img2img" | "inpaint";
  denoise: number;
  inpaintMode: "latent-noise-mask" | "vae-inpaint";
  growMaskBy: number;
};

export type SavedComicSequenceShot = {
  id: string;
  title: string;
  scene: Scene;
  positivePrompt: string;
  negativePrompt: string;
  shotPrompt: string;
  parameters: SavedComfyUiGenerationParams;
  controlNets: SavedComicSequenceControlNetParams[];
  reference: SavedComicSequenceReferenceParams;
  boundImageIds?: string[];
  previousShotReference?: SavedComicSequencePreviousShotReference;
  createdAt: string;
  updatedAt: string;
};

export type SavedComicSequence = {
  version: 1;
  selectedShotId?: string;
  defaults?: SavedComfyUiGenerationParams;
  shots: SavedComicSequenceShot[];
};

export type SavedComfyUiImageReference = {
  filename: string;
  subfolder?: string;
  type?: string;
};

export type SavedComfyUiGeneratedImage = {
  id: string;
  promptId: string;
  batchId: string;
  nodeId: string;
  filename: string;
  subfolder?: string;
  type?: string;
  url: string;
  seed: number;
  source: SavedComfyUiGeneratedImageSource;
  storage?: SavedComfyUiGeneratedImageStorage;
  localFilename?: string;
  sourceReference?: SavedComfyUiImageReference;
  createdAt: string;
  favorited: boolean;
  parentImageId?: string;
  sequenceId?: string;
  shotId?: string;
  characterReferenceIds?: string[];
  outputNodeId?: string;
  width: number;
  height: number;
  positivePrompt: string;
  negativePrompt: string;
  parameters: SavedComfyUiGenerationParams;
  selectedCheckpointId: string | null;
  selectedLoraIds: string[];
};

export type ProjectSettings = {
  modelFormat: PromptModelFormat;
  includeSpatialHints: boolean;
  supportsNsfw: boolean;
  negativePrompt: string;
  selectedCivitaiCheckpointId: string | null;
  selectedCivitaiLoraIds: string[];
  selectedArtistStringIds: string[];
  selectedArtistStringPrompts: string[];
  artistStringPromptRenderMode: ArtistStringPromptRenderMode;
  savedComfyUiGenerationParams?: SavedComfyUiGenerationParams | null;
  savedComicSequence?: SavedComicSequence;
  comfyUiGeneratedImages: SavedComfyUiGeneratedImage[];
  /** User-imported prompt library entries, loaded from the shared prompt library file at runtime. */
  promptLibraryTags: PromptTag[];
  /** Built-in prompt library entries hidden by the user, loaded from the shared prompt library file at runtime. */
  deletedBuiltInPromptLibraryTagIds: string[];
};

export type PromptBindingTargetKind = "scene" | "object" | "character" | "bodyPart";

export type PromptTargetBindings = {
  promptCategoryBindings: PromptTagCategory[];
  promptSubcategoryBindings: PromptTagSubcategory[];
};

export type PromptBindingState = Record<PromptBindingTargetKind, PromptTargetBindings>;

export type SceneForgeProject = {
  id: string;
  name: string;
  version: 1;
  scene: Scene;
  settings: ProjectSettings;
  createdAt: string;
  updatedAt: string;
};

export type ProjectSummary = {
  id: string;
  name: string;
  updatedAt: string;
};
