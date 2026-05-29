// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  CivitaiAiRecommendationResponse,
  SelectedCivitaiResourcePreview,
} from "@/features/civitai-lora-library/types";

import { POST } from "./route";

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/agent/draft", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeResource(
  resourceType: "model" | "lora",
  overrides: Partial<SelectedCivitaiResourcePreview> = {},
): SelectedCivitaiResourcePreview {
  return {
    id: `${resourceType}-1`,
    resourceType,
    name: resourceType === "model" ? "Rain Checkpoint" : "Rain Style",
    versionName: null,
    baseModel: "Illustrious",
    creator: null,
    trainedWords: resourceType === "lora" ? ["rain style"] : [],
    tags: [],
    categories: resourceType === "lora" ? ["style"] : [],
    usageGuide: null,
    descriptionSnippet: null,
    averageWeight: null,
    minWeight: null,
    maxWeight: null,
    recommendations: [],
    previewImage: null,
    modelFileName: resourceType === "model" ? "rain-checkpoint.safetensors" : "rain-style.safetensors",
    ...overrides,
  };
}

function makeRecommendation(overrides: Partial<CivitaiAiRecommendationResponse> = {}): CivitaiAiRecommendationResponse {
  return {
    checkpoint: {
      resource: makeResource("model"),
      reason: "Best local checkpoint for cinematic rain scenes.",
    },
    loras: [
      {
        resource: makeResource("lora"),
        suggestedWeight: 0.82,
        reason: "Adds wet pavement and neon-reflection styling.",
      },
    ],
    recommendationReason: "Use the verified local rain resources.",
    overallEffect: "cinematic rainy alley",
    warnings: ["Verify resource download status before execution."],
    ...overrides,
  };
}

function makeDraftBody(overrides: Record<string, unknown> = {}) {
  return {
    userRequest: "make a cinematic rain alley",
    nsfw: false,
    prompt: {
      title: "Rain Alley",
      positivePrompt: "cinematic rain alley, neon reflections",
      negativePrompt: "low quality",
    },
    recommendation: makeRecommendation(),
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Agent draft route", () => {
  it("composes an editable draft from prompt text and Civitai recommendations without calling LiteLLM", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const response = await POST(makeRequest(makeDraftBody()));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(payload).toMatchObject({
      status: "draft",
      title: "Rain Alley",
      positivePrompt: "cinematic rain alley, neon reflections",
      negativePrompt: "low quality",
      confirmationRequired: true,
      comfyUiRequest: {
        checkpointName: "rain-checkpoint.safetensors",
        positivePrompt: "cinematic rain alley, neon reflections",
        negativePrompt: "low quality",
        width: 1024,
        height: 1024,
        steps: 30,
        cfg: 7,
        samplerName: "euler",
        scheduler: "normal",
        denoise: 1,
        batchSize: 1,
        latentImageNode: "EmptyLatentImage",
        outputPrefix: "SceneForge",
        loras: [{ loraName: "rain-style.safetensors", strengthModel: 0.82, strengthClip: 0.82 }],
      },
    });
    expect(payload.draftId).toEqual(expect.any(String));
    expect(payload.warnings).toEqual(["Verify resource download status before execution."]);
  });

  it("uses deterministic Agent negative defaults when the prompt request omits a negative prompt", async () => {
    const response = await POST(makeRequest(makeDraftBody({
      prompt: {
        positivePrompt: "forest shrine at dusk",
      },
      recommendation: makeRecommendation({
        loras: [],
      }),
    })));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.negativePrompt).toContain("lowres");
    expect(payload.comfyUiRequest.negativePrompt).toContain("bad anatomy");
    expect(payload.comfyUiRequest.loras).toEqual([]);
  });

  it("rejects invalid draft requests before composing defaults", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await POST(makeRequest({ userRequest: "make a cinematic rain alley" }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatchObject({
      code: "agent_request_invalid",
      message: "prompt must be an object.",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects recommendation resources with the wrong type", async () => {
    const response = await POST(makeRequest(makeDraftBody({
      recommendation: makeRecommendation({
        checkpoint: {
          resource: makeResource("lora"),
          reason: "Wrong type.",
        },
      }),
    })));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatchObject({
      code: "agent_request_invalid",
      message: "recommendation.checkpoint.resource must be a model.",
    });
  });

  it("rejects malformed JSON", async () => {
    const response = await POST(new Request("http://localhost/api/agent/draft", {
      method: "POST",
      body: "{",
    }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatchObject({
      code: "agent_request_invalid",
    });
  });
});
