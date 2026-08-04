import { describe, expect, it, vi } from "vitest";

import { createLiteLlmClient, LiteLlmError } from "./litellm-client";
import { getRunScenePromptResponseFormat } from "./run-scene-prompt-response-format";

function responsesSseEvent(type: string, payload: unknown = { type }): string {
  return `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function completeFromResponsesSse(streamText: string) {
  const responseFormat = getRunScenePromptResponseFormat("illustrious");
  const fetcher = vi.fn<typeof fetch>(async () => new Response(streamText, {
    headers: { "content-type": "text/event-stream; charset=utf-8" },
  }));
  const client = createLiteLlmClient({
    baseUrl: "http://localhost:4000",
    defaultModel: "scene-model",
    fetcher,
  });

  return {
    completion: client.completeResponse({
      purpose: "stable-diffusion-prompt-generation",
      messages: [{ role: "user", content: "Generate a prompt" }],
      responseFormat,
    }),
    fetcher,
  };
}

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

  it("forwards the authorized response format while preserving stream true", async () => {
    const responseFormat = getRunScenePromptResponseFormat("krea2");
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        model: "scene-model",
        messages: [{ role: "user", content: "Describe the scene" }],
        response_format: responseFormat,
        stream: true,
      });

      return new Response(
        [
          'data: {"id":"chatcmpl-schema","model":"scene-model","choices":[{"delta":{"role":"assistant","content":"{}"},"finish_reason":"stop"}]}',
          "data: [DONE]",
          "",
        ].join("\n\n"),
        { headers: { "content-type": "text/event-stream" } },
      );
    });
    const client = createLiteLlmClient({
      baseUrl: "http://localhost:4000",
      defaultModel: "scene-model",
      fetcher,
    });

    await expect(client.completeChat({
      messages: [{ role: "user", content: "Describe the scene" }],
      responseFormat,
    })).resolves.toMatchObject({ content: "{}" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("maps an authorized structured request to a non-streaming, non-stored Responses payload", async () => {
    const responseFormat = getRunScenePromptResponseFormat("krea2");
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      expect(input).toBe("http://localhost:4000/v1/responses");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        "content-type": "application/json",
        authorization: "Bearer test-key",
      });
      expect(JSON.parse(String(init?.body))).toEqual({
        model: "scene-model",
        input: [
          { role: "system", content: "Return structured JSON." },
          {
            role: "user",
            content: [
              { type: "input_text", text: "Describe this image." },
              {
                type: "input_image",
                image_url: "data:image/png;base64,abc123",
                detail: "high",
              },
            ],
          },
        ],
        temperature: 0.2,
        max_output_tokens: 4096,
        text: {
          format: {
            type: "json_schema",
            name: responseFormat.json_schema.name,
            strict: true,
            schema: responseFormat.json_schema.schema,
          },
        },
        stream: false,
        store: false,
      });

      return new Response(JSON.stringify({
        id: "resp-1",
        model: "scene-model",
        status: "completed",
        output: [
          { type: "reasoning", status: "completed", summary: [] },
          {
            type: "message",
            status: "completed",
            role: "assistant",
            content: [{ type: "output_text", text: "{\"promptProfile\":\"krea2\"}", annotations: [] }],
          },
          { type: "function_call", status: "completed", name: "ignored" },
        ],
        usage: {
          input_tokens: 20,
          output_tokens: 10,
          total_tokens: 30,
        },
      }), {
        headers: { "content-type": "application/json" },
      });
    });
    const client = createLiteLlmClient({
      baseUrl: "http://localhost:4000",
      apiKey: "test-key",
      fetcher,
    });

    await expect(client.completeResponse({
      model: "scene-model",
      purpose: "stable-diffusion-prompt-generation",
      messages: [
        { role: "system", content: "Return structured JSON." },
        {
          role: "user",
          content: [
            { type: "text", text: "Describe this image." },
            {
              type: "image_url",
              image_url: { url: "data:image/png;base64,abc123", detail: "high" },
            },
          ],
        },
      ],
      temperature: 0.2,
      maxTokens: 4096,
      responseFormat,
    })).resolves.toEqual({
      id: "resp-1",
      model: "scene-model",
      content: "{\"promptProfile\":\"krea2\"}",
      role: "assistant",
      finishReason: "stop",
      usage: {
        promptTokens: 20,
        completionTokens: 10,
        totalTokens: 30,
      },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(["text/plain", "missing"] as const)(
    "accepts valid Responses JSON when Content-Type is %s",
    async (contentType) => {
      const responseFormat = getRunScenePromptResponseFormat("anima");
      const fetcher = vi.fn<typeof fetch>(async () => {
        const response = new Response(JSON.stringify({
          status: "completed",
          output: [{
            type: "message",
            status: "completed",
            role: "assistant",
            content: [{ type: "output_text", text: "{\"promptProfile\":\"anima\"}" }],
          }],
        }), contentType === "text/plain"
          ? { headers: { "content-type": "text/plain; charset=utf-8" } }
          : undefined);
        if (contentType === "missing") {
          response.headers.delete("content-type");
        }
        return response;
      });
      const client = createLiteLlmClient({
        baseUrl: "http://localhost:4000/v1",
        defaultModel: "scene-model",
        fetcher,
      });

      await expect(client.completeResponse({
        purpose: "stable-diffusion-prompt-generation",
        messages: [{ role: "user", content: "Generate a prompt" }],
        responseFormat,
      })).resolves.toMatchObject({ content: "{\"promptProfile\":\"anima\"}" });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it("rejects a nonempty JSON final message whose status is missing", async () => {
    const responseFormat = getRunScenePromptResponseFormat("anima");
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      status: "completed",
      output: [{
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "MUST_NOT_BE_ACCEPTED" }],
      }],
    }), { headers: { "content-type": "application/json" } }));
    const client = createLiteLlmClient({
      baseUrl: "http://localhost:4000",
      defaultModel: "scene-model",
      fetcher,
    });

    await expect(client.completeResponse({
      purpose: "stable-diffusion-prompt-generation",
      messages: [{ role: "user", content: "Generate a prompt" }],
      responseFormat,
    })).rejects.toMatchObject({
      statusCode: 502,
      details: {
        code: "structured_output_rejected",
        outputShape: "message_noncompleted",
      },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("accepts an official response.completed SSE event with the full canonical response", async () => {
    const finalResponse = {
      id: "resp-sse-1",
      model: "scene-model",
      status: "completed",
      output: [{
        id: "msg-sse-1",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{
          type: "output_text",
          text: "{\"promptProfile\":\"illustrious\"}",
          annotations: [],
          logprobs: [],
        }],
      }],
      usage: {
        input_tokens: 24,
        output_tokens: 12,
        total_tokens: 36,
      },
    };
    const completionEvent = [
      "id: live-proxy-event-9",
      "retry: 1500",
      "event: response.completed",
      `data: ${JSON.stringify({
        type: "response.completed",
        sequence_number: 9,
        response: finalResponse,
      })}`,
      "",
      "",
    ].join("\n");
    const { completion, fetcher } = completeFromResponsesSse(
      `${completionEvent}event: message\ndata: [DONE]\n\n`,
    );

    await expect(completion).resolves.toEqual({
      id: "resp-sse-1",
      model: "scene-model",
      content: "{\"promptProfile\":\"illustrious\"}",
      role: "assistant",
      finishReason: "stop",
      usage: {
        promptTokens: 24,
        completionTokens: 12,
        totalTokens: 36,
      },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects a nonempty SSE final message whose status is missing", async () => {
    const { completion, fetcher } = completeFromResponsesSse(responsesSseEvent("response.completed", {
      type: "response.completed",
      response: {
        status: "completed",
        output: [{
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "MUST_NOT_BE_ACCEPTED" }],
        }],
      },
    }));

    await expect(completion).rejects.toMatchObject({
      statusCode: 502,
      details: {
        code: "structured_output_rejected",
        outputShape: "message_noncompleted",
      },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("ignores official intermediate response events and never assembles delta text", async () => {
    const stream = [
      responsesSseEvent("response.created", {
        type: "response.created",
        sequence_number: 0,
        response: { id: "resp-sse-2", status: "in_progress", output: [] },
      }),
      responsesSseEvent("response.output_item.added", {
        type: "response.output_item.added",
        sequence_number: 1,
        output_index: 0,
        item: { type: "message", role: "assistant", content: [] },
      }),
      responsesSseEvent("response.content_part.added", {
        type: "response.content_part.added",
        sequence_number: 2,
        output_index: 0,
        content_index: 0,
        part: { type: "output_text", text: "" },
      }),
      responsesSseEvent("response.output_text.delta", {
        type: "response.output_text.delta",
        sequence_number: 3,
        output_index: 0,
        content_index: 0,
        delta: "DELTA_MUST_NOT_BE_ASSEMBLED",
      }),
      responsesSseEvent("response.output_text.done", {
        type: "response.output_text.done",
        sequence_number: 4,
        output_index: 0,
        content_index: 0,
        text: "DONE_EVENT_MUST_NOT_BE_USED",
      }),
      responsesSseEvent("response.completed", {
        type: "response.completed",
        sequence_number: 5,
        response: {
          id: "resp-sse-2",
          model: "scene-model",
          status: "completed",
          output: [{
            type: "message",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: "CANONICAL_FINAL_RESPONSE" }],
          }],
        },
      }),
    ].join("");
    const { completion } = completeFromResponsesSse(stream);

    await expect(completion).resolves.toMatchObject({
      content: "CANONICAL_FINAL_RESPONSE",
    });
  });

  it("recovers an empty completed output from exactly one indexed canonical output_item.done message", async () => {
    const stream = [
      responsesSseEvent("response.output_item.done", {
        type: "response.output_item.done",
        output_index: 0,
        item: { type: "reasoning", status: "completed", summary: [] },
      }),
      responsesSseEvent("response.output_text.delta", {
        type: "response.output_text.delta",
        output_index: 1,
        content_index: 0,
        delta: "DELTA_MUST_NOT_BE_USED",
      }),
      responsesSseEvent("response.output_text.done", {
        type: "response.output_text.done",
        output_index: 1,
        content_index: 0,
        text: "TEXT_DONE_MUST_NOT_BE_USED",
      }),
      responsesSseEvent("response.output_item.done", {
        type: "response.output_item.done",
        output_index: 1,
        item: {
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: "RECOVERED_CANONICAL_MESSAGE" }],
        },
      }),
      responsesSseEvent("response.completed", {
        type: "response.completed",
        response: {
          id: "resp-empty-final",
          model: "scene-model",
          status: "completed",
          output: [],
        },
      }),
      "event: message\ndata: [DONE]\n\n",
    ].join("");
    const { completion, fetcher } = completeFromResponsesSse(stream);

    await expect(completion).resolves.toMatchObject({
      id: "resp-empty-final",
      model: "scene-model",
      content: "RECOVERED_CANONICAL_MESSAGE",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("keeps a nonempty canonical completed output authoritative over output_item.done", async () => {
    const stream = [
      responsesSseEvent("response.output_item.done", {
        type: "response.output_item.done",
        output_index: 0,
        item: {
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: "RECOVERY_MUST_NOT_OVERRIDE" }],
        },
      }),
      responsesSseEvent("response.completed", {
        type: "response.completed",
        response: {
          status: "completed",
          output: [{
            type: "message",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: "AUTHORITATIVE_FINAL_OUTPUT" }],
          }],
        },
      }),
    ].join("");
    const { completion } = completeFromResponsesSse(stream);

    await expect(completion).resolves.toMatchObject({
      content: "AUTHORITATIVE_FINAL_OUTPUT",
    });
  });

  it.each([
    ["no terminal message", [
      responsesSseEvent("response.output_text.delta", {
        type: "response.output_text.delta",
        output_index: 0,
        content_index: 0,
        delta: "DELTA_ONLY_MUST_NOT_BE_USED",
      }),
      responsesSseEvent("response.output_text.done", {
        type: "response.output_text.done",
        output_index: 0,
        content_index: 0,
        text: "TEXT_DONE_ONLY_MUST_NOT_BE_USED",
      }),
    ].join(""), "terminal_item_missing"],
    ["reasoning-only terminal item", responsesSseEvent("response.output_item.done", {
      type: "response.output_item.done",
      output_index: 0,
      item: { type: "reasoning", status: "completed", summary: [] },
    }), "terminal_item_missing"],
    ["negative output index", responsesSseEvent("response.output_item.done", {
      type: "response.output_item.done",
      output_index: -1,
      item: {
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: "MUST_NOT_BE_USED" }],
      },
    }), "terminal_item_invalid"],
    ["wrong role", responsesSseEvent("response.output_item.done", {
      type: "response.output_item.done",
      output_index: 0,
      item: {
        type: "message",
        role: "user",
        status: "completed",
        content: [{ type: "output_text", text: "MUST_NOT_BE_USED" }],
      },
    }), "terminal_item_invalid"],
    ["missing status", responsesSseEvent("response.output_item.done", {
      type: "response.output_item.done",
      output_index: 0,
      item: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "MUST_NOT_BE_USED" }],
      },
    }), "terminal_item_invalid"],
    ["missing content array", responsesSseEvent("response.output_item.done", {
      type: "response.output_item.done",
      output_index: 0,
      item: {
        type: "message",
        role: "assistant",
        status: "completed",
        content: "MUST_NOT_BE_USED",
      },
    }), "terminal_item_invalid"],
    ["missing output_text part", responsesSseEvent("response.output_item.done", {
      type: "response.output_item.done",
      output_index: 0,
      item: {
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "text", text: "MUST_NOT_BE_USED" }],
      },
    }), "terminal_item_invalid"],
    ["duplicate terminal index", [
      responsesSseEvent("response.output_item.done", {
        type: "response.output_item.done",
        output_index: 0,
        item: {
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: "FIRST" }],
        },
      }),
      responsesSseEvent("response.output_item.done", {
        type: "response.output_item.done",
        output_index: 0,
        item: {
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: "SECOND" }],
        },
      }),
    ].join(""), "terminal_item_duplicate_index"],
    ["multiple terminal assistant messages", [0, 1].map((outputIndex) =>
      responsesSseEvent("response.output_item.done", {
        type: "response.output_item.done",
        output_index: outputIndex,
        item: {
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: `MESSAGE_${outputIndex}` }],
        },
      })
    ).join(""), "terminal_item_multiple"],
  ] as const)("fails closed for empty final output with %s", async (_label, priorEvents, reason) => {
    const stream = priorEvents + responsesSseEvent("response.completed", {
      type: "response.completed",
      response: { status: "completed", output: [] },
    });
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);

    try {
      const { completion, fetcher } = completeFromResponsesSse(stream);
      await expect(completion).rejects.toBeInstanceOf(LiteLlmError);
      expect(fetcher).toHaveBeenCalledTimes(1);
      const rejectionLog = consoleInfo.mock.calls.find(
        (call) => call[0] === "[SceneForge] [llm] inbound LiteLLM Responses shape rejected",
      );
      expect(rejectionLog?.[1]).toEqual({
        contentType: "text/event-stream",
        payloadKind: "responses-event-stream",
        reason,
      });
      const serializedLog = JSON.stringify(rejectionLog);
      expect(serializedLog).not.toContain("MUST_NOT_BE_USED");
      expect(serializedLog).not.toContain("FIRST");
      expect(serializedLog).not.toContain("SECOND");
      expect(serializedLog).not.toContain("MESSAGE_");
    } finally {
      consoleInfo.mockRestore();
    }
  });

  it.each([
    "response.failed",
    "response.incomplete",
    "response.error",
    "error",
  ])("fails closed for a %s terminal SSE event", async (type) => {
    const { completion, fetcher } = completeFromResponsesSse(responsesSseEvent(type));

    await expect(completion).rejects.toMatchObject({
      message: "LiteLLM Responses request did not complete successfully.",
      statusCode: 502,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["unsupported SSE field", "private-field: RAW_PRIVATE_FIELD\ndata: {\"type\":\"response.created\"}\n\n"],
    ["invalid JSON data", "event: response.completed\ndata: {not-json}\n\n"],
    ["non-object data", "event: response.completed\ndata: []\n\n"],
    ["missing event type", "data: {\"response\":{}}\n\n"],
    ["event-name/type mismatch", responsesSseEvent("response.created", {
      type: "response.in_progress",
    })],
    ["Chat Completions choices", "data: {\"choices\":[{\"delta\":{\"content\":\"wrong protocol\"}}]}\n\n"],
  ])("rejects %s in a Responses event stream", async (_label, stream) => {
    const { completion, fetcher } = completeFromResponsesSse(stream);

    await expect(completion).rejects.toMatchObject({
      message: "LiteLLM Responses event stream was malformed.",
      statusCode: 502,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects [DONE] before a verified response.completed event", async () => {
    const { completion, fetcher } = completeFromResponsesSse("event: message\ndata: [DONE]\n\n");

    await expect(completion).rejects.toMatchObject({
      message: "LiteLLM Responses event stream ended before completion.",
      statusCode: 502,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects an event stream without response.completed", async () => {
    const { completion } = completeFromResponsesSse([
      responsesSseEvent("response.created"),
      responsesSseEvent("response.in_progress"),
      responsesSseEvent("response.output_text.delta", {
        type: "response.output_text.delta",
        delta: "partial only",
      }),
    ].join(""));

    await expect(completion).rejects.toMatchObject({
      message: "LiteLLM Responses event stream did not include a completed response.",
      statusCode: 502,
    });
  });

  it.each([
    ["a second completion", responsesSseEvent("response.completed", {
      type: "response.completed",
      response: { status: "completed", output: [] },
    })],
    ["an event after completion", responsesSseEvent("response.output_text.done", {
      type: "response.output_text.done",
      text: "continued",
    })],
  ])("rejects %s after the first response.completed event", async (_label, trailingEvent) => {
    const firstCompletion = responsesSseEvent("response.completed", {
      type: "response.completed",
      response: {
        status: "completed",
        output: [{
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "first" }],
        }],
      },
    });
    const { completion } = completeFromResponsesSse(firstCompletion + trailingEvent);

    await expect(completion).rejects.toMatchObject({
      message: "LiteLLM Responses event stream continued after completion.",
      statusCode: 502,
    });
  });

  it("rejects response.completed without a full response object", async () => {
    const { completion } = completeFromResponsesSse(responsesSseEvent("response.completed", {
      type: "response.completed",
      sequence_number: 1,
    }));

    await expect(completion).rejects.toMatchObject({
      message: "LiteLLM Responses completion event was malformed.",
      statusCode: 502,
    });
  });

  it("rejects a response.completed event carrying an invalid final response", async () => {
    const { completion } = completeFromResponsesSse(responsesSseEvent("response.completed", {
      type: "response.completed",
      response: {
        status: "incomplete",
        output: [{
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "MUST_NOT_BE_USED" }],
        }],
      },
    }));

    await expect(completion).rejects.toMatchObject({
      message: "LiteLLM Responses request did not complete with usable output.",
      statusCode: 502,
    });
  });

  it("rejects an event after the allowed trailing [DONE] terminator", async () => {
    const completed = responsesSseEvent("response.completed", {
      type: "response.completed",
      response: {
        status: "completed",
        output: [{
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "canonical" }],
        }],
      },
    });
    const { completion } = completeFromResponsesSse(
      `${completed}event: message\ndata: [DONE]\n\n${responsesSseEvent("response.in_progress")}`,
    );

    await expect(completion).rejects.toMatchObject({
      message: "LiteLLM Responses event stream continued after its terminator.",
      statusCode: 502,
    });
  });

  it.each([
    ["completed_missing_response", responsesSseEvent("response.completed")],
    ["done_before_completed", "event: message\ndata: [DONE]\n\n"],
    ["event_after_completed", [
      responsesSseEvent("response.completed", {
        type: "response.completed",
        response: { status: "completed", output: [] },
      }),
      responsesSseEvent("response.in_progress"),
    ].join("")],
    ["event_after_done", [
      responsesSseEvent("response.completed", {
        type: "response.completed",
        response: { status: "completed", output: [] },
      }),
      "event: message\ndata: [DONE]\n\n",
      responsesSseEvent("response.in_progress"),
    ].join("")],
    ["event_mismatch", responsesSseEvent("response.created", { type: "response.in_progress" })],
    ["invalid_json", "event: response.completed\ndata: {RAW_INVALID_JSON_MARKER}\n\n"],
    ["missing_completed", responsesSseEvent("response.created")],
    ["missing_type", "data: {\"choices\":[{\"text\":\"RAW_CHAT_MARKER\"}]}\n\n"],
    ["terminal_failure", responsesSseEvent("response.failed")],
    ["unexpected_field", "private-field: RAW_PRIVATE_FIELD_MARKER\ndata: {\"type\":\"response.created\"}\n\n"],
  ] as const)("logs only the safe SSE failure reason %s", async (reason, stream) => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);

    try {
      const { completion } = completeFromResponsesSse(stream);
      await expect(completion).rejects.toBeInstanceOf(LiteLlmError);

      const rejectionLog = consoleInfo.mock.calls.find(
        (call) => call[0] === "[SceneForge] [llm] inbound LiteLLM Responses shape rejected",
      );
      expect(rejectionLog?.[1]).toEqual({
        contentType: "text/event-stream",
        payloadKind: "responses-event-stream",
        reason,
      });
      const serializedLog = JSON.stringify(rejectionLog);
      expect(serializedLog).not.toContain("RAW_INVALID_JSON_MARKER");
      expect(serializedLog).not.toContain("RAW_CHAT_MARKER");
      expect(serializedLog).not.toContain("RAW_PRIVATE_FIELD_MARKER");
      expect(serializedLog).not.toContain("choices");
      expect(serializedLog).not.toContain("private-field");
    } finally {
      consoleInfo.mockRestore();
    }
  });

  it.each(["missing_body", "read_failed"] as const)(
    "logs only the safe SSE failure reason %s for response-body failures",
    async (reason) => {
      const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
      const responseFormat = getRunScenePromptResponseFormat("illustrious");
      const response = reason === "missing_body"
        ? new Response(null, { headers: { "content-type": "text/event-stream" } })
        : new Response(new ReadableStream({
            pull(controller) {
              controller.error(new Error("RAW_STREAM_READ_FAILURE_MARKER"));
            },
          }), { headers: { "content-type": "text/event-stream" } });
      const client = createLiteLlmClient({
        baseUrl: "http://localhost:4000",
        defaultModel: "scene-model",
        fetcher: async () => response,
      });

      try {
        await expect(client.completeResponse({
          purpose: "stable-diffusion-prompt-generation",
          messages: [{ role: "user", content: "Generate a prompt" }],
          responseFormat,
        })).rejects.toBeInstanceOf(LiteLlmError);

        const rejectionLog = consoleInfo.mock.calls.find(
          (call) => call[0] === "[SceneForge] [llm] inbound LiteLLM Responses shape rejected",
        );
        expect(rejectionLog?.[1]).toEqual({
          contentType: "text/event-stream",
          payloadKind: "responses-event-stream",
          reason,
        });
        expect(JSON.stringify(rejectionLog)).not.toContain("RAW_STREAM_READ_FAILURE_MARKER");
      } finally {
        consoleInfo.mockRestore();
      }
    },
  );

  it("uses only completed assistant output_text and ignores convenience or non-message output", async () => {
    const responseFormat = getRunScenePromptResponseFormat("krea2");
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      status: "completed",
      output_text: "TOP_LEVEL_MUST_NOT_BE_USED",
      metadata: { output_text: "METADATA_MUST_NOT_BE_USED" },
      output: [
        { type: "reasoning", status: "completed", output_text: "REASONING_MUST_NOT_BE_USED" },
        {
          type: "message",
          status: "in_progress",
          role: "assistant",
          content: [{ type: "output_text", text: "INCOMPLETE_MUST_NOT_BE_USED" }],
        },
        {
          type: "message",
          status: "completed",
          role: "user",
          content: [{ type: "output_text", text: "USER_MUST_NOT_BE_USED" }],
        },
        { type: "function_call", status: "completed", output: "TOOL_MUST_NOT_BE_USED" },
        {
          type: "message",
          status: "completed",
          role: "assistant",
          content: [{ type: "output_text", text: "CANONICAL_OUTPUT" }],
        },
      ],
    }), { headers: { "content-type": "application/json" } }));
    const client = createLiteLlmClient({
      baseUrl: "http://localhost:4000",
      defaultModel: "scene-model",
      fetcher,
    });

    await expect(client.completeResponse({
      purpose: "stable-diffusion-prompt-generation",
      messages: [{ role: "user", content: "Generate a prompt" }],
      responseFormat,
    })).resolves.toMatchObject({ content: "CANONICAL_OUTPUT" });
  });

  it.each([
    ["top-level convenience text", {
      status: "completed",
      output_text: "MUST_NOT_BE_USED",
      output: [],
    }, "LiteLLM Responses output did not include completed assistant text."],
    ["reasoning and tool output", {
      status: "completed",
      output: [
        { type: "reasoning", status: "completed", output_text: "MUST_NOT_BE_USED" },
        { type: "function_call", status: "completed", output: "MUST_NOT_BE_USED" },
      ],
    }, "LiteLLM Responses output did not include completed assistant text."],
    ["refusal", {
      status: "completed",
      output: [{
        type: "message",
        status: "completed",
        role: "assistant",
        content: [{ type: "refusal", refusal: "cannot comply" }],
      }],
    }, "LiteLLM Responses request was refused."],
    ["incomplete response", { status: "incomplete", output: [] },
      "LiteLLM Responses request did not complete with usable output."],
    ["failed response", { status: "failed", output: [] },
      "LiteLLM Responses request did not complete with usable output."],
    ["incomplete message", {
      status: "completed",
      output: [{
        type: "message",
        status: "in_progress",
        role: "assistant",
        content: [{ type: "output_text", text: "MUST_NOT_BE_USED" }],
      }],
    }, "LiteLLM Responses output did not include completed assistant text."],
    ["empty output", { status: "completed", output: [] },
      "LiteLLM Responses output did not include completed assistant text."],
    ["malformed payload", "not-an-object", "LiteLLM Responses output was malformed."],
  ] as const)("fails closed for %s", async (_label, payload, expectedMessage) => {
    const responseFormat = getRunScenePromptResponseFormat("illustrious");
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(payload), {
      headers: { "content-type": "application/json" },
    }));
    const client = createLiteLlmClient({
      baseUrl: "http://localhost:4000",
      defaultModel: "scene-model",
      fetcher,
    });

    await expect(client.completeResponse({
      purpose: "stable-diffusion-prompt-generation",
      messages: [{ role: "user", content: "Generate a prompt" }],
      responseFormat,
    })).rejects.toMatchObject({
      message: expectedMessage,
      statusCode: 502,
      details: {
        code: "structured_output_rejected",
        upstreamStatus: 502,
        responseFormat: {
          type: "json_schema",
          schemaName: "sceneforge_run_scene_prompt_illustrious_v1",
          strict: true,
        },
      },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["response_not_object", "RAW_OUTPUT_SHAPE_MARKER"],
    ["response_noncompleted", { status: "incomplete", output: [] }],
    ["no_output_array", { status: "completed", output: "RAW_OUTPUT_SHAPE_MARKER" }],
    ["no_message_item", {
      status: "completed",
      output: [{ type: "reasoning", summary: ["RAW_OUTPUT_SHAPE_MARKER"] }],
    }],
    ["message_noncompleted", {
      status: "completed",
      output: [{
        type: "message",
        status: "in_progress",
        role: "assistant",
        content: [{ type: "output_text", text: "RAW_OUTPUT_SHAPE_MARKER" }],
      }],
    }],
    ["no_assistant_role", {
      status: "completed",
      output: [{
        type: "message",
        status: "completed",
        role: "user",
        content: [{ type: "output_text", text: "RAW_OUTPUT_SHAPE_MARKER" }],
      }],
    }],
    ["message_content_missing", {
      status: "completed",
      output: [{
        type: "message",
        status: "completed",
        role: "assistant",
        content: "RAW_OUTPUT_SHAPE_MARKER",
      }],
    }],
    ["no_output_text", {
      status: "completed",
      output: [{
        type: "message",
        status: "completed",
        role: "assistant",
        content: [{ type: "text", text: "RAW_OUTPUT_SHAPE_MARKER" }],
      }],
    }],
    ["refusal", {
      status: "completed",
      output: [{
        type: "message",
        status: "completed",
        role: "assistant",
        content: [{ type: "refusal", refusal: "RAW_OUTPUT_SHAPE_MARKER" }],
      }],
    }],
  ] as const)("reports only the safe output-shape diagnostic %s", async (outputShape, payload) => {
    const responseFormat = getRunScenePromptResponseFormat("anima");
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(payload), {
      headers: { "content-type": "application/json" },
    }));
    const client = createLiteLlmClient({
      baseUrl: "http://localhost:4000",
      defaultModel: "scene-model",
      fetcher,
    });

    try {
      const error = await client.completeResponse({
        purpose: "stable-diffusion-prompt-generation",
        messages: [{ role: "user", content: "Generate a prompt" }],
        responseFormat,
      }).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(LiteLlmError);
      expect((error as LiteLlmError).details).toEqual({
        code: "structured_output_rejected",
        upstreamStatus: 502,
        responseFormat: {
          type: "json_schema",
          schemaName: "sceneforge_run_scene_prompt_anima_v1",
          strict: true,
        },
        outputShape,
      });
      const rejectionLog = consoleInfo.mock.calls.find(
        (call) => call[0] === "[SceneForge] [llm] inbound LiteLLM Responses shape rejected",
      );
      expect(rejectionLog?.[1]).toEqual({
        contentType: "json",
        payloadKind: typeof payload === "object" ? "object" : "string",
        outputShape,
      });
      const exposedBoundaryData = JSON.stringify({
        error: {
          message: (error as Error).message,
          details: (error as LiteLlmError).details,
        },
        logs: consoleInfo.mock.calls,
      });
      expect(exposedBoundaryData).not.toContain("RAW_OUTPUT_SHAPE_MARKER");
      expect(exposedBoundaryData).not.toContain(JSON.stringify(responseFormat.json_schema.schema));
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      consoleInfo.mockRestore();
    }
  });

  it("rejects malformed non-JSON Responses data without retry or Chat fallback", async () => {
    const responseFormat = getRunScenePromptResponseFormat("anima");
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      expect(input).toBe("http://localhost:4000/v1/responses");
      return new Response("not json", { headers: { "content-type": "text/plain" } });
    });
    const client = createLiteLlmClient({
      baseUrl: "http://localhost:4000",
      defaultModel: "scene-model",
      fetcher,
    });

    await expect(client.completeResponse({
      purpose: "stable-diffusion-prompt-generation",
      messages: [{ role: "user", content: "Generate a prompt" }],
      responseFormat,
    })).rejects.toMatchObject({
      message: "LiteLLM Responses request returned malformed data.",
      statusCode: 502,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("sanitizes a Responses provider rejection without retry or Chat fallback", async () => {
    const responseFormat = getRunScenePromptResponseFormat("illustrious");
    const sensitiveMarkers = [
      "sk-private-responses-key-marker",
      "RAW_RESPONSES_PAYLOAD_MARKER",
      "responses-provider.private.internal",
      "private-responses-deployment-v2",
    ];
    const fullSchema = JSON.stringify(responseFormat.json_schema.schema);
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      expect(input).toBe("http://localhost:4000/v1/responses");
      return new Response(JSON.stringify({
        error: {
          message: `${sensitiveMarkers[2]} rejected ${sensitiveMarkers[3]}`,
          apiKey: sensitiveMarkers[0],
          rawPayload: sensitiveMarkers[1],
          request: { text: { format: responseFormat }, model: sensitiveMarkers[3] },
        },
      }), {
        status: 422,
        headers: { "content-type": "application/json" },
      });
    });
    const client = createLiteLlmClient({
      baseUrl: "http://localhost:4000",
      apiKey: "sk-private-client-key-marker",
      defaultModel: "scene-model",
      fetcher,
    });

    try {
      const error = await client.completeResponse({
        purpose: "stable-diffusion-prompt-generation",
        messages: [{ role: "user", content: "Generate a prompt" }],
        responseFormat,
      }).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(LiteLlmError);
      expect(error).toMatchObject({
        message: "LiteLLM Responses request failed.",
        statusCode: 422,
        details: {
          code: "structured_output_rejected",
          upstreamStatus: 422,
          responseFormat: {
            type: "json_schema",
            schemaName: "sceneforge_run_scene_prompt_illustrious_v1",
            strict: true,
          },
        },
      });
      const exposedBoundaryData = JSON.stringify({
        error: {
          message: (error as Error).message,
          details: (error as LiteLlmError).details,
        },
        logs: consoleInfo.mock.calls,
      });
      for (const marker of [...sensitiveMarkers, "sk-private-client-key-marker"]) {
        expect(exposedBoundaryData).not.toContain(marker);
      }
      expect(exposedBoundaryData).not.toContain(fullSchema);
      expect(exposedBoundaryData).not.toContain("rawPayload");
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      consoleInfo.mockRestore();
    }
  });

  it("surfaces a sanitized provider rejection once without retry or fallback", async () => {
    const responseFormat = getRunScenePromptResponseFormat("illustrious");
    const sensitiveMarkers = [
      "sk-private-upstream-key-marker",
      "RAW_PRIVATE_PROMPT_MARKER",
      "private-provider.internal",
      "private-model-deployment-v9",
    ];
    const fullSchema = JSON.stringify(responseFormat.json_schema.schema);
    const fetcher = vi.fn<typeof fetch>(async () => new Response(
      JSON.stringify({
        error: {
          message: `Provider private-provider.internal rejected private-model-deployment-v9: ${sensitiveMarkers[1]}`,
          apiKey: sensitiveMarkers[0],
          request: {
            model: sensitiveMarkers[3],
            messages: [{ role: "user", content: sensitiveMarkers[1] }],
            response_format: responseFormat,
          },
          provider: sensitiveMarkers[2],
        },
      }),
      {
        status: 422,
        headers: { "content-type": "application/json" },
      },
    ));
    const client = createLiteLlmClient({
      baseUrl: "http://localhost:4000",
      defaultModel: "scene-model",
      fetcher,
    });

    const error = await client.completeChat({
      messages: [{ role: "user", content: "Describe the scene" }],
      responseFormat,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LiteLlmError);
    expect(error).toMatchObject({
      message: "LiteLLM chat completion request failed.",
      statusCode: 422,
    });
    expect((error as LiteLlmError).details).toEqual({
      code: "structured_output_rejected",
      upstreamStatus: 422,
      responseFormat: {
        type: "json_schema",
        schemaName: "sceneforge_run_scene_prompt_illustrious_v1",
        strict: true,
      },
    });
    const exposedError = JSON.stringify({
      message: (error as Error).message,
      details: (error as LiteLlmError).details,
    });
    for (const marker of sensitiveMarkers) {
      expect(exposedError).not.toContain(marker);
    }
    expect(exposedError).not.toContain(fullSchema);
    expect(exposedError).not.toContain("response_format");
    expect(exposedError).not.toContain("messages");
    expect(exposedError).not.toContain("apiKey");
    expect(fetcher).toHaveBeenCalledTimes(1);
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
