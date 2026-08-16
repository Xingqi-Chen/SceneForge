import {
  resolveComfyUiTextToImageWorkflowProfile,
  type ComfyUiTextToImageRequest,
} from "@/features/comfyui";
import { hasKrea2PromptSegmentExactlyOnceAtTail } from "@/features/editor/ai-prompt/krea2-prompt";

import {
  resolveTimelineFinalGenerationPolicy,
  resolveTimelineFinalDimensions,
} from "./final-generation-policy";
import { getGenerationInputDetailers } from "./generation-detailers";
import {
  getExactAspectAlignedPreviewDimensions,
  greatestCommonDivisor,
  leastCommonMultiple,
} from "./preview-dimensions";
import { getRunSceneInputSettings } from "./run-input-settings";
import {
  createTimelineNodeError,
  normalizeTimelineImageCount,
  normalizeTimelineSourceDenoise,
} from "./state";
import {
  getCharacterReferenceBlockingIssue,
  getStyleReferenceBlockingIssue,
  getStyleReferenceContextMismatch,
  isCharacterReferenceReady,
  isKrea2ReIdReferenceReady,
  isStyleReferenceReady,
  sanitizeCharacterReferenceSnapshot,
  sanitizeStyleReferenceSnapshot,
} from "./style-reference";
import {
  deriveTimelineConfirmedReferenceContext,
  getConfirmedTimelineReferenceContext,
} from "./run-reference-context";
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
  family: "illustrious" | "anima" | "fallback" | "krea2";
  finalDenoise: number;
  finalSteps?: number;
  previewLongestEdge: number;
  previewStepCap: number;
};

export function getTimelineBalancedGenerationPolicy(
  request: ComfyUiTextToImageRequest,
  preset?: unknown,
): TimelineBalancedGenerationPolicy {
  const finalPolicy = resolveTimelineFinalGenerationPolicy(request, preset);
  return {
    family: finalPolicy.family,
    finalDenoise: finalPolicy.denoise,
    finalSteps: finalPolicy.steps,
    previewLongestEdge: 768,
    previewStepCap: 20,
  };
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
    formalWidth: number;
    formalHeight: number;
    storedPreview: NonNullable<PreviewExecutionTimelineResult["candidates"][number]["storedImage"]>;
    finalPolicy: ReturnType<typeof resolveTimelineFinalGenerationPolicy>;
  }>,
  context: TimelineNodeExecutionContext,
  previous?: ComfyUiExecutionTimelineResult,
) => Promise<ComfyUiExecutionTimelineResult>;

export type TimelineResultDisplayProvider = (
  execution: ComfyUiExecutionTimelineResult,
  context: TimelineNodeExecutionContext,
) => Promise<ResultDisplayTimelineResult> | ResultDisplayTimelineResult;

export type TimelineDirectFinalExecutionProvider = (
  request: ComfyUiTextToImageRequest,
  context: TimelineNodeExecutionContext,
  previous?: ComfyUiExecutionTimelineResult,
) => Promise<ComfyUiExecutionTimelineResult>;

