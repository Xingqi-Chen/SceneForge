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
  it("resolves staged preview defaults while preserving already 16-pixel-aligned dimensions", () => {
    expect(validateComfyUiTextToImageRequest(kreaRequest)).toMatchObject({ ok: true });
    expect(resolveComfyUiTextToImageRequest({
      ...kreaRequest,
      width: 1040,
      height: 1024,
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
    ["entity or character reference", {
      characterReferences: [{
        enabled: true,
        name: "reference",
        images: [{ imageName: "reference.png" }],
      }],
    }, "does not support entity or character references"],
    ["ControlNet", { controlNets: [{ type: "openpose", enabled: true, svg: "<svg />" }] }, "does not support ControlNet"],
  ])("rejects Krea %s requests", (_label, override, message) => {
    expect(validateComfyUiTextToImageRequest({ ...kreaRequest, ...override })).toMatchObject({
      ok: false,
      message: expect.stringContaining(message),
    });
  });

  it("preserves independent Krea Final Detailers while legacy defaults remain off", () => {
    const request = resolveComfyUiTextToImageRequest({
      ...kreaRequest,
      faceDetailer: {
        enabled: true,
        detectorModelName: "bbox/custom-face.pt",
        denoise: 0.42,
        steps: 18,
      },
      handDetailer: {
        enabled: false,
        detectorModelName: "bbox/custom-hand.pt",
        steps: 21,
      },
    });

    expect(validateComfyUiTextToImageRequest({
      ...kreaRequest,
      faceDetailer: request.faceDetailer,
      handDetailer: request.handDetailer,
    })).toMatchObject({ ok: true });
    expect(request).toMatchObject({
      faceDetailer: {
        enabled: true,
        detectorModelName: "bbox/custom-face.pt",
        denoise: 0.42,
        steps: 18,
      },
      handDetailer: {
        enabled: false,
        detectorModelName: "bbox/custom-hand.pt",
        steps: 21,
      },
    });
    expect(resolveComfyUiTextToImageRequest(kreaRequest)).toMatchObject({
      faceDetailer: { enabled: false },
      handDetailer: { enabled: false },
    });
  });

  it("accepts Krea source img2img and preview requests, but rejects unaligned formal dimensions", () => {
    expect(validateComfyUiTextToImageRequest({
      ...kreaRequest,
      sourceImageDataUrl: "data:image/png;base64,aGVsbG8=",
      imageHeight: 1024,
      imageWidth: 1040,
      preview: true,
      width: 1040,
      height: 1024,
    })).toMatchObject({
      ok: true,
      request: {
        preview: true,
        sourceImageDataUrl: "data:image/png;base64,aGVsbG8=",
        imageWidth: 1040,
        imageHeight: 1024,
      },
    });

    expect(validateComfyUiTextToImageRequest({
      ...kreaRequest,
      width: 1025,
      height: 1024,
    })).toMatchObject({
      ok: false,
      message: "Krea 2 Turbo width and height must be divisible by 16 without aspect-ratio rounding.",
    });
  });

  it("accepts only the bounded Krea repair graph with independently selected Detailers", () => {
    const compatibleRepair = {
      ...kreaRequest,
      imageHeight: 1024,
      imageWidth: 1024,
      inpaintMode: "latent-noise-mask" as const,
      maskDataUrl: "data:image/png;base64,aGVsbG8=",
      sourceImageDataUrl: "data:image/png;base64,aGVsbG8=",
      upscaleBeforeInpaint: {
        enabled: true,
        localRegion: { feather: 16, padding: 32, source: "mask-bounds" as const },
        mode: "lanczos" as const,
        scaleBy: 2 as const,
        strategy: "local-region" as const,
      },
    };

    expect(validateComfyUiInpaintRequest(compatibleRepair)).toMatchObject({
      ok: true,
      request: {
        workflowProfile: "krea2",
        inpaintMode: "latent-noise-mask",
      },
    });
    expect(validateComfyUiInpaintRequest({
      ...compatibleRepair,
      faceDetailer: { enabled: true },
      handDetailer: { enabled: false },
    })).toMatchObject({
      ok: true,
      request: {
        faceDetailer: { enabled: true },
        handDetailer: { enabled: false },
        workflowProfile: "krea2",
      },
    });
    expect(validateComfyUiInpaintRequest({
      ...compatibleRepair,
      imageWidth: 1025,
    })).toEqual({
      ok: false,
      message: "Krea 2 Turbo repair source dimensions must be exact 16-pixel-aligned integers.",
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

  it("accepts only the verified Krea adapter file and fixed reference timing", () => {
    expect(validateComfyUiTextToImageRequest({
      ...kreaRequest,
      krea2StyleReference: { imageName: "sceneforge-krea-style.png", weight: 0.55 },
    })).toMatchObject({
      ok: true,
      request: {
        krea2StyleReference: {
          imageName: "sceneforge-krea-style.png",
          weight: 0.55,
        },
      },
    });
    expect(resolveComfyUiTextToImageRequest({
      ...kreaRequest,
      krea2StyleReference: { imageName: "sceneforge-krea-style.png", weight: 0.55 },
    }).krea2StyleReference).toEqual({
      imageName: "sceneforge-krea-style.png",
      loraName: "krea2_style_reference.safetensors",
      weight: 0.55,
      startPercent: 0,
      endPercent: 1,
    });

    for (const krea2StyleReference of [
      { imageName: "style.png", loraName: "other.safetensors" },
      { imageName: "style.png", startPercent: 0.1 },
      { imageName: "style.png", endPercent: 0.9 },
    ]) {
      expect(validateComfyUiTextToImageRequest({ ...kreaRequest, krea2StyleReference })).toMatchObject({
        ok: false,
      });
    }
  });

  it("accepts only the fixed single-image Krea2 ReID transport and server-owned descriptor", () => {
    const descriptor = {
      version: 1 as const,
      referenceDigest: `sha256:${"a".repeat(64)}`,
      loraName: "krea2_reid_rank32.safetensors" as const,
      strengthModel: 1 as const,
      kvCache: true as const,
      imageCount: 1 as const,
    };
    const valid = validateComfyUiTextToImageRequest({
      ...kreaRequest,
      steps: 8,
      cfg: 1,
      samplerName: "euler",
      scheduler: "simple",
      krea2ReId: { imageName: "sceneforge-krea-reid.png" },
      krea2ReIdDescriptor: descriptor,
    });

    expect(valid).toMatchObject({
      ok: true,
      request: {
        characterReferences: undefined,
        krea2ReId: { imageName: "sceneforge-krea-reid.png" },
        krea2ReIdDescriptor: descriptor,
      },
    });
    expect(resolveComfyUiTextToImageRequest(valid.ok ? valid.request : kreaRequest)).toMatchObject({
      steps: 8,
      cfg: 1,
      samplerName: "euler",
      scheduler: "simple",
      krea2ReId: { imageName: "sceneforge-krea-reid.png" },
    });

    for (const override of [
      { krea2ReId: { imageName: "reid.png", image2: "second.png" } },
      { krea2ReIdDescriptor: { ...descriptor, strengthModel: 0.8 } },
      { krea2ReIdDescriptor: { ...descriptor, kvCache: false } },
      { krea2ReIdDescriptor: { ...descriptor, imageCount: 2 } },
      { steps: 6 },
      { cfg: 2 },
      { samplerName: "dpmpp_2m" },
      { scheduler: "normal" },
      { loras: [{ loraName: "krea2_reid_rank32.safetensors", strengthModel: 1 }] },
      { krea2StyleReference: { imageName: "style.png" } },
      { characterReferences: [{ enabled: true, name: "legacy", images: [{ imageName: "legacy.png" }] }] },
    ]) {
      expect(validateComfyUiTextToImageRequest({
        ...kreaRequest,
        steps: 8,
        cfg: 1,
        samplerName: "euler",
        scheduler: "simple",
        krea2ReId: { imageName: "sceneforge-krea-reid.png" },
        krea2ReIdDescriptor: descriptor,
        ...override,
      }), JSON.stringify(override)).toMatchObject({ ok: false });
    }
  });

  it("rejects every functional ReID field and adapter from Krea Repair", () => {
    const repair = {
      checkpointName: "RedCraft_v4_fp8.safetensors",
      modelBaseModel: "Krea 2",
      modelStorageKind: "diffusion" as const,
      workflowProfile: "krea2" as const,
      positivePrompt: "repair the hand",
      imageName: "source.png",
      maskImageName: "mask.png",
      imageWidth: 1024,
      imageHeight: 1024,
    };

    expect(validateComfyUiInpaintRequest({
      ...repair,
      krea2ReId: { imageName: "reid.png" },
    })).toMatchObject({ ok: false, message: expect.stringContaining("never allowed in Repair") });
    expect(validateComfyUiInpaintRequest({
      ...repair,
      krea2ReIdDescriptor: {
        version: 1,
        referenceDigest: `sha256:${"a".repeat(64)}`,
        loraName: "krea2_reid_rank32.safetensors",
        strengthModel: 1,
        kvCache: true,
        imageCount: 1,
      },
    })).toMatchObject({ ok: false, message: expect.stringContaining("never allowed in Repair") });
    expect(validateComfyUiInpaintRequest({
      ...repair,
      loras: [{ loraName: "krea2_reid_rank32.safetensors", strengthModel: 1 }],
    })).toMatchObject({ ok: false });
  });
});
