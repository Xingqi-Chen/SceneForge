import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

const completeChatMock = vi.hoisted(() => vi.fn());
const readFileMock = vi.hoisted(() => vi.fn());
const getGeneratedImagePathMock = vi.hoisted(() => vi.fn((filename: string) => `C:\\safe\\${filename}`));
const storeGeneratedImageMock = vi.hoisted(() => vi.fn());

let smallPngBytes: Buffer;
let oversizedPngBytes: Buffer;

vi.mock("node:fs/promises", () => ({ default: { readFile: readFileMock } }));

vi.mock("@/features/llm", () => {
  class LiteLlmError extends Error {
    readonly statusCode?: number;
    constructor(message: string, options: { statusCode?: number } = {}) {
      super(message);
      this.statusCode = options.statusCode;
    }
  }
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
  getGeneratedImagePath: getGeneratedImagePathMock,
  storeGeneratedImage: storeGeneratedImageMock,
}));

vi.mock("@/features/comfyui/source-image-upload", () => ({
  uploadComfyUiTextToImageSourceImage: vi.fn((_client: unknown, request: unknown) => request),
}));

vi.mock("@/features/comfyui/sequence-reference-upload", () => ({
  uploadSequenceCharacterReferences: vi.fn(),
}));

import { createTimelineWorkflowState, setTimelineNodeManualResult } from "./state";
import { LiteLlmError } from "@/features/llm";
import { createTimelineT8ServerNodeAdapters } from "./t8-server-adapters";
import type {
  PreviewExecutionTimelineResult,
  PreviewScoringTimelineResultV2,
  TimelineNodeExecutionContext,
  TimelineWorkflowState,
} from "./types";

const originalEnv = { ...process.env };

beforeAll(async () => {
  smallPngBytes = await sharp({
    create: { width: 16, height: 8, channels: 4, background: { r: 20, g: 80, b: 140, alpha: 0.5 } },
  }).png().toBuffer();
  const width = 1_024;
  const height = 512;
  const pixels = Buffer.alloc(width * height * 3);
  for (let index = 0; index < pixels.length; index += 3) {
    const pixel = index / 3;
    pixels[index] = pixel % 251;
    pixels[index + 1] = Math.floor(pixel / width) % 241;
    pixels[index + 2] = (pixel * 13) % 239;
  }
  oversizedPngBytes = await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
  readFileMock.mockResolvedValue(smallPngBytes);
});

function createScoringWorkflow({
  candidateCount = 3,
  finalCount = 2,
  nsfw = false,
}: {
  candidateCount?: number;
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
  workflow = setTimelineNodeManualResult(workflow, "character-action", {
    action: "checking controls",
    poseSummary: "looking down at the console",
  });
  workflow = setTimelineNodeManualResult(workflow, "canvas-binding", {
    spatialSummary: "pilot centered beside the greenhouse console",
  });
  const previews: PreviewExecutionTimelineResult = {
    baseSeed: 100,
    candidateCount,
    finalCount,
    previewHeight: 512,
    previewWidth: 512,
    previewSteps: 10,
    candidates: Array.from({ length: candidateCount }, (_, index) => {
      const number = index + 1;
      return {
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
      };
    }),
    successfulCount: candidateCount,
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
      { candidateId: "preview-3", criticalDefects: [], adherence: 80, composition: 80, anatomy: 80, style: 80, technical: 80 },
      { candidateId: "preview-2", criticalDefects: [], adherence: 70, composition: 92, anatomy: 80, style: 80, technical: 80 },
      { candidateId: "preview-1", criticalDefects: [], adherence: 80, composition: 80, anatomy: 80, style: 80, technical: 80 },
    ],
  });
}

afterEach(() => {
  completeChatMock.mockReset();
  readFileMock.mockReset().mockResolvedValue(smallPngBytes);
  getGeneratedImagePathMock.mockClear();
  storeGeneratedImageMock.mockClear();
  process.env = { ...originalEnv };
});

