// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentDraftWorkspace } from "./AgentDraftWorkspace";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function renderWorkspace() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  act(() => {
    root?.render(<AgentDraftWorkspace />);
  });
}

function findButton(text: string) {
  const button = Array.from(document.querySelectorAll("button")).find((entry) => entry.textContent?.includes(text));
  if (!button) {
    throw new Error(`Button not found: ${text}`);
  }
  return button;
}

function updateTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  valueSetter?.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  textarea.dispatchEvent(new Event("change", { bubbles: true }));
}

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }
  container?.remove();
  container = null;
  root = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AgentDraftWorkspace", () => {
  it("keeps NSFW inside page settings and leaves the draft input request-only", () => {
    renderWorkspace();

    expect(document.body.textContent).toContain("Draft Input");
    expect(document.body.textContent).toContain("Settings");
    expect(document.body.textContent).not.toContain("NSFW");
    expect(document.body.textContent?.toLowerCase()).not.toContain("model");

    act(() => {
      findButton("Settings").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const checkbox = document.querySelector<HTMLInputElement>("input[type='checkbox']");
    expect(document.body.textContent).toContain("Agent Settings");
    expect(document.body.textContent).toContain("NSFW");
    expect(checkbox?.checked).toBe(false);
  });

  it("uses the existing LLM and Civitai endpoints before rendering editable selected defaults", async () => {
    const recommendation = {
      checkpoint: {
        resource: {
          id: "checkpoint-1",
          resourceType: "model",
          name: "Rain Checkpoint",
          modelFileName: "llm-checkpoint.safetensors",
        },
        reason: "Best local checkpoint.",
      },
      loras: [
        {
          resource: {
            id: "lora-1",
            resourceType: "lora",
            name: "Rain Style",
            modelFileName: "rain-style.safetensors",
          },
          suggestedWeight: 0.8,
          reason: "Adds rain styling.",
        },
      ],
      recommendationReason: "Use local rain resources.",
      overallEffect: "cinematic rain",
      warnings: [],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body));

      if (url === "/api/llm/chat") {
        expect(body).toMatchObject({
          purpose: "stable-diffusion-prompt-generation",
          nsfw: false,
          temperature: 0.2,
          maxTokens: 700,
        });
        expect(body.messages[0].content).toContain("Return only the final positive prompt text.");
        expect(body.messages[1].content).toBe("make a cinematic rain alley");

        return Response.json({
          content: "cinematic rain alley",
          role: "assistant",
        });
      }

      if (url === "/api/civitai-lora-library/ai-recommendation") {
        expect(body).toEqual({
          desiredEffect: "make a cinematic rain alley\n\ncinematic rain alley",
          maxLoras: 3,
          nsfw: false,
        });

        return Response.json(recommendation);
      }

      if (url === "/api/agent/draft") {
        expect(body).toMatchObject({
          userRequest: "make a cinematic rain alley",
          nsfw: false,
          prompt: {
            positivePrompt: "cinematic rain alley",
          },
          recommendation,
        });

        return Response.json({
          draftId: "draft-test",
          status: "draft",
          title: "Rain Alley",
          positivePrompt: "cinematic rain alley",
          negativePrompt: "low quality",
          comfyUiRequest: {
            checkpointName: "llm-checkpoint.safetensors",
            loras: [{ loraName: "rain-style.safetensors", strengthModel: 0.8, strengthClip: 0.75 }],
            width: 768,
            height: 1024,
            steps: 28,
            cfg: 6.5,
            samplerName: "euler",
            scheduler: "normal",
            denoise: 1,
            batchSize: 1,
            latentImageNode: "EmptyLatentImage",
            outputPrefix: "AgentDraft",
            positivePrompt: "cinematic rain alley",
            negativePrompt: "low quality",
          },
          confirmationRequired: true,
          warnings: [],
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWorkspace();

    const requestInput = document.querySelector<HTMLTextAreaElement>("textarea");
    expect(requestInput).not.toBeNull();

    await act(async () => {
      updateTextareaValue(requestInput!, "make a cinematic rain alley");
    });

    await act(async () => {
      findButton("Generate draft").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/llm/chat",
      "/api/civitai-lora-library/ai-recommendation",
      "/api/agent/draft",
    ]);
    expect(document.body.textContent).toContain("Generation Defaults");
    expect(document.body.textContent).toContain("LoRAs");
    expect(document.querySelector<HTMLInputElement>("input[value='llm-checkpoint.safetensors']")).not.toBeNull();
    expect(document.querySelector<HTMLInputElement>("input[value='rain-style.safetensors']")).not.toBeNull();
    expect(document.querySelector<HTMLInputElement>("input[value='768']")).not.toBeNull();
  });
});
