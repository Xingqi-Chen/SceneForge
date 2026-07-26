import fs from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import {
  buildBasicInpaintWorkflow,
  buildSam2MaskWorkflow,
  createComfyUiClient,
  extractComfyUiHistoryImages,
  isComfyUiPromptHistoryComplete,
  validateComfyUiInpaintRequest,
  validateComfyUiInpaintRequestAgainstObjectInfo,
  validateComfyUiSam2MaskRequest,
  validateComfyUiSam2MaskRequestAgainstObjectInfo,
  type ComfyUiInpaintRequest,
  type ComfyUiSam2MaskRequest,
} from "@/features/comfyui";
import {
  getGeneratedImagePath,
  storeGeneratedImage,
} from "@/features/comfyui/generated-image-storage";
import {
  buildComfyUiInpaintDiagnosisMessages,
  parseComfyUiInpaintDiagnosisResponse,
  type ComfyUiInpaintDiagnosisConfig,
  type ComfyUiInpaintDiagnosisMaskShape,
} from "@/features/editor/ai-prompt/comfyui-inpaint-diagnosis";
import { createLiteLlmClient } from "@/features/llm";

import { createTimelineNodeError } from "./state";
import {
  createCanonicalRepairInpaintRequest,
  createRepairParentBinding,
  deriveRepairBaseRequestDigest,
  deriveRepairAttemptId,
  deriveRepairRequestDigest,
  getRepairTargets,
  repairPairHasCanonicalAttemptSource,
  repairPairMatchesReviewPair,
  sanitizeTimelineRepairDiagnosis,
  sanitizeTimelineRepairMaskMetadata,
  sanitizeTimelineRepairParentBinding,
  sanitizeTimelineRepairAttempt,
  sanitizeRepairSemanticDigest,
} from "./final-repair";
import { createStoredImageVisionDataUrl } from "./vision-image-transcode.server";
import type {
  ComfyUiExecutionTimelineResult,
  FinalRepairTimelineResult,
  FinalReviewTimelineResult,
  TimelineFinalExecutionRecord,
  TimelineNodeExecutionContext,
  TimelineRepairDiagnosis,
  TimelineRepairAttempt,
  TimelineRepairMaskMetadata,
  TimelineRepairParentBinding,
  TimelineRepairPair,
  TimelineStoredGeneratedImage,
} from "./types";

const DEFAULT_COMFYUI_BASE_URL = "http://127.0.0.1:8188";
const MAX_REPAIR_MASK_COVERAGE = 0.35;
const MAX_REPAIR_GROW_MASK_BY = 64;
const HISTORY_POLL_INTERVAL_MS = 2_000;
const HISTORY_POLL_TIMEOUT_MS = 60 * 60 * 1_000;
const REPAIR_ATTEMPT_CHECKPOINT_VERSION = 3;
const REPAIR_ATTEMPT_STATUS_RANK: Record<TimelineRepairAttempt["status"], number> = {
  "queue-started": 0,
  queued: 1,
  "output-ready": 2,
  stored: 3,
};

class RepairDiagnosisTargetError extends Error {
  constructor(readonly reason: "missing-target" | "ambiguous-target") {
    super(reason);
  }
}

class RepairAttemptExecutionError extends Error {
  constructor(readonly attempt: TimelineRepairAttempt) {
    super("Repair attempt checkpoint could not be persisted.");
  }
}

class RepairQueueOutcomeUnknownError extends Error {
  constructor(readonly attempt: TimelineRepairAttempt) {
    super("Repair queue acceptance is uncertain. Manual recovery is required before another Repair can be queued.");
  }
}

class RepairAttemptIdentityError extends Error {
  constructor() {
    super("Repair attempt identity did not match its workflow binding.");
  }
}

class RepairCheckpointReadError extends Error {
  constructor() {
    super("Repair attempt checkpoint could not be read safely.");
  }
}

class RepairCheckpointWriteError extends Error {
  constructor(readonly stage: "diagnosis" | "sam2" | "mask") {
    super("Repair preparation checkpoint could not be persisted safely.");
  }
}

class RepairPreparationOutcomeUnknownError extends Error {
  constructor(readonly stage: "diagnosis" | "sam2") {
    super("Repair preparation outcome is uncertain and remains closed.");
  }
}

class RepairManagedImageError extends Error {
  constructor(
    readonly kind: "invalid" | "read" | "store",
    readonly stage: "managed-image-read" | "mask-storage" | "repair-storage",
  ) {
    super("Managed Repair image operation failed.");
  }
}

type RepairAttemptCheckpoint = {
  version: 3;
  attemptId: string;
  baseRequestDigest: string;
  parent: TimelineRepairParentBinding;
  diagnosisState?: "started" | "completed";
  diagnosis?: TimelineRepairDiagnosis;
  sam2Attempt?: TimelineRepairAttempt;
  mask?: TimelineRepairMaskMetadata;
  attempt?: TimelineRepairAttempt;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function makeClient() {
  return createComfyUiClient({
    baseUrl: process.env.COMFYUI_BASE_URL ?? DEFAULT_COMFYUI_BASE_URL,
    apiKey: process.env.COMFYUI_API_KEY || undefined,
  });
}

function isKrea2RepairExecution(execution: ComfyUiExecutionTimelineResult) {
  return execution.request.workflowProfile === "krea2";
}

async function validateKrea2RepairCompatibility(
  execution: ComfyUiExecutionTimelineResult,
  final: TimelineFinalExecutionRecord,
) {
  const request = createCanonicalRepairInpaintRequest(
    execution,
    final,
    {
      shapes: [{
        type: "rect",
        x: Math.max(0, Math.floor((final.previewUpscale?.width ?? 0) / 2) - 8),
        y: Math.max(0, Math.floor((final.previewUpscale?.height ?? 0) / 2) - 8),
        width: 16,
        height: 16,
      }],
      denoise: 0.45,
      growMaskBy: 0,
    },
    `sha256:${"0".repeat(64)}`,
  );
  if (!request) return false;
  const validation = validateComfyUiInpaintRequest(request);
  if (!validation.ok) return false;
  try {
    const objectInfo = await makeClient().getObjectInfo();
    const objectValidation = validateComfyUiInpaintRequestAgainstObjectInfo(validation.request, objectInfo);
    if (objectValidation.errors.length) return false;
    buildBasicInpaintWorkflow(objectValidation.request);
    return true;
  } catch {
    return false;
  }
}

function getExpectedRepairOutputNodeId(
  execution: ComfyUiExecutionTimelineResult,
  final: TimelineFinalExecutionRecord,
  diagnosis: TimelineRepairDiagnosis,
  attemptId: string,
) {
  const request = createCanonicalRepairInpaintRequest(execution, final, diagnosis, attemptId);
  return request ? buildBasicInpaintWorkflow(request).outputNodeId : null;
}

function repairCheckpointPath(attemptId: string) {
  const digest = attemptId.startsWith("sha256:") ? attemptId.slice(7) : "";
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error("Repair attempt identity is invalid.");
  const configuredRoot = process.env.SCENEFORGE_REPAIR_ATTEMPTS_DIR?.trim();
  const root = configuredRoot && path.isAbsolute(configuredRoot)
    ? configuredRoot
    : path.join(process.cwd(), "data", "agent-timeline-repair-attempts");
  return path.join(root, `${digest}.json`);
}

async function writeRepairAttemptCheckpoint(checkpoint: RepairAttemptCheckpoint) {
  const filename = repairCheckpointPath(checkpoint.attemptId);
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(checkpoint), { encoding: "utf8", flag: "wx" });
  await fs.rename(temporary, filename);
}

