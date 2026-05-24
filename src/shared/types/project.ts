import type { PromptTag, PromptTagCategory, PromptTagSubcategory, Scene } from "./scene";

export type PromptModelFormat = "generic" | "stable-diffusion";
export type ArtistStringPromptRenderMode = "novelai" | "artist-weight" | "by-weight";
export type SavedComfyUiGenerationSeedMode = "random" | "fixed";

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

export type SavedComfyUiGenerationParams = {
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
  outputPrefix: string;
  faceDetailer?: SavedComfyUiFaceDetailerParams;
  loras: SavedComfyUiGenerationLoraParams[];
  savedAt: string;
};

export type ProjectSettings = {
  modelFormat: PromptModelFormat;
  includeSpatialHints: boolean;
  negativePrompt: string;
  selectedCivitaiCheckpointId: string | null;
  selectedCivitaiLoraIds: string[];
  selectedArtistStringIds: string[];
  selectedArtistStringPrompts: string[];
  artistStringPromptRenderMode: ArtistStringPromptRenderMode;
  savedComfyUiGenerationParams?: SavedComfyUiGenerationParams | null;
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
