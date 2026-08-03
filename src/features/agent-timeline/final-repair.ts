import {
  normalizeComfyUiViewImageReference,
  normalizeStoredGeneratedImageReference,
} from "@/features/comfyui/generated-image-reference";
import {
  validateComfyUiInpaintRequest,
  validateComfyUiTextToImageRequest,
} from "@/features/comfyui/validation";
import { buildBasicInpaintWorkflow } from "@/features/comfyui/workflow";
import type { ComfyUiInpaintRequest } from "@/features/comfyui/types";

import {
  previewScoringRubric,
  timelineFinalReviewOperations,
  timelineFinalReviewScopes,
  timelineFinalReviewSeverities,
  type ComfyUiExecutionTimelineResult,
  type FinalRepairTimelineResult,
  type FinalReviewTimelineResult,
  type RepairVerificationTimelineResult,
  type TimelineFinalReviewFinding,
  type TimelineFinalReviewScores,
  type TimelineFinalExecutionRecord,
  type TimelineFinalReviewPair,
  type TimelineRepairParentBinding,
  type TimelineRepairPair,
  type TimelineRepairAttempt,
  type TimelineRepairDiagnosis,
  type TimelineRepairMaskMetadata,
  type TimelineRepairVerificationPair,
  type TimelineRepairTarget,
  type TimelineWorkflowState,
} from "./types";
import { isRunVisualStyle, type RunVisualStyle } from "./run-visual-style";
import { getRunSceneInputSettings } from "./run-input-settings";

const scoreFields = ["adherence", "composition", "anatomy", "style", "technical"] as const;
const sha256RoundConstants = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

export const repairQueueOutcomeUnknownGuidance =
  "SceneForge cannot determine whether ComfyUI accepted this one-shot Repair. Do not retry it. Check the ComfyUI queue and history first; if the outcome cannot be proven, leave this Repair closed and keep using the preserved Preview or Final.";

export type RepairManualRecoveryReason = "diagnosis-outcome" | "sam2-outcome" | "queue-outcome";

export type RepairManualRecoveryState = {
  reason: RepairManualRecoveryReason;
  label: string;
  title: string;
  guidance: string;
};

const repairManualRecoveryStates: Record<RepairManualRecoveryReason, RepairManualRecoveryState> = {
  "diagnosis-outcome": {
    reason: "diagnosis-outcome",
    label: "diagnosis outcome unknown",
    title: "Repair diagnosis outcome is uncertain and this attempt remains closed.",
    guidance:
      "SceneForge cannot determine whether this one-shot Repair diagnosis completed. Do not retry it. Inspect the server checkpoint manually; if the outcome cannot be proven, leave this Repair closed and keep using the preserved Preview or Final.",
  },
  "sam2-outcome": {
    reason: "sam2-outcome",
    label: "SAM2 queue outcome unknown",
    title: "SAM2 queue acceptance is uncertain and this attempt remains closed.",
    guidance:
      "SceneForge cannot determine whether ComfyUI accepted this one-shot SAM2 mask request. Do not retry it. Check the ComfyUI queue and history first; if the outcome cannot be proven, leave this Repair closed and keep using the preserved Preview or Final.",
  },
  "queue-outcome": {
    reason: "queue-outcome",
    label: "queue outcome unknown",
    title: "Repair queue outcome is unknown and this attempt is closed.",
    guidance: repairQueueOutcomeUnknownGuidance,
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function safeRepairIdentifier(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value) ? value : null;
}

export function sanitizeRepairSemanticDigest(value: unknown) {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value) ? value : null;
}

function stableCanonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableCanonicalValue);
  }
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableCanonicalValue(entry)]),
  );
}

const recursiveRepairTransportFields = new Set([
  "clientId",
  "client_id",
  "krea2StyleReference",
  "maskDataUrl",
  "outputPrefix",
  "promptId",
  "prompt_id",
  "sourceImageDataUrl",
]);

const rootRepairTransportFields = new Set([
  "imageName",
  "maskName",
  "sourceImage",
]);

function projectRepairSemanticValue(value: unknown, depth = 0): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => projectRepairSemanticValue(entry, depth + 1));
  }
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, entry]) =>
        entry !== undefined &&
        !recursiveRepairTransportFields.has(key) &&
        !(depth === 0 && rootRepairTransportFields.has(key)))
      .map(([key, entry]) => [key, projectRepairSemanticValue(entry, depth + 1)]),
  );
}

function createRepairFormalSemanticRequest(
  formal: ComfyUiExecutionTimelineResult["request"],
) {
  const repairSemantic = { ...formal };
  delete repairSemantic.krea2StyleReference;
  delete repairSemantic.krea2ReId;
  delete repairSemantic.krea2ReIdDescriptor;
  return repairSemantic;
}

export function digestTimelineSemanticValue(value: unknown) {
  return `sha256:${sha256Hex(JSON.stringify(stableCanonicalValue(value)))}`;
}