async function checkpointRepairAttempt(
  checkpoint: RepairAttemptCheckpoint,
  attempt: TimelineRepairAttempt,
) {
  const nextCheckpoint = { ...checkpoint, attempt };
  try {
    await writeRepairAttemptCheckpoint(nextCheckpoint);
    return nextCheckpoint;
  } catch {
    throw new RepairAttemptExecutionError(attempt);
  }
}

async function checkpointRepairPreparation(
  checkpoint: RepairAttemptCheckpoint,
  stage: "diagnosis" | "sam2" | "mask",
) {
  try {
    await writeRepairAttemptCheckpoint(checkpoint);
    return checkpoint;
  } catch {
    throw new RepairCheckpointWriteError(stage);
  }
}

async function readRepairAttemptCheckpoint(
  attemptId: string,
  expectedParent: TimelineRepairParentBinding,
  expectedBaseRequestDigest: string,
): Promise<RepairAttemptCheckpoint | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(repairCheckpointPath(attemptId), "utf8")) as unknown;
    const checkpointKeys = isRecord(parsed) ? Object.keys(parsed) : [];
    const parent = isRecord(parsed)
      ? sanitizeTimelineRepairParentBinding(parsed.parent, { rejectUnknownFields: true })
      : null;
    const canonicalExpectedParent = sanitizeTimelineRepairParentBinding(expectedParent);
    const diagnosis = isRecord(parsed)
      ? sanitizeTimelineRepairDiagnosis(parsed.diagnosis, { rejectUnknownFields: true })
      : null;
    const mask = isRecord(parsed)
      ? sanitizeTimelineRepairMaskMetadata(parsed.mask, { rejectUnknownFields: true })
      : null;
    const attempt = isRecord(parsed)
      ? sanitizeTimelineRepairAttempt(parsed.attempt, { rejectUnknownFields: true })
      : null;
    const sam2Attempt = isRecord(parsed)
      ? sanitizeTimelineRepairAttempt(parsed.sam2Attempt, { rejectUnknownFields: true })
      : null;
    const diagnosisState = isRecord(parsed) &&
      (parsed.diagnosisState === "started" || parsed.diagnosisState === "completed")
      ? parsed.diagnosisState
      : undefined;
    const baseRequestDigest = isRecord(parsed)
      ? sanitizeRepairSemanticDigest(parsed.baseRequestDigest)
      : null;
    if (!isRecord(parsed) || parsed.version !== REPAIR_ATTEMPT_CHECKPOINT_VERSION || parsed.attemptId !== attemptId ||
        checkpointKeys.some((key) => ![
          "version",
          "attemptId",
          "baseRequestDigest",
          "parent",
          "diagnosisState",
          "diagnosis",
          "sam2Attempt",
          "mask",
          "attempt",
        ].includes(key)) || !baseRequestDigest || baseRequestDigest !== expectedBaseRequestDigest ||
        !parent || !canonicalExpectedParent ||
        JSON.stringify(parent) !== JSON.stringify(canonicalExpectedParent) ||
        (parsed.diagnosisState !== undefined && !diagnosisState) ||
        (diagnosisState === "completed") !== Boolean(diagnosis) ||
        (parsed.diagnosis !== undefined) !== Boolean(diagnosis) ||
        (parsed.sam2Attempt !== undefined) !== Boolean(sam2Attempt) ||
        (parsed.mask !== undefined) !== Boolean(mask) ||
        (parsed.attempt !== undefined) !== Boolean(attempt) ||
        (sam2Attempt && (sam2Attempt.attemptId !== attemptId || sam2Attempt.status === "stored" ||
          sam2Attempt.requestDigest !== undefined)) ||
        (attempt && (attempt.attemptId !== attemptId || !attempt.requestDigest)) ||
        (mask || sam2Attempt || attempt) && diagnosisState !== "completed" ||
        attempt && !mask) {
      throw new Error("Repair attempt checkpoint is invalid.");
    }
    return {
      version: 3,
      attemptId,
      baseRequestDigest,
      parent,
      ...(diagnosisState ? { diagnosisState } : {}),
      ...(diagnosis ? { diagnosis } : {}),
      ...(sam2Attempt ? { sam2Attempt } : {}),
      ...(mask ? { mask } : {}),
      ...(attempt ? { attempt } : {}),
    };
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return null;
    throw new RepairCheckpointReadError();
  }
}

function sameRepairAttemptIdentity(left: TimelineRepairAttempt, right: TimelineRepairAttempt) {
  return left.attemptId === right.attemptId && left.outputNodeId === right.outputNodeId &&
    left.requestDigest === right.requestDigest &&
    (!left.promptId || !right.promptId || left.promptId === right.promptId) &&
    (!left.sourceImage || !right.sourceImage || JSON.stringify(left.sourceImage) === JSON.stringify(right.sourceImage)) &&
    (!left.storedImage || !right.storedImage || JSON.stringify(left.storedImage) === JSON.stringify(right.storedImage));
}

function reconcileRepairAttempt(
  checkpoint: TimelineRepairAttempt | null,
  workflowAttempt: TimelineRepairAttempt | undefined,
  attemptId: string,
) {
  const matchingWorkflowAttempt = workflowAttempt?.attemptId === attemptId ? workflowAttempt : null;
  if (!checkpoint) return matchingWorkflowAttempt;
  if (!matchingWorkflowAttempt || !sameRepairAttemptIdentity(checkpoint, matchingWorkflowAttempt)) return checkpoint;
  return REPAIR_ATTEMPT_STATUS_RANK[matchingWorkflowAttempt.status] > REPAIR_ATTEMPT_STATUS_RANK[checkpoint.status]
    ? matchingWorkflowAttempt
    : checkpoint;
}

