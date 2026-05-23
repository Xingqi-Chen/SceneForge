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

  it("accepts ComfyUI generation diagnosis purpose", () => {
    expect(
      isLlmChatRequest({
        purpose: "comfyui-generation-diagnosis",
        messages: [{ role: "user", content: "Diagnose this generation" }],
      }),
    ).toBe(true);
  });
});
