import { afterEach, describe, expect, it, vi } from "vitest";

const completeChatMock = vi.hoisted(() => vi.fn());
const createStoredImageVisionDataUrlMock = vi.hoisted(() => vi.fn(async (_stored, itemId: string) =>
  `data:image/jpeg;base64,TRANSIENT_${itemId}`));

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

vi.mock("./vision-image-transcode.server", () => ({
  createStoredImageVisionDataUrl: createStoredImageVisionDataUrlMock,
}));

import { LiteLlmError } from "@/features/llm";

import {
  FinalReviewValidationError,
  getCompletedFinalReviewPairs,
  parseFinalReviewResponse,
  selectFinalReviewVariant,
} from "./final-review";
import { reviewFinalExecution } from "./final-review.server";
import { createTimelineWorkflowState } from "./state";
import { createTimelineT8ServerNodeAdapters } from "./t8-server-adapters";
import type {
  ComfyUiExecutionTimelineResult,
  TimelineFinalReviewPair,
  TimelineNodeExecutionContext,
  TimelineWorkflowState,
} from "./types";

const originalEnv = { ...process.env };

function storedImage(hex: string) {
  const filename = `${hex.repeat(32)}.png`;
  return {
    byteLength: 128,
    contentType: "image/png",
    filename,
    url: `/api/comfyui/generated-images/${filename}`,
  };
}

function createExecution(pairCount = 2): ComfyUiExecutionTimelineResult {
  return {
    completed: true,
    finalCount: pairCount,
    finals: Array.from({ length: pairCount }, (_, index) => {
      const number = index + 1;
      return {
        candidateId: `preview-${number}`,
        rank: number,
        seed: 99 + number,
        status: "done" as const,
        storedImage: storedImage((index + 1).toString(16)),
        previewUpscale: {
          policyVersion: 2,
          resizeMode: "lanczos3-exact" as const,
          width: 1024,
          height: 1024,
          sourcePreview: storedImage((index + 5).toString(16)),
          storedImage: storedImage((index + 9).toString(16)),
        },
      };
    }),
    request: {
      checkpointName: "local.safetensors",
      positivePrompt: "PRIVATE_FORMAL_PROMPT",
    },
    warnings: [],
  };
}

function finding(
  operation: "pose" | "contact" | "object-count" | "composition-consistency",
  override: Record<string, unknown> = {},
) {
  return {
    operation,
    severity: "none",
    scope: "pair",
    introducedByFinal: false,
    description: `${operation} is consistent`,
    ...override,
  };
}

function pairResponse(candidateId: string, override: Record<string, unknown> = {}) {
  return {
    candidateId,
    scores: {
      previewUpscale: { adherence: 80, composition: 70, anatomy: 90, style: 60, technical: 100 },
      final: { adherence: "90", composition: 80, anatomy: 70, style: 100, technical: 60 },
    },
    findings: [
      finding("pose"),
      finding("contact"),
      finding("object-count"),
      finding("composition-consistency"),
    ],
    rationale: "Final is cleaner while preserving structure.",
    recommendation: "preview-upscale",
    eligible: false,
    ...override,
  };
}

function validResponse(pairCount = 2, pairOverrides: Record<number, Record<string, unknown>> = {}) {
  return JSON.stringify({
    pairs: Array.from({ length: pairCount }, (_, index) =>
      pairResponse(`preview-${index + 1}`, pairOverrides[index] ?? {})),
  });
}

function createContext(execution: ComfyUiExecutionTimelineResult, nsfw = false): TimelineNodeExecutionContext {
  const base = createTimelineWorkflowState({
    workflowId: "t38b-review",
    sceneRequest: "PRIVATE_ORIGINAL_INTENT",
  });
  const workflow: TimelineWorkflowState = {
    ...base,
    nodes: {
      ...base.nodes,
      "scene-input": {
        ...base.nodes["scene-input"],
        result: { rawIntent: "PRIVATE_ORIGINAL_INTENT", nsfw },
      },
      "character-action": {
        ...base.nodes["character-action"],
        result: { action: "holding a cup", poseSummary: "right hand touching cup" },
      },
      "canvas-binding": {
        ...base.nodes["canvas-binding"],
        result: { spatialSummary: "subject centered beside a table" },
      },
      "parameter-recommendation": {
        ...base.nodes["parameter-recommendation"],
        result: { requestPreview: { positivePrompt: "PRIVATE_FORMAL_PROMPT" } },
      },
      "comfyui-execution": {
        ...base.nodes["comfyui-execution"],
        status: "done",
        source: "system",
        result: execution,
      },
    },
  };
  return {
    nodeId: "final-review",
    workflow,
    dependencies: [workflow.nodes["comfyui-execution"]],
  };
}