describe("T37 structured preview scoring", () => {
  it("transcodes managed previews to bounded decodable JPEGs in memory without changing stored images", async () => {
    process.env.LITELLM_VISION_MODEL = "vision-model";
    const originalBytes = Buffer.from(oversizedPngBytes);
    const workflow = createScoringWorkflow();
    const storedBefore = JSON.stringify(workflow.nodes["preview-execution"].result);
    readFileMock.mockResolvedValueOnce(oversizedPngBytes).mockResolvedValue(smallPngBytes);
    completeChatMock.mockResolvedValue({ content: validResponse() });

    await score(workflow);

    const request = completeChatMock.mock.calls[0]?.[0] as {
      messages: Array<{ content: Array<{ type: string; image_url?: { url: string; detail: string } }> }>;
    };
    const images = request.messages[0]!.content.filter((item) => item.type === "image_url");
    expect(images).toHaveLength(3);
    expect(images.every((item) => item.image_url?.url.startsWith("data:image/jpeg;base64,"))).toBe(true);
    expect(images.every((item) => item.image_url?.detail === "high")).toBe(true);
    const jpegBytes = Buffer.from(images[0]!.image_url!.url.split(",")[1]!, "base64");
    const metadata = await sharp(jpegBytes).metadata();
    expect(metadata).toMatchObject({ format: "jpeg", width: 768, height: 384, channels: 3 });
    expect(jpegBytes.byteLength).toBeLessThan(oversizedPngBytes.byteLength);
    expect(oversizedPngBytes).toEqual(originalBytes);
    expect(JSON.stringify(workflow.nodes["preview-execution"].result)).toBe(storedBefore);
    expect(readFileMock).toHaveBeenCalledTimes(3);
    expect(getGeneratedImagePathMock).toHaveBeenCalledTimes(3);
    expect(storeGeneratedImageMock).not.toHaveBeenCalled();
  }, 15_000);

  it("sends all eight preview JPEGs in one comparative Vision request", async () => {
    process.env.LITELLM_VISION_MODEL = "vision-model";
    const candidates = Array.from({ length: 8 }, (_, index) => ({
      candidateId: `preview-${index + 1}`,
      criticalDefects: [],
      adherence: 90 - index,
      composition: 90 - index,
      anatomy: 90 - index,
      style: 90 - index,
      technical: 90 - index,
    }));
    completeChatMock.mockResolvedValue({ content: JSON.stringify({ candidates }) });

    const result = await score(createScoringWorkflow({ candidateCount: 8, finalCount: 4 })) as PreviewScoringTimelineResultV2;

    expect(result.selectedCandidateIds).toEqual(["preview-1", "preview-2", "preview-3", "preview-4"]);
    expect(completeChatMock).toHaveBeenCalledTimes(1);
    const request = completeChatMock.mock.calls[0]?.[0] as {
      messages: Array<{ content: Array<{ type: string; text?: string; image_url?: { url: string } }> }>;
    };
    const content = request.messages[0]!.content;
    expect(content.filter((item) => item.type === "image_url")).toHaveLength(8);
    expect(content.filter((item) => item.type === "text" && item.text?.startsWith("Candidate ID:"))).toHaveLength(8);
    expect(readFileMock).toHaveBeenCalledTimes(8);
    expect(storeGeneratedImageMock).not.toHaveBeenCalled();
  });

  it("returns safe candidate-scoped diagnostics when scoring-image reads fail", async () => {
    process.env.LITELLM_VISION_MODEL = "vision-model";
    getGeneratedImagePathMock.mockReturnValueOnce("C:\\PRIVATE\\preview-1.png");
    readFileMock.mockRejectedValueOnce(new Error("ENOENT C:\\PRIVATE\\preview-1.png data:image/png;base64,SECRET_BYTES"));

    const error = await score(createScoringWorkflow()).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: "image_storage_failed",
      details: { candidateId: "preview-1", stage: "scoring_image_read", recoverable: true },
    });
    const exposed = `${String(error)} ${JSON.stringify(error)}`;
    expect(exposed).not.toContain("PRIVATE");
    expect(exposed).not.toContain("SECRET_BYTES");
    expect(exposed).not.toContain("data:image");
    expect(completeChatMock).not.toHaveBeenCalled();
    expect(storeGeneratedImageMock).not.toHaveBeenCalled();
  });

  it("returns safe candidate-scoped diagnostics when scoring-image transcoding fails", async () => {
    process.env.LITELLM_VISION_MODEL = "vision-model";
    readFileMock.mockResolvedValueOnce(Buffer.from("PRIVATE_BYTES data:image/png;base64,SECRET"));

    const error = await score(createScoringWorkflow()).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: "image_storage_failed",
      details: { candidateId: "preview-1", stage: "scoring_image_transcode", recoverable: true },
    });
    const exposed = `${String(error)} ${JSON.stringify(error)}`;
    expect(exposed).not.toContain("PRIVATE_BYTES");
    expect(exposed).not.toContain("SECRET");
    expect(exposed).not.toContain("data:image");
    expect(completeChatMock).not.toHaveBeenCalled();
    expect(storeGeneratedImageMock).not.toHaveBeenCalled();
  });

  it("computes fixed local weights and resolves ties by composition then candidate order", async () => {
    process.env.LITELLM_VISION_MODEL = "vision-model";
    completeChatMock.mockResolvedValue({ content: validResponse() });

    await expect(score(createScoringWorkflow())).resolves.toMatchObject({
      rubricVersion: 2,
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
          criticalDefects: [],
        },
        {
          candidateId: "preview-2",
          adherence: 63.3433333333,
          composition: 100,
          anatomy: 80,
          style: 80,
          technical: 80,
          criticalDefects: [],
        },
        {
          candidateId: "preview-3",
          adherence: 70,
          composition: 70,
          anatomy: 70,
          style: 70,
          technical: 70,
          criticalDefects: [],
        },
      ],
    }) });

    const result = await score(createScoringWorkflow()) as PreviewScoringTimelineResultV2;

    expect(result.scores.slice(0, 2)).toMatchObject([
      { candidateId: "preview-1", composition: 80, total: 80, rank: 1 },
      { candidateId: "preview-2", composition: 100, total: 80, rank: 2 },
    ]);
    expect(result.selectedCandidateIds).toEqual(["preview-1", "preview-2"]);
  });

  it.each([
    ["non JSON", "not-json"],
    ["missing id", JSON.stringify({ candidates: [
      { candidateId: "preview-1", criticalDefects: [], adherence: 1, composition: 1, anatomy: 1, style: 1, technical: 1 },
      { candidateId: "preview-2", criticalDefects: [], adherence: 1, composition: 1, anatomy: 1, style: 1, technical: 1 },
    ] })],
    ["duplicate id", JSON.stringify({ candidates: [1, 2, 3].map(() =>
      ({ candidateId: "preview-1", criticalDefects: [], adherence: 1, composition: 1, anatomy: 1, style: 1, technical: 1 })) })],
    ["unknown id", JSON.stringify({ candidates: ["preview-1", "preview-2", "preview-9"].map((candidateId) =>
      ({ candidateId, criticalDefects: [], adherence: 1, composition: 1, anatomy: 1, style: 1, technical: 1 })) })],
    ["out-of-range value", JSON.stringify({ candidates: ["preview-1", "preview-2", "preview-3"].map((candidateId) =>
      ({ candidateId, criticalDefects: [], adherence: 101, composition: 1, anatomy: 1, style: 1, technical: 1 })) })],
    ["non-finite value", JSON.stringify({ candidates: ["preview-1", "preview-2", "preview-3"].map((candidateId) =>
      ({ candidateId, criticalDefects: [], adherence: "NaN", composition: 1, anatomy: 1, style: 1, technical: 1 })) })],
  ])("fails closed after retrying a %s response once", async (_case, content) => {
    process.env.LITELLM_VISION_MODEL = "vision-model";
    completeChatMock.mockResolvedValue({ content });

    await expect(score(createScoringWorkflow())).rejects.toMatchObject({
      code: "llm_malformed_response",
      message: expect.stringContaining("after the bounded request attempts"),
      details: {
        recoverable: true,
        validationCode: expect.any(String),
        validationReason: expect.any(String),
      },
    });
    expect(completeChatMock).toHaveBeenCalledTimes(2);
    expect(completeChatMock.mock.calls[1]?.[0]).toMatchObject({
      messages: expect.arrayContaining([expect.objectContaining({
        role: "user",
        content: expect.stringContaining("Repair the response schema"),
      })]),
    });
  });

  it.each([
    ["missing defects", { criticalDefects: undefined }, "critical_defects_missing"],
    ["non-array defects", { criticalDefects: "none" }, "critical_defects_missing"],
    ["unknown category", { criticalDefects: ["unknown SECRET_CATEGORY"] }, "critical_defect_category"],
    ["blank category", { criticalDefects: ["   "] }, "critical_defect_category"],
  ])("rejects malformed v2 critical-defect data: %s", async (_case, override, validationCode) => {
    process.env.LITELLM_VISION_MODEL = "vision-model";
    const candidates = JSON.parse(validResponse()).candidates as Array<Record<string, unknown>>;
    Object.assign(candidates[0]!, override);
    completeChatMock.mockResolvedValue({ content: JSON.stringify({ candidates }) });

    const error = await score(createScoringWorkflow()).catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      code: "llm_malformed_response",
      details: { recoverable: true, validationCode },
    });
    expect(completeChatMock).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(error)).not.toContain("SECRET_CATEGORY");
    expect(JSON.stringify(completeChatMock.mock.calls[1]?.[0])).not.toContain("SECRET_CATEGORY");
  });

  it("extracts one JSON object from wrapper prose and markdown and accepts numeric strings", async () => {
    process.env.LITELLM_VISION_MODEL = "vision-model";
    const candidates = JSON.parse(validResponse()).candidates as Array<Record<string, unknown>>;
    for (const candidate of candidates) {
      candidate.adherence = String(candidate.adherence);
      candidate.composition = ` ${candidate.composition} `;
    }
    completeChatMock.mockResolvedValue({
      content: `Here is the comparison:\n\n\`\`\`json\n${JSON.stringify({ candidates })}\n\`\`\`\nDone.`,
    });

    await expect(score(createScoringWorkflow())).resolves.toMatchObject({
      rubricVersion: 2,
      selectedCandidateIds: ["preview-2", "preview-1"],
    });
    expect(completeChatMock).toHaveBeenCalledTimes(1);
  });

  it("requires exactly one JSON object even when both objects are individually valid", async () => {
    process.env.LITELLM_VISION_MODEL = "vision-model";
    completeChatMock.mockResolvedValue({ content: `${validResponse()}\n${validResponse()}` });

    await expect(score(createScoringWorkflow())).rejects.toMatchObject({
      code: "llm_malformed_response",
      details: { validationCode: "json_object_count", recoverable: true },
    });
    expect(completeChatMock).toHaveBeenCalledTimes(2);
  });

  it("normalizes exact defect categories, accepts legacy objects, deduplicates, and derives eligibility locally", async () => {
    process.env.LITELLM_VISION_MODEL = "vision-model";
    const candidates = JSON.parse(validResponse()).candidates as Array<Record<string, unknown>>;
    Object.assign(candidates[0]!, {
      criticalDefects: [
        " Severe Exposure ",
        "severe-exposure",
        { category: "SEVERE_EXPOSURE", description: "model supplied text must not persist" },
      ],
      eligible: true,
    });
    Object.assign(candidates[1]!, { eligible: false });
    completeChatMock.mockResolvedValue({ content: JSON.stringify({ candidates }) });

    const result = await score(createScoringWorkflow()) as PreviewScoringTimelineResultV2;
    expect(result.scores.find((item) => item.candidateId === "preview-3")).toMatchObject({
      eligible: false,
      criticalDefects: [{
        category: "severe_exposure",
        description: "Catastrophic exposure or technical corruption that makes the render unreadable.",
      }],
    });
    expect(result.scores.find((item) => item.candidateId === "preview-2")).toMatchObject({
      eligible: true,
      criticalDefects: [],
    });
    expect(JSON.stringify(result)).not.toContain("model supplied text must not persist");
  });

  it.each([
    ["spatial_physical_contradiction", true],
    ["gaze_or_action_mismatch", false],
    ["subject_scale_or_framing", false],
    ["severe_exposure", true],
    ["anatomy_or_structure", true],
  ] as const)("derives the supported %s category with blocking=%s", async (category, blocking) => {
    process.env.LITELLM_VISION_MODEL = "vision-model";
    const candidates = JSON.parse(validResponse()).candidates as Array<Record<string, unknown>>;
    Object.assign(candidates[0]!, {
      adherence: 100,
      anatomy: 100,
      composition: 100,
      criticalDefects: [category],
      style: 100,
      technical: 100,
    });
    completeChatMock.mockResolvedValue({ content: JSON.stringify({ candidates }) });

    const result = await score(createScoringWorkflow()) as PreviewScoringTimelineResultV2;
    expect(result.scores.find((item) => item.candidateId === "preview-3")).toMatchObject({
      eligible: !blocking,
      rank: blocking ? 3 : 1,
    });
    expect(result.selectedCandidateIds).toEqual(blocking
      ? ["preview-2", "preview-1"]
      : ["preview-3", "preview-2"]);
  });

  it("fills exact K with the highest-ranked fallback and derives warning metadata", async () => {
    process.env.LITELLM_VISION_MODEL = "vision-model";
    const workflow = createScoringWorkflow({ finalCount: 2 });
    const candidates = JSON.parse(validResponse()).candidates as Array<Record<string, unknown>>;
    for (const candidate of candidates.slice(0, 2)) {
      Object.assign(candidate, {
        criticalDefects: ["spatial_physical_contradiction"],
      });
    }
    completeChatMock.mockResolvedValue({ content: JSON.stringify({ candidates }) });

    await expect(score(workflow)).resolves.toMatchObject({
      eligibleCount: 1,
      fallbackCandidateIds: ["preview-2"],
      selectedCandidateIds: ["preview-1", "preview-2"],
      selectionWarning: expect.stringContaining("1 annotated fallback candidate was selected"),
    });
    expect(completeChatMock).toHaveBeenCalledTimes(1);
    expect(workflow.nodes["preview-execution"].result).toMatchObject({ successfulCount: 3 });
  });

  it("returns exact K highest-ranked fallbacks when zero candidates are eligible", async () => {
    process.env.LITELLM_VISION_MODEL = "vision-model";
    const candidates = JSON.parse(validResponse()).candidates as Array<Record<string, unknown>>;
    for (const candidate of candidates) candidate.criticalDefects = ["anatomy_or_structure"];
    completeChatMock.mockResolvedValue({ content: JSON.stringify({ candidates }) });

    await expect(score(createScoringWorkflow({ finalCount: 2 }))).resolves.toMatchObject({
      eligibleCount: 0,
      fallbackCandidateIds: ["preview-2", "preview-1"],
      selectedCandidateIds: ["preview-2", "preview-1"],
      selectionWarning: expect.stringContaining("Only 0 preview candidates passed blocking-defect checks"),
      scores: [
        { candidateId: "preview-2", eligible: false, rank: 1 },
        { candidateId: "preview-1", eligible: false, rank: 2 },
        { candidateId: "preview-3", eligible: false, rank: 3 },
      ],
    });
    expect(completeChatMock).toHaveBeenCalledTimes(1);
  });

  it("adds a safe schema-repair instruction on the only retry and then succeeds", async () => {
    process.env.LITELLM_VISION_MODEL = "vision-model";
    completeChatMock
      .mockResolvedValueOnce({ content: "{}" })
      .mockResolvedValueOnce({ content: validResponse() });

    await expect(score(createScoringWorkflow())).resolves.toMatchObject({
      selectedCandidateIds: ["preview-2", "preview-1"],
    });
    expect(completeChatMock).toHaveBeenCalledTimes(2);
    expect(completeChatMock.mock.calls[1]?.[0]).not.toEqual(completeChatMock.mock.calls[0]?.[0]);
    expect(completeChatMock.mock.calls[1]?.[0]).toMatchObject({
      messages: [
        completeChatMock.mock.calls[0]?.[0].messages[0],
        {
          role: "user",
          content: expect.stringContaining("Scoring response must include a candidates array"),
        },
      ],
    });
  });

  it("reports upstream Vision failures separately from schema failures", async () => {
    process.env.LITELLM_VISION_MODEL = "vision-model";
    completeChatMock.mockRejectedValue(new LiteLlmError("PRIVATE upstream detail", { statusCode: 502 }));

    const error = await score(createScoringWorkflow()).catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      code: "llm_upstream",
      details: { recoverable: true, statusCode: 502 },
    });
    expect(JSON.stringify(error)).not.toContain("PRIVATE upstream detail");
    expect(completeChatMock).toHaveBeenCalledTimes(2);
    expect(completeChatMock.mock.calls[1]?.[0]).toEqual(completeChatMock.mock.calls[0]?.[0]);
    expect(JSON.stringify(completeChatMock.mock.calls)).not.toContain("Repair the response schema");
  });

  it("retries a generic network failure once without leaking its message or adding schema repair", async () => {
    process.env.LITELLM_VISION_MODEL = "vision-model";
    completeChatMock.mockRejectedValue(new TypeError("PRIVATE network endpoint detail"));

    const error = await score(createScoringWorkflow()).catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      code: "llm_upstream",
      details: { recoverable: true },
    });
    expect((error as { details?: unknown }).details).not.toHaveProperty("statusCode");
    expect(JSON.stringify(error)).not.toContain("PRIVATE network endpoint detail");
    expect(completeChatMock).toHaveBeenCalledTimes(2);
    expect(completeChatMock.mock.calls[1]?.[0]).toEqual(completeChatMock.mock.calls[0]?.[0]);
    expect(JSON.stringify(completeChatMock.mock.calls)).not.toContain("Repair the response schema");
  });

  it("classifies malformed then network failure as upstream after two attempts", async () => {
    process.env.LITELLM_VISION_MODEL = "vision-model";
    completeChatMock
      .mockResolvedValueOnce({ content: "{}" })
      .mockRejectedValueOnce(new TypeError("PRIVATE terminal network detail"));

    const error = await score(createScoringWorkflow()).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "llm_upstream", details: { recoverable: true } });
    expect(JSON.stringify(error)).not.toContain("PRIVATE terminal network detail");
    expect(completeChatMock).toHaveBeenCalledTimes(2);
    expect(completeChatMock.mock.calls[1]?.[0]).toMatchObject({
      messages: expect.arrayContaining([expect.objectContaining({
        role: "user",
        content: expect.stringContaining("Repair the response schema"),
      })]),
    });
  });

  it("classifies network then malformed response as malformed without a third repair attempt", async () => {
    process.env.LITELLM_VISION_MODEL = "vision-model";
    completeChatMock
      .mockRejectedValueOnce(new TypeError("PRIVATE transient network detail"))
      .mockResolvedValueOnce({ content: "{}" });

    const error = await score(createScoringWorkflow()).catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      code: "llm_malformed_response",
      message: expect.stringContaining("after the bounded request attempts"),
      details: { recoverable: true, validationCode: expect.any(String) },
    });
    expect(JSON.stringify(error)).not.toContain("PRIVATE transient network detail");
    expect(completeChatMock).toHaveBeenCalledTimes(2);
    expect(completeChatMock.mock.calls[1]?.[0]).toEqual(completeChatMock.mock.calls[0]?.[0]);
    expect(JSON.stringify(completeChatMock.mock.calls)).not.toContain("Repair the response schema");
  });

  it("uses Vision with default fallback for ordinary previews", async () => {
    process.env.LITELLM_VISION_MODEL = "vision-model";
    process.env.LITELLM_DEFAULT_MODEL = "default-model";
    completeChatMock.mockResolvedValue({ content: validResponse() });
    await score(createScoringWorkflow());
    expect(completeChatMock).toHaveBeenLastCalledWith(expect.objectContaining({
      model: "vision-model",
      nsfw: false,
      maxTokens: 4_000,
    }));
    const request = completeChatMock.mock.calls.at(-1)?.[0] as {
      messages: Array<{ content: Array<{ type: string; text?: string; image_url?: { detail?: string } }> }>;
    };
    expect(request.messages[0]!.content.filter((item) => item.type === "image_url").every((item) =>
      item.image_url?.detail === "high"
    )).toBe(true);
    const scoringPrompt = request.messages[0]!.content.find((item) => item.type === "text")?.text;
    expect(scoringPrompt).toEqual(expect.stringContaining("Original user intent: A pilot in a greenhouse"));
    expect(scoringPrompt).toEqual(expect.stringContaining("checking controls; looking down at the console"));
    expect(scoringPrompt).toEqual(expect.stringContaining("pilot centered beside the greenhouse console"));
    expect(scoringPrompt).toEqual(expect.stringContaining("Formal generation prompt: glass greenhouse pilot"));
    expect(scoringPrompt).toEqual(expect.stringContaining("Blocking defects are rare"));
    expect(scoringPrompt).toEqual(expect.stringContaining("gaze_or_action_mismatch and subject_scale_or_framing are non-blocking"));
    expect(scoringPrompt).toEqual(expect.stringContaining("missing prompt details, a missing prop or requested contact"));
    expect(scoringPrompt).toEqual(expect.stringContaining("skin or hair"));
    expect(scoringPrompt).toEqual(expect.stringContaining("SceneForge derives eligibility locally"));
    expect(scoringPrompt).not.toEqual(expect.stringContaining('"eligible"'));

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
