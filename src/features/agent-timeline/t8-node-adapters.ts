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
  TimelineNodeExecutionError,
  type ComfyUiExecutionTimelineResult,
  type ParameterRecommendationTimelineResult,
  type ResultDisplayTimelineResult,
  type SceneInputTimelineResult,
  type TimelineNodeAdapters,
  type TimelineNodeExecutionContext,
  type TimelineWorkflowState,
} from "./types";

export type TimelineComfyUiExecutionProvider = (
  request: ComfyUiTextToImageRequest,
  context: TimelineNodeExecutionContext,
) => Promise<ComfyUiExecutionTimelineResult> | ComfyUiExecutionTimelineResult;

export type TimelineResultDisplayProvider = (
  execution: ComfyUiExecutionTimelineResult,
  context: TimelineNodeExecutionContext,
) => Promise<ResultDisplayTimelineResult> | ResultDisplayTimelineResult;

export type TimelineT8NodeAdapterOptions = {
  executeTextToImage: TimelineComfyUiExecutionProvider;
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

  if (
    isRecord(result) &&
    isRecord(result.requestPreview) &&
    typeof result.requestPreview.checkpointName === "string" &&
    typeof result.requestPreview.positivePrompt === "string"
  ) {
    return result as ParameterRecommendationTimelineResult;
  }

  invalidComfyUiRequest("Parameter recommendation must include a ComfyUI request preview before execution.", {
    result,
  });
}

function getTimelineImageCount(workflow: TimelineWorkflowState) {
  const result = workflow.nodes["scene-input"].result;
  if (isRecord(result)) {
    const sceneInput = result as Partial<SceneInputTimelineResult>;
    return sceneInput.sourceImage ? 1 : normalizeTimelineImageCount(result.imageCount);
  }

  return normalizeTimelineImageCount(undefined);
}

function getTimelineSourceImage(workflow: TimelineWorkflowState) {
  const result = workflow.nodes["scene-input"].result;

  if (!isRecord(result)) {
    return undefined;
  }

  const sceneInput = result as Partial<SceneInputTimelineResult>;
  return sceneInput.sourceImage;
}

function assertGenerationConfirmed(workflow: TimelineWorkflowState) {
  const gateResult = workflow.nodes["generation-gate"].result;
  const gateConfirmed = isRecord(gateResult) && gateResult.confirmed === true;

  if (!workflow.generationConfirmed || !gateConfirmed) {
    throw new TimelineNodeExecutionError(
      createTimelineNodeError(
        "confirmation_required",
        "Confirm generation before constructing or executing a ComfyUI request.",
      ),
    );
  }
}

function hasOpaqueStylePromptExactlyOnceAtTail(promptValue: string, stylePromptValue: string) {
  const prompt = promptValue.trim();
  const stylePrompt = stylePromptValue.trim();
  if (!stylePrompt) {
    return false;
  }
  if (prompt === stylePrompt) {
    return true;
  }

  const suffix = `, ${stylePrompt}`;
  if (!prompt.endsWith(suffix)) {
    return false;
  }

  const prefix = prompt.slice(0, -suffix.length).trimEnd();
  const escapedStylePrompt = stylePrompt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const completeSegmentPattern = new RegExp(`(?:^|, )${escapedStylePrompt}(?:, |$)`);
  return !completeSegmentPattern.test(prefix);
}

function getValidatedStyleReferenceCheckpoint(workflow: TimelineWorkflowState) {
  const result = workflow.nodes["resource-recommendation"].result;
  if (!isRecord(result) || !isRecord(result.checkpoint) || !isRecord(result.checkpoint.resource)) {
    return null;
  }

  const checkpoint = result.checkpoint.resource;
  if (
    typeof checkpoint.id !== "string" || !checkpoint.id.trim() ||
    typeof checkpoint.modelFileName !== "string" || !checkpoint.modelFileName.trim()
  ) {
    return null;
  }
  return {
    id: checkpoint.id.trim(),
    modelFileName: checkpoint.modelFileName.trim(),
    ...(typeof checkpoint.baseModel === "string" ? { baseModel: checkpoint.baseModel } : {}),
  };
}

