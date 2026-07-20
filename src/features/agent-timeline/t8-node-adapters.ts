import type { ComfyUiTextToImageRequest } from "@/features/comfyui";

import { getGenerationInputDetailers } from "./generation-detailers";
import { getRunSceneInputSettings } from "./run-input-settings";
import { createTimelineNodeError, normalizeTimelineImageCount } from "./state";
import {
  getStyleReferenceBlockingIssue,
  getStyleReferenceContextMismatch,
  isStyleReferenceReady,
  sanitizeStyleReferenceSnapshot,
} from "./style-reference";
import {
  createTimelinePreviewSelectionFallbackMetadata,
  TimelineNodeExecutionError,
  type ComfyUiExecutionTimelineResult,
  type ParameterRecommendationTimelineResult,
  type PreviewExecutionTimelineResult,
  type PreviewScoringTimelineResultV2,
  type ResultDisplayTimelineResult,
  type SceneInputTimelineResult,
  type TimelineNodeAdapters,
  type TimelineNodeExecutionContext,
  type TimelineWorkflowState,
} from "./types";

const PREVIEW_DIMENSION_ALIGNMENT = 8;
const MAX_SEED = Number.MAX_SAFE_INTEGER;

export type TimelineBalancedGenerationPolicy = {
  family: "illustrious" | "anima" | "fallback";
  finalDenoise: number;
  previewLongestEdge: number;
  previewStepCap: number;
};

export function getTimelineBalancedGenerationPolicy(
  request: ComfyUiTextToImageRequest,
): TimelineBalancedGenerationPolicy {
  const baseModel = request.modelBaseModel?.trim().toLocaleLowerCase() ?? "";
  if (request.workflowProfile === "anima" || baseModel.includes("anima")) {
    return { family: "anima", finalDenoise: 0.65, previewLongestEdge: 768, previewStepCap: 20 };
  }
  if (typeof request.modelBaseModel === "string" && request.modelBaseModel.toLocaleLowerCase().includes("illustrious")) {
    return { family: "illustrious", finalDenoise: 0.6, previewLongestEdge: 768, previewStepCap: 20 };
  }
  return { family: "fallback", finalDenoise: 0.65, previewLongestEdge: 768, previewStepCap: 20 };
}

export type TimelinePreviewExecutionProvider = (
  requests: Array<{ candidateId: string; index: number; request: ComfyUiTextToImageRequest; seed: number }>,
  context: TimelineNodeExecutionContext,
) => Promise<PreviewExecutionTimelineResult>;

export type TimelinePreviewScoringProvider = (
  previews: PreviewExecutionTimelineResult,
  context: TimelineNodeExecutionContext,
) => Promise<PreviewScoringTimelineResultV2>;

export type TimelineFinalExecutionProvider = (
  requests: Array<{
    candidateId: string;
    rank: number;
    request: ComfyUiTextToImageRequest;
    seed: number;
    storedPreview: NonNullable<PreviewExecutionTimelineResult["candidates"][number]["storedImage"]>;
  }>,
  context: TimelineNodeExecutionContext,
  previous?: ComfyUiExecutionTimelineResult,
) => Promise<ComfyUiExecutionTimelineResult>;

export type TimelineResultDisplayProvider = (
  execution: ComfyUiExecutionTimelineResult,
  context: TimelineNodeExecutionContext,
) => Promise<ResultDisplayTimelineResult> | ResultDisplayTimelineResult;

