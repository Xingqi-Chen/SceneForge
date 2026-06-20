import { describe, expect, it } from "vitest";

import { LiteLlmError, type LlmChatResponse } from "@/features/llm";

import {
  createStoryLlmNodeAdapters,
  normalizeStoryParameterPlan,
  normalizeShotDependencyGraph,
  normalizeStoryBible,
  normalizeStoryResourcePlan,
  syncStoryShotsWithDependencyGraph,
} from "./story-llm-adapters";
import { createStoryWorkflowState } from "./story-state";
import {
  TimelineNodeExecutionError,
} from "./types";
import type { StoryParameterPlan } from "./story-planning";
import type {
  StoryInput,
  StoryShot,
} from "./story-types";

const input = {
  storyId: "story-1",
  rawIntent: "A courier follows a signal through a neon market.",
  targetShotCount: 2,
  audienceRating: "safe",
  nsfwContext: {
    enabled: false,
    audienceRating: "safe",
    contentWarnings: [],
    rationale: "Safe test context.",
  },
  settingsSnapshot: {
    resourceCandidates: {
      checkpoints: [
        {
          id: "checkpoint-local",
          name: "Local Checkpoint",
          baseModel: "Illustrious",
          modelFileName: "local.safetensors",
        },
      ],
      loras: [
        {
          id: "lora-local",
          name: "Local LoRA",
          baseModel: "Illustrious",
          modelFileName: "local-lora.safetensors",
          trainedWords: ["neon market"],
        },
      ],
    },
  },
} satisfies StoryInput;

const shots = [
  {
    id: "shot-1",
    storyId: "story-1",
    order: 1,
    title: "Arrival",
    description: "The courier enters the market.",
    characterIds: ["courier"],
    sourceShotIds: [],
    camera: "wide",
    promptIntent: "neon market arrival",
    continuityNotes: [],
  },
  {
    id: "shot-2",
    storyId: "story-1",
    order: 2,
    title: "Signal",
    description: "The courier sees a signal.",
    characterIds: ["courier"],
    sourceShotIds: ["shot-1"],
    camera: "close",
    promptIntent: "signal reflection",
    continuityNotes: [],
  },
] satisfies StoryShot[];

function chatResponse(content: string): LlmChatResponse {
  return {
    role: "assistant",
    content,
  };
}

