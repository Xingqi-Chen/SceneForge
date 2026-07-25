import { describe, expect, it } from "vitest";

import {
  resolveComfyUiTextToImageRequest,
  validateComfyUiInpaintRequest,
  validateComfyUiTextToImageRequest,
} from "./validation";
import { resolveComfyUiTextToImageWorkflowProfile } from "./workflow-profiles";

const kreaRequest = {
  checkpointName: "krea-2-turbo-unet.safetensors",
  workflowProfile: "krea2" as const,
  modelBaseModel: "Krea 2",
  modelStorageKind: "diffusion" as const,
  positivePrompt: "a quiet station",
};

describe("Krea 2 ComfyUI request validation", () => {
  it("resolves the direct txt2img defaults and 16-pixel-aligned dimensions", () => {
    expect(validateComfyUiTextToImageRequest(kreaRequest)).toMatchObject({ ok: true });
    expect(resolveComfyUiTextToImageRequest({
      ...kreaRequest,
      width: 1025,
      height: 1023,
    })).toMatchObject({
      workflowProfile: "krea2",
      clipName: "qwen3vl_4b_fp8_scaled.safetensors",
      vaeName: "qwen_image_vae.safetensors",
      modelStorageKind: "diffusion",
      width: 1040,
      height: 1024,
      steps: 8,
      cfg: 1,
      samplerName: "euler",
      scheduler: "simple",
      denoise: 1,
      batchSize: 1,
      latentImageNode: "EmptyLatentImage",
    });
  });

  it.each([
    ["source image", { sourceImageDataUrl: "data:image/png;base64,aGVsbG8=" }, "direct txt2img only"],
    ["Detailer", { faceDetailer: { enabled: true } }, "does not support FaceDetailer"],
    ["style reference", {
      characterReferences: [{
        enabled: true,
        name: "reference",
        images: [{ imageName: "reference.png" }],
      }],
    }, "does not support style or IPAdapter"],
    ["ControlNet", { controlNets: [{ type: "openpose", enabled: true, svg: "<svg />" }] }, "does not support ControlNet"],
    ["preview", { preview: true }, "does not support preview generation"],
  ])("rejects Krea %s requests", (_label, override, message) => {
    expect(validateComfyUiTextToImageRequest({ ...kreaRequest, ...override })).toMatchObject({
      ok: false,
      message: expect.stringContaining(message),
    });
  });

  it("rejects Krea inpaint and repair requests before source or mask handling", () => {
    expect(validateComfyUiInpaintRequest(kreaRequest)).toEqual({
      ok: false,
      message: "Krea 2 Turbo supports direct txt2img only; inpaint and repair are not supported.",
    });
  });

  it("fails closed when a Krea profile is explicitly requested without Krea diffusion metadata", () => {
    const nonKreaRequests = [
      {
        ...kreaRequest,
        modelStorageKind: "checkpoint" as const,
      },
      {
        ...kreaRequest,
        modelBaseModel: "Illustrious",
      },
      {
        checkpointName: "Krea_2_Turbo.safetensors",
        workflowProfile: "krea2" as const,
        modelStorageKind: "diffusion" as const,
        positivePrompt: "a normal txt2img request",
      },
    ];

    for (const request of nonKreaRequests) {
      expect(resolveComfyUiTextToImageWorkflowProfile(request).id).toBe("default");
      expect(validateComfyUiTextToImageRequest({
        ...request,
        sourceImageDataUrl: "data:image/png;base64,aGVsbG8=",
      })).toMatchObject({
        ok: false,
        message: "Krea 2 Turbo requires a normalized Krea 2 base model and diffusion model storage.",
      });
    }
  });
});
