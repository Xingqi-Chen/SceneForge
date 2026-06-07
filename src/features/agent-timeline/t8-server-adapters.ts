import {
  ComfyUiApiError,
  createComfyUiClient,
  extractComfyUiHistoryImages,
  isComfyUiPromptHistoryComplete,
  summarizeComfyUiErrorDetails,
  validateComfyUiRequestAgainstObjectInfo,
  validateComfyUiTextToImageRequest,
  type ComfyUiTextToImageRequest,
} from "@/features/comfyui";
import { uploadComfyUiTextToImageSourceImage } from "@/features/comfyui/source-image-upload";
import {
  storeGeneratedImage,
} from "@/features/comfyui/generated-image-storage";

import { createTimelineNodeError } from "./state";
import { createTimelineT8NodeAdapters } from "./t8-node-adapters";
import {
  TimelineNodeExecutionError,
  type ComfyUiExecutionTimelineResult,
  type ResultDisplayTimelineResult,
  type TimelineStoredGeneratedImage,
  type TimelineNodeAdapters,
  type TimelineNodeExecutionContext,
} from "./types";

const DEFAULT_COMFYUI_BASE_URL = "http://127.0.0.1:8188";
const TIMELINE_HISTORY_POLL_INTERVAL_MS = 2000;
const TIMELINE_HISTORY_POLL_TIMEOUT_MS = 60 * 60 * 1000;

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function makeComfyUiErrorMessage(error: ComfyUiApiError) {
  const summaries = summarizeComfyUiErrorDetails(error.details);
  if (summaries.length === 0) {
    return error.message;
  }

  return `ComfyUI prompt validation failed: ${summaries.join(" | ")}`;
}

function makeClient() {
  return createComfyUiClient({
    baseUrl: process.env.COMFYUI_BASE_URL ?? DEFAULT_COMFYUI_BASE_URL,
    apiKey: process.env.COMFYUI_API_KEY || undefined,
  });
}

function readClientId(context: TimelineNodeExecutionContext) {
  return `timeline-${context.workflow.workflowId}`;
}

function throwTimelineComfyUiError(error: ComfyUiApiError): never {
  throw new TimelineNodeExecutionError(
    createTimelineNodeError("comfyui_upstream", makeComfyUiErrorMessage(error), {
      details: error.details,
      statusCode: error.statusCode,
    }),
  );
}

function makeObjectInfoMismatchMessage(errors: string[]) {
  return [
    "ComfyUI request does not match the current ComfyUI model/node options.",
    ...errors,
  ].join(" ");
}

async function executeTimelineTextToImage(
  request: ComfyUiTextToImageRequest,
  context: TimelineNodeExecutionContext,
): Promise<ComfyUiExecutionTimelineResult> {
  const validation = validateComfyUiTextToImageRequest(request);
  if (!validation.ok) {
    throw new TimelineNodeExecutionError(
      createTimelineNodeError("comfyui_request_invalid", validation.message, validation.details),
    );
  }

  try {
    const client = makeClient();
    const objectInfo = await client.getObjectInfo();
    const requestWithSourceImage = await uploadComfyUiTextToImageSourceImage(client, validation.request);
    const objectValidation = validateComfyUiRequestAgainstObjectInfo(requestWithSourceImage, objectInfo);

    if (objectValidation.errors.length > 0) {
      throw new TimelineNodeExecutionError(
        createTimelineNodeError(
          "comfyui_object_info_mismatch",
          makeObjectInfoMismatchMessage(objectValidation.errors),
          {
            errors: objectValidation.errors,
            warnings: objectValidation.warnings,
          },
        ),
      );
    }

    const result = await client.generateImage(objectValidation.request, {
      clientId: readClientId(context),
    });

    return {
      nodeErrors: result.nodeErrors,
      nodeIds: result.nodeIds,
      number: result.number,
      outputNodeId: result.outputNodeId,
      promptId: result.promptId,
      request: {
        ...result.request,
        sourceImageDataUrl: "",
      },
      warnings: objectValidation.warnings,
      workflow: result.workflow,
    };
  } catch (error) {
    if (error instanceof TimelineNodeExecutionError) {
      throw error;
    }

    if (error instanceof ComfyUiApiError) {
      throwTimelineComfyUiError(error);
    }

    throw new TimelineNodeExecutionError(
      createTimelineNodeError("comfyui_execution_failed", "Unexpected ComfyUI execution failure.", {
        error,
      }),
    );
  }
}

