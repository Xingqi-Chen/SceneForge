import { describe, expect, it } from "vitest";

import {
  applyComfyUiGenerationDiagnosisAdjustments,
  buildComfyUiGenerationAdjustmentMessages,
  buildComfyUiGenerationVisualDiagnosisMessages,
  parseComfyUiGenerationDiagnosisResponse,
  parseComfyUiGenerationVisualDiagnosisResponse,
  type ComfyUiGenerationDiagnosisConfig,
} from "./comfyui-generation-diagnosis";

const currentConfig: ComfyUiGenerationDiagnosisConfig = {
  cfg: 7,
  checkpointBaseModel: "Pony",
  checkpointName: "base.safetensors",
  checkpointPromptReferences: [
    {
      cfgScale: 5.5,
      civitaiImagePageUrl: "https://civitai.com/images/123",
      negativePrompt: "worst quality",
      prompt: "masterpiece, cinematic portrait, detailed eyes",
      sampler: "DPM++ 2M SDE",
      seed: "42",
      steps: 28,
    },
    {
      cfgScale: 7,
      civitaiImagePageUrl: "https://civitai.com/images/456",
      negativePrompt: "bad anatomy",
      prompt: "second reference prompt should not be sent",
      sampler: "Euler",
      seed: "84",
      steps: 32,
    },
  ],
  checkpointResourceName: "Base Checkpoint",
  checkpointTags: ["realistic", "portrait"],
  denoise: 1,
  height: 768,
  imageCount: 2,
  loras: [
    {
      averageWeight: 0.72,
      categories: ["style"],
      enabled: true,
      loraName: "style.safetensors",
      maxWeight: 0.9,
      minWeight: 0.5,
      recommendations: [
        {
          baseModel: "Pony",
          checkpoint: "Base Checkpoint",
          condition: "default",
          hdRedrawRate: null,
          loraWeight: 0.75,
          loraWeightMax: 0.9,
          loraWeightMin: 0.6,
          notes: "Keep weight moderate for clean edges.",
          sampler: "DPM++ 2M",
        },
      ],
      resourceName: "Style LoRA",
      strengthClip: 0.7,
      strengthModel: 0.7,
      tags: ["cinematic", "detail"],
      trainedWords: ["style trigger"],
      usageGuide: "Use with balanced lighting.",
    },
    {
      enabled: true,
      loraName: "detail.safetensors",
      resourceName: "Detail LoRA",
      strengthClip: 0.5,
      strengthModel: 0.5,
    },
  ],
  negativePrompt: "low quality",
  outputPrefix: "SceneForge",
  positivePrompt: "portrait",
  samplerName: "euler",
  scheduler: "normal",
  seed: 123,
  seedMode: "random",
  steps: 30,
  width: 1344,
};

const visualDiagnosis = {
  confidence: 0.82,
  loraInfluence: "Style LoRA is slightly too strong.",
  observations: [
    {
      category: "face",
      evidence: "Eyes are soft.",
      fixDirection: "Increase detail and reduce style strength.",
      likelyCause: "Low detail guidance and high LoRA weight.",
      severity: "medium",
    },
  ],
  promptAlignment: "The portrait subject is aligned, but facial clarity is weak.",
  summary: "Face needs sharper details.",
  warnings: ["Do not over-sharpen."],
};

