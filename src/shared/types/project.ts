import type { PromptTag, Scene } from "./scene";

export type PromptModelFormat = "generic" | "stable-diffusion" | "midjourney";

export type ProjectSettings = {
  modelFormat: PromptModelFormat;
  includeSpatialHints: boolean;
  negativePrompt: string;
  /** User-imported prompt library entries (persisted with the project). */
  promptLibraryTags: PromptTag[];
  /** Built-in prompt library entries hidden by the user. */
  deletedBuiltInPromptLibraryTagIds: string[];
};

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
