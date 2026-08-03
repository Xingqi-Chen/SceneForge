import { describe, expect, it } from "vitest";

import { getRunScenePromptResponseFormat } from "./run-scene-prompt-response-format";
import { isLlmChatRequest } from "./validation";

describe("isLlmChatRequest", () => {
  it("accepts stable diffusion prompt generation purpose", () => {
    expect(
      isLlmChatRequest({
        purpose: "stable-diffusion-prompt-generation",
        messages: [{ role: "user", content: "Generate a prompt" }],
      }),
    ).toBe(true);
  });

  it.each(["illustrious", "anima", "krea2"] as const)(
    "accepts the exact authorized %s response format for prompt generation",
    (profile) => {
      expect(
        isLlmChatRequest({
          purpose: "stable-diffusion-prompt-generation",
          responseFormat: JSON.parse(JSON.stringify(getRunScenePromptResponseFormat(profile))),
          messages: [{ role: "user", content: "Generate a prompt" }],
        }),
      ).toBe(true);
    },
  );

  it("rejects authorized response formats for every other purpose", () => {
    expect(
      isLlmChatRequest({
        purpose: "scene-prompt-reverse",
        responseFormat: getRunScenePromptResponseFormat("illustrious"),
        messages: [{ role: "user", content: "Reverse a prompt" }],
      }),
    ).toBe(false);
    expect(
      isLlmChatRequest({
        responseFormat: getRunScenePromptResponseFormat("illustrious"),
        messages: [{ role: "user", content: "Ordinary chat" }],
      }),
    ).toBe(false);
  });

  it.each([
    {
      label: "unsupported json_object format",
      responseFormat: { type: "json_object" },
    },
    {
      label: "arbitrary schema",
      responseFormat: {
        type: "json_schema",
        json_schema: {
          name: "caller_authored",
          strict: true,
          schema: { type: "object" },
        },
      },
    },
    {
      label: "malformed schema wrapper",
      responseFormat: {
        type: "json_schema",
        json_schema: { name: "sceneforge_run_scene_prompt_krea2_v1" },
      },
    },
  ])("rejects $label", ({ responseFormat }) => {
    expect(
      isLlmChatRequest({
        purpose: "stable-diffusion-prompt-generation",
        responseFormat,
        messages: [{ role: "user", content: "Generate a prompt" }],
      }),
    ).toBe(false);
  });

  it("rejects a one-field mutation of an otherwise authorized format", () => {
    const responseFormat = JSON.parse(JSON.stringify(getRunScenePromptResponseFormat("krea2")));
    responseFormat.json_schema.schema.properties.krea2Sections.additionalProperties = true;

    expect(
      isLlmChatRequest({
        purpose: "stable-diffusion-prompt-generation",
        responseFormat,
        messages: [{ role: "user", content: "Generate a prompt" }],
      }),
    ).toBe(false);
  });

  it("accepts comic sequence storyboard purpose", () => {
    expect(
      isLlmChatRequest({
        purpose: "comic-sequence-storyboard",
        messages: [{ role: "user", content: "Split this action paragraph into shots" }],
      }),
    ).toBe(true);
  });

  it("accepts reverse prompt purposes with nsfw flag", () => {
    expect(
      isLlmChatRequest({
        purpose: "scene-prompt-reverse",
        nsfw: true,
        messages: [{ role: "user", content: "Reverse this canvas" }],
      }),
    ).toBe(true);

    expect(
      isLlmChatRequest({
        purpose: "prompt-tag-reverse",
        nsfw: false,
        messages: [{ role: "user", content: "Reverse these tags" }],
      }),
    ).toBe(true);
  });

  it("rejects non-boolean nsfw values", () => {
    expect(
      isLlmChatRequest({
        nsfw: "true",
        messages: [{ role: "user", content: "Hello" }],
      }),
    ).toBe(false);
  });

  it("accepts ComfyUI generation diagnosis purpose", () => {
    expect(
      isLlmChatRequest({
        purpose: "comfyui-generation-diagnosis",
        messages: [{ role: "user", content: "Diagnose this generation" }],
      }),
    ).toBe(true);
  });

  it("accepts ComfyUI inpaint diagnosis purpose", () => {
    expect(
      isLlmChatRequest({
        purpose: "comfyui-inpaint-diagnosis",
        messages: [{ role: "user", content: "Diagnose this inpaint" }],
      }),
    ).toBe(true);
  });
});
