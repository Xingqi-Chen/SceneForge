import { describe, expect, it } from "vitest";

import {
  summarizeComfyUiErrorDetails,
  validateComfyUiInpaintRequestAgainstObjectInfo,
  validateComfyUiRequestAgainstObjectInfo,
} from "./object-info";

const objectInfo = {
  CheckpointLoaderSimple: {
    input: {
      required: {
        ckpt_name: [["model.safetensors"], {}],
      },
    },
  },
  LoraLoader: {
    input: {
      required: {
        lora_name: [["style.safetensors"], {}],
      },
    },
  },
  KSampler: {
    input: {
      required: {
        sampler_name: [["euler", "dpmpp_2m"], {}],
        scheduler: [["normal", "karras"], {}],
      },
    },
  },
  EmptyLatentImage: {},
  EmptySD3LatentImage: {},
  FaceDetailer: {},
  UltralyticsDetectorProvider: {
    input: {
      required: {
        model_name: [["bbox/face_yolov8s.pt", "bbox/hand_yolov8s.pt", "bbox/person_yolov8n.pt"], {}],
      },
    },
  },
};

const objectInfoWithControlNet = {
  ...objectInfo,
  LoadImage: {},
  ControlNetApplyAdvanced: {},
  ControlNetLoader: {
    input: {
      required: {
        control_net_name: [
          [
            "control_v11p_sd15_openpose.pth",
            "control_v11f1p_sd15_depth.pth",
            "control_v11p_sd15_normalbae.pth",
            "other-controlnet.safetensors",
          ],
          {},
        ],
      },
    },
  },
};

const objectInfoWithInpaint = {
  ...objectInfo,
  LoadImage: {},
  LoadImageMask: {},
  SetLatentNoiseMask: {},
  VAEEncode: {},
  VAEEncodeForInpaint: {},
  VAEDecode: {},
};

