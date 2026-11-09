// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const completeResponse = vi.hoisted(() => vi.fn());
const completeChat = vi.hoisted(() => vi.fn());
const createClient = vi.hoisted(() => vi.fn(() => ({ completeResponse, completeChat })));
const appendLog = vi.hoisted(() => vi.fn(async (record: unknown) => { void record; }));

vi.mock("@/features/llm/litellm-client", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/features/llm/litellm-client")>(),
  createLiteLlmClient: createClient,
}));
vi.mock("@/features/llm/llm-local-log", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/features/llm/llm-local-log")>(),
  appendLlmLocalLog: appendLog,
}));

import { POST as responsesPost } from "./route";
import { POST as chatPost } from "../chat/route";
import { LiteLlmError } from "@/features/llm/litellm-client";
import { getRunScenePromptResponseFormat } from "@/features/llm/run-scene-prompt-response-format";
import type { LlmGenerationOptions } from "@/features/llm/types";

function request(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("LITELLM_BASE_URL", "https://private-endpoint.test");
  vi.stubEnv("LITELLM_API_KEY", "sk-private-route-key");
  vi.stubEnv("LITELLM_DEFAULT_MODEL", "default-model");
  vi.stubEnv("LITELLM_NSFW_MODEL", "nsfw-model");
  vi.stubEnv("LITELLM_POSE_MODEL", "pose-model");
  vi.stubEnv("LITELLM_CLASSIFICATION_MODEL", "classification-model");
  vi.stubEnv("LITELLM_COMFYUI_DIAGNOSIS_MODEL", "diagnosis-model");
  vi.stubEnv("LITELLM_CIVITAI_RECOMMENDATION_MODEL", "recommendation-model");
  vi.stubEnv("LITELLM_VISION_MODEL", "vision-model");
  completeResponse.mockResolvedValue({ role: "assistant", content: "PRIVATE_COMPLETION", finishReason: "stop" });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe.each([
  ["/api/llm/responses", responsesPost],
  ["/api/llm/chat", chatPost],
] as const)("%s shared Responses contract", (path, post) => {
  it.each([undefined, true, false] as const)("accepts a native string and generic schema with strict=%s", async (strict) => {
    const body = {
      input: "PRIVATE_INPUT",
      instructions: "PRIVATE_INSTRUCTIONS",
      max_output_tokens: 256,
      text: { format: {
        type: "json_schema", name: "PRIVATE_SCHEMA_NAME", description: "PRIVATE_SCHEMA_DESCRIPTION",
        schema: { type: "object", properties: { caption: { type: "string", description: "PRIVATE_SCHEMA_BODY" } } },
        ...(strict === undefined ? {} : { strict }),
      } },
    };
    const response = await post(request(path, body));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ role: "assistant", content: "PRIVATE_COMPLETION", finishReason: "stop" });
    expect(completeResponse).toHaveBeenCalledExactlyOnceWith({ ...body, model: "default-model" });
    expect(completeChat).not.toHaveBeenCalled();
    expect(createClient).toHaveBeenCalledExactlyOnceWith({
      baseUrl: "https://private-endpoint.test", apiKey: "sk-private-route-key", defaultModel: "default-model",
    });
    const logs = JSON.stringify(appendLog.mock.calls);
    for (const marker of ["PRIVATE_INPUT", "PRIVATE_INSTRUCTIONS", "PRIVATE_SCHEMA_NAME", "PRIVATE_SCHEMA_DESCRIPTION", "PRIVATE_SCHEMA_BODY", "PRIVATE_COMPLETION", "default-model", "private-endpoint", "sk-private-route-key"]) {
      expect(logs).not.toContain(marker);
    }
    expect(logs).toContain('"privacy":"responses-safe"');
    expect(appendLog.mock.calls).toHaveLength(2);
    expect(appendLog.mock.calls[0]?.[0]).toMatchObject({ route: path, phase: "request", payload: { callType: "responses" } });
  });

  it("preserves ordered native multimodal items through the shared handler", async () => {
    const input = [
      { type: "message", role: "developer", content: "PRIVATE_DEVELOPER" },
      { role: "user", content: [
        { type: "input_text", text: "PRIVATE_FIRST" },
        { type: "input_image", image_url: "data:image/png;base64,PRIVATE_IMAGE", detail: "high" },
        { type: "input_image", image_url: "https://images.example.test/PRIVATE_IMAGE.png?exact=1%202", detail: "low" },
        { type: "input_text", text: "PRIVATE_LAST" },
      ] },
    ];
    expect((await post(request(path, { input }))).status).toBe(200);
    expect(completeResponse).toHaveBeenCalledExactlyOnceWith({ input, model: "default-model" });
    expect(JSON.stringify(appendLog.mock.calls)).not.toContain("PRIVATE_");
  });

  it("accepts the legacy messages shape and normalized result", async () => {
    const body = { messages: [{ role: "user", content: "legacy input" }], maxTokens: 128 };
    expect((await post(request(path, body))).status).toBe(200);
    expect(completeResponse).toHaveBeenCalledExactlyOnceWith({ ...body, model: "default-model" });
    expect(completeChat).not.toHaveBeenCalled();
  });

  it.each([
    ["input", { input: "native", messages: [{ role: "user", content: "legacy" }] }],
    ["tokens", { input: "native", maxTokens: 5, max_output_tokens: 5 }],
    ["format", { input: "native", responseFormat: getRunScenePromptResponseFormat("krea2"), text: { format: { type: "text" } } }],
    ["legacy arbitrary schema", { messages: [{ role: "user", content: "legacy" }], responseFormat: { type: "json_schema", json_schema: { name: "generic", schema: {}, strict: true } } }],
    ["invalid native schema", { input: "native", text: { format: { type: "json_schema", name: "generic", schema: [] } } }],
    ["javascript image URL", { input: [{ role: "user", content: [{ type: "input_image", image_url: "javascript:alert(1)" }] }] }],
    ["file image URL", { input: [{ role: "user", content: [{ type: "input_image", image_url: "file:///private/image.png" }] }] }],
    ["malformed image URL", { input: [{ role: "user", content: [{ type: "input_image", image_url: "https://" }] }] }],
  ])("rejects %s before constructing the client or calling upstream", async (_label, body) => {
    const response = await post(request(path, body));
    expect(response.status).toBe(400);
    expect(createClient).not.toHaveBeenCalled();
    expect(completeResponse).not.toHaveBeenCalled();
    expect(completeChat).not.toHaveBeenCalled();
    expect(appendLog).not.toHaveBeenCalled();
  });

  it("returns a safe invalid-JSON error without constructing the client", async () => {
    const response = await post(new Request(`http://localhost${path}`, { method: "POST", body: "{PRIVATE_MALFORMED" }));
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).not.toContain("PRIVATE_MALFORMED");
    expect(createClient).not.toHaveBeenCalled();
  });

  it("returns a sanitized native schema failure once with metadata-only logs", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    completeResponse.mockRejectedValueOnce(new LiteLlmError("LiteLLM Responses request failed.", {
      statusCode: 422, details: { code: "structured_output_rejected", upstreamStatus: 422 },
    }));
    const response = await post(request(path, {
      input: "PRIVATE_INPUT", text: { format: { type: "json_schema", name: "PRIVATE_SCHEMA_NAME", schema: { description: "PRIVATE_SCHEMA_BODY" }, strict: false } },
    }));
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: {
      message: "LiteLLM Responses request failed.", details: { code: "structured_output_rejected", upstreamStatus: 422 },
    } });
    expect(completeResponse).toHaveBeenCalledTimes(1);
    expect(completeChat).not.toHaveBeenCalled();
    expect(JSON.stringify(appendLog.mock.calls)).not.toContain("PRIVATE_");
  });
});