async function waitForTimelineResultImage(
  execution: ComfyUiExecutionTimelineResult,
): Promise<ResultDisplayTimelineResult> {
  const client = makeClient();
  const deadline = Date.now() + TIMELINE_HISTORY_POLL_TIMEOUT_MS;
  let latestRaw: unknown = null;

  while (Date.now() < deadline) {
    const raw = await client.getHistory(execution.promptId);
    latestRaw = raw;
    const images = extractComfyUiHistoryImages(raw, execution.promptId);

    if (images.length > 0) {
      const storedImages: TimelineStoredGeneratedImage[] = [];

      for (const sourceImage of images) {
        const response = await fetch(client.buildViewUrl(sourceImage), {
          cache: "no-store",
          headers: {
            accept: "image/*",
            ...(process.env.COMFYUI_API_KEY ? { authorization: `Bearer ${process.env.COMFYUI_API_KEY}` } : {}),
          },
        });

        if (!response.ok) {
          const details = await response.text().catch(() => null);
          throw new TimelineNodeExecutionError(
            createTimelineNodeError("image_storage_failed", "ComfyUI image request failed.", {
              details,
              sourceImage,
              statusCode: response.status,
            }),
          );
        }

        storedImages.push(await storeGeneratedImage(
          new Uint8Array(await response.arrayBuffer()),
          response.headers.get("content-type"),
        ));
      }

      const sourceImage = images[0];
      const storedImage = storedImages[0];
      if (!sourceImage || !storedImage) {
        throw new TimelineNodeExecutionError(
          createTimelineNodeError("image_storage_failed", "ComfyUI image storage did not produce an image."),
        );
      }

      return {
        completed: isComfyUiPromptHistoryComplete(raw, execution.promptId),
        image: {
          ...sourceImage,
          url: storedImage.url,
        },
        images: images.map((image, index) => ({
          ...image,
          url: storedImages[index]?.url ?? storedImage.url,
        })),
        promptId: execution.promptId,
        sourceImage,
        sourceImages: images,
        storedImage,
        storedImages,
        warnings: execution.warnings,
      };
    }

    if (isComfyUiPromptHistoryComplete(raw, execution.promptId)) {
      throw new TimelineNodeExecutionError(
        createTimelineNodeError("comfyui_execution_failed", "ComfyUI completed without a returned image.", {
          promptId: execution.promptId,
          raw,
        }),
      );
    }

    await delay(TIMELINE_HISTORY_POLL_INTERVAL_MS);
  }

  throw new TimelineNodeExecutionError(
    createTimelineNodeError("comfyui_execution_failed", "Timed out waiting for ComfyUI image output.", {
      promptId: execution.promptId,
      raw: latestRaw,
    }),
  );
}

async function loadTimelineResultDisplay(
  execution: ComfyUiExecutionTimelineResult,
): Promise<ResultDisplayTimelineResult> {
  try {
    return await waitForTimelineResultImage(execution);
  } catch (error) {
    if (error instanceof TimelineNodeExecutionError) {
      throw error;
    }

    if (error instanceof ComfyUiApiError) {
      throwTimelineComfyUiError(error);
    }

    throw new TimelineNodeExecutionError(
      createTimelineNodeError("image_storage_failed", "Unexpected timeline result display failure.", {
        error,
      }),
    );
  }
}

export function createTimelineT8ServerNodeAdapters(): TimelineNodeAdapters {
  return createTimelineT8NodeAdapters({
    executeTextToImage: executeTimelineTextToImage,
    loadResultDisplay: loadTimelineResultDisplay,
  });
}
