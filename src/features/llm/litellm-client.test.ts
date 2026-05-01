import { describe, expect, it } from "vitest";

import { createLiteLlmClient, LiteLlmError } from "./litellm-client";

describe("createLiteLlmClient", () => {
  it("posts chat completions to a LiteLLM OpenAI-compatible endpoint", async () => {
    const fetcher: typeof fetch = async (input, init) => {
      expect(input).toBe("http://localhost:4000/v1/chat/completions");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        "content-type": "application/json",
        authorization: "Bearer test-key",
      });
      expect(JSON.parse(String(init?.body))).toEqual({
        model: "scene-model",
        messages: [{ role: "user", content: "Describe the scene" }],
        temperature: 0.2,
        max_tokens: 128,
      });

      return new Response(
        JSON.stringify({
          id: "chatcmpl-1",
          model: "scene-model",
          choices: [
            {
              message: { role: "assistant", content: "A quiet forest scene." },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 8,
            completion_tokens: 5,
            total_tokens: 13,
          },
        }),
        {
          headers: { "content-type": "application/json" },
        },
      );
    };

    const client = createLiteLlmClient({
      baseUrl: "http://localhost:4000",
      apiKey: "test-key",
      fetcher,
    });

    await expect(
      client.completeChat({
        model: "scene-model",
        messages: [{ role: "user", content: "Describe the scene" }],
        temperature: 0.2,
        maxTokens: 128,
      }),
    ).resolves.toEqual({
      id: "chatcmpl-1",
      model: "scene-model",
      content: "A quiet forest scene.",
      role: "assistant",
      finishReason: "stop",
      usage: {
        promptTokens: 8,
        completionTokens: 5,
        totalTokens: 13,
      },
    });
  });

  it("uses the configured default model when the request omits one", async () => {
    const fetcher: typeof fetch = async (_input, init) => {
      expect(JSON.parse(String(init?.body)).model).toBe("default-model");

      return new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "ok" } }],
        }),
        {
          headers: { "content-type": "application/json" },
        },
      );
    };

    const client = createLiteLlmClient({
      baseUrl: "http://localhost:4000/v1",
      defaultModel: "default-model",
      fetcher,
    });

    await expect(client.completeChat({ messages: [{ role: "user", content: "Hello" }] })).resolves.toMatchObject({
      content: "ok",
    });
  });

  it("rejects requests without a model or default model", async () => {
    const client = createLiteLlmClient({
      baseUrl: "http://localhost:4000",
      fetcher: async () => new Response("{}"),
    });

    await expect(client.completeChat({ messages: [{ role: "user", content: "Hello" }] })).rejects.toBeInstanceOf(
      LiteLlmError,
    );
  });
});

