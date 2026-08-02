// @vitest-environment node

import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildBasicInpaintWorkflow: vi.fn((request: unknown) => {
    void request;
    return {
      workflow: { "9": { class_type: "SaveImage", inputs: {} } },
      outputNodeId: "9",
    };
  }),
  buildSam2MaskWorkflow: vi.fn(),
  completeChat: vi.fn(),
  getHistory: vi.fn(),
  getObjectInfo: vi.fn(),
  paths: new Map<string, string>(),
  queuePrompt: vi.fn(),
  storeGeneratedImage: vi.fn(),
  uploadImage: vi.fn(),
  validateComfyUiInpaintRequest: vi.fn(),
  validateComfyUiInpaintRequestAgainstObjectInfo: vi.fn(),
  validateSam2MaskRequest: vi.fn(),
  validateSam2MaskRequestAgainstObjectInfo: vi.fn(),
}));

vi.mock("@/features/llm", () => ({
  createLiteLlmClient: vi.fn(() => ({ completeChat: mocks.completeChat })),
}));

vi.mock("@/features/comfyui", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/features/comfyui")>(),
  buildBasicInpaintWorkflow: mocks.buildBasicInpaintWorkflow,
  buildSam2MaskWorkflow: mocks.buildSam2MaskWorkflow,
  createComfyUiClient: vi.fn(() => ({
    buildViewUrl: () => "http://comfy.test/view/repair.png",
    getHistory: mocks.getHistory,
    getObjectInfo: mocks.getObjectInfo,
    queuePrompt: mocks.queuePrompt,
    uploadImage: mocks.uploadImage,
  })),
  extractComfyUiHistoryImages: vi.fn((_history: unknown, promptId: string) => [{
    filename: `${promptId}.png`, nodeId: "9", type: "output",
  }]),
  isComfyUiPromptHistoryComplete: vi.fn(() => true),
  validateComfyUiInpaintRequest: mocks.validateComfyUiInpaintRequest,
  validateComfyUiInpaintRequestAgainstObjectInfo: mocks.validateComfyUiInpaintRequestAgainstObjectInfo,
  validateComfyUiSam2MaskRequest: mocks.validateSam2MaskRequest,
  validateComfyUiSam2MaskRequestAgainstObjectInfo: mocks.validateSam2MaskRequestAgainstObjectInfo,
}));

vi.mock("@/features/comfyui/generated-image-storage", () => ({
  getGeneratedImagePath: vi.fn((filename: string) => mocks.paths.get(filename) ?? null),
  storeGeneratedImage: mocks.storeGeneratedImage,
}));

vi.mock("./vision-image-transcode.server", () => ({
  createStoredImageVisionDataUrl: vi.fn(async () => "data:image/jpeg;base64,TRANSIENT"),
}));

import { repairFinalExecution } from "./final-repair.server";
import {
  deriveRepairAttemptId,
  deriveRepairBaseRequestDigest,
  deriveRepairRequestDigest,
} from "./final-repair";
import { createTimelineWorkflowState } from "./state";
import type {
  ComfyUiExecutionTimelineResult,
  FinalRepairTimelineResult,
  FinalReviewTimelineResult,
  TimelineFinalExecutionRecord,
  TimelineNodeExecutionContext,
  TimelineRepairAttempt,
  TimelineStoredGeneratedImage,
} from "./types";

let temporaryRoot = "";
let repairPng: Buffer<ArrayBufferLike> = Buffer.alloc(0);
let storedCounter = 0;
let failRepairStorageOnQueueNumber: number | null = null;
let repairStorageFailureMessage: string | null = null;
const unsafeUpstreamText =
  "C:\\Users\\PRIVATE\\repair.png /var/private/repair.png data:image/png;base64,PRIVATE_IMAGE PRIVATE_PROMPT sk-secret-value";

function managed(filename: string, bytes: Buffer): TimelineStoredGeneratedImage {
  return { byteLength: bytes.byteLength, contentType: "image/png", filename, url: `/api/comfyui/generated-images/${filename}` };
}

function checkpointAttemptStatus(data: unknown) {
  if (typeof data !== "string") return null;
  try {
    const parsed = JSON.parse(data) as { attempt?: { status?: unknown } };
    return typeof parsed.attempt?.status === "string" ? parsed.attempt.status : null;
  } catch {
    return null;
  }
}

function reverseObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .reverse()
      .map(([key, entry]) => [key, reverseObjectKeys(entry)]),
  );
}

async function candidate(candidateId: string, rank: number) {
  const finalBytes = await sharp({ create: { width: 64, height: 64, channels: 4, background: "#777777" } }).png().toBuffer();
  const previewBytes = await sharp({ create: { width: 64, height: 64, channels: 4, background: "#555555" } }).png().toBuffer();
  const finalName = `${createHash("sha256").update(`${candidateId}:final`).digest("hex").slice(0, 32)}.png`;
  const previewName = `${createHash("sha256").update(`${candidateId}:preview`).digest("hex").slice(0, 32)}.png`;
  const finalPath = path.join(temporaryRoot, finalName);
  const previewPath = path.join(temporaryRoot, previewName);
  await fs.writeFile(finalPath, finalBytes);
  await fs.writeFile(previewPath, previewBytes);
  mocks.paths.set(finalName, finalPath);
  mocks.paths.set(previewName, previewPath);
  return {
    final: {
      candidateId,
      rank,
      seed: rank * 10,
      status: "done" as const,
      storedImage: managed(finalName, finalBytes),
      previewUpscale: {
        policyVersion: 1,
        resizeMode: "lanczos3-exact" as const,
        width: 64,
        height: 64,
        sourcePreview: managed(previewName, previewBytes),
        storedImage: managed(previewName, previewBytes),
      },
    },
    review: {
      candidateId,
      rank,
      seed: rank * 10,
      variants: { final: managed(finalName, finalBytes), previewUpscale: managed(previewName, previewBytes) },
      findings: [
        { operation: "pose" as const, severity: "none" as const, scope: "pair" as const, introducedByFinal: false, description: "Stable." },
        { operation: "contact" as const, severity: "major" as const, scope: "final" as const, introducedByFinal: true, description: "Hand misses cup." },
        { operation: "object-count" as const, severity: "none" as const, scope: "pair" as const, introducedByFinal: false, description: "Stable." },
        { operation: "composition-consistency" as const, severity: "none" as const, scope: "pair" as const, introducedByFinal: false, description: "Stable." },
      ],
      recommendedVariant: "preview-upscale" as const,
      defaultVariant: "preview-upscale" as const,
    },
  };
}

function context(workflowId: string): TimelineNodeExecutionContext {
  const workflow = createTimelineWorkflowState({ workflowId });
  workflow.nodes["generation-gate"] = {
    ...workflow.nodes["generation-gate"], status: "manual",
    result: { confirmed: true, automaticLocalRepairAuthorized: true },
  };
  workflow.nodes["final-review"] = { ...workflow.nodes["final-review"], updatedAt: "2026-07-22T00:00:00.000Z" };
  return { nodeId: "final-repair", workflow, dependencies: [] };
}

async function diskCheckpointFixture(workflowId: string) {
  const item = await candidate("preview-1", 1);
  const executionContext = context(workflowId);
  const execution: ComfyUiExecutionTimelineResult = {
    completed: true,
    finalCount: 1,
    finals: [item.final],
    request: { checkpointName: "local.safetensors", positivePrompt: "private prompt" },
    warnings: [],
  };
  const targets = [{
    operation: "contact" as const,
    severity: "major" as const,
    description: "Hand misses cup.",
  }];
  const parent = {
    finalStoredImage: item.final.storedImage!,
    reviewUpdatedAt: "2026-07-22T00:00:00.000Z",
    reviewedFindings: item.review.findings!,
    reviewedTargets: targets,
  };
  const attemptId = deriveRepairAttemptId(
    executionContext.workflow.workflowId,
    item.final.candidateId,
    parent,
    deriveRepairBaseRequestDigest(execution, item.final)!,
  );
  const checkpointStoredImage = managed("f".repeat(32) + ".png", repairPng);
  const maskPng = await sharp({
    create: { width: 64, height: 64, channels: 3, background: "#000000" },
  }).composite([{
    input: {
      create: { width: 8, height: 8, channels: 3, background: "#ffffff" },
    },
    left: 26,
    top: 26,
  }]).png().toBuffer();
  const checkpointMaskImage = managed("e".repeat(32) + ".png", maskPng);
  const checkpointStoredPath = path.join(temporaryRoot, checkpointStoredImage.filename);
  const checkpointMaskPath = path.join(temporaryRoot, checkpointMaskImage.filename);
  await Promise.all([
    fs.writeFile(checkpointStoredPath, repairPng),
    fs.writeFile(checkpointMaskPath, maskPng),
  ]);
  mocks.paths.set(checkpointStoredImage.filename, checkpointStoredPath);
  mocks.paths.set(checkpointMaskImage.filename, checkpointMaskPath);
  const diagnosis = {
    shapes: [{
      type: "polygon" as const,
      points: [
        { x: 0.4, y: 0.4 },
        { x: 0.55, y: 0.4 },
        { x: 0.55, y: 0.55 },
        { x: 0.4, y: 0.55 },
      ],
    }],
    growMaskBy: 2,
  };
  const requestDigest = deriveRepairRequestDigest(execution, item.final, diagnosis, attemptId)!;
  const checkpoint = {
    version: 3,
    attemptId,
    baseRequestDigest: deriveRepairBaseRequestDigest(execution, item.final)!,
    parent,
    diagnosisState: "completed" as const,
    diagnosis,
    mask: {
      provenance: "structured-diagnosis" as const,
      refinement: { status: "skipped" as const, reason: "sam2-unavailable" as const },
      coverageBeforeGrowth: 0.015625,
      coverageAfterGrowth: 0.015625,
      growMaskBy: 2,
      width: 64,
      height: 64,
      storedImage: checkpointMaskImage,
    },
    attempt: {
      attemptId,
      status: "stored" as const,
      promptId: "repair-prompt-1",
      outputNodeId: "9",
      requestDigest,
      sourceImage: {
        filename: "repair-output.png",
        nodeId: "9",
        type: "output",
      },
      storedImage: checkpointStoredImage,
    },
  };
  const review: FinalReviewTimelineResult = {
    reviewVersion: 1,
    status: "reviewed",
    pairs: [item.review],
  };
  return { attemptId, checkpoint, diagnosis, execution, executionContext, item, parent, review };
}

async function writeDiskCheckpoint(attemptId: string, checkpoint: unknown) {
  const checkpointDirectory = process.env.SCENEFORGE_REPAIR_ATTEMPTS_DIR!;
  await fs.mkdir(checkpointDirectory, { recursive: true });
  await fs.writeFile(
    path.join(checkpointDirectory, `${attemptId.slice(7)}.json`),
    JSON.stringify(checkpoint),
    "utf8",
  );
}