export function sanitizeTimelineRepairAttempt(
  value: unknown,
  options: { rejectUnknownFields?: boolean } = {},
): TimelineRepairAttempt | null {
  if (!isRecord(value) || options.rejectUnknownFields && !hasOnlyKeys(value, [
    "attemptId",
    "status",
    "promptId",
    "outputNodeId",
    "requestDigest",
    "sourceImage",
    "storedImage",
  ])) return null;
  if (typeof value.attemptId !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value.attemptId) ||
      !["queue-started", "queued", "output-ready", "stored"].includes(String(value.status))) return null;
  const outputNodeId = safeRepairIdentifier(value.outputNodeId);
  const requestDigest = value.requestDigest === undefined
    ? null
    : sanitizeRepairSemanticDigest(value.requestDigest);
  if (!outputNodeId || value.requestDigest !== undefined && !requestDigest) return null;
  const status = value.status as TimelineRepairAttempt["status"];
  const promptId = value.promptId === undefined ? null : safeRepairIdentifier(value.promptId);
  if ((status === "queue-started" && value.promptId !== undefined) ||
      (status !== "queue-started" && !promptId)) return null;

  const sourceRecord = value.sourceImage;
  const sourceImage = sourceRecord === undefined
    ? null
    : isRecord(sourceRecord) &&
        (!options.rejectUnknownFields ||
          hasOnlyKeys(sourceRecord, ["filename", "subfolder", "type", "nodeId"])) &&
        safeRepairIdentifier(sourceRecord.nodeId)
      ? normalizeComfyUiViewImageReference(sourceRecord)
      : null;
  if (sourceRecord !== undefined && !sourceImage) return null;

  const storedRecord = value.storedImage;
  const storedImage = storedRecord === undefined
    ? null
    : isRecord(storedRecord) &&
        (!options.rejectUnknownFields ||
          hasOnlyKeys(storedRecord, ["byteLength", "contentType", "filename", "url"]))
      ? normalizeStoredGeneratedImageReference(storedRecord)
      : null;
  if (storedRecord !== undefined && !storedImage) return null;

  const requiresSource = status === "output-ready" || status === "stored";
  if (requiresSource !== Boolean(sourceImage) || (status === "stored") !== Boolean(storedImage) ||
      sourceImage && isRecord(sourceRecord) && sourceRecord.nodeId !== outputNodeId) return null;
  return {
    attemptId: value.attemptId,
    status,
    ...(promptId ? { promptId } : {}),
    outputNodeId,
    ...(requestDigest ? { requestDigest } : {}),
    ...(sourceImage ? { sourceImage: { ...sourceImage, nodeId: sourceRecord && isRecord(sourceRecord)
      ? sourceRecord.nodeId as string
      : outputNodeId } } : {}),
    ...(storedImage ? { storedImage } : {}),
  };
}

export function deriveRepairBaseRequestDigest(
  execution: ComfyUiExecutionTimelineResult,
  final: TimelineFinalExecutionRecord,
) {
  if (!final.previewUpscale) return null;
  const validation = validateComfyUiTextToImageRequest(
    createRepairFormalSemanticRequest(execution.request),
  );
  if (!validation.ok) return null;
  const semanticRequest = projectRepairSemanticValue(validation.request);
  return digestTimelineSemanticValue({
    version: 1,
    request: {
      ...(isRecord(semanticRequest) ? semanticRequest : {}),
      width: final.previewUpscale.width,
      height: final.previewUpscale.height,
      seed: final.seed,
    },
    referenceContext: execution.referenceContext ?? null,
  });
}

export function createCanonicalRepairInpaintRequest(
  execution: ComfyUiExecutionTimelineResult,
  final: TimelineFinalExecutionRecord,
  diagnosis: TimelineRepairDiagnosis,
  attemptId: string,
): ComfyUiInpaintRequest | null {
  if (!final.previewUpscale) return null;
  const suffix = attemptId.slice(7, 31);
  const formal = execution.request;
  const formalSemantic = createRepairFormalSemanticRequest(formal);
  const isKrea2 = formal.workflowProfile === "krea2";
  const krea2LocalRegion = formal.workflowProfile === "krea2"
    ? getKrea2RepairLocalRegion(diagnosis, final.previewUpscale.width, final.previewUpscale.height)
    : null;
  if (formal.workflowProfile === "krea2" && !krea2LocalRegion) return null;
  return {
    ...formalSemantic,
    outputPrefix: `sceneforge/timeline-repair-${suffix}`,
    imageName: `sceneforge-repair-source-${suffix}.png`,
    maskName: `sceneforge-repair-mask-${suffix}.png`,
    imageWidth: final.previewUpscale.width,
    imageHeight: final.previewUpscale.height,
    seed: final.seed,
    denoise: diagnosis.denoise ?? 0.45,
    growMaskBy: 0,
    inpaintMode: "latent-noise-mask",
    faceDetailer: {
      ...formal.faceDetailer,
      enabled: isKrea2
        ? formal.faceDetailer?.enabled ?? false
        : diagnosis.faceDetailerEnabled ?? formal.faceDetailer?.enabled ?? false,
    },
    handDetailer: {
      ...formal.handDetailer,
      enabled: isKrea2
        ? formal.handDetailer?.enabled ?? false
        : diagnosis.handDetailerEnabled ?? formal.handDetailer?.enabled ?? false,
    },
    upscaleBeforeInpaint: {
      enabled: true,
      mode: "lanczos",
      scaleBy: 2,
      strategy: "local-region",
      localRegion: krea2LocalRegion ?? { source: "mask-bounds", padding: 32, feather: 16 },
    },
    preview: false,
  };
}

