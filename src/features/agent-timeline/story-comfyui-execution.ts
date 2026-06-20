import fs from "node:fs/promises";

import {
  createComfyUiClient,
  createComfyUiTextToImagePreviewRequest,
  extractComfyUiHistoryImages,
  isComfyUiPromptHistoryComplete,
  validateComfyUiRequestAgainstObjectInfo,
  validateComfyUiTextToImageRequest,
  type ComfyUiGenerateImageResponse,
  type ComfyUiClient,
  type ComfyUiQueuePromptOptions,
  type ComfyUiRequestObjectInfoValidation,
  type ComfyUiTextToImageRequest,
  type ComfyUiTextToImageValidationResult,
  type ComfyUiViewImageReference,
} from "@/features/comfyui";
import {
  getGeneratedImageContentType,
  getGeneratedImagePath,
  sanitizeComfyUiViewImageReference,
  storeGeneratedImage,
} from "@/features/comfyui/generated-image-storage";

import type {
  StoryShotExecutionAdapter,
  StoryShotQueueMetadata,
  StoryShotResultImageReference,
  StoryShotResultReference,
} from "./story-execution";

const DEFAULT_COMFYUI_BASE_URL = "http://127.0.0.1:8188";
const DEFAULT_HISTORY_POLL_INTERVAL_MS = 2000;
const DEFAULT_HISTORY_POLL_TIMEOUT_MS = 60 * 60 * 1000;
const DEFAULT_HISTORY_POLL_ATTEMPTS = Math.ceil(
  DEFAULT_HISTORY_POLL_TIMEOUT_MS / DEFAULT_HISTORY_POLL_INTERVAL_MS,
);

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
  uploadImage: ComfyUiClient["uploadImage"];
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

function getConfiguredComfyUiViewUrlParts() {
  const baseUrl = new URL(process.env.COMFYUI_BASE_URL ?? DEFAULT_COMFYUI_BASE_URL);
  const basePath = baseUrl.pathname.replace(/\/+$/, "");

  return {
    origin: baseUrl.origin,
    viewPath: `${basePath}/view`.replace(/^\/?/, "/"),
  };
}

function assertAllowedComfyUiImageUrl(url: string) {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    throw new StoryComfyUiExecutionError("ComfyUI image request URL is invalid.", { url });
  }

  const allowed = getConfiguredComfyUiViewUrlParts();
  if (parsed.origin !== allowed.origin || parsed.pathname !== allowed.viewPath) {
    throw new StoryComfyUiExecutionError("ComfyUI image request URL is not from the configured ComfyUI view endpoint.", {
      allowedOrigin: allowed.origin,
      allowedPath: allowed.viewPath,
      url,
    });
  }

  return parsed;
}

