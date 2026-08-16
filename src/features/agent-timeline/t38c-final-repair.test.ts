import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

const completeResponseMock = vi.hoisted(() => vi.fn());
const completeChatFallbackMock = vi.hoisted(() => vi.fn());
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
    createLiteLlmClient: vi.fn(() => ({
      completeChat: completeChatFallbackMock,
      completeResponse: completeResponseMock,
    })),
    LiteLlmError,
  };
});

vi.mock("./vision-image-transcode.server", () => ({
  createStoredImageVisionDataUrl: createStoredImageVisionDataUrlMock,
}));

import { createTimelineWorkflowState } from "./state";
import {
  createSkippedFinalRepair,
  deriveRepairAttemptId,
  deriveRepairBaseRequestDigest,
  deriveRepairOutputNodeId,
  deriveRepairRequestDigest,
  getRepairTargets,
  parseRepairVerificationResponse,
  selectRepairVariant,
} from "./final-repair";
import { selectFinalReviewVariant } from "./final-review";
import {
  getSam2RefinementPrompt,
  repairFinalExecution,
  renderValidatedRepairMask,
  validateAndGrowRasterRepairMask,
} from "./final-repair.server";
import { verifyFinalRepairs } from "./repair-verification.server";
import type {
  FinalRepairTimelineResult,
  FinalReviewTimelineResult,
  ComfyUiExecutionTimelineResult,
  TimelineFinalExecutionRecord,
  TimelineFinalReviewPair,
  TimelineNodeExecutionContext,
  TimelineRepairDiagnosis,
  TimelineWorkflowState,
} from "./types";

const originalEnv = { ...process.env };
const reviewUpdatedAt = "2026-07-22T00:00:00.000Z";
let repairAttemptRoot = "";

const stored = (filename: string) => ({
  byteLength: 100,
  contentType: "image/png",
  filename,
  url: `/api/comfyui/generated-images/${filename}`,
});

function reviewPair(): TimelineFinalReviewPair {
  return {
    candidateId: "preview-1",
    rank: 1,
    seed: 7,
    variants: { final: stored("final.png"), previewUpscale: stored("preview.png") },
    scores: {
      final: { adherence: 80, composition: 80, anatomy: 80, style: 80, technical: 80, total: 80 },
      previewUpscale: { adherence: 75, composition: 75, anatomy: 75, style: 75, technical: 75, total: 75 },
    },
    findings: [
      { operation: "pose", severity: "none", scope: "pair", introducedByFinal: false, description: "Stable pose." },
      { operation: "contact", severity: "major", scope: "final", introducedByFinal: true, description: "Hand misses cup." },
      { operation: "object-count", severity: "major", scope: "final", introducedByFinal: true, description: "Duplicate cup." },
      { operation: "composition-consistency", severity: "none", scope: "pair", introducedByFinal: false, description: "Stable framing." },
    ],
    recommendedVariant: "preview-upscale",
    defaultVariant: "preview-upscale",
    visualStyleMatch: {
      final: true,
      previewUpscale: true,
    },
  };
}

function review(): FinalReviewTimelineResult {
  return {
    reviewVersion: 1,
    status: "reviewed",
    pairs: [reviewPair()],
    visualStyle: "anime",
  };
}

function repair(): FinalRepairTimelineResult {
  const reviewed = review();
  const targets = getRepairTargets(reviewed, "preview-1");
  const execution = repairExecution();
  const final = execution.finals[0]!;
  const parent = {
    finalStoredImage: stored("final.png"),
    reviewUpdatedAt,
    reviewedFindings: reviewPair().findings!,
    reviewedTargets: targets,
    visualStyle: "anime" as const,
  };
  const diagnosis = {
    shapes: [{ type: "rect" as const, x: 0.4, y: 0.4, width: 0.1, height: 0.1 }],
    growMaskBy: 2,
  };
  const attemptId = deriveRepairAttemptId(
    "repair-verification",
    "preview-1",
    parent,
    deriveRepairBaseRequestDigest(execution, final)!,
  );
  const outputNodeId = deriveRepairOutputNodeId(execution, final, diagnosis, attemptId)!;
  const requestDigest = deriveRepairRequestDigest(execution, final, diagnosis, attemptId)!;
  const sourceImage = { filename: "repair-output.png", nodeId: outputNodeId, type: "output" };
  const storedImage = stored("repair.png");
  return {
    repairVersion: 1,
    authorized: true,
    completed: true,
    pairs: [{
      candidateId: "preview-1",
      rank: 1,
      seed: 7,
      status: "repaired",
      targets,
      parent,
      diagnosis,
      promptId: "repair-prompt-1",
      sourceImage,
      storedImage,
      attempt: {
        attemptId,
        status: "stored",
        promptId: "repair-prompt-1",
        outputNodeId,
        requestDigest,
        sourceImage,
        storedImage,
      },
    }],
  };
}

function context(nsfw = false): TimelineNodeExecutionContext {
  const base = createTimelineWorkflowState({ workflowId: "repair-verification", sceneRequest: "PRIVATE_INTENT" });
  const workflow: TimelineWorkflowState = {
    ...base,
    nodes: {
      ...base.nodes,
      "scene-input": {
        ...base.nodes["scene-input"],
        result: {
          rawIntent: "PRIVATE_INTENT",
          nsfw,
          settingsSnapshot: { visualStyle: "anime" },
        },
      },
      "final-review": {
        ...base.nodes["final-review"],
        updatedAt: reviewUpdatedAt,
      },
    },
  };
  return {
    nodeId: "repair-verification",
    workflow,
    dependencies: [workflow.nodes["final-repair"]],
  };
}

