import type { ComfyUiTextToImageRequest } from "@/features/comfyui";

import { createTimelineNodeError, normalizeTimelineImageCount } from "./state";
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

export function createConfirmedTimelineComfyUiRequest(
  workflow: TimelineWorkflowState,
): ComfyUiTextToImageRequest {
  assertGenerationConfirmed(workflow);

  const parameterResult = getParameterRecommendationResult(workflow);
  const sourceImage = getTimelineSourceImage(workflow);

  return {
    ...parameterResult.requestPreview,
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
