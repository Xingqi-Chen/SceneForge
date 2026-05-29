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

  it("submits only the request and settings before rendering editable LLM-selected defaults", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
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
      }),
    );
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

    expect(fetchMock).toHaveBeenCalledWith("/api/agent/draft", expect.objectContaining({
      body: JSON.stringify({
        userRequest: "make a cinematic rain alley",
        nsfw: false,
      }),
    }));
    expect(document.body.textContent).toContain("Generation Defaults");
    expect(document.body.textContent).toContain("LoRAs");
    expect(document.querySelector<HTMLInputElement>("input[value='llm-checkpoint.safetensors']")).not.toBeNull();
    expect(document.querySelector<HTMLInputElement>("input[value='rain-style.safetensors']")).not.toBeNull();
    expect(document.querySelector<HTMLInputElement>("input[value='768']")).not.toBeNull();
  });
});
