// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import { createLiteLlmClient, LiteLlmError } from "./litellm-client";
import { getRunScenePromptResponseFormat } from "./run-scene-prompt-response-format";
import type { LlmResponsesMessage, LlmResponsesRequest } from "./types";

function makeClient() {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({
    id: "PRIVATE_RESPONSE_ID",
    model: "PRIVATE_RESPONSE_MODEL",
    status: "completed",
    output: [{
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: "PRIVATE_COMPLETION" }],
    }],
    usage: { input_tokens: 7, output_tokens: 3, total_tokens: 10 },
  }));
  return {
    fetcher,
    client: createLiteLlmClient({
      baseUrl: "https://private-provider.test/v1/",
      apiKey: "sk-private-key",
      defaultModel: "PRIVATE_DEFAULT_MODEL",
      fetcher,
    }),
  };
}

afterEach(() => vi.restoreAllMocks());

describe("native Responses client", () => {
  it("supports the legacy completeChat alias when passed as an unbound callback", async () => {
    const { client, fetcher } = makeClient();
    const complete = client.completeChat;

    await expect(complete({ messages: [{ role: "user", content: "unbound request" }], maxTokens: 128 })).resolves.toMatchObject({
      role: "assistant", content: "PRIVATE_COMPLETION",
    });
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://private-provider.test/v1/responses");
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      model: "PRIVATE_DEFAULT_MODEL", input: [{ role: "user", content: "unbound request" }],
      max_output_tokens: 128, stream: false, store: false,
    });
  });

  it("preserves a string input, instructions, explicit model, and native token options", async () => {
    const { client, fetcher } = makeClient();
    const completion = await client.completeResponse({
      model: "explicit-model",
      input: "  PRIVATE_INPUT\n",
      instructions: "PRIVATE_INSTRUCTIONS",
      max_output_tokens: 321,
      temperature: 0.4,
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith("https://private-provider.test/v1/responses", expect.objectContaining({
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer sk-private-key" },
    }));
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      model: "explicit-model",
      input: "  PRIVATE_INPUT\n",
      instructions: "PRIVATE_INSTRUCTIONS",
      max_output_tokens: 321,
      temperature: 0.4,
      stream: false,
      store: false,
    });
    expect(completion).toEqual({
      id: "PRIVATE_RESPONSE_ID",
      model: "PRIVATE_RESPONSE_MODEL",
      content: "PRIVATE_COMPLETION",
      role: "assistant",
      finishReason: "stop",
      usage: { promptTokens: 7, completionTokens: 3, totalTokens: 10 },
    });
  });

  it.each([undefined, true, false] as const)("forwards a caller schema with strict=%s without adding defaults", async (strict) => {
    const { client, fetcher } = makeClient();
    const format = {
      type: "json_schema" as const,
      name: "caller_authored",
      description: "PRIVATE_SCHEMA_DESCRIPTION",
      schema: {
        type: "object",
        properties: { caption: { type: "string", description: "PRIVATE_SCHEMA_BODY" } },
        required: ["caption"],
        additionalProperties: false,
      },
      ...(strict === undefined ? {} : { strict }),
    };

    await client.completeResponse({ input: "PRIVATE_INPUT", text: { format } });

    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(body.text).toEqual({ format });
    expect(body).not.toHaveProperty("response_format");
    expect(body).not.toHaveProperty("messages");
    expect(body).not.toHaveProperty("max_tokens");
    if (strict === undefined) expect(body.text.format).not.toHaveProperty("strict");
  });

  it("preserves native message roles, item markers, part order, image bytes, and optional detail", async () => {
    const { client, fetcher } = makeClient();
    const input: LlmResponsesMessage[] = [
      { type: "message", role: "system", content: "system context" },
      { role: "developer", content: "developer context" },
      { role: "assistant", content: "earlier answer" },
      { type: "message", role: "user", content: [
        { type: "input_text", text: "before" },
        { type: "input_image", image_url: "data:image/png;base64,FIRST", detail: "low" },
        { type: "input_text", text: "between" },
        { type: "input_image", image_url: "data:image/jpeg;base64,SECOND", detail: "high" },
        { type: "input_image", image_url: "data:image/png;base64,THIRD" },
        { type: "input_image", image_url: "https://images.example.test/scene.png?version=2&name=exact%20bytes", detail: "auto" },
        { type: "input_text", text: "after" },
      ] },
    ];

    await client.completeResponse({ input });

    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)).input).toEqual(input);
  });

  it.each(["javascript:alert(1)", "file:///private/image.png", "/relative/image.png", "https://", "not-a-url"])(
    "rejects malformed or unsupported native image URL %s before upstream",
    async (image_url) => {
      const { client, fetcher } = makeClient();
      await expect(client.completeResponse({ input: [{ role: "user", content: [{ type: "input_image", image_url }] }] })).rejects.toMatchObject({ statusCode: 400 });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it.each([
    { input: "native", messages: [{ role: "user", content: "legacy" }] },
    { input: "native", maxTokens: 5, max_output_tokens: 5 },
    { input: "native", responseFormat: getRunScenePromptResponseFormat("krea2"), text: { format: { type: "text" } } },
  ])("rejects conflicting native and legacy fields before an upstream call: %j", async (request) => {
    const { client, fetcher } = makeClient();

    await expect(client.completeResponse(request as unknown as LlmResponsesRequest)).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps native request, completion, and failure console logs metadata-only", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { client, fetcher } = makeClient();
    const request: LlmResponsesRequest = {
      input: [{ role: "user", content: [
        { type: "input_text", text: "PRIVATE_INPUT" },
        { type: "input_image", image_url: "data:image/png;base64,PRIVATE_IMAGE", detail: "high" },
      ] }],
      instructions: "PRIVATE_INSTRUCTIONS",
      text: { format: {
        type: "json_schema", name: "PRIVATE_SCHEMA_NAME", description: "PRIVATE_SCHEMA_DESCRIPTION",
        schema: { type: "object", description: "PRIVATE_SCHEMA_BODY" }, strict: false,
      } },
    };
    await client.completeResponse(request);
    fetcher.mockRejectedValueOnce(new Error("PRIVATE_ERROR C:\\private-source\\file.ts sk-private-key"));
    await expect(client.completeResponse(request)).rejects.toBeInstanceOf(LiteLlmError);

    const logs = JSON.stringify([info.mock.calls, errorLog.mock.calls]);
    for (const marker of [
      "PRIVATE_INPUT", "PRIVATE_IMAGE", "PRIVATE_INSTRUCTIONS", "PRIVATE_SCHEMA_NAME", "PRIVATE_SCHEMA_DESCRIPTION",
      "PRIVATE_SCHEMA_BODY", "PRIVATE_DEFAULT_MODEL", "PRIVATE_COMPLETION", "PRIVATE_RESPONSE_ID", "PRIVATE_RESPONSE_MODEL",
      "PRIVATE_ERROR", "private-source", "private-provider.test", "sk-private-key",
    ]) expect(logs).not.toContain(marker);
    expect(logs).toContain('"callType":"responses"');
    expect(logs).toContain('"contentChars":18');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("retains safe rejection and no fallback for legacy schema-free output", async () => {
    const { client, fetcher } = makeClient();
    fetcher.mockResolvedValueOnce(Response.json({ choices: [{ message: { role: "assistant", content: "HOSTILE_CHAT_OUTPUT" } }] }));

    const error = await client.completeChat({ messages: [{ role: "user", content: "legacy input" }] }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LiteLlmError);
    expect(error).toMatchObject({ statusCode: 502 });
    expect(JSON.stringify(error)).not.toContain("HOSTILE_CHAT_OUTPUT");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://private-provider.test/v1/responses");
  });
});
