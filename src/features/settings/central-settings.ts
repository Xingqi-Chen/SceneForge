import path from "node:path";

import {
  CIVITAI_LIBRARY_SETTINGS_PATH_LABELS,
  validateCivitaiLibrarySettingsPayload,
  type CivitaiLibrarySettingsPathKey,
} from "@/features/civitai-lora-library/settings";
import type { CivitaiLibrarySettings } from "@/features/civitai-lora-library/types";
import { getResolvedComfyUiTempDir, getResolvedGeneratedImagesDir } from "@/features/comfyui/generated-image-storage";
import { getResolvedSequenceReferenceDir } from "@/features/comfyui/sequence-reference-storage";
import { getResolvedProjectsDir } from "@/features/persistence/project-local-disk";
import { getResolvedPromptBindingsFilePath } from "@/features/persistence/prompt-bindings-local-disk";
import { getResolvedPromptLibraryFilePath } from "@/features/persistence/prompt-library-local-disk";

import type {
  CentralSettingsPayload,
  CentralSettingsUpdatePayload,
  SettingsIntegrationStatus,
  SettingsPathStatus,
  SettingsState,
} from "./types";

const DEFAULT_COMFYUI_BASE_URL = "http://127.0.0.1:8188";
const DEFAULT_TAVILY_BASE_URL = "https://api.tavily.com";

function getResolvedSettingsSqliteFilePath(): string {
  const override = process.env.SCENEFORGE_SQLITE_FILE?.trim();
  if (override) {
    return override;
  }

  return path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "sceneforge.sqlite");
}

