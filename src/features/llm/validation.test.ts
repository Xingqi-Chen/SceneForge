import { describe, expect, it } from "vitest";

import { getRunScenePromptResponseFormat } from "./run-scene-prompt-response-format";
import { isLlmChatRequest, isLlmResponsesRequest } from "./validation";

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

describe("isLlmResponsesRequest", () => {
  it("accepts native string input and preserves the legacy validator boundary", () => {
    const request = { input: "Describe the scene", instructions: "Be precise", max_output_tokens: 512 };
    expect(isLlmResponsesRequest(request)).toBe(true);
    expect(isLlmChatRequest(request)).toBe(false);
    expect(isLlmResponsesRequest({ messages: [{ role: "user", content: "legacy request" }] })).toBe(true);
  });

  it.each([undefined, true, false] as const)("accepts a generic caller schema with optional strict=%s", (strict) => {
    expect(isLlmResponsesRequest({
      input: "Describe the scene",
      text: { format: {
        type: "json_schema",
        name: "caller_authored",
        description: "A scene caption",
        schema: {
          type: "object",
          properties: { caption: { type: "string" }, tags: { type: "array", items: { type: "string" } } },
          required: ["caption"],
          additionalProperties: false,
        },
        ...(strict === undefined ? {} : { strict }),
      } },
    })).toBe(true);
  });

  it("accepts native ordered multimodal input with developer context", () => {
    expect(isLlmResponsesRequest({ input: [
      { type: "message", role: "developer", content: "Describe images" },
      { role: "assistant", content: "Ready" },
      { role: "user", content: [
        { type: "input_text", text: "First" },
        { type: "input_image", image_url: "data:image/png;base64,FIRST", detail: "low" },
        { type: "input_text", text: "Second" },
        { type: "input_image", image_url: "data:image/png;base64,SECOND", detail: "high" },
        { type: "input_image", image_url: "https://images.example.test/scene.png?v=1", detail: "auto" },
      ] },
    ] })).toBe(true);
  });

  it.each(["http://images.example.test/scene.png", "https://images.example.test/scene.png"])("accepts native image URL %s while retaining the legacy data-only boundary", (url) => {
    expect(isLlmResponsesRequest({ input: [{ role: "user", content: [{ type: "input_image", image_url: url }] }] })).toBe(true);
    expect(isLlmChatRequest({ messages: [{ role: "user", content: [{ type: "image_url", image_url: { url } }] }] })).toBe(false);
  });

  it.each([
    ["missing", {}],
    ["empty string", { input: "  " }],
    ["empty list", { input: [] }],
    ["tool role", { input: [{ role: "tool", content: "unsupported" }] }],
    ["tool item", { input: [{ type: "function_call", role: "user", content: "unsupported" }] }],
    ["legacy part", { input: [{ role: "user", content: [{ type: "text", text: "legacy part" }] }] }],
    ["invalid detail", { input: [{ role: "user", content: [{ type: "input_image", image_url: "data:image/png;base64,IMAGE", detail: "ultra" }] }] }],
    ["non-string instructions", { input: "native", instructions: 3 }],
    ["negative tokens", { input: "native", max_output_tokens: -1 }],
    ["fractional tokens", { input: "native", max_output_tokens: 1.5 }],
    ["non-finite tokens", { input: "native", max_output_tokens: Number.NaN }],
    ["conflicting input", { input: "native", messages: [{ role: "user", content: "legacy" }] }],
    ["conflicting tokens", { input: "native", max_output_tokens: 5, maxTokens: 5 }],
    ["conflicting format", { input: "native", text: { format: { type: "text" } }, responseFormat: getRunScenePromptResponseFormat("krea2") }],
  ])("rejects %s requests", (_label, request) => {
    expect(isLlmResponsesRequest(request)).toBe(false);
  });

  it.each([
    ["missing name", { type: "json_schema", schema: { type: "object" } }],
    ["empty name", { type: "json_schema", name: "", schema: { type: "object" } }],
    ["missing schema", { type: "json_schema", name: "caption" }],
    ["non-object schema", { type: "json_schema", name: "caption", schema: "{}" }],
    ["array schema", { type: "json_schema", name: "caption", schema: [] }],
    ["null schema", { type: "json_schema", name: "caption", schema: null }],
    ["non-boolean strict", { type: "json_schema", name: "caption", schema: {}, strict: "true" }],
    ["null strict", { type: "json_schema", name: "caption", schema: {}, strict: null }],
    ["non-string description", { type: "json_schema", name: "caption", schema: {}, description: 42 }],
    ["invalid nested JSON value", { type: "json_schema", name: "caption", schema: { properties: { caption: { default: Number.NaN } } } }],
  ])("rejects structurally invalid native format: %s", (_label, format) => {
    expect(isLlmResponsesRequest({ input: "Describe the scene", text: { format } })).toBe(false);
  });

  it("keeps the legacy responseFormat whitelist on the canonical validator", () => {
    expect(isLlmResponsesRequest({
      purpose: "stable-diffusion-prompt-generation",
      messages: [{ role: "user", content: "legacy request" }],
      responseFormat: { type: "json_schema", json_schema: { name: "caller_authored", strict: true, schema: {} } },
    })).toBe(false);
    expect(isLlmResponsesRequest({
      purpose: "stable-diffusion-prompt-generation",
      messages: [{ role: "user", content: "legacy request" }],
      responseFormat: getRunScenePromptResponseFormat("krea2"),
    })).toBe(true);
  });
});