function repairExecutionContext(authorized: boolean): TimelineNodeExecutionContext {
  const base = context().workflow;
  const workflow: TimelineWorkflowState = {
    ...base,
    nodes: {
      ...base.nodes,
      "generation-gate": {
        ...base.nodes["generation-gate"],
        status: "manual",
        result: { confirmed: true, automaticLocalRepairAuthorized: authorized },
      },
      "final-review": {
        ...base.nodes["final-review"],
        updatedAt: reviewUpdatedAt,
      },
    },
  };
  return { nodeId: "final-repair", workflow, dependencies: [workflow.nodes["final-review"]] };
}

function repairExecution(): ComfyUiExecutionTimelineResult {
  return {
    completed: true,
    finalCount: 1,
    finals: [{
      candidateId: "preview-1", rank: 1, seed: 7, status: "done",
      storedImage: stored("final.png"),
      previewUpscale: {
        policyVersion: 1, resizeMode: "lanczos3-exact", width: 64, height: 64,
        sourcePreview: stored("preview.png"), storedImage: stored("preview.png"),
      },
    }],
    request: { checkpointName: "local.safetensors", positivePrompt: "PRIVATE_PROMPT" },
    warnings: [],
  };
}

function inpaintSemanticDigestFixture(workflowId: string) {
  const execution = repairExecution();
  execution.request = {
    checkpointName: "semantic-model.safetensors",
    checkpointNameAliases: ["semantic-primary.safetensors", "semantic-fallback.safetensors"],
    workflowProfile: "default",
    modelBaseModel: "Illustrious",
    modelStorageKind: "checkpoint",
    clipName: "clip.safetensors",
    clipDevice: "default",
    vaeName: "vae.safetensors",
    unetWeightDtype: "default",
    positivePrompt: "semantic repair prompt",
    negativePrompt: "semantic negative prompt",
    loras: [
      { loraName: "repair-a.safetensors", strengthModel: 0.6, strengthClip: 0.4 },
      { loraName: "repair-b.safetensors", strengthModel: 0.7, strengthClip: 0.5 },
    ],
    seed: 999,
    steps: 28,
    cfg: 6.2,
    samplerName: "euler",
    scheduler: "normal",
    denoise: 0.91,
    sourceImageDataUrl: "data:image/png;base64,QUFBQQ==",
    imageName: "transient-parent-upload-a.png",
    promptWrapper: {
      positivePrefix: "semantic style prefix",
      negativePrefix: "semantic negative prefix",
    },
    outputPrefix: "transient/parent-output-a",
    faceDetailer: {
      enabled: true,
      detectorModelName: "face_yolov8m.pt",
      denoise: 0.31,
      steps: 18,
    },
    handDetailer: {
      enabled: true,
      detectorModelName: "hand_yolov8s.pt",
      denoise: 0.27,
      steps: 16,
    },
  };
  const final = execution.finals[0]!;
  const parent = {
    finalStoredImage: final.storedImage!,
    reviewUpdatedAt,
    reviewedFindings: reviewPair().findings!,
    reviewedTargets: getRepairTargets(review(), final.candidateId),
    visualStyle: "anime" as const,
  };
  const baseRequestDigest = deriveRepairBaseRequestDigest(execution, final)!;
  const attemptId = deriveRepairAttemptId(
    workflowId,
    final.candidateId,
    parent,
    baseRequestDigest,
  );
  const diagnosis: TimelineRepairDiagnosis = {
    shapes: [{ type: "rect", x: 0.4, y: 0.4, width: 0.1, height: 0.1 }],
    denoise: 0.42,
    growMaskBy: 2,
    faceDetailerEnabled: true,
    handDetailerEnabled: false,
  };
  return {
    attemptId,
    diagnosis,
    digest: deriveRepairRequestDigest(execution, final, diagnosis, attemptId)!,
    execution,
    final,
  };
}

function verificationResponse(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({ pairs: [{
    candidateId: "preview-1",
    visualStyleMatch: true,
    scores: {
      final: { adherence: 80, composition: 80, anatomy: 80, style: 80, technical: 80 },
      repair: { adherence: 82, composition: 82, anatomy: 82, style: 82, technical: 82 },
    },
    findings: [
      { operation: "pose", severity: "none", scope: "pair", description: "Stable." },
      { operation: "contact", severity: "none", scope: "pair", description: "Resolved." },
      { operation: "object-count", severity: "minor", scope: "pair", description: "Resolved." },
      { operation: "composition-consistency", severity: "none", scope: "pair", description: "Stable." },
    ],
    rationale: "Localized repair resolved both targets.",
    ...overrides,
  }] });
}

beforeEach(async () => {
  repairAttemptRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sceneforge-t38c-repair-"));
  process.env.SCENEFORGE_REPAIR_ATTEMPTS_DIR = repairAttemptRoot;
});

afterEach(async () => {
  expect(completeChatFallbackMock).not.toHaveBeenCalled();
  completeResponseMock.mockReset();
  completeChatFallbackMock.mockReset();
  createStoredImageVisionDataUrlMock.mockClear();
  process.env = { ...originalEnv };
  await fs.rm(repairAttemptRoot, { force: true, recursive: true });
  repairAttemptRoot = "";
});