async function defaultFetchImage(url: string) {
  assertAllowedComfyUiImageUrl(url);
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

function getImageExtension(contentType: string | null) {
  const normalized = contentType?.split(";")[0]?.trim().toLocaleLowerCase();
  if (normalized === "image/jpeg" || normalized === "image/jpg") {
    return "jpg";
  }

  if (normalized === "image/webp") {
    return "webp";
  }

  return "png";
}

function getImageMimeType(contentType: string | null) {
  const normalized = contentType?.split(";")[0]?.trim().toLocaleLowerCase();
  return normalized === "image/jpeg" || normalized === "image/jpg" || normalized === "image/webp"
    ? normalized
    : "image/png";
}

function safeSourceImageName(sourceShotId: string, extension: string) {
  const safeShotId = sourceShotId
    .toLocaleLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "source";

  return `sceneforge-story-${safeShotId}.${extension}`;
}

function getComfyUiSourceImageUrl(
  client: StoryComfyUiExecutionClient,
  reference: StoryShotResultReference,
) {
  const image = [reference.image, ...(reference.images ?? [])]
    .find((candidate) => typeof candidate?.filename === "string" && candidate.filename.trim());

  if (!image) {
    return null;
  }

  const safeImage = sanitizeComfyUiViewImageReference(image);
  return client.buildViewUrl(safeImage);
}

async function readStoredSourceImage(reference: StoryShotResultReference) {
  const storedImage = [reference.storedImage, ...(reference.storedImages ?? [])]
    .find((candidate) => typeof candidate?.filename === "string" && candidate.filename.trim());

  if (!storedImage) {
    return null;
  }

  const filePath = getGeneratedImagePath(storedImage.filename);
  if (!filePath) {
    throw new StoryComfyUiExecutionError("Source shot local generated image filename is invalid.", {
      filename: storedImage.filename,
    });
  }

  return {
    bytes: new Uint8Array(await fs.readFile(filePath)),
    contentType: getGeneratedImageContentType(storedImage.filename),
  };
}

async function uploadSourceShotImage({
  client,
  fetchImage,
  reference,
  sourceShotId,
}: {
  client: StoryComfyUiExecutionClient;
  fetchImage: FetchImage;
  reference: StoryShotResultReference;
  sourceShotId: string;
}) {
  const url = getComfyUiSourceImageUrl(client, reference);
  const response = url ? await fetchImage(url) : await readStoredSourceImage(reference);
  if (!response) {
    throw new StoryComfyUiExecutionError(`Source shot "${sourceShotId}" did not include a usable generated image reference.`, {
      sourceShotId,
    });
  }
  const extension = getImageExtension(response.contentType);
  const uploaded = await client.uploadImage({
    bytes: response.bytes,
    filename: safeSourceImageName(sourceShotId, extension),
    mimeType: getImageMimeType(response.contentType),
    overwrite: true,
    type: "input",
  });

  return uploaded.imageName;
}

async function applySourceShotInputs({
  client,
  fetchImage,
  request,
  sourceResults,
  sourceShotIds,
}: {
  client: StoryComfyUiExecutionClient;
  fetchImage: FetchImage;
  request: ComfyUiTextToImageRequest;
  sourceResults: Record<string, StoryShotResultReference>;
  sourceShotIds: string[];
}): Promise<ComfyUiTextToImageRequest> {
  if (sourceShotIds.length === 0) {
    return request;
  }

  const sourceImages = await Promise.all(sourceShotIds.map(async (sourceShotId) => {
    const reference = sourceResults[sourceShotId];
    if (!reference) {
      throw new StoryComfyUiExecutionError(`Source shot "${sourceShotId}" was not available for Story ComfyUI execution.`, {
        sourceShotId,
      });
    }

    return {
      imageName: await uploadSourceShotImage({
        client,
        fetchImage,
        reference,
        sourceShotId,
      }),
      sourceShotId,
    };
  }));
  const [primarySource, ...referenceSources] = sourceImages;

  return {
    ...request,
    imageName: primarySource?.imageName ?? request.imageName,
    characterReferences: referenceSources.length > 0
      ? [
          ...(request.characterReferences ?? []),
          ...referenceSources.map((source) => ({
            id: `source-${source.sourceShotId}`,
            name: `Source shot ${source.sourceShotId}`,
            prompt: `Reference generated by source shot ${source.sourceShotId}.`,
            mode: "ipadapter" as const,
            images: [
              {
                id: `source-${source.sourceShotId}-image`,
                imageName: source.imageName,
              },
            ],
            weight: 0.35,
            startPercent: 0,
            endPercent: 1,
          })),
        ]
      : request.characterReferences,
  };
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

  return async ({ request, sourceResults }) => {
    const validation = validateRequest(request.request);
    if (!validation.ok) {
      throw new StoryComfyUiExecutionError(validation.message, validation.details);
    }

    const previewRequest = validation.request.preview
      ? createComfyUiTextToImagePreviewRequest(validation.request)
      : validation.request;
    const generationRequest = await applySourceShotInputs({
      client,
      fetchImage,
      request: previewRequest,
      sourceResults,
      sourceShotIds: request.sourceShotIds,
    });
    const sourceValidation = generationRequest === validation.request
      ? validation
      : validateRequest(generationRequest);
    if (!sourceValidation.ok) {
      throw new StoryComfyUiExecutionError(sourceValidation.message, sourceValidation.details);
    }
    const objectInfo = await client.getObjectInfo();
    const objectValidation = validateObjectInfo(sourceValidation.request, objectInfo);

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
