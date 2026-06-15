import { describe, expect, it } from "vitest";

import { LiteLlmError, type LlmChatResponse } from "@/features/llm";

import {
  createStoryLlmNodeAdapters,
  normalizeShotDependencyGraph,
  normalizeStoryBible,
  normalizeStoryResourcePlan,
  syncStoryShotsWithDependencyGraph,
} from "./story-llm-adapters";
import { createStoryWorkflowState } from "./story-state";
import {
  TimelineNodeExecutionError,
} from "./types";
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
