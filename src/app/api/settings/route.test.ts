// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET, PUT } from "./route";

const ENV_KEYS = [
  "SCENEFORGE_SQLITE_FILE",
  "COMFYUI_API_KEY",
  "CIVITAI_API_KEY",
  "LITELLM_BASE_URL",
  "LITELLM_API_KEY",
  "LITELLM_DEFAULT_MODEL",
  "LITELLM_NSFW_MODEL",
  "LITELLM_CIVITAI_RECOMMENDATION_MODEL",
  "TAVILY_API_KEY",
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

function settingsRequest(body: unknown) {
  return new Request("http://localhost/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/settings route", () => {
  let tempDir: string;

  beforeEach(async () => {
    restoreEnv();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sceneforge-settings-route-"));
    process.env.SCENEFORGE_SQLITE_FILE = path.join(tempDir, "sceneforge.sqlite");
  });

  afterEach(async () => {
    restoreEnv();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("redacts secret-backed values from GET responses", async () => {
    process.env.COMFYUI_API_KEY = "comfy-secret";
    process.env.CIVITAI_API_KEY = "civitai-secret";
    process.env.LITELLM_BASE_URL = "http://litellm.internal";
    process.env.LITELLM_API_KEY = "litellm-secret";
    process.env.LITELLM_DEFAULT_MODEL = "private-default-model";
    process.env.LITELLM_NSFW_MODEL = "private-nsfw-model";
    process.env.LITELLM_CIVITAI_RECOMMENDATION_MODEL = "private-civitai-model";
    process.env.TAVILY_API_KEY = "tavily-secret";

    const response = await GET();
    const payload = await response.json();
    const serialized = JSON.stringify(payload);

    expect(response.status).toBe(200);
    expect(serialized).not.toContain("comfy-secret");
    expect(serialized).not.toContain("civitai-secret");
    expect(serialized).not.toContain("litellm-secret");
    expect(serialized).not.toContain("private-default-model");
    expect(serialized).not.toContain("private-nsfw-model");
    expect(serialized).not.toContain("private-civitai-model");
    expect(serialized).not.toContain("tavily-secret");
    expect(payload.integrations.find((entry: { id: string }) => entry.id === "litellm")).toMatchObject({
      state: "configured",
      config: expect.arrayContaining([
        expect.objectContaining({ label: "Base URL", redacted: true }),
        expect.objectContaining({ label: "Default model", redacted: true }),
      ]),
    });
  });

  it("validates and persists empty or absolute local Civitai paths", async () => {
    const response = await PUT(
      settingsRequest({
        civitai: {
          paths: {
            loraDownloadPath: "D:/models/loras",
            checkpointDownloadPath: "",
            diffusionModelPath: "/mnt/models/diffusion",
            controlNetModelPath: "\\\\server\\share\\controlnet",
          },
        },
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.civitai.paths).toEqual({
      loraDownloadPath: "D:/models/loras",
      checkpointDownloadPath: "",
      diffusionModelPath: "/mnt/models/diffusion",
      controlNetModelPath: "\\\\server\\share\\controlnet",
    });

    const followUp = await GET();
    await expect(followUp.json()).resolves.toMatchObject({
      civitai: {
        paths: payload.civitai.paths,
      },
    });
  });

  it("rejects unsafe Civitai paths with field-level error details", async () => {
    const response = await PUT(
      settingsRequest({
        civitai: {
          paths: {
            loraDownloadPath: "models/loras",
            checkpointDownloadPath: "https://example.test/model.safetensors",
            diffusionModelPath: "D:/ComfyUI/../diffusion_models",
          },
        },
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error.message).toBe("One or more Civitai paths are invalid.");
    expect(payload.error.details.loraDownloadPath).toContain("absolute local path");
    expect(payload.error.details.checkpointDownloadPath).toContain("not a URL");
    expect(payload.error.details.diffusionModelPath).toContain("parent directory");
  });

  it("rejects non-string Civitai path fields without clearing persisted values", async () => {
    const initial = await PUT(
      settingsRequest({
        civitai: {
          paths: {
            loraDownloadPath: "D:/models/loras",
            checkpointDownloadPath: "D:/models/checkpoints",
            diffusionModelPath: "D:/models/diffusion",
            controlNetModelPath: "",
          },
        },
      }),
    );
    expect(initial.status).toBe(200);

    const response = await PUT(
      settingsRequest({
        civitai: {
          paths: {
            loraDownloadPath: 123,
          },
        },
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error.details.loraDownloadPath).toContain("must be a string path");

    const followUp = await GET();
    await expect(followUp.json()).resolves.toMatchObject({
      civitai: {
        paths: {
          loraDownloadPath: "D:/models/loras",
          checkpointDownloadPath: "D:/models/checkpoints",
          diffusionModelPath: "D:/models/diffusion",
          controlNetModelPath: "",
        },
      },
    });
  });
});