function getKrea2RepairLocalRegion(
  diagnosis: TimelineRepairDiagnosis,
  imageWidth: number,
  imageHeight: number,
) {
  if (!Number.isSafeInteger(imageWidth) || !Number.isSafeInteger(imageHeight) || imageWidth < 16 || imageHeight < 16) {
    return null;
  }
  const points = diagnosis.shapes.flatMap((shape) => {
    switch (shape.type) {
      case "ellipse": {
        const rotation = ((shape.rotation ?? 0) * Math.PI) / 180;
        const radiusX = Math.sqrt(
          (shape.radiusX * Math.cos(rotation)) ** 2 + (shape.radiusY * Math.sin(rotation)) ** 2,
        );
        const radiusY = Math.sqrt(
          (shape.radiusX * Math.sin(rotation)) ** 2 + (shape.radiusY * Math.cos(rotation)) ** 2,
        );
        return [
          { x: shape.x - radiusX, y: shape.y - radiusY },
          { x: shape.x + radiusX, y: shape.y + radiusY },
        ];
      }
      case "rect": {
        const rotation = ((shape.rotation ?? 0) * Math.PI) / 180;
        const centerX = shape.x + shape.width / 2;
        const centerY = shape.y + shape.height / 2;
        return [-1, 1].flatMap((horizontal) => [-1, 1].map((vertical) => {
          const x = horizontal * shape.width / 2;
          const y = vertical * shape.height / 2;
          return {
            x: centerX + x * Math.cos(rotation) - y * Math.sin(rotation),
            y: centerY + x * Math.sin(rotation) + y * Math.cos(rotation),
          };
        }));
      }
      case "polygon":
        return shape.points;
      case "stroke": {
        const radius = (shape.brushSize ?? 1) / 2;
        return shape.points.flatMap((point) => [
          { x: point.x - radius, y: point.y - radius },
          { x: point.x + radius, y: point.y + radius },
        ]);
      }
    }
  }).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (points.length < 2) return null;

  const padding = 32;
  const boundsX = alignKrea2RepairCrop(
    Math.max(0, Math.floor(Math.min(...points.map((point) => point.x)) - padding)),
    Math.min(imageWidth, Math.ceil(Math.max(...points.map((point) => point.x)) + padding)),
    imageWidth,
  );
  const boundsY = alignKrea2RepairCrop(
    Math.max(0, Math.floor(Math.min(...points.map((point) => point.y)) - padding)),
    Math.min(imageHeight, Math.ceil(Math.max(...points.map((point) => point.y)) + padding)),
    imageHeight,
  );
  if (!boundsX || !boundsY) return null;
  const { start: minX, end: maxX } = boundsX;
  const { start: minY, end: maxY } = boundsY;
  const width = maxX - minX;
  const height = maxY - minY;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) return null;
  return {
    source: "mask-bounds" as const,
    x: minX,
    y: minY,
    width,
    height,
    padding,
    feather: 16,
  };
}

function alignKrea2RepairCrop(start: number, end: number, maximum: number) {
  const initialSize = end - start;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || !Number.isSafeInteger(maximum) ||
      initialSize < 1 || end > maximum || maximum < 16 || maximum % 16 !== 0) return null;
  const targetSize = Math.min(maximum, Math.ceil(initialSize / 8) * 8);
  const extra = targetSize - initialSize;
  const before = Math.min(start, Math.floor(extra / 2));
  const after = extra - before;
  const expandedStart = start - before;
  const expandedEnd = Math.min(maximum, end + after);
  const correctedStart = expandedEnd - expandedStart === targetSize
    ? expandedStart
    : Math.max(0, maximum - targetSize);
  return { start: correctedStart, end: correctedStart + targetSize };
}

export function deriveRepairOutputNodeId(
  execution: ComfyUiExecutionTimelineResult,
  final: TimelineFinalExecutionRecord,
  diagnosis: TimelineRepairDiagnosis,
  attemptId: string,
) {
  const request = createCanonicalRepairInpaintRequest(execution, final, diagnosis, attemptId);
  return request ? buildBasicInpaintWorkflow(request).outputNodeId : null;
}

export function deriveRepairRequestDigest(
  execution: ComfyUiExecutionTimelineResult,
  final: TimelineFinalExecutionRecord,
  diagnosis: TimelineRepairDiagnosis,
  attemptId: string,
) {
  const request = createCanonicalRepairInpaintRequest(execution, final, diagnosis, attemptId);
  if (!request) return null;
  const validation = validateComfyUiInpaintRequest(request);
  if (!validation.ok) return null;
  const semanticRequest = projectRepairSemanticValue(validation.request);
  return digestTimelineSemanticValue({
    version: 1,
    request: semanticRequest,
    referenceContext: execution.referenceContext ?? null,
  });
}

