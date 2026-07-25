import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ParameterRecommendationTimelineResult,
  ResourceRecommendationTimelineResult,
  ScenePromptTimelineResult,
  TimelineNodeResult,
} from "@/features/agent-timeline";
import type {
  CivitaiRecommendationCandidate,
  SelectedCivitaiResourcePreview,
} from "@/features/civitai-lora-library";

import { TimelineParameterRecommendationWorkspace } from "./TimelineParameterRecommendationWorkspace";
import { TimelineResourceRecommendationWorkspace } from "./TimelineResourceRecommendationWorkspace";
import { TimelineScenePromptWorkspace } from "./TimelineScenePromptWorkspace";

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

function makeSceneNode(result: ScenePromptTimelineResult): TimelineNodeResult {
  return {
    nodeId: "scene-prompt",
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

function setNativeTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;

  if (!setter) {
    throw new Error("Unable to set textarea value.");
  }

  setter.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
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
  it("saves Krea sections unchanged and maps a flat edit only to subject/mood", () => {
    const result: ScenePromptTimelineResult = {
      promptProfile: "krea2",
      primaryCharacter: { name: "Courier", identity: "A calm courier", publicFacts: [] },
      sceneIntent: "A calm courier waits in a station.",
      styleTone: "quiet",
      setting: "station",
      sharedFacts: [],
      positivePrompt: "A calm courier",
      negativeSuggestions: [],
      style: [],
      camera: [],
      lighting: [],
      krea2Sections: {
        subjectMood: "A calm courier",
        subjectAttributesAndActions: "wearing a yellow jacket",
        visualStyleAndMedium: "watercolor illustration",
        lightingColorAndTexture: "soft amber light",
        spatialCompositionAndFraming: "standing at the center of a quiet station",
      },
    };
    const onSave = vi.fn();

    act(() => {
      root.render(
        <TimelineScenePromptWorkspace
          editable
          emptyState="No prompt."
          node={makeSceneNode(result)}
          onSave={onSave}
          promptProfile="krea2"
        />,
      );
    });

    expect(container.textContent).toContain("maps it to Krea's subject/mood section");
    clickButton("Save context");
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({
      krea2Sections: result.krea2Sections,
      positivePrompt: "A calm courier",
    }));

    const positivePrompt = container.querySelector('[aria-label="Positive prompt"]') as HTMLTextAreaElement;
    act(() => {
      setNativeTextareaValue(positivePrompt, "A focused courier");
    });
    clickButton("Save context");

    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({
      promptProfile: "krea2",
      positivePrompt: "A focused courier",
      krea2Sections: {
        subjectMood: "A focused courier",
        subjectAttributesAndActions: "wearing a yellow jacket",
        visualStyleAndMedium: "watercolor illustration",
        lightingColorAndTexture: "soft amber light",
        spatialCompositionAndFraming: "standing at the center of a quiet station",
      },
    }));
  });

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
    const positivePrompt = Array.from(container.querySelectorAll("textarea")).find(
      (textarea) => textarea.value === "courier, neon alley",
    ) as HTMLTextAreaElement | undefined;
    expect(positivePrompt).not.toBeUndefined();

    act(() => {
      setNativeTextareaValue(positivePrompt as HTMLTextAreaElement, "manual edited prompt, neon reflections");
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
        finalPositivePrompt: "manual edited prompt, neon reflections",
        height: 16384,
        reason: "Manual render parameter selection.",
        requestPreview: expect.objectContaining({
          cfg: 0,
          denoise: 1,
          height: 16384,
          negativePrompt: "low quality",
          positivePrompt: "manual edited prompt, neon reflections",
          steps: 150,
          width: 16,
        }),
        steps: 150,
        width: 16,
      }),
    );
  });

  it("rounds Krea manual dimensions upward to 16-pixel boundaries before saving", () => {
    const result: ParameterRecommendationTimelineResult = {
      availableSamplers: ["euler"],
      availableSchedulers: ["simple"],
      width: 1024,
      height: 1024,
      steps: 8,
      cfg: 1,
      samplerName: "euler",
      scheduler: "simple",
      denoise: 1,
      seedPolicy: { mode: "fixed", seed: 7 },
      negativeAdditions: [],
      negativePrompt: "",
      requestPreview: {
        checkpointName: "krea-2-turbo-unet.safetensors",
        workflowProfile: "krea2",
        modelBaseModel: "Krea 2",
        modelStorageKind: "diffusion",
        positivePrompt: "a quiet station",
        width: 1024,
        height: 1024,
        steps: 8,
        cfg: 1,
        samplerName: "euler",
        scheduler: "simple",
        denoise: 1,
        loras: [],
      },
      reason: "Krea defaults.",
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
    expect(inputs[0]?.step).toBe("16");
    expect(inputs[1]?.step).toBe("16");
    act(() => {
      setNativeInputValue(inputs[0]!, "1025");
      setNativeInputValue(inputs[1]!, "1023");
    });
    clickButton("Save parameters");

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      width: 1040,
      height: 1024,
      requestPreview: expect.objectContaining({ width: 1040, height: 1024, workflowProfile: "krea2" }),
    }));
  });

  it("keeps non-Krea manual dimensions on nearest 8-pixel boundaries", () => {
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
      seedPolicy: { mode: "fixed", seed: 7 },
      negativeAdditions: [],
      negativePrompt: "",
      requestPreview: {
        checkpointName: "Local Checkpoint.safetensors",
        workflowProfile: "default",
        positivePrompt: "a quiet station",
        width: 1024,
        height: 1024,
        steps: 30,
        cfg: 7,
        samplerName: "euler",
        scheduler: "normal",
        denoise: 1,
        loras: [],
      },
      reason: "Default parameters.",
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
    expect(inputs[0]?.step).toBe("8");
    expect(inputs[1]?.step).toBe("8");
    act(() => {
      setNativeInputValue(inputs[0]!, "1025");
      setNativeInputValue(inputs[1]!, "1023");
    });
    clickButton("Save parameters");

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      width: 1024,
      height: 1024,
      requestPreview: expect.objectContaining({ width: 1024, height: 1024, workflowProfile: "default" }),
    }));
  });

  it("preserves complete Anima negative prompt defaults when saving manual parameters", () => {
    const result: ParameterRecommendationTimelineResult = {
      availableSamplers: ["euler"],
      availableSchedulers: ["normal"],
      width: 1216,
      height: 800,
      steps: 36,
      cfg: 6,
      samplerName: "euler",
      scheduler: "normal",
      denoise: 1,
      seedPolicy: { mode: "random" },
      negativeAdditions: ["scene clutter"],
      negativePrompt:
        "worst quality, low quality, lowres, score_1, score_2, score_3, blurry, jpeg artifacts, bad anatomy, watermark, artist name, nsfw, bad_hands, scene clutter",
      requestPreview: {
        checkpointName: "Anima.safetensors",
        positivePrompt: "score_9, score_8, score_7, witch over town",
        negativePrompt:
          "worst quality, low quality, lowres, score_1, score_2, score_3, blurry, jpeg artifacts, bad anatomy, watermark, artist name, nsfw, bad_hands, scene clutter",
        width: 1216,
        height: 800,
        steps: 36,
        cfg: 6,
        samplerName: "euler",
        scheduler: "normal",
        denoise: 1,
        loras: [{ loraName: "Local LoRA.safetensors", strengthModel: 0.72 }],
      },
      finalPositivePrompt: "score_9, score_8, score_7, witch over town",
      reason: "AI Style Advice tuned the render parameters.",
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

    const positivePrompt = Array.from(container.querySelectorAll("textarea")).find(
      (textarea) => textarea.value === "score_9, score_8, score_7, witch over town",
    ) as HTMLTextAreaElement | undefined;
    expect(positivePrompt).not.toBeUndefined();

    act(() => {
      setNativeTextareaValue(positivePrompt as HTMLTextAreaElement, "score_9, score_8, score_7, edited witch prompt");
    });
    clickButton("Save parameters");

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        finalPositivePrompt: "score_9, score_8, score_7, edited witch prompt",
        negativePrompt:
          "worst quality, low quality, lowres, score_1, score_2, score_3, blurry, jpeg artifacts, bad anatomy, watermark, artist name, nsfw, bad_hands, scene clutter",
        requestPreview: expect.objectContaining({
          negativePrompt:
            "worst quality, low quality, lowres, score_1, score_2, score_3, blurry, jpeg artifacts, bad anatomy, watermark, artist name, nsfw, bad_hands, scene clutter",
          positivePrompt: "score_9, score_8, score_7, edited witch prompt",
        }),
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
