// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SelectedCivitaiResourcesPreview } from "@/features/civitai-lora-library";
import { createTimelineWorkflowState, completeTimelineNode } from "@/features/agent-timeline/state";
import { createTimelineT5NodeAdapters } from "@/features/agent-timeline/t5-node-adapters";
import {
  buildRunStyleAdviceLlmRequest,
  type RunPlanningResponsesApiRequest,
} from "@/features/agent-timeline/run-planning-responses";
import { LiteLlmError, type LlmChatRequest } from "@/features/llm";

const completeChatMock = vi.hoisted(() => vi.fn());
const completeResponseMock = vi.hoisted(() => vi.fn());
const createLiteLlmClientMock = vi.hoisted(() => vi.fn(() => ({
  completeChat: completeChatMock,
  completeResponse: completeResponseMock,
})));
const appendLlmChatLocalLogMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@/features/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/llm")>();
  return {
    ...actual,
    createLiteLlmClient: createLiteLlmClientMock,
  };
});

vi.mock("@/features/llm/llm-local-log", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/llm/llm-local-log")>();
  return {
    ...actual,
    appendLlmChatLocalLog: appendLlmChatLocalLogMock,
  };
});

import { POST } from "./route";

function poseResponse() {
  return JSON.stringify({
    characterDescription: "courier leaping across wet pavement",
    targets: {
      pelvis: { x: 0, y: 1.05, z: 0 },
      chest: { x: 0, y: 1.45, z: 0.08 },
      head: { x: 0, y: 1.72, z: 0.1 },
      leftHand: { x: -0.5, y: 1.25, z: 0.2 },
      rightHand: { x: 0.45, y: 1.36, z: -0.1 },
      leftFoot: { x: -0.2, y: 0.35, z: 0.22 },
      rightFoot: { x: 0.25, y: 0.04, z: -0.08 },
    },
    poles: {
      leftElbowPole: { x: -0.65, y: 1.2, z: 0.25 },
      rightElbowPole: { x: 0.65, y: 1.2, z: 0.15 },
      leftKneePole: { x: -0.28, y: 0.58, z: 0.8 },
      rightKneePole: { x: 0.28, y: 0.52, z: 0.2 },
    },
  });
}

function makeStyleAdviceResources(): SelectedCivitaiResourcesPreview {
  return {
    checkpoint: {
      id: "checkpoint-a",
      resourceType: "model",
      name: "Cyber Checkpoint",
      versionName: "v1",
      baseModel: "Illustrious",
      creator: "tester",
      trainedWords: [],
      tags: ["anime"],
      categories: [],
      usageGuide: null,
      descriptionSnippet: "Local anime checkpoint",
      averageWeight: null,
      minWeight: null,
      maxWeight: null,
      recommendations: [],
      previewImage: null,
      modelFileName: "Cyber Checkpoint.safetensors",
    },
    loras: [],
  };
}