beforeEach(async () => {
  temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sceneforge-repair-test-"));
  process.env.SCENEFORGE_REPAIR_ATTEMPTS_DIR = path.join(temporaryRoot, "attempts");
  process.env.LITELLM_BASE_URL = "http://litellm.test";
  process.env.LITELLM_VISION_MODEL = "vision-model";
  repairPng = await sharp({ create: { width: 64, height: 64, channels: 4, background: "#999999" } }).png().toBuffer();
  storedCounter = 0;
  failRepairStorageOnQueueNumber = null;
  repairStorageFailureMessage = null;
  mocks.paths.clear();
  mocks.completeChat.mockReset().mockResolvedValue({
    content: JSON.stringify({
      repairTarget: { cardinality: "single", locality: "localized", regionCount: 1 },
      mask: { coordinateUnit: "normalized", shapes: [{ type: "polygon", points: [
        { x: 0.4, y: 0.4 }, { x: 0.55, y: 0.4 }, { x: 0.55, y: 0.55 }, { x: 0.4, y: 0.55 },
      ] }] },
      adjustments: { growMaskBy: 2 },
    }),
  });
  mocks.buildSam2MaskWorkflow.mockReset();
  mocks.getHistory.mockReset().mockResolvedValue({});
  mocks.buildBasicInpaintWorkflow.mockClear();
  mocks.getObjectInfo.mockReset().mockResolvedValue({});
  mocks.queuePrompt.mockReset().mockImplementation(async () => ({ promptId: `repair-prompt-${mocks.queuePrompt.mock.calls.length}` }));
  mocks.uploadImage.mockReset().mockImplementation(async ({ filename }: { filename: string }) => ({ imageName: filename }));
  mocks.validateComfyUiInpaintRequest.mockReset().mockImplementation((request: unknown) => ({ ok: true, request }));
  mocks.validateComfyUiInpaintRequestAgainstObjectInfo.mockReset().mockImplementation((request: unknown) => ({ errors: [], request, warnings: [] }));
  mocks.validateSam2MaskRequest.mockReset();
  mocks.validateSam2MaskRequestAgainstObjectInfo.mockReset();
  mocks.storeGeneratedImage.mockReset().mockImplementation(async (bytes: Buffer | Uint8Array) => {
    const isRepairOutput = mocks.queuePrompt.mock.calls.length > 0 && Buffer.from(bytes).equals(repairPng);
    if (isRepairOutput && failRepairStorageOnQueueNumber === mocks.queuePrompt.mock.calls.length) {
      failRepairStorageOnQueueNumber = null;
      throw new Error(repairStorageFailureMessage ?? "managed storage unavailable");
    }
    const filename = `${(storedCounter += 1).toString(16).padStart(32, "0")}.png`;
    const output = Buffer.from(bytes);
    const outputPath = path.join(temporaryRoot, filename);
    await fs.writeFile(outputPath, output);
    mocks.paths.set(filename, outputPath);
    return managed(filename, output);
  });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(repairPng), {
    status: 200,
    headers: { "content-type": "image/png" },
  })));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  delete process.env.SCENEFORGE_REPAIR_ATTEMPTS_DIR;
  delete process.env.COMFYUI_API_KEY;
  if (temporaryRoot.startsWith(os.tmpdir())) await fs.rm(temporaryRoot, { recursive: true, force: true });
});