describe("T38C one-shot local repair", () => {
  it.each([
    ["positive prompt", (execution: ComfyUiExecutionTimelineResult) => {
      execution.request.positivePrompt = "changed repair prompt";
    }],
    ["negative prompt", (execution: ComfyUiExecutionTimelineResult) => {
      execution.request.negativePrompt = "changed repair negative prompt";
    }],
    ["checkpoint", (execution: ComfyUiExecutionTimelineResult) => {
      execution.request.checkpointName = "changed-repair-model.safetensors";
    }],
    ["model profile", (execution: ComfyUiExecutionTimelineResult) => {
      execution.request.modelBaseModel = "SDXL";
    }],
    ["LoRA weight", (execution: ComfyUiExecutionTimelineResult) => {
      execution.request.loras![0]!.strengthClip = 0.41;
    }],
    ["steps", (execution: ComfyUiExecutionTimelineResult) => {
      execution.request.steps = 29;
    }],
    ["CFG", (execution: ComfyUiExecutionTimelineResult) => {
      execution.request.cfg = 6.3;
    }],
    ["sampler", (execution: ComfyUiExecutionTimelineResult) => {
      execution.request.samplerName = "dpmpp_2m";
    }],
    ["scheduler", (execution: ComfyUiExecutionTimelineResult) => {
      execution.request.scheduler = "karras";
    }],
    ["prompt wrapper", (execution: ComfyUiExecutionTimelineResult) => {
      execution.request.promptWrapper = {
        ...execution.request.promptWrapper,
        positivePrefix: "changed repair style prefix",
      };
    }],
    ["Face Detailer", (execution: ComfyUiExecutionTimelineResult) => {
      execution.request.faceDetailer = {
        ...execution.request.faceDetailer,
        steps: 19,
      };
    }],
    ["Hand Detailer", (execution: ComfyUiExecutionTimelineResult) => {
      execution.request.handDetailer = {
        ...execution.request.handDetailer,
        denoise: 0.28,
      };
    }],
    ["formal seed", (_execution: ComfyUiExecutionTimelineResult, final: TimelineFinalExecutionRecord) => {
      final.seed += 1;
    }],
    ["formal dimensions", (_execution: ComfyUiExecutionTimelineResult, final: TimelineFinalExecutionRecord) => {
      final.previewUpscale = { ...final.previewUpscale!, height: 72 };
    }],
    ["diagnosis denoise", (
      _execution: ComfyUiExecutionTimelineResult,
      _final: TimelineFinalExecutionRecord,
      diagnosis: TimelineRepairDiagnosis,
    ) => {
      diagnosis.denoise = 0.43;
    }],
    ["diagnosis detailer override", (
      _execution: ComfyUiExecutionTimelineResult,
      _final: TimelineFinalExecutionRecord,
      diagnosis: TimelineRepairDiagnosis,
    ) => {
      diagnosis.handDetailerEnabled = true;
    }],
  ] as const)(
    "changes the final Repair request digest when material %s inpaint semantics change",
    (_name, mutate) => {
      const fixture = inpaintSemanticDigestFixture(`inpaint-semantic-${_name.replaceAll(" ", "-")}`);
      const changedExecution = structuredClone(fixture.execution);
      const changedFinal = structuredClone(fixture.final);
      const changedDiagnosis = structuredClone(fixture.diagnosis);
      mutate(changedExecution, changedFinal, changedDiagnosis);

      expect(deriveRepairRequestDigest(
        changedExecution,
        changedFinal,
        changedDiagnosis,
        fixture.attemptId,
      )).not.toBe(fixture.digest);
    },
  );

  it.each([
    ["checkpoint alias", (execution: ComfyUiExecutionTimelineResult) =>
      execution.request.checkpointNameAliases!.reverse()],
    ["LoRA", (execution: ComfyUiExecutionTimelineResult) => execution.request.loras!.reverse()],
  ] as const)("keeps ordered final Repair %s arrays order-sensitive", (_name, reorder) => {
    const fixture = inpaintSemanticDigestFixture(`inpaint-order-${_name.replaceAll(" ", "-")}`);
    const changedExecution = structuredClone(fixture.execution);
    reorder(changedExecution);

    expect(deriveRepairRequestDigest(
      changedExecution,
      fixture.final,
      fixture.diagnosis,
      fixture.attemptId,
    )).not.toBe(fixture.digest);
  });

  it("excludes generated names, data payloads, and output prefixes from the final Repair request digest", () => {
    const fixture = inpaintSemanticDigestFixture("inpaint-transient-fields");
    const changedExecution = structuredClone(fixture.execution);
    changedExecution.request.outputPrefix = "transient/parent-output-b";
    changedExecution.request.imageName = "transient-parent-upload-b.png";
    changedExecution.request.sourceImageDataUrl = "data:image/png;base64,QkJCQg==";

    expect(deriveRepairRequestDigest(
      changedExecution,
      fixture.final,
      fixture.diagnosis,
      fixture.attemptId,
    )).toBe(fixture.digest);
  });

  it("combines only localized Final contact and object-count findings", () => {
    expect(getRepairTargets(review(), "preview-1")).toEqual([
      { operation: "contact", severity: "major", description: "Hand misses cup." },
      { operation: "object-count", severity: "major", description: "Duplicate cup." },
    ]);
    const unsupported = review();
    unsupported.pairs[0]!.findings![1] = {
      operation: "contact",
      severity: "blocking",
      scope: "pair",
      introducedByFinal: false,
      description: "Ambiguous across both variants.",
    };
    expect(getRepairTargets(unsupported, "preview-1")).toHaveLength(1);
  });

  it("completes disabled repair as an auditable skip", () => {
    expect(createSkippedFinalRepair(review(), false)).toMatchObject({
      authorized: false,
      completed: true,
      pairs: [{ status: "skipped", skipReason: "repair-disabled" }],
    });
  });

  it("performs no diagnosis or ComfyUI work without server-authorized repair", async () => {
    const result = await repairFinalExecution(repairExecution(), review(), repairExecutionContext(false));

    expect(result).toMatchObject({
      authorized: false,
      completed: true,
      pairs: [{ status: "skipped", skipReason: "repair-disabled" }],
    });
    expect(completeResponseMock).not.toHaveBeenCalled();
    expect(createStoredImageVisionDataUrlMock).not.toHaveBeenCalled();
  });

  it("reuses an existing successful Repair and cannot generate a second candidate", async () => {
    const previous = repair();
    const result = await repairFinalExecution(
      repairExecution(),
      review(),
      repairExecutionContext(true),
      previous,
    );

    expect(result.pairs[0]).toBe(previous.pairs[0]);
    expect(result.pairs).toHaveLength(1);
    expect(completeResponseMock).not.toHaveBeenCalled();
    expect(createStoredImageVisionDataUrlMock).not.toHaveBeenCalled();
  });

  it.each(["rank", "seed"] as const)("does not reuse a successful Repair when its parent %s changed", async (field) => {
    const previous = repair();
    previous.pairs[0] = {
      ...previous.pairs[0]!,
      [field]: previous.pairs[0]![field] + 1,
    };

    const result = await repairFinalExecution(
      repairExecution(),
      review(),
      repairExecutionContext(true),
      previous,
    );

    expect(result.pairs[0]).toMatchObject({ status: "skipped", skipReason: "parent-mismatch" });
    expect(completeResponseMock).not.toHaveBeenCalled();
    expect(createStoredImageVisionDataUrlMock).not.toHaveBeenCalled();
  });

  it("measures actual raster coverage before and after bounded growth", async () => {
    const result = await renderValidatedRepairMask([
      { type: "rect", x: 0.45, y: 0.45, width: 0.1, height: 0.1 },
    ], 128, 128, 4);
    expect(result.growMaskBy).toBe(4);
    expect(result.coverageBeforeGrowth).toBeGreaterThan(0);
    expect(result.coverageAfterGrowth).toBeGreaterThanOrEqual(result.coverageBeforeGrowth);
    expect(result.coverageAfterGrowth).toBeLessThanOrEqual(0.35);
    await expect(renderValidatedRepairMask([
      { type: "rect", x: 0, y: 0, width: 0.8, height: 0.8 },
    ], 128, 128, 0)).rejects.toThrow("mask-oversized");

    await expect(renderValidatedRepairMask([], 128, 128, 0)).rejects.toThrow("mask-empty");
    const clamped = await renderValidatedRepairMask([
      { type: "rect", x: 0.48, y: 0.48, width: 0.04, height: 0.04 },
    ], 256, 256, 999);
    expect(clamped.growMaskBy).toBe(64);
  });

  it("fails closed when bounded growth makes a previously valid mask too broad", async () => {
    await expect(renderValidatedRepairMask([
      { type: "rect", x: 0.3, y: 0.3, width: 0.4, height: 0.4 },
    ], 128, 128, 64)).rejects.toThrow("mask-growth-oversized");
  });

  it("derives one bounded SAM2 point/box prompt only from a clear diagnosis shape", () => {
    expect(getSam2RefinementPrompt([
      { type: "rect", x: 0.25, y: 0.5, width: 0.25, height: 0.25 },
    ], 200, 100)).toEqual({ bbox: { x: 50, y: 50, width: 50, height: 25 } });
    expect(getSam2RefinementPrompt([
      { type: "ellipse", x: 0.5, y: 0.5, radiusX: 0.1, radiusY: 0.2 },
    ], 200, 100)).toEqual({
      positivePoints: [{ x: 100, y: 50 }],
      bbox: { x: 80, y: 30, width: 40, height: 40 },
    });
    expect(getSam2RefinementPrompt([
      { type: "rect", x: 0.25, y: 0.25, width: 0.25, height: 0.25, rotation: 20 },
    ], 200, 100)).toBeNull();
    expect(getSam2RefinementPrompt([
      { type: "polygon", points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.1 }, { x: 0.2, y: 0.2 }] },
    ], 200, 100)).toBeNull();
  });

  it("rejects invalid SAM2 raster dimensions and broad SAM2 output", async () => {
    const wrongDimensions = await sharp({
      create: { width: 64, height: 64, channels: 4, background: "#ffffff" },
    }).png().toBuffer();
    await expect(validateAndGrowRasterRepairMask(wrongDimensions, 128, 128, 0)).rejects.toThrow("mask-dimensions-invalid");

    const broadMask = await sharp({
      create: { width: 128, height: 128, channels: 4, background: "#ffffff" },
    }).png().toBuffer();
    await expect(validateAndGrowRasterRepairMask(broadMask, 128, 128, 0)).rejects.toThrow("mask-oversized");
  });

  it("ignores model recommendations and derives no-regression recommendation locally", () => {
    const response = JSON.stringify({ pairs: [{
      candidateId: "preview-1",
      recommendation: "always-repair",
      scores: {
        final: { adherence: 80, composition: 80, anatomy: 80, style: 80, technical: 80 },
        repair: { adherence: 82, composition: 82, anatomy: 82, style: 82, technical: 82 },
      },
      findings: [
        { operation: "pose", severity: "none", scope: "pair", description: "Stable." },
        { operation: "contact", severity: "none", scope: "pair", description: "Resolved." },
        { operation: "object-count", severity: "minor", scope: "pair", description: "Resolved." },
        { operation: "composition-consistency", severity: "none", scope: "pair", description: "Stable." },
      ],
    }] });
    expect(parseRepairVerificationResponse(response, repair(), review())?.pairs[0]).toMatchObject({
      targetedDefectsResolved: true,
      newMajorOrBlockingIssue: false,
      recommended: true,
    });
  });

  it.each([
    ["score regression", {
      scores: {
        final: { adherence: 80, composition: 80, anatomy: 80, style: 80, technical: 80 },
        repair: { adherence: 79, composition: 79, anatomy: 79, style: 79, technical: 79 },
      },
    }],
    ["new major defect", {
      findings: [
        { operation: "pose", severity: "major", scope: "pair", description: "New pose regression." },
        { operation: "contact", severity: "none", scope: "pair", description: "Resolved." },
        { operation: "object-count", severity: "none", scope: "pair", description: "Resolved." },
        { operation: "composition-consistency", severity: "none", scope: "pair", description: "Stable." },
      ],
    }],
    ["unresolved target", {
      findings: [
        { operation: "pose", severity: "none", scope: "pair", description: "Stable." },
        { operation: "contact", severity: "major", scope: "pair", description: "Still broken." },
        { operation: "object-count", severity: "none", scope: "pair", description: "Resolved." },
        { operation: "composition-consistency", severity: "none", scope: "pair", description: "Stable." },
      ],
    }],
  ])("does not recommend Repair for %s", (_case, override) => {
    expect(parseRepairVerificationResponse(verificationResponse(override), repair(), review())?.pairs[0]?.recommended).toBe(false);
  });

  it("compares Repair against the parent Final score from the same verification response", () => {
    const response = verificationResponse({
      scores: {
        final: { adherence: 90, composition: 90, anatomy: 90, style: 90, technical: 90 },
        repair: { adherence: 85, composition: 85, anatomy: 85, style: 85, technical: 85 },
      },
    });

    expect(parseRepairVerificationResponse(response, repair(), review())?.pairs[0]).toMatchObject({
      scores: { final: { total: 90 }, repair: { total: 85 } },
      recommended: false,
    });
  });

  it.each(["rank", "seed"] as const)("rejects verification when the Repair parent %s no longer matches review", (field) => {
    const changedRepair = repair();
    changedRepair.pairs[0] = {
      ...changedRepair.pairs[0]!,
      [field]: changedRepair.pairs[0]![field] + 1,
    };

    expect(parseRepairVerificationResponse(verificationResponse(), changedRepair, review())).toBeNull();
  });

  it.each([
    ["missing pair", { pairs: [] }],
    ["unknown pair", { pairs: [{ ...JSON.parse(verificationResponse()).pairs[0], candidateId: "preview-9" }] }],
    ["duplicate finding", { pairs: [{ ...JSON.parse(verificationResponse()).pairs[0], findings: [
      { operation: "pose", severity: "none", scope: "pair" },
      { operation: "pose", severity: "none", scope: "pair" },
      { operation: "object-count", severity: "none", scope: "pair" },
      { operation: "composition-consistency", severity: "none", scope: "pair" },
    ] }] }],
    ["unknown severity", { pairs: [{ ...JSON.parse(verificationResponse()).pairs[0], findings: [
      { operation: "pose", severity: "critical", scope: "pair" },
      { operation: "contact", severity: "none", scope: "pair" },
      { operation: "object-count", severity: "none", scope: "pair" },
      { operation: "composition-consistency", severity: "none", scope: "pair" },
    ] }] }],
  ])("rejects malformed verification schema: %s", (_case, response) => {
    expect(parseRepairVerificationResponse(JSON.stringify(response), repair(), review())).toBeNull();
  });

  it("requires verified explicit selection before promoting Repair", () => {
    const workflow = createTimelineWorkflowState({ workflowId: "repair-selection" });
    const repairResult = repair();
    workflow.nodes["final-review"] = { ...workflow.nodes["final-review"], status: "done", updatedAt: reviewUpdatedAt, result: review() };
    workflow.nodes["final-repair"] = { ...workflow.nodes["final-repair"], status: "done", result: repairResult };
    expect(selectRepairVariant(workflow, "preview-1", "repair")).toBe(workflow);
    workflow.nodes["repair-verification"] = {
      ...workflow.nodes["repair-verification"],
      status: "done",
      result: { verificationVersion: 1, status: "verified", visualStyle: "anime", pairs: [{
        candidateId: "preview-1",
        repairParent: repairResult.pairs[0]!.parent!,
        repairStoredImage: repairResult.pairs[0]!.storedImage!,
        scores: { final: reviewPair().scores!.final, repair: reviewPair().scores!.final },
        targetedDefectsResolved: true,
        newMajorOrBlockingIssue: false,
        findings: reviewPair().findings!,
        recommended: true,
        visualStyleMatch: true,
      }] },
    };
    const selected = selectRepairVariant(workflow, "preview-1", "repair", "2026-07-22T00:00:00.000Z");
    expect((selected.nodes["final-review"].result as FinalReviewTimelineResult).pairs[0]!.userSelectedVariant).toBe("repair");
    expect(selected.nodes["final-repair"].result).toBe(workflow.nodes["final-repair"].result);
    expect(selected.nodes["repair-verification"].result).toBe(workflow.nodes["repair-verification"].result);
    expect(selected.nodes["comfyui-execution"].result).toBe(workflow.nodes["comfyui-execution"].result);
    expect(selected.nodes["final-repair"].status).toBe("done");
    expect(selected.nodes["repair-verification"].status).toBe("done");
  });

  it.each(["final", "preview-upscale", "repair"] as const)(
    "rejects forged prior-style %s selection retained after a style change",
    (variant) => {
      const workflow = createTimelineWorkflowState({
        workflowId: `prior-style-${variant}`,
        sceneRequest: "A retained prior-style result",
        settingsSnapshot: { visualStyle: "photoreal" },
      });
      const repairResult = repair();
      workflow.nodes["final-review"] = {
        ...workflow.nodes["final-review"],
        status: "done",
        updatedAt: reviewUpdatedAt,
        result: review(),
      };
      workflow.nodes["final-repair"] = {
        ...workflow.nodes["final-repair"],
        status: "done",
        result: repairResult,
      };
      workflow.nodes["repair-verification"] = {
        ...workflow.nodes["repair-verification"],
        status: "done",
        result: {
          verificationVersion: 1,
          status: "verified",
          visualStyle: "anime",
          pairs: [{
            candidateId: "preview-1",
            repairParent: repairResult.pairs[0]!.parent!,
            repairStoredImage: repairResult.pairs[0]!.storedImage!,
            scores: { final: reviewPair().scores!.final, repair: reviewPair().scores!.final },
            targetedDefectsResolved: true,
            newMajorOrBlockingIssue: false,
            findings: reviewPair().findings!,
            recommended: true,
            visualStyleMatch: true,
          }],
        },
      };

      expect(selectRepairVariant(workflow, "preview-1", variant)).toBe(workflow);
      expect((workflow.nodes["final-review"].result as FinalReviewTimelineResult).pairs[0])
        .not.toHaveProperty("userSelectedVariant");
    },
  );

  it("refuses Repair promotion when its top-level source differs from the attempt source", () => {
    const workflow = createTimelineWorkflowState({ workflowId: "repair-selection-source-mismatch" });
    const repairResult = repair();
    repairResult.pairs[0] = {
      ...repairResult.pairs[0]!,
      sourceImage: {
        ...repairResult.pairs[0]!.sourceImage!,
        filename: "different-repair-output.png",
      },
    };
    workflow.nodes["final-review"] = {
      ...workflow.nodes["final-review"],
      status: "done",
      updatedAt: reviewUpdatedAt,
      result: review(),
    };
    workflow.nodes["final-repair"] = {
      ...workflow.nodes["final-repair"],
      status: "done",
      result: repairResult,
    };
    workflow.nodes["repair-verification"] = {
      ...workflow.nodes["repair-verification"],
      status: "done",
      result: {
        verificationVersion: 1,
        status: "verified",
        pairs: [{
          candidateId: "preview-1",
          repairParent: repairResult.pairs[0]!.parent!,
          repairStoredImage: repairResult.pairs[0]!.storedImage!,
          scores: { final: reviewPair().scores!.final, repair: reviewPair().scores!.final },
          targetedDefectsResolved: true,
          newMajorOrBlockingIssue: false,
          findings: reviewPair().findings!,
          recommended: true,
        }],
      },
    };

    expect(selectRepairVariant(workflow, "preview-1", "repair")).toBe(workflow);
    expect((workflow.nodes["final-review"].result as FinalReviewTimelineResult).pairs[0]!.userSelectedVariant)
      .toBeUndefined();
  });

  it("keeps Repair unreachable through the generic Final-review selector", () => {
    const workflow = createTimelineWorkflowState({ workflowId: "repair-selection-generic-guard" });
    const reviewResult = review();
    workflow.nodes["final-review"] = {
      ...workflow.nodes["final-review"],
      status: "done",
      updatedAt: reviewUpdatedAt,
      result: reviewResult,
    };
    const invokeWithUntrustedVariant = selectFinalReviewVariant as unknown as (
      state: TimelineWorkflowState,
      candidateId: string,
      variant: string,
    ) => TimelineWorkflowState;

    const selected = invokeWithUntrustedVariant(workflow, "preview-1", "repair");

    expect(selected).toBe(workflow);
    expect((selected.nodes["final-review"].result as FinalReviewTimelineResult).pairs[0]!.userSelectedVariant)
      .toBeUndefined();
  });

  it.each(["rank", "seed"] as const)("refuses Repair promotion when its parent %s no longer matches review", (field) => {
    const workflow = createTimelineWorkflowState({ workflowId: "repair-selection-mismatch" });
    const repairResult = repair();
    repairResult.pairs[0] = {
      ...repairResult.pairs[0]!,
      [field]: repairResult.pairs[0]![field] + 1,
    };
    workflow.nodes["final-review"] = {
      ...workflow.nodes["final-review"],
      status: "done",
      updatedAt: reviewUpdatedAt,
      result: review(),
    };
    workflow.nodes["final-repair"] = { ...workflow.nodes["final-repair"], status: "done", result: repairResult };
    workflow.nodes["repair-verification"] = {
      ...workflow.nodes["repair-verification"],
      status: "done",
      result: {
        verificationVersion: 1,
        status: "verified",
        pairs: [{
          candidateId: "preview-1",
          repairParent: repairResult.pairs[0]!.parent!,
          repairStoredImage: repairResult.pairs[0]!.storedImage!,
          scores: { final: reviewPair().scores!.final, repair: reviewPair().scores!.final },
          targetedDefectsResolved: true,
          newMajorOrBlockingIssue: false,
          findings: reviewPair().findings!,
          recommended: true,
        }],
      },
    };

    expect(selectRepairVariant(workflow, "preview-1", "repair")).toBe(workflow);
  });
});

