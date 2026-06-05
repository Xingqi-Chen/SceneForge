// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveDefaultModel, resolveRequestModel } from "./route";

const ENV_KEYS = [
  "LITELLM_DEFAULT_MODEL",
  "LITELLM_NSFW_MODEL",
  "LITELLM_POSE_MODEL",
  "LITELLM_COMFYUI_DIAGNOSIS_MODEL",
  "LITELLM_CLASSIFICATION_MODEL",
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
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = previousEnv[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("uses the NSFW model for all AI request purposes when enabled", () => {
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
});