describe("ComfyUI generation diagnosis", () => {
  it("builds stage 1 visual diagnosis messages with high-detail image and resource context", () => {
    const messages = buildComfyUiGenerationVisualDiagnosisMessages({
      config: currentConfig,
      imageDataUrl: "data:image/jpeg;base64,abc",
      userInput: "make the face sharper",
    });

    expect(messages).toHaveLength(2);
    expect(messages[0].content).toContain("Stage 1 task");
    expect(messages[1].content).toEqual([
      {
        type: "text",
        text: expect.stringContaining("make the face sharper"),
      },
      {
        type: "image_url",
        image_url: {
          detail: "high",
          url: "data:image/jpeg;base64,abc",
        },
      },
    ]);

    const textPayload = String((messages[1].content as Array<{ text?: string }>)[0].text);
    expect(textPayload).toContain("visual-diagnosis");
    expect(textPayload).toContain("style.safetensors");
    expect(textPayload).toContain("style trigger");
    expect(textPayload).toContain("Keep weight moderate");
    expect(textPayload).toContain("cinematic portrait");
    expect(textPayload).not.toContain("second reference prompt should not be sent");
    expect(textPayload).toContain("without client-side downscaling");
    expect(textPayload).not.toContain("civitaiImagePageUrl");
    expect(textPayload).not.toContain("https://civitai.com/images/123");
  });

  it("builds stage 2 adjustment messages from visual diagnosis without resending image", () => {
    const messages = buildComfyUiGenerationAdjustmentMessages({
      config: currentConfig,
      userInput: "make the face sharper",
      visualDiagnosis,
      webContext: {
        enabled: true,
        queries: ["Style LoRA recommended weight"],
        sources: [
          {
            content: "Recommended weight is around 0.6 to 0.8.",
            domain: "civitai.com",
            query: "Style LoRA recommended weight",
            relevance: "Current checkpoint and LoRA usage guidance",
            score: 0.9,
            title: "Style LoRA guide",
            url: "https://civitai.com/articles/style",
          },
        ],
        summary: "Use moderate LoRA weight.",
        warnings: [],
      },
    });

    expect(messages).toHaveLength(2);
    expect(messages[0].content).toContain("Stage 2 task");
    expect(messages[0].content).toContain("changeRationale");
    expect(typeof messages[1].content).toBe("string");
    expect(messages[1].content).toContain("Face needs sharper details");
    expect(messages[1].content).toContain("webContext");
    expect(messages[1].content).toContain("Style LoRA guide");
    expect(messages[1].content).toContain("parameter-adjustment");
    expect(messages[1].content).not.toContain("data:image");
    expect(messages[1].content).not.toContain("new checkpoint");
  });

  it("parses fenced visual diagnosis JSON", () => {
    const parsed = parseComfyUiGenerationVisualDiagnosisResponse(
      "```json\n" +
        JSON.stringify({
          ...visualDiagnosis,
          confidence: 1.5,
        }) +
        "\n```",
    );

    expect(parsed).toMatchObject({
      confidence: 1,
      loraInfluence: "Style LoRA is slightly too strong.",
      observations: [
        {
          category: "face",
          severity: "medium",
        },
      ],
      promptAlignment: "The portrait subject is aligned, but facial clarity is weak.",
      summary: "Face needs sharper details.",
      warnings: ["Do not over-sharpen."],
    });
  });

  it("parses fenced adjustment JSON and sanitizes adjustments", () => {
    const parsed = parseComfyUiGenerationDiagnosisResponse(
      "```json\n" +
        JSON.stringify({
          summary: "脸部偏糊。",
          reasoning: "需要更强细节和更保守的 LoRA。",
          confidence: 0.76,
          changeRationale: [
            {
              field: "positivePrompt",
              reason: "Add face detail guidance.",
              expectedEffect: "Sharper eyes.",
              risk: "Can add over-sharpened texture.",
            },
          ],
          adjustments: {
            checkpointName: "new.safetensors",
            positivePrompt: "sharp portrait",
            width: 1025,
            height: 777,
            steps: "32",
            cfg: 4.5,
            denoise: 2,
            seed: "456",
            loras: [
              { loraName: "Style LoRA", enabled: false, strengthModel: 0.82, reason: "风格过重" },
              { loraName: "unknown.safetensors", enabled: true, strengthModel: 0.4 },
            ],
          },
          warnings: ["建议重新生成确认。"],
        }) +
        "\n```",
      currentConfig,
    );

    expect(parsed).toMatchObject({
      adjustments: {
        cfg: 4.5,
        denoise: 1,
        height: 776,
        positivePrompt: "sharp portrait",
        seed: 456,
        seedMode: "fixed",
        steps: 32,
        width: 1024,
        loras: [
          {
            enabled: false,
            loraName: "style.safetensors",
            reason: "风格过重",
            strengthModel: 0.82,
          },
        ],
      },
      changeRationale: [
        {
          expectedEffect: "Sharper eyes.",
          field: "positivePrompt",
          reason: "Add face detail guidance.",
          risk: "Can add over-sharpened texture.",
        },
      ],
      confidence: 0.76,
      ignored: [
        "Ignored checkpoint change suggestion.",
        "Ignored unknown LoRA: unknown.safetensors.",
      ],
      warnings: ["建议重新生成确认。"],
    });
  });

  it("applies prompt, sampler, seed, and current LoRA changes", () => {
    const next = applyComfyUiGenerationDiagnosisAdjustments(currentConfig, {
      negativePrompt: "",
      positivePrompt: "better portrait",
      samplerName: "dpmpp_2m_sde",
      seedMode: "fixed",
      loras: [
        {
          enabled: false,
          loraName: "detail.safetensors",
          strengthModel: 0.25,
        },
      ],
    });

    expect(next).toMatchObject({
      negativePrompt: "",
      positivePrompt: "better portrait",
      samplerName: "dpmpp_2m_sde",
      seedMode: "fixed",
    });
    expect(next.loras[0]).toMatchObject({
      enabled: true,
      strengthModel: 0.7,
    });
    expect(next.loras[1]).toMatchObject({
      enabled: false,
      strengthClip: 0.25,
      strengthModel: 0.25,
    });
  });

  it("returns null for non-JSON responses", () => {
    expect(parseComfyUiGenerationVisualDiagnosisResponse("face is soft")).toBeNull();
    expect(parseComfyUiGenerationDiagnosisResponse("try lowering cfg", currentConfig)).toBeNull();
  });
});