function createSafeRepairError(
  error: unknown,
  stage: "diagnosis" | "mask" | "comfyui",
) {
  if (error instanceof RepairAttemptIdentityError) {
    return createTimelineNodeError(
      "timeline_request_invalid",
      "Repair attempt identity did not match its workflow binding. This Repair remains closed.",
      { recoverable: false, stage: "attempt-identity" },
    );
  }
  if (error instanceof RepairQueueOutcomeUnknownError) {
    return createTimelineNodeError(
      "comfyui_execution_failed",
      "Repair queue acceptance is uncertain. Manual recovery is required before another Repair can be queued.",
      { recoverable: false, stage: "queue-outcome" },
    );
  }
  if (error instanceof RepairCheckpointReadError) {
    return createTimelineNodeError(
      "comfyui_execution_failed",
      "Repair checkpoint state could not be read safely. This Repair remains closed.",
      { recoverable: false, stage: "checkpoint-read" },
    );
  }
  if (error instanceof RepairCheckpointWriteError) {
    return createTimelineNodeError(
      error.stage === "diagnosis" ? "llm_upstream" : "comfyui_execution_failed",
      "Repair preparation state could not be persisted safely.",
      { recoverable: true, stage: `${error.stage}-checkpoint-write` },
    );
  }
  if (error instanceof RepairPreparationOutcomeUnknownError) {
    return createTimelineNodeError(
      error.stage === "diagnosis" ? "llm_upstream" : "comfyui_execution_failed",
      error.stage === "diagnosis"
        ? "Repair diagnosis outcome is uncertain. This one-shot Repair remains closed."
        : "SAM2 queue acceptance is uncertain. This one-shot Repair remains closed.",
      { recoverable: false, stage: `${error.stage}-outcome` },
    );
  }
  if (error instanceof RepairAttemptExecutionError) {
    return createTimelineNodeError(
      "comfyui_execution_failed",
      "Repair checkpoint state could not be persisted safely.",
      { recoverable: true, stage: "checkpoint-write" },
    );
  }
  if (error instanceof RepairManagedImageError) {
    const invalid = error.kind === "invalid";
    return createTimelineNodeError(
      invalid ? "image_storage_invalid" : "image_storage_failed",
      invalid
        ? "A managed Repair image reference was invalid. This Repair remains closed."
        : error.kind === "read"
          ? "A managed Repair image could not be read safely."
          : "A managed Repair image could not be stored safely.",
      { recoverable: !invalid, stage: error.stage },
    );
  }
  if (stage === "diagnosis") {
    return createTimelineNodeError(
      "llm_upstream",
      "Repair diagnosis could not be completed safely.",
      { recoverable: true, stage },
    );
  }
  if (stage === "mask") {
    return createTimelineNodeError(
      "image_storage_failed",
      "Repair mask preparation could not be completed safely.",
      { recoverable: true, stage },
    );
  }
  return createTimelineNodeError(
    "comfyui_execution_failed",
    "Repair execution could not be completed safely.",
    { recoverable: true, stage },
  );
}

function clampCoordinate(value: number, dimension: number) {
  return Math.max(0, Math.min(dimension, value * dimension));
}

