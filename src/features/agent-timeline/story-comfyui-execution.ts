import {
  createComfyUiClient,
  createComfyUiTextToImagePreviewRequest,
  extractComfyUiHistoryImages,
  isComfyUiPromptHistoryComplete,
  validateComfyUiRequestAgainstObjectInfo,
  validateComfyUiTextToImageRequest,
  type ComfyUiGenerateImageResponse,
  type ComfyUiQueuePromptOptions,
  type ComfyUiRequestObjectInfoValidation,
  type ComfyUiTextToImageRequest,
  type ComfyUiTextToImageValidationResult,
  type ComfyUiViewImageReference,
} from "@/features/comfyui";
import {
  storeGeneratedImage,
} from "@/features/comfyui/generated-image-storage";

import type {
  StoryShotExecutionAdapter,
  StoryShotQueueMetadata,
  StoryShotResultImageReference,
} from "./story-execution";

const DEFAULT_COMFYUI_BASE_URL = "http://127.0.0.1:8188";
const DEFAULT_HISTORY_POLL_ATTEMPTS = 20;
const DEFAULT_HISTORY_POLL_INTERVAL_MS = 500;

type StoreGeneratedImage = typeof storeGeneratedImage;
type FetchImage = (url: string) => Promise<{
  bytes: Uint8Array;
  contentType: string | null;
}>;

export type StoryComfyUiExecutionClient = {
  buildViewUrl: (reference: ComfyUiViewImageReference) => string;
  generateImage: (
    request: ComfyUiTextToImageRequest,
    options?: ComfyUiQueuePromptOptions,
  ) => Promise<ComfyUiGenerateImageResponse>;
  getHistory: (promptId: string) => Promise<unknown>;
  getObjectInfo: () => Promise<unknown>;
};

export type StoryComfyUiExecutionAdapterOptions = {
  client?: StoryComfyUiExecutionClient;
  fetchImage?: FetchImage;
  historyPollAttempts?: number;
  historyPollIntervalMs?: number;
  now?: () => string;
  storeImage?: StoreGeneratedImage;
  validateObjectInfo?: (
    request: ComfyUiTextToImageRequest,
    objectInfo: unknown,
  ) => ComfyUiRequestObjectInfoValidation;
  validateRequest?: (value: unknown) => ComfyUiTextToImageValidationResult;
};

export class StoryComfyUiExecutionError extends Error {
  readonly details?: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.name = "StoryComfyUiExecutionError";
    this.details = details;
  }
}

function createDefaultClient(): StoryComfyUiExecutionClient {
  return createComfyUiClient({
    baseUrl: process.env.COMFYUI_BASE_URL ?? DEFAULT_COMFYUI_BASE_URL,
    apiKey: process.env.COMFYUI_API_KEY || undefined,
  });
}

async function defaultFetchImage(url: string) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      accept: "image/*",
      ...(process.env.COMFYUI_API_KEY ? { authorization: `Bearer ${process.env.COMFYUI_API_KEY}` } : {}),
    },
  });

  if (!response.ok) {
    const details = await response.text().catch(() => null);
    throw new StoryComfyUiExecutionError("ComfyUI image request failed.", {
      details,
      status: response.status,
      url,
    });
  }

  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    contentType: response.headers.get("content-type"),
  };
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function normalizeQueueMetadata(
  queued: ComfyUiGenerateImageResponse,
  warnings: string[],
  queuedAt: string,
): StoryShotQueueMetadata {
  return {
    nodeErrors: queued.nodeErrors,
    nodeIds: queued.nodeIds,
    number: queued.number,
    outputNodeId: queued.outputNodeId,
    promptId: queued.promptId,
    queuedAt,
    warnings,
  };
}

function toStoryImageReference(
  image: StoryShotResultImageReference,
): StoryShotResultImageReference {
  return { ...image };
}

async function waitForCompleteHistory({
  client,
  intervalMs,
  maxAttempts,
  promptId,
}: {
  client: StoryComfyUiExecutionClient;
  intervalMs: number;
  maxAttempts: number;
  promptId: string;
}) {
  let lastHistory: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    lastHistory = await client.getHistory(promptId);

    if (isComfyUiPromptHistoryComplete(lastHistory, promptId)) {
      return lastHistory;
    }

    if (intervalMs > 0) {
      await sleep(intervalMs);
    }
  }

  throw new StoryComfyUiExecutionError("Timed out waiting for ComfyUI prompt history completion.", {
    attempts: maxAttempts,
    promptId,
    raw: lastHistory,
  });
}

async function storeHistoryImages({
  client,
  fetchImage,
  history,
  promptId,
  storeImage,
}: {
  client: StoryComfyUiExecutionClient;
  fetchImage: FetchImage;
  history: unknown;
  promptId: string;
  storeImage: StoreGeneratedImage;
}) {
  const images = extractComfyUiHistoryImages(history, promptId).map((image) => ({
    ...image,
    url: client.buildViewUrl(image),
  }));
  const storedImages = await Promise.all(
    images.map(async (image) => {
      const response = await fetchImage(image.url);
      return storeImage(response.bytes, response.contentType);
    }),
  );

  return {
    images: images.map(toStoryImageReference),
    storedImages,
  };
}

export function createStoryComfyUiExecutionAdapter(
  options: StoryComfyUiExecutionAdapterOptions = {},
): StoryShotExecutionAdapter {
  const client = options.client ?? createDefaultClient();
  const fetchImage = options.fetchImage ?? defaultFetchImage;
  const historyPollAttempts = options.historyPollAttempts ?? DEFAULT_HISTORY_POLL_ATTEMPTS;
  const historyPollIntervalMs = options.historyPollIntervalMs ?? DEFAULT_HISTORY_POLL_INTERVAL_MS;
  const now = options.now ?? (() => new Date().toISOString());
  const storeImage = options.storeImage ?? storeGeneratedImage;
  const validateObjectInfo = options.validateObjectInfo ?? validateComfyUiRequestAgainstObjectInfo;
  const validateRequest = options.validateRequest ?? validateComfyUiTextToImageRequest;

  return async ({ request }) => {
    const validation = validateRequest(request.request);
    if (!validation.ok) {
      throw new StoryComfyUiExecutionError(validation.message, validation.details);
    }

    const generationRequest = validation.request.preview
      ? createComfyUiTextToImagePreviewRequest(validation.request)
      : validation.request;
    const objectInfo = await client.getObjectInfo();
    const objectValidation = validateObjectInfo(generationRequest, objectInfo);

    if (objectValidation.errors.length > 0) {
      throw new StoryComfyUiExecutionError("ComfyUI request does not match the current ComfyUI model/node options.", {
        errors: objectValidation.errors,
        warnings: objectValidation.warnings,
      });
    }

    const queuedAt = now();
    const queued = await client.generateImage(objectValidation.request, {
      clientId: `${request.shotId}:${queuedAt}`,
    });
    const queueMetadata = normalizeQueueMetadata(queued, objectValidation.warnings, queuedAt);
    const history = await waitForCompleteHistory({
      client,
      intervalMs: historyPollIntervalMs,
      maxAttempts: historyPollAttempts,
      promptId: queued.promptId,
    });
    const { images, storedImages } = await storeHistoryImages({
      client,
      fetchImage,
      history,
      promptId: queued.promptId,
      storeImage,
    });

    return {
      queueMetadata,
      resultReference: {
        completed: true,
        image: images[0],
        images,
        promptId: queued.promptId,
        shotId: request.shotId,
        storedImage: storedImages[0],
        storedImages,
        warnings: [...objectValidation.warnings],
      },
    };
  };
}
