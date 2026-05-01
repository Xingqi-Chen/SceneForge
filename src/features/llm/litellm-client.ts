import type {
  LlmChatContent,
  LlmChatMessage,
  LlmChatRequest,
  LlmChatResponse,
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
        }),
      });

      const payload = await parseJsonResponse(response);

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

      console.info("[SceneForge] [llm] inbound LiteLLM chat completion", {
        id: completion.id,
        model: completion.model,
        role,
        contentChars: content.length,
        contentPreview: truncateForLog(content, 280),
        finishReason: firstChoice?.finish_reason,
        usage: toTokenUsage(completion.usage),
      });

      return {
        id: completion.id,
        model: completion.model,
        content,
        role,
        finishReason: firstChoice?.finish_reason,
        usage: toTokenUsage(completion.usage),
      };
    },
  };
}

