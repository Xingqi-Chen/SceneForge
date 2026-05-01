import type { Scene } from "./scene";

export type PromptModelFormat = "generic" | "stable-diffusion" | "midjourney";

export type ProjectSettings = {
  modelFormat: PromptModelFormat;
  includeSpatialHints: boolean;
  negativePrompt: string;
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