export function sanitizeTimelineRepairParentBinding(
  value: unknown,
  options: { rejectUnknownFields?: boolean } = {},
): TimelineRepairParentBinding | null {
  if (!isRecord(value) || options.rejectUnknownFields && !hasOnlyKeys(value, [
    "finalStoredImage",
    "reviewUpdatedAt",
    "reviewedFindings",
    "reviewedTargets",
    "visualStyle",
  ])) return null;
  const storedRecord = value.finalStoredImage;
  const finalStoredImage = isRecord(storedRecord) &&
      (!options.rejectUnknownFields ||
        hasOnlyKeys(storedRecord, ["byteLength", "contentType", "filename", "url"]))
    ? normalizeStoredGeneratedImageReference(storedRecord)
    : null;
  if (!finalStoredImage || typeof value.reviewUpdatedAt !== "string" ||
      !Number.isFinite(Date.parse(value.reviewUpdatedAt)) ||
      !Array.isArray(value.reviewedFindings) || !Array.isArray(value.reviewedTargets)) return null;

  const reviewedFindings = value.reviewedFindings.map((entry) => {
    if (!isRecord(entry) || options.rejectUnknownFields && !hasOnlyKeys(entry, [
      "operation",
      "severity",
      "scope",
      "introducedByFinal",
      "description",
    ]) || !timelineFinalReviewOperations.includes(entry.operation as never) ||
        !timelineFinalReviewSeverities.includes(entry.severity as never) ||
        !timelineFinalReviewScopes.includes(entry.scope as never) ||
        typeof entry.introducedByFinal !== "boolean" ||
        typeof entry.description !== "string" || !entry.description.trim()) return null;
    return {
      operation: entry.operation as TimelineFinalReviewFinding["operation"],
      severity: entry.severity as TimelineFinalReviewFinding["severity"],
      scope: entry.scope as TimelineFinalReviewFinding["scope"],
      introducedByFinal: entry.introducedByFinal,
      description: entry.description.trim().slice(0, 500),
    };
  });
  if (reviewedFindings.length !== timelineFinalReviewOperations.length ||
      reviewedFindings.some((finding) => !finding) ||
      new Set(reviewedFindings.map((finding) => finding?.operation)).size !==
        timelineFinalReviewOperations.length) return null;

  const reviewedTargets = value.reviewedTargets.map((entry) => {
    if (!isRecord(entry) || options.rejectUnknownFields && !hasOnlyKeys(entry, [
      "operation",
      "severity",
      "description",
    ]) || (entry.operation !== "contact" && entry.operation !== "object-count") ||
        (entry.severity !== "major" && entry.severity !== "blocking") ||
        typeof entry.description !== "string" || !entry.description.trim()) return null;
    return {
      operation: entry.operation,
      severity: entry.severity,
      description: entry.description.trim().slice(0, 500),
    };
  });
  if (reviewedTargets.length > 2 || reviewedTargets.some((target) => !target)) return null;
  return {
    finalStoredImage,
    reviewUpdatedAt: value.reviewUpdatedAt,
    reviewedFindings: reviewedFindings as TimelineFinalReviewFinding[],
    reviewedTargets: reviewedTargets as TimelineRepairTarget[],
    ...(isRunVisualStyle(value.visualStyle) ? { visualStyle: value.visualStyle } : {}),
  };
}

export function sanitizeTimelineRepairDiagnosis(
  value: unknown,
  options: { rejectUnknownFields?: boolean } = {},
): TimelineRepairDiagnosis | null {
  if (!isRecord(value) || options.rejectUnknownFields && !hasOnlyKeys(value, [
    "shapes",
    "denoise",
    "growMaskBy",
    "faceDetailerEnabled",
    "handDetailerEnabled",
  ]) || !Array.isArray(value.shapes) || value.shapes.length !== 1 ||
      !Number.isInteger(value.growMaskBy) || Number(value.growMaskBy) < 0 ||
      Number(value.growMaskBy) > 64) return null;
  const finiteUnit = (entry: unknown) =>
    typeof entry === "number" && Number.isFinite(entry) && entry >= 0 && entry <= 1;
  const shape = (() => {
    const entry = value.shapes[0];
    if (!isRecord(entry) || !["ellipse", "rect", "polygon", "stroke"].includes(String(entry.type))) return null;
    if (entry.type === "ellipse") {
      if (options.rejectUnknownFields && !hasOnlyKeys(entry, [
        "type", "x", "y", "radiusX", "radiusY", "rotation",
      ]) || ![entry.x, entry.y, entry.radiusX, entry.radiusY].every(finiteUnit) ||
          entry.radiusX === 0 || entry.radiusY === 0) return null;
      return {
        type: "ellipse" as const,
        x: entry.x as number,
        y: entry.y as number,
        radiusX: entry.radiusX as number,
        radiusY: entry.radiusY as number,
        ...(typeof entry.rotation === "number" && Number.isFinite(entry.rotation)
          ? { rotation: entry.rotation }
          : {}),
      };
    }
    if (entry.type === "rect") {
      if (options.rejectUnknownFields && !hasOnlyKeys(entry, [
        "type", "x", "y", "width", "height", "rotation",
      ]) || ![entry.x, entry.y, entry.width, entry.height].every(finiteUnit) ||
          entry.width === 0 || entry.height === 0) return null;
      return {
        type: "rect" as const,
        x: entry.x as number,
        y: entry.y as number,
        width: entry.width as number,
        height: entry.height as number,
        ...(typeof entry.rotation === "number" && Number.isFinite(entry.rotation)
          ? { rotation: entry.rotation }
          : {}),
      };
    }
    if (options.rejectUnknownFields && !hasOnlyKeys(entry, [
      "type", "points", "brushSize",
    ]) || !Array.isArray(entry.points) ||
        entry.points.length < (entry.type === "polygon" ? 3 : 1) ||
        entry.points.some((point) => !isRecord(point) ||
          options.rejectUnknownFields && !hasOnlyKeys(point, ["x", "y"]) ||
          !finiteUnit(point.x) || !finiteUnit(point.y))) return null;
    const points = entry.points.map((point) => ({
      x: (point as Record<string, unknown>).x as number,
      y: (point as Record<string, unknown>).y as number,
    }));
    if (entry.type === "polygon") return { type: "polygon" as const, points };
    if (entry.brushSize !== undefined &&
        (typeof entry.brushSize !== "number" || !Number.isFinite(entry.brushSize) ||
          entry.brushSize <= 0 || entry.brushSize > 64)) return null;
    return {
      type: "stroke" as const,
      points,
      ...(typeof entry.brushSize === "number" ? { brushSize: entry.brushSize } : {}),
    };
  })();
  if (!shape || value.denoise !== undefined &&
      (typeof value.denoise !== "number" || !Number.isFinite(value.denoise) ||
        value.denoise < 0 || value.denoise > 1) ||
      value.faceDetailerEnabled !== undefined && typeof value.faceDetailerEnabled !== "boolean" ||
      value.handDetailerEnabled !== undefined && typeof value.handDetailerEnabled !== "boolean") return null;
  return {
    shapes: [shape],
    ...(typeof value.denoise === "number" ? { denoise: value.denoise } : {}),
    growMaskBy: value.growMaskBy as number,
    ...(typeof value.faceDetailerEnabled === "boolean"
      ? { faceDetailerEnabled: value.faceDetailerEnabled }
      : {}),
    ...(typeof value.handDetailerEnabled === "boolean"
      ? { handDetailerEnabled: value.handDetailerEnabled }
      : {}),
  };
}

