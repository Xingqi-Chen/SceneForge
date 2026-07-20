import { afterEach, describe, expect, it, vi } from "vitest";

const completeChatMock = vi.hoisted(() => vi.fn());
const readFileMock = vi.hoisted(() => vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])));

vi.mock("node:fs/promises", () => ({ default: { readFile: readFileMock } }));

vi.mock("@/features/llm", () => {
  class LiteLlmError extends Error {}
  return {
    createLiteLlmClient: vi.fn(() => ({ completeChat: completeChatMock })),
    LiteLlmError,
  };
});

vi.mock("@/features/comfyui", () => ({
  COMFYUI_FACE_DETAILER_DEFAULTS: { enabled: false },
  COMFYUI_FACE_DETAILER_SAM_DETECTION_HINT_OPTIONS: [],
  COMFYUI_FACE_DETAILER_SAM_MASK_HINT_USE_NEGATIVE_OPTIONS: [],
  DEFAULT_COMFYUI_FACE_DETAILER_DETECTOR_MODEL: "face.pt",
  DEFAULT_COMFYUI_HAND_DETAILER_DETECTOR_MODEL: "hand.pt",
  ComfyUiApiError: class extends Error {},
  buildComfyUiSequenceCharacterReference: vi.fn(),
  createComfyUiClient: vi.fn(),
  extractComfyUiHistoryImages: vi.fn(),
  isComfyUiPromptHistoryComplete: vi.fn(),
  summarizeComfyUiErrorDetails: vi.fn(),
  validateComfyUiRequestAgainstObjectInfo: vi.fn(),
  validateComfyUiTextToImageRequest: vi.fn(),
}));

vi.mock("@/features/comfyui/generated-image-storage", () => ({
  getGeneratedImageContentType: vi.fn(() => "image/png"),
  getGeneratedImagePath: vi.fn((filename: string) => `C:\\safe\\${filename}`),
  storeGeneratedImage: vi.fn(),
}));

vi.mock("@/features/comfyui/source-image-upload", () => ({
  uploadComfyUiTextToImageSourceImage: vi.fn((_client: unknown, request: unknown) => request),
}));

vi.mock("@/features/comfyui/sequence-reference-upload", () => ({
  uploadSequenceCharacterReferences: vi.fn(),
}));

import { createTimelineWorkflowState, setTimelineNodeManualResult } from "./state";
import { createTimelineT8ServerNodeAdapters } from "./t8-server-adapters";
import type {
  PreviewExecutionTimelineResult,
  PreviewScoringTimelineResult,
  TimelineNodeExecutionContext,
  TimelineWorkflowState,
} from "./types";

const originalEnv = { ...process.env };

function createScoringWorkflow({
  finalCount = 2,
  nsfw = false,
}: {
  finalCount?: number;
  nsfw?: boolean;
} = {}) {
  let workflow = createTimelineWorkflowState({
    imageCount: finalCount,
    sceneRequest: "A pilot in a greenhouse",
    workflowId: "t37-scoring",
  });
  workflow = {
    ...workflow,
    nodes: {
      ...workflow.nodes,
      "scene-input": {
        ...workflow.nodes["scene-input"],
        result: { ...(workflow.nodes["scene-input"].result as object), nsfw },
      },
    },
  };
  workflow = setTimelineNodeManualResult(workflow, "parameter-recommendation", {
    requestPreview: { positivePrompt: "glass greenhouse pilot" },
  });
  const previews: PreviewExecutionTimelineResult = {
    baseSeed: 100,
    candidateCount: 3,
    finalCount,
    previewHeight: 512,
    previewWidth: 512,
    previewSteps: 10,
    candidates: [1, 2, 3].map((number, index) => ({
      candidateId: `preview-${number}`,
      index,
      seed: 99 + number,
      status: "done" as const,
      storedImage: {
        byteLength: number,
        contentType: "image/png",
        filename: `preview-${number}.png`,
        url: `/api/comfyui/generated-images/preview-${number}.png`,
      },
    })),
    successfulCount: 3,
    warnings: [],
  };
  return setTimelineNodeManualResult(workflow, "preview-execution", previews);
}

async function score(workflow: TimelineWorkflowState) {
  const adapter = createTimelineT8ServerNodeAdapters()["preview-scoring"]!;
  const context: TimelineNodeExecutionContext = {
    nodeId: "preview-scoring",
    workflow,
    dependencies: [workflow.nodes["preview-execution"]],
  };
  const result = await adapter(context);
  const wrapped = result as { value?: unknown };
  return "value" in wrapped ? wrapped.value : result;
}

function validResponse() {
  return JSON.stringify({
    candidates: [
      { candidateId: "preview-3", adherence: 80, composition: 80, anatomy: 80, style: 80, technical: 80 },
      { candidateId: "preview-2", adherence: 70, composition: 92, anatomy: 80, style: 80, technical: 80 },
      { candidateId: "preview-1", adherence: 80, composition: 80, anatomy: 80, style: 80, technical: 80 },
    ],
  });
}

afterEach(() => {
  completeChatMock.mockReset();
  readFileMock.mockClear();
  process.env = { ...originalEnv };
});

