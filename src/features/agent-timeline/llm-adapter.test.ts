import { describe, expect, it } from "vitest";

import type { LlmChatRequest, LlmChatResponse } from "@/features/llm";
import { LiteLlmError } from "@/features/llm";

import { createLlmTimelineNodeAdapter } from "./llm-adapter";
import { createTimelineWorkflowState } from "./state";
import { TimelineNodeExecutionError } from "./types";

describe("createLlmTimelineNodeAdapter", () => {
  it("wraps mocked completeChat responses as timeline adapter results", async () => {
    const workflow = createTimelineWorkflowState({
      workflowId: "llm-adapter",
      sceneRequest: "A glass observatory above the clouds",
      now: () => "2026-05-29T00:00:00.000Z",
    });
    const requests: LlmChatRequest[] = [];
    const adapter = createLlmTimelineNodeAdapter({
      completeChat: async (request) => {
        requests.push(request);

        return {
          content: "glass observatory, clouds, cinematic light",
          role: "assistant",
          model: "mock-scene-model",
          finishReason: "stop",
          usage: {
            totalTokens: 12,
          },
        };
      },
      buildRequest: (context) => ({
        purpose: "stable-diffusion-prompt-generation",
        messages: [
          {
            role: "user",
            content: `Create a prompt for ${
              (context.dependencies[0].result as { rawIntent: string }).rawIntent
            }`,
          },
        ],
        temperature: 0.2,
      }),
      parseResponse: (response: LlmChatResponse) => ({
        positivePrompt: response.content,
        model: response.model,
      }),
    });

    const result = await adapter({
      nodeId: "scene-prompt",
      workflow,
      dependencies: [workflow.nodes["scene-input"]],
    });

    expect(requests).toEqual([
      {
        purpose: "stable-diffusion-prompt-generation",
        messages: [
          {
            role: "user",
            content: "Create a prompt for A glass observatory above the clouds",
          },
        ],
        temperature: 0.2,
      },
    ]);
    expect(result).toEqual({
      value: {
        positivePrompt: "glass observatory, clouds, cinematic light",
        model: "mock-scene-model",
      },
      source: "ai",
    });
  });

  it("rejects malformed mocked LLM responses without live services", async () => {
    const workflow = createTimelineWorkflowState({
      workflowId: "llm-malformed",
      sceneRequest: "A forest shrine",
      now: () => "2026-05-29T00:00:00.000Z",
    });
    const adapter = createLlmTimelineNodeAdapter({
      completeChat: async () =>
        ({
          content: "   ",
          role: "assistant",
        }) as LlmChatResponse,
      buildRequest: () => ({
        messages: [{ role: "user", content: "Build prompt" }],
      }),
    });

    await expect(
      adapter({
        nodeId: "scene-prompt",
        workflow,
        dependencies: [workflow.nodes["scene-input"]],
      }),
    ).rejects.toMatchObject({
      code: "llm_malformed_response",
      message: "LLM response did not include usable text content.",
    });
  });

  it("normalizes LiteLLM configuration errors for graph nodes", async () => {
    const workflow = createTimelineWorkflowState({
      workflowId: "llm-config",
      sceneRequest: "A moonlit harbor",
      now: () => "2026-05-29T00:00:00.000Z",
    });
    const adapter = createLlmTimelineNodeAdapter({
      completeChat: async () => {
        throw new LiteLlmError("LLM model is required. Pass model in the request or set LITELLM_DEFAULT_MODEL.", {
          statusCode: 400,
        });
      },
      buildRequest: () => ({
        messages: [{ role: "user", content: "Build prompt" }],
      }),
    });

    await expect(
      adapter({
        nodeId: "scene-prompt",
        workflow,
        dependencies: [workflow.nodes["scene-input"]],
      }),
    ).rejects.toBeInstanceOf(TimelineNodeExecutionError);
    await expect(
      adapter({
        nodeId: "scene-prompt",
        workflow,
        dependencies: [workflow.nodes["scene-input"]],
      }),
    ).rejects.toMatchObject({
      code: "llm_config",
    });
  });
});