export function sanitizeTimelineRepairMaskMetadata(
  value: unknown,
  options: { rejectUnknownFields?: boolean } = {},
): TimelineRepairMaskMetadata | null {
  if (!isRecord(value) || options.rejectUnknownFields && !hasOnlyKeys(value, [
    "provenance",
    "refinement",
    "coverageBeforeGrowth",
    "coverageAfterGrowth",
    "growMaskBy",
    "width",
    "height",
    "storedImage",
  ]) || (value.provenance !== "structured-diagnosis" && value.provenance !== "sam2-refinement") ||
      !isRecord(value.refinement) ||
      options.rejectUnknownFields && !hasOnlyKeys(value.refinement, ["status", "reason"]) ||
      !["not-applicable", "applied", "skipped"].includes(String(value.refinement.status)) ||
      !Number.isFinite(value.coverageBeforeGrowth) || Number(value.coverageBeforeGrowth) <= 0 ||
      Number(value.coverageBeforeGrowth) > 0.35 ||
      !Number.isFinite(value.coverageAfterGrowth) ||
      Number(value.coverageAfterGrowth) < Number(value.coverageBeforeGrowth) ||
      Number(value.coverageAfterGrowth) > 0.35 ||
      !Number.isInteger(value.growMaskBy) || Number(value.growMaskBy) < 0 ||
      Number(value.growMaskBy) > 64 ||
      !Number.isSafeInteger(value.width) || Number(value.width) <= 0 ||
      !Number.isSafeInteger(value.height) || Number(value.height) <= 0) return null;
  const refinementStatus = value.refinement.status as TimelineRepairMaskMetadata["refinement"]["status"];
  const reason = value.refinement.reason;
  const validReason = reason === undefined || reason === "no-clear-target" ||
    reason === "sam2-unavailable" || reason === "sam2-invalid";
  const matchesProvenance = validReason && (
    value.provenance === "sam2-refinement" && refinementStatus === "applied" && reason === undefined ||
    value.provenance === "structured-diagnosis" && refinementStatus === "not-applicable" &&
      reason === "no-clear-target" ||
    value.provenance === "structured-diagnosis" && refinementStatus === "skipped" &&
      (reason === "sam2-unavailable" || reason === "sam2-invalid")
  );
  const storedRecord = value.storedImage;
  const storedImage = isRecord(storedRecord) &&
      (!options.rejectUnknownFields ||
        hasOnlyKeys(storedRecord, ["byteLength", "contentType", "filename", "url"]))
    ? normalizeStoredGeneratedImageReference(storedRecord)
    : null;
  if (!matchesProvenance || !storedImage) return null;
  return {
    provenance: value.provenance,
    refinement: {
      status: refinementStatus,
      ...(reason ? { reason } : {}),
    },
    coverageBeforeGrowth: value.coverageBeforeGrowth as number,
    coverageAfterGrowth: value.coverageAfterGrowth as number,
    growMaskBy: value.growMaskBy as number,
    width: value.width as number,
    height: value.height as number,
    storedImage,
  };
}

function rotateRight(value: number, amount: number) {
  return (value >>> amount) | (value << (32 - amount));
}

function sha256Hex(value: string) {
  const bytes = Array.from(new TextEncoder().encode(value));
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let shift = 56; shift >= 32; shift -= 8) bytes.push(Math.floor(bitLength / 2 ** shift) & 0xff);
  for (let shift = 24; shift >= 0; shift -= 8) bytes.push((bitLength >>> shift) & 0xff);

  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const words = new Uint32Array(64);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const byteOffset = offset + index * 4;
      words[index] = (
        (bytes[byteOffset]! << 24) |
        (bytes[byteOffset + 1]! << 16) |
        (bytes[byteOffset + 2]! << 8) |
        bytes[byteOffset + 3]!
      ) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const previous15 = words[index - 15]!;
      const previous2 = words[index - 2]!;
      const sigma0 = rotateRight(previous15, 7) ^ rotateRight(previous15, 18) ^ (previous15 >>> 3);
      const sigma1 = rotateRight(previous2, 17) ^ rotateRight(previous2, 19) ^ (previous2 >>> 10);
      words[index] = (words[index - 16]! + sigma0 + words[index - 7]! + sigma1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e!, 6) ^ rotateRight(e!, 11) ^ rotateRight(e!, 25);
      const choice = (e! & f!) ^ (~e! & g!);
      const temporary1 = (h! + sum1 + choice + sha256RoundConstants[index]! + words[index]!) >>> 0;
      const sum0 = rotateRight(a!, 2) ^ rotateRight(a!, 13) ^ rotateRight(a!, 22);
      const majority = (a! & b!) ^ (a! & c!) ^ (b! & c!);
      const temporary2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d! + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }
    hash[0] = (hash[0]! + a!) >>> 0;
    hash[1] = (hash[1]! + b!) >>> 0;
    hash[2] = (hash[2]! + c!) >>> 0;
    hash[3] = (hash[3]! + d!) >>> 0;
    hash[4] = (hash[4]! + e!) >>> 0;
    hash[5] = (hash[5]! + f!) >>> 0;
    hash[6] = (hash[6]! + g!) >>> 0;
    hash[7] = (hash[7]! + h!) >>> 0;
  }
  return Array.from(hash, (word) => word.toString(16).padStart(8, "0")).join("");
}

