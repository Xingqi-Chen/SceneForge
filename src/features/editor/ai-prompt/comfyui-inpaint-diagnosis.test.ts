import { describe, expect, it } from "vitest";

import { MIN_COMFYUI_VAE_INPAINT_DENOISE } from "@/features/comfyui";
import {
  applyComfyUiInpaintDiagnosisAdjustments,
  buildComfyUiInpaintDiagnosisMessages,
  hasComfyUiInpaintDiagnosisMask,
  parseComfyUiInpaintDiagnosisResponse,
  type ComfyUiInpaintDiagnosisConfig,
} from "./comfyui-inpaint-diagnosis";

const currentConfig: ComfyUiInpaintDiagnosisConfig = {
  brushSize: 48,
  checkpointBaseModel: "Pony",
  checkpointName: "base.safetensors",
  checkpointPromptReferences: [
    {
      cfgScale: 6,
      civitaiImagePageUrl: "https://civitai.com/images/123",
      negativePrompt: "worst quality",
      prompt: "masterpiece, detailed face, soft light",
      sampler: "Euler",
      seed: "42",
      steps: 30,
    },
    {
      cfgScale: 7,
      civitaiImagePageUrl: "https://civitai.com/images/456",
      negativePrompt: "bad anatomy",
      prompt: "second reference should not be sent",
      sampler: "DPM++ 2M",
      seed: "84",
      steps: 32,
    },
  ],
  checkpointResourceName: "Base Checkpoint",
  checkpointTags: ["portrait"],
  denoise: 0.65,
  faceDetailerEnabled: false,
  growMaskBy: 6,
  handDetailerEnabled: false,
  image: {
    filename: "source.png",
    height: 768,
    seed: 123,
    width: 1024,
  },
  loras: [
    {
      averageWeight: 0.7,
      categories: ["style"],
      enabled: true,
      loraName: "style.safetensors",
      maxWeight: 0.9,
      minWeight: 0.4,
      recommendations: [
        {
          baseModel: "Pony",
          checkpoint: "Base Checkpoint",
          condition: "default",
          hdRedrawRate: null,
          loraWeight: 0.65,
          loraWeightMax: 0.8,
          loraWeightMin: 0.5,
          notes: "Use a moderate weight for clean details.",
          sampler: "Euler",
        },
      ],
      resourceName: "Style LoRA",
      strengthClip: 0.7,
      strengthModel: 0.7,
      tags: ["detail"],
      trainedWords: ["style trigger"],
      usageGuide: "Keep denoise moderate for repairs.",
    },
  ],
  mode: "latent-noise-mask",
  negativePrompt: "blurry",
  positivePrompt: "portrait, detailed eyes",
};