describe("story LLM adapters", () => {
  it("parses valid StoryBible JSON from LiteLLM content", () => {
    const bible = normalizeStoryBible(
      JSON.stringify({
        title: "Signal Market",
        logline: "A courier follows a signal.",
        genre: ["cyberpunk"],
        themes: ["curiosity"],
        worldSummary: "A neon market at night.",
        visualStyle: "Cinematic neon panels.",
        characters: [
          {
            id: "courier",
            name: "Courier",
            role: "Lead",
            description: "A focused courier.",
            continuityNotes: ["Keep the jacket."],
            visualAnchors: ["blue jacket"],
          },
        ],
        locations: [
          {
            id: "market",
            name: "Market",
            description: "A wet neon market.",
            visualAnchors: ["wet signs"],
          },
        ],
        continuityRules: ["Keep the signal red."],
      }),
      input,
    );

    expect(bible).toMatchObject({
      storyId: "story-1",
      title: "Signal Market",
      characters: [{ id: "courier", name: "Courier" }],
      locations: [{ id: "market", name: "Market" }],
    });
  });

  it("normalizes malformed JSON and LiteLLM errors into timeline node errors", async () => {
    const workflow = createStoryWorkflowState({ storyId: "story-1", workflowId: "workflow-1" });
    workflow.nodes["story-input"] = {
      nodeId: "story-input",
      result: input,
      source: "manual",
      status: "manual",
      updatedAt: workflow.updatedAt,
    };
    const malformedAdapters = createStoryLlmNodeAdapters({
      completeChat: async () => chatResponse("not json"),
    });

    await expect(malformedAdapters["story-bible"]?.({
      nodeId: "story-bible",
      workflow,
      dependencies: [workflow.nodes["story-input"]],
    })).rejects.toMatchObject({
      code: "llm_malformed_response",
    });

    const errorAdapters = createStoryLlmNodeAdapters({
      completeChat: async () => {
        throw new LiteLlmError("LITELLM_BASE_URL is required before calling the LLM API.", { statusCode: 500 });
      },
    });

    await expect(errorAdapters["story-bible"]?.({
      nodeId: "story-bible",
      workflow,
      dependencies: [workflow.nodes["story-input"]],
    })).rejects.toMatchObject({
      code: "llm_config",
    });
  });

  it("rejects invented Story resource checkpoint or LoRA ids and blocks missing checkpoint candidates", () => {
    expect(() =>
      normalizeStoryResourcePlan(
        {
          checkpoint: { resource: { id: "invented-checkpoint" }, reason: "Invented." },
          loras: [],
          recommendationReason: "Bad",
          overallEffect: "Bad",
          warnings: [],
        },
        input,
      ),
    ).toThrow(TimelineNodeExecutionError);

    expect(() =>
      normalizeStoryResourcePlan(
        {
          checkpoint: { resource: { id: "checkpoint-local" }, reason: "Local." },
          loras: [{ resource: { id: "invented-lora" }, reason: "Invented.", suggestedWeight: 0.6 }],
          recommendationReason: "Bad",
          overallEffect: "Bad",
          warnings: [],
        },
        input,
      ),
    ).toThrow(TimelineNodeExecutionError);

    expect(() =>
      normalizeStoryResourcePlan(
        {
          checkpoint: { resource: { id: "checkpoint-local" }, reason: "Local." },
          loras: [],
          recommendationReason: "Bad",
          overallEffect: "Bad",
          warnings: [],
        },
        {
          ...input,
          settingsSnapshot: {
            resourceCandidates: {
              checkpoints: [],
              loras: [],
            },
          },
        },
      ),
    ).toThrow(TimelineNodeExecutionError);
  });

  it("accepts only real Story resource candidates", () => {
    const plan = normalizeStoryResourcePlan(
      {
        checkpoint: { resource: { id: "checkpoint-local" }, reason: "Local checkpoint." },
        loras: [{ resource: { id: "lora-local" }, reason: "Local LoRA.", suggestedWeight: 0.6 }],
        recommendationReason: "Use real resources.",
        overallEffect: "Neon continuity.",
        warnings: [],
      },
      input,
    );

    expect(plan.checkpoint.resource).toMatchObject({
      id: "checkpoint-local",
      modelFileName: "local.safetensors",
    });
    expect(plan.loras[0]?.resource).toMatchObject({
      id: "lora-local",
      modelFileName: "local-lora.safetensors",
    });
  });

  it("constrains parameter planning to live sampler and scheduler options", async () => {
    const workflow = createStoryWorkflowState({ storyId: "story-1", workflowId: "workflow-1" });
    workflow.nodes["story-input"] = {
      nodeId: "story-input",
      result: input,
      source: "manual",
      status: "manual",
      updatedAt: workflow.updatedAt,
    };
    workflow.nodes["storyboard-shots"] = {
      nodeId: "storyboard-shots",
      result: shots,
      source: "ai",
      status: "done",
      updatedAt: workflow.updatedAt,
    };
    workflow.nodes["resource-plan"] = {
      nodeId: "resource-plan",
      result: normalizeStoryResourcePlan(
        {
          checkpoint: { resource: { id: "checkpoint-local" }, reason: "Local checkpoint." },
          loras: [],
          recommendationReason: "Use real resources.",
          overallEffect: "Neon continuity.",
          warnings: [],
        },
        input,
      ),
      source: "ai",
      status: "done",
      updatedAt: workflow.updatedAt,
    };
    let requestPayload: unknown;
    const adapters = createStoryLlmNodeAdapters({
      completeChat: async (request) => {
        const content = request.messages[1]?.content;
        requestPayload = typeof content === "string" ? JSON.parse(content) : {};
        return chatResponse(JSON.stringify({
          defaults: {
            width: 1024,
            height: 768,
            steps: 28,
            cfg: 5.5,
            samplerName: "dpmpp_2m",
            scheduler: "karras",
            denoise: 1,
          },
          perShotOverrides: [],
          warnings: [],
        }));
      },
      samplerOptions: {
        samplers: ["uni_pc"],
        schedulers: ["sgm_uniform"],
      },
    });

    const result = await adapters["parameter-plan"]?.({
      nodeId: "parameter-plan",
      workflow,
      dependencies: [workflow.nodes["resource-plan"], workflow.nodes["storyboard-shots"]],
    });
    const parameterPlan = (result as { value: StoryParameterPlan } | undefined)?.value;

    expect(requestPayload).toMatchObject({
      availableSamplers: ["uni_pc"],
      availableSchedulers: ["sgm_uniform"],
    });
    expect(parameterPlan).toMatchObject({
      defaults: {
        samplerName: "uni_pc",
        scheduler: "sgm_uniform",
      },
    });
  });

  it("passes model-family sampler defaults into the parameter-plan LLM prompt", async () => {
    const animaInput = {
      ...input,
      settingsSnapshot: {
        resourceCandidates: {
          checkpoints: [
            {
              id: "checkpoint-anima",
              name: "Anima Checkpoint",
              baseModel: "Anima",
              modelBaseModel: "Anima",
              modelFileName: "anima.safetensors",
            },
          ],
          loras: [],
        },
      },
    } satisfies StoryInput;
    const workflow = createStoryWorkflowState({ storyId: "story-1", workflowId: "workflow-1" });
    workflow.nodes["story-input"] = {
      nodeId: "story-input",
      result: animaInput,
      source: "manual",
      status: "manual",
      updatedAt: workflow.updatedAt,
    };
    workflow.nodes["storyboard-shots"] = {
      nodeId: "storyboard-shots",
      result: shots,
      source: "ai",
      status: "done",
      updatedAt: workflow.updatedAt,
    };
    workflow.nodes["resource-plan"] = {
      nodeId: "resource-plan",
      result: normalizeStoryResourcePlan(
        {
          checkpoint: { resource: { id: "checkpoint-anima" }, reason: "Local Anima checkpoint." },
          loras: [],
          recommendationReason: "Use real resources.",
          overallEffect: "Anime continuity.",
          warnings: [],
        },
        animaInput,
      ),
      source: "ai",
      status: "done",
      updatedAt: workflow.updatedAt,
    };
    let requestPayload: unknown;
    const adapters = createStoryLlmNodeAdapters({
      completeChat: async (request) => {
        const content = request.messages[1]?.content;
        requestPayload = typeof content === "string" ? JSON.parse(content) : {};
        return chatResponse(JSON.stringify({
          defaults: {},
          perShotOverrides: [],
          warnings: [],
        }));
      },
      samplerOptions: {
        samplers: ["euler", "dpmpp_2m"],
        schedulers: ["normal", "karras"],
      },
    });

    const result = await adapters["parameter-plan"]?.({
      nodeId: "parameter-plan",
      workflow,
      dependencies: [workflow.nodes["resource-plan"], workflow.nodes["storyboard-shots"]],
    });
    const parameterPlan = (result as { value: StoryParameterPlan } | undefined)?.value;

    expect(requestPayload).toMatchObject({
      modelDefaultParameters: {
        samplerName: "euler",
        scheduler: "normal",
      },
    });
    expect(parameterPlan?.defaults).toMatchObject({
      samplerName: "euler",
      scheduler: "normal",
    });
  });

  it("normalizes raw parameter plans to supplied sampler and scheduler options", () => {
    const plan = normalizeStoryParameterPlan(
      {
        defaults: {
          width: 1024,
          height: 768,
          steps: 28,
          cfg: 5.5,
          samplerName: "invented_sampler",
          scheduler: "invented_scheduler",
          denoise: 1,
        },
        perShotOverrides: [],
        warnings: [],
      },
      input,
      shots,
      {
        samplers: ["uni_pc"],
        schedulers: ["sgm_uniform"],
      },
    );

    expect(plan.defaults).toMatchObject({
      samplerName: "uni_pc",
      scheduler: "sgm_uniform",
    });
  });

  it("normalizes raw per-shot override numbers before render planning uses toFixed", () => {
    const plan = normalizeStoryParameterPlan(
      {
        defaults: {
          width: 1024,
          height: 768,
          steps: 28,
          cfg: 5.5,
          samplerName: "dpmpp_2m",
          scheduler: "karras",
          denoise: 1,
        },
        perShotOverrides: [
          {
            shotId: "shot-2",
            parameters: {
              cfg: "6",
              denoise: "0.7",
              steps: "12",
            },
          },
          {
            shotId: "shot-1",
            parameters: {
              cfg: "bad",
              denoise: "bad",
            },
          },
        ],
        warnings: [],
      },
      input,
      shots,
    );

    expect(plan.perShotOverrides[0]?.parameters).toMatchObject({
      cfg: 6,
      denoise: 0.7,
      steps: 12,
    });
    expect(plan.perShotOverrides[1]?.parameters).toMatchObject({
      cfg: 5.5,
      denoise: 1,
    });
  });

  it("rejects unknown shots and cycles in dependency graph output", () => {
    expect(() =>
      normalizeShotDependencyGraph(
        {
          nodes: [{ shotId: "shot-1" }, { shotId: "shot-2" }],
          edges: [{ fromShotId: "shot-missing", toShotId: "shot-2", reason: "reference" }],
        },
        input,
        shots,
      ),
    ).toThrow(TimelineNodeExecutionError);

    expect(() =>
      normalizeShotDependencyGraph(
        {
          nodes: [{ shotId: "shot-1" }, { shotId: "shot-2" }],
          edges: [
            { fromShotId: "shot-1", toShotId: "shot-2", reason: "continuity" },
            { fromShotId: "shot-2", toShotId: "shot-1", reason: "continuity" },
          ],
        },
        input,
        shots,
      ),
    ).toThrow(TimelineNodeExecutionError);
  });

  it("syncs shot sourceShotIds with graph dependencies for render planning", () => {
    const graph = normalizeShotDependencyGraph(
      {
        nodes: [{ shotId: "shot-1" }, { shotId: "shot-2" }],
        edges: [{ fromShotId: "shot-1", toShotId: "shot-2", reason: "continuity" }],
      },
      input,
      shots.map((shot) => ({ ...shot, sourceShotIds: shot.id === "shot-2" ? [] : shot.sourceShotIds })),
    );
    const synced = syncStoryShotsWithDependencyGraph(shots, graph);

    expect(synced.find((shot) => shot.id === "shot-2")?.sourceShotIds).toEqual(["shot-1"]);
  });
});
