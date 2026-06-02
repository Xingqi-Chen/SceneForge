import { afterEach, describe, expect, it, vi } from "vitest";

import type { CivitaiLibrarySettings } from "@/features/civitai-lora-library/types";

import { buildCentralSettingsPayload, updateCentralSettings } from "./central-settings";

const sqliteMocks = vi.hoisted(() => ({
  db: {
    close: vi.fn(),
  },
  loadCivitaiLibrarySettingsFromSqlite: vi.fn(),
  loadSceneForgeUserSettingsFromSqlite: vi.fn(),
  openSceneForgeSqliteDatabase: vi.fn(),
  saveCivitaiLibrarySettingsToSqlite: vi.fn(),
  saveSceneForgeUserSettingsToSqlite: vi.fn(),
}));

vi.mock("@/features/persistence/sqlite-storage", () => ({
  loadCivitaiLibrarySettingsFromSqlite: sqliteMocks.loadCivitaiLibrarySettingsFromSqlite,
  loadSceneForgeUserSettingsFromSqlite: sqliteMocks.loadSceneForgeUserSettingsFromSqlite,
  openSceneForgeSqliteDatabase: sqliteMocks.openSceneForgeSqliteDatabase,
  saveCivitaiLibrarySettingsToSqlite: sqliteMocks.saveCivitaiLibrarySettingsToSqlite,
  saveSceneForgeUserSettingsToSqlite: sqliteMocks.saveSceneForgeUserSettingsToSqlite,
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

    const payload = buildCentralSettingsPayload(createCivitaiSettings(), {
      supportsNsfw: true,
      workflow: {
        characterTagNewTermDefaultOption: "temporary",
        autoReview: true,
      },
    });
    const serialized = JSON.stringify(payload);

    expect(payload.general.nsfw.enabled).toBe(true);
    expect(payload.general.nsfw.supportsNsfw).toBe(true);
    expect(payload.workflow).toEqual({
      characterTagNewTermDefaultOption: "temporary",
      autoReview: true,
    });
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
    sqliteMocks.loadSceneForgeUserSettingsFromSqlite.mockReturnValue({
      supportsNsfw: false,
      workflow: {
        characterTagNewTermDefaultOption: "ask",
        autoReview: false,
      },
    });
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

  it("updates persisted NSFW and workflow defaults without requiring Civitai paths", async () => {
    const civitaiSettings = createCivitaiSettings();
    const currentUserSettings = {
      supportsNsfw: false,
      workflow: {
        characterTagNewTermDefaultOption: "ask" as const,
        autoReview: false,
      },
    };
    const expectedUserSettings = {
      supportsNsfw: true,
      workflow: {
        characterTagNewTermDefaultOption: "import" as const,
        autoReview: true,
      },
    };

    sqliteMocks.openSceneForgeSqliteDatabase.mockResolvedValue(sqliteMocks.db);
    sqliteMocks.loadCivitaiLibrarySettingsFromSqlite.mockReturnValue(civitaiSettings);
    sqliteMocks.loadSceneForgeUserSettingsFromSqlite.mockReturnValue(currentUserSettings);
    sqliteMocks.saveSceneForgeUserSettingsToSqlite.mockReturnValue(expectedUserSettings);

    const result = await updateCentralSettings({
      general: {
        nsfw: {
          supportsNsfw: true,
        },
      },
      workflow: {
        characterTagNewTermDefaultOption: "import",
        autoReview: true,
      },
    });

    expect(result.ok).toBe(true);
    expect(sqliteMocks.saveSceneForgeUserSettingsToSqlite).toHaveBeenCalledWith(
      sqliteMocks.db,
      expectedUserSettings,
    );
    if (result.ok) {
      expect(result.payload.general.nsfw.supportsNsfw).toBe(true);
      expect(result.payload.workflow).toEqual(expectedUserSettings.workflow);
    }
  });
});