export type TimelineT8NodeAdapterOptions = {
  advancePreviewSeedOnRetry?: boolean;
  executePreviews: TimelinePreviewExecutionProvider;
  scorePreviews: TimelinePreviewScoringProvider;
  executeFinals: TimelineFinalExecutionProvider;
  /** @deprecated T39 compatibility shape; staged adapters never invoke direct execution. */
  executeDirectFinal?: TimelineDirectFinalExecutionProvider;
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

export function getTimelinePreviewDimensions(width: number, height: number, longestEdge = 768, alignment = PREVIEW_DIMENSION_ALIGNMENT) {
  if (![width, height, longestEdge, alignment].every((value) => Number.isSafeInteger(value) && value > 0)) {
    invalidComfyUiRequest("Preview width, height, longest-edge limit, and alignment must be positive integers.");
  }
  const dimensions = getExactAspectAlignedPreviewDimensions(width, height, longestEdge, alignment);
  if (!dimensions) {
    invalidComfyUiRequest(
      `Preview dimensions ${width}x${height} cannot be downscaled to an exact-aspect, ` +
      `${alignment}-pixel-aligned size within longest edge ${longestEdge}. ` +
      "Choose a less extreme aspect ratio or dimensions already within the preview limit.",
      { height, longestEdge, width },
    );
  }
  return dimensions;
}

const KREA2_REID_PREVIEW_MAX_PIXELS = 1_048_576;
const KREA2_REID_PREVIEW_ALIGNMENT = 16;

export function getTimelineReIdPreviewDimensions(width: number, height: number) {
  if (![width, height].every((value) => Number.isSafeInteger(value) && value > 0)) {
    invalidComfyUiRequest("Krea2 ReID Preview width and height must be positive integers.");
  }
  if (width % KREA2_REID_PREVIEW_ALIGNMENT !== 0 || height % KREA2_REID_PREVIEW_ALIGNMENT !== 0) {
    invalidComfyUiRequest("Krea2 ReID Preview dimensions must be 16-pixel aligned.");
  }
  if (width * height <= KREA2_REID_PREVIEW_MAX_PIXELS) return { width, height };

  const ratioDivisor = greatestCommonDivisor(width, height);
  const ratioWidth = width / ratioDivisor;
  const ratioHeight = height / ratioDivisor;
  const widthAlignmentMultiplier = KREA2_REID_PREVIEW_ALIGNMENT /
    greatestCommonDivisor(ratioWidth, KREA2_REID_PREVIEW_ALIGNMENT);
  const heightAlignmentMultiplier = KREA2_REID_PREVIEW_ALIGNMENT /
    greatestCommonDivisor(ratioHeight, KREA2_REID_PREVIEW_ALIGNMENT);
  const alignmentMultiplier = leastCommonMultiple(widthAlignmentMultiplier, heightAlignmentMultiplier);
  const maximumMultiplier = Math.floor(Math.sqrt(
    KREA2_REID_PREVIEW_MAX_PIXELS / (ratioWidth * ratioHeight),
  ));
  const multiplier = Math.floor(maximumMultiplier / alignmentMultiplier) * alignmentMultiplier;
  if (multiplier < alignmentMultiplier) {
    invalidComfyUiRequest(
      `Krea2 ReID Preview dimensions ${width}x${height} cannot preserve exact aspect ratio within ` +
      "1,048,576 pixels while staying 16-pixel aligned.",
    );
  }
  return { width: ratioWidth * multiplier, height: ratioHeight * multiplier };
}

function getTimelineSourceImage(workflow: TimelineWorkflowState) {
  const result = workflow.nodes["scene-input"].result;
  return isRecord(result) ? (result as Partial<SceneInputTimelineResult>).sourceImage : undefined;
}

function normalizeKrea2Dimension(value: unknown, label: "width" | "height") {
  const dimension = typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 1024;
  if (!Number.isSafeInteger(dimension) || dimension < 16 || dimension > 16_384 || dimension % 16 !== 0) {
    invalidComfyUiRequest(
      `Krea 2 Turbo ${label} must be an exact 16-pixel-aligned integer between 16 and 16384; dimensions cannot be rounded before queueing.`,
    );
  }
  return dimension;
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

function assertStyleReferenceUsable(
  workflow: TimelineWorkflowState,
  parameterResult: ParameterRecommendationTimelineResult,
  isKrea2: boolean,
) {
  const sceneInput = workflow.nodes["scene-input"].result;
  const settings = getRunSceneInputSettings(isRecord(sceneInput) ? sceneInput : {});
  const issue = getStyleReferenceBlockingIssue(settings.styleReference, "Run");
  if (issue) invalidComfyUiRequest(issue);
  const characterIssue = getCharacterReferenceBlockingIssue(settings.characterReference);
  if (characterIssue) invalidComfyUiRequest(characterIssue);
  const current = sanitizeStyleReferenceSnapshot(settings.styleReference);
  const reviewed = sanitizeStyleReferenceSnapshot(parameterResult.styleReference);
  if (JSON.stringify(current) !== JSON.stringify(reviewed)) {
    invalidComfyUiRequest("Run style reference changed after parameter review. Regenerate parameters before confirmation.");
  }
  const currentCharacter = sanitizeCharacterReferenceSnapshot(settings.characterReference);
  const reviewedCharacter = sanitizeCharacterReferenceSnapshot(parameterResult.characterReference);
  if (JSON.stringify(currentCharacter) !== JSON.stringify(reviewedCharacter)) {
    invalidComfyUiRequest("Run character reference changed after parameter review. Regenerate parameters before confirmation.");
  }
  if (isKrea2 && isCharacterReferenceReady(currentCharacter) && !isKrea2ReIdReferenceReady(currentCharacter)) {
    invalidComfyUiRequest("Legacy or generic Krea character references cannot be reused as ReID. Replace it through Krea2 ReID preparation.");
  }
  if (!isKrea2 && isKrea2ReIdReferenceReady(currentCharacter)) {
    invalidComfyUiRequest("A prepared Krea2 ReID reference cannot be used by this non-Krea workflow. Remove or replace it.");
  }
  if (isStyleReferenceReady(current)) {
    const stylePrompt = current.analysis.stylePrompt.trim();
    const hasStylePromptExactlyOnce = isKrea2
      ? hasKrea2PromptSegmentExactlyOnceAtTail(parameterResult.requestPreview.positivePrompt, stylePrompt)
      : hasOpaqueStylePromptExactlyOnceAtTail(parameterResult.requestPreview.positivePrompt, stylePrompt);
    if (!hasStylePromptExactlyOnce) {
      invalidComfyUiRequest("Run request preview must include the complete style prompt exactly once at the tail.");
    }
  }
  if (current) {
    const checkpoint = getValidatedStyleReferenceCheckpoint(workflow);
    if (!checkpoint) invalidComfyUiRequest("Run style reference requires a validated checkpoint recommendation.");
    const mismatch = getStyleReferenceContextMismatch(current, {
      checkpointBaseModel: checkpoint.baseModel,
      checkpointId: checkpoint.id,
      promptProfile: settings.promptProfile,
      visualStyle: settings.visualStyle,
    });
    if (mismatch) invalidComfyUiRequest(mismatch);
  }

  const expectedReferenceContext = deriveTimelineConfirmedReferenceContext(workflow);
  const confirmedReferenceContext = getConfirmedTimelineReferenceContext(workflow);
  if (expectedReferenceContext && expectedReferenceContext.references.length > 0 &&
      (expectedReferenceContext.adapter === "krea2-reid" && !confirmedReferenceContext ||
      confirmedReferenceContext &&
        JSON.stringify(expectedReferenceContext) !== JSON.stringify(confirmedReferenceContext))) {
    invalidComfyUiRequest("Run reference settings changed after confirmation. Review and confirm the Run again.");
  }
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
  const sourceImage = getTimelineSourceImage(workflow);
  const sceneInput = workflow.nodes["scene-input"].result;
  const detailers = getGenerationInputDetailers(isRecord(sceneInput) ? sceneInput : {});
  const inputSettings = getRunSceneInputSettings(isRecord(sceneInput) ? sceneInput : {});
  const hasKrea2ReId = isKrea2ReIdReferenceReady(
    sanitizeCharacterReferenceSnapshot(inputSettings.characterReference),
  );
  const isKrea2 = inputSettings.promptProfile === "krea2" ||
    (isRecord(sceneInput) && sceneInput.promptProfile === "krea2") ||
    resolveComfyUiTextToImageWorkflowProfile(parameterResult.requestPreview).id === "krea2";
  assertStyleReferenceUsable(workflow, parameterResult, isKrea2);
  if (isKrea2) {
    const width = normalizeKrea2Dimension(parameterResult.requestPreview.width, "width");
    const height = normalizeKrea2Dimension(parameterResult.requestPreview.height, "height");
    if (sourceImage && hasKrea2ReId) {
      invalidComfyUiRequest(
        "Krea2 ReID blocks Composer source img2img. Remove the source image before confirmation.",
      );
    }
    if (sourceImage && (sourceImage.width !== width || sourceImage.height !== height)) {
      invalidComfyUiRequest(
        "Krea 2 Turbo source img2img dimensions must exactly match the 16-pixel-aligned formal dimensions; regenerate parameters instead of rounding or stretching the source aspect ratio.",
      );
    }
    return {
      ...parameterResult.requestPreview,
      workflowProfile: "krea2",
      modelStorageKind: "diffusion",
      ...(sourceImage ? {
        sourceImageDataUrl: sourceImage.dataUrl,
        imageWidth: sourceImage.width,
        imageHeight: sourceImage.height,
        denoise: normalizeTimelineSourceDenoise(
          isRecord(sceneInput) ? sceneInput.sourceDenoise : undefined,
        ),
      } : {}),
      width,
      height,
      steps: 8,
      cfg: 1,
      samplerName: "euler",
      scheduler: "simple",
      batchSize: 1,
      preview: false,
      faceDetailer: hasKrea2ReId
        ? { ...detailers.faceDetailer, enabled: false }
        : detailers.faceDetailer,
      handDetailer: detailers.handDetailer,
      controlNets: [],
      characterReferences: [],
    };
  }
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
  const sceneInput = workflow.nodes["scene-input"].result;
  const settings = getRunSceneInputSettings(isRecord(sceneInput) ? sceneInput : {});
  const hasKrea2ReId = isKrea2ReIdReferenceReady(
    sanitizeCharacterReferenceSnapshot(settings.characterReference),
  );
  const dimensions = hasKrea2ReId
    ? getTimelineReIdPreviewDimensions(parameterResult.width, parameterResult.height)
    : getTimelinePreviewDimensions(
        parameterResult.width,
        parameterResult.height,
        policy.previewLongestEdge,
        formal.workflowProfile === "krea2" ? 16 : PREVIEW_DIMENSION_ALIGNMENT,
      );
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
  const sceneInput = workflow.nodes["scene-input"].result;
  const visualStyle = getRunSceneInputSettings(isRecord(sceneInput) ? sceneInput : {}).visualStyle;
  if (isRecord(value) && value.rubricVersion === 2 && value.visualStyle === visualStyle &&
      Array.isArray(value.selectedCandidateIds) && Array.isArray(value.scores)) {
    const scores = value.scores;
    const selectedMatch = value.selectedCandidateIds.every((candidateId) =>
      scores.some((score) => isRecord(score) &&
        score.candidateId === candidateId &&
        score.visualStyleMatch === true));
    if (selectedMatch) {
      return value as PreviewScoringTimelineResultV2;
    }
  }
  throw new TimelineNodeExecutionError(createTimelineNodeError(
    "timeline_node_blocked",
    "Current visual-style-verified Preview scoring is required. Retry Preview scoring before Final generation.",
  ));
}

export function createTimelineFinalRequests(workflow: TimelineWorkflowState) {
  const formal = createConfirmedTimelineComfyUiRequest(workflow);
  const sceneInput = workflow.nodes["scene-input"].result;
  const settings = getRunSceneInputSettings(isRecord(sceneInput) ? sceneInput : {});
  const hasReId = isKrea2ReIdReferenceReady(sanitizeCharacterReferenceSnapshot(settings.characterReference));
  const finalPolicy = resolveTimelineFinalGenerationPolicy(formal, settings.finalRedrawPreset, { krea2ReId: hasReId });
  const dimensions = resolveTimelineFinalDimensions({
    request: formal,
    sourceImage: getTimelineSourceImage(workflow),
  });
  if (!dimensions) invalidComfyUiRequest("Confirmed Final dimensions must be positive integers.");
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
      item.scores[0]?.visualStyleMatch !== true ||
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
      formalWidth: dimensions.width,
      formalHeight: dimensions.height,
      request: {
        ...formal,
        sourceImageDataUrl: undefined,
        imageName: undefined,
        width: dimensions.width,
        height: dimensions.height,
        imageWidth: dimensions.width,
        imageHeight: dimensions.height,
        seed: candidate.seed,
        steps: finalPolicy.steps ?? formal.steps,
        denoise: finalPolicy.denoise,
        batchSize: 1,
        preview: false,
      },
      storedPreview: candidate.storedImage!,
      finalPolicy,
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