function assertStyleReferenceUsable(
  workflow: TimelineWorkflowState,
  parameterResult: ParameterRecommendationTimelineResult,
) {
  const sceneInput = workflow.nodes["scene-input"].result;
  const settings = getRunSceneInputSettings(isRecord(sceneInput) ? sceneInput : {});
  const blockingIssue = getStyleReferenceBlockingIssue(settings.styleReference, "Run");
  if (blockingIssue) {
    invalidComfyUiRequest(blockingIssue);
  }
  const currentStyleReference = sanitizeStyleReferenceSnapshot(settings.styleReference);
  const reviewedStyleReference = sanitizeStyleReferenceSnapshot(parameterResult.styleReference);
  if (JSON.stringify(reviewedStyleReference) !== JSON.stringify(currentStyleReference)) {
    invalidComfyUiRequest(
      "Run style reference changed after parameter review. Regenerate the parameter recommendation before confirmation.",
    );
  }
  if (currentStyleReference) {
    if (isStyleReferenceReady(currentStyleReference)) {
      const stylePrompt = currentStyleReference.analysis.stylePrompt.trim();
      const previewPrompt = parameterResult.requestPreview.positivePrompt.trim();
      if (!hasOpaqueStylePromptExactlyOnceAtTail(previewPrompt, stylePrompt)) {
        invalidComfyUiRequest(
          "Run request preview must include the complete style reference prompt exactly once after prompt formatting.",
        );
      }
    }
    const checkpoint = getValidatedStyleReferenceCheckpoint(workflow);
    if (!checkpoint) {
      invalidComfyUiRequest(
        "Run style reference confirmation requires a validated checkpoint recommendation. Regenerate resources before confirmation.",
      );
    }
    const mismatch = getStyleReferenceContextMismatch(currentStyleReference, {
      checkpointBaseModel: typeof checkpoint.baseModel === "string" ? checkpoint.baseModel : undefined,
      checkpointId: checkpoint.id,
      promptProfile: settings.promptProfile,
    });
    if (mismatch) {
      invalidComfyUiRequest(mismatch);
    }
  }
}

export function createConfirmedTimelineComfyUiRequest(
  workflow: TimelineWorkflowState,
): ComfyUiTextToImageRequest {
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
    ...(sourceImage
      ? {
          sourceImageDataUrl: sourceImage.dataUrl,
          imageWidth: sourceImage.width,
          imageHeight: sourceImage.height,
        }
      : {}),
    batchSize: getTimelineImageCount(workflow),
    preview: false,
  };
}

function getComfyUiExecutionResult(workflow: TimelineWorkflowState): ComfyUiExecutionTimelineResult {
  const result = workflow.nodes["comfyui-execution"].result;

  if (
    isRecord(result) &&
    typeof result.promptId === "string" &&
    typeof result.outputNodeId === "string" &&
    isRecord(result.request)
  ) {
    return result as ComfyUiExecutionTimelineResult;
  }

  throw new TimelineNodeExecutionError(
    createTimelineNodeError("comfyui_execution_failed", "ComfyUI execution did not return queue metadata.", {
      result,
    }),
  );
}

export function createTimelineT8NodeAdapters({
  executeTextToImage,
  loadResultDisplay,
}: TimelineT8NodeAdapterOptions): TimelineNodeAdapters {
  return {
    "comfyui-execution": async (context) => ({
      value: await executeTextToImage(createConfirmedTimelineComfyUiRequest(context.workflow), context),
      source: "system",
    }),
    "result-display": async (context) => ({
      value: await loadResultDisplay(getComfyUiExecutionResult(context.workflow), context),
      source: "system",
    }),
  };
}
