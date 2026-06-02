import { describe, expect, it } from "vitest";

import {
  validateCivitaiLibrarySettingsPath,
  validateCivitaiLibrarySettingsPayload,
} from "./settings";

describe("Civitai library settings validation", () => {
  it("allows empty paths and absolute local paths", () => {
    expect(validateCivitaiLibrarySettingsPath("loraDownloadPath", "")).toBeNull();
    expect(validateCivitaiLibrarySettingsPath("loraDownloadPath", "D:/ComfyUI/models/loras")).toBeNull();
    expect(validateCivitaiLibrarySettingsPath("checkpointDownloadPath", "/mnt/models/checkpoints")).toBeNull();
    expect(validateCivitaiLibrarySettingsPath("controlNetModelPath", "\\\\server\\share\\controlnet")).toBeNull();
  });

  it("rejects malformed or unsafe paths with field-specific messages", () => {
    const result = validateCivitaiLibrarySettingsPayload({
      loraDownloadPath: "models/loras",
      checkpointDownloadPath: "https://example.test/model.safetensors",
      diffusionModelPath: "D:/ComfyUI/../diffusion_models",
      controlNetModelPath: "D:/ComfyUI/models/controlnet\u0000",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.loraDownloadPath).toContain("absolute local path");
      expect(result.errors.checkpointDownloadPath).toContain("not a URL");
      expect(result.errors.diffusionModelPath).toContain("parent directory");
      expect(result.errors.controlNetModelPath).toContain("control characters");
    }
  });

  it("rejects explicit non-string path values without treating them as clears", () => {
    const result = validateCivitaiLibrarySettingsPayload({
      loraDownloadPath: 123,
      checkpointDownloadPath: null,
      diffusionModelPath: ["D:/models/diffusion"],
      controlNetModelPath: { path: "D:/models/controlnet" },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.loraDownloadPath).toContain("must be a string path");
      expect(result.errors.checkpointDownloadPath).toContain("must be a string path");
      expect(result.errors.diffusionModelPath).toContain("must be a string path");
      expect(result.errors.controlNetModelPath).toContain("must be a string path");
    }
  });
});