export function deriveRepairAttemptId(
  workflowId: string,
  candidateId: string,
  parent: TimelineRepairParentBinding,
  baseRequestDigest: string,
) {
  const canonicalDigest = sanitizeRepairSemanticDigest(baseRequestDigest);
  if (!canonicalDigest) throw new Error("Repair base request digest is invalid.");
  return `sha256:${sha256Hex(JSON.stringify({
    workflowId,
    candidateId,
    parent,
    baseRequestDigest: canonicalDigest,
  }))}`;
}

function sameStoredImage(left: unknown, right: unknown) {
  return isRecord(left) && isRecord(right) && left.byteLength === right.byteLength &&
    left.contentType === right.contentType && left.filename === right.filename && left.url === right.url;
}

function canonicalRepairSourceImage(value: unknown) {
  if (!isRecord(value) || !safeRepairIdentifier(value.nodeId)) return null;
  const normalized = normalizeComfyUiViewImageReference(value);
  return normalized ? { ...normalized, nodeId: value.nodeId as string } : null;
}

export function repairPairHasCanonicalAttemptSource(pair: TimelineRepairPair) {
  if (pair.status !== "repaired") return true;
  const sourceImage = canonicalRepairSourceImage(pair.sourceImage);
  const attemptSourceImage = canonicalRepairSourceImage(pair.attempt?.sourceImage);
  return Boolean(
    sourceImage &&
    attemptSourceImage &&
    pair.attempt?.status === "stored" &&
    pair.attempt.outputNodeId === attemptSourceImage.nodeId &&
    JSON.stringify(sourceImage) === JSON.stringify(attemptSourceImage),
  );
}

export function createRepairParentBinding(
  final: TimelineFinalExecutionRecord,
  reviewPair: TimelineFinalReviewPair,
  targets: TimelineRepairTarget[],
  reviewUpdatedAt: string,
  visualStyle?: RunVisualStyle,
): TimelineRepairParentBinding | null {
  if (!final.storedImage || !sameStoredImage(final.storedImage, reviewPair.variants.final)) return null;
  return {
    finalStoredImage: final.storedImage,
    reviewUpdatedAt,
    reviewedFindings: reviewPair.findings ?? [],
    reviewedTargets: targets,
    ...(visualStyle ? { visualStyle } : {}),
  };
}

export function repairPairMatchesReviewPair(
  repairPair: TimelineRepairPair,
  reviewPair: TimelineFinalReviewPair,
  reviewUpdatedAt?: string,
  visualStyle?: RunVisualStyle,
) {
  const expectedTargets = getRepairTargets({ reviewVersion: 1, status: "reviewed", pairs: [reviewPair] }, reviewPair.candidateId);
  return Boolean(repairPair.parent &&
    repairPair.rank === reviewPair.rank && repairPair.seed === reviewPair.seed &&
    sameStoredImage(repairPair.parent.finalStoredImage, reviewPair.variants.final) &&
    (!visualStyle || repairPair.parent.visualStyle === visualStyle) &&
    (!reviewUpdatedAt || repairPair.parent.reviewUpdatedAt === reviewUpdatedAt) &&
    JSON.stringify(repairPair.parent.reviewedFindings) === JSON.stringify(reviewPair.findings ?? []) &&
    JSON.stringify(repairPair.parent.reviewedTargets) === JSON.stringify(expectedTargets) &&
    JSON.stringify(repairPair.targets) === JSON.stringify(expectedTargets));
}

export function getRepairManualRecoveryState(pair: TimelineRepairPair): RepairManualRecoveryState | null {
  if (pair.skipReason === "queue-outcome-unknown" || pair.attempt?.status === "queue-started") {
    return repairManualRecoveryStates["queue-outcome"];
  }
  const details = isRecord(pair.error?.details) ? pair.error.details : null;
  return details?.stage === "diagnosis-outcome"
    ? repairManualRecoveryStates["diagnosis-outcome"]
    : details?.stage === "sam2-outcome"
      ? repairManualRecoveryStates["sam2-outcome"]
      : details?.stage === "queue-outcome"
        ? repairManualRecoveryStates["queue-outcome"]
        : null;
}

export function isRepairManualRecoveryRequired(pair: TimelineRepairPair) {
  return getRepairManualRecoveryState(pair) !== null;
}

export function isRepairQueueOutcomeUnknown(pair: TimelineRepairPair) {
  return getRepairManualRecoveryState(pair)?.reason === "queue-outcome";
}