afterEach(() => {
  completeChatMock.mockReset();
  createStoredImageVisionDataUrlMock.mockClear();
  process.env = { ...originalEnv };
});

describe("T38B Final review parser and local policy", () => {
  it.each([1, 2, 3, 4])("accepts exact complete coverage for %i managed pair(s)", (pairCount) => {
    const sourcePairs = getCompletedFinalReviewPairs(createExecution(pairCount));
    const result = parseFinalReviewResponse(`Review:\n\`\`\`json\n${validResponse(pairCount)}\n\`\`\``, sourcePairs);

    expect(result).toMatchObject({
      reviewVersion: 1,
      status: "reviewed",
      pairs: sourcePairs.map((pair) => ({
        candidateId: pair.candidateId,
        recommendedVariant: "final",
        defaultVariant: "final",
        scores: {
          previewUpscale: { total: 78.5 },
          final: { total: 82 },
        },
      })),
    });
    expect(result.pairs.every((pair) => pair.findings?.length === 4)).toBe(true);
  });

  it.each([
    ["major", true, "preview-upscale"],
    ["blocking", true, "preview-upscale"],
    ["minor", true, "final"],
    ["major", false, "final"],
  ] as const)("derives %s introducedByFinal=%s locally as %s", (severity, introducedByFinal, expected) => {
    const pairs = getCompletedFinalReviewPairs(createExecution(1));
    const findings = [
      finding("pose", { severity, scope: "final", introducedByFinal }),
      finding("contact"),
      finding("object-count"),
      finding("composition-consistency"),
    ];
    const result = parseFinalReviewResponse(validResponse(1, {
      0: { findings, recommendation: expected === "final" ? "preview-upscale" : "final", eligible: false },
    }), pairs);

    expect(result.pairs[0]).toMatchObject({ recommendedVariant: expected, defaultVariant: expected });
  });

  it("normalizes supported closed values while ignoring model-authored selection fields", () => {
    const pairs = getCompletedFinalReviewPairs(createExecution(1));
    const result = parseFinalReviewResponse(validResponse(1, {
      0: {
        findings: [
          finding("pose", { operation: " POSE ", severity: " MAJOR ", scope: " FINAL ", introducedByFinal: "TRUE" }),
          finding("contact", { operation: "Contact" }),
          finding("object-count", { operation: "object_count" }),
          finding("composition-consistency", { operation: "composition consistency" }),
        ],
        recommendation: "final",
        defaultVariant: "final",
      },
    }), pairs);

    expect(result.pairs[0]).toMatchObject({
      recommendedVariant: "preview-upscale",
      defaultVariant: "preview-upscale",
      findings: expect.arrayContaining([
        expect.objectContaining({ operation: "pose", severity: "major", scope: "final", introducedByFinal: true }),
        expect.objectContaining({ operation: "object-count" }),
        expect.objectContaining({ operation: "composition-consistency" }),
      ]),
    });
  });

  it.each([
    ["missing pair", { pairs: [pairResponse("preview-1")] }],
    ["duplicate pair", { pairs: [pairResponse("preview-1"), pairResponse("preview-1")] }],
    ["unknown pair", { pairs: [pairResponse("preview-1"), pairResponse("preview-9")] }],
    ["missing operation", { pairs: [pairResponse("preview-1"), pairResponse("preview-2", { findings: [finding("pose"), finding("contact"), finding("object-count")] })] }],
    ["duplicate operation", { pairs: [pairResponse("preview-1"), pairResponse("preview-2", { findings: [finding("pose"), finding("pose"), finding("object-count"), finding("composition-consistency")] })] }],
    ["unknown severity", { pairs: [pairResponse("preview-1"), pairResponse("preview-2", { findings: [finding("pose", { severity: "critical" }), finding("contact"), finding("object-count"), finding("composition-consistency")] })] }],
    ["unknown scope", { pairs: [pairResponse("preview-1"), pairResponse("preview-2", { findings: [finding("pose", { scope: "both" }), finding("contact"), finding("object-count"), finding("composition-consistency")] })] }],
    ["unknown operation", { pairs: [pairResponse("preview-1"), pairResponse("preview-2", { findings: [finding("pose", { operation: "lighting" }), finding("contact"), finding("object-count"), finding("composition-consistency")] })] }],
    ["invalid boolean", { pairs: [pairResponse("preview-1"), pairResponse("preview-2", { findings: [finding("pose", { introducedByFinal: "yes" }), finding("contact"), finding("object-count"), finding("composition-consistency")] })] }],
    ["non-finite score", { pairs: [pairResponse("preview-1"), pairResponse("preview-2", { scores: { previewUpscale: { adherence: "Infinity", composition: 1, anatomy: 1, style: 1, technical: 1 }, final: { adherence: 1, composition: 1, anatomy: 1, style: 1, technical: 1 } } })] }],
  ])("fails closed for %s", (_case, response) => {
    const pairs = getCompletedFinalReviewPairs(createExecution(2));
    expect(() => parseFinalReviewResponse(JSON.stringify(response), pairs)).toThrow(FinalReviewValidationError);
  });

  it("changes only the user-selected variant and leaves all node statuses/results upstream intact", () => {
    const base = createTimelineWorkflowState({ workflowId: "selection", sceneRequest: "scene" });
    const pairs = parseFinalReviewResponse(validResponse(1), getCompletedFinalReviewPairs(createExecution(1))).pairs;
    const workflow: TimelineWorkflowState = {
      ...base,
      nodes: {
        ...base.nodes,
        "comfyui-execution": { ...base.nodes["comfyui-execution"], status: "done", result: createExecution(1) },
        "final-review": {
          ...base.nodes["final-review"],
          status: "done",
          source: "ai",
          result: { reviewVersion: 1, status: "reviewed", pairs },
        },
        "result-display": { ...base.nodes["result-display"], status: "done", result: { completed: true } },
      },
    };
    const statusesBefore = Object.fromEntries(Object.entries(workflow.nodes).map(([id, node]) => [id, node.status]));
    const upstreamBefore = workflow.nodes["comfyui-execution"].result;

    const selected = selectFinalReviewVariant(workflow, "preview-1", "preview-upscale", "2026-07-22T00:00:00.000Z");

    expect((selected.nodes["final-review"].result as { pairs: TimelineFinalReviewPair[] }).pairs[0]).toMatchObject({
      defaultVariant: "final",
      recommendedVariant: "final",
      userSelectedVariant: "preview-upscale",
    });
    expect(Object.fromEntries(Object.entries(selected.nodes).map(([id, node]) => [id, node.status]))).toEqual(statusesBefore);
    expect(selected.nodes["comfyui-execution"].result).toBe(upstreamBefore);
  });
});

