import {
  createComfyUiClient,
  extractComfyUiHistoryImages,
  isComfyUiAnimaTextToImageRequest,
  isComfyUiPromptHistoryComplete,
  validateComfyUiRequestAgainstObjectInfo,
  validateComfyUiTextToImageRequest,
  type ComfyUiGenerateImageResponse,
  type ComfyUiRequestObjectInfoValidation,
  type ComfyUiTextToImageRequest,
  type ComfyUiTextToImageValidationResult,
  type ComfyUiViewImageReference,
} from "@/features/comfyui";
import {
  storeGeneratedImage,
} from "@/features/comfyui/generated-image-storage";

import {
  createStoryReferencePlateComfyUiRequest,
  type StoryParameterPlan,
  type StoryResourcePlan,
} from "./story-planning";
import type {
  StoryNsfwContext,
  StoryReferenceAsset,
  StoryReferenceAssetReference,
} from "./story-types";

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

export type StoryReferencePlateGenerationClient = {
  buildViewUrl: (reference: ComfyUiViewImageReference) => string;
  generateImage: (request: ComfyUiTextToImageRequest, options?: { clientId?: string }) => Promise<ComfyUiGenerateImageResponse>;
  getHistory: (promptId: string) => Promise<unknown>;
  getObjectInfo: () => Promise<unknown>;
};

export type StoryReferencePlateGenerationContext = {
  nsfwContext: StoryNsfwContext;
  parameterPlan: StoryParameterPlan;
  reference: StoryReferenceAsset;
  resourcePlan: StoryResourcePlan;
};

export type StoryReferencePlateGenerationAdapter = (
  context: StoryReferencePlateGenerationContext,
) => Promise<StoryReferenceAssetReference> | StoryReferenceAssetReference;

export type StoryReferencePlateGenerationAdapterOptions = {
  client?: StoryReferencePlateGenerationClient;
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

export class StoryReferencePlateGenerationError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, code = "comfyui_execution_failed", details?: unknown) {
    super(message);
    this.name = "StoryReferencePlateGenerationError";
    this.code = code;
    this.details = details;
  }
}

