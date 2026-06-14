import type {
  LlmChatContent,
  LlmChatMessage,
  LlmChatRequest,
  LlmChatResponse,
  LlmEmbeddingRequest,
  LlmEmbeddingResponse,
  LlmChatRole,
  LlmTokenUsage,
} from "./types";

const LOG_TEXT_PREVIEW_MAX = 400;

function truncateForLog(text: string, max = LOG_TEXT_PREVIEW_MAX): string {
  if (text.length <= max) {
    return text;
  }

  return `${text.slice(0, max)}…`;
}

function summarizeContentForLog(content: LlmChatContent): string | Array<Record<string, unknown>> {
  if (typeof content === "string") {
    return truncateForLog(content);
  }

  return content.map((part) => {
    if (part.type === "text") {
      return {
        type: "text",
        length: part.text.length,
        preview: truncateForLog(part.text, 320),
      };
    }

    return {
      type: "image_url",
      detail: part.image_url.detail ?? "auto",
      dataUrlChars: part.image_url.url.length,
    };
  });
}

/** Safe structured summary for logs (no raw image bytes). */
export function summarizeLlmChatRequestForLog(request: LlmChatRequest): Record<string, unknown> {
  return {
    model: request.model ?? "(default)",
    nsfw: request.nsfw,
    temperature: request.temperature,
    maxTokens: request.maxTokens,
    messageCount: request.messages.length,
    messages: request.messages.map((message: LlmChatMessage) => ({
      role: message.role,
      content: summarizeContentForLog(message.content),
    })),
  };
}

type Fetcher = typeof fetch;

type LiteLlmClientOptions = {
  baseUrl: string;
  apiKey?: string;
  defaultModel?: string;
  fetcher?: Fetcher;
};

type LiteLlmErrorOptions = {
  statusCode?: number;
  details?: unknown;
};

type LiteLlmChoice = {
  message?: {
    role?: string;
    content?: string;
  };
  finish_reason?: string;
};