function shapeToSvg(shape: ComfyUiInpaintDiagnosisMaskShape, width: number, height: number) {
  if (shape.type === "ellipse") {
    const cx = clampCoordinate(shape.x, width);
    const cy = clampCoordinate(shape.y, height);
    const rx = clampCoordinate(shape.radiusX, width);
    const ry = clampCoordinate(shape.radiusY, height);
    const transform = shape.rotation ? ` transform="rotate(${shape.rotation} ${cx} ${cy})"` : "";
    return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="white"${transform}/>`;
  }
  if (shape.type === "rect") {
    const rectWidth = clampCoordinate(shape.width, width);
    const rectHeight = clampCoordinate(shape.height, height);
    const x = clampCoordinate(shape.x, width);
    const y = clampCoordinate(shape.y, height);
    const transform = shape.rotation
      ? ` transform="rotate(${shape.rotation} ${x + rectWidth / 2} ${y + rectHeight / 2})"`
      : "";
    return `<rect x="${x}" y="${y}" width="${rectWidth}" height="${rectHeight}" fill="white"${transform}/>`;
  }
  const points = shape.points.map((point) =>
    `${clampCoordinate(point.x, width)},${clampCoordinate(point.y, height)}`).join(" ");
  if (shape.type === "polygon") return `<polygon points="${points}" fill="white"/>`;
  const brushSize = Math.max(1, Math.min(64, shape.brushSize ?? 24));
  return `<polyline points="${points}" fill="none" stroke="white" stroke-width="${brushSize}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

export function getSam2RefinementPrompt(
  shapes: ComfyUiInpaintDiagnosisMaskShape[],
  width: number,
  height: number,
): Pick<ComfyUiSam2MaskRequest, "positivePoints" | "bbox"> | null {
  if (shapes.length !== 1) return null;
  const shape = shapes[0];
  if (shape.type === "rect" && !shape.rotation) {
    const x = clampCoordinate(shape.x, width);
    const y = clampCoordinate(shape.y, height);
    const boxWidth = clampCoordinate(shape.width, width);
    const boxHeight = clampCoordinate(shape.height, height);
    if (boxWidth <= 0 || boxHeight <= 0) return null;
    return { bbox: { x, y, width: boxWidth, height: boxHeight } };
  }
  if (shape.type === "ellipse" && !shape.rotation) {
    const centerX = clampCoordinate(shape.x, width);
    const centerY = clampCoordinate(shape.y, height);
    const radiusX = clampCoordinate(shape.radiusX, width);
    const radiusY = clampCoordinate(shape.radiusY, height);
    if (radiusX <= 0 || radiusY <= 0) return null;
    return {
      positivePoints: [{ x: centerX, y: centerY }],
      bbox: {
        x: Math.max(0, centerX - radiusX),
        y: Math.max(0, centerY - radiusY),
        width: Math.min(width, centerX + radiusX) - Math.max(0, centerX - radiusX),
        height: Math.min(height, centerY + radiusY) - Math.max(0, centerY - radiusY),
      },
    };
  }
  return null;
}

export async function validateAndGrowRasterRepairMask(
  bytes: Buffer,
  width: number,
  height: number,
  growMaskBy: number,
) {
  const metadata = await sharp(bytes).metadata();
  if (metadata.width !== width || metadata.height !== height) throw new Error("mask-dimensions-invalid");
  const raster = await sharp(bytes).greyscale().threshold(128).raw().toBuffer();
  const coverageBeforeGrowth = raster.reduce((count, value) => count + (value > 0 ? 1 : 0), 0) / (width * height);
  if (coverageBeforeGrowth <= 0) throw new Error("mask-empty");
  if (coverageBeforeGrowth > MAX_REPAIR_MASK_COVERAGE) throw new Error("mask-oversized");
  const clampedGrow = Math.min(MAX_REPAIR_GROW_MASK_BY, Math.max(0, Math.round(growMaskBy)));
  const basePng = await sharp(raster, { raw: { width, height, channels: 1 } }).png().toBuffer();
  const grownPng = clampedGrow > 0
    ? await sharp(basePng).blur(Math.max(0.3, clampedGrow / 2)).threshold(1).png().toBuffer()
    : basePng;
  const grown = await sharp(grownPng).greyscale().raw().toBuffer();
  const coverageAfterGrowth = grown.reduce((count, value) => count + (value > 0 ? 1 : 0), 0) / (width * height);
  if (coverageAfterGrowth > MAX_REPAIR_MASK_COVERAGE) throw new Error("mask-growth-oversized");
  return {
    coverageBeforeGrowth: Number(coverageBeforeGrowth.toFixed(6)),
    coverageAfterGrowth: Number(coverageAfterGrowth.toFixed(6)),
    growMaskBy: clampedGrow,
    png: grownPng,
  };
}

export async function renderValidatedRepairMask(
  shapes: ComfyUiInpaintDiagnosisMaskShape[],
  width: number,
  height: number,
  growMaskBy: number,
) {
  if (!shapes.length) throw new Error("mask-empty");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="black"/>${shapes.map((shape) => shapeToSvg(shape, width, height)).join("")}</svg>`;
  return validateAndGrowRasterRepairMask(await sharp(Buffer.from(svg)).png().toBuffer(), width, height, growMaskBy);
}

async function storedImageDataUrl(stored: TimelineStoredGeneratedImage) {
  const bytes = await storedImageBytes(stored);
  return `data:${stored.contentType};base64,${bytes.toString("base64")}`;
}

async function storedImageBytes(stored: TimelineStoredGeneratedImage) {
  const filename = getGeneratedImagePath(stored.filename);
  if (!filename) throw new RepairManagedImageError("invalid", "managed-image-read");
  try {
    const bytes = await fs.readFile(filename);
    if (bytes.byteLength !== stored.byteLength) {
      throw new RepairManagedImageError("invalid", "managed-image-read");
    }
    return bytes;
  } catch (error) {
    if (error instanceof RepairManagedImageError) throw error;
    throw new RepairManagedImageError("read", "managed-image-read");
  }
}

async function storeRepairManagedImage(
  bytes: Uint8Array,
  contentType: string | null,
  stage: "mask-storage" | "repair-storage",
) {
  try {
    return await storeGeneratedImage(bytes, contentType);
  } catch {
    throw new RepairManagedImageError("store", stage);
  }
}

function buildDiagnosisConfig(final: TimelineFinalExecutionRecord, execution: ComfyUiExecutionTimelineResult) {
  const request = execution.request;
  const width = final.previewUpscale?.width;
  const height = final.previewUpscale?.height;
  if (!width || !height || !final.storedImage) throw new Error("Final dimensions or image are missing.");
  return {
    brushSize: 24,
    checkpointBaseModel: request.modelBaseModel,
    checkpointName: request.checkpointName,
    denoise: 0.45,
    faceDetailerEnabled: request.faceDetailer?.enabled === true,
    growMaskBy: 16,
    handDetailerEnabled: request.handDetailer?.enabled === true,
    image: { filename: final.storedImage.filename, height, seed: final.seed, width },
    loras: (request.loras ?? []).map((lora) => ({
      enabled: true,
      loraName: lora.loraName,
      strengthClip: lora.strengthClip ?? lora.strengthModel ?? 1,
      strengthModel: lora.strengthModel ?? 1,
    })),
    mode: "latent-noise-mask" as const,
    negativePrompt: request.negativePrompt ?? "",
    positivePrompt: request.positivePrompt,
  } satisfies ComfyUiInpaintDiagnosisConfig;
}

function validateRepairTargetContract(content: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.trim());
  } catch {
    throw new Error("diagnosis-invalid");
  }
  const target = isRecord(parsed) && isRecord(parsed.repairTarget) ? parsed.repairTarget : null;
  if (!target) throw new RepairDiagnosisTargetError("missing-target");
  const cardinalities = ["single", "missing", "ambiguous", "multiple"];
  const localities = ["localized", "separated", "global"];
  if (!cardinalities.includes(String(target.cardinality)) || !localities.includes(String(target.locality)) ||
      !Number.isInteger(target.regionCount) || Number(target.regionCount) < 0) throw new Error("diagnosis-invalid");
  if (target.cardinality === "missing" || target.regionCount === 0) throw new RepairDiagnosisTargetError("missing-target");
  if (target.cardinality !== "single" || target.locality !== "localized" || target.regionCount !== 1) {
    throw new RepairDiagnosisTargetError("ambiguous-target");
  }
}

async function diagnoseRepair(
  final: TimelineFinalExecutionRecord,
  execution: ComfyUiExecutionTimelineResult,
  pair: TimelineRepairPair,
  context: TimelineNodeExecutionContext,
): Promise<TimelineRepairDiagnosis> {
  const sceneInput = context.workflow.nodes["scene-input"].result;
  const nsfw = isRecord(sceneInput) && sceneInput.nsfw === true;
  const model = nsfw ? process.env.LITELLM_NSFW_MODEL : process.env.LITELLM_VISION_MODEL || process.env.LITELLM_DEFAULT_MODEL;
  const baseUrl = process.env.LITELLM_BASE_URL?.trim();
  if (!model || !baseUrl || !final.storedImage) throw new Error("Repair diagnosis model is not configured.");
  const config = buildDiagnosisConfig(final, execution);
  const client = createLiteLlmClient({ baseUrl, apiKey: process.env.LITELLM_API_KEY, defaultModel: model });
  const messages = buildComfyUiInpaintDiagnosisMessages({
    config,
    imageDataUrl: await createStoredImageVisionDataUrl(final.storedImage, `${pair.candidateId}:final`, "repair-diagnosis"),
    userInput: `Repair only these localized reviewed defects: ${pair.targets.map((target) => `${target.operation}: ${target.description}`).join("; ")}. Do not alter pose, composition, identity, outfit, camera, framing, or global style. If the findings do not share one naturally localized region, declare them multiple/separated and return no mask.`,
  });
  messages.push({
    role: "system",
    content: "For this bounded automatic repair, the JSON must also include repairTarget: {cardinality: single|missing|ambiguous|multiple, locality: localized|separated|global, regionCount: non-negative integer}. Use single/localized/1 only for exactly one natural local region. Never collapse separated defects into one mask.",
  });
  const response = await client.completeChat({
    model,
    purpose: "single-image-repair-diagnosis",
    nsfw,
    messages,
    temperature: 0,
    maxTokens: 2_000,
  });
  validateRepairTargetContract(response.content);
  const parsed = parseComfyUiInpaintDiagnosisResponse(response.content, config);
  if (!parsed || parsed.mask.shapes.length !== 1) throw new Error("diagnosis-invalid");
  return {
    shapes: parsed.mask.shapes,
    denoise: parsed.adjustments.denoise,
    growMaskBy: Math.min(MAX_REPAIR_GROW_MASK_BY, parsed.adjustments.growMaskBy ?? config.growMaskBy),
    faceDetailerEnabled: parsed.adjustments.faceDetailerEnabled,
    handDetailerEnabled: parsed.adjustments.handDetailerEnabled,
  };
}

async function waitForComfyUiImageReference(
  client: ReturnType<typeof makeClient>,
  promptId: string,
  outputNodeId: string,
  label: string,
) {
  const deadline = Date.now() + HISTORY_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const history = await client.getHistory(promptId);
    const image = extractComfyUiHistoryImages(history, promptId).find((candidate) => candidate.nodeId === outputNodeId);
    if (image) return image;
    if (isComfyUiPromptHistoryComplete(history, promptId)) throw new Error(`ComfyUI ${label} completed without the expected output image.`);
    await delay(HISTORY_POLL_INTERVAL_MS);
  }
  throw new Error(`Timed out waiting for ComfyUI ${label} output.`);
}

async function fetchComfyUiImage(
  client: ReturnType<typeof makeClient>,
  sourceImage: NonNullable<TimelineRepairAttempt["sourceImage"]>,
  label: string,
) {
  const response = await fetch(client.buildViewUrl(sourceImage), {
    cache: "no-store",
    headers: {
      accept: "image/*",
      ...(process.env.COMFYUI_API_KEY ? { authorization: `Bearer ${process.env.COMFYUI_API_KEY}` } : {}),
    },
  });
  if (!response.ok) throw new Error(`ComfyUI ${label} image could not be read.`);
  return {
    sourceImage,
    bytes: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type"),
  };
}

async function waitForComfyUiImage(client: ReturnType<typeof makeClient>, promptId: string, outputNodeId: string, label: string) {
  return fetchComfyUiImage(
    client,
    await waitForComfyUiImageReference(client, promptId, outputNodeId, label),
    label,
  );
}

async function trySam2Refinement(
  final: TimelineFinalExecutionRecord,
  diagnosis: TimelineRepairDiagnosis,
  initialCheckpoint: RepairAttemptCheckpoint,
) {
  const attemptId = initialCheckpoint.attemptId;
  let checkpoint = initialCheckpoint;
  if (!final.storedImage || !final.previewUpscale) {
    return { status: "skipped" as const, reason: "sam2-unavailable" as const, checkpoint };
  }
  const width = final.previewUpscale.width;
  const height = final.previewUpscale.height;
  const prompt = getSam2RefinementPrompt(
    diagnosis.shapes as ComfyUiInpaintDiagnosisMaskShape[],
    width,
    height,
  );
  if (!prompt) return { status: "not-applicable" as const, reason: "no-clear-target" as const, checkpoint };

  try {
    const safeAttemptSuffix = attemptId.slice(7, 31);
    const request: ComfyUiSam2MaskRequest = {
      imageName: "sceneforge-sam2-compatibility-check.png",
      imageWidth: width,
      imageHeight: height,
      ...prompt,
      outputPrefix: `sceneforge/timeline-repair-sam2-${attemptId.slice(7, 23)}`,
    };
    const validation = validateComfyUiSam2MaskRequest(request);
    if (!validation.ok) return { status: "skipped" as const, reason: "sam2-invalid" as const, checkpoint };
    const expectedWorkflow = buildSam2MaskWorkflow(validation.request);
    let sam2Attempt = checkpoint.sam2Attempt;
    if (sam2Attempt && sam2Attempt.outputNodeId !== expectedWorkflow.outputNodeId) {
      throw new RepairAttemptIdentityError();
    }
    if (sam2Attempt?.status === "queue-started") {
      throw new RepairPreparationOutcomeUnknownError("sam2");
    }
    const client = makeClient();
    if (!sam2Attempt) {
      const objectValidation = validateComfyUiSam2MaskRequestAgainstObjectInfo(
        validation.request,
        await client.getObjectInfo(),
      );
      if (objectValidation.errors.length) {
        return { status: "skipped" as const, reason: "sam2-unavailable" as const, checkpoint };
      }
      const sourceBytes = await storedImageBytes(final.storedImage);
      const sourceMetadata = await sharp(sourceBytes).metadata();
      if (sourceMetadata.width !== width || sourceMetadata.height !== height) {
        return { status: "skipped" as const, reason: "sam2-invalid" as const, checkpoint };
      }
      const uploaded = await client.uploadImage({
        filename: `sceneforge-repair-sam2-source-${safeAttemptSuffix}.png`,
        bytes: await sharp(sourceBytes).png().toBuffer(),
        mimeType: "image/png",
        overwrite: true,
        type: "input",
      });
      const workflow = buildSam2MaskWorkflow({ ...objectValidation.request, imageName: uploaded.imageName });
      if (workflow.outputNodeId !== expectedWorkflow.outputNodeId) throw new RepairAttemptIdentityError();
      sam2Attempt = {
        attemptId,
        status: "queue-started",
        outputNodeId: workflow.outputNodeId,
      };
      checkpoint = await checkpointRepairPreparation(
        { ...checkpoint, sam2Attempt },
        "sam2",
      );
      let queued;
      try {
        queued = await client.queuePrompt(workflow.workflow, {
          clientId: `timeline-${safeAttemptSuffix}-sam2`,
        });
      } catch {
        throw new RepairPreparationOutcomeUnknownError("sam2");
      }
      sam2Attempt = {
        attemptId,
        status: "queued",
        promptId: queued.promptId,
        outputNodeId: workflow.outputNodeId,
      };
      checkpoint = await checkpointRepairPreparation(
        { ...checkpoint, sam2Attempt },
        "sam2",
      );
    }
    if (!sam2Attempt.promptId) throw new RepairPreparationOutcomeUnknownError("sam2");
    if (sam2Attempt.status === "queued") {
      const sourceImage = await waitForComfyUiImageReference(
        client,
        sam2Attempt.promptId,
        sam2Attempt.outputNodeId,
        "SAM2 mask",
      );
      sam2Attempt = { ...sam2Attempt, status: "output-ready", sourceImage };
      checkpoint = await checkpointRepairPreparation(
        { ...checkpoint, sam2Attempt },
        "sam2",
      );
    }
    if (!sam2Attempt.sourceImage || sam2Attempt.sourceImage.nodeId !== sam2Attempt.outputNodeId) {
      throw new RepairAttemptIdentityError();
    }
    const output = await fetchComfyUiImage(client, sam2Attempt.sourceImage, "SAM2 mask");
    try {
      const mask = await validateAndGrowRasterRepairMask(output.bytes, width, height, diagnosis.growMaskBy);
      return { status: "applied" as const, mask, checkpoint };
    } catch {
      return { status: "skipped" as const, reason: "sam2-invalid" as const, checkpoint };
    }
  } catch (error) {
    if (error instanceof RepairPreparationOutcomeUnknownError ||
        error instanceof RepairCheckpointWriteError ||
        error instanceof RepairAttemptIdentityError) throw error;
    return { status: "skipped" as const, reason: "sam2-unavailable" as const, checkpoint };
  }
}

async function executeRepair(
  final: TimelineFinalExecutionRecord,
  execution: ComfyUiExecutionTimelineResult,
  diagnosis: TimelineRepairDiagnosis,
  maskDataUrl: string,
  checkpoint: RepairAttemptCheckpoint,
  previousAttempt?: TimelineRepairAttempt,
) {
  const { attemptId } = checkpoint;
  if (!final.storedImage || !final.previewUpscale) throw new Error("Final source image is unavailable.");
  if (previousAttempt && previousAttempt.attemptId !== attemptId) throw new RepairAttemptIdentityError();
  const canonicalPreviousAttempt = previousAttempt
    ? sanitizeTimelineRepairAttempt(previousAttempt)
    : undefined;
  if (previousAttempt && !canonicalPreviousAttempt) throw new RepairAttemptIdentityError();
  const expectedOutputNodeId = getExpectedRepairOutputNodeId(execution, final, diagnosis, attemptId);
  const expectedRequestDigest = deriveRepairRequestDigest(execution, final, diagnosis, attemptId);
  if (!expectedOutputNodeId ||
      !expectedRequestDigest ||
      checkpoint.attempt && checkpoint.attempt.outputNodeId !== expectedOutputNodeId ||
      checkpoint.attempt && checkpoint.attempt.requestDigest !== expectedRequestDigest ||
      canonicalPreviousAttempt && canonicalPreviousAttempt.outputNodeId !== expectedOutputNodeId ||
      canonicalPreviousAttempt && canonicalPreviousAttempt.requestDigest !== expectedRequestDigest) {
    throw new RepairAttemptIdentityError();
  }
  const client = makeClient();
  let attempt = reconcileRepairAttempt(
    checkpoint.attempt ?? null,
    canonicalPreviousAttempt ?? undefined,
    attemptId,
  );
  if (attempt?.status === "queue-started") throw new RepairQueueOutcomeUnknownError(attempt);
  if (attempt?.status === "stored" && attempt.storedImage && attempt.sourceImage) {
    await storedImageBytes(attempt.storedImage);
    return { attempt, sourceImage: attempt.sourceImage, storedImage: attempt.storedImage, promptId: attempt.promptId };
  }
  if (!attempt) {
    const canonicalRequest = createCanonicalRepairInpaintRequest(execution, final, diagnosis, attemptId);
    if (!canonicalRequest) throw new RepairAttemptIdentityError();
    const request: ComfyUiInpaintRequest = {
      ...canonicalRequest,
      imageName: undefined,
      maskName: undefined,
      sourceImageDataUrl: await storedImageDataUrl(final.storedImage),
      maskDataUrl,
    };
    const validation = validateComfyUiInpaintRequest(request);
    if (!validation.ok) throw new Error(validation.message);
    const objectInfo = await client.getObjectInfo();
    const objectValidation = validateComfyUiInpaintRequestAgainstObjectInfo(validation.request, objectInfo);
    if (objectValidation.errors.length) throw new Error(objectValidation.errors.join(" "));
    const sourceBytes = await sharp(Buffer.from((objectValidation.request.sourceImageDataUrl!.split(",")[1] ?? ""), "base64")).png().toBuffer();
    const maskBytes = Buffer.from((maskDataUrl.split(",")[1] ?? ""), "base64");
    const suffix = attemptId.slice(7, 31);
    const [sourceUpload, maskUpload] = await Promise.all([
      client.uploadImage({ filename: `sceneforge-repair-source-${suffix}.png`, bytes: sourceBytes, mimeType: "image/png", overwrite: true, type: "input" }),
      client.uploadImage({ filename: `sceneforge-repair-mask-${suffix}.png`, bytes: maskBytes, mimeType: "image/png", overwrite: true, type: "input" }),
    ]);
    const uploaded = {
      ...objectValidation.request,
      sourceImageDataUrl: undefined,
      imageName: sourceUpload.imageName,
      maskDataUrl: undefined,
      maskName: maskUpload.imageName,
    };
    const uploadedObjectValidation = validateComfyUiInpaintRequestAgainstObjectInfo(uploaded, objectInfo);
    if (uploadedObjectValidation.errors.length) throw new Error(uploadedObjectValidation.errors.join(" "));
    const workflow = buildBasicInpaintWorkflow(uploadedObjectValidation.request);
    if (workflow.outputNodeId !== expectedOutputNodeId) throw new RepairAttemptIdentityError();
    const queueStarted: TimelineRepairAttempt = {
      attemptId,
      status: "queue-started",
      outputNodeId: workflow.outputNodeId,
      requestDigest: expectedRequestDigest,
    };
    try {
      await writeRepairAttemptCheckpoint({ ...checkpoint, attempt: queueStarted });
    } catch {
      throw new RepairQueueOutcomeUnknownError(queueStarted);
    }
    checkpoint = { ...checkpoint, attempt: queueStarted };
    let queued;
    try {
      queued = await client.queuePrompt(workflow.workflow, { clientId: `timeline-${suffix}-repair` });
    } catch {
      throw new RepairQueueOutcomeUnknownError(queueStarted);
    }
    attempt = {
      attemptId,
      status: "queued",
      promptId: queued.promptId,
      outputNodeId: workflow.outputNodeId,
      requestDigest: expectedRequestDigest,
    };
    checkpoint = await checkpointRepairAttempt(checkpoint, attempt);
  }
  if (!attempt.promptId) throw new RepairQueueOutcomeUnknownError(attempt);
  const image = await waitForComfyUiImage(client, attempt.promptId, attempt.outputNodeId, "repair");
  attempt = { ...attempt, status: "output-ready", sourceImage: image.sourceImage };
  checkpoint = await checkpointRepairAttempt(checkpoint, attempt);
  const storedImage = await storeRepairManagedImage(image.bytes, image.contentType, "repair-storage");
  attempt = { ...attempt, status: "stored", storedImage };
  await checkpointRepairAttempt(checkpoint, attempt);
  return { attempt, sourceImage: image.sourceImage, storedImage, promptId: attempt.promptId };
}

export async function repairFinalExecution(
  execution: ComfyUiExecutionTimelineResult,
  review: FinalReviewTimelineResult,
  context: TimelineNodeExecutionContext,
  previous?: FinalRepairTimelineResult | null,
): Promise<FinalRepairTimelineResult> {
  const gate = context.workflow.nodes["generation-gate"].result;
  const authorized = isRecord(gate) && gate.confirmed === true && gate.automaticLocalRepairAuthorized === true;
  const previousByCandidate = new Map((previous?.pairs ?? []).map((pair) => [pair.candidateId, pair]));
  const krea2RequiresNewQueue = isKrea2RepairExecution(execution) && authorized && review.status === "reviewed" &&
    execution.finals.some((final) => getRepairTargets(review, final.candidateId).length > 0 &&
      !previousByCandidate.get(final.candidateId)?.attempt);
  const krea2RepairCompatible = !krea2RequiresNewQueue || await validateKrea2RepairCompatibility(
    execution,
    execution.finals.find((final) => getRepairTargets(review, final.candidateId).length > 0)!,
  );
  const pairs: TimelineRepairPair[] = [];
  for (const final of [...execution.finals].sort((left, right) => left.rank - right.rank)) {
    const targets = getRepairTargets(review, final.candidateId);
    const reviewPair = review.pairs.find((pair) => pair.candidateId === final.candidateId);
    const previousPair = previousByCandidate.get(final.candidateId);
    const base = { candidateId: final.candidateId, rank: final.rank, seed: final.seed, targets };
    if (!authorized) {
      pairs.push({ ...base, status: "skipped", skipReason: "repair-disabled" });
      continue;
    }
    if (!targets.length || review.status !== "reviewed") {
      pairs.push({ ...base, status: "skipped", skipReason: "no-supported-finding" });
      continue;
    }
    if (!krea2RepairCompatible && !previousPair?.attempt) {
      pairs.push({ ...base, status: "skipped", skipReason: "comfyui-unavailable" });
      continue;
    }
    if (!reviewPair) {
      pairs.push({ ...base, status: "skipped", skipReason: "parent-mismatch" });
      continue;
    }
    const parent = createRepairParentBinding(
      final,
      reviewPair,
      targets,
      context.workflow.nodes["final-review"].updatedAt,
    );
    if (!parent || previousPair && !repairPairMatchesReviewPair(
      previousPair,
      reviewPair,
      context.workflow.nodes["final-review"].updatedAt,
    )) {
      pairs.push({ ...base, status: "skipped", skipReason: "parent-mismatch" });
      continue;
    }
    const boundBase = { ...base, parent };
    const baseRequestDigest = deriveRepairBaseRequestDigest(execution, final);
    if (!baseRequestDigest) {
      pairs.push({
        ...boundBase,
        status: "failed",
        skipReason: "repair-failed",
        error: createSafeRepairError(new RepairAttemptIdentityError(), "comfyui"),
      });
      continue;
    }
    const attemptId = deriveRepairAttemptId(
      context.workflow.workflowId,
      final.candidateId,
      parent,
      baseRequestDigest,
    );
    if (previousPair?.attempt && previousPair.attempt.attemptId !== attemptId) {
      pairs.push({
        ...boundBase,
        status: "failed",
        skipReason: "repair-failed",
        error: createSafeRepairError(new RepairAttemptIdentityError(), "comfyui"),
      });
      continue;
    }
    if (previousPair?.status === "repaired" &&
        (!previousPair.attempt || !repairPairHasCanonicalAttemptSource(previousPair))) {
      pairs.push({
        ...boundBase,
        status: "failed",
        skipReason: "repair-failed",
        error: createSafeRepairError(new RepairAttemptIdentityError(), "comfyui"),
      });
      continue;
    }
    let checkpoint: RepairAttemptCheckpoint | null = null;
    let diagnosis = previousPair?.diagnosis
      ? sanitizeTimelineRepairDiagnosis(previousPair.diagnosis)
      : undefined;
    let preparedMask: { metadata: TimelineRepairMaskMetadata; png: Buffer } | undefined;
    let attempt = previousPair?.attempt;
    try {
      checkpoint = await readRepairAttemptCheckpoint(attemptId, parent, baseRequestDigest) ?? {
        version: 3,
        attemptId,
        baseRequestDigest,
        parent,
      };
      if (checkpoint.diagnosis && diagnosis &&
          JSON.stringify(checkpoint.diagnosis) !== JSON.stringify(diagnosis)) {
        throw new RepairAttemptIdentityError();
      }
      diagnosis = checkpoint.diagnosis ?? diagnosis;
      if (checkpoint.diagnosisState === "started" && !diagnosis) {
        throw new RepairPreparationOutcomeUnknownError("diagnosis");
      }
      if (!diagnosis) {
        checkpoint = await checkpointRepairPreparation(
          { ...checkpoint, diagnosisState: "started" },
          "diagnosis",
        );
        const diagnosed = await diagnoseRepair(
          final,
          execution,
          { ...boundBase, status: "failed" },
          context,
        );
        diagnosis = sanitizeTimelineRepairDiagnosis(diagnosed, { rejectUnknownFields: true }) ?? undefined;
        if (!diagnosis) throw new RepairAttemptIdentityError();
        checkpoint = await checkpointRepairPreparation(
          { ...checkpoint, diagnosisState: "completed", diagnosis },
          "diagnosis",
        );
      } else if (checkpoint.diagnosisState !== "completed") {
        checkpoint = await checkpointRepairPreparation(
          { ...checkpoint, diagnosisState: "completed", diagnosis },
          "diagnosis",
        );
      }
      const expectedOutputNodeId = getExpectedRepairOutputNodeId(execution, final, diagnosis, attemptId);
      const expectedRequestDigest = deriveRepairRequestDigest(execution, final, diagnosis, attemptId);
      if (!expectedOutputNodeId ||
          !expectedRequestDigest ||
          checkpoint.attempt && checkpoint.attempt.outputNodeId !== expectedOutputNodeId ||
          checkpoint.attempt && checkpoint.attempt.requestDigest !== expectedRequestDigest ||
          attempt && attempt.outputNodeId !== expectedOutputNodeId ||
          attempt && attempt.requestDigest !== expectedRequestDigest) {
        throw new RepairAttemptIdentityError();
      }
      if (previousPair?.status === "repaired" && previousPair.storedImage &&
          repairPairHasCanonicalAttemptSource(previousPair)) {
        pairs.push(previousPair);
        continue;
      }
      try {
        const width = final.previewUpscale!.width;
        const height = final.previewUpscale!.height;
        const previousMask = previousPair?.mask
          ? sanitizeTimelineRepairMaskMetadata(previousPair.mask)
          : null;
        if (checkpoint.mask && previousMask &&
            JSON.stringify(checkpoint.mask) !== JSON.stringify(previousMask)) {
          throw new RepairAttemptIdentityError();
        }
        const reusableMask = checkpoint.mask ?? previousMask;
        if (reusableMask?.storedImage) {
          if (reusableMask.width !== width || reusableMask.height !== height) {
            throw new RepairAttemptIdentityError();
          }
          const png = await storedImageBytes(reusableMask.storedImage);
          await validateAndGrowRasterRepairMask(png, width, height, 0);
          preparedMask = { metadata: reusableMask, png };
          if (!checkpoint.mask) {
            checkpoint = await checkpointRepairPreparation(
              { ...checkpoint, mask: reusableMask },
              "mask",
            );
          }
        } else {
          const structured = await renderValidatedRepairMask(
            diagnosis.shapes as ComfyUiInpaintDiagnosisMaskShape[],
            width,
            height,
            0,
          );
          const refinement = await trySam2Refinement(final, diagnosis, checkpoint);
          checkpoint = refinement.checkpoint;
          const mask = refinement.status === "applied"
            ? refinement.mask
            : await validateAndGrowRasterRepairMask(structured.png, width, height, diagnosis.growMaskBy);
          const storedMask = await storeRepairManagedImage(mask.png, "image/png", "mask-storage");
          preparedMask = {
            png: mask.png,
            metadata: {
              provenance: refinement.status === "applied" ? "sam2-refinement" : "structured-diagnosis",
              refinement: refinement.status === "applied"
                ? { status: "applied" }
                : { status: refinement.status, reason: refinement.reason },
              coverageBeforeGrowth: mask.coverageBeforeGrowth,
              coverageAfterGrowth: mask.coverageAfterGrowth,
              growMaskBy: mask.growMaskBy,
              width,
              height,
              storedImage: storedMask,
            },
          };
          checkpoint = await checkpointRepairPreparation(
            { ...checkpoint, mask: preparedMask.metadata },
            "mask",
          );
        }
      } catch (error) {
        if (error instanceof RepairManagedImageError ||
            error instanceof RepairCheckpointWriteError ||
            error instanceof RepairPreparationOutcomeUnknownError ||
            error instanceof RepairAttemptIdentityError) throw error;
        const reason = error instanceof Error ? error.message : "diagnosis-invalid";
        const skipReason = reason === "mask-empty" || reason === "mask-oversized" || reason === "mask-growth-oversized"
          ? reason
          : "diagnosis-invalid";
        pairs.push({ ...boundBase, diagnosis, status: "skipped", skipReason });
        continue;
      }
      const result = await executeRepair(
        final,
        execution,
        diagnosis,
        `data:image/png;base64,${preparedMask.png.toString("base64")}`,
        checkpoint,
        attempt,
      );
      attempt = result.attempt;
      pairs.push({
        ...boundBase,
        diagnosis,
        attempt,
        status: "repaired",
        promptId: result.promptId,
        sourceImage: result.sourceImage,
        storedImage: result.storedImage,
        mask: preparedMask.metadata,
        requestPolicy: {
          version: 1,
          sourceVariant: "final",
          requestLocalFaceDetailer: isKrea2RepairExecution(execution)
            ? execution.request.faceDetailer?.enabled ?? false
            : diagnosis.faceDetailerEnabled ?? execution.request.faceDetailer?.enabled ?? false,
          requestLocalHandDetailer: isKrea2RepairExecution(execution)
            ? execution.request.handDetailer?.enabled ?? false
            : diagnosis.handDetailerEnabled ?? execution.request.handDetailer?.enabled ?? false,
        },
      });
    } catch (error) {
      if (error instanceof RepairDiagnosisTargetError) {
        pairs.push({ ...boundBase, status: "skipped", skipReason: error.reason });
        continue;
      }
      if (error instanceof RepairAttemptExecutionError || error instanceof RepairQueueOutcomeUnknownError) attempt = error.attempt;
      try {
        const recoveredCheckpoint = await readRepairAttemptCheckpoint(attemptId, parent, baseRequestDigest);
        if (recoveredCheckpoint) checkpoint = recoveredCheckpoint;
        attempt ??= recoveredCheckpoint?.attempt;
      } catch {
        // The actionable failure below remains fail-closed; never queue again without a valid checkpoint.
      }
      const queueOutcomeUnknownAttempt = attempt?.status === "queue-started" ? attempt : null;
      const identityInvalid = error instanceof RepairAttemptIdentityError;
      const preparationOutcomeUnknown = error instanceof RepairPreparationOutcomeUnknownError;
      pairs.push({
        ...boundBase,
        ...(diagnosis ? { diagnosis } : {}),
        ...(preparedMask ? { mask: preparedMask.metadata } : {}),
        ...(attempt ? { attempt } : {}),
        status: "failed",
        ...(!queueOutcomeUnknownAttempt && !identityInvalid && !preparationOutcomeUnknown
          ? { retryStage: preparedMask ? "comfyui" as const : diagnosis ? "mask" as const : "diagnosis" as const }
          : {}),
        skipReason: queueOutcomeUnknownAttempt ? "queue-outcome-unknown" : "repair-failed",
        error: createSafeRepairError(
          queueOutcomeUnknownAttempt ? new RepairQueueOutcomeUnknownError(queueOutcomeUnknownAttempt) : error,
          preparedMask ? "comfyui" : diagnosis ? "mask" : "diagnosis",
        ),
      });
    }
  }
  return { repairVersion: 1, authorized, completed: true, pairs };
}
