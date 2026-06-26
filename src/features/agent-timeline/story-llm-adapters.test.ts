import { describe, expect, it } from "vitest";

import { LiteLlmError, type LlmChatResponse } from "@/features/llm";

import {
  createStoryLlmNodeAdapters,
  normalizeStoryParameterPlan,
  normalizeShotDependencyGraph,
  normalizeStoryBible,
  normalizeStoryResourcePlan,
  normalizeStoryShots,
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
const courierStory = [
  "Characters: teenage courier in a yellow rain jacket, carrying a cake box.",
  "Beat 1: The courier pedals into a wet market alley with the cake box strapped to his backpack.",
  "Beat 2: The backpack strap snaps and he catches the falling bakery box in the wet market alley.",
  "Beat 3: He abandons the bicycle, tucks the box under his rain jacket, runs through a blocked crosswalk, and reaches the apartment stairwell.",
  "Beat 4: He smooths the crushed box corner and knocks at the apartment door with a forced calm expression.",
  "Final image: The courier holds the battered cake box beside a little girl in a party hat and her relieved father.",
].join("\n");

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

  it("asks Story planning nodes for concrete visual anchors and executable source semantics", async () => {
    const workflow = createStoryWorkflowState({ storyId: "story-1", workflowId: "workflow-1" });
    const bible = normalizeStoryBible(
      {
        title: "Signal Market",
        logline: "A courier follows a signal.",
        characters: [{ id: "courier", name: "Courier", description: "A blue-jacket courier." }],
        locations: [{ id: "market", name: "Market", description: "A neon market." }],
      },
      input,
    );
    const outline = {
      storyId: input.storyId,
      beats: [{ id: "beat-1", title: "Arrival", summary: "The courier enters.", order: 1, characterIds: ["courier"] }],
    };
    const systemPrompts: string[] = [];
    const adapters = createStoryLlmNodeAdapters({
      completeChat: async (request) => {
        const systemContent = request.messages[0]?.content;
        if (typeof systemContent === "string") {
          systemPrompts.push(systemContent);
        }

        return chatResponse(JSON.stringify({
          nodes: shots.map((shot) => ({ shotId: shot.id, label: shot.title })),
          edges: [],
          shots,
          title: "Signal Market",
          logline: "A courier follows a signal.",
          characters: [{ id: "courier", name: "Courier", description: "A blue-jacket courier." }],
          locations: [{ id: "market", name: "Market", description: "A neon market." }],
        }));
      },
    });
    workflow.nodes["story-input"] = {
      nodeId: "story-input",
      result: input,
      source: "manual",
      status: "manual",
      updatedAt: workflow.updatedAt,
    };

    await adapters["story-bible"]?.({
      nodeId: "story-bible",
      workflow,
      dependencies: [workflow.nodes["story-input"]],
    });

    workflow.nodes["story-bible"] = {
      nodeId: "story-bible",
      result: bible,
      source: "ai",
      status: "done",
      updatedAt: workflow.updatedAt,
    };
    workflow.nodes["story-outline"] = {
      nodeId: "story-outline",
      result: outline,
      source: "ai",
      status: "done",
      updatedAt: workflow.updatedAt,
    };

    await adapters["storyboard-shots"]?.({
      nodeId: "storyboard-shots",
      workflow,
      dependencies: [workflow.nodes["story-outline"]],
    });

    workflow.nodes["storyboard-shots"] = {
      nodeId: "storyboard-shots",
      result: shots,
      source: "ai",
      status: "done",
      updatedAt: workflow.updatedAt,
    };

    await adapters["shot-dependency-graph"]?.({
      nodeId: "shot-dependency-graph",
      workflow,
      dependencies: [workflow.nodes["storyboard-shots"]],
    });

    expect(systemPrompts.join("\n")).toContain("concrete visual anchors");
    expect(systemPrompts.join("\n")).toContain("image-generation-ready visual brief");
    expect(systemPrompts.join("\n")).toContain("Visible subjects must match current segment explicitly named characters");
    expect(systemPrompts.join("\n")).toContain("do not invent extra visible people");
    expect(systemPrompts.join("\n")).not.toContain("Show only");
    expect(systemPrompts.join("\n")).toContain("ordinary story order and continuity do not need sourceShotIds");
    expect(systemPrompts.join("\n")).toContain("Do not mark ordinary sequential story beats as img2img-source");
  });

  it("passes explicit storySegments to outline and storyboard LLM payloads", async () => {
    const segmentedInput = {
      ...input,
      rawIntent: courierStory,
      targetShotCount: undefined,
      storyContext: "Characters: teenage courier in a yellow rain jacket, carrying a cake box.",
      storySegments: [
        { id: "beat-1", title: "Beat 1", sourceText: "The courier pedals into a wet market alley.", order: 1, kind: "beat" },
        { id: "final-image", title: "Final image", sourceText: "The courier, little girl, and father share the cake handoff.", order: 2, kind: "final-image" },
      ],
    } satisfies StoryInput;
    const workflow = createStoryWorkflowState({ storyId: "story-1", workflowId: "workflow-segments" });
    const bible = normalizeStoryBible(
      {
        title: "Courier Cake",
        logline: "A courier protects a cake.",
        characters: [
          { id: "courier", name: "Courier", description: "A teenage courier in a yellow rain jacket." },
          { id: "girl", name: "Little girl", description: "A little girl in a party hat." },
          { id: "father", name: "Father", description: "A relieved father." },
        ],
        locations: [{ id: "market", name: "Market", description: "A wet market alley." }],
      },
      segmentedInput,
    );
    const outline = {
      storyId: segmentedInput.storyId,
      beats: segmentedInput.storySegments.map((segment) => ({
        id: segment.id,
        title: segment.title,
        summary: segment.sourceText,
        order: segment.order,
        characterIds: ["courier"],
      })),
    };
    const payloads: Array<Record<string, unknown>> = [];
    const adapters = createStoryLlmNodeAdapters({
      completeChat: async (request) => {
        const content = request.messages[1]?.content;
        payloads.push(typeof content === "string" ? JSON.parse(content) as Record<string, unknown> : {});
        return chatResponse(JSON.stringify({
          beats: outline.beats,
          shots,
          nodes: [],
          edges: [],
          title: "Courier Cake",
          logline: "A courier protects a cake.",
          characters: bible.characters,
          locations: bible.locations,
        }));
      },
    });
    workflow.nodes["story-input"] = {
      nodeId: "story-input",
      result: segmentedInput,
      source: "manual",
      status: "manual",
      updatedAt: workflow.updatedAt,
    };
    workflow.nodes["story-bible"] = {
      nodeId: "story-bible",
      result: bible,
      source: "ai",
      status: "done",
      updatedAt: workflow.updatedAt,
    };
    workflow.nodes["story-outline"] = {
      nodeId: "story-outline",
      result: outline,
      source: "ai",
      status: "done",
      updatedAt: workflow.updatedAt,
    };

    await adapters["story-outline"]?.({
      nodeId: "story-outline",
      workflow,
      dependencies: [workflow.nodes["story-bible"]],
    });
    await adapters["storyboard-shots"]?.({
      nodeId: "storyboard-shots",
      workflow,
      dependencies: [workflow.nodes["story-outline"]],
    });

    expect(payloads[0]).toMatchObject({
      targetShotCount: 2,
      shotCountMode: "explicit-structure",
      storySegments: segmentedInput.storySegments,
    });
    expect(payloads[1]).toMatchObject({
      targetShotCount: 2,
      shotCountMode: "explicit-structure",
      storySegments: segmentedInput.storySegments,
    });
  });

  it("limits auto-count Story shots to content-estimated beats instead of padding to three", () => {
    const autoInput = {
      ...input,
      rawIntent: "Maya waits at a rainy bus stop.",
      targetShotCount: undefined,
    } satisfies StoryInput;
    const bible = normalizeStoryBible(
      {
        title: "Rain Stop",
        logline: "Maya waits.",
        characters: [{ id: "maya", name: "Maya", description: "A teenage girl in a yellow rain jacket." }],
        locations: [{ id: "bus-stop", name: "Bus stop", description: "A rainy bus stop." }],
      },
      autoInput,
    );
    const outline = {
      storyId: autoInput.storyId,
      beats: [{ id: "beat-1", title: "Wait", summary: "Maya waits.", order: 1, characterIds: ["maya"] }],
    };
    const normalized = normalizeStoryShots(
      {
        shots: [
          {
            id: "shot-1",
            order: 1,
            title: "Wait",
            description: "Maya waits.",
            beatId: "beat-1",
            locationId: "bus-stop",
            characterIds: ["maya"],
            sourceShotIds: [],
            camera: "wide",
            promptIntent: "Maya waits at a rainy bus stop",
            continuityNotes: [],
          },
          {
            id: "shot-2",
            order: 2,
            title: "Filler",
            description: "Unneeded filler.",
            beatId: "beat-1",
            locationId: "bus-stop",
            characterIds: ["maya"],
            sourceShotIds: [],
            camera: "medium",
            promptIntent: "filler beat",
            continuityNotes: [],
          },
        ],
      },
      autoInput,
      bible,
      outline,
    );

    expect(normalized).toHaveLength(1);
    expect(normalized[0]?.title).toBe("Wait");
  });

  it("truncates filler shots for explicit segments and preserves final image subjects", () => {
    const segmentedInput = {
      ...input,
      rawIntent: courierStory,
      targetShotCount: undefined,
      storySegments: [
        { id: "beat-1", title: "Beat 1", sourceText: "The courier enters the wet alley.", order: 1, kind: "beat" },
        { id: "beat-2", title: "Beat 2", sourceText: "The courier catches the bakery box.", order: 2, kind: "beat" },
        { id: "beat-3", title: "Beat 3", sourceText: "The courier runs to the apartment.", order: 3, kind: "beat" },
        { id: "beat-4", title: "Beat 4", sourceText: "The courier knocks at the door.", order: 4, kind: "beat" },
        { id: "final-image", title: "Final image", sourceText: "The courier, little girl, and father receive the battered cake box.", order: 5, kind: "final-image" },
      ],
    } satisfies StoryInput;
    const bible = normalizeStoryBible(
      {
        title: "Cake Run",
        logline: "A courier protects a cake.",
        characters: [
          { id: "courier", name: "Courier", description: "A teenage courier in a yellow rain jacket." },
          { id: "girl", name: "Little girl", description: "A little girl in a party hat." },
          { id: "father", name: "Father", description: "A relieved father." },
        ],
        locations: [{ id: "apartment", name: "Apartment", description: "An apartment doorway." }],
      },
      segmentedInput,
    );
    const outline = {
      storyId: segmentedInput.storyId,
      beats: segmentedInput.storySegments.map((segment) => ({
        id: segment.id,
        title: segment.title,
        summary: segment.sourceText,
        order: segment.order,
        characterIds: segment.id === "final-image" ? ["courier", "girl", "father"] : ["courier"],
      })),
    };
    const normalized = normalizeStoryShots(
      {
        shots: [
          ...segmentedInput.storySegments.map((segment) => ({
            id: segment.id.replace("beat", "shot"),
            order: segment.order,
            title: segment.title,
            description: segment.sourceText,
            beatId: segment.id,
            locationId: "apartment",
            characterIds: segment.id === "final-image" ? ["courier", "girl", "father"] : ["courier"],
            sourceShotIds: [],
            camera: "medium frame",
            promptIntent: segment.sourceText,
            continuityNotes: [],
          })),
          {
            id: "shot-6",
            order: 6,
            title: "Filler",
            description: "Unneeded extra shot.",
            beatId: "final-image",
            locationId: "apartment",
            characterIds: ["courier"],
            sourceShotIds: [],
            camera: "medium frame",
            promptIntent: "filler",
            continuityNotes: [],
          },
        ],
      },
      segmentedInput,
      bible,
      outline,
    );

    expect(normalized).toHaveLength(5);
    expect(normalized[4]).toMatchObject({
      title: "Final image",
      characterIds: ["courier", "girl", "father"],
    });
    expect(normalized[4]?.promptIntent).toContain("little girl");
    expect(normalized[4]?.promptIntent).toContain("father");
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
              usageGuide: "Use 768x1152 for portrait story panels with this checkpoint.",
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
        samplers: ["er_sde", "euler", "dpmpp_2m"],
        schedulers: ["simple", "normal", "karras"],
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
        width: 768,
        height: 1152,
        steps: 36,
        cfg: 4.5,
        samplerName: "er_sde",
        scheduler: "simple",
      },
      selectedResourceParameterContext: expect.stringContaining("Checkpoint:"),
    });
    expect(requestPayload).toMatchObject({
      selectedResourceParameterContext: expect.stringContaining("Use 768x1152"),
    });
    expect(parameterPlan?.defaults).toMatchObject({
      width: 768,
      height: 1152,
      steps: 36,
      cfg: 4.5,
      samplerName: "er_sde",
      scheduler: "simple",
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

  it("uses inferred fallback dimensions when AI returns the legacy fixed Story size", () => {
    const plan = normalizeStoryParameterPlan(
      {
        defaults: {
          width: 1024,
          height: 768,
          steps: 36,
          cfg: 4.5,
          samplerName: "er_sde",
          scheduler: "simple",
          denoise: 1,
        },
        perShotOverrides: [],
        warnings: [],
      },
      {
        ...input,
        rawIntent: "A vertical full body portrait of a courier.",
      },
      shots,
      {
        samplers: ["er_sde"],
        schedulers: ["simple"],
      },
      {
        width: 832,
        height: 1216,
        steps: 36,
        cfg: 4.5,
        samplerName: "er_sde",
        scheduler: "simple",
        denoise: 1,
      },
    );

    expect(plan.defaults).toMatchObject({
      width: 832,
      height: 1216,
      samplerName: "er_sde",
      scheduler: "simple",
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

  it("keeps planning-only dependency graph edges out of render source shots", () => {
    const graph = normalizeShotDependencyGraph(
      {
        nodes: [{ shotId: "shot-1" }, { shotId: "shot-2" }],
        edges: [{ fromShotId: "shot-1", toShotId: "shot-2", reason: "continuity" }],
      },
      input,
      shots.map((shot) => ({ ...shot, sourceShotIds: shot.id === "shot-2" ? [] : shot.sourceShotIds })),
    );
    const synced = syncStoryShotsWithDependencyGraph(shots, graph);

    expect(synced.find((shot) => shot.id === "shot-2")?.sourceShotIds).toEqual([]);
  });

  it("syncs only executable image reference dependency edges into render source shots", () => {
    const graph = normalizeShotDependencyGraph(
      {
        nodes: [{ shotId: "shot-1" }, { shotId: "shot-2" }],
        edges: [{ fromShotId: "shot-1", toShotId: "shot-2", reason: "img2img-source" }],
      },
      input,
      shots.map((shot) => ({ ...shot, sourceShotIds: [] })),
    );
    const synced = syncStoryShotsWithDependencyGraph(shots, graph);

    expect(synced.find((shot) => shot.id === "shot-2")?.sourceShotIds).toEqual(["shot-1"]);
  });

  it("keeps non-img2img reference dependencies out of render source shots", () => {
    const graph = normalizeShotDependencyGraph(
      {
        nodes: [{ shotId: "shot-1" }, { shotId: "shot-2" }],
        edges: [{ fromShotId: "shot-1", toShotId: "shot-2", reason: "reference" }],
      },
      input,
      shots.map((shot) => ({ ...shot, sourceShotIds: [] })),
    );
    const synced = syncStoryShotsWithDependencyGraph(shots, graph);

    expect(synced.find((shot) => shot.id === "shot-2")?.sourceShotIds).toEqual([]);
  });

  it("fills missing Story shot character and location ids from the bible", () => {
    const bible = normalizeStoryBible(
      {
        title: "Signal Market",
        logline: "A courier follows a signal.",
        characters: [{ id: "courier", name: "Courier", description: "A blue-jacket courier." }],
        locations: [{ id: "market", name: "Market", description: "A neon market." }],
      },
      input,
    );
    const outline = {
      storyId: input.storyId,
      beats: [{ id: "beat-1", title: "Beat", summary: "Summary", order: 1, characterIds: ["courier"] }],
    };
    const normalized = normalizeStoryShots(
      {
        shots: [{
          id: "shot-1",
          order: 1,
          title: "Arrival",
          description: "The courier enters.",
          beatId: "beat-1",
          locationId: "invented-location",
          characterIds: ["invented-character"],
          sourceShotIds: [],
          camera: "wide",
          promptIntent: "blue-jacket courier enters the neon market",
          continuityNotes: [],
        }],
      },
      input,
      bible,
      outline,
    );

    expect(normalized[0]).toMatchObject({
      characterIds: ["courier"],
      locationId: "market",
    });
  });
});
