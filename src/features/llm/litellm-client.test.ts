import { describe, expect, it, vi } from "vitest";

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
        stream: true,
      });

      return new Response(
        [
          'data: {"id":"chatcmpl-1","model":"scene-model","choices":[{"delta":{"role":"assistant","content":"A quiet "},"finish_reason":null}]}',
          'data: {"id":"chatcmpl-1","model":"scene-model","choices":[{"delta":{"content":"forest scene."},"finish_reason":"stop"}],"usage":{"prompt_tokens":8,"completion_tokens":5,"total_tokens":13}}',
          "data: [DONE]",
          "",
        ].join("\n\n"),
        {
          headers: { "content-type": "text/event-stream" },
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

  it("forwards multimodal chat content unchanged", async () => {
    const content = [
      { type: "text" as const, text: "Use this prompt preview and canvas image." },
      {
        type: "image_url" as const,
        image_url: {
          url: "data:image/png;base64,abc123",
          detail: "auto" as const,
        },
      },
    ];
    const fetcher: typeof fetch = async (_input, init) => {
      expect(JSON.parse(String(init?.body)).messages).toEqual([{ role: "user", content }]);

      return new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "polished prompt" } }],
        }),
        {
          headers: { "content-type": "application/json" },
        },
      );
    };

    const client = createLiteLlmClient({
      baseUrl: "http://localhost:4000",
      defaultModel: "vision-model",
      fetcher,
    });

    await expect(client.completeChat({ messages: [{ role: "user", content }] })).resolves.toMatchObject({
      content: "polished prompt",
    });
  });

  it("posts embedding requests without logging API keys or source text", async () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fetcher: typeof fetch = async (input, init) => {
      expect(input).toBe("http://localhost:4000/v1/embeddings");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        "content-type": "application/json",
        authorization: "Bearer embedding-secret",
      });
      expect(JSON.parse(String(init?.body))).toEqual({
        model: "civitai-embedding-model",
        input: ["neon rain checkpoint", "soft portrait lora"],
      });

      return new Response(
        JSON.stringify({
          id: "embd-1",
          model: "civitai-embedding-model",
          data: [
            { embedding: [1, 0, 0], index: 0, object: "embedding" },
            { embedding: [0, 1, 0], index: 1, object: "embedding" },
          ],
          usage: {
            prompt_tokens: 6,
            total_tokens: 6,
          },
        }),
        {
          headers: { "content-type": "application/json" },
        },
      );
    };

    const client = createLiteLlmClient({
      baseUrl: "http://localhost:4000/v1",
      apiKey: "embedding-secret",
      defaultModel: "civitai-embedding-model",
      fetcher,
    });

    try {
      await expect(
        client.createEmbedding({
          input: ["neon rain checkpoint", "soft portrait lora"],
        }),
      ).resolves.toEqual({
        id: "embd-1",
        model: "civitai-embedding-model",
        embeddings: [
          [1, 0, 0],
          [0, 1, 0],
        ],
        usage: {
          promptTokens: 6,
          completionTokens: undefined,
          totalTokens: 6,
        },
      });

      const logged = JSON.stringify(consoleInfo.mock.calls);

      expect(logged).toContain("civitai-embedding-model");
      expect(logged).toContain("inputCount");
      expect(logged).toContain("dimensions");
      expect(logged).not.toContain("embedding-secret");
      expect(logged).not.toContain("neon rain checkpoint");
      expect(logged).not.toContain("soft portrait lora");
      expect(logged).not.toContain("[1,0,0]");
    } finally {
      consoleInfo.mockRestore();
    }
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
