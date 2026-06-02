import { afterEach, describe, expect, it, vi } from "vitest";

import type { CivitaiLibrarySettings } from "@/features/civitai-lora-library/types";

import { buildCentralSettingsPayload, updateCentralSettings } from "./central-settings";

const sqliteMocks = vi.hoisted(() => ({
  db: {
    close: vi.fn(),
  },
  loadCivitaiLibrarySettingsFromSqlite: vi.fn(),
  openSceneForgeSqliteDatabase: vi.fn(),
  saveCivitaiLibrarySettingsToSqlite: vi.fn(),
}));

vi.mock("@/features/persistence/sqlite-storage", () => ({
  loadCivitaiLibrarySettingsFromSqlite: sqliteMocks.loadCivitaiLibrarySettingsFromSqlite,
  openSceneForgeSqliteDatabase: sqliteMocks.openSceneForgeSqliteDatabase,
  saveCivitaiLibrarySettingsToSqlite: sqliteMocks.saveCivitaiLibrarySettingsToSqlite,
}));

const ENV_KEYS = [
  "SCENEFORGE_SHOW_NSFW_BUTTON",
  "SCENEFORGE_PROJECTS_DIR",
  "SCENEFORGE_PROMPT_LIBRARY_FILE",
  "SCENEFORGE_PROMPT_BINDINGS_FILE",
  "SCENEFORGE_GENERATED_IMAGES_DIR",
  "SCENEFORGE_SEQUENCE_REFERENCE_DIR",
  "SCENEFORGE_SQLITE_FILE",
  "COMFYUI_BASE_URL",
  "COMFYUI_API_KEY",
  "COMFYUI_TEMP_DIR",
  "CIVITAI_API_KEY",
  "LITELLM_BASE_URL",
  "LITELLM_API_KEY",
  "LITELLM_DEFAULT_MODEL",
  "LITELLM_NSFW_MODEL",
  "LITELLM_CIVITAI_RECOMMENDATION_MODEL",
  "TAVILY_API_KEY",
  "TAVILY_BASE_URL",
] as const;

const previousEnv = new Map<string, string | undefined>();

for (const key of ENV_KEYS) {
  previousEnv.set(key, process.env[key]);
}

function restoreEnv() {
  for (const key of ENV_KEYS) {
    const value = previousEnv.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function createCivitaiSettings(): CivitaiLibrarySettings {
  return {
    loraDownloadPath: "D:/models/loras",
    checkpointDownloadPath: "",
    diffusionModelPath: "D:/models/diffusion",
    controlNetModelPath: "",
  };
}

describe("central settings payload", () => {
  afterEach(() => {
    restoreEnv();
    vi.clearAllMocks();
  });

  it("redacts secret-backed integration values", () => {
    process.env.SCENEFORGE_SHOW_NSFW_BUTTON = "true";
    process.env.COMFYUI_API_KEY = "comfy-secret";
    process.env.CIVITAI_API_KEY = "civitai-secret";
    process.env.LITELLM_BASE_URL = "http://litellm.test";
    process.env.LITELLM_API_KEY = "litellm-secret";
    process.env.LITELLM_DEFAULT_MODEL = "private-model-name";
    process.env.LITELLM_NSFW_MODEL = "private-nsfw-model";
    process.env.TAVILY_API_KEY = "tavily-secret";

    const payload = buildCentralSettingsPayload(createCivitaiSettings());
    const serialized = JSON.stringify(payload);

    expect(payload.general.nsfw.enabled).toBe(true);
    expect(serialized).not.toContain("comfy-secret");
    expect(serialized).not.toContain("civitai-secret");
    expect(serialized).not.toContain("litellm-secret");
    expect(serialized).not.toContain("private-model-name");
    expect(serialized).not.toContain("private-nsfw-model");
    expect(serialized).not.toContain("tavily-secret");
    expect(payload.integrations.find((entry) => entry.id === "litellm")?.state).toBe("configured");
  });

  it("marks env-backed paths as read-only and Civitai paths as editable", () => {
    process.env.SCENEFORGE_PROJECTS_DIR = "D:/SceneForge/projects";

    const payload = buildCentralSettingsPayload(createCivitaiSettings());

    expect(payload.storage.paths.find((entry) => entry.id === "projects")).toMatchObject({
      editable: false,
      source: "env",
      state: "configured",
      value: "D:/SceneForge/projects",
    });
    expect(payload.civitai.pathStatuses.find((entry) => entry.id === "loraDownloadPath")).toMatchObject({
      editable: true,
      source: "sqlite",
      state: "configured",
      value: "D:/models/loras",
    });
  });

  it("merges partial Civitai path updates with existing settings", async () => {
    const currentSettings: CivitaiLibrarySettings = {
      loraDownloadPath: "D:/models/old-loras",
      checkpointDownloadPath: "D:/models/checkpoints",
      diffusionModelPath: "D:/models/diffusion",
      controlNetModelPath: "D:/models/controlnet",
    };
    const expectedSettings: CivitaiLibrarySettings = {
      ...currentSettings,
      loraDownloadPath: "D:/models/new-loras",
    };

    sqliteMocks.openSceneForgeSqliteDatabase.mockResolvedValue(sqliteMocks.db);
    sqliteMocks.loadCivitaiLibrarySettingsFromSqlite.mockReturnValue(currentSettings);
    sqliteMocks.saveCivitaiLibrarySettingsToSqlite.mockReturnValue(expectedSettings);

    const result = await updateCentralSettings({
      civitai: {
        paths: {
          loraDownloadPath: expectedSettings.loraDownloadPath,
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(sqliteMocks.saveCivitaiLibrarySettingsToSqlite).toHaveBeenCalledWith(
      sqliteMocks.db,
      expectedSettings,
    );
    if (result.ok) {
      expect(result.payload.civitai.paths).toEqual(expectedSettings);
    }
    expect(sqliteMocks.db.close).toHaveBeenCalled();
  });
});