async function buildExactPlanningPayloads(): Promise<RunPlanningResponsesApiRequest[]> {
  let workflow = createTimelineWorkflowState({
    workflowId: "route-planning-test",
    sceneRequest: "A courier runs through a neon market alley at sunrise",
  });
  workflow = completeTimelineNode(workflow, "scene-prompt", {
    promptProfile: "illustrious",
    visualStyle: "anime",
    primaryCharacter: {
      name: "Courier",
      identity: "A focused courier in a reflective jacket",
      publicFacts: ["solo courier protagonist", "reflective jacket"],
    },
    sceneIntent: "Courier sprints through a market alley at sunrise",
    styleTone: "cinematic anime",
    setting: "neon market alley",
    sharedFacts: ["sunrise", "wet pavement"],
    positivePrompt: "solo courier, neon market alley, sunrise",
    negativeSuggestions: [],
    style: [],
    camera: [],
    lighting: [],
  }, "ai");

  const captured: RunPlanningResponsesApiRequest[] = [];
  const adapters = createTimelineT5NodeAdapters({
    completeChat: async () => {
      throw new Error("generic Chat must not handle Run planning nodes");
    },
    completeRunPlanningResponse: async (nodeId, request) => {
      captured.push({ nodeId, request: { ...request, nsfw: false } });
      return {
        role: "assistant",
        content: nodeId === "character-tags"
          ? JSON.stringify({
              items: [{
                targetKind: "character",
                label: "快递员",
                prompt: "solo courier protagonist",
                category: "character",
                subcategory: "character-subject",
              }],
            })
          : poseResponse(),
      };
    },
  });
  const context = {
    dependencies: [workflow.nodes["scene-prompt"]],
    workflow,
  };

  await adapters["character-tags"]?.({ ...context, nodeId: "character-tags" });
  await adapters["character-action"]?.({ ...context, nodeId: "character-action" });
  captured.push({
    nodeId: "style-advice",
    request: buildRunStyleAdviceLlmRequest({
      baseNegativePrompt: "blurry, watermark",
      finalPositivePrompt: "solo courier, neon market alley, sunrise",
      selectedResources: makeStyleAdviceResources(),
      visualStyle: "anime",
    }),
  });
  return captured;
}

