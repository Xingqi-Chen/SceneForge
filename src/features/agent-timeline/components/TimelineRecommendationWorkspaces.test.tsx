import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ParameterRecommendationTimelineResult,
  ResourceRecommendationTimelineResult,
  TimelineNodeResult,
} from "@/features/agent-timeline";
import type {
  CivitaiRecommendationCandidate,
  SelectedCivitaiResourcePreview,
} from "@/features/civitai-lora-library";

import { TimelineParameterRecommendationWorkspace } from "./TimelineParameterRecommendationWorkspace";
import { TimelineResourceRecommendationWorkspace } from "./TimelineResourceRecommendationWorkspace";

let container: HTMLDivElement;
let root: Root;

function makeResource(
  resourceType: "model" | "lora",
  id: string,
  name: string,
  baseModel = "Pony",
): SelectedCivitaiResourcePreview {
  return {
    id,
    resourceType,
    name,
    versionName: "v1",
    baseModel,
    creator: "creator",
    trainedWords: resourceType === "lora" ? ["neon_style"] : [],
    tags: ["neon"],
    categories: [],
    usageGuide: null,
    descriptionSnippet: null,
    averageWeight: resourceType === "lora" ? 0.7 : null,
    minWeight: null,
    maxWeight: null,
    recommendations: [],
    previewImage: null,
    modelFileName: `${name}.safetensors`,
    ...(resourceType === "model" ? { modelStorageKind: "checkpoint" as const } : {}),
  };
}

function makeCandidate(resource: SelectedCivitaiResourcePreview): CivitaiRecommendationCandidate {
  return {
    resource,
    importedImageCount: 1,
    commonCheckpoints: [],
    commonLoras: [],
    score: 1,
  };
}

function makeNode(result: unknown): TimelineNodeResult {
  return {
    nodeId: "resource-recommendation",
    result,
    source: "ai",
    status: "done",
    updatedAt: "2026-06-01T00:00:00.000Z",
  };
}

function setNativeInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

  if (!setter) {
    throw new Error("Unable to set input value.");
  }

  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function clickButton(label: string) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.replace(/\s+/g, " ").trim() === label,
  );

  if (!button) {
    throw new Error(`Unable to find button "${label}".`);
  }

  act(() => {
    (button as HTMLButtonElement).click();
  });
}

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
  vi.restoreAllMocks();
});

describe("timeline recommendation workspaces", () => {
  it("saves bounded manual resource weights from local candidates only", () => {
    const checkpoint = makeResource("model", "checkpoint-local", "Local Checkpoint");
    const lora = makeResource("lora", "lora-local", "Local LoRA");
    const result: ResourceRecommendationTimelineResult = {
      checkpoint: {
        resource: checkpoint,
        reason: "Local checkpoint.",
      },
      loras: [
        {
          resource: lora,
          suggestedWeight: 0.7,
          reason: "Initial local LoRA.",
        },
      ],
      candidates: {
        checkpoints: [makeCandidate(checkpoint)],
        loras: [makeCandidate(lora)],
      },
      recommendationReason: "AI recommendation.",
      overallEffect: "Neon portrait.",
      warnings: [],
    };
    const onSave = vi.fn();

    act(() => {
      root.render(
        <TimelineResourceRecommendationWorkspace
          editable
          emptyState="No resources."
          node={makeNode(result)}
          onSave={onSave}
        />,
      );
    });

    const weightInput = container.querySelector('input[type="number"]') as HTMLInputElement | null;
    expect(weightInput).not.toBeNull();

    act(() => {
      setNativeInputValue(weightInput as HTMLInputElement, "3.25");
    });
    clickButton("Save resources");

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        loras: [
          expect.objectContaining({
            resource: expect.objectContaining({ id: "lora-local" }),
            suggestedWeight: 2,
          }),
        ],
        recommendationReason: "Manual local resource selection.",
      }),
    );
  });

  it("saves bounded manual ComfyUI parameters into the request preview", () => {
    const result: ParameterRecommendationTimelineResult = {
      availableSamplers: ["euler"],
      availableSchedulers: ["normal"],
      width: 1024,
      height: 1024,
      steps: 30,
      cfg: 7,
      samplerName: "euler",
      scheduler: "normal",
      denoise: 1,
      seedPolicy: { mode: "random" },
      negativeAdditions: ["low quality"],
      negativePrompt: "low quality",
      requestPreview: {
        checkpointName: "Local Checkpoint.safetensors",
        positivePrompt: "courier, neon alley",
        negativePrompt: "low quality",
        width: 1024,
        height: 1024,
        steps: 30,
        cfg: 7,
        samplerName: "euler",
        scheduler: "normal",
        denoise: 1,
        loras: [],
      },
      reason: "Initial parameters.",
      warnings: [],
    };
    const onSave = vi.fn();

    act(() => {
      root.render(
        <TimelineParameterRecommendationWorkspace
          editable
          emptyState="No parameters."
          node={makeNode(result)}
          onSave={onSave}
        />,
      );
    });

    const inputs = Array.from(container.querySelectorAll('input[type="number"]')) as HTMLInputElement[];
    expect(inputs).toHaveLength(5);

    act(() => {
      setNativeInputValue(inputs[0] as HTMLInputElement, "17");
      setNativeInputValue(inputs[1] as HTMLInputElement, "20000");
      setNativeInputValue(inputs[2] as HTMLInputElement, "999");
      setNativeInputValue(inputs[3] as HTMLInputElement, "-1");
      setNativeInputValue(inputs[4] as HTMLInputElement, "2");
    });
    clickButton("Save parameters");

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        cfg: 0,
        denoise: 1,
        height: 16384,
        reason: "Manual render parameter selection.",
        requestPreview: expect.objectContaining({
          cfg: 0,
          denoise: 1,
          height: 16384,
          steps: 150,
          width: 16,
        }),
        steps: 150,
        width: 16,
      }),
    );
  });

  it("keeps manual sampler and scheduler saves inside live ComfyUI options", () => {
    const result: ParameterRecommendationTimelineResult = {
      availableSamplers: ["uni_pc"],
      availableSchedulers: ["sgm_uniform"],
      width: 1024,
      height: 1024,
      steps: 30,
      cfg: 7,
      samplerName: "uni_pc",
      scheduler: "sgm_uniform",
      denoise: 1,
      seedPolicy: { mode: "random" },
      negativeAdditions: [],
      negativePrompt: "",
      requestPreview: {
        checkpointName: "Local Checkpoint.safetensors",
        positivePrompt: "courier, neon alley",
        negativePrompt: "",
        width: 1024,
        height: 1024,
        steps: 30,
        cfg: 7,
        samplerName: "uni_pc",
        scheduler: "sgm_uniform",
        denoise: 1,
        loras: [],
      },
      reason: "Initial parameters.",
      warnings: [],
    };
    const onSave = vi.fn();

    act(() => {
      root.render(
        <TimelineParameterRecommendationWorkspace
          editable
          emptyState="No parameters."
          node={makeNode(result)}
          onSave={onSave}
        />,
      );
    });

    const options = Array.from(container.querySelectorAll("option")).map((option) => option.value);
    expect(options).toContain("uni_pc");
    expect(options).toContain("sgm_uniform");
    expect(options).not.toContain("euler");
    expect(options).not.toContain("normal");

    clickButton("Save parameters");

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        samplerName: "uni_pc",
        scheduler: "sgm_uniform",
        requestPreview: expect.objectContaining({
          samplerName: "uni_pc",
          scheduler: "sgm_uniform",
        }),
      }),
    );
  });
});