type LiteLlmChatCompletion = {
  id?: string;
  model?: string;
  choices?: LiteLlmChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

type LiteLlmEmbeddingItem = {
  embedding?: unknown;
  index?: number;
};

type LiteLlmEmbeddingPayload = {
  id?: string;
  model?: string;
  data?: LiteLlmEmbeddingItem[];
  usage?: LiteLlmChatCompletion["usage"];
};

type LiteLlmStreamChoice = {
  delta?: {
    role?: string;
    content?: string | null;
  };
  message?: {
    role?: string;
    content?: string;
  };
  finish_reason?: string | null;
};

type LiteLlmStreamChunk = {
  id?: string;
  model?: string;
  choices?: LiteLlmStreamChoice[];
  usage?: LiteLlmChatCompletion["usage"];
};

export class LiteLlmError extends Error {
  readonly statusCode?: number;
  readonly details?: unknown;

  constructor(message: string, options: LiteLlmErrorOptions = {}) {
    super(message);
    this.name = "LiteLlmError";
    this.statusCode = options.statusCode;
    this.details = options.details;
  }
}

function normalizeLiteLlmBaseUrl(baseUrl: string) {
  const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");

  if (!normalizedBaseUrl) {
    throw new LiteLlmError("LITELLM_BASE_URL is required before calling the LLM API.", { statusCode: 500 });
  }

  return normalizedBaseUrl.endsWith("/v1") ? normalizedBaseUrl : `${normalizedBaseUrl}/v1`;
}

function isLlmChatRole(value: string | undefined): value is LlmChatRole {
  return value === "system" || value === "user" || value === "assistant";
}

function toTokenUsage(usage: LiteLlmChatCompletion["usage"]): LlmTokenUsage | undefined {
  if (!usage) {
    return undefined;
  }

  return {
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
  };
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type");

  if (contentType?.includes("application/json")) {
    return response.json();
  }

  return response.text();
}

function normalizeLiteLlmCompletion(payload: unknown): LlmChatResponse {
  const completion = payload as LiteLlmChatCompletion;
  const firstChoice = completion.choices?.[0];
  const content = firstChoice?.message?.content;

  if (typeof content !== "string") {
    console.info("[SceneForge] [llm] inbound LiteLLM malformed completion", {
      id: completion.id,
      model: completion.model,
    });
    throw new LiteLlmError("LiteLLM response did not include a chat message.", {
      statusCode: 502,
      details: payload,
    });
  }

  const role = isLlmChatRole(firstChoice?.message?.role) ? firstChoice.message.role : "assistant";

  return {
    id: completion.id,
    model: completion.model,
    content,
    role,
    finishReason: firstChoice?.finish_reason,
    usage: toTokenUsage(completion.usage),
  };
}

function normalizeEmbedding(value: unknown): number[] {
  if (!Array.isArray(value)) {
    throw new LiteLlmError("LiteLLM embedding response included a malformed vector.", {
      statusCode: 502,
      details: value,
    });
  }

  const embedding = value.map((entry) => (typeof entry === "number" && Number.isFinite(entry) ? entry : null));
  if (embedding.some((entry) => entry === null)) {
    throw new LiteLlmError("LiteLLM embedding response included a non-finite vector value.", {
      statusCode: 502,
    });
  }

  return embedding as number[];
}

function normalizeLiteLlmEmbedding(payload: unknown): LlmEmbeddingResponse {
  const response = payload as LiteLlmEmbeddingPayload;
  const data = Array.isArray(response.data) ? response.data : null;

  if (!data || data.length === 0) {
    throw new LiteLlmError("LiteLLM response did not include embeddings.", {
      statusCode: 502,
      details: payload,
    });
  }

  return {
    id: response.id,
    model: response.model,
    embeddings: data
      .slice()
      .sort((left, right) => (left.index ?? 0) - (right.index ?? 0))
      .map((entry) => normalizeEmbedding(entry.embedding)),
    usage: toTokenUsage(response.usage),
  };
}

function applyStreamChunk(
  chunk: LiteLlmStreamChunk,
  current: {
    content: string;
    finishReason?: string;
    id?: string;
    model?: string;
    role: LlmChatRole;
    usage?: LlmTokenUsage;
  },
) {
  const firstChoice = chunk.choices?.[0];
  const deltaRole = firstChoice?.delta?.role ?? firstChoice?.message?.role;
  const deltaContent = firstChoice?.delta?.content ?? firstChoice?.message?.content;

  if (chunk.id) {
    current.id = chunk.id;
  }

  if (chunk.model) {
    current.model = chunk.model;
  }

  if (isLlmChatRole(deltaRole)) {
    current.role = deltaRole;
  }

  if (typeof deltaContent === "string") {
    current.content += deltaContent;
  }

  if (typeof firstChoice?.finish_reason === "string") {
    current.finishReason = firstChoice.finish_reason;
  }

  current.usage = toTokenUsage(chunk.usage) ?? current.usage;
}

function processSseEvent(
  event: string,
  current: {
    content: string;
    finishReason?: string;
    id?: string;
    model?: string;
    role: LlmChatRole;
    usage?: LlmTokenUsage;
  },
) {
  const dataLines = event
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.replace(/^data:\s?/, "").trim())
    .filter(Boolean);

  for (const data of dataLines) {
    if (data === "[DONE]") {
      continue;
    }

    try {
      applyStreamChunk(JSON.parse(data) as LiteLlmStreamChunk, current);
    } catch (error) {
      throw new LiteLlmError("LiteLLM stream included an invalid JSON chunk.", {
        statusCode: 502,
        details: {
          chunk: data,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }
}

async function parseStreamResponse(response: Response): Promise<LlmChatResponse> {
  if (!response.body) {
    throw new LiteLlmError("LiteLLM streaming response did not include a response body.", { statusCode: 502 });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const current: {
    content: string;
    finishReason?: string;
    id?: string;
    model?: string;
    role: LlmChatRole;
    usage?: LlmTokenUsage;
  } = {
    content: "",
    role: "assistant",
  };
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() ?? "";

    for (const event of events) {
      processSseEvent(event, current);
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    processSseEvent(buffer, current);
  }

  if (!current.content && !current.id) {
    throw new LiteLlmError("LiteLLM stream did not include a chat message.", {
      statusCode: 502,
    });
  }

  return current;
}

export function createLiteLlmClient(options: LiteLlmClientOptions) {
  const baseUrl = normalizeLiteLlmBaseUrl(options.baseUrl);
  const fetcher = options.fetcher ?? fetch;

  return {
    async completeChat(request: LlmChatRequest): Promise<LlmChatResponse> {
      const model = request.model ?? options.defaultModel;

      if (!model) {
        throw new LiteLlmError("LLM model is required. Pass model in the request or set LITELLM_DEFAULT_MODEL.", {
          statusCode: 400,
        });
      }

      console.info("[SceneForge] [llm] outbound LiteLLM chat completion", {
        ...summarizeLlmChatRequestForLog(request),
        resolvedModel: model,
      });

      const response = await fetcher(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model,
          messages: request.messages,
          temperature: request.temperature,
          max_tokens: request.maxTokens,
          stream: true,
        }),
      });

      const contentType = response.headers.get("content-type");
      const payload = response.ok && contentType?.includes("text/event-stream")
        ? null
        : await parseJsonResponse(response);

      if (!response.ok) {
        console.info("[SceneForge] [llm] inbound LiteLLM error response", {
          httpStatus: response.status,
          detailsType: typeof payload,
        });
        throw new LiteLlmError("LiteLLM chat completion request failed.", {
          statusCode: response.status,
          details: payload,
        });
      }

      const completion = contentType?.includes("text/event-stream")
        ? await parseStreamResponse(response)
        : normalizeLiteLlmCompletion(payload);

      console.info("[SceneForge] [llm] inbound LiteLLM chat completion", {
        id: completion.id,
        model: completion.model,
        role: completion.role,
        contentChars: completion.content.length,
        contentPreview: truncateForLog(completion.content, 280),
        finishReason: completion.finishReason,
        usage: completion.usage,
      });

      return completion;
    },

    async createEmbedding(request: LlmEmbeddingRequest): Promise<LlmEmbeddingResponse> {
      const model = request.model ?? options.defaultModel;

      if (!model) {
        throw new LiteLlmError(
          "Embedding model is required. Pass model in the request or set LITELLM_CIVITAI_EMBEDDING_MODEL.",
          { statusCode: 400 },
        );
      }

      const inputCount = Array.isArray(request.input) ? request.input.length : 1;
      console.info("[SceneForge] [llm] outbound LiteLLM embedding request", {
        model,
        inputCount,
      });

      const response = await fetcher(`${baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model,
          input: request.input,
        }),
      });
      const payload = await parseJsonResponse(response);

      if (!response.ok) {
        console.info("[SceneForge] [llm] inbound LiteLLM embedding error response", {
          httpStatus: response.status,
          detailsType: typeof payload,
        });
        throw new LiteLlmError("LiteLLM embedding request failed.", {
          statusCode: response.status,
          details: payload,
        });
      }

      const embedding = normalizeLiteLlmEmbedding(payload);
      console.info("[SceneForge] [llm] inbound LiteLLM embedding response", {
        id: embedding.id,
        model: embedding.model,
        embeddingCount: embedding.embeddings.length,
        dimensions: embedding.embeddings[0]?.length ?? 0,
        usage: embedding.usage,
      });

      return embedding;
    },
  };
}