describe("ComfyUI inpaint diagnosis", () => {
  it("builds inpaint diagnosis messages with image, user guidance, and resource context", () => {
    const messages = buildComfyUiInpaintDiagnosisMessages({
      config: currentConfig,
      imageDataUrl: "data:image/png;base64,abc",
      userInput: "fix the left eye only",
    });

    expect(messages).toHaveLength(2);
    expect(messages[0].content).toContain("ComfyUI inpainting diagnostician");
    expect(messages[0].content).toContain("normalized to image space");
    expect(messages[1].content).toEqual([
      {
        type: "text",
        text: expect.stringContaining("fix the left eye only"),
      },
      {
        type: "image_url",
        image_url: {
          detail: "high",
          url: "data:image/png;base64,abc",
        },
      },
    ]);

    const textPayload = String((messages[1].content as Array<{ text?: string }>)[0].text);
    expect(textPayload).toContain("inpaint-diagnosis");
    expect(textPayload).toContain("style.safetensors");
    expect(textPayload).toContain("style trigger");
    expect(textPayload).toContain("Keep denoise moderate");
    expect(textPayload).toContain("masterpiece, detailed face");
    expect(textPayload).not.toContain("second reference should not be sent");
    expect(textPayload).not.toContain("civitaiImagePageUrl");
  });

  it("parses fenced JSON and sanitizes local inpaint adjustments", () => {
    const parsed = parseComfyUiInpaintDiagnosisResponse(
      "```json\n" +
        JSON.stringify({
          summary: "左眼需要局部修复。",
          reasoning: "只需要遮住眼睛和附近皮肤。",
          confidence: 1.2,
          mask: {
            note: "Mask the damaged eye.",
            coverageEstimate: 0.03,
            shapes: [
              { type: "ellipse", x: 1.4, y: -0.2, radiusX: 0.08, radiusY: 0.06, rotation: 270 },
              { type: "rect", left: 0.25, top: 0.3, width: 0.12, height: 0.08 },
              {
                type: "stroke",
                brushSize: 999,
                points: [
                  { x: 0.2, y: 0.3 },
                  [0.24, 0.34],
                ],
              },
              { type: "polygon", points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.1 }] },
            ],
          },
          adjustments: {
            positivePrompt: "portrait, repaired left eye",
            negativePrompt: "",
            denoise: 2,
            growMaskBy: "9",
            mode: "vae-inpaint",
            seed: "456",
            brushSize: 2,
            faceDetailerEnabled: "enabled",
            handDetailerEnabled: "off",
            cfg: 12,
          },
          changeRationale: [
            {
              field: "denoise",
              reason: "The repair is small.",
              expectedEffect: "Cleaner local repaint.",
              risk: "May not fully replace the artifact.",
            },
          ],
          warnings: ["Review mask before applying."],
        }) +
        "\n```",
    );

    expect(parsed).toMatchObject({
      adjustments: {
        brushSize: 4,
        denoise: 1,
        faceDetailerEnabled: true,
        growMaskBy: 9,
        handDetailerEnabled: false,
        mode: "vae-inpaint",
        negativePrompt: "",
        positivePrompt: "portrait, repaired left eye",
        seed: 456,
      },
      changeRationale: [
        {
          expectedEffect: "Cleaner local repaint.",
          field: "denoise",
          reason: "The repair is small.",
          risk: "May not fully replace the artifact.",
        },
      ],
      confidence: 1,
      ignored: ["Ignored polygon mask shape with fewer than three points."],
      mask: {
        coverageEstimate: 0.03,
        note: "Mask the damaged eye.",
        shapes: [
          {
            radiusX: 0.08,
            radiusY: 0.06,
            rotation: 180,
            type: "ellipse",
            x: 1,
            y: 0,
          },
          {
            height: 0.08,
            type: "rect",
            width: 0.12,
            x: 0.31,
            y: 0.34,
          },
          {
            brushSize: 64,
            points: [
              { x: 0.2, y: 0.3 },
              { x: 0.24, y: 0.34 },
            ],
            type: "stroke",
          },
        ],
      },
      warnings: ["Review mask before applying."],
    });
    expect(parsed?.adjustments).not.toHaveProperty("cfg");
    expect(hasComfyUiInpaintDiagnosisMask(parsed)).toBe(true);
  });

  it("normalizes pixel and percent mask coordinates against the source image size", () => {
    const parsed = parseComfyUiInpaintDiagnosisResponse(
      JSON.stringify({
        mask: {
          coordinateUnit: "pixel",
          shapes: [
            { type: "rect", x: 256, y: 384, width: 128, height: 96 },
            { type: "stroke", brushSize: 90, points: [[512, 384]] },
            { type: "ellipse", coordinateUnit: "percent", x: 50, y: 40, radiusX: 8, radiusY: 5 },
          ],
        },
        adjustments: {
          brushSize: 0.04,
        },
      }),
      currentConfig,
    );

    expect(parsed).toMatchObject({
      adjustments: {
        brushSize: 31,
      },
      mask: {
        shapes: [
          {
            height: 0.125,
            type: "rect",
            width: 0.125,
            x: 0.3125,
            y: 0.5625,
          },
          {
            brushSize: 35,
            points: [{ x: 0.5, y: 0.5 }],
            type: "stroke",
          },
          {
            radiusX: 0.08,
            radiusY: 0.05,
            type: "ellipse",
            x: 0.5,
            y: 0.4,
          },
        ],
      },
    });
  });

  it("ignores empty masks so they cannot be applied", () => {
    const parsed = parseComfyUiInpaintDiagnosisResponse(
      JSON.stringify({
        mask: {
          shapes: [
            { type: "stroke", points: [] },
            { type: "triangle", points: [{ x: 0.1, y: 0.1 }] },
          ],
        },
        adjustments: {
          denoise: 0.45,
        },
      }),
    );

    expect(parsed?.mask.shapes).toEqual([]);
    expect(parsed?.ignored).toEqual([
      "Ignored stroke mask shape without valid points.",
      "Ignored mask shape without a supported type.",
      "Ignored empty or invalid AI mask suggestion.",
    ]);
    expect(hasComfyUiInpaintDiagnosisMask(parsed)).toBe(false);
  });

  it("applies prompt, mask parameter, seed, and detailer adjustments", () => {
    const next = applyComfyUiInpaintDiagnosisAdjustments(currentConfig, {
      brushSize: 72,
      denoise: 0.42,
      faceDetailerEnabled: true,
      growMaskBy: 12,
      handDetailerEnabled: true,
      mode: "vae-inpaint",
      negativePrompt: "bad eye",
      positivePrompt: "fixed portrait",
      seed: 789,
    });

    expect(next).toMatchObject({
      brushSize: 72,
      denoise: MIN_COMFYUI_VAE_INPAINT_DENOISE,
      faceDetailerEnabled: true,
      growMaskBy: 12,
      handDetailerEnabled: true,
      image: {
        seed: 789,
      },
      mode: "vae-inpaint",
      negativePrompt: "bad eye",
      positivePrompt: "fixed portrait",
    });
  });

  it("returns null for non-JSON responses", () => {
    expect(parseComfyUiInpaintDiagnosisResponse("paint the eye")).toBeNull();
  });
});