export type TimelineT8NodeAdapterOptions = {
  advancePreviewSeedOnRetry?: boolean;
  executePreviews: TimelinePreviewExecutionProvider;
  scorePreviews: TimelinePreviewScoringProvider;
  executeFinals: TimelineFinalExecutionProvider;
  loadResultDisplay: TimelineResultDisplayProvider;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidComfyUiRequest(message: string, details?: unknown): never {
  throw new TimelineNodeExecutionError(createTimelineNodeError("comfyui_request_invalid", message, details));
}

function getParameterRecommendationResult(workflow: TimelineWorkflowState): ParameterRecommendationTimelineResult {
  const result = workflow.nodes["parameter-recommendation"].result;
  if (isRecord(result) && isRecord(result.requestPreview) &&
      typeof result.requestPreview.checkpointName === "string" &&
      typeof result.requestPreview.positivePrompt === "string") {
    return result as ParameterRecommendationTimelineResult;
  }
  invalidComfyUiRequest("Parameter recommendation must include a ComfyUI request preview before execution.");
}

export function getTimelineFinalImageCount(workflow: TimelineWorkflowState) {
  const result = workflow.nodes["scene-input"].result;
  return isRecord(result) ? normalizeTimelineImageCount(result.imageCount) : normalizeTimelineImageCount(undefined);
}

export function getTimelinePreviewCandidateCount(finalCount: number) {
  return Math.min(8, Math.max(4, normalizeTimelineImageCount(finalCount) * 2));
}

function greatestCommonDivisor(left: number, right: number) {
  let first = left;
  let second = right;
  while (second !== 0) {
    const remainder = first % second;
    first = second;
    second = remainder;
  }
  return first;
}

function leastCommonMultiple(left: number, right: number) {
  return (left / greatestCommonDivisor(left, right)) * right;
}

export function getTimelinePreviewDimensions(width: number, height: number, longestEdge = 768) {
  if (![width, height, longestEdge].every((value) => Number.isSafeInteger(value) && value > 0)) {
    invalidComfyUiRequest("Preview width, height, and longest-edge limit must be positive integers.");
  }
  if (Math.max(width, height) <= longestEdge) {
    return { width, height };
  }

  const ratioDivisor = greatestCommonDivisor(width, height);
  const ratioWidth = width / ratioDivisor;
  const ratioHeight = height / ratioDivisor;
  const widthAlignmentMultiplier = PREVIEW_DIMENSION_ALIGNMENT /
    greatestCommonDivisor(ratioWidth, PREVIEW_DIMENSION_ALIGNMENT);
  const heightAlignmentMultiplier = PREVIEW_DIMENSION_ALIGNMENT /
    greatestCommonDivisor(ratioHeight, PREVIEW_DIMENSION_ALIGNMENT);
  const alignmentMultiplier = leastCommonMultiple(widthAlignmentMultiplier, heightAlignmentMultiplier);
  const maximumMultiplier = Math.floor(longestEdge / Math.max(ratioWidth, ratioHeight));
  const multiplier = Math.floor(maximumMultiplier / alignmentMultiplier) * alignmentMultiplier;

  if (multiplier < alignmentMultiplier) {
    invalidComfyUiRequest(
      `Preview dimensions ${width}x${height} cannot be downscaled to an exact-aspect, ` +
      `${PREVIEW_DIMENSION_ALIGNMENT}-pixel-aligned size within longest edge ${longestEdge}. ` +
      "Choose a less extreme aspect ratio or dimensions already within the preview limit.",
      { height, longestEdge, width },
    );
  }

  return { width: ratioWidth * multiplier, height: ratioHeight * multiplier };
}

function getTimelineSourceImage(workflow: TimelineWorkflowState) {
  const result = workflow.nodes["scene-input"].result;
  return isRecord(result) ? (result as Partial<SceneInputTimelineResult>).sourceImage : undefined;
}

function assertGenerationConfirmed(workflow: TimelineWorkflowState) {
  const gateResult = workflow.nodes["generation-gate"].result;
  if (!workflow.generationConfirmed || !isRecord(gateResult) || gateResult.confirmed !== true) {
    throw new TimelineNodeExecutionError(createTimelineNodeError(
      "confirmation_required",
      "Confirm generation before constructing or executing a ComfyUI request.",
    ));
  }
}

function hasOpaqueStylePromptExactlyOnceAtTail(promptValue: string, stylePromptValue: string) {
  const prompt = promptValue.trim();
  const stylePrompt = stylePromptValue.trim();
  if (!stylePrompt) return false;
  if (prompt === stylePrompt) return true;
  const suffix = `, ${stylePrompt}`;
  if (!prompt.endsWith(suffix)) return false;
  const prefix = prompt.slice(0, -suffix.length).trimEnd();
  const escaped = stylePrompt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return !new RegExp(`(?:^|, )${escaped}(?:, |$)`).test(prefix);
}

function getValidatedStyleReferenceCheckpoint(workflow: TimelineWorkflowState) {
  const result = workflow.nodes["resource-recommendation"].result;
  if (!isRecord(result) || !isRecord(result.checkpoint) || !isRecord(result.checkpoint.resource)) return null;
  const checkpoint = result.checkpoint.resource;
  return typeof checkpoint.id === "string" && checkpoint.id.trim() &&
    typeof checkpoint.modelFileName === "string" && checkpoint.modelFileName.trim()
    ? { id: checkpoint.id.trim(), modelFileName: checkpoint.modelFileName.trim(),
        ...(typeof checkpoint.baseModel === "string" ? { baseModel: checkpoint.baseModel } : {}) }
    : null;
}

function assertStyleReferenceUsable(workflow: TimelineWorkflowState, parameterResult: ParameterRecommendationTimelineResult) {
  const sceneInput = workflow.nodes["scene-input"].result;
  const settings = getRunSceneInputSettings(isRecord(sceneInput) ? sceneInput : {});
  const issue = getStyleReferenceBlockingIssue(settings.styleReference, "Run");
  if (issue) invalidComfyUiRequest(issue);
  const current = sanitizeStyleReferenceSnapshot(settings.styleReference);
  const reviewed = sanitizeStyleReferenceSnapshot(parameterResult.styleReference);
  if (JSON.stringify(current) !== JSON.stringify(reviewed)) {
    invalidComfyUiRequest("Run style reference changed after parameter review. Regenerate parameters before confirmation.");
  }
  if (!current) return;
  if (isStyleReferenceReady(current)) {
    const stylePrompt = current.analysis.stylePrompt.trim();
    if (!hasOpaqueStylePromptExactlyOnceAtTail(parameterResult.requestPreview.positivePrompt, stylePrompt)) {
      invalidComfyUiRequest("Run request preview must include the complete style prompt exactly once at the tail.");
    }
  }
  const checkpoint = getValidatedStyleReferenceCheckpoint(workflow);
  if (!checkpoint) invalidComfyUiRequest("Run style reference requires a validated checkpoint recommendation.");
  const mismatch = getStyleReferenceContextMismatch(current, {
    checkpointBaseModel: checkpoint.baseModel,
    checkpointId: checkpoint.id,
    promptProfile: settings.promptProfile,
  });
  if (mismatch) invalidComfyUiRequest(mismatch);
}

function materializeBaseSeed(
  workflow: TimelineWorkflowState,
  parameterResult: ParameterRecommendationTimelineResult,
  candidateCount: number,
  advancePreviewSeedOnRetry: boolean,
) {
  const fixed = parameterResult.seedPolicy.mode === "fixed" ? parameterResult.seedPolicy.seed : undefined;
  const previousPreview = workflow.nodes["preview-execution"];
  const previousResult = advancePreviewSeedOnRetry &&
      (previousPreview.status === "stale" || previousPreview.status === "running") &&
      isRecord(previousPreview.result)
    ? previousPreview.result
    : null;
  const previousBaseSeed = previousResult?.baseSeed;
  if (Number.isSafeInteger(fixed) && (fixed ?? -1) >= 0 &&
      Number.isSafeInteger(previousBaseSeed) && (previousBaseSeed as number) >= 0 &&
      (previousBaseSeed as number) <= MAX_SEED && previousResult?.candidateCount === candidateCount) {
    return advanceTimelineSeed(previousBaseSeed as number, candidateCount);
  }
  return Number.isSafeInteger(fixed) && (fixed ?? -1) >= 0 && (fixed as number) <= MAX_SEED
    ? fixed as number
    : Math.floor(Math.random() * (MAX_SEED - candidateCount));
}

function advanceTimelineSeed(seed: number, offset: number) {
  const remaining = MAX_SEED - seed;
  return offset <= remaining ? seed + offset : offset - remaining - 1;
}

export function createConfirmedTimelineComfyUiRequest(workflow: TimelineWorkflowState): ComfyUiTextToImageRequest {
  assertGenerationConfirmed(workflow);
  const parameterResult = getParameterRecommendationResult(workflow);
  assertStyleReferenceUsable(workflow, parameterResult);
  const sourceImage = getTimelineSourceImage(workflow);
  const sceneInput = workflow.nodes["scene-input"].result;
  const detailers = getGenerationInputDetailers(isRecord(sceneInput) ? sceneInput : {});
  return {
    ...parameterResult.requestPreview,
    faceDetailer: detailers.faceDetailer,
    handDetailer: detailers.handDetailer,
    ...(sourceImage ? {
      sourceImageDataUrl: sourceImage.dataUrl,
      imageWidth: sourceImage.width,
      imageHeight: sourceImage.height,
    } : {}),
    batchSize: 1,
    preview: false,
  };
}

export function createTimelinePreviewRequests(
  workflow: TimelineWorkflowState,
  options: { advancePreviewSeedOnRetry?: boolean } = {},
) {
  const formal = createConfirmedTimelineComfyUiRequest(workflow);
  const policy = getTimelineBalancedGenerationPolicy(formal);
  const parameterResult = getParameterRecommendationResult(workflow);
  const finalCount = getTimelineFinalImageCount(workflow);
  const candidateCount = getTimelinePreviewCandidateCount(finalCount);
  const dimensions = getTimelinePreviewDimensions(parameterResult.width, parameterResult.height, policy.previewLongestEdge);
  const baseSeed = materializeBaseSeed(
    workflow,
    parameterResult,
    candidateCount,
    options.advancePreviewSeedOnRetry === true,
  );
  return Array.from({ length: candidateCount }, (_, index) => {
    const seed = advanceTimelineSeed(baseSeed, index);
    return {
      candidateId: `preview-${index + 1}`,
      index,
      seed,
      request: {
        ...formal,
        ...dimensions,
        imageWidth: dimensions.width,
        imageHeight: dimensions.height,
        seed,
        steps: Math.min(formal.steps ?? parameterResult.steps, policy.previewStepCap),
        batchSize: 1,
        faceDetailer: { ...formal.faceDetailer, enabled: false },
        handDetailer: { ...formal.handDetailer, enabled: false },
        preview: true,
      },
    };
  });
}

function requirePreviewResult(workflow: TimelineWorkflowState): PreviewExecutionTimelineResult {
  const value = workflow.nodes["preview-execution"].result;
  if (isRecord(value) && Array.isArray(value.candidates)) return value as PreviewExecutionTimelineResult;
  throw new TimelineNodeExecutionError(createTimelineNodeError("timeline_node_blocked", "Preview results are required."));
}

function requireScoringResult(workflow: TimelineWorkflowState): PreviewScoringTimelineResultV2 {
  const value = workflow.nodes["preview-scoring"].result;
  if (isRecord(value) && value.rubricVersion === 2 && Array.isArray(value.selectedCandidateIds)) {
    return value as PreviewScoringTimelineResultV2;
  }
  throw new TimelineNodeExecutionError(createTimelineNodeError(
    "timeline_node_blocked",
    "Current eligibility-aware preview scoring is required. Retry preview scoring before final generation.",
  ));
}

export function createTimelineFinalRequests(workflow: TimelineWorkflowState) {
  const formal = createConfirmedTimelineComfyUiRequest(workflow);
  const policy = getTimelineBalancedGenerationPolicy(formal);
  const previews = requirePreviewResult(workflow);
  const scoring = requireScoringResult(workflow);
  const finalCount = previews.finalCount;
  const selectedIds = scoring.selectedCandidateIds;
  const invalidExactSelection = () => invalidComfyUiRequest(
    `Final generation requires exactly ${finalCount} distinct successful preview candidates with valid scores and ranks. Reselect exactly ${finalCount} available previews.`,
    { finalCount, selectedCount: Array.isArray(selectedIds) ? selectedIds.length : 0 },
  );

  if (
    !Number.isInteger(finalCount) || finalCount < 1 || finalCount > 4 ||
    !Array.isArray(selectedIds) || selectedIds.length !== finalCount ||
    selectedIds.some((candidateId) => typeof candidateId !== "string" || !candidateId.trim()) ||
    new Set(selectedIds).size !== finalCount ||
    !Array.isArray(scoring.scores)
  ) {
    invalidExactSelection();
  }

  const selected = selectedIds.map((candidateId) => ({
    candidateId,
    candidates: previews.candidates.filter((candidate) => candidate.candidateId === candidateId),
    scores: scoring.scores.filter((score) => score.candidateId === candidateId),
  }));
  const selectedRanks = selected.map((item) => item.scores[0]?.rank);
  const expectedFallbackMetadata = createTimelinePreviewSelectionFallbackMetadata(scoring.scores, selectedIds);
  const fallbackMetadataMatches =
    (scoring.eligibleCount === undefined || (
      Number.isSafeInteger(scoring.eligibleCount) &&
      scoring.eligibleCount === expectedFallbackMetadata.eligibleCount
    )) &&
    (scoring.fallbackCandidateIds === undefined || (
      Array.isArray(scoring.fallbackCandidateIds) &&
      scoring.fallbackCandidateIds.length === expectedFallbackMetadata.fallbackCandidateIds.length &&
      scoring.fallbackCandidateIds.every(
        (candidateId, index) => candidateId === expectedFallbackMetadata.fallbackCandidateIds[index],
      )
    )) &&
    (scoring.selectionWarning === undefined || scoring.selectionWarning === expectedFallbackMetadata.selectionWarning);
  if (
    !fallbackMetadataMatches ||
    selected.some((item) =>
      item.candidates.length !== 1 ||
      item.candidates[0]?.status !== "done" ||
      !item.candidates[0].storedImage ||
      !Number.isSafeInteger(item.candidates[0].seed) ||
      item.candidates[0].seed < 0 ||
      item.scores.length !== 1 ||
      !Number.isSafeInteger(item.scores[0]?.rank) ||
      (item.scores[0]?.rank ?? 0) < 1 ||
      (item.scores[0]?.rank ?? 0) > scoring.scores.length
    ) ||
    new Set(selectedRanks).size !== finalCount
  ) {
    invalidExactSelection();
  }

  return selected.map(({ candidateId, candidates, scores }) => {
    const candidate = candidates[0]!;
    const score = scores[0]!;
    return {
      candidateId,
      rank: score.rank,
      seed: candidate.seed,
      request: {
        ...formal,
        sourceImageDataUrl: undefined,
        imageName: undefined,
        imageWidth: formal.width,
        imageHeight: formal.height,
        seed: candidate.seed,
        denoise: policy.finalDenoise,
        batchSize: 1,
        preview: false,
      },
      storedPreview: candidate.storedImage!,
    };
  });
}

function getPreviousFinalResult(workflow: TimelineWorkflowState) {
  const result = workflow.nodes["comfyui-execution"].result;
  if (isRecord(result) && Array.isArray(result.finals)) return result as ComfyUiExecutionTimelineResult;
  const partial = workflow.nodes["comfyui-execution"].error?.details;
  return isRecord(partial) && isRecord(partial.partialResult) && Array.isArray(partial.partialResult.finals)
    ? partial.partialResult as ComfyUiExecutionTimelineResult
    : undefined;
}

export function createTimelineT8NodeAdapters(options: TimelineT8NodeAdapterOptions): TimelineNodeAdapters {
  return {
    "preview-execution": async (context) => ({
      value: await options.executePreviews(createTimelinePreviewRequests(context.workflow, {
        advancePreviewSeedOnRetry: options.advancePreviewSeedOnRetry,
      }), context),
      source: "system",
    }),
    "preview-scoring": async (context) => ({
      value: await options.scorePreviews(requirePreviewResult(context.workflow), context),
      source: "ai",
    }),
    "comfyui-execution": async (context) => ({
      value: await options.executeFinals(
        createTimelineFinalRequests(context.workflow),
        context,
        getPreviousFinalResult(context.workflow),
      ),
      source: "system",
    }),
    "result-display": async (context) => ({
      value: await options.loadResultDisplay(getPreviousFinalResult(context.workflow)!, context),
      source: "system",
    }),
  };
}