function readBooleanEnvFlag(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

function isConfigured(value: string | undefined) {
  return Boolean(value?.trim());
}

function getEnvPathStatus({
  id,
  label,
  value,
  envName,
  configured,
  missingDetail,
}: {
  id: string;
  label: string;
  value: string | null;
  envName: string;
  configured: boolean;
  missingDetail?: string;
}): SettingsPathStatus {
  return {
    id,
    label,
    value,
    source: configured ? "env" : "default",
    editable: false,
    state: value ? (configured ? "configured" : "default") : "missing",
    detail: value
      ? configured
        ? `Configured by ${envName}.`
        : "Using the built-in default path."
      : (missingDetail ?? `${envName} is not configured.`),
  };
}

function getCivitaiPathStatus(key: CivitaiLibrarySettingsPathKey, value: string): SettingsPathStatus {
  return {
    id: key,
    label: CIVITAI_LIBRARY_SETTINGS_PATH_LABELS[key],
    value: value || null,
    source: "sqlite",
    editable: true,
    state: value ? "configured" : "missing",
    detail: value
      ? "Saved in SceneForge's local SQLite settings."
      : "Not configured. Downloads and model scans that need this path will report a missing path.",
  };
}

function getIntegrationState(required: boolean[], optional: boolean[] = []): SettingsState {
  if (required.every(Boolean)) {
    return "configured";
  }

  if (required.some(Boolean) || optional.some(Boolean)) {
    return "degraded";
  }

  return "missing";
}

function buildComfyUiStatus(): SettingsIntegrationStatus {
  const baseUrlConfigured = isConfigured(process.env.COMFYUI_BASE_URL);
  const apiKeyConfigured = isConfigured(process.env.COMFYUI_API_KEY);
  const tempDirConfigured = isConfigured(process.env.COMFYUI_TEMP_DIR);
  const baseUrl = process.env.COMFYUI_BASE_URL?.trim() || DEFAULT_COMFYUI_BASE_URL;

  return {
    id: "comfyui",
    label: "ComfyUI",
    state: getIntegrationState([Boolean(baseUrl)], [apiKeyConfigured, tempDirConfigured]),
    detail: baseUrlConfigured
      ? "Base URL is configured. Live availability is checked only when ComfyUI routes are used."
      : "Using the default local ComfyUI base URL. Set COMFYUI_BASE_URL to override it.",
    config: [
      { label: "Base URL", value: baseUrl, configured: baseUrlConfigured },
      { label: "API key", configured: apiKeyConfigured, redacted: true },
      { label: "Temp directory", configured: tempDirConfigured },
    ],
  };
}

function buildCivitaiStatus(settings: CivitaiLibrarySettings): SettingsIntegrationStatus {
  const apiKeyConfigured = isConfigured(process.env.CIVITAI_API_KEY);
  const configuredPathCount = Object.values(settings).filter((value) => value.trim()).length;

  return {
    id: "civitai",
    label: "Civitai",
    state: configuredPathCount > 0 || apiKeyConfigured ? "configured" : "missing",
    detail: configuredPathCount > 0
      ? `${configuredPathCount} resource path${configuredPathCount === 1 ? "" : "s"} configured.`
      : "No resource paths are configured yet.",
    config: [
      { label: "API key", configured: apiKeyConfigured, redacted: true },
      { label: "Editable resource paths", value: `${configuredPathCount}/4 configured`, configured: configuredPathCount > 0 },
    ],
  };
}

function buildLiteLlmStatus(): SettingsIntegrationStatus {
  const baseUrlConfigured = isConfigured(process.env.LITELLM_BASE_URL);
  const apiKeyConfigured = isConfigured(process.env.LITELLM_API_KEY);
  const defaultModelConfigured = isConfigured(process.env.LITELLM_DEFAULT_MODEL);
  const nsfwModelConfigured = isConfigured(process.env.LITELLM_NSFW_MODEL);
  const civitaiRecommendationModelConfigured = isConfigured(process.env.LITELLM_CIVITAI_RECOMMENDATION_MODEL);

  return {
    id: "litellm",
    label: "LiteLLM",
    state: getIntegrationState([baseUrlConfigured, defaultModelConfigured], [apiKeyConfigured]),
    detail: baseUrlConfigured && defaultModelConfigured
      ? "Chat routing is configured. Model names and API keys stay server-only."
      : "Set LITELLM_BASE_URL and LITELLM_DEFAULT_MODEL before using AI chat routes.",
    config: [
      { label: "Base URL", configured: baseUrlConfigured, redacted: true },
      { label: "API key", configured: apiKeyConfigured, redacted: true },
      { label: "Default model", configured: defaultModelConfigured, redacted: true },
      { label: "NSFW model override", configured: nsfwModelConfigured, redacted: true },
      { label: "Civitai recommendation model override", configured: civitaiRecommendationModelConfigured, redacted: true },
    ],
  };
}

function buildTavilyStatus(): SettingsIntegrationStatus {
  const apiKeyConfigured = isConfigured(process.env.TAVILY_API_KEY);
  const baseUrlConfigured = isConfigured(process.env.TAVILY_BASE_URL);

  return {
    id: "tavily",
    label: "Tavily",
    state: apiKeyConfigured ? "configured" : baseUrlConfigured ? "degraded" : "missing",
    detail: apiKeyConfigured
      ? "Web diagnosis context is configured. Live availability is checked only when diagnosis routes are used."
      : "TAVILY_API_KEY is missing; ComfyUI diagnosis can still use local fallback context.",
    config: [
      { label: "API key", configured: apiKeyConfigured, redacted: true },
      { label: "Base URL", value: baseUrlConfigured ? process.env.TAVILY_BASE_URL?.trim() : DEFAULT_TAVILY_BASE_URL, configured: baseUrlConfigured },
    ],
  };
}

export function buildCentralSettingsPayload(civitaiSettings: CivitaiLibrarySettings): CentralSettingsPayload {
  const nsfwEnabled = readBooleanEnvFlag(process.env.SCENEFORGE_SHOW_NSFW_BUTTON);
  const projectDirConfigured = isConfigured(process.env.SCENEFORGE_PROJECTS_DIR);
  const promptLibraryConfigured = isConfigured(process.env.SCENEFORGE_PROMPT_LIBRARY_FILE);
  const promptBindingsConfigured = isConfigured(process.env.SCENEFORGE_PROMPT_BINDINGS_FILE);
  const generatedImagesConfigured = isConfigured(process.env.SCENEFORGE_GENERATED_IMAGES_DIR);
  const sequenceReferenceConfigured = isConfigured(process.env.SCENEFORGE_SEQUENCE_REFERENCE_DIR);
  const sqliteConfigured = isConfigured(process.env.SCENEFORGE_SQLITE_FILE);
  const comfyTempConfigured = isConfigured(process.env.COMFYUI_TEMP_DIR);

  const civitaiPathStatuses = (Object.keys(CIVITAI_LIBRARY_SETTINGS_PATH_LABELS) as CivitaiLibrarySettingsPathKey[])
    .map((key) => getCivitaiPathStatus(key, civitaiSettings[key]));

  return {
    general: {
      nsfw: {
        enabled: nsfwEnabled,
        source: isConfigured(process.env.SCENEFORGE_SHOW_NSFW_BUTTON) ? "env" : "default",
        detail: nsfwEnabled
          ? "NSFW UI mode is enabled by SCENEFORGE_SHOW_NSFW_BUTTON."
          : "NSFW UI mode is disabled unless SCENEFORGE_SHOW_NSFW_BUTTON=true.",
      },
    },
    storage: {
      paths: [
        getEnvPathStatus({
          id: "projects",
          label: "Project storage",
          value: getResolvedProjectsDir(),
          envName: "SCENEFORGE_PROJECTS_DIR",
          configured: projectDirConfigured,
        }),
        getEnvPathStatus({
          id: "prompt-library",
          label: "Prompt library file",
          value: getResolvedPromptLibraryFilePath(),
          envName: "SCENEFORGE_PROMPT_LIBRARY_FILE",
          configured: promptLibraryConfigured,
        }),
        getEnvPathStatus({
          id: "prompt-bindings",
          label: "Prompt bindings file",
          value: getResolvedPromptBindingsFilePath(),
          envName: "SCENEFORGE_PROMPT_BINDINGS_FILE",
          configured: promptBindingsConfigured,
        }),
        getEnvPathStatus({
          id: "generated-images",
          label: "Generated image storage",
          value: getResolvedGeneratedImagesDir(),
          envName: "SCENEFORGE_GENERATED_IMAGES_DIR",
          configured: generatedImagesConfigured,
        }),
        getEnvPathStatus({
          id: "sequence-references",
          label: "Sequence reference image storage",
          value: getResolvedSequenceReferenceDir(),
          envName: "SCENEFORGE_SEQUENCE_REFERENCE_DIR",
          configured: sequenceReferenceConfigured,
        }),
        getEnvPathStatus({
          id: "sqlite",
          label: "SceneForge SQLite file",
          value: getResolvedSettingsSqliteFilePath(),
          envName: "SCENEFORGE_SQLITE_FILE",
          configured: sqliteConfigured,
        }),
        getEnvPathStatus({
          id: "comfyui-temp",
          label: "ComfyUI temp directory",
          value: getResolvedComfyUiTempDir(),
          envName: "COMFYUI_TEMP_DIR",
          configured: comfyTempConfigured,
          missingDetail: "COMFYUI_TEMP_DIR is not configured; temporary ComfyUI cleanup is unavailable.",
        }),
      ],
    },
    civitai: {
      paths: civitaiSettings,
      pathStatuses: civitaiPathStatuses,
    },
    integrations: [
      buildComfyUiStatus(),
      buildCivitaiStatus(civitaiSettings),
      buildLiteLlmStatus(),
      buildTavilyStatus(),
    ],
  };
}

export type CentralSettingsUpdateResult =
  | {
      ok: true;
      payload: CentralSettingsPayload;
    }
  | {
      ok: false;
      status: number;
      message: string;
      details?: unknown;
    };

export async function readCentralSettings(): Promise<CentralSettingsPayload> {
  const {
    loadCivitaiLibrarySettingsFromSqlite,
    openSceneForgeSqliteDatabase,
  } = await import("@/features/persistence/sqlite-storage");
  const db = await openSceneForgeSqliteDatabase();

  try {
    return buildCentralSettingsPayload(loadCivitaiLibrarySettingsFromSqlite(db));
  } finally {
    db.close();
  }
}

export async function updateCentralSettings(payload: CentralSettingsUpdatePayload): Promise<CentralSettingsUpdateResult> {
  const civitaiPaths = payload.civitai?.paths;
  if (!civitaiPaths) {
    return {
      ok: false,
      status: 400,
      message: "Request body must include civitai.paths.",
    };
  }

  const {
    loadCivitaiLibrarySettingsFromSqlite,
    openSceneForgeSqliteDatabase,
    saveCivitaiLibrarySettingsToSqlite,
  } = await import("@/features/persistence/sqlite-storage");
  const db = await openSceneForgeSqliteDatabase();

  try {
    const currentSettings = loadCivitaiLibrarySettingsFromSqlite(db);
    const validation = validateCivitaiLibrarySettingsPayload({
      ...currentSettings,
      ...civitaiPaths,
    });
    if (!validation.ok) {
      return {
        ok: false,
        status: 400,
        message: "One or more Civitai paths are invalid.",
        details: validation.errors,
      };
    }

    const settings = saveCivitaiLibrarySettingsToSqlite(db, validation.settings);
    return {
      ok: true,
      payload: buildCentralSettingsPayload(settings),
    };
  } finally {
    db.close();
  }
}