describe("ComfyUI object info helpers", () => {
  it("normalizes common sampler display names", () => {
    expect(
      validateComfyUiRequestAgainstObjectInfo(
        {
          checkpointName: "model.safetensors",
          positivePrompt: "scene",
          samplerName: "DPM++ 2M",
          scheduler: "Karras",
          width: 1024,
          height: 1024,
          loras: [{ loraName: "style.safetensors", strengthModel: 0.7 }],
        },
        objectInfo,
      ),
    ).toMatchObject({
      errors: [],
      request: {
        samplerName: "dpmpp_2m",
        scheduler: "karras",
      },
    });

    expect(
      validateComfyUiRequestAgainstObjectInfo(
        {
          checkpointName: "model.safetensors",
          positivePrompt: "scene",
          samplerName: "DPM++ 2M Karras",
          scheduler: "normal",
          width: 1024,
          height: 1024,
        },
        objectInfo,
      ),
    ).toMatchObject({
      errors: [],
      request: {
        samplerName: "dpmpp_2m",
        scheduler: "karras",
      },
    });

    expect(
      validateComfyUiRequestAgainstObjectInfo(
        {
          checkpointName: "model.safetensors",
          positivePrompt: "scene",
          samplerName: "DPM++ 2M SDE",
          scheduler: "normal",
          width: 1024,
          height: 1024,
        },
        {
          ...objectInfo,
          KSampler: {
            input: {
              required: {
                sampler_name: [["dpmpp_2m_sde"], {}],
                scheduler: [["normal"], {}],
              },
            },
          },
        },
      ),
    ).toMatchObject({
      errors: [],
      request: {
        samplerName: "dpmpp_2m_sde",
      },
    });

    expect(
      validateComfyUiRequestAgainstObjectInfo(
        {
          checkpointName: "model.safetensors",
          positivePrompt: "scene",
          faceDetailer: {
            enabled: true,
            detectorModelName: "bbox/face_yolov8m.pt",
          },
        },
        objectInfo,
      ),
    ).toMatchObject({
      errors: [],
      request: {
        faceDetailer: {
          enabled: true,
          detectorModelName: "bbox/face_yolov8s.pt",
        },
      },
    });

    expect(
      validateComfyUiRequestAgainstObjectInfo(
        {
          checkpointName: "model.safetensors",
          positivePrompt: "scene",
          samplerName: "DPM++ 2M SDE Karras",
          scheduler: "normal",
          width: 1024,
          height: 1024,
        },
        {
          ...objectInfo,
          KSampler: {
            input: {
              required: {
                sampler_name: [["dpmpp_2m_sde"], {}],
                scheduler: [["normal", "karras"], {}],
              },
            },
          },
        },
      ),
    ).toMatchObject({
      errors: [],
      request: {
        samplerName: "dpmpp_2m_sde",
        scheduler: "karras",
      },
    });

    expect(
      validateComfyUiRequestAgainstObjectInfo(
        {
          checkpointName: "model.safetensors",
          positivePrompt: "scene",
          samplerName: "DPM++ 2M SDE",
          scheduler: "normal",
          width: 1024,
          height: 1024,
        },
        {
          ...objectInfo,
          KSampler: {
            input: {
              required: {
                sampler_name: [["dpmpp_2m_sde_gpu"], {}],
                scheduler: [["normal"], {}],
              },
            },
          },
        },
      ),
    ).toMatchObject({
      errors: [],
      request: {
        samplerName: "dpmpp_2m_sde_gpu",
      },
    });
  });

  it("reports unavailable models and invalid latent dimensions before queueing", () => {
    expect(
      validateComfyUiRequestAgainstObjectInfo(
        {
          checkpointName: "missing.safetensors",
          positivePrompt: "scene",
          samplerName: "DPM++ 4M",
          scheduler: "normal",
          width: 1025,
          height: 1024,
          loras: [{ loraName: "missing-lora.safetensors", strengthModel: 0.7 }],
        },
        objectInfo,
      ).errors,
    ).toEqual([
      "LoRA 1 is not available in ComfyUI: missing-lora.safetensors",
      "Checkpoint is not available in ComfyUI: missing.safetensors",
      "Sampler is not available in ComfyUI: DPM++ 4M",
      "width must be between 16 and 16384 and divisible by 8 for ComfyUI EmptyLatentImage.",
    ]);
  });

  it("validates the requested latent image node before queueing", () => {
    expect(
      validateComfyUiRequestAgainstObjectInfo(
        {
          checkpointName: "model.safetensors",
          positivePrompt: "scene",
          latentImageNode: "EmptySD3LatentImage",
        },
        {
          ...objectInfo,
          EmptySD3LatentImage: undefined,
        },
      ).errors,
    ).toEqual(["Latent image node is not available in ComfyUI: EmptySD3LatentImage"]);
  });

  it("validates and normalizes FaceDetailer detector settings before queueing", () => {
    expect(
      validateComfyUiRequestAgainstObjectInfo(
        {
          checkpointName: "model.safetensors",
          positivePrompt: "scene",
          faceDetailer: {
            enabled: true,
          },
        },
        objectInfo,
      ),
    ).toMatchObject({
      errors: [],
      request: {
        faceDetailer: {
          enabled: true,
          detectorModelName: "bbox/face_yolov8s.pt",
        },
      },
    });

    expect(
      validateComfyUiRequestAgainstObjectInfo(
        {
          checkpointName: "model.safetensors",
          positivePrompt: "scene",
          faceDetailer: {
            enabled: true,
            detectorModelName: "missing.pt",
          },
        },
        objectInfo,
      ).errors,
    ).toEqual(["FaceDetailer detector model is not available in ComfyUI: missing.pt"]);
  });

  it("validates and normalizes HandDetailer detector settings before queueing", () => {
    expect(
      validateComfyUiRequestAgainstObjectInfo(
        {
          checkpointName: "model.safetensors",
          positivePrompt: "scene",
          handDetailer: {
            enabled: true,
          },
        },
        objectInfo,
      ),
    ).toMatchObject({
      errors: [],
      request: {
        handDetailer: {
          enabled: true,
          detectorModelName: "bbox/hand_yolov8s.pt",
        },
      },
    });

    expect(
      validateComfyUiRequestAgainstObjectInfo(
        {
          checkpointName: "model.safetensors",
          positivePrompt: "scene",
          handDetailer: {
            enabled: true,
            detectorModelName: "missing.pt",
          },
        },
        objectInfo,
      ).errors,
    ).toEqual(["HandDetailer detector model is not available in ComfyUI: missing.pt"]);
  });

  it("validates and normalizes ControlNet OpenPose settings before queueing", () => {
    expect(
      validateComfyUiRequestAgainstObjectInfo(
        {
          checkpointName: "model.safetensors",
          positivePrompt: "scene",
          controlNet: {
            enabled: true,
            openPoseSvg: "<svg />",
          },
        },
        objectInfoWithControlNet,
      ),
    ).toMatchObject({
      errors: [],
      request: {
        controlNets: [
          {
            enabled: true,
            modelName: "control_v11p_sd15_openpose.pth",
            type: "openpose",
          },
        ],
      },
    });

    expect(
      validateComfyUiRequestAgainstObjectInfo(
        {
          checkpointName: "model.safetensors",
          positivePrompt: "scene",
          controlNet: {
            enabled: true,
            modelName: "missing-controlnet.safetensors",
            openPoseSvg: "<svg />",
          },
        },
        objectInfoWithControlNet,
      ).errors,
    ).toEqual(["OpenPose ControlNet model is not available in ComfyUI: missing-controlnet.safetensors"]);
  });

  it("validates and normalizes ControlNet Depth settings before queueing", () => {
    expect(
      validateComfyUiRequestAgainstObjectInfo(
        {
          checkpointName: "model.safetensors",
          positivePrompt: "scene",
          controlNets: [
            {
              type: "depth",
              enabled: true,
              svg: "<svg />",
            },
          ],
        },
        objectInfoWithControlNet,
      ),
    ).toMatchObject({
      errors: [],
      request: {
        controlNets: [
          {
            enabled: true,
            modelName: "control_v11f1p_sd15_depth.pth",
            type: "depth",
          },
        ],
      },
    });

    expect(
      validateComfyUiRequestAgainstObjectInfo(
        {
          checkpointName: "model.safetensors",
          positivePrompt: "scene",
          controlNets: [
            {
              type: "depth",
              enabled: true,
              svg: "<svg />",
            },
          ],
        },
        {
          ...objectInfoWithControlNet,
          ControlNetLoader: {
            input: {
              required: {
                control_net_name: [["control_v11p_sd15_openpose.pth"], {}],
              },
            },
          },
        },
      ).errors,
    ).toEqual(["Depth ControlNet model is not available in ComfyUI."]);
  });

  it("validates and normalizes ControlNet Normal settings before queueing", () => {
    expect(
      validateComfyUiRequestAgainstObjectInfo(
        {
          checkpointName: "model.safetensors",
          positivePrompt: "scene",
          controlNets: [
            {
              type: "normal",
              enabled: true,
              imageDataUrl: "data:image/png;base64,aGVsbG8=",
            },
          ],
        },
        objectInfoWithControlNet,
      ),
    ).toMatchObject({
      errors: [],
      request: {
        controlNets: [
          {
            enabled: true,
            modelName: "control_v11p_sd15_normalbae.pth",
            type: "normal",
          },
        ],
      },
    });

    expect(
      validateComfyUiRequestAgainstObjectInfo(
        {
          checkpointName: "model.safetensors",
          positivePrompt: "scene",
          controlNets: [
            {
              type: "normal",
              enabled: true,
              imageDataUrl: "data:image/png;base64,aGVsbG8=",
            },
          ],
        },
        {
          ...objectInfoWithControlNet,
          ControlNetLoader: {
            input: {
              required: {
                control_net_name: [["control_v11f1p_sd15_depth.pth"], {}],
              },
            },
          },
        },
      ).errors,
    ).toEqual(["Normal ControlNet model is not available in ComfyUI."]);
  });

  it("reports missing ControlNet nodes before queueing", () => {
    expect(
      validateComfyUiRequestAgainstObjectInfo(
        {
          checkpointName: "model.safetensors",
          positivePrompt: "scene",
          controlNet: {
            enabled: true,
            openPoseSvg: "<svg />",
          },
        },
        objectInfo,
      ).errors,
    ).toEqual([
      "LoadImage node is not available in ComfyUI. It is required for ControlNet images.",
      "ControlNetLoader node is not available in ComfyUI. Install ControlNet support to use ControlNet.",
      "ControlNetApplyAdvanced node is not available in ComfyUI. Update ComfyUI or install ControlNet support.",
      "OpenPose ControlNet model is not available in ComfyUI.",
    ]);
  });

  it("reports missing FaceDetailer custom nodes before queueing", () => {
    expect(
      validateComfyUiRequestAgainstObjectInfo(
        {
          checkpointName: "model.safetensors",
          positivePrompt: "scene",
          faceDetailer: {
            enabled: true,
          },
        },
        {
          ...objectInfo,
          FaceDetailer: undefined,
          UltralyticsDetectorProvider: undefined,
        },
      ).errors,
    ).toEqual([
      "FaceDetailer node is not available in ComfyUI. Install ComfyUI Impact Pack to use FaceDetailer.",
      "UltralyticsDetectorProvider node is not available in ComfyUI. Install ComfyUI Impact Subpack to use FaceDetailer.",
      "FaceDetailer detector model is not available in ComfyUI.",
    ]);
  });

  it("reports missing HandDetailer custom nodes before queueing", () => {
    expect(
      validateComfyUiRequestAgainstObjectInfo(
        {
          checkpointName: "model.safetensors",
          positivePrompt: "scene",
          handDetailer: {
            enabled: true,
          },
        },
        {
          ...objectInfo,
          FaceDetailer: undefined,
          UltralyticsDetectorProvider: undefined,
        },
      ).errors,
    ).toEqual([
      "FaceDetailer node is not available in ComfyUI. Install ComfyUI Impact Pack to use HandDetailer.",
      "UltralyticsDetectorProvider node is not available in ComfyUI. Install ComfyUI Impact Subpack to use HandDetailer.",
      "HandDetailer detector model is not available in ComfyUI.",
    ]);
  });

  it("validates latent noise mask inpaint nodes before queueing", () => {
    expect(
      validateComfyUiInpaintRequestAgainstObjectInfo(
        {
          checkpointName: "model.safetensors",
          positivePrompt: "replace the window",
          sourceImage: { filename: "source.png", type: "output" },
          maskName: "mask.png",
          samplerName: "DPM++ 2M",
          scheduler: "Karras",
        },
        objectInfoWithInpaint,
      ),
    ).toMatchObject({
      errors: [],
      request: {
        checkpointName: "model.safetensors",
        samplerName: "dpmpp_2m",
        scheduler: "karras",
        inpaintMode: "latent-noise-mask",
      },
    });

    expect(
      validateComfyUiInpaintRequestAgainstObjectInfo(
        {
          checkpointName: "model.safetensors",
          positivePrompt: "replace the window",
          sourceImage: { filename: "source.png", type: "output" },
          maskName: "mask.png",
        },
        {
          ...objectInfoWithInpaint,
          SetLatentNoiseMask: undefined,
        },
      ).errors,
    ).toContain("SetLatentNoiseMask node is not available in ComfyUI. It is required for latent noise mask inpaint mode.");
  });

  it("validates VAE inpaint nodes before queueing", () => {
    expect(
      validateComfyUiInpaintRequestAgainstObjectInfo(
        {
          checkpointName: "model.safetensors",
          positivePrompt: "replace the window",
          sourceImage: { filename: "source.png", type: "output" },
          maskName: "mask.png",
          inpaintMode: "vae-inpaint",
        },
        objectInfoWithInpaint,
      ).errors,
    ).toEqual([]);

    expect(
      validateComfyUiInpaintRequestAgainstObjectInfo(
        {
          checkpointName: "model.safetensors",
          positivePrompt: "replace the window",
          sourceImage: { filename: "source.png", type: "output" },
          maskName: "mask.png",
          inpaintMode: "vae-inpaint",
        },
        {
          ...objectInfoWithInpaint,
          VAEEncodeForInpaint: undefined,
        },
      ).errors,
    ).toContain("VAEEncodeForInpaint node is not available in ComfyUI. It is required for VAE inpaint mode.");
  });

  it("summarizes nested ComfyUI node errors", () => {
    expect(
      summarizeComfyUiErrorDetails({
        node_errors: {
          "2": {
            class_type: "LoraLoader",
            errors: [
              {
                message: "Value not in list",
                details: "lora_name: missing.safetensors",
                extra_info: { input_name: "lora_name" },
              },
            ],
          },
        },
      }),
    ).toEqual(["Node 2 (LoraLoader): lora_name: Value not in list lora_name: missing.safetensors"]);
  });
});