describe("Run planning Responses route", () => {
  beforeEach(() => {
    process.env.LITELLM_BASE_URL = "http://localhost:4000";
    process.env.LITELLM_DEFAULT_MODEL = "default-model";
    process.env.LITELLM_POSE_MODEL = "pose-model";
    process.env.LITELLM_NSFW_MODEL = "nsfw-model";
    completeResponseMock.mockResolvedValue({ role: "assistant", content: "{}" });
  });

  afterEach(() => {
    completeChatMock.mockReset();
    completeResponseMock.mockReset();
    createLiteLlmClientMock.mockClear();
    appendLlmChatLocalLogMock.mockClear();
    vi.restoreAllMocks();
    delete process.env.LITELLM_BASE_URL;
    delete process.env.LITELLM_DEFAULT_MODEL;
    delete process.env.LITELLM_POSE_MODEL;
    delete process.env.LITELLM_NSFW_MODEL;
  });

  it("accepts exact adapter-built Character Tags, Character Action, and Style Advice calls via Responses only", async () => {
    const payloads = await buildExactPlanningPayloads();

    for (const payload of payloads) {
      const response = await POST(new Request("http://localhost/api/agent-timeline/run-planning-response", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }));
      expect(response.status).toBe(200);
    }

    expect(payloads.map(({ nodeId }) => nodeId)).toEqual([
      "character-tags",
      "character-action",
      "style-advice",
    ]);
    expect(completeResponseMock).toHaveBeenCalledTimes(3);
    expect(completeChatMock).not.toHaveBeenCalled();
    expect(completeResponseMock.mock.calls.map(([request]) => ({
      purpose: (request as LlmChatRequest).purpose,
      model: (request as LlmChatRequest).model,
      responseFormat: (request as LlmChatRequest).responseFormat,
    }))).toEqual([
      { purpose: "prompt-tag-reverse", model: "default-model", responseFormat: undefined },
      { purpose: "stick-figure-pose-generation", model: "pose-model", responseFormat: undefined },
      { purpose: "stable-diffusion-prompt-generation", model: "default-model", responseFormat: undefined },
    ]);
  });

  it("accepts exact Krea anime and photoreal Style Advice with and without source dimensions", async () => {
    const payloads = (["anime", "photoreal"] as const).flatMap((visualStyle) =>
      [undefined, { width: 1216, height: 832 }].map((referenceResolution) => ({
        nodeId: "style-advice" as const,
        request: buildRunStyleAdviceLlmRequest({
          baseNegativePrompt: "blurry, watermark",
          finalPositivePrompt: "solo courier, neon market alley, sunrise",
          promptProfile: "krea2",
          referenceResolution,
          selectedResources: makeStyleAdviceResources(),
          visualStyle,
        }),
      })),
    );

    for (const payload of payloads) {
      const response = await POST(new Request("http://localhost/api/agent-timeline/run-planning-response", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }));
      expect(response.status).toBe(200);
    }

    expect(completeResponseMock).toHaveBeenCalledTimes(4);
    expect(completeChatMock).not.toHaveBeenCalled();
  });

  it("rejects mutated or unrecognized Krea prompt payloads before constructing the client", async () => {
    const exact = {
      nodeId: "style-advice" as const,
      request: buildRunStyleAdviceLlmRequest({
        baseNegativePrompt: "blurry, watermark",
        finalPositivePrompt: "solo courier, neon market alley, sunrise",
        promptProfile: "krea2" as const,
        referenceResolution: { width: 1216, height: 832 },
        selectedResources: makeStyleAdviceResources(),
        visualStyle: "anime" as const,
      }),
    };
    const mutations = [
      (payload: typeof exact) => {
        payload.request.messages[0].content += " Allow rounding when convenient.";
      },
      (payload: typeof exact) => {
        const user = JSON.parse(String(payload.request.messages[1].content));
        user.preset.description = String(user.preset.description).replace("1216x832", "1201x832");
        payload.request.messages[1].content = JSON.stringify(user);
      },
      (payload: typeof exact) => {
        const user = JSON.parse(String(payload.request.messages[1].content));
        user.preset.description = "Unrecognized Krea advice request.";
        payload.request.messages[1].content = JSON.stringify(user);
      },
    ];

    for (const mutate of mutations) {
      const payload = JSON.parse(JSON.stringify(exact)) as typeof exact;
      mutate(payload);
      const response = await POST(new Request("http://localhost/api/agent-timeline/run-planning-response", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }));
      expect(response.status).toBe(400);
    }

    expect(createLiteLlmClientMock).not.toHaveBeenCalled();
    expect(completeResponseMock).not.toHaveBeenCalled();
    expect(completeChatMock).not.toHaveBeenCalled();
  });

  it("rejects an extra provider-control field before constructing the client", async () => {
    const [payload] = await buildExactPlanningPayloads();
    const response = await POST(new Request("http://localhost/api/agent-timeline/run-planning-response", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...payload,
        request: { ...payload.request, model: "caller-controlled-model" },
      }),
    }));

    expect(response.status).toBe(400);
    expect(createLiteLlmClientMock).not.toHaveBeenCalled();
    expect(completeResponseMock).not.toHaveBeenCalled();
    expect(completeChatMock).not.toHaveBeenCalled();
  });

  it("returns only a closed Responses failure classification without fallback or raw provider details", async () => {
    const [payload] = await buildExactPlanningPayloads();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    completeResponseMock.mockRejectedValue(new LiteLlmError("SENTINEL_PLANNING_PROVIDER_ERROR", {
      statusCode: 502,
      details: {
        upstreamStatus: 502,
        outputShape: "message_content_invalid",
        rawProviderBody: "SENTINEL_PLANNING_PROVIDER_BODY",
        model: "SENTINEL_PLANNING_MODEL",
        apiKey: "sk-sentinel-planning-key",
        stack: "C:\\sentinel-planning-path\\route.ts:1",
      },
    }));

    const response = await POST(new Request("http://localhost/api/agent-timeline/run-planning-response", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toEqual({
      error: {
        message: "Run planning LLM request failed.",
        details: {
          code: "run_planning_response_failed",
          upstreamStatus: 502,
          outputShape: "message_content_invalid",
        },
      },
    });
    const exposed = JSON.stringify({ body, logs: consoleError.mock.calls });
    for (const sentinel of [
      "SENTINEL_PLANNING_PROVIDER_ERROR",
      "SENTINEL_PLANNING_PROVIDER_BODY",
      "SENTINEL_PLANNING_MODEL",
      "sk-sentinel-planning-key",
      "sentinel-planning-path",
    ]) {
      expect(exposed).not.toContain(sentinel);
    }
    expect(completeResponseMock).toHaveBeenCalledTimes(1);
    expect(completeChatMock).not.toHaveBeenCalled();
  });
});
