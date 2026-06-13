import type { CivitaiLibrarySettings } from "@/features/civitai-lora-library/types";

export type SettingsState = "configured" | "missing" | "default" | "degraded";

export type SettingsPathStatus = {
  id: string;
  label: string;
  value: string | null;
  source: "env" | "default" | "sqlite";
  editable: boolean;
  state: SettingsState;
  detail: string;
};

export type SettingsSecretStatus = {
  label: string;
  configured: boolean;
};

export type SettingsIntegrationStatus = {
  id: "comfyui" | "civitai" | "litellm" | "tavily";
  label: string;
  state: SettingsState;
  detail: string;
  config: Array<{
    label: string;
    value?: string;
    configured?: boolean;
    redacted?: boolean;
  }>;
};

export const characterTagNewTermDefaultOptions = [
  "existing-only",
  "temporary",
  "import",
  "ask",
] as const;

export type CharacterTagNewTermDefaultOption =
  (typeof characterTagNewTermDefaultOptions)[number];

export const workflowDisplayModeOptions = ["simple", "detailed"] as const;

export type WorkflowDisplayMode = (typeof workflowDisplayModeOptions)[number];

export type SceneForgeWorkflowSettings = {
  characterTagNewTermDefaultOption: CharacterTagNewTermDefaultOption;
  autoReview: boolean;
  displayMode: WorkflowDisplayMode;
};

export type SceneForgeUserSettings = {
  supportsNsfw: boolean;
  workflow: SceneForgeWorkflowSettings;
};

export const defaultSceneForgeUserSettings: SceneForgeUserSettings = {
  supportsNsfw: false,
  workflow: {
    characterTagNewTermDefaultOption: "ask",
    autoReview: false,
    displayMode: "simple",
  },
};

export type CentralSettingsPayload = {
  general: {
    nsfw: {
      enabled: boolean;
      supportsNsfw: boolean;
      source: "env" | "default";
      detail: string;
    };
  };
  workflow: SceneForgeWorkflowSettings;
  storage: {
    paths: SettingsPathStatus[];
  };
  civitai: {
    paths: CivitaiLibrarySettings;
    pathStatuses: SettingsPathStatus[];
  };
  integrations: SettingsIntegrationStatus[];
};

export type CentralSettingsUpdatePayload = {
  general?: {
    nsfw?: {
      supportsNsfw?: boolean;
    };
  };
  workflow?: Partial<SceneForgeWorkflowSettings>;
  civitai?: {
    paths?: Partial<CivitaiLibrarySettings>;
  };
};