describe("T38C Repair verification provider boundary", () => {
  it("skips verification before provider or image work when top-level Repair provenance is inconsistent", async () => {
    process.env.LITELLM_BASE_URL = "http://litellm.test";
    process.env.LITELLM_VISION_MODEL = "vision-model";
    const inconsistent = repair();
    inconsistent.pairs[0] = {
      ...inconsistent.pairs[0]!,
      sourceImage: {
        ...inconsistent.pairs[0]!.sourceImage!,
        filename: "different-repair-output.png",
      },
    };

    await expect(verifyFinalRepairs(inconsistent, review(), context())).resolves.toMatchObject({
      verificationVersion: 1,
      status: "skipped",
      pairs: [],
    });
    expect(completeResponseMock).not.toHaveBeenCalled();
    expect(createStoredImageVisionDataUrlMock).not.toHaveBeenCalled();
  });

  it("skips without provider or image work when repair is disabled or has no successful candidate", async () => {
    const disabled = { ...repair(), authorized: false };
    await expect(verifyFinalRepairs(disabled, review(), context())).resolves.toMatchObject({ status: "skipped", pairs: [] });
    await expect(verifyFinalRepairs({
      ...repair(),
      pairs: [{ ...repair().pairs[0]!, status: "skipped", storedImage: undefined, skipReason: "no-supported-finding" }],
    }, review(), context())).resolves.toMatchObject({ status: "skipped", pairs: [] });
    expect(completeResponseMock).not.toHaveBeenCalled();
    expect(createStoredImageVisionDataUrlMock).not.toHaveBeenCalled();
  });

  it("verifies every Preview/Final/Repair triple in one bounded high-detail request", async () => {
    process.env.LITELLM_BASE_URL = "http://litellm.test";
    process.env.LITELLM_VISION_MODEL = "vision-model";
    completeResponseMock.mockResolvedValue({ content: verificationResponse() });

    const result = await verifyFinalRepairs(repair(), review(), context());

    expect(result).toMatchObject({ status: "verified", pairs: [{ candidateId: "preview-1", recommended: true }] });
    expect(completeResponseMock).toHaveBeenCalledTimes(1);
    const request = completeResponseMock.mock.calls[0]?.[0] as {
      model: string;
      purpose: string;
      nsfw: boolean;
      temperature: number;
      maxTokens: number;
      messages: Array<{ content: Array<{ type: string; image_url?: { detail: string; url: string } }> }>;
    };
    expect(request).toMatchObject({
      model: "vision-model",
      purpose: "single-image-repair-verification",
      nsfw: false,
      temperature: 0,
      maxTokens: 4_000,
    });
    const images = request.messages[0]!.content.filter((item) => item.type === "image_url");
    expect(images).toHaveLength(3);
    expect(images.every((item) => item.image_url?.detail === "high")).toBe(true);
    expect(request.messages[0]!.content.slice(1)).toEqual([
      { type: "text", text: "Pair preview-1; targets: contact, object-count - Preview" },
      {
        type: "image_url",
        image_url: { url: "data:image/jpeg;base64,TRANSIENT_preview-1:preview-upscale", detail: "high" },
      },
      { type: "text", text: "Pair preview-1 - Final" },
      {
        type: "image_url",
        image_url: { url: "data:image/jpeg;base64,TRANSIENT_preview-1:final", detail: "high" },
      },
      { type: "text", text: "Pair preview-1 - Repair" },
      {
        type: "image_url",
        image_url: { url: "data:image/jpeg;base64,TRANSIENT_preview-1:repair", detail: "high" },
      },
    ]);
    expect(createStoredImageVisionDataUrlMock).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(result)).not.toContain("data:image");
    expect(JSON.stringify(result)).not.toContain("PRIVATE_");
  });

  it("keeps a style-mismatched Repair unverified and unavailable for promotion", async () => {
    process.env.LITELLM_BASE_URL = "http://litellm.test";
    process.env.LITELLM_VISION_MODEL = "vision-model";
    completeResponseMock.mockResolvedValue({
      content: verificationResponse({ visualStyleMatch: false }),
    });

    const result = await verifyFinalRepairs(repair(), review(), context());

    expect(result).toMatchObject({
      status: "verified",
      visualStyle: "anime",
      pairs: [{
        candidateId: "preview-1",
        visualStyleMatch: false,
        recommended: false,
      }],
    });
    expect(completeResponseMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed after bounded repair when Repair style verification is missing", async () => {
    process.env.LITELLM_BASE_URL = "http://litellm.test";
    process.env.LITELLM_VISION_MODEL = "vision-model";
    completeResponseMock.mockResolvedValue({
      content: verificationResponse({ visualStyleMatch: undefined }),
    });

    const result = await verifyFinalRepairs(repair(), review(), context());

    expect(result).toMatchObject({
      status: "failed",
      visualStyle: "anime",
      error: {
        code: "llm_malformed_response",
        details: {
          recoverable: true,
        },
      },
    });
    expect(completeResponseMock).toHaveBeenCalledTimes(2);
  });

  it("uses one safe schema repair, redacts raw completions, and never makes a third call", async () => {
    process.env.LITELLM_BASE_URL = "http://litellm.test";
    process.env.LITELLM_VISION_MODEL = "vision-model";
    completeResponseMock.mockResolvedValue({ content: "{\"pairs\":[],\"raw\":\"PRIVATE_RAW_RESPONSE\"}" });

    const result = await verifyFinalRepairs(repair(), review(), context());

    expect(result).toMatchObject({ status: "failed", error: { code: "llm_malformed_response", details: { recoverable: true } } });
    expect(completeResponseMock).toHaveBeenCalledTimes(2);
    const repairedRequest = JSON.stringify(completeResponseMock.mock.calls[1]?.[0]);
    expect(repairedRequest).toContain("Repair the schema only");
    expect(repairedRequest).not.toContain("PRIVATE_RAW_RESPONSE");
    expect(JSON.stringify(result)).not.toContain("PRIVATE_RAW_RESPONSE");
  });

  it("clears an in-memory Repair selection when verification exhausts its retry", async () => {
    process.env.LITELLM_BASE_URL = "http://litellm.test";
    process.env.LITELLM_VISION_MODEL = "vision-model";
    completeResponseMock.mockResolvedValue({ content: "{\"pairs\":[]}" });
    const verificationContext = context();
    verificationContext.workflow.nodes["final-review"].result = {
      ...review(),
      pairs: [{ ...reviewPair(), userSelectedVariant: "repair" }],
    };

    await expect(verifyFinalRepairs(repair(), review(), verificationContext)).resolves.toMatchObject({ status: "failed" });

    expect(completeResponseMock).toHaveBeenCalledTimes(2);
    expect((verificationContext.workflow.nodes["final-review"].result as FinalReviewTimelineResult).pairs[0])
      .toMatchObject({ userSelectedVariant: "preview-upscale" });
  });

  it("retries an upstream failure with the same request instead of inventing a schema-repair instruction", async () => {
    process.env.LITELLM_BASE_URL = "http://litellm.test";
    process.env.LITELLM_VISION_MODEL = "vision-model";
    completeResponseMock
      .mockRejectedValueOnce(new TypeError("PRIVATE_NETWORK_FAILURE"))
      .mockResolvedValueOnce({ content: verificationResponse() });

    await expect(verifyFinalRepairs(repair(), review(), context())).resolves.toMatchObject({ status: "verified" });
    expect(completeResponseMock).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(completeResponseMock.mock.calls[1]?.[0])).not.toContain("Repair the schema only");
    expect(JSON.stringify(completeResponseMock.mock.calls[1]?.[0])).not.toContain("PRIVATE_NETWORK_FAILURE");
  });

  it("requires the NSFW model and never falls back to ordinary routing", async () => {
    process.env.LITELLM_BASE_URL = "http://litellm.test";
    process.env.LITELLM_VISION_MODEL = "ordinary-vision";
    process.env.LITELLM_DEFAULT_MODEL = "ordinary-default";

    await expect(verifyFinalRepairs(repair(), review(), context(true))).resolves.toMatchObject({
      status: "failed",
      error: {
        code: "llm_config",
        message: "A multimodal LITELLM_NSFW_MODEL is required to verify NSFW repairs. Preview and Final remain selectable.",
        details: { recoverable: true },
      },
    });
    expect(completeResponseMock).not.toHaveBeenCalled();

    process.env.LITELLM_NSFW_MODEL = "nsfw-vision";
    completeResponseMock.mockResolvedValue({ content: verificationResponse() });
    await verifyFinalRepairs(repair(), review(), context(true));
    expect(completeResponseMock).toHaveBeenLastCalledWith(expect.objectContaining({ model: "nsfw-vision", nsfw: true }));
  });

  it("redacts image-preparation and upstream failures", async () => {
    process.env.LITELLM_BASE_URL = "http://litellm.test";
    process.env.LITELLM_VISION_MODEL = "vision-model";
    createStoredImageVisionDataUrlMock.mockRejectedValueOnce(new Error("C:\\PRIVATE\\secret.png data:image/png;base64,SECRET"));

    const imageFailure = await verifyFinalRepairs(repair(), review(), context());
    expect(imageFailure).toMatchObject({ status: "failed", error: { code: "image_storage_failed" } });
    expect(JSON.stringify(imageFailure)).not.toContain("PRIVATE");
    expect(JSON.stringify(imageFailure)).not.toContain("data:image");
    expect(completeResponseMock).not.toHaveBeenCalled();

    createStoredImageVisionDataUrlMock.mockImplementation(async (_stored, itemId: string) =>
      `data:image/jpeg;base64,TRANSIENT_${itemId}`);
    completeResponseMock.mockRejectedValue(new Error("PRIVATE_UPSTREAM data:image/png;base64,SECRET"));
    const upstream = await verifyFinalRepairs(repair(), review(), context());
    expect(upstream).toMatchObject({ status: "failed", error: { code: "llm_upstream" } });
    expect(completeResponseMock).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(upstream)).not.toContain("PRIVATE_UPSTREAM");
    expect(JSON.stringify(upstream)).not.toContain("data:image");
  });
});