export function repairVerificationMatchesRepairPair(
  verificationPair: TimelineRepairVerificationPair,
  repairPair: TimelineRepairPair,
) {
  return Boolean(verificationPair.visualStyleMatch !== false &&
    repairPair.parent && repairPair.status === "repaired" && repairPair.storedImage &&
    repairPairHasCanonicalAttemptSource(repairPair) &&
    JSON.stringify(verificationPair.repairParent) === JSON.stringify(repairPair.parent) &&
    sameStoredImage(verificationPair.repairStoredImage, repairPair.storedImage));
}

function normalizeEnum<T extends string>(value: unknown, allowed: readonly T[]) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/[\s_]+/g, "-");
  return allowed.includes(normalized as T) ? normalized as T : null;
}

function normalizeScores(value: unknown): TimelineFinalReviewScores | null {
  if (!isRecord(value)) return null;
  const dimensions = Object.fromEntries(scoreFields.map((field) => {
    const raw = value[field];
    const score = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.trim()) : Number.NaN;
    return [field, score];
  })) as Record<(typeof scoreFields)[number], number>;
  if (Object.values(dimensions).some((score) => !Number.isFinite(score) || score < 0 || score > 100)) return null;
  const total = dimensions.adherence * previewScoringRubric.adherence +
    dimensions.composition * previewScoringRubric.composition +
    dimensions.anatomy * previewScoringRubric.anatomy +
    dimensions.style * previewScoringRubric.style +
    dimensions.technical * previewScoringRubric.technical;
  return { ...dimensions, total: Number(total.toFixed(2)) };
}

function normalizeVerificationFindings(value: unknown): TimelineFinalReviewFinding[] | null {
  if (!Array.isArray(value) || value.length !== timelineFinalReviewOperations.length) return null;
  const seen = new Set<string>();
  const findings = value.map((entry) => {
    if (!isRecord(entry)) return null;
    const operation = normalizeEnum(entry.operation, timelineFinalReviewOperations);
    const severity = normalizeEnum(entry.severity, timelineFinalReviewSeverities);
    const scope = normalizeEnum(entry.scope, timelineFinalReviewScopes);
    if (!operation || !severity || !scope || seen.has(operation)) return null;
    seen.add(operation);
    return {
      operation,
      severity,
      scope,
      introducedByFinal: false,
      description: typeof entry.description === "string" && entry.description.trim()
        ? entry.description.trim().slice(0, 500)
        : severity === "none" ? "No material issue detected." : "Material issue detected.",
    } satisfies TimelineFinalReviewFinding;
  });
  if (findings.some((finding) => finding === null) || seen.size !== timelineFinalReviewOperations.length) return null;
  return findings as TimelineFinalReviewFinding[];
}

export function getRepairTargets(review: FinalReviewTimelineResult, candidateId: string): TimelineRepairTarget[] {
  const pair = review.status === "reviewed"
    ? review.pairs.find((item) => item.candidateId === candidateId)
    : undefined;
  if (!pair?.findings || review.visualStyle && pair.visualStyleMatch?.final !== true) return [];
  return pair.findings.flatMap((finding) =>
    (finding.operation === "contact" || finding.operation === "object-count") &&
      (finding.severity === "major" || finding.severity === "blocking") &&
      finding.scope === "final" && finding.introducedByFinal
      ? [{ operation: finding.operation, severity: finding.severity, description: finding.description }]
      : [],
  );
}

export function createSkippedFinalRepair(
  review: FinalReviewTimelineResult,
  authorized: boolean,
): FinalRepairTimelineResult {
  return {
    repairVersion: 1,
    authorized,
    completed: true,
    pairs: review.pairs.map((pair): TimelineRepairPair => {
      const targets = getRepairTargets(review, pair.candidateId);
      return {
        candidateId: pair.candidateId,
        rank: pair.rank,
        seed: pair.seed,
        status: "skipped",
        targets,
        skipReason: authorized ? "no-supported-finding" : "repair-disabled",
      };
    }),
  };
}

export function getFinalRepairResult(workflow: TimelineWorkflowState) {
  const value = workflow.nodes["final-repair"].result;
  return isRecord(value) && value.repairVersion === 1 && Array.isArray(value.pairs)
    ? value as FinalRepairTimelineResult
    : null;
}

export function getRepairVerificationResult(workflow: TimelineWorkflowState) {
  const value = workflow.nodes["repair-verification"].result;
  return isRecord(value) && value.verificationVersion === 1 && Array.isArray(value.pairs)
    ? value as RepairVerificationTimelineResult
    : null;
}