describe("native Responses model routing", () => {
  const cases: Array<[LlmGenerationOptions, string]> = [
    [{}, "default-model"],
    [{ model: "explicit-model" }, "explicit-model"],
    [{ purpose: "prompt-library-classification" }, "classification-model"],
    [{ purpose: "stick-figure-pose-generation" }, "pose-model"],
    [{ purpose: "comfyui-generation-diagnosis" }, "diagnosis-model"],
    [{ purpose: "comfyui-inpaint-diagnosis" }, "diagnosis-model"],
    [{ purpose: "civitai-combination-recommendation" }, "recommendation-model"],
    [{ purpose: "story-style-reference-analysis", nsfw: true }, "vision-model"],
    [{ purpose: "story-style-reference-analysis", nsfw: true, model: "explicit-vision" }, "explicit-vision"],
    [{ purpose: "single-image-preview-scoring", nsfw: true, model: "explicit-model" }, "default-model"],
    [{ purpose: "single-image-final-review", model: "explicit-review" }, "explicit-review"],
    [{ purpose: "single-image-repair-diagnosis", model: "explicit-repair" }, "explicit-repair"],
    [{ purpose: "single-image-repair-verification", model: "explicit-verification" }, "explicit-verification"],
    [{ purpose: "single-image-final-review", nsfw: true, model: "explicit-review" }, "nsfw-model"],
    [{ purpose: "single-image-repair-diagnosis", nsfw: true, model: "explicit-repair" }, "nsfw-model"],
    [{ purpose: "single-image-repair-verification", nsfw: true, model: "explicit-verification" }, "nsfw-model"],
    [{ purpose: "stable-diffusion-prompt-generation", nsfw: true, model: "explicit-model" }, "nsfw-model"],
  ];
  it.each(cases)("routes %j to %s", async (options, model) => {
    const response = await responsesPost(request("/api/llm/responses", { input: "Describe scene", ...options }));
    expect(response.status).toBe(200);
    expect(completeResponse).toHaveBeenCalledExactlyOnceWith({ input: "Describe scene", ...options, model });
  });

  it("refuses preview scoring without a default model even with explicit and vision models", async () => {
    vi.stubEnv("LITELLM_DEFAULT_MODEL", "");
    const response = await responsesPost(request("/api/llm/responses", {
      input: "Score preview", purpose: "single-image-preview-scoring", model: "explicit", nsfw: true,
    }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "llm_config", details: { recoverable: true } } });
    expect(createClient).not.toHaveBeenCalled();
  });
});
