import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { StoryNodeOutputSummaryView } from "./StoryNodeOutputSummaryView";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe("StoryNodeOutputSummaryView", () => {
  it("renders Story render-plan shot cards with prompt, LLM, and source risk diagnostics", () => {
    act(() => {
      root.render(
        <StoryNodeOutputSummaryView
          nodeId="story-render-plan"
          result={{
            storyId: "story-summary",
            img2imgDenoise: 0.9,
            nsfwContext: { enabled: false },
            resourceRefs: {
              sourceNodeId: "resource-plan",
              checkpoint: {
                resourceId: "checkpoint-local",
                name: "Local Checkpoint",
              },
              loras: [],
            },
            warnings: [
              'Shot "shot-2" removed negative addition "kneeling courier" because it conflicts with positive prompt anchor "kneeling courier gathering the fallen parcel".',
            ],
            shots: [
              {
                shotId: "shot-2",
                order: 2,
                title: "Parcel Recovery",
                positivePrompt:
                  "adult courier with cropped black hair and blue jacket, red courier badge, kneeling courier gathering the fallen parcel, rain-slick market alley, eye-level medium shot, neon window lighting",
                negativePrompt: "kneeling courier, low quality",
                sourceShotIds: ["shot-1"],
                sourceImageEdges: [
                  {
                    riskLevel: "high",
                    riskReason: "High source-image risk: standing to kneeling.",
                    sourceChain: ["shot-1", "shot-2"],
                    sourceShotId: "shot-1",
                    targetShotId: "shot-2",
                  },
                ],
                parameters: {
                  width: 1024,
                  height: 1024,
                  steps: 28,
                  cfg: 5,
                  samplerName: "euler",
                  scheduler: "normal",
                  denoise: 0.9,
                },
                animaPromptParts: {
                  subjectTags: ["1man", "solo"],
                  characterTags: ["adult courier with cropped black hair and blue jacket"],
                  seriesTags: ["courier_story"],
                  artistTags: ["@rainy_linework"],
                  propTags: ["red courier badge"],
                  actionTags: ["kneeling courier gathering the fallen parcel"],
                  settingTags: ["rain-slick market alley"],
                  cameraTags: ["eye-level medium shot"],
                  lightingTags: ["neon window lighting"],
                  singleFrameCaption: "The courier kneels in a rain-slick market alley to gather the fallen parcel.",
                  negativeAdditions: ["low quality"],
                },
              },
            ],
          }}
        />,
      );
    });

    const cards = container.querySelectorAll('[data-testid="story-shot-card"]');

    expect(cards).toHaveLength(1);
    expect(container.textContent).toContain("Shot 2 / shot-2");
    expect(container.textContent).toContain("Parcel Recovery");
    expect(container.textContent).toContain("source-image from shot-1");
    expect(container.textContent).toContain("1024x1024");
    expect(container.textContent).toContain("Local Checkpoint");
    expect(container.textContent).toContain("Prompt sections");
    expect(container.textContent).toContain("Subject");
    expect(container.textContent).toContain("1man, solo");
    expect(container.textContent).toContain("Series");
    expect(container.textContent).toContain("courier_story");
    expect(container.textContent).toContain("Artist");
    expect(container.textContent).toContain("@rainy_linework");
    expect(container.textContent).toContain("Caption");
    expect(container.textContent).toContain("Visual prompt");
    expect(container.textContent).toContain("adult courier with cropped black hair");
    expect(Array.from(container.querySelectorAll("pre")).some((block) =>
      block.textContent?.includes("kneeling courier, low quality"),
    )).toBe(true);
    expect(container.textContent).toContain("Warnings");
    expect(container.textContent).toContain("removed negative addition");
    expect(container.textContent).toContain("Prompt health");
    expect(container.textContent).toContain("Removed negative conflict");
    expect(container.textContent).toContain("Removed negatives");
    expect(container.textContent).toContain("Source-image risk");
    expect(container.textContent).toContain("standing to kneeling");
  });

  it("renders generation-gate shot cards with prompt diagnostics even when the gate is ready", () => {
    act(() => {
      root.render(
        <StoryNodeOutputSummaryView
          nodeId="generation-gate"
          result={{
            storyId: "story-summary",
            ready: true,
            executionAvailable: true,
            confirmationRequired: true,
            nsfwContext: { enabled: false },
            renderPlanShotCount: 1,
            previewEnabled: false,
            requestPreview: [
              {
                shotId: "shot-2",
                title: "Parcel Recovery",
                sourceMode: "source-image",
                sourceShotIds: ["shot-1"],
                sourceImageEdges: [
                  {
                    riskLevel: "high",
                    riskReason: "High source-image risk: standing to kneeling.",
                    sourceChain: ["shot-1", "shot-2"],
                    sourceShotId: "shot-1",
                    targetShotId: "shot-2",
                  },
                ],
                positivePromptPreview: "score_7, kneeling courier",
                negativePromptPreview: "score_1, kneeling courier, bad_hands",
                parameters: {
                  width: 1024,
                  height: 1024,
                  steps: 28,
                  cfg: 5,
                  samplerName: "euler",
                  scheduler: "normal",
                  denoise: 0.9,
                },
              },
            ],
          }}
        />,
      );
    });

    expect(container.querySelectorAll('[data-testid="story-shot-card"]')).toHaveLength(1);
    expect(container.textContent).toContain("Generation gate summary");
    expect(container.textContent).toContain("Ready");
    expect(container.textContent).toContain("Source-image risk");
    expect(container.textContent).toContain("standing to kneeling");
    expect(container.textContent).toContain("Prompt health");
    expect(container.textContent).not.toContain("Negative conflict");
    expect(container.textContent).not.toContain("Removed negatives");
  });

  it("renders stored result thumbnails without exposing prompt ids or ComfyUI temp URLs", () => {
    act(() => {
      root.render(
        <StoryNodeOutputSummaryView
          nodeId="story-result-display"
          result={{
            errors: [],
            finalReferences: [
              {
                completed: true,
                image: {
                  filename: "temp-shot-1.png",
                  nodeId: "debug-node-9",
                  type: "temp",
                  url: "http://127.0.0.1:8188/view?filename=temp-shot-1.png&type=temp",
                },
                promptId: "prompt-shot-1",
                shotId: "shot-1",
                storedImage: {
                  byteLength: 12,
                  contentType: "image/png",
                  filename: "stored-shot-1.png",
                  url: "/api/comfyui/generated-images/stored-shot-1.png",
                },
                warnings: [],
              },
              {
                completed: true,
                image: {
                  filename: "temp-shot-2.png",
                  nodeId: "debug-node-10",
                  type: "temp",
                  url: "http://127.0.0.1:8188/view?filename=temp-shot-2.png&type=temp",
                },
                promptId: "prompt-shot-2",
                shotId: "shot-2",
                warnings: [],
              },
            ],
            previewReferences: [],
            status: "complete",
            storyId: "story-summary",
          }}
        />,
      );
    });

    const image = container.querySelector("img") as HTMLImageElement | null;

    expect(container.querySelectorAll('[data-testid="story-shot-card"]')).toHaveLength(2);
    expect(image?.getAttribute("src")).toBe("/api/comfyui/generated-images/stored-shot-1.png");
    expect(container.textContent).toContain("stored-shot-1.png");
    expect(container.textContent).toContain("temp-shot-2.png");
    expect(container.textContent).not.toContain("prompt-shot-1");
    expect(container.textContent).not.toContain("prompt-shot-2");
    expect(container.textContent).not.toContain("127.0.0.1:8188");
    expect(container.textContent).not.toContain("debug-node-9");
  });
});
