import { describe, expect, it } from "vitest";

import {
  isComfyUiKrea2TextToImageRequest,
  resolveComfyUiTextToImageWorkflowProfile,
} from "./workflow-profiles";

describe("ComfyUI Krea profile activation", () => {
  it("requires both Krea 2 base-model metadata and diffusion storage", () => {
    const kreaMetadata = {
      checkpointName: "krea-2-turbo-unet.safetensors",
      modelBaseModel: "Krea 2",
      modelStorageKind: "diffusion" as const,
    };

    expect(isComfyUiKrea2TextToImageRequest(kreaMetadata)).toBe(true);
    expect(resolveComfyUiTextToImageWorkflowProfile(kreaMetadata).id).toBe("krea2");
    expect(resolveComfyUiTextToImageWorkflowProfile({
      ...kreaMetadata,
      modelStorageKind: "checkpoint",
    }).id).toBe("default");
    expect(resolveComfyUiTextToImageWorkflowProfile({
      ...kreaMetadata,
      modelBaseModel: "Illustrious",
    }).id).toBe("default");
    expect(resolveComfyUiTextToImageWorkflowProfile({
      checkpointName: "Krea_2_Turbo.safetensors",
      modelStorageKind: "diffusion",
      workflowProfile: "krea2",
    }).id).toBe("default");
  });
});
