import { describe, expect, it } from "vitest";

import { validateComfyUiSam2MaskRequestAgainstObjectInfo } from "./object-info";
import { validateComfyUiSam2MaskRequest } from "./validation";

const sam2ObjectInfo = {
  DownloadAndLoadSAM2Model: {
    input: {
      required: {
        model: [["sam2.1_hiera_small.safetensors", "sam2.1_hiera_large.safetensors"], {}],
        device: [["cuda", "cpu", "mps"], {}],
        precision: [["fp16", "bf16", "fp32"], {}],
      },
    },
  },
  Sam2Segmentation: {},
  LoadImage: {},
  MaskToImage: {},
  SaveImage: {},
};

describe("ComfyUI SAM2 mask validation", () => {
  it("clips point and box coordinates to the source image", () => {
    const result = validateComfyUiSam2MaskRequest({
      sourceImage: {
        filename: "source.png",
        type: "output",
      },
      imageWidth: 100,
      imageHeight: 80,
      positivePoints: [{ x: -8.2, y: 88.6 }],
      negativePoints: [{ x: 250, y: 10.2 }],
      bbox: {
        x: -20,
        y: 12,
        width: 180,
        height: 120,
      },
    });

    expect(result).toMatchObject({
      ok: true,
      request: {
        positivePoints: [{ x: 0, y: 79 }],
        negativePoints: [{ x: 99, y: 10 }],
        bbox: {
          x: 0,
          y: 12,
          width: 100,
          height: 68,
        },
      },
    });
  });

  it("rejects empty SAM prompts", () => {
    expect(
      validateComfyUiSam2MaskRequest({
        sourceImage: {
          filename: "source.png",
        },
        imageWidth: 100,
        imageHeight: 80,
      }),
    ).toMatchObject({
      ok: false,
      message: "Add at least one positive point or one box before generating a SAM mask.",
    });
  });

  it("normalizes CPU precision through object_info validation", () => {
    const validation = validateComfyUiSam2MaskRequest({
      sourceImage: {
        filename: "source.png",
      },
      imageWidth: 100,
      imageHeight: 80,
      positivePoints: [{ x: 50, y: 40 }],
      device: "cpu",
      precision: "fp16",
    });

    expect(validation.ok).toBe(true);
    if (!validation.ok) {
      return;
    }

    expect(
      validateComfyUiSam2MaskRequestAgainstObjectInfo(validation.request, sam2ObjectInfo),
    ).toMatchObject({
      errors: [],
      warnings: ["Normalized SAM2 precision fp16 to fp32 because CPU does not support fp16/bf16."],
      request: {
        device: "cpu",
        precision: "fp32",
      },
    });
  });

  it("reports missing SAM2 nodes clearly", () => {
    const validation = validateComfyUiSam2MaskRequest({
      sourceImage: {
        filename: "source.png",
      },
      imageWidth: 100,
      imageHeight: 80,
      bbox: {
        x: 10,
        y: 10,
        width: 20,
        height: 20,
      },
    });

    expect(validation.ok).toBe(true);
    if (!validation.ok) {
      return;
    }

    expect(validateComfyUiSam2MaskRequestAgainstObjectInfo(validation.request, {})).toMatchObject({
      errors: [
        "DownloadAndLoadSAM2Model node is not available in ComfyUI. It is required for SAM2 mask generation.",
        "Sam2Segmentation node is not available in ComfyUI. It is required for SAM2 mask generation.",
        "LoadImage node is not available in ComfyUI. It is required for SAM2 source images.",
        "MaskToImage node is not available in ComfyUI. It is required to preview SAM2 masks.",
        "SaveImage node is not available in ComfyUI. It is required to return SAM2 mask previews.",
      ],
    });
  });
});
