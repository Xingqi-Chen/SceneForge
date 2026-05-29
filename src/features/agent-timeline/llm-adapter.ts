import { isLlmChatResponse, LiteLlmError, type LlmChatRequest, type LlmChatResponse } from "@/features/llm";

import { createTimelineNodeError } from "./state";
import { TimelineNodeExecutionError, type TimelineNodeAdapter, type TimelineNodeExecutionContext } from "./types";

export type TimelineCompleteChat = (request: LlmChatRequest) => Promise<LlmChatResponse>;

export type TimelineLlmTextResult = {
  content: string;
  model?: string;
  finishReason?: string;
  usage?: LlmChatResponse["usage"];
};

type LlmTimelineNodeAdapterOptions<T> = {
  completeChat: TimelineCompleteChat;
  buildRequest: (context: TimelineNodeExecutionContext) => LlmChatRequest;
  parseResponse?: (response: LlmChatResponse, context: TimelineNodeExecutionContext) => T;
};

function mapLiteLlmError(error: LiteLlmError) {
  const isConfigError =
    error.message.includes("LITELLM") ||
    error.message.includes("model is required") ||
    error.statusCode === 400;

  return createTimelineNodeError(isConfigError ? "llm_config" : "llm_upstream", error.message, {
    statusCode: error.statusCode,
    details: error.details,
  });
}

function normalizeLlmAdapterError(error: unknown) {
  if (error instanceof TimelineNodeExecutionError) {
    return createTimelineNodeError(error.code, error.message, error.details);
  }

  if (error instanceof LiteLlmError) {
    return mapLiteLlmError(error);
  }

  if (error instanceof Error) {
    return createTimelineNodeError("llm_upstream", error.message, {
      name: error.name,
    });
  }

  return createTimelineNodeError("llm_upstream", "LLM timeline adapter failed.", {
    error,
  });
}

function defaultParseResponse(response: LlmChatResponse): TimelineLlmTextResult {
  return {
    content: response.content,
    model: response.model,
    finishReason: response.finishReason,
    usage: response.usage,
  };
}

export function createLlmTimelineNodeAdapter<T = TimelineLlmTextResult>(
  options: LlmTimelineNodeAdapterOptions<T>,
): TimelineNodeAdapter<T | TimelineLlmTextResult> {
  return async (context) => {
    try {
      const response = await options.completeChat(options.buildRequest(context));

      if (!isLlmChatResponse(response) || response.content.trim().length === 0) {
        throw new TimelineNodeExecutionError(
          createTimelineNodeError("llm_malformed_response", "LLM response did not include usable text content.", {
            response,
          }),
        );
      }

      return {
        value: options.parseResponse
          ? options.parseResponse(response, context)
          : defaultParseResponse(response),
        source: "ai",
      };
    } catch (error) {
      throw new TimelineNodeExecutionError(normalizeLlmAdapterError(error));
    }
  };
}