describe("T38B Final review provider boundary", () => {
  it("sends all four pairs in one high-detail comparative request and persists no transient payload", async () => {
    process.env.LITELLM_BASE_URL = "http://litellm.test";
    process.env.LITELLM_VISION_MODEL = "vision-model";
    completeChatMock.mockResolvedValue({ content: validResponse(4) });

    const result = await reviewFinalExecution(createExecution(4), createContext(createExecution(4)));

    expect(result).toMatchObject({ status: "reviewed", pairs: expect.arrayContaining([
      expect.objectContaining({ candidateId: "preview-1" }),
      expect.objectContaining({ candidateId: "preview-4" }),
    ]) });
    expect(completeChatMock).toHaveBeenCalledTimes(1);
    const request = completeChatMock.mock.calls[0]?.[0] as {
      model: string;
      purpose: string;
      messages: Array<{ content: Array<{ type: string; image_url?: { detail: string; url: string } }> }>;
    };
    expect(request).toMatchObject({ model: "vision-model", purpose: "single-image-final-review" });
    const images = request.messages[0]!.content.filter((item) => item.type === "image_url");
    expect(images).toHaveLength(8);
    expect(images.every((item) => item.image_url?.detail === "high")).toBe(true);
    expect(createStoredImageVisionDataUrlMock).toHaveBeenCalledTimes(8);
    expect(JSON.stringify(result)).not.toContain("data:image");
    expect(JSON.stringify(result)).not.toContain("PRIVATE_");
    expect(JSON.stringify(result)).not.toContain("C:\\");
  });

  it("uses Vision then default fallback for ordinary review", async () => {
    process.env.LITELLM_BASE_URL = "http://litellm.test";
    process.env.LITELLM_VISION_MODEL = "vision-model";
    process.env.LITELLM_DEFAULT_MODEL = "default-model";
    completeChatMock.mockResolvedValue({ content: validResponse(1) });
    await reviewFinalExecution(createExecution(1), createContext(createExecution(1)));
    expect(completeChatMock).toHaveBeenLastCalledWith(expect.objectContaining({ model: "vision-model", nsfw: false }));

    delete process.env.LITELLM_VISION_MODEL;
    completeChatMock.mockClear();
    await reviewFinalExecution(createExecution(1), createContext(createExecution(1)));
    expect(completeChatMock).toHaveBeenLastCalledWith(expect.objectContaining({ model: "default-model", nsfw: false }));
  });

  it("requires the NSFW model and never falls back to ordinary models", async () => {
    process.env.LITELLM_BASE_URL = "http://litellm.test";
    process.env.LITELLM_VISION_MODEL = "ordinary-vision";
    process.env.LITELLM_DEFAULT_MODEL = "ordinary-default";

    const unavailable = await reviewFinalExecution(createExecution(1), createContext(createExecution(1), true));
    expect(unavailable).toMatchObject({ status: "failed", error: { code: "llm_config", details: { recoverable: true } } });
    expect(completeChatMock).not.toHaveBeenCalled();

    process.env.LITELLM_NSFW_MODEL = "nsfw-vision";
    completeChatMock.mockResolvedValue({ content: validResponse(1) });
    await reviewFinalExecution(createExecution(1), createContext(createExecution(1), true));
    expect(completeChatMock).toHaveBeenLastCalledWith(expect.objectContaining({ model: "nsfw-vision", nsfw: true }));
  });

  it("uses one safe schema repair and never makes a third provider call", async () => {
    process.env.LITELLM_BASE_URL = "http://litellm.test";
    process.env.LITELLM_VISION_MODEL = "vision-model";
    completeChatMock
      .mockResolvedValueOnce({ content: "{\"pairs\":[],\"raw\":\"PRIVATE_RAW_RESPONSE\"}" })
      .mockResolvedValueOnce({ content: validResponse(1) });

    await expect(reviewFinalExecution(createExecution(1), createContext(createExecution(1)))).resolves.toMatchObject({ status: "reviewed" });
    expect(completeChatMock).toHaveBeenCalledTimes(2);
    expect(completeChatMock.mock.calls[1]?.[0]).toMatchObject({
      messages: expect.arrayContaining([expect.objectContaining({
        role: "user",
        content: expect.stringContaining("Safe validation reason"),
      })]),
    });
    expect(JSON.stringify(completeChatMock.mock.calls[1]?.[0])).not.toContain("PRIVATE_RAW_RESPONSE");
  });

  it("separates terminal upstream and malformed-schema failures and redacts unsafe details", async () => {
    process.env.LITELLM_BASE_URL = "http://litellm.test";
    process.env.LITELLM_VISION_MODEL = "vision-model";
    completeChatMock.mockRejectedValue(new LiteLlmError("PRIVATE_UPSTREAM data:image/png;base64,SECRET", { statusCode: 502 }));

    const upstream = await reviewFinalExecution(createExecution(1), createContext(createExecution(1)));
    expect(upstream).toMatchObject({ status: "failed", error: { code: "llm_upstream", details: { statusCode: 502 } } });
    expect(completeChatMock).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(upstream)).not.toContain("PRIVATE_UPSTREAM");
    expect(JSON.stringify(upstream)).not.toContain("data:image");

    completeChatMock.mockReset().mockResolvedValue({ content: "{\"pairs\":[],\"raw\":\"PRIVATE_RAW_RESPONSE\"}" });
    const malformed = await reviewFinalExecution(createExecution(1), createContext(createExecution(1)));
    expect(malformed).toMatchObject({
      status: "failed",
      error: { code: "llm_malformed_response", details: { recoverable: true, validationCode: "pair_coverage" } },
    });
    expect(completeChatMock).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(malformed)).not.toContain("PRIVATE_RAW_RESPONSE");
  });

  it("classifies upstream then malformed completion by the terminal schema failure without adding repair", async () => {
    process.env.LITELLM_BASE_URL = "http://litellm.test";
    process.env.LITELLM_VISION_MODEL = "vision-model";
    completeChatMock
      .mockRejectedValueOnce(new TypeError("PRIVATE_FIRST_UPSTREAM data:image/png;base64,SECRET"))
      .mockResolvedValueOnce({ content: "{\"pairs\":[],\"raw\":\"PRIVATE_TERMINAL_RESPONSE\"}" });

    const result = await reviewFinalExecution(createExecution(1), createContext(createExecution(1)));

    expect(result).toMatchObject({
      status: "failed",
      error: {
        code: "llm_malformed_response",
        details: { recoverable: true, validationCode: "pair_coverage" },
      },
    });
    expect(completeChatMock).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(completeChatMock.mock.calls[1]?.[0])).not.toContain("Repair the schema");
    expect(JSON.stringify(result)).not.toContain("PRIVATE_FIRST_UPSTREAM");
    expect(JSON.stringify(result)).not.toContain("PRIVATE_TERMINAL_RESPONSE");
    expect(JSON.stringify(result)).not.toContain("data:image");
  });

  it("classifies malformed completion then upstream failure by the terminal upstream attempt after one safe repair", async () => {
    process.env.LITELLM_BASE_URL = "http://litellm.test";
    process.env.LITELLM_VISION_MODEL = "vision-model";
    completeChatMock
      .mockResolvedValueOnce({ content: "{\"pairs\":[],\"raw\":\"PRIVATE_FIRST_RESPONSE\"}" })
      .mockRejectedValueOnce(new LiteLlmError("PRIVATE_TERMINAL_UPSTREAM data:image/png;base64,SECRET", { statusCode: 503 }));

    const result = await reviewFinalExecution(createExecution(1), createContext(createExecution(1)));

    expect(result).toMatchObject({
      status: "failed",
      error: { code: "llm_upstream", details: { recoverable: true, statusCode: 503 } },
    });
    expect(completeChatMock).toHaveBeenCalledTimes(2);
    expect(completeChatMock.mock.calls[1]?.[0]).toMatchObject({
      messages: expect.arrayContaining([expect.objectContaining({
        role: "user",
        content: expect.stringContaining("Safe validation reason"),
      })]),
    });
    expect(JSON.stringify(completeChatMock.mock.calls[1]?.[0])).not.toContain("PRIVATE_FIRST_RESPONSE");
    expect(JSON.stringify(result)).not.toContain("PRIVATE_FIRST_RESPONSE");
    expect(JSON.stringify(result)).not.toContain("PRIVATE_TERMINAL_UPSTREAM");
    expect(JSON.stringify(result)).not.toContain("data:image");
  });

  it("keeps both variants selectable when image preparation fails without calling the provider", async () => {
    process.env.LITELLM_BASE_URL = "http://litellm.test";
    process.env.LITELLM_VISION_MODEL = "vision-model";
    createStoredImageVisionDataUrlMock.mockRejectedValueOnce(new Error("C:\\PRIVATE\\secret.png data:image/png;base64,SECRET"));

    const result = await reviewFinalExecution(createExecution(1), createContext(createExecution(1)));

    expect(result).toMatchObject({
      status: "failed",
      error: { code: "image_storage_failed", details: { recoverable: true } },
      pairs: [{ recommendedVariant: null, defaultVariant: "final" }],
    });
    expect(completeChatMock).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
    expect(JSON.stringify(result)).not.toContain("data:image");
  });

  it("preserves an explicit user selection across review-only retry", async () => {
    process.env.LITELLM_BASE_URL = "http://litellm.test";
    process.env.LITELLM_VISION_MODEL = "vision-model";
    completeChatMock.mockResolvedValue({ content: validResponse(1) });
    const execution = createExecution(1);
    const context = createContext(execution);
    const previousPairs = getCompletedFinalReviewPairs(execution).map((pair) => ({
      ...pair,
      userSelectedVariant: "preview-upscale" as const,
    }));
    context.workflow.nodes["final-review"] = {
      ...context.workflow.nodes["final-review"],
      status: "done",
      source: "ai",
      result: {
        reviewVersion: 1,
        status: "failed",
        pairs: previousPairs,
        error: { code: "llm_upstream", message: "Review unavailable.", details: { recoverable: true } },
      },
    };

    const adapter = createTimelineT8ServerNodeAdapters()["final-review"]!;
    const adapterResult = await adapter(context) as { value: { pairs: TimelineFinalReviewPair[] } };

    expect(adapterResult.value.pairs[0]).toMatchObject({
      candidateId: "preview-1",
      recommendedVariant: "final",
      defaultVariant: "final",
      userSelectedVariant: "preview-upscale",
    });
    expect(completeChatMock).toHaveBeenCalledTimes(1);
  });
});
