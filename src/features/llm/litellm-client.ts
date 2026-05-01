import type { LlmChatRequest, LlmChatResponse, LlmChatRole, LlmTokenUsage } from "./types";

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
        throw new LiteLlmError("LiteLLM chat completion request failed.", {
          statusCode: response.status,
          details: payload,
        });
      }

      const completion = payload as LiteLlmChatCompletion;
      const firstChoice = completion.choices?.[0];
      const content = firstChoice?.message?.content;

      if (typeof content !== "string") {
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
    },
  };
}

