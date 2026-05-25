import { buildBasicTextToImageWorkflow } from "./workflow";
import type {
  ComfyUiGenerateImageResponse,
  ComfyUiQueuePromptOptions,
  ComfyUiQueuePromptResponse,
  ComfyUiTextToImageRequest,
  ComfyUiUploadImageRequest,
  ComfyUiUploadImageResponse,
  ComfyUiViewImageReference,
  ComfyUiWorkflow,
} from "./types";

type Fetcher = typeof fetch;

type ComfyUiClientOptions = {
  baseUrl: string;
  apiKey?: string;
  fetcher?: Fetcher;
};

type ComfyUiApiErrorOptions = {
  statusCode?: number;
  details?: unknown;
};

export class ComfyUiApiError extends Error {
  readonly statusCode?: number;
  readonly details?: unknown;

  constructor(message: string, options: ComfyUiApiErrorOptions = {}) {
    super(message);
    this.name = "ComfyUiApiError";
    this.statusCode = options.statusCode;
    this.details = options.details;
  }
}

function normalizeComfyUiBaseUrl(baseUrl: string) {
  const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");

  if (!normalizedBaseUrl) {
    throw new ComfyUiApiError("COMFYUI_BASE_URL is required before calling the ComfyUI API.", {
      statusCode: 500,
    });
  }

  return normalizedBaseUrl;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function parseResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type");

  if (contentType?.includes("application/json")) {
    return response.json();
  }

  return response.text();
}

function normalizeQueuePromptResponse(payload: unknown): ComfyUiQueuePromptResponse {
  if (!isRecord(payload) || typeof payload.prompt_id !== "string") {
    throw new ComfyUiApiError("ComfyUI response did not include a prompt_id.", {
      statusCode: 502,
      details: payload,
    });
  }

  return {
    promptId: payload.prompt_id,
    number: typeof payload.number === "number" ? payload.number : undefined,
    nodeErrors: payload.node_errors,
    raw: payload,
  };
}

function makeQueuePromptBody(workflow: ComfyUiWorkflow, options: ComfyUiQueuePromptOptions = {}) {
  return {
    prompt: workflow,
    ...(options.clientId ? { client_id: options.clientId } : {}),
    ...(options.extraData ? { extra_data: options.extraData } : {}),
  };
}

function normalizeUploadImageResponse(payload: unknown): ComfyUiUploadImageResponse {
  if (!isRecord(payload) || typeof payload.name !== "string" || !payload.name.trim()) {
    throw new ComfyUiApiError("ComfyUI image upload response did not include a file name.", {
      statusCode: 502,
      details: payload,
    });
  }

  const subfolder = typeof payload.subfolder === "string" && payload.subfolder ? payload.subfolder : undefined;
  const filename = payload.name.trim();

  return {
    filename,
    imageName: subfolder ? `${subfolder}/${filename}` : filename,
    subfolder,
    type: typeof payload.type === "string" ? payload.type : undefined,
    raw: payload,
  };
}

export function createComfyUiClient(options: ComfyUiClientOptions) {
  const baseUrl = normalizeComfyUiBaseUrl(options.baseUrl);
  const fetcher = options.fetcher ?? fetch;
  const jsonHeaders = {
    accept: "application/json",
    "content-type": "application/json",
    ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
  };
  const readHeaders = {
    accept: "application/json",
    ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
  };

  async function requestJson(path: string, init?: RequestInit): Promise<unknown> {
    const response = await fetcher(`${baseUrl}${path}`, init);
    const payload = await parseResponse(response);

    if (!response.ok) {
      throw new ComfyUiApiError("ComfyUI request failed.", {
        statusCode: response.status,
        details: payload,
      });
    }

    return payload;
  }

  return {
    async queuePrompt(
      workflow: ComfyUiWorkflow,
      queueOptions: ComfyUiQueuePromptOptions = {},
    ): Promise<ComfyUiQueuePromptResponse> {
      const payload = await requestJson("/prompt", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify(makeQueuePromptBody(workflow, queueOptions)),
      });

      return normalizeQueuePromptResponse(payload);
    },

    async uploadImage(request: ComfyUiUploadImageRequest): Promise<ComfyUiUploadImageResponse> {
      const form = new FormData();
      const bytes = request.bytes;
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      const blob = new Blob([buffer], { type: request.mimeType ?? "image/png" });

      form.append("image", blob, request.filename);
      form.append("overwrite", request.overwrite === false ? "false" : "true");
      form.append("type", request.type ?? "input");

      if (request.subfolder) {
        form.append("subfolder", request.subfolder);
      }

      const payload = await requestJson("/upload/image", {
        method: "POST",
        headers: readHeaders,
        body: form,
      });

      return normalizeUploadImageResponse(payload);
    },

    async generateImage(
      request: ComfyUiTextToImageRequest,
      queueOptions: ComfyUiQueuePromptOptions = {},
    ): Promise<ComfyUiGenerateImageResponse> {
      const workflow = buildBasicTextToImageWorkflow(request);
      const queued = await this.queuePrompt(workflow.workflow, queueOptions);

      return {
        ...workflow,
        ...queued,
      };
    },

    getHistory(promptId: string): Promise<unknown> {
      return requestJson(`/history/${encodeURIComponent(promptId)}`, {
        headers: readHeaders,
      });
    },

    getQueue(): Promise<unknown> {
      return requestJson("/queue", {
        headers: readHeaders,
      });
    },

    getObjectInfo(nodeClass?: string): Promise<unknown> {
      const path = nodeClass ? `/object_info/${encodeURIComponent(nodeClass)}` : "/object_info";

      return requestJson(path, {
        headers: readHeaders,
      });
    },

    buildViewUrl(reference: ComfyUiViewImageReference): string {
      const url = new URL(`${baseUrl}/view`);
      url.searchParams.set("filename", reference.filename);

      if (reference.subfolder !== undefined) {
        url.searchParams.set("subfolder", reference.subfolder);
      }

      if (reference.type !== undefined) {
        url.searchParams.set("type", reference.type);
      }

      return url.toString();
    },
  };
}

export type ComfyUiClient = ReturnType<typeof createComfyUiClient>;
