// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const completeChatMock = vi.hoisted(() => vi.fn());
const createLiteLlmClientMock = vi.hoisted(() => vi.fn(() => ({
  completeChat: completeChatMock,
})));

vi.mock("@/features/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/llm")>();
  return {
    ...actual,
    createLiteLlmClient: createLiteLlmClientMock,
  };
});

vi.mock("@/features/llm/llm-local-log", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/llm/llm-local-log")>();
  return {
    ...actual,
    appendLlmLocalLog: vi.fn(async () => undefined),
  };
});

import { POST, resolveDefaultModel, resolveRequestModel } from "./route";

const ENV_KEYS = [
  "LITELLM_DEFAULT_MODEL",
  "LITELLM_NSFW_MODEL",
  "LITELLM_POSE_MODEL",
  "LITELLM_COMFYUI_DIAGNOSIS_MODEL",
  "LITELLM_CLASSIFICATION_MODEL",
  "LITELLM_VISION_MODEL",
] as const;

describe("LLM chat route model selection", () => {
  let previousEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;

  beforeEach(() => {
    previousEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    process.env.LITELLM_DEFAULT_MODEL = "default-model";
    process.env.LITELLM_NSFW_MODEL = "nsfw-model";
    process.env.LITELLM_POSE_MODEL = "pose-model";
    process.env.LITELLM_COMFYUI_DIAGNOSIS_MODEL = "diagnosis-model";
    process.env.LITELLM_CLASSIFICATION_MODEL = "classification-model";
    process.env.LITELLM_VISION_MODEL = "vision-model";
  });

  afterEach(() => {
    completeChatMock.mockReset();
    createLiteLlmClientMock.mockClear();
    for (const key of ENV_KEYS) {
      const value = previousEnv[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("uses the NSFW model for ordinary AI request purposes when enabled", () => {
    expect(
      resolveDefaultModel({
        purpose: "scene-prompt-reverse",
        nsfw: true,
        messages: [{ role: "user", content: "Reverse this canvas" }],
      }),
    ).toBe("nsfw-model");

    expect(
      resolveDefaultModel({
        purpose: "prompt-tag-reverse",
        nsfw: true,
        messages: [{ role: "user", content: "Reverse tags" }],
      }),
    ).toBe("nsfw-model");

    expect(
      resolveDefaultModel({
        purpose: "stick-figure-pose-generation",
        nsfw: true,
        messages: [{ role: "user", content: "Generate a pose" }],
      }),
    ).toBe("nsfw-model");

    expect(
      resolveDefaultModel({
        purpose: "comic-sequence-storyboard",
        nsfw: true,
        messages: [{ role: "user", content: "Split this action paragraph into shots" }],
      }),
    ).toBe("nsfw-model");

    expect(
      resolveDefaultModel({
        purpose: "comfyui-generation-diagnosis",
        nsfw: true,
        messages: [{ role: "user", content: "Diagnose this" }],
      }),
    ).toBe("nsfw-model");

    expect(
      resolveDefaultModel({
        purpose: "prompt-library-classification",
        nsfw: true,
        messages: [{ role: "user", content: "Classify this" }],
      }),
    ).toBe("nsfw-model");
  });

  it("falls back to the purpose-specific model when the NSFW model is not configured", () => {
    delete process.env.LITELLM_NSFW_MODEL;

    expect(
      resolveDefaultModel({
        purpose: "stick-figure-pose-generation",
        nsfw: true,
        messages: [{ role: "user", content: "Generate a pose" }],
      }),
    ).toBe("pose-model");

    expect(
      resolveDefaultModel({
        purpose: "comic-sequence-storyboard",
        nsfw: true,
        messages: [{ role: "user", content: "Split this action paragraph into shots" }],
      }),
    ).toBe("default-model");
  });

  it("overrides an explicit request model when NSFW is enabled", () => {
    expect(
      resolveRequestModel({
        model: "explicit-model",
        purpose: "stable-diffusion-prompt-generation",
        nsfw: true,
        messages: [{ role: "user", content: "Generate a prompt" }],
      }),
    ).toBe("nsfw-model");

    expect(
      resolveRequestModel({
        model: "explicit-model",
        purpose: "stable-diffusion-prompt-generation",
        messages: [{ role: "user", content: "Generate a prompt" }],
      }),
    ).toBe("explicit-model");
  });

  it("uses the vision model for Story style reference analysis", () => {
    expect(
      resolveDefaultModel({
        purpose: "story-style-reference-analysis",
        messages: [{ role: "user", content: "Analyze this style reference" }],
      }),
    ).toBe("vision-model");

    delete process.env.LITELLM_VISION_MODEL;

    expect(
      resolveDefaultModel({
        purpose: "story-style-reference-analysis",
        messages: [{ role: "user", content: "Analyze this style reference" }],
      }),
    ).toBe("default-model");
  });

  it("keeps Story style reference analysis on a vision-capable model when NSFW is enabled", () => {
    expect(
      resolveDefaultModel({
        purpose: "story-style-reference-analysis",
        nsfw: true,
        messages: [{ role: "user", content: "Analyze this style reference" }],
      }),
    ).toBe("vision-model");

    expect(
      resolveRequestModel({
        purpose: "story-style-reference-analysis",
        nsfw: true,
        messages: [{ role: "user", content: "Analyze this style reference" }],
      }),
    ).toBe("vision-model");

    expect(
      resolveRequestModel({
        model: "explicit-vision-model",
        purpose: "story-style-reference-analysis",
        nsfw: true,
        messages: [{ role: "user", content: "Analyze this style reference" }],
      }),
    ).toBe("explicit-vision-model");
  });

  it.each([
    ["ordinary", false],
    ["NSFW", true],
  ])("fixes %s preview scoring to the default model despite explicit, Vision, and NSFW overrides", (_label, nsfw) => {
    const request = {
      model: "explicit-model",
      purpose: "single-image-preview-scoring" as const,
      nsfw,
      messages: [{ role: "user" as const, content: "Score these previews" }],
    };

    expect(resolveDefaultModel(request)).toBe("default-model");
    expect(resolveRequestModel(request)).toBe("default-model");
  });

  it("does not let an explicit preview-scoring model bypass a missing default model", () => {
    delete process.env.LITELLM_DEFAULT_MODEL;

    const request = {
      model: "explicit-model",
      purpose: "single-image-preview-scoring" as const,
      nsfw: true,
      messages: [{ role: "user" as const, content: "Score these previews" }],
    };

    expect(resolveDefaultModel(request)).toBeUndefined();
    expect(resolveRequestModel(request)).toBeUndefined();
  });

  it("returns a safe recoverable config error before creating a provider client when preview scoring has no default model", async () => {
    delete process.env.LITELLM_DEFAULT_MODEL;

    const response = await POST(new Request("http://localhost/api/llm/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "explicit-model",
        purpose: "single-image-preview-scoring",
        nsfw: true,
        messages: [{ role: "user", content: "Score these previews" }],
      }),
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "llm_config",
        message: "LITELLM_DEFAULT_MODEL must be configured with a model that supports multimodal image input and permits the content being scored.",
        details: { recoverable: true },
      },
    });
    expect(createLiteLlmClientMock).not.toHaveBeenCalled();
    expect(completeChatMock).not.toHaveBeenCalled();
  });

  it("still routes ordinary NSFW requests to the NSFW model", () => {
    expect(
      resolveRequestModel({
        model: "explicit-model",
        purpose: "stable-diffusion-prompt-generation",
        nsfw: true,
        messages: [{ role: "user", content: "Generate a prompt" }],
      }),
    ).toBe("nsfw-model");
  });
});