export function parseRepairVerificationResponse(
  content: string,
  repair: FinalRepairTimelineResult,
  review: FinalReviewTimelineResult,
  visualStyle?: RunVisualStyle,
): RepairVerificationTimelineResult | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.trim());
  } catch {
    return null;
  }
  const repaired = repair.pairs.filter((pair) => {
    const reviewPair = review.pairs.find((candidate) => candidate.candidateId === pair.candidateId);
    return pair.status === "repaired" && pair.storedImage && reviewPair &&
      repairPairHasCanonicalAttemptSource(pair) &&
      repairPairMatchesReviewPair(pair, reviewPair, undefined, review.visualStyle);
  });
  if (!isRecord(parsed) || !Array.isArray(parsed.pairs) || parsed.pairs.length !== repaired.length) return null;
  const seen = new Set<string>();
  const pairs = parsed.pairs.map((entry) => {
    if (!isRecord(entry) || typeof entry.candidateId !== "string" || seen.has(entry.candidateId)) return null;
    const repairPair = repaired.find((pair) => pair.candidateId === entry.candidateId);
    const reviewPair = review.pairs.find((pair) => pair.candidateId === entry.candidateId);
    if (!repairPair || !reviewPair?.scores || !repairPairHasCanonicalAttemptSource(repairPair) ||
        !repairPairMatchesReviewPair(repairPair, reviewPair, undefined, review.visualStyle) ||
        !isRecord(entry.scores)) return null;
    const finalScores = normalizeScores(entry.scores.final);
    const repairScores = normalizeScores(entry.scores.repair);
    const findings = normalizeVerificationFindings(entry.findings);
    const visualStyleMatch = typeof entry.visualStyleMatch === "boolean"
      ? entry.visualStyleMatch
      : null;
    if (!finalScores || !repairScores || !findings ||
        visualStyle && visualStyleMatch === null) return null;
    seen.add(entry.candidateId);
    const targetedDefectsResolved = repairPair.targets.every((target) => {
      const finding = findings.find((candidate) => candidate.operation === target.operation);
      return finding?.severity === "none" || finding?.severity === "minor";
    });
    const newMajorOrBlockingIssue = findings.some((finding) =>
      (finding.severity === "major" || finding.severity === "blocking") &&
      !repairPair.targets.some((target) => target.operation === finding.operation),
    );
    const recommended = visualStyleMatch !== false &&
      targetedDefectsResolved && !newMajorOrBlockingIssue &&
      repairScores.total >= finalScores.total;
    return {
      candidateId: entry.candidateId,
      repairParent: repairPair.parent!,
      repairStoredImage: repairPair.storedImage!,
      scores: { final: finalScores, repair: repairScores },
      targetedDefectsResolved,
      newMajorOrBlockingIssue,
      findings,
      recommended,
      ...(visualStyle ? { visualStyleMatch: visualStyleMatch! } : {}),
      ...(typeof entry.rationale === "string" && entry.rationale.trim()
        ? { rationale: entry.rationale.trim().slice(0, 1_000) }
        : {}),
    };
  });
  if (!pairs.every((pair): pair is NonNullable<typeof pair> => pair !== null) || seen.size !== repaired.length) return null;
  return {
    verificationVersion: 1,
    status: "verified",
    pairs,
    ...(visualStyle ? { visualStyle } : {}),
  };
}

export function selectRepairVariant(
  workflow: TimelineWorkflowState,
  candidateId: string,
  variant: "final" | "preview-upscale" | "repair",
  updatedAt = new Date().toISOString(),
) {
  if (workflow.nodes["final-review"].status !== "done") return workflow;
  const review = workflow.nodes["final-review"].result;
  if (!isRecord(review) || !Array.isArray(review.pairs)) return workflow;
  const reviewPair = review.pairs.find((pair) =>
    isRecord(pair) && pair.candidateId === candidateId) as TimelineFinalReviewPair | undefined;
  if (!reviewPair) return workflow;
  const sceneInput = workflow.nodes["scene-input"].result;
  const configuredVisualStyle = isRecord(sceneInput) &&
    isRecord(sceneInput.settingsSnapshot) &&
    isRunVisualStyle(sceneInput.settingsSnapshot.visualStyle)
    ? sceneInput.settingsSnapshot.visualStyle
    : null;
  const styleEnforced = configuredVisualStyle !== null || isRunVisualStyle(review.visualStyle);
  const currentVisualStyle = getRunSceneInputSettings(isRecord(sceneInput) ? sceneInput : {}).visualStyle;
  if (styleEnforced && !isRunVisualStyle(review.visualStyle)) return workflow;
  if (styleEnforced && review.visualStyle !== currentVisualStyle) return workflow;
  if (styleEnforced && variant === "final" && reviewPair.visualStyleMatch?.final !== true) return workflow;
  if (styleEnforced && variant === "preview-upscale" &&
      reviewPair.visualStyleMatch?.previewUpscale !== true) return workflow;
  if (variant === "repair") {
    if (workflow.nodes["repair-verification"].status !== "done") return workflow;
    const repair = getFinalRepairResult(workflow)?.pairs.find((pair) => pair.candidateId === candidateId);
    const verificationResult = getRepairVerificationResult(workflow);
    const verification = verificationResult?.pairs.find((pair) => pair.candidateId === candidateId);
    if (repair?.status !== "repaired" || !repair.storedImage || !verification ||
        styleEnforced && (
          verificationResult?.visualStyle !== review.visualStyle ||
          verification.visualStyleMatch !== true ||
          repair.parent?.visualStyle !== review.visualStyle
        ) ||
        !repairVerificationMatchesRepairPair(verification, repair) || !reviewPair ||
        !repairPairMatchesReviewPair(
          repair,
          reviewPair,
          workflow.nodes["final-review"].updatedAt,
          review.visualStyle as RunVisualStyle | undefined,
        )) return workflow;
  }
  return {
    ...workflow,
    updatedAt,
    nodes: {
      ...workflow.nodes,
      "final-review": {
        ...workflow.nodes["final-review"],
        result: {
          ...review,
          pairs: review.pairs.map((pair) => isRecord(pair) && pair.candidateId === candidateId
            ? { ...pair, userSelectedVariant: variant }
            : pair),
        },
      },
    },
  } as TimelineWorkflowState;
}
