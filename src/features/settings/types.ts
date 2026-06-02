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

export type CentralSettingsPayload = {
  general: {
    nsfw: {
      enabled: boolean;
      source: "env" | "default";
      detail: string;
    };
  };
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
  civitai?: {
    paths?: Partial<CivitaiLibrarySettings>;
  };
};