function createDefaultClient(): StoryReferencePlateGenerationClient {
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
    throw new StoryReferencePlateGenerationError("ComfyUI reference image URL is invalid.", "comfyui_upstream", { url });
  }

  const allowed = getConfiguredComfyUiViewUrlParts();
  if (parsed.origin !== allowed.origin || parsed.pathname !== allowed.viewPath) {
    throw new StoryReferencePlateGenerationError(
      "ComfyUI reference image URL is not from the configured ComfyUI view endpoint.",
      "comfyui_upstream",
      {
        allowedOrigin: allowed.origin,
        allowedPath: allowed.viewPath,
        url,
      },
    );
  }
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
    throw new StoryReferencePlateGenerationError("ComfyUI reference image request failed.", "comfyui_upstream", {
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

async function waitForCompleteHistory({
  client,
  intervalMs,
  maxAttempts,
  promptId,
}: {
  client: StoryReferencePlateGenerationClient;
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

  throw new StoryReferencePlateGenerationError("Timed out waiting for ComfyUI reference plate completion.", "comfyui_execution_failed", {
    attempts: maxAttempts,
    promptId,
    raw: lastHistory,
  });
}

function getReferenceClientId(referenceId: string, queuedAt: string) {
  const safeReferenceId = referenceId
    .toLocaleLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "reference";

  return `story-reference:${safeReferenceId}:${queuedAt}`;
}

function assertAnimaReferenceRequest(request: ComfyUiTextToImageRequest, resourcePlan: StoryResourcePlan) {
  if (isComfyUiAnimaTextToImageRequest(request)) {
    return;
  }

  throw new StoryReferencePlateGenerationError(
    "Story reference plate generation requires a selected Anima-compatible checkpoint.",
    "resource_selection_invalid",
    {
      checkpointResourceId: resourcePlan.checkpoint.resource.id,
      checkpointName: resourcePlan.checkpoint.resource.name,
      modelBaseModel: resourcePlan.checkpoint.resource.modelBaseModel ?? resourcePlan.checkpoint.resource.baseModel,
      workflowProfile: request.workflowProfile,
    },
  );
}

function toAssetReference({
  completedAt,
  objectValidation,
  promptId,
  reference,
  resourcePlan,
  stored,
}: {
  completedAt: string;
  objectValidation: ComfyUiRequestObjectInfoValidation;
  promptId: string;
  reference: StoryReferenceAsset;
  resourcePlan: StoryResourcePlan;
  stored: Awaited<ReturnType<StoreGeneratedImage>>;
}): StoryReferenceAssetReference {
  return {
    byteLength: stored.byteLength,
    contentType: stored.contentType,
    createdAt: completedAt,
    filename: stored.filename,
    metadata: {
      checkpointResourceId: resourcePlan.checkpoint.resource.id,
      height: objectValidation.request.height,
      loraResourceIds: resourcePlan.loras.map((lora) => lora.resource.id),
      negativePrompt: objectValidation.request.negativePrompt,
      positivePrompt: objectValidation.request.positivePrompt,
      promptId,
      referenceId: reference.id,
      warnings: [...objectValidation.warnings],
      width: objectValidation.request.width,
      workflowProfile: objectValidation.request.workflowProfile,
    },
    source: "generated",
    url: stored.url,
  };
}

export function createStoryReferenceComfyUiGenerationAdapter(
  options: StoryReferencePlateGenerationAdapterOptions = {},
): StoryReferencePlateGenerationAdapter {
  const client = options.client ?? createDefaultClient();
  const fetchImage = options.fetchImage ?? defaultFetchImage;
  const historyPollAttempts = options.historyPollAttempts ?? DEFAULT_HISTORY_POLL_ATTEMPTS;
  const historyPollIntervalMs = options.historyPollIntervalMs ?? DEFAULT_HISTORY_POLL_INTERVAL_MS;
  const now = options.now ?? (() => new Date().toISOString());
  const storeImage = options.storeImage ?? storeGeneratedImage;
  const validateObjectInfo = options.validateObjectInfo ?? validateComfyUiRequestAgainstObjectInfo;
  const validateRequest = options.validateRequest ?? validateComfyUiTextToImageRequest;

  return async ({ nsfwContext, parameterPlan, reference, resourcePlan }) => {
    const request = createStoryReferencePlateComfyUiRequest({
      nsfwContext,
      parameterPlan,
      reference,
      resourcePlan,
    });
    assertAnimaReferenceRequest(request, resourcePlan);

    const validation = validateRequest(request);
    if (!validation.ok) {
      throw new StoryReferencePlateGenerationError(validation.message, "comfyui_request_invalid", validation.details);
    }

    const objectInfo = await client.getObjectInfo();
    const objectValidation = validateObjectInfo(validation.request, objectInfo);
    if (objectValidation.errors.length > 0) {
      throw new StoryReferencePlateGenerationError(
        "ComfyUI reference plate request does not match the current model/node options.",
        "comfyui_object_info_mismatch",
        {
          errors: objectValidation.errors,
          warnings: objectValidation.warnings,
        },
      );
    }

    const queuedAt = now();
    const queued = await client.generateImage(objectValidation.request, {
      clientId: getReferenceClientId(reference.id, queuedAt),
    });
    const history = await waitForCompleteHistory({
      client,
      intervalMs: historyPollIntervalMs,
      maxAttempts: historyPollAttempts,
      promptId: queued.promptId,
    });
    const [image] = extractComfyUiHistoryImages(history, queued.promptId).map((candidate) => ({
      ...candidate,
      url: client.buildViewUrl(candidate),
    }));

    if (!image) {
      throw new StoryReferencePlateGenerationError(
        "ComfyUI completed the reference plate request without a generated image.",
        "comfyui_execution_failed",
        {
          promptId: queued.promptId,
        },
      );
    }

    const response = await fetchImage(image.url);
    const stored = await storeImage(response.bytes, response.contentType);

    return toAssetReference({
      completedAt: now(),
      objectValidation,
      promptId: queued.promptId,
      reference,
      resourcePlan,
      stored,
    });
  };
}