describe("T37 structured preview scoring", () => {
  it("computes fixed local weights and resolves ties by composition then candidate order", async () => {
    process.env.LITELLM_VISION_MODEL = "vision-model";
    completeChatMock.mockResolvedValue({ content: validResponse() });

    await expect(score(createScoringWorkflow())).resolves.toMatchObject({
      rubricVersion: 1,
      selectedCandidateIds: ["preview-2", "preview-1"],
      selectionSource: "ai",
      scores: [
        { candidateId: "preview-2", total: 80, rank: 1 },
        { candidateId: "preview-1", total: 80, rank: 2 },
        { candidateId: "preview-3", total: 80, rank: 3 },
      ],
    });
  });

  it("sorts by the unrounded weighted total before the displayed two-decimal total", async () => {
    process.env.LITELLM_VISION_MODEL = "vision-model";
    completeChatMock.mockResolvedValue({ content: JSON.stringify({
      candidates: [
        {
          candidateId: "preview-1",
          adherence: 80.0133333333,
          composition: 80,
          anatomy: 80,
          style: 80,
          technical: 80,
        },
        {
          candidateId: "preview-2",
          adherence: 63.3433333333,
          composition: 100,
          anatomy: 80,
          style: 80,
          technical: 80,
        },
        {
          candidateId: "preview-3",
          adherence: 70,
          composition: 70,
          anatomy: 70,
          style: 70,
          technical: 70,
        },
      ],
    }) });

    const result = await score(createScoringWorkflow()) as PreviewScoringTimelineResult;

    expect(result.scores.slice(0, 2)).toMatchObject([
      { candidateId: "preview-1", composition: 80, total: 80, rank: 1 },
      { candidateId: "preview-2", composition: 100, total: 80, rank: 2 },
    ]);
    expect(result.selectedCandidateIds).toEqual(["preview-1", "preview-2"]);
  });

  it.each([
    ["non JSON", "not-json"],
    ["missing id", JSON.stringify({ candidates: [
      { candidateId: "preview-1", adherence: 1, composition: 1, anatomy: 1, style: 1, technical: 1 },
      { candidateId: "preview-2", adherence: 1, composition: 1, anatomy: 1, style: 1, technical: 1 },
    ] })],
    ["duplicate id", JSON.stringify({ candidates: [1, 2, 3].map(() =>
      ({ candidateId: "preview-1", adherence: 1, composition: 1, anatomy: 1, style: 1, technical: 1 })) })],
    ["unknown id", JSON.stringify({ candidates: ["preview-1", "preview-2", "preview-9"].map((candidateId) =>
      ({ candidateId, adherence: 1, composition: 1, anatomy: 1, style: 1, technical: 1 })) })],
    ["out-of-range value", JSON.stringify({ candidates: ["preview-1", "preview-2", "preview-3"].map((candidateId) =>
      ({ candidateId, adherence: 101, composition: 1, anatomy: 1, style: 1, technical: 1 })) })],
    ["non-finite value", JSON.stringify({ candidates: ["preview-1", "preview-2", "preview-3"].map((candidateId) =>
      ({ candidateId, adherence: "NaN", composition: 1, anatomy: 1, style: 1, technical: 1 })) })],
  ])("fails closed after retrying a %s response once", async (_case, content) => {
    process.env.LITELLM_VISION_MODEL = "vision-model";
    completeChatMock.mockResolvedValue({ content });

    await expect(score(createScoringWorkflow())).rejects.toMatchObject({
      code: "llm_malformed_response",
      message: expect.stringContaining("failed twice"),
      details: { recoverable: true },
    });
    expect(completeChatMock).toHaveBeenCalledTimes(2);
  });

  it("retries the identical multimodal request once and then succeeds", async () => {
    process.env.LITELLM_VISION_MODEL = "vision-model";
    completeChatMock
      .mockResolvedValueOnce({ content: "{}" })
      .mockResolvedValueOnce({ content: validResponse() });

    await expect(score(createScoringWorkflow())).resolves.toMatchObject({
      selectedCandidateIds: ["preview-2", "preview-1"],
    });
    expect(completeChatMock).toHaveBeenCalledTimes(2);
    expect(completeChatMock.mock.calls[1]?.[0]).toEqual(completeChatMock.mock.calls[0]?.[0]);
  });

  it("uses Vision with default fallback for ordinary previews", async () => {
    process.env.LITELLM_VISION_MODEL = "vision-model";
    process.env.LITELLM_DEFAULT_MODEL = "default-model";
    completeChatMock.mockResolvedValue({ content: validResponse() });
    await score(createScoringWorkflow());
    expect(completeChatMock).toHaveBeenLastCalledWith(expect.objectContaining({ model: "vision-model", nsfw: false }));

    delete process.env.LITELLM_VISION_MODEL;
    completeChatMock.mockClear();
    await score(createScoringWorkflow());
    expect(completeChatMock).toHaveBeenLastCalledWith(expect.objectContaining({ model: "default-model", nsfw: false }));
  });

  it("uses only the NSFW multimodal model and never falls back to ordinary models", async () => {
    process.env.LITELLM_NSFW_MODEL = "nsfw-vision-model";
    process.env.LITELLM_VISION_MODEL = "ordinary-vision-model";
    process.env.LITELLM_DEFAULT_MODEL = "ordinary-default-model";
    completeChatMock.mockResolvedValue({ content: validResponse() });
    await score(createScoringWorkflow({ nsfw: true }));
    expect(completeChatMock).toHaveBeenLastCalledWith(expect.objectContaining({ model: "nsfw-vision-model", nsfw: true }));

    delete process.env.LITELLM_NSFW_MODEL;
    completeChatMock.mockClear();
    await expect(score(createScoringWorkflow({ nsfw: true }))).rejects.toMatchObject({ code: "llm_config" });
    expect(completeChatMock).not.toHaveBeenCalled();
  });
});
