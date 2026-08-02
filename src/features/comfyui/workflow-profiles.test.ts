import { describe, expect, it } from "vitest";

import {
  isComfyUiKrea2TextToImageRequest,
  resolveComfyUiTextToImageWorkflowProfile,
} from "./workflow-profiles";

describe("ComfyUI Krea profile activation", () => {
  it("accepts metadata-valid RedCraft diffusion filenames without Krea or turbo markers", () => {
    const kreaMetadata = {
      checkpointName: "RedCraft_v4_fp8_scaled.safetensors",
      modelBaseModel: "Krea 2",
      modelStorageKind: "diffusion" as const,
    };

    expect(isComfyUiKrea2TextToImageRequest(kreaMetadata)).toBe(true);
    expect(resolveComfyUiTextToImageWorkflowProfile(kreaMetadata).id).toBe("krea2");
    expect(resolveComfyUiTextToImageWorkflowProfile({
      ...kreaMetadata,
      checkpointName: "portraitModel.safetensors",
    }).id).toBe("krea2");
  });

  it("requires authoritative Krea 2 base-model metadata and diffusion storage", () => {
    const kreaMetadata = {
      checkpointName: "Krea_2_Turbo.safetensors",
      modelBaseModel: "Krea 2",
      modelStorageKind: "diffusion" as const,
    };

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

  it("keeps unknown diffusion metadata on the existing fallback profile", () => {
    expect(resolveComfyUiTextToImageWorkflowProfile({
      checkpointName: "future-diffusion-model.safetensors",
      modelBaseModel: "Flux.1 D",
      modelStorageKind: "diffusion",
    }).id).toBe("default");
  });
});
