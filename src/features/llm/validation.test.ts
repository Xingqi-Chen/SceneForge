import { describe, expect, it } from "vitest";

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