describe("T38C durable repair attempts", () => {
  async function fullSemanticDigestFixture(workflowId: string) {
    const item = await candidate("preview-1", 1);
    const execution: ComfyUiExecutionTimelineResult = {
      completed: true,
      finalCount: 1,
      finals: [item.final],
      request: {
        checkpointName: "semantic-model.safetensors",
        checkpointNameAliases: ["semantic-primary.safetensors", "semantic-fallback.safetensors"],
        workflowProfile: "anima",
        modelBaseModel: "Anima",
        modelStorageKind: "diffusion",
        clipName: "qwen_3_4b.safetensors",
        clipDevice: "default",
        vaeName: "qwen_image_vae.safetensors",
        unetWeightDtype: "default",
        positivePrompt: "semantic positive prompt",
        negativePrompt: "semantic negative prompt",
        loras: [
          { loraName: "style-a.safetensors", strengthModel: 0.62, strengthClip: 0.41 },
          { loraName: "style-b.safetensors", strengthModel: 0.73, strengthClip: 0.52 },
        ],
        width: 768,
        height: 1152,
        seed: 999,
        steps: 31,
        cfg: 5.8,
        samplerName: "euler_ancestral",
        scheduler: "beta",
        denoise: 0.88,
        batchSize: 2,
        latentImageNode: "EmptySD3LatentImage",
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
        controlNets: [
          {
            type: "openpose",
            enabled: true,
            modelName: "openpose.safetensors",
            strength: 0.7,
            startPercent: 0,
            endPercent: 0.8,
            svg: "<svg><path d=\"M 1 1 L 2 2\"/></svg>",
          },
          {
            type: "depth",
            enabled: true,
            modelName: "depth.safetensors",
            strength: 0.45,
            startPercent: 0.1,
            endPercent: 0.9,
            imageName: "depth-reference.png",
          },
        ],
        characterReferences: [
          {
            id: "character-a",
            name: "Character A",
            prompt: "preserve Character A",
            enabled: true,
            mode: "ipadapter",
            images: [
              { id: "character-a-front", imageName: "character-a-front.png", weight: 0.8 },
              { id: "character-a-side", imageName: "character-a-side.png", weight: 0.6 },
            ],
            weight: 0.72,
            weightType: "linear",
            combineEmbeds: "concat",
            startPercent: 0,
            endPercent: 1,
            preset: "PLUS FACE (portraits)",
            loraStrength: 0.55,
            provider: "comfyui",
            embedsScaling: "V only",
          },
          {
            id: "style-reference",
            name: "Style reference",
            enabled: true,
            mode: "ipadapter",
            images: [{ id: "style-image", imageName: "style-reference.png", weight: 0.5 }],
            weight: 0.43,
            combineEmbeds: "average",
            startPercent: 0,
            endPercent: 1,
          },
        ],
        preview: true,
      },
      warnings: [],
    };
    const parent = {
      finalStoredImage: item.final.storedImage!,
      reviewUpdatedAt: "2026-07-22T00:00:00.000Z",
      reviewedFindings: item.review.findings!,
      reviewedTargets: [{
        operation: "contact" as const,
        severity: "major" as const,
        description: "Hand misses cup.",
      }],
    };
    const baseRequestDigest = deriveRepairBaseRequestDigest(execution, item.final)!;
    return {
      baseRequestDigest,
      execution,
      final: item.final,
      parent,
      attemptId: deriveRepairAttemptId(
        workflowId,
        item.final.candidateId,
        parent,
        baseRequestDigest,
      ),
    };
  }

  it.each([
    ["positive prompt", (execution: ComfyUiExecutionTimelineResult) => {
      execution.request.positivePrompt = "changed positive prompt";
    }],
    ["negative prompt", (execution: ComfyUiExecutionTimelineResult) => {
      execution.request.negativePrompt = "changed negative prompt";
    }],
    ["checkpoint", (execution: ComfyUiExecutionTimelineResult) => {
      execution.request.checkpointName = "changed-model.safetensors";
    }],
    ["workflow profile", (execution: ComfyUiExecutionTimelineResult) => {
      execution.request.workflowProfile = "default";
    }],
    ["model base", (execution: ComfyUiExecutionTimelineResult) => {
      execution.request.modelBaseModel = "Illustrious";
    }],
    ["LoRA weight", (execution: ComfyUiExecutionTimelineResult) => {
      execution.request.loras![0]!.strengthModel = 0.63;
    }],
    ["steps", (execution: ComfyUiExecutionTimelineResult) => {
      execution.request.steps = 32;
    }],
    ["CFG", (execution: ComfyUiExecutionTimelineResult) => {
      execution.request.cfg = 6.1;
    }],
    ["sampler", (execution: ComfyUiExecutionTimelineResult) => {
      execution.request.samplerName = "dpmpp_2m";
    }],
    ["scheduler", (execution: ComfyUiExecutionTimelineResult) => {
      execution.request.scheduler = "karras";
    }],
    ["denoise", (execution: ComfyUiExecutionTimelineResult) => {
      execution.request.denoise = 0.79;
    }],
    ["prompt wrapper", (execution: ComfyUiExecutionTimelineResult) => {
      execution.request.promptWrapper = {
        ...execution.request.promptWrapper,
        positivePrefix: "changed style prefix",
      };
    }],
    ["Face Detailer", (execution: ComfyUiExecutionTimelineResult) => {
      execution.request.faceDetailer = {
        ...execution.request.faceDetailer,
        denoise: 0.44,
      };
    }],
    ["Hand Detailer", (execution: ComfyUiExecutionTimelineResult) => {
      execution.request.handDetailer = {
        ...execution.request.handDetailer,
        steps: 17,
      };
    }],
    ["ControlNet", (execution: ComfyUiExecutionTimelineResult) => {
      execution.request.controlNets![0]!.strength = 0.71;
    }],
    ["style reference", (execution: ComfyUiExecutionTimelineResult) => {
      execution.request.characterReferences![1]!.images[0]!.imageName = "changed-style-reference.png";
    }],
    ["formal dimensions", (_execution: ComfyUiExecutionTimelineResult, final: TimelineFinalExecutionRecord) => {
      final.previewUpscale = { ...final.previewUpscale!, width: 72 };
    }],
    ["formal seed", (_execution: ComfyUiExecutionTimelineResult, final: TimelineFinalExecutionRecord) => {
      final.seed += 1;
    }],
  ] as const)(
    "changes the v3 base digest and attempt identity when material %s semantics change",
    async (_name, mutate) => {
      const fixture = await fullSemanticDigestFixture(`semantic-field-${_name.replaceAll(" ", "-")}`);
      const changedExecution = structuredClone(fixture.execution);
      const changedFinal = structuredClone(fixture.final);
      mutate(changedExecution, changedFinal);
      const changedDigest = deriveRepairBaseRequestDigest(changedExecution, changedFinal)!;

      expect(changedDigest).not.toBe(fixture.baseRequestDigest);
      expect(deriveRepairAttemptId(
        `semantic-field-${_name.replaceAll(" ", "-")}`,
        changedFinal.candidateId,
        fixture.parent,
        changedDigest,
      )).not.toBe(fixture.attemptId);
    },
  );

  it("binds immutable confirmed reference identities into Final and Repair attempt digests", async () => {
    const fixture = await fullSemanticDigestFixture("semantic-confirmed-reference-context");
    const withReferences = structuredClone(fixture.execution);
    withReferences.referenceContext = {
      version: 1,
      adapter: "ipadapter",
      references: [{
        role: "character",
        storedFilename: "fedcba9876543210fedcba9876543210.png",
        contentType: "image/png",
        byteLength: 512,
        strength: 0.8,
      }],
      startPercent: 0,
      endPercent: 1,
    };
    const tampered = structuredClone(withReferences);
    tampered.referenceContext!.references[0]!.storedFilename = "00112233445566778899aabbccddeeff.png";

    const confirmedDigest = deriveRepairBaseRequestDigest(withReferences, fixture.final)!;
    expect(confirmedDigest).not.toBe(fixture.baseRequestDigest);
    expect(deriveRepairBaseRequestDigest(tampered, fixture.final)).not.toBe(confirmedDigest);
    expect(deriveRepairAttemptId(
      "semantic-confirmed-reference-context",
      fixture.final.candidateId,
      fixture.parent,
      confirmedDigest,
    )).not.toBe(deriveRepairAttemptId(
      "semantic-confirmed-reference-context",
      fixture.final.candidateId,
      fixture.parent,
      deriveRepairBaseRequestDigest(tampered, fixture.final)!,
    ));
  });

  it("canonicalizes object-key order while excluding transient transport payload fields", async () => {
    const fixture = await fullSemanticDigestFixture("semantic-canonical-objects");
    const reorderedExecution = {
      ...fixture.execution,
      request: reverseObjectKeys(fixture.execution.request) as ComfyUiExecutionTimelineResult["request"],
    };
    const transientExecution = structuredClone(fixture.execution);
    transientExecution.request.outputPrefix = "transient/parent-output-b";
    transientExecution.request.imageName = "transient-parent-upload-b.png";
    transientExecution.request.sourceImageDataUrl = "data:image/png;base64,QkJCQg==";

    expect(deriveRepairBaseRequestDigest(reorderedExecution, fixture.final)).toBe(fixture.baseRequestDigest);
    expect(deriveRepairBaseRequestDigest(transientExecution, fixture.final)).toBe(fixture.baseRequestDigest);
  });

  it.each([
    ["LoRA", (execution: ComfyUiExecutionTimelineResult) => execution.request.loras!.reverse()],
    ["ControlNet", (execution: ComfyUiExecutionTimelineResult) => execution.request.controlNets!.reverse()],
    ["character reference", (execution: ComfyUiExecutionTimelineResult) => execution.request.characterReferences!.reverse()],
    ["reference image", (execution: ComfyUiExecutionTimelineResult) =>
      execution.request.characterReferences![0]!.images.reverse()],
  ] as const)("keeps the material %s array order in the semantic digest contract", async (_name, reorder) => {
    const fixture = await fullSemanticDigestFixture(`semantic-order-${_name.replaceAll(" ", "-")}`);
    const reorderedExecution = structuredClone(fixture.execution);
    reorder(reorderedExecution);

    expect(deriveRepairBaseRequestDigest(reorderedExecution, fixture.final)).not.toBe(fixture.baseRequestDigest);
  });

  it("derives the shared attempt identity as SHA-256 over the exact server binding", async () => {
    const item = await candidate("preview-1", 1);
    const execution: ComfyUiExecutionTimelineResult = {
      completed: true,
      finalCount: 1,
      finals: [item.final],
      request: { checkpointName: "local.safetensors", positivePrompt: "private prompt" },
      warnings: [],
    };
    const parent = {
      finalStoredImage: item.final.storedImage!,
      reviewUpdatedAt: "2026-07-22T00:00:00.000Z",
      reviewedFindings: item.review.findings!,
      reviewedTargets: [{
        operation: "contact" as const,
        severity: "major" as const,
        description: "Hand misses cup.",
      }],
    };
    const baseRequestDigest = deriveRepairBaseRequestDigest(execution, item.final)!;
    const payload = JSON.stringify({
      workflowId: "attempt-identity-contract",
      candidateId: item.final.candidateId,
      parent,
      baseRequestDigest,
    });

    expect(deriveRepairAttemptId(
      "attempt-identity-contract",
      item.final.candidateId,
      parent,
      baseRequestDigest,
    )).toBe(
      `sha256:${createHash("sha256").update(payload).digest("hex")}`,
    );
  });

  it("redacts raw checkpoint-read errors and fails closed before queueing", async () => {
    const item = await candidate("preview-1", 1);
    vi.spyOn(fs, "readFile").mockRejectedValueOnce(new Error(unsafeUpstreamText));

    const result = await repairFinalExecution(
      {
        completed: true,
        finalCount: 1,
        finals: [item.final],
        request: { checkpointName: "local.safetensors", positivePrompt: "private prompt" },
        warnings: [],
      },
      { reviewVersion: 1, status: "reviewed", pairs: [item.review] },
      context("unsafe-checkpoint-read"),
    );
    const serialized = JSON.stringify(result);

    expect(result.pairs[0]).toMatchObject({
      status: "failed",
      error: {
        code: "comfyui_execution_failed",
        details: { recoverable: false, stage: "checkpoint-read" },
      },
    });
    expect(serialized).not.toContain("PRIVATE");
    expect(serialized).not.toContain("/var/private");
    expect(serialized).not.toContain("data:image");
    expect(serialized).not.toContain("sk-secret");
    expect(mocks.queuePrompt).not.toHaveBeenCalled();
  });

  it("rejects a stored checkpoint with canonical-looking fields plus unsafe extras", async () => {
    const item = await candidate("preview-1", 1);
    const execution: ComfyUiExecutionTimelineResult = {
      completed: true,
      finalCount: 1,
      finals: [item.final],
      request: { checkpointName: "local.safetensors", positivePrompt: "private prompt" },
      warnings: [],
    };
    const executionContext = context("unsafe-stored-checkpoint");
    const targets = [{
      operation: "contact" as const,
      severity: "major" as const,
      description: "Hand misses cup.",
    }];
    const parent = {
      finalStoredImage: item.final.storedImage!,
      reviewUpdatedAt: "2026-07-22T00:00:00.000Z",
      reviewedFindings: item.review.findings!,
      reviewedTargets: targets,
    };
    const attemptId = deriveRepairAttemptId(
      executionContext.workflow.workflowId,
      item.final.candidateId,
      parent,
      deriveRepairBaseRequestDigest(execution, item.final)!,
    );
    const checkpointStoredImage = managed("f".repeat(32) + ".png", repairPng);
    const checkpointDirectory = process.env.SCENEFORGE_REPAIR_ATTEMPTS_DIR!;
    await fs.mkdir(checkpointDirectory, { recursive: true });
    await fs.writeFile(path.join(checkpointDirectory, `${attemptId.slice(7)}.json`), JSON.stringify({
      version: 1,
      attemptId,
      parent,
      attempt: {
        attemptId,
        status: "stored",
        promptId: "repair-prompt-1",
        outputNodeId: "9",
        sourceImage: {
          filename: "repair-output.png",
          nodeId: "9",
          type: "output",
          dataUrl: "data:image/png;base64,PRIVATE_IMAGE",
        },
        storedImage: {
          ...checkpointStoredImage,
          absolutePath: "C:\\Users\\PRIVATE\\repair.png",
          prompt: "PRIVATE_PROMPT",
          token: "sk-secret-value",
        },
        custom: "/var/private/repair.png",
      },
    }), "utf8");

    const result = await repairFinalExecution(
      execution,
      { reviewVersion: 1, status: "reviewed", pairs: [item.review] },
      executionContext,
    );
    const serialized = JSON.stringify(result);

    expect(result.pairs[0]).toMatchObject({
      status: "failed",
      error: {
        code: "comfyui_execution_failed",
        message: "Repair checkpoint state could not be read safely. This Repair remains closed.",
        details: { recoverable: false, stage: "checkpoint-read" },
      },
    });
    expect(serialized).not.toContain("PRIVATE");
    expect(serialized).not.toContain("/var/private");
    expect(serialized).not.toContain("data:image");
    expect(serialized).not.toContain("sk-secret");
    expect(mocks.getHistory).not.toHaveBeenCalled();
    expect(mocks.queuePrompt).not.toHaveBeenCalled();
  });

  it("resumes an exact clean queued checkpoint without creating another Repair queue item", async () => {
    const fixture = await diskCheckpointFixture("independent-clean-checkpoint");
    await writeDiskCheckpoint(fixture.attemptId, {
      ...fixture.checkpoint,
      attempt: {
        attemptId: fixture.attemptId,
        status: "queued",
        promptId: "repair-prompt-1",
        outputNodeId: "9",
        requestDigest: fixture.checkpoint.attempt.requestDigest,
      },
    });

    const result = await repairFinalExecution(
      fixture.execution,
      fixture.review,
      fixture.executionContext,
    );

    expect(result.pairs[0]).toMatchObject({
      status: "repaired",
      attempt: {
        attemptId: fixture.attemptId,
        status: "stored",
        promptId: "repair-prompt-1",
        outputNodeId: "9",
      },
    });
    expect(mocks.getHistory).toHaveBeenCalledWith("repair-prompt-1");
    expect(mocks.queuePrompt).not.toHaveBeenCalled();
  });

  it("fails closed on a legacy v2 checkpoint before diagnosis, history, storage, or queue work", async () => {
    const fixture = await diskCheckpointFixture("legacy-v2-checkpoint");
    await writeDiskCheckpoint(fixture.attemptId, {
      ...fixture.checkpoint,
      version: 2,
    });

    const result = await repairFinalExecution(
      fixture.execution,
      fixture.review,
      fixture.executionContext,
    );

    expect(result.pairs[0]).toMatchObject({
      status: "failed",
      skipReason: "repair-failed",
      error: {
        code: "comfyui_execution_failed",
        message: "Repair checkpoint state could not be read safely. This Repair remains closed.",
        details: { recoverable: false, stage: "checkpoint-read" },
      },
    });
    expect(mocks.completeChat).not.toHaveBeenCalled();
    expect(mocks.getHistory).not.toHaveBeenCalled();
    expect(mocks.getObjectInfo).not.toHaveBeenCalled();
    expect(mocks.uploadImage).not.toHaveBeenCalled();
    expect(mocks.storeGeneratedImage).not.toHaveBeenCalled();
    expect(mocks.queuePrompt).not.toHaveBeenCalled();
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("semantically canonicalizes a fully reordered v3 checkpoint and reuses the stored Repair without requeueing", async () => {
    const fixture = await diskCheckpointFixture("reordered-v2-checkpoint");
    const checkpoint = {
      ...fixture.checkpoint,
      sam2Attempt: {
        attemptId: fixture.attemptId,
        status: "output-ready" as const,
        promptId: "sam2-prompt-1",
        outputNodeId: "9",
        sourceImage: {
          filename: "sam2-mask.png",
          nodeId: "9",
          type: "output" as const,
        },
      },
    };
    await writeDiskCheckpoint(fixture.attemptId, reverseObjectKeys(checkpoint));

    const result = await repairFinalExecution(
      fixture.execution,
      fixture.review,
      fixture.executionContext,
    );

    expect(result.pairs[0]).toMatchObject({
      status: "repaired",
      diagnosis: fixture.diagnosis,
      mask: checkpoint.mask,
      attempt: checkpoint.attempt,
      storedImage: checkpoint.attempt.storedImage,
    });
    expect(mocks.completeChat).not.toHaveBeenCalled();
    expect(mocks.getObjectInfo).not.toHaveBeenCalled();
    expect(mocks.getHistory).not.toHaveBeenCalled();
    expect(mocks.queuePrompt).not.toHaveBeenCalled();
  });

  it.each([
    ["queued", false, false],
    ["output-ready", true, false],
    ["stored", true, true],
  ] as const)(
    "rejects a disk %s attempt whose safe output node differs from the rebuilt Repair workflow",
    async (status, includeSource, includeStored) => {
      const fixture = await diskCheckpointFixture(`disk-output-node-${status}`);
      const checkpoint = structuredClone(fixture.checkpoint);
      (checkpoint as { attempt: TimelineRepairAttempt }).attempt = {
        attemptId: fixture.attemptId,
        status,
        promptId: "repair-prompt-1",
        outputNodeId: "different-output",
        requestDigest: fixture.checkpoint.attempt.requestDigest,
        ...(includeSource
          ? { sourceImage: { filename: "repair-output.png", nodeId: "different-output", type: "output" as const } }
          : {}),
        ...(includeStored ? { storedImage: fixture.checkpoint.attempt.storedImage } : {}),
      };
      await writeDiskCheckpoint(fixture.attemptId, checkpoint);

      const result = await repairFinalExecution(
        fixture.execution,
        fixture.review,
        fixture.executionContext,
      );

      expect(result.pairs[0]).toMatchObject({
        status: "failed",
        skipReason: "repair-failed",
        error: {
          code: "timeline_request_invalid",
          details: { recoverable: false, stage: "attempt-identity" },
        },
      });
      expect(mocks.getHistory).not.toHaveBeenCalled();
      expect(mocks.getObjectInfo).not.toHaveBeenCalled();
      expect(mocks.uploadImage).not.toHaveBeenCalled();
      expect(mocks.storeGeneratedImage).not.toHaveBeenCalled();
      expect(mocks.queuePrompt).not.toHaveBeenCalled();
      expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    },
  );

  it.each(["output-ready", "stored"] as const)(
    "rejects a disk %s attempt when sourceImage.nodeId differs from outputNodeId",
    async (status) => {
      const fixture = await diskCheckpointFixture(`disk-source-node-${status}`);
      const checkpoint = structuredClone(fixture.checkpoint);
      (checkpoint as { attempt: TimelineRepairAttempt }).attempt = {
        ...checkpoint.attempt,
        status,
        sourceImage: {
          ...checkpoint.attempt.sourceImage,
          nodeId: "different-source",
        },
        ...(status === "output-ready" ? { storedImage: undefined } : {}),
      };
      await writeDiskCheckpoint(fixture.attemptId, checkpoint);

      const result = await repairFinalExecution(
        fixture.execution,
        fixture.review,
        fixture.executionContext,
      );

      expect(result.pairs[0]).toMatchObject({
        status: "failed",
        error: {
          code: "comfyui_execution_failed",
          details: { recoverable: false, stage: "checkpoint-read" },
        },
      });
      expect(mocks.getHistory).not.toHaveBeenCalled();
      expect(mocks.getObjectInfo).not.toHaveBeenCalled();
      expect(mocks.uploadImage).not.toHaveBeenCalled();
      expect(mocks.storeGeneratedImage).not.toHaveBeenCalled();
      expect(mocks.queuePrompt).not.toHaveBeenCalled();
      expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    },
  );

  it.each(["output-ready", "stored"] as const)(
    "rejects a workflow-only %s attempt whose source node differs from its output node",
    async (status) => {
      const fixture = await diskCheckpointFixture(`workflow-source-node-${status}`);
      const previous: FinalRepairTimelineResult = {
        repairVersion: 1,
        authorized: true,
        completed: true,
        pairs: [{
          candidateId: fixture.item.final.candidateId,
          rank: fixture.item.final.rank,
          seed: fixture.item.final.seed,
          status: "failed",
          targets: fixture.parent.reviewedTargets,
          parent: fixture.parent,
          diagnosis: fixture.diagnosis,
          mask: fixture.checkpoint.mask,
          attempt: {
            attemptId: fixture.attemptId,
            status,
            promptId: "repair-prompt-1",
            outputNodeId: "9",
            sourceImage: {
              filename: "repair-output.png",
              nodeId: "different-source",
              type: "output",
            },
            ...(status === "stored" ? { storedImage: fixture.checkpoint.attempt.storedImage } : {}),
          },
          skipReason: "repair-failed",
          retryStage: "comfyui",
        }],
      };

      const result = await repairFinalExecution(
        fixture.execution,
        fixture.review,
        fixture.executionContext,
        previous,
      );

      expect(result.pairs[0]).toMatchObject({
        status: "failed",
        error: {
          code: "timeline_request_invalid",
          details: { recoverable: false, stage: "attempt-identity" },
        },
      });
      expect(mocks.completeChat).not.toHaveBeenCalled();
      expect(mocks.getHistory).not.toHaveBeenCalled();
      expect(mocks.getObjectInfo).not.toHaveBeenCalled();
      expect(mocks.uploadImage).not.toHaveBeenCalled();
      expect(mocks.storeGeneratedImage).not.toHaveBeenCalled();
      expect(mocks.queuePrompt).not.toHaveBeenCalled();
      expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["queued", false, false],
    ["output-ready", true, false],
    ["stored", true, true],
  ] as const)(
    "rejects a workflow-only %s attempt whose output node differs from the rebuilt Repair workflow",
    async (status, includeSource, includeStored) => {
      const fixture = await diskCheckpointFixture(`workflow-output-node-${status}`);
      const previous: FinalRepairTimelineResult = {
        repairVersion: 1,
        authorized: true,
        completed: true,
        pairs: [{
          candidateId: fixture.item.final.candidateId,
          rank: fixture.item.final.rank,
          seed: fixture.item.final.seed,
          status: "failed",
          targets: fixture.parent.reviewedTargets,
          parent: fixture.parent,
          diagnosis: fixture.diagnosis,
          mask: fixture.checkpoint.mask,
          attempt: {
            attemptId: fixture.attemptId,
            status,
            promptId: "repair-prompt-1",
            outputNodeId: "different-output",
            ...(includeSource
              ? { sourceImage: { filename: "repair-output.png", nodeId: "different-output", type: "output" as const } }
              : {}),
            ...(includeStored ? { storedImage: fixture.checkpoint.attempt.storedImage } : {}),
          },
          skipReason: "repair-failed",
          retryStage: "comfyui",
        }],
      };

      const result = await repairFinalExecution(
        fixture.execution,
        fixture.review,
        fixture.executionContext,
        previous,
      );

      expect(result.pairs[0]).toMatchObject({
        status: "failed",
        error: {
          code: "timeline_request_invalid",
          details: { recoverable: false, stage: "attempt-identity" },
        },
      });
      expect(mocks.completeChat).not.toHaveBeenCalled();
      expect(mocks.getHistory).not.toHaveBeenCalled();
      expect(mocks.getObjectInfo).not.toHaveBeenCalled();
      expect(mocks.uploadImage).not.toHaveBeenCalled();
      expect(mocks.storeGeneratedImage).not.toHaveBeenCalled();
      expect(mocks.queuePrompt).not.toHaveBeenCalled();
      expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["envelope absolutePath", (checkpoint: Record<string, unknown>) => {
      checkpoint.absolutePath = "C:\\Users\\PRIVATE\\checkpoint.json";
    }],
    ["parent custom object", (checkpoint: Record<string, unknown>) => {
      (checkpoint.parent as Record<string, unknown>).custom = { token: "sk-secret-parent" };
    }],
    ["parent image data URL", (checkpoint: Record<string, unknown>) => {
      const parent = checkpoint.parent as { finalStoredImage: Record<string, unknown> };
      parent.finalStoredImage.dataUrl = "data:image/png;base64,PRIVATE_PARENT_IMAGE";
    }],
    ["parent finding prompt fragment", (checkpoint: Record<string, unknown>) => {
      const parent = checkpoint.parent as { reviewedFindings: Array<Record<string, unknown>> };
      parent.reviewedFindings[0]!.prompt = "PRIVATE_PARENT_PROMPT";
    }],
    ["parent target secret", (checkpoint: Record<string, unknown>) => {
      const parent = checkpoint.parent as { reviewedTargets: Array<Record<string, unknown>> };
      parent.reviewedTargets[0]!.secret = "sk-secret-target";
    }],
    ["diagnosis raw response", (checkpoint: Record<string, unknown>) => {
      (checkpoint.diagnosis as Record<string, unknown>).rawResponse = "PRIVATE_RAW_DIAGNOSIS";
    }],
    ["diagnosis shape prompt", (checkpoint: Record<string, unknown>) => {
      const diagnosis = checkpoint.diagnosis as { shapes: Array<Record<string, unknown>> };
      diagnosis.shapes[0]!.prompt = "PRIVATE_SHAPE_PROMPT";
    }],
    ["SAM2 attempt custom payload", (checkpoint: Record<string, unknown>) => {
      const attemptId = checkpoint.attemptId as string;
      checkpoint.sam2Attempt = {
        attemptId,
        status: "queued",
        promptId: "sam2-prompt-1",
        outputNodeId: "9",
        custom: { token: "sk-secret-sam2" },
      };
    }],
    ["mask custom payload", (checkpoint: Record<string, unknown>) => {
      (checkpoint.mask as Record<string, unknown>).custom = { prompt: "PRIVATE_MASK_PROMPT" };
    }],
    ["mask refinement secret", (checkpoint: Record<string, unknown>) => {
      const mask = checkpoint.mask as { refinement: Record<string, unknown> };
      mask.refinement.secret = "sk-secret-refinement";
    }],
    ["mask stored image data URL", (checkpoint: Record<string, unknown>) => {
      const mask = checkpoint.mask as { storedImage: Record<string, unknown> };
      mask.storedImage.dataUrl = "data:image/png;base64,PRIVATE_MASK_IMAGE";
    }],
    ["attempt custom object", (checkpoint: Record<string, unknown>) => {
      (checkpoint.attempt as Record<string, unknown>).custom = { imageFragment: "PRIVATE_FRAGMENT" };
    }],
    ["source image data URL", (checkpoint: Record<string, unknown>) => {
      const attempt = checkpoint.attempt as { sourceImage: Record<string, unknown> };
      attempt.sourceImage.dataUrl = "data:image/png;base64,PRIVATE_SOURCE_IMAGE";
    }],
    ["stored image token", (checkpoint: Record<string, unknown>) => {
      const attempt = checkpoint.attempt as { storedImage: Record<string, unknown> };
      attempt.storedImage.token = "sk-secret-stored";
    }],
  ] as const)("rejects a plausible disk checkpoint containing an unknown %s field", async (_name, mutate) => {
    const fixture = await diskCheckpointFixture(`unknown-checkpoint-${_name.replaceAll(" ", "-")}`);
    const checkpoint = structuredClone(fixture.checkpoint) as unknown as Record<string, unknown>;
    mutate(checkpoint);
    await writeDiskCheckpoint(fixture.attemptId, checkpoint);

    const result = await repairFinalExecution(
      fixture.execution,
      fixture.review,
      fixture.executionContext,
    );
    const serialized = JSON.stringify(result);

    expect(result.pairs[0]).toMatchObject({
      status: "failed",
      error: {
        code: "comfyui_execution_failed",
        message: "Repair checkpoint state could not be read safely. This Repair remains closed.",
        details: { recoverable: false, stage: "checkpoint-read" },
      },
    });
    expect(serialized).not.toMatch(/PRIVATE|data:image|sk-secret|absolutePath|imageFragment/);
    expect(mocks.getHistory).not.toHaveBeenCalled();
    expect(mocks.queuePrompt).not.toHaveBeenCalled();
  });

  it.each([
    ["queue-started with prompt", (attempt: Record<string, unknown>) => {
      attempt.status = "queue-started";
    }],
    ["queued without prompt", (attempt: Record<string, unknown>) => {
      attempt.status = "queued";
      delete attempt.promptId;
      delete attempt.sourceImage;
      delete attempt.storedImage;
    }],
    ["output-ready without source", (attempt: Record<string, unknown>) => {
      attempt.status = "output-ready";
      delete attempt.sourceImage;
      delete attempt.storedImage;
    }],
    ["stored without stored image", (attempt: Record<string, unknown>) => {
      delete attempt.storedImage;
    }],
    ["unsafe prompt identifier", (attempt: Record<string, unknown>) => {
      attempt.status = "queued";
      attempt.promptId = "../private-prompt";
      delete attempt.sourceImage;
      delete attempt.storedImage;
    }],
    ["unsafe output identifier", (attempt: Record<string, unknown>) => {
      attempt.outputNodeId = "9/../../private";
    }],
    ["unsafe source reference", (attempt: Record<string, unknown>) => {
      (attempt.sourceImage as Record<string, unknown>).filename = "../private-output.png";
    }],
    ["noncanonical stored reference", (attempt: Record<string, unknown>) => {
      (attempt.storedImage as Record<string, unknown>).url = "https://private.example/repair.png";
    }],
  ] as const)("fails closed on a checkpoint attempt with %s", async (_name, mutate) => {
    const fixture = await diskCheckpointFixture(`malformed-checkpoint-${_name.replaceAll(" ", "-")}`);
    const checkpoint = structuredClone(fixture.checkpoint);
    mutate(checkpoint.attempt as unknown as Record<string, unknown>);
    await writeDiskCheckpoint(fixture.attemptId, checkpoint);

    const result = await repairFinalExecution(
      fixture.execution,
      fixture.review,
      fixture.executionContext,
    );

    expect(result.pairs[0]).toMatchObject({
      status: "failed",
      error: {
        code: "comfyui_execution_failed",
        message: "Repair checkpoint state could not be read safely. This Repair remains closed.",
        details: { recoverable: false, stage: "checkpoint-read" },
      },
    });
    expect(mocks.getHistory).not.toHaveBeenCalled();
    expect(mocks.queuePrompt).not.toHaveBeenCalled();
  });

  it("redacts raw managed-image read errors", async () => {
    const item = await candidate("preview-1", 1);
    mocks.paths.set(
      item.final.storedImage!.filename,
      path.join(temporaryRoot, "PRIVATE_PROMPT-sk-secret-managed-image.png"),
    );

    const result = await repairFinalExecution(
      {
        completed: true,
        finalCount: 1,
        finals: [item.final],
        request: { checkpointName: "local.safetensors", positivePrompt: "private prompt" },
        warnings: [],
      },
      { reviewVersion: 1, status: "reviewed", pairs: [item.review] },
      context("unsafe-managed-read"),
    );
    const serialized = JSON.stringify(result);

    expect(result.pairs[0]).toMatchObject({
      status: "failed",
      error: {
        code: "image_storage_failed",
        details: { recoverable: true, stage: "managed-image-read" },
      },
    });
    expect(serialized).not.toContain("PRIVATE");
    expect(serialized).not.toContain("sk-secret");
    expect(serialized).not.toContain(temporaryRoot);
    expect(mocks.queuePrompt).not.toHaveBeenCalled();
  });

  it("redacts raw managed mask-storage errors", async () => {
    const item = await candidate("preview-1", 1);
    mocks.storeGeneratedImage.mockRejectedValueOnce(new Error(unsafeUpstreamText));

    const result = await repairFinalExecution(
      {
        completed: true,
        finalCount: 1,
        finals: [item.final],
        request: { checkpointName: "local.safetensors", positivePrompt: "private prompt" },
        warnings: [],
      },
      { reviewVersion: 1, status: "reviewed", pairs: [item.review] },
      context("unsafe-mask-store"),
    );
    const serialized = JSON.stringify(result);

    expect(result.pairs[0]).toMatchObject({
      status: "failed",
      error: {
        code: "image_storage_failed",
        details: { recoverable: true, stage: "mask-storage" },
      },
    });
    expect(serialized).not.toContain("PRIVATE");
    expect(serialized).not.toContain("/var/private");
    expect(serialized).not.toContain("data:image");
    expect(serialized).not.toContain("sk-secret");
    expect(mocks.queuePrompt).not.toHaveBeenCalled();
  });

  it("redacts raw managed repair-storage errors while retaining the resumable attempt", async () => {
    const item = await candidate("preview-1", 1);
    failRepairStorageOnQueueNumber = 1;
    repairStorageFailureMessage = unsafeUpstreamText;

    const result = await repairFinalExecution(
      {
        completed: true,
        finalCount: 1,
        finals: [item.final],
        request: { checkpointName: "local.safetensors", positivePrompt: "private prompt" },
        warnings: [],
      },
      { reviewVersion: 1, status: "reviewed", pairs: [item.review] },
      context("unsafe-repair-store"),
    );
    const serialized = JSON.stringify(result);

    expect(result.pairs[0]).toMatchObject({
      status: "failed",
      retryStage: "comfyui",
      attempt: { status: "output-ready" },
      error: {
        code: "image_storage_failed",
        details: { recoverable: true, stage: "repair-storage" },
      },
    });
    expect(serialized).not.toContain("PRIVATE");
    expect(serialized).not.toContain("/var/private");
    expect(serialized).not.toContain("data:image");
    expect(serialized).not.toContain("sk-secret");
    expect(mocks.queuePrompt).toHaveBeenCalledTimes(1);
  });

  it.each([
    "missing checkpoint",
    "changed and cleaned checkpoint directory",
  ])("rejects a different valid attempt digest with a %s before any checkpoint or queue path", async (checkpointCase) => {
    const item = await candidate("preview-1", 1);
    if (checkpointCase === "changed and cleaned checkpoint directory") {
      process.env.SCENEFORGE_REPAIR_ATTEMPTS_DIR = path.join(temporaryRoot, "replacement-attempts");
      await fs.mkdir(process.env.SCENEFORGE_REPAIR_ATTEMPTS_DIR, { recursive: true });
      await fs.rm(process.env.SCENEFORGE_REPAIR_ATTEMPTS_DIR, { recursive: true, force: true });
    }
    const execution: ComfyUiExecutionTimelineResult = {
      completed: true,
      finalCount: 1,
      finals: [item.final],
      request: { checkpointName: "local.safetensors", positivePrompt: "private prompt" },
      warnings: [],
    };
    const review: FinalReviewTimelineResult = { reviewVersion: 1, status: "reviewed", pairs: [item.review] };
    const targets = [{
      operation: "contact" as const,
      severity: "major" as const,
      description: "Hand misses cup.",
    }];
    const parent = {
      finalStoredImage: item.final.storedImage!,
      reviewUpdatedAt: "2026-07-22T00:00:00.000Z",
      reviewedFindings: item.review.findings!,
      reviewedTargets: targets,
    };
    const previous: FinalRepairTimelineResult = {
      repairVersion: 1,
      authorized: true,
      completed: true,
      pairs: [{
        candidateId: item.final.candidateId,
        rank: item.final.rank,
        seed: item.final.seed,
        status: "failed",
        targets,
        parent,
        attempt: {
          attemptId: `sha256:${"b".repeat(64)}`,
          status: "queued",
          promptId: "other-valid-prompt",
          outputNodeId: "9",
        },
        retryStage: "comfyui",
        skipReason: "repair-failed",
      }],
    };
    const checkpointRead = vi.spyOn(fs, "readFile");
    checkpointRead.mockClear();

    const result = await repairFinalExecution(execution, review, context("different-valid-digest"), previous);

    expect(result.pairs[0]).toMatchObject({
      status: "failed",
      skipReason: "repair-failed",
      error: {
        code: "timeline_request_invalid",
        message: expect.stringContaining("identity did not match"),
        details: { recoverable: false, stage: "attempt-identity" },
      },
    });
    expect(result.pairs[0]?.attempt).toBeUndefined();
    expect(result.pairs[0]?.retryStage).toBeUndefined();
    expect(mocks.completeChat).not.toHaveBeenCalled();
    expect(mocks.getObjectInfo).not.toHaveBeenCalled();
    expect(mocks.uploadImage).not.toHaveBeenCalled();
    expect(mocks.queuePrompt).not.toHaveBeenCalled();
    expect(checkpointRead).not.toHaveBeenCalled();
    checkpointRead.mockRestore();
  });

  it("redacts a raw queue-started checkpoint write error and never calls ComfyUI queue", async () => {
    const item = await candidate("preview-1", 1);
    const actualWriteFile = fs.writeFile.bind(fs);
    const checkpointWrite = vi.spyOn(fs, "writeFile").mockImplementation(async (filename, data, options) => {
      if (String(filename).includes(path.join(temporaryRoot, "attempts")) &&
          checkpointAttemptStatus(data) === "queue-started") {
        throw new Error(unsafeUpstreamText);
      }
      return actualWriteFile(filename, data, options);
    });

    const result = await repairFinalExecution(
      {
        completed: true,
        finalCount: 1,
        finals: [item.final],
        request: { checkpointName: "local.safetensors", positivePrompt: "private prompt" },
        warnings: [],
      },
      { reviewVersion: 1, status: "reviewed", pairs: [item.review] },
      context("unsafe-queue-started-write"),
    );
    checkpointWrite.mockRestore();
    const serialized = JSON.stringify(result);

    expect(result.pairs[0]).toMatchObject({
      status: "failed",
      skipReason: "queue-outcome-unknown",
      attempt: { status: "queue-started" },
      error: {
        code: "comfyui_execution_failed",
        details: { recoverable: false, stage: "queue-outcome" },
      },
    });
    expect(serialized).not.toContain("PRIVATE");
    expect(serialized).not.toContain("/var/private");
    expect(serialized).not.toContain("data:image");
    expect(serialized).not.toContain("sk-secret");
    expect(mocks.queuePrompt).not.toHaveBeenCalled();
  });

  it("redacts a raw post-queue checkpoint temporary-write error and retains monotonic resume identity", async () => {
    const item = await candidate("preview-1", 1);
    const actualWriteFile = fs.writeFile.bind(fs);
    const checkpointWrite = vi.spyOn(fs, "writeFile").mockImplementation(async (filename, data, options) => {
      if (String(filename).includes(path.join(temporaryRoot, "attempts")) &&
          String(filename).endsWith(".tmp") &&
          checkpointAttemptStatus(data) === "queued") {
        throw new Error(unsafeUpstreamText);
      }
      return actualWriteFile(filename, data, options);
    });

    const result = await repairFinalExecution(
      {
        completed: true,
        finalCount: 1,
        finals: [item.final],
        request: { checkpointName: "local.safetensors", positivePrompt: "private prompt" },
        warnings: [],
      },
      { reviewVersion: 1, status: "reviewed", pairs: [item.review] },
      context("unsafe-post-queue-write"),
    );
    checkpointWrite.mockRestore();
    const serialized = JSON.stringify(result);

    expect(result.pairs[0]).toMatchObject({
      status: "failed",
      retryStage: "comfyui",
      attempt: { status: "queued", promptId: "repair-prompt-1" },
      error: {
        code: "comfyui_execution_failed",
        details: { recoverable: true, stage: "checkpoint-write" },
      },
    });
    expect(serialized).not.toContain("PRIVATE");
    expect(serialized).not.toContain("/var/private");
    expect(serialized).not.toContain("data:image");
    expect(serialized).not.toContain("sk-secret");
    expect(mocks.queuePrompt).toHaveBeenCalledTimes(1);
  });

  it.each([
    "history",
    "image-fetch",
  ])("redacts raw %s errors after queue acceptance and preserves the queued attempt", async (failureLayer) => {
    const item = await candidate("preview-1", 1);
    if (failureLayer === "history") {
      mocks.getHistory.mockRejectedValueOnce(new Error(unsafeUpstreamText));
    } else {
      vi.stubGlobal("fetch", vi.fn(async () => {
        throw new Error(unsafeUpstreamText);
      }));
    }

    const result = await repairFinalExecution(
      {
        completed: true,
        finalCount: 1,
        finals: [item.final],
        request: { checkpointName: "local.safetensors", positivePrompt: "private prompt" },
        warnings: [],
      },
      { reviewVersion: 1, status: "reviewed", pairs: [item.review] },
      context(`unsafe-${failureLayer}`),
    );
    const serialized = JSON.stringify(result);

    expect(result.pairs[0]).toMatchObject({
      status: "failed",
      retryStage: "comfyui",
      attempt: { status: "queued", promptId: "repair-prompt-1" },
      error: {
        code: "comfyui_execution_failed",
        message: "Repair execution could not be completed safely.",
        details: { recoverable: true, stage: "comfyui" },
      },
    });
    expect(serialized).not.toContain("PRIVATE");
    expect(serialized).not.toContain("/var/private");
    expect(serialized).not.toContain("data:image");
    expect(serialized).not.toContain("sk-secret");
    expect(mocks.queuePrompt).toHaveBeenCalledTimes(1);
  });

  it("checkpoints before diagnosis and closes an uncertain diagnosis without invoking the provider twice", async () => {
    const item = await candidate("preview-1", 1);
    const execution: ComfyUiExecutionTimelineResult = {
      completed: true,
      finalCount: 1,
      finals: [item.final],
      request: { checkpointName: "local.safetensors", positivePrompt: "private prompt" },
      warnings: [],
    };
    const review: FinalReviewTimelineResult = { reviewVersion: 1, status: "reviewed", pairs: [item.review] };
    const executionContext = context("diagnosis-outcome-unknown");
    mocks.completeChat.mockRejectedValueOnce(new Error("connection lost after diagnosis request"));

    const interrupted = await repairFinalExecution(execution, review, executionContext);
    const resumed = await repairFinalExecution(execution, review, executionContext);

    expect(interrupted.pairs[0]).toMatchObject({
      status: "failed",
      retryStage: "diagnosis",
      error: { details: { stage: "diagnosis" } },
    });
    expect(resumed.pairs[0]).toMatchObject({
      status: "failed",
      skipReason: "repair-failed",
      error: {
        code: "llm_upstream",
        details: { recoverable: false, stage: "diagnosis-outcome" },
      },
    });
    expect(resumed.pairs[0]?.retryStage).toBeUndefined();
    expect(mocks.completeChat).toHaveBeenCalledTimes(1);
    expect(mocks.getObjectInfo).not.toHaveBeenCalled();
    expect(mocks.queuePrompt).not.toHaveBeenCalled();
  });

  it("reuses a durable completed diagnosis after process loss and does not diagnose the structured-mask path twice", async () => {
    const item = await candidate("preview-1", 1);
    const execution: ComfyUiExecutionTimelineResult = {
      completed: true,
      finalCount: 1,
      finals: [item.final],
      request: { checkpointName: "local.safetensors", positivePrompt: "private prompt" },
      warnings: [],
    };
    const review: FinalReviewTimelineResult = { reviewVersion: 1, status: "reviewed", pairs: [item.review] };
    const executionContext = context("completed-diagnosis-resume");
    mocks.storeGeneratedImage.mockRejectedValueOnce(new Error("mask store lost with process"));

    const interrupted = await repairFinalExecution(execution, review, executionContext);
    const resumed = await repairFinalExecution(execution, review, executionContext);

    expect(interrupted.pairs[0]).toMatchObject({
      status: "failed",
      diagnosis: expect.objectContaining({ growMaskBy: 2 }),
      error: { details: { stage: "mask-storage" } },
    });
    expect(resumed.pairs[0]).toMatchObject({
      status: "repaired",
      diagnosis: expect.objectContaining({ growMaskBy: 2 }),
      mask: { provenance: "structured-diagnosis" },
      attempt: { status: "stored" },
    });
    expect(mocks.completeChat).toHaveBeenCalledTimes(1);
    expect(mocks.queuePrompt).toHaveBeenCalledTimes(1);
  });

  it("reuses a durable validated mask after process loss and resumes history, fetch, and storage without requeueing", async () => {
    const item = await candidate("preview-1", 1);
    const execution: ComfyUiExecutionTimelineResult = {
      completed: true,
      finalCount: 1,
      finals: [item.final],
      request: { checkpointName: "local.safetensors", positivePrompt: "private prompt" },
      warnings: [],
    };
    const review: FinalReviewTimelineResult = { reviewVersion: 1, status: "reviewed", pairs: [item.review] };
    const executionContext = context("validated-mask-resume");
    mocks.getHistory.mockRejectedValueOnce(new Error("process lost after queue acceptance"));

    const interrupted = await repairFinalExecution(execution, review, executionContext);
    const resumed = await repairFinalExecution(execution, review, executionContext);

    expect(interrupted.pairs[0]).toMatchObject({
      status: "failed",
      attempt: { status: "queued", promptId: "repair-prompt-1" },
    });
    expect(resumed.pairs[0]).toMatchObject({
      status: "repaired",
      mask: { provenance: "structured-diagnosis" },
      attempt: { status: "stored", promptId: "repair-prompt-1" },
    });
    expect(mocks.completeChat).toHaveBeenCalledTimes(1);
    expect(mocks.queuePrompt).toHaveBeenCalledTimes(1);
    expect(mocks.getHistory).toHaveBeenCalledTimes(2);
    expect(mocks.storeGeneratedImage).toHaveBeenCalledTimes(2);
  });

  it("closes an uncertain SAM2 queue outcome and never submits a second SAM2 or Repair queue", async () => {
    const item = await candidate("preview-1", 1);
    const execution: ComfyUiExecutionTimelineResult = {
      completed: true,
      finalCount: 1,
      finals: [item.final],
      request: { checkpointName: "local.safetensors", positivePrompt: "private prompt" },
      warnings: [],
    };
    const review: FinalReviewTimelineResult = { reviewVersion: 1, status: "reviewed", pairs: [item.review] };
    const executionContext = context("sam2-outcome-unknown");
    mocks.completeChat.mockResolvedValueOnce({
      content: JSON.stringify({
        repairTarget: { cardinality: "single", locality: "localized", regionCount: 1 },
        mask: { coordinateUnit: "normalized", shapes: [{
          type: "rect", x: 0.4, y: 0.4, width: 0.1, height: 0.1,
        }] },
        adjustments: { growMaskBy: 2 },
      }),
    });
    mocks.validateSam2MaskRequest.mockImplementation((request: unknown) => ({ ok: true, request }));
    mocks.validateSam2MaskRequestAgainstObjectInfo
      .mockImplementation((request: unknown) => ({ errors: [], request, warnings: [] }));
    mocks.buildSam2MaskWorkflow.mockReturnValue({
      workflow: { "9": { class_type: "SaveImage", inputs: {} } },
      outputNodeId: "9",
    });
    mocks.queuePrompt.mockRejectedValueOnce(new Error("connection lost after SAM2 queue request"));

    const interrupted = await repairFinalExecution(execution, review, executionContext);
    const resumed = await repairFinalExecution(execution, review, executionContext);

    expect(interrupted.pairs[0]).toMatchObject({
      status: "failed",
      error: {
        code: "comfyui_execution_failed",
        details: { recoverable: false, stage: "sam2-outcome" },
      },
    });
    expect(resumed.pairs[0]).toMatchObject({
      status: "failed",
      error: {
        code: "comfyui_execution_failed",
        details: { recoverable: false, stage: "sam2-outcome" },
      },
    });
    expect(interrupted.pairs[0]?.retryStage).toBeUndefined();
    expect(resumed.pairs[0]?.retryStage).toBeUndefined();
    expect(mocks.completeChat).toHaveBeenCalledTimes(1);
    expect(mocks.queuePrompt).toHaveBeenCalledTimes(1);
    expect(mocks.getHistory).not.toHaveBeenCalled();
  });

  it.each(["queued", "output-ready"] as const)(
    "resumes a durable SAM2 %s checkpoint without a second SAM2 queue",
    async (status) => {
      const fixture = await diskCheckpointFixture(`sam2-${status}-resume`);
      const diagnosis = {
        shapes: [{ type: "rect" as const, x: 0.4, y: 0.4, width: 0.1, height: 0.1 }],
        growMaskBy: 2,
      };
      const maskPng = await sharp({
        create: { width: 64, height: 64, channels: 3, background: "#000000" },
      }).composite([{
        input: { create: { width: 8, height: 8, channels: 3, background: "#ffffff" } },
        left: 26,
        top: 26,
      }]).png().toBuffer();
      await writeDiskCheckpoint(fixture.attemptId, {
        version: 3,
        attemptId: fixture.attemptId,
        baseRequestDigest: fixture.checkpoint.baseRequestDigest,
        parent: fixture.parent,
        diagnosisState: "completed",
        diagnosis,
        sam2Attempt: {
          attemptId: fixture.attemptId,
          status,
          promptId: "sam2-prompt-1",
          outputNodeId: "9",
          ...(status === "output-ready"
            ? { sourceImage: { filename: "sam2-mask.png", nodeId: "9", type: "output" } }
            : {}),
        },
      });
      mocks.validateSam2MaskRequest.mockImplementation((request: unknown) => ({ ok: true, request }));
      mocks.validateSam2MaskRequestAgainstObjectInfo
        .mockImplementation((request: unknown) => ({ errors: [], request, warnings: [] }));
      mocks.buildSam2MaskWorkflow.mockReturnValue({
        workflow: { "9": { class_type: "SaveImage", inputs: {} } },
        outputNodeId: "9",
      });
      vi.mocked(fetch).mockResolvedValueOnce(new Response(new Uint8Array(maskPng), {
        status: 200,
        headers: { "content-type": "image/png" },
      }));

      const result = await repairFinalExecution(
        fixture.execution,
        fixture.review,
        fixture.executionContext,
      );

      expect(result.pairs[0]).toMatchObject({
        status: "repaired",
        mask: { provenance: "sam2-refinement", refinement: { status: "applied" } },
        attempt: { status: "stored" },
      });
      expect(mocks.completeChat).not.toHaveBeenCalled();
      expect(mocks.queuePrompt).toHaveBeenCalledTimes(1);
      expect(mocks.queuePrompt.mock.calls[0]?.[1]).toMatchObject({
        clientId: expect.stringContaining("-repair"),
      });
      expect(mocks.getHistory).toHaveBeenCalledTimes(status === "queued" ? 2 : 1);
      expect(mocks.storeGeneratedImage).toHaveBeenCalledTimes(2);
    },
  );

  it("writes only canonical bounded repair state to the durable checkpoint", async () => {
    const fixture = await diskCheckpointFixture("checkpoint-privacy");
    process.env.COMFYUI_API_KEY = "sk-secret-checkpoint-key";

    const result = await repairFinalExecution(
      fixture.execution,
      fixture.review,
      fixture.executionContext,
    );
    const attemptId = result.pairs[0]?.attempt?.attemptId;
    expect(attemptId).toBe(fixture.attemptId);
    const checkpointText = await fs.readFile(
      path.join(process.env.SCENEFORGE_REPAIR_ATTEMPTS_DIR!, `${fixture.attemptId.slice(7)}.json`),
      "utf8",
    );
    const checkpoint = JSON.parse(checkpointText) as Record<string, unknown>;

    expect(Object.keys(checkpoint).sort()).toEqual([
      "attempt",
      "attemptId",
      "baseRequestDigest",
      "diagnosis",
      "diagnosisState",
      "mask",
      "parent",
      "version",
    ]);
    expect(checkpointText).not.toMatch(
      /positivePrompt|private prompt|PRIVATE_RAW|rawResponse|data:image|TRANSIENT|sk-secret|sourceImageDataUrl|maskDataUrl|bytes/i,
    );
  });

  it("recovers completed ComfyUI history after storage failure without a second queue", async () => {
    const item = await candidate("preview-1", 1);
    const execution: ComfyUiExecutionTimelineResult = {
      completed: true, finalCount: 1, finals: [item.final],
      request: { checkpointName: "local.safetensors", positivePrompt: "private prompt" }, warnings: [],
    };
    const review: FinalReviewTimelineResult = { reviewVersion: 1, status: "reviewed", pairs: [item.review] };
    const executionContext = context("storage-resume");
    failRepairStorageOnQueueNumber = 1;

    const failed = await repairFinalExecution(execution, review, executionContext);
    expect(failed.pairs[0]).toMatchObject({ status: "failed", retryStage: "comfyui", attempt: { status: "output-ready" } });
    expect(mocks.queuePrompt).toHaveBeenCalledTimes(1);

    const recovered = await repairFinalExecution(execution, review, executionContext, failed);
    expect(recovered.pairs[0]).toMatchObject({ status: "repaired", attempt: { status: "stored" } });
    expect(mocks.queuePrompt).toHaveBeenCalledTimes(1);
    expect(mocks.completeChat).toHaveBeenCalledWith(expect.objectContaining({ purpose: "single-image-repair-diagnosis" }));
    expect(mocks.getObjectInfo).toHaveBeenCalledTimes(1);
    expect(mocks.uploadImage).toHaveBeenCalledTimes(2);
    expect(mocks.getHistory).toHaveBeenCalled();
    expect(mocks.storeGeneratedImage.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("uses a repair-owned path-safe output prefix instead of the parent request prefix", async () => {
    const item = await candidate("preview-1", 1);
    const execution: ComfyUiExecutionTimelineResult = {
      completed: true,
      finalCount: 1,
      finals: [item.final],
      request: {
        checkpointName: "local.safetensors",
        positivePrompt: "private prompt",
        outputPrefix: "../../PRIVATE-parent-prefix",
      },
      warnings: [],
    };

    await repairFinalExecution(
      execution,
      { reviewVersion: 1, status: "reviewed", pairs: [item.review] },
      context("safe-prefix"),
    );

    expect(mocks.buildBasicInpaintWorkflow).toHaveBeenCalled();
    for (const [request] of mocks.buildBasicInpaintWorkflow.mock.calls) {
      const repairRequest = request as { outputPrefix?: string };
      expect(repairRequest.outputPrefix).toMatch(/^sceneforge\/timeline-repair-[a-f0-9]+$/);
      expect(repairRequest.outputPrefix).not.toContain("..");
      expect(repairRequest.outputPrefix).not.toContain("PRIVATE");
    }
  });

  it("resumes the returned queued workflow attempt when its matching disk checkpoint is still queue-started", async () => {
    const item = await candidate("preview-1", 1);
    const execution: ComfyUiExecutionTimelineResult = {
      completed: true,
      finalCount: 1,
      finals: [item.final],
      request: { checkpointName: "local.safetensors", positivePrompt: "private prompt" },
      warnings: [],
    };
    const review: FinalReviewTimelineResult = { reviewVersion: 1, status: "reviewed", pairs: [item.review] };
    const executionContext = context("queue-checkpoint-crash");
    const actualWriteFile = fs.writeFile.bind(fs);
    const checkpointWrite = vi.spyOn(fs, "writeFile").mockImplementation(async (filename, data, options) => {
      if (String(filename).includes(path.join(temporaryRoot, "attempts")) &&
          checkpointAttemptStatus(data) === "queued") {
        throw new Error(unsafeUpstreamText);
      }
      return actualWriteFile(filename, data, options);
    });

    const interrupted = await repairFinalExecution(execution, review, executionContext);
    expect(interrupted.pairs[0]).toMatchObject({
      status: "failed",
      retryStage: "comfyui",
      attempt: { status: "queued", promptId: "repair-prompt-1" },
      error: {
        code: "comfyui_execution_failed",
        details: { recoverable: true, stage: "checkpoint-write" },
      },
    });
    expect(JSON.stringify(interrupted)).not.toContain("PRIVATE");
    expect(JSON.stringify(interrupted)).not.toContain("data:image");
    expect(JSON.stringify(interrupted)).not.toContain("sk-secret");
    expect(mocks.queuePrompt).toHaveBeenCalledTimes(1);

    checkpointWrite.mockRestore();
    const recovered = await repairFinalExecution(execution, review, executionContext, interrupted);

    expect(recovered.pairs[0]).toMatchObject({ status: "repaired", attempt: { status: "stored" } });
    expect(mocks.queuePrompt).toHaveBeenCalledTimes(1);
  });

  it("resumes the returned output-ready workflow attempt when its matching disk checkpoint is still queued", async () => {
    const item = await candidate("preview-1", 1);
    const execution: ComfyUiExecutionTimelineResult = {
      completed: true,
      finalCount: 1,
      finals: [item.final],
      request: { checkpointName: "local.safetensors", positivePrompt: "private prompt" },
      warnings: [],
    };
    const review: FinalReviewTimelineResult = { reviewVersion: 1, status: "reviewed", pairs: [item.review] };
    const executionContext = context("output-checkpoint-crash");
    const actualWriteFile = fs.writeFile.bind(fs);
    const checkpointWrite = vi.spyOn(fs, "writeFile").mockImplementation(async (filename, data, options) => {
      if (String(filename).includes(path.join(temporaryRoot, "attempts")) &&
          checkpointAttemptStatus(data) === "output-ready") {
        throw new Error("simulated process loss before output-ready checkpoint commit");
      }
      return actualWriteFile(filename, data, options);
    });

    const interrupted = await repairFinalExecution(execution, review, executionContext);
    expect(interrupted.pairs[0]).toMatchObject({
      status: "failed",
      retryStage: "comfyui",
      attempt: { status: "output-ready", promptId: "repair-prompt-1" },
    });
    expect(mocks.queuePrompt).toHaveBeenCalledTimes(1);

    checkpointWrite.mockRestore();
    const recovered = await repairFinalExecution(execution, review, executionContext, interrupted);

    expect(recovered.pairs[0]).toMatchObject({ status: "repaired", attempt: { status: "stored" } });
    expect(mocks.queuePrompt).toHaveBeenCalledTimes(1);
  });

  it("resumes the returned stored workflow attempt when its matching disk checkpoint is still output-ready", async () => {
    const item = await candidate("preview-1", 1);
    const execution: ComfyUiExecutionTimelineResult = {
      completed: true,
      finalCount: 1,
      finals: [item.final],
      request: { checkpointName: "local.safetensors", positivePrompt: "private prompt" },
      warnings: [],
    };
    const review: FinalReviewTimelineResult = { reviewVersion: 1, status: "reviewed", pairs: [item.review] };
    const executionContext = context("stored-checkpoint-crash");
    const actualWriteFile = fs.writeFile.bind(fs);
    const checkpointWrite = vi.spyOn(fs, "writeFile").mockImplementation(async (filename, data, options) => {
      if (String(filename).includes(path.join(temporaryRoot, "attempts")) &&
          checkpointAttemptStatus(data) === "stored") {
        throw new Error("simulated process loss before stored checkpoint commit");
      }
      return actualWriteFile(filename, data, options);
    });

    const interrupted = await repairFinalExecution(execution, review, executionContext);
    expect(interrupted.pairs[0]).toMatchObject({
      status: "failed",
      retryStage: "comfyui",
      attempt: { status: "stored", promptId: "repair-prompt-1" },
    });
    expect(mocks.queuePrompt).toHaveBeenCalledTimes(1);

    checkpointWrite.mockRestore();
    const recovered = await repairFinalExecution(execution, review, executionContext, interrupted);

    expect(recovered.pairs[0]).toMatchObject({ status: "repaired", attempt: { status: "stored" } });
    expect(mocks.queuePrompt).toHaveBeenCalledTimes(1);
    expect(mocks.getHistory).toHaveBeenCalledTimes(1);
  });

  it("does not advance queue-started from a mismatched workflow attempt", async () => {
    const item = await candidate("preview-1", 1);
    const execution: ComfyUiExecutionTimelineResult = {
      completed: true,
      finalCount: 1,
      finals: [item.final],
      request: { checkpointName: "local.safetensors", positivePrompt: "private prompt" },
      warnings: [],
    };
    const review: FinalReviewTimelineResult = { reviewVersion: 1, status: "reviewed", pairs: [item.review] };
    const executionContext = context("mismatched-workflow-attempt");
    const actualWriteFile = fs.writeFile.bind(fs);
    const checkpointWrite = vi.spyOn(fs, "writeFile").mockImplementation(async (filename, data, options) => {
      if (String(filename).includes(path.join(temporaryRoot, "attempts")) &&
          checkpointAttemptStatus(data) === "queued") {
        throw new Error("simulated queued checkpoint loss");
      }
      return actualWriteFile(filename, data, options);
    });
    const interrupted = await repairFinalExecution(execution, review, executionContext);
    checkpointWrite.mockRestore();
    const pair = interrupted.pairs[0]!;
    const mismatched = {
      ...interrupted,
      pairs: [{ ...pair, attempt: { ...pair.attempt!, outputNodeId: "different-output" } }],
    };

    const result = await repairFinalExecution(execution, review, executionContext, mismatched);

    expect(result.pairs[0]).toMatchObject({
      status: "failed",
      skipReason: "repair-failed",
      error: {
        code: "timeline_request_invalid",
        message: expect.stringContaining("identity did not match"),
        details: { recoverable: false, stage: "attempt-identity" },
      },
    });
    expect(result.pairs[0]?.retryStage).toBeUndefined();
    expect(mocks.queuePrompt).toHaveBeenCalledTimes(1);
    expect(mocks.getHistory).not.toHaveBeenCalled();
  });

  it("rejects a newer workflow attempt whose prompt identity mismatches the queued disk checkpoint", async () => {
    const item = await candidate("preview-1", 1);
    const execution: ComfyUiExecutionTimelineResult = {
      completed: true,
      finalCount: 1,
      finals: [item.final],
      request: { checkpointName: "local.safetensors", positivePrompt: "private prompt" },
      warnings: [],
    };
    const review: FinalReviewTimelineResult = { reviewVersion: 1, status: "reviewed", pairs: [item.review] };
    const executionContext = context("mismatched-prompt-attempt");
    const actualWriteFile = fs.writeFile.bind(fs);
    const checkpointWrite = vi.spyOn(fs, "writeFile").mockImplementation(async (filename, data, options) => {
      if (String(filename).includes(path.join(temporaryRoot, "attempts")) &&
          checkpointAttemptStatus(data) === "output-ready") {
        throw new Error("simulated output-ready checkpoint loss");
      }
      return actualWriteFile(filename, data, options);
    });
    const interrupted = await repairFinalExecution(execution, review, executionContext);
    checkpointWrite.mockRestore();
    const pair = interrupted.pairs[0]!;
    const mismatched = {
      ...interrupted,
      pairs: [{ ...pair, attempt: { ...pair.attempt!, promptId: "different-prompt" } }],
    };

    const recovered = await repairFinalExecution(execution, review, executionContext, mismatched);

    expect(recovered.pairs[0]).toMatchObject({
      status: "repaired",
      attempt: { status: "stored", promptId: "repair-prompt-1" },
    });
    expect(mocks.queuePrompt).toHaveBeenCalledTimes(1);
    expect(mocks.getHistory).toHaveBeenLastCalledWith("repair-prompt-1");
  });

  it("closes an uncertain ComfyUI queue outcome instead of exposing an automatic retry", async () => {
    const item = await candidate("preview-1", 1);
    const execution: ComfyUiExecutionTimelineResult = {
      completed: true,
      finalCount: 1,
      finals: [item.final],
      request: { checkpointName: "local.safetensors", positivePrompt: "private prompt" },
      warnings: [],
    };
    const review: FinalReviewTimelineResult = { reviewVersion: 1, status: "reviewed", pairs: [item.review] };
    const executionContext = context("queue-outcome-unknown");
    mocks.queuePrompt.mockRejectedValueOnce(new Error("connection closed before queue response"));

    const result = await repairFinalExecution(execution, review, executionContext);

    expect(result.pairs[0]).toMatchObject({
      status: "failed",
      skipReason: "queue-outcome-unknown",
      attempt: { status: "queue-started" },
      error: { message: expect.stringContaining("Manual recovery is required") },
    });
    expect(result.pairs[0]?.retryStage).toBeUndefined();
    const repeated = await repairFinalExecution(execution, review, executionContext, result);
    expect(repeated.pairs[0]).toMatchObject({ skipReason: "queue-outcome-unknown" });
    expect(mocks.queuePrompt).toHaveBeenCalledTimes(1);
  });

  it("preserves a completed first pair while resuming an interrupted second pair", async () => {
    const first = await candidate("preview-1", 1);
    const second = await candidate("preview-2", 2);
    const execution: ComfyUiExecutionTimelineResult = {
      completed: true, finalCount: 2, finals: [first.final, second.final],
      request: { checkpointName: "local.safetensors", positivePrompt: "private prompt" }, warnings: [],
    };
    const review: FinalReviewTimelineResult = { reviewVersion: 1, status: "reviewed", pairs: [first.review, second.review] };
    const executionContext = context("multi-resume");
    failRepairStorageOnQueueNumber = 2;

    const partial = await repairFinalExecution(execution, review, executionContext);
    expect(partial.pairs.map((pair) => pair.status)).toEqual(["repaired", "failed"]);
    const resumed = await repairFinalExecution(execution, review, executionContext, partial);
    expect(resumed.pairs.map((pair) => pair.status)).toEqual(["repaired", "repaired"]);
    expect(resumed.pairs[0]).toBe(partial.pairs[0]);
    expect(mocks.queuePrompt).toHaveBeenCalledTimes(2);
  });

  it("fails closed when the same candidate/rank/seed points at a changed parent Final", async () => {
    const original = await candidate("preview-1", 1);
    const executionContext = context("parent-change");
    const execution: ComfyUiExecutionTimelineResult = {
      completed: true, finalCount: 1, finals: [original.final],
      request: { checkpointName: "local.safetensors", positivePrompt: "private prompt" }, warnings: [],
    };
    const review: FinalReviewTimelineResult = { reviewVersion: 1, status: "reviewed", pairs: [original.review] };
    const completed = await repairFinalExecution(execution, review, executionContext);
    const changed = await candidate("preview-1-changed", 1);
    const changedFinal = { ...changed.final, candidateId: "preview-1", seed: 10 };
    const changedReview = { ...changed.review, candidateId: "preview-1", seed: 10 };
    const result = await repairFinalExecution(
      { ...execution, finals: [changedFinal] },
      { ...review, pairs: [changedReview] },
      executionContext,
      completed,
    );
    expect(result.pairs[0]).toMatchObject({ status: "skipped", skipReason: "parent-mismatch" });
    expect(mocks.queuePrompt).toHaveBeenCalledTimes(1);
  });

  it("safely skips Krea one-shot repair when local graph preflight is incompatible without hiding Final variants", async () => {
    const item = await candidate("preview-1", 1);
    const execution: ComfyUiExecutionTimelineResult = {
      completed: true,
      finalCount: 1,
      finals: [item.final],
      request: {
        cfg: 1,
        checkpointName: "krea-2-turbo-unet.safetensors",
        height: 64,
        modelBaseModel: "Krea 2",
        modelStorageKind: "diffusion",
        positivePrompt: "private Krea repair",
        krea2StyleReferenceDescriptor: {
          version: 1,
          referenceDigest: `sha256:${"a".repeat(64)}`,
          loraName: "krea2_style_reference.safetensors",
          weight: 0.45,
          startPercent: 0,
          endPercent: 1,
        },
        krea2ReId: { imageName: "transient-reid.png" },
        krea2ReIdDescriptor: {
          version: 1,
          referenceDigest: `sha256:${"b".repeat(64)}`,
          loraName: "krea2_reid_rank32.safetensors",
          strengthModel: 1,
          kvCache: true,
          imageCount: 1,
        },
        faceDetailer: { enabled: true, detectorModelName: "bbox/face_yolov8s.pt" },
        handDetailer: { enabled: false, detectorModelName: "bbox/hand_yolov8s.pt" },
        samplerName: "euler",
        scheduler: "simple",
        steps: 8,
        width: 64,
        workflowProfile: "krea2",
      },
      warnings: [],
    };
    mocks.validateComfyUiInpaintRequest.mockReturnValueOnce({
      message: "Krea graph is unavailable.",
      ok: false,
    });

    const result = await repairFinalExecution(
      execution,
      { reviewVersion: 1, status: "reviewed", pairs: [item.review] },
      context("krea-preflight-unavailable"),
    );

    expect(result).toMatchObject({
      authorized: true,
      pairs: [{
        candidateId: "preview-1",
        skipReason: "comfyui-unavailable",
        status: "skipped",
      }],
    });
    expect(mocks.completeChat).not.toHaveBeenCalled();
    expect(mocks.queuePrompt).not.toHaveBeenCalled();
    expect(mocks.uploadImage).not.toHaveBeenCalled();
  });

  it.each([
    [
      "the nearest-exact mask resize option",
      "ImageScaleBy nearest-exact upscale method is not available in ComfyUI. It is required for high-res inpaint masks.",
    ],
    ["the KSampler seed input", "KSampler.seed input is not available in ComfyUI object_info."],
    ["the KSampler steps input", "KSampler.steps input is not available in ComfyUI object_info."],
    ["the KSampler cfg input", "KSampler.cfg input is not available in ComfyUI object_info."],
    ["the KSampler denoise input", "KSampler.denoise input is not available in ComfyUI object_info."],
  ])("fails closed before diagnosis, uploads, or queueing when preflight lacks %s", async (_label, error) => {
    const item = await candidate("preview-1", 1);
    const execution: ComfyUiExecutionTimelineResult = {
      completed: true,
      finalCount: 1,
      finals: [item.final],
      request: {
        cfg: 1,
        checkpointName: "krea-2-turbo-unet.safetensors",
        height: 64,
        modelBaseModel: "Krea 2",
        modelStorageKind: "diffusion",
        positivePrompt: "private Krea repair",
        samplerName: "euler",
        scheduler: "simple",
        steps: 8,
        width: 64,
        workflowProfile: "krea2",
      },
      warnings: [],
    };
    mocks.validateComfyUiInpaintRequestAgainstObjectInfo.mockImplementationOnce((request: unknown) => ({
      errors: [error],
      request,
      warnings: [],
    }));

    const result = await repairFinalExecution(
      execution,
      { reviewVersion: 1, status: "reviewed", pairs: [item.review] },
      context(`krea-preflight-${_label}`),
    );

    expect(result.pairs).toEqual([expect.objectContaining({
      candidateId: "preview-1",
      skipReason: "comfyui-unavailable",
      status: "skipped",
    })]);
    expect(mocks.completeChat).not.toHaveBeenCalled();
    expect(mocks.uploadImage).not.toHaveBeenCalled();
    expect(mocks.queuePrompt).not.toHaveBeenCalled();
    expect(mocks.buildBasicInpaintWorkflow).not.toHaveBeenCalled();
  });

  it("queues a compatible signed Krea repair once and preserves explicit variant selection on recovery", async () => {
    const item = await candidate("preview-1", 1);
    const execution: ComfyUiExecutionTimelineResult = {
      completed: true,
      finalCount: 1,
      finals: [item.final],
      request: {
        cfg: 1,
        checkpointName: "krea-2-turbo-unet.safetensors",
        height: 64,
        modelBaseModel: "Krea 2",
        modelStorageKind: "diffusion",
        positivePrompt: "private Krea repair",
        krea2StyleReferenceDescriptor: {
          version: 1,
          referenceDigest: `sha256:${"a".repeat(64)}`,
          loraName: "krea2_style_reference.safetensors",
          weight: 0.45,
          startPercent: 0,
          endPercent: 1,
        },
        krea2ReId: { imageName: "transient-reid.png" },
        krea2ReIdDescriptor: {
          version: 1,
          referenceDigest: `sha256:${"b".repeat(64)}`,
          loraName: "krea2_reid_rank32.safetensors",
          strengthModel: 1,
          kvCache: true,
          imageCount: 1,
        },
        faceDetailer: { enabled: true, detectorModelName: "bbox/face_yolov8s.pt" },
        handDetailer: { enabled: false, detectorModelName: "bbox/hand_yolov8s.pt" },
        samplerName: "euler",
        scheduler: "simple",
        steps: 8,
        width: 64,
        workflowProfile: "krea2",
      },
      warnings: [],
    };
    const review: FinalReviewTimelineResult = {
      reviewVersion: 1,
      status: "reviewed",
      pairs: [{ ...item.review, userSelectedVariant: "preview-upscale" }],
    };
    const adapterBoundDigest = deriveRepairBaseRequestDigest(execution, item.final);
    const changedAdapterDigest = deriveRepairBaseRequestDigest({
      ...execution,
      request: {
        ...execution.request,
        krea2StyleReferenceDescriptor: {
          ...execution.request.krea2StyleReferenceDescriptor!,
          weight: 0.55,
        },
      },
    }, item.final);
    const executionContext = context("krea-repair-once");
    mocks.completeChat.mockResolvedValueOnce({
      content: JSON.stringify({
        repairTarget: { cardinality: "single", locality: "localized", regionCount: 1 },
        mask: { coordinateUnit: "normalized", shapes: [{ type: "polygon", points: [
          { x: 0.4, y: 0.4 }, { x: 0.55, y: 0.4 }, { x: 0.55, y: 0.55 }, { x: 0.4, y: 0.55 },
        ] }] },
        adjustments: { growMaskBy: 2, faceDetailerEnabled: false, handDetailerEnabled: true },
      }),
    });

    const completed = await repairFinalExecution(execution, review, executionContext);
    const recovered = await repairFinalExecution(execution, review, executionContext, completed);

    expect(completed.pairs[0]).toMatchObject({
      attempt: { status: "stored" },
      requestPolicy: {
        requestLocalFaceDetailer: true,
        requestLocalHandDetailer: false,
      },
      status: "repaired",
    });
    expect(recovered.pairs[0]).toBe(completed.pairs[0]);
    expect(recovered.pairs[0]).not.toHaveProperty("userSelectedVariant");
    expect(adapterBoundDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(changedAdapterDigest).not.toBe(adapterBoundDigest);
    expect(mocks.queuePrompt).toHaveBeenCalledTimes(1);
    expect(mocks.buildBasicInpaintWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      faceDetailer: expect.objectContaining({ enabled: true }),
      handDetailer: expect.objectContaining({ enabled: false }),
      krea2StyleReferenceDescriptor: execution.request.krea2StyleReferenceDescriptor,
      workflowProfile: "krea2",
    }));
    expect(mocks.buildBasicInpaintWorkflow.mock.calls[0]?.[0]).not.toHaveProperty("krea2StyleReference");
    expect(mocks.buildBasicInpaintWorkflow.mock.calls[0]?.[0]).not.toHaveProperty("krea2ReId");
    expect(mocks.buildBasicInpaintWorkflow.mock.calls[0]?.[0]).not.toHaveProperty("krea2ReIdDescriptor");
    expect(JSON.stringify(mocks.buildBasicInpaintWorkflow.mock.calls[0]?.[0])).not.toContain(
      "krea2_reid_rank32.safetensors",
    );
    expect(execution.request).not.toHaveProperty("imageName");
  });

  it("rejects separated target declarations before object_info, uploads, or queue", async () => {
    const item = await candidate("preview-1", 1);
    mocks.completeChat.mockResolvedValueOnce({ content: JSON.stringify({
      repairTarget: { cardinality: "multiple", locality: "separated", regionCount: 2 },
      mask: { shapes: [] },
    }) });
    const result = await repairFinalExecution(
      { completed: true, finalCount: 1, finals: [item.final], request: { checkpointName: "local.safetensors", positivePrompt: "private" }, warnings: [] },
      { reviewVersion: 1, status: "reviewed", pairs: [item.review] },
      context("ambiguous"),
    );
    expect(result.pairs[0]).toMatchObject({ status: "skipped", skipReason: "ambiguous-target" });
    expect(mocks.getObjectInfo).not.toHaveBeenCalled();
    expect(mocks.uploadImage).not.toHaveBeenCalled();
    expect(mocks.queuePrompt).not.toHaveBeenCalled();
  });

  it("rejects a missing diagnosis target before object_info, uploads, or queue", async () => {
    const item = await candidate("preview-1", 1);
    mocks.completeChat.mockResolvedValueOnce({ content: JSON.stringify({
      repairTarget: { cardinality: "missing", locality: "localized", regionCount: 0 },
      mask: { shapes: [] },
    }) });
    const result = await repairFinalExecution(
      { completed: true, finalCount: 1, finals: [item.final], request: { checkpointName: "local.safetensors", positivePrompt: "private" }, warnings: [] },
      { reviewVersion: 1, status: "reviewed", pairs: [item.review] },
      context("missing"),
    );
    expect(result.pairs[0]).toMatchObject({ status: "skipped", skipReason: "missing-target" });
    expect(mocks.getObjectInfo).not.toHaveBeenCalled();
    expect(mocks.uploadImage).not.toHaveBeenCalled();
    expect(mocks.queuePrompt).not.toHaveBeenCalled();
  });
});
