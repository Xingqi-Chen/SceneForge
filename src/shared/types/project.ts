import type { PromptTag, PromptTagCategory, PromptTagSubcategory, Scene } from "./scene";

export type PromptModelFormat = "generic" | "stable-diffusion" | "midjourney";

export type ProjectSettings = {
  modelFormat: PromptModelFormat;
  includeSpatialHints: boolean;
  negativePrompt: string;
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
