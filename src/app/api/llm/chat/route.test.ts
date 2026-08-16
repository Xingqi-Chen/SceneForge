// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const completeChatMock = vi.hoisted(() => vi.fn());
const completeResponseMock = vi.hoisted(() => vi.fn());
const createLiteLlmClientMock = vi.hoisted(() => vi.fn(() => ({
  completeChat: completeChatMock,
  completeResponse: completeResponseMock,
})));
const appendLlmLocalLogMock = vi.hoisted(() => vi.fn(async (record: unknown) => {
  void record;
}));

vi.mock("@/features/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/llm")>();
  return {
    ...actual,
    createLiteLlmClient: createLiteLlmClientMock,
  };
});

vi.mock("@/features/llm/llm-local-log", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/llm/llm-local-log")>();
  return {
    ...actual,
    appendLlmLocalLog: appendLlmLocalLogMock,
  };
});

import { POST, resolveDefaultModel, resolveRequestModel } from "./route";
import { getRunScenePromptResponseFormat, LiteLlmError } from "@/features/llm";

const ENV_KEYS = [
  "LITELLM_DEFAULT_MODEL",
  "LITELLM_NSFW_MODEL",
  "LITELLM_POSE_MODEL",
  "LITELLM_COMFYUI_DIAGNOSIS_MODEL",
  "LITELLM_CLASSIFICATION_MODEL",
  "LITELLM_VISION_MODEL",
] as const;

describe("LLM chat route model selection", () => {
  let previousEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;

  beforeEach(() => {
    previousEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    process.env.LITELLM_DEFAULT_MODEL = "default-model";
    process.env.LITELLM_NSFW_MODEL = "nsfw-model";
    process.env.LITELLM_POSE_MODEL = "pose-model";
    process.env.LITELLM_COMFYUI_DIAGNOSIS_MODEL = "diagnosis-model";
    process.env.LITELLM_CLASSIFICATION_MODEL = "classification-model";
    process.env.LITELLM_VISION_MODEL = "vision-model";
  });

  afterEach(() => {
    completeChatMock.mockReset();
    completeResponseMock.mockReset();
    createLiteLlmClientMock.mockClear();
    appendLlmLocalLogMock.mockClear();
    vi.restoreAllMocks();
    for (const key of ENV_KEYS) {
      const value = previousEnv[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("uses the NSFW model for ordinary AI request purposes when enabled", () => {
    expect(
      resolveDefaultModel({
        purpose: "scene-prompt-reverse",
        nsfw: true,
        messages: [{ role: "user", content: "Reverse this canvas" }],
      }),
    ).toBe("nsfw-model");

    expect(
      resolveDefaultModel({
        purpose: "prompt-tag-reverse",
        nsfw: true,
        messages: [{ role: "user", content: "Reverse tags" }],
      }),
    ).toBe("nsfw-model");

    expect(
      resolveDefaultModel({
        purpose: "stick-figure-pose-generation",
        nsfw: true,
        messages: [{ role: "user", content: "Generate a pose" }],
      }),
    ).toBe("nsfw-model");

    expect(
      resolveDefaultModel({
        purpose: "comic-sequence-storyboard",
        nsfw: true,
        messages: [{ role: "user", content: "Split this action paragraph into shots" }],
      }),
    ).toBe("nsfw-model");

    expect(
      resolveDefaultModel({
        purpose: "comfyui-generation-diagnosis",
        nsfw: true,
        messages: [{ role: "user", content: "Diagnose this" }],
      }),
    ).toBe("nsfw-model");

    expect(
      resolveDefaultModel({
        purpose: "prompt-library-classification",
        nsfw: true,
        messages: [{ role: "user", content: "Classify this" }],
      }),
    ).toBe("nsfw-model");
  });

  it("falls back to the purpose-specific model when the NSFW model is not configured", () => {
    delete process.env.LITELLM_NSFW_MODEL;

    expect(
      resolveDefaultModel({
        purpose: "stick-figure-pose-generation",
        nsfw: true,
        messages: [{ role: "user", content: "Generate a pose" }],
      }),
    ).toBe("pose-model");

    expect(
      resolveDefaultModel({
        purpose: "comic-sequence-storyboard",
        nsfw: true,
        messages: [{ role: "user", content: "Split this action paragraph into shots" }],
      }),
    ).toBe("default-model");
  });

  it("overrides an explicit request model when NSFW is enabled", () => {
    expect(
      resolveRequestModel({
        model: "explicit-model",
        purpose: "stable-diffusion-prompt-generation",
        nsfw: true,
        messages: [{ role: "user", content: "Generate a prompt" }],
      }),
    ).toBe("nsfw-model");

    expect(
      resolveRequestModel({
        model: "explicit-model",
        purpose: "stable-diffusion-prompt-generation",
        messages: [{ role: "user", content: "Generate a prompt" }],
      }),
    ).toBe("explicit-model");
  });

  it("uses the vision model for Story style reference analysis", () => {
    expect(
      resolveDefaultModel({
        purpose: "story-style-reference-analysis",
        messages: [{ role: "user", content: "Analyze this style reference" }],
      }),
    ).toBe("vision-model");

    delete process.env.LITELLM_VISION_MODEL;

    expect(
      resolveDefaultModel({
        purpose: "story-style-reference-analysis",
        messages: [{ role: "user", content: "Analyze this style reference" }],
      }),
    ).toBe("default-model");
  });

  it("keeps Story style reference analysis on a vision-capable model when NSFW is enabled", () => {
    expect(
      resolveDefaultModel({
        purpose: "story-style-reference-analysis",
        nsfw: true,
        messages: [{ role: "user", content: "Analyze this style reference" }],
      }),
    ).toBe("vision-model");

    expect(
      resolveRequestModel({
        purpose: "story-style-reference-analysis",
        nsfw: true,
        messages: [{ role: "user", content: "Analyze this style reference" }],
      }),
    ).toBe("vision-model");

    expect(
      resolveRequestModel({
        model: "explicit-vision-model",
        purpose: "story-style-reference-analysis",
        nsfw: true,
        messages: [{ role: "user", content: "Analyze this style reference" }],
      }),
    ).toBe("explicit-vision-model");
  });

  it.each([
    ["ordinary", false],
    ["NSFW", true],
  ])("fixes %s preview scoring to the default model despite explicit, Vision, and NSFW overrides", (_label, nsfw) => {
    const request = {
      model: "explicit-model",
      purpose: "single-image-preview-scoring" as const,
      nsfw,
      messages: [{ role: "user" as const, content: "Score these previews" }],
    };

    expect(resolveDefaultModel(request)).toBe("default-model");
    expect(resolveRequestModel(request)).toBe("default-model");
  });

  it("does not let an explicit preview-scoring model bypass a missing default model", () => {
    delete process.env.LITELLM_DEFAULT_MODEL;

    const request = {
      model: "explicit-model",
      purpose: "single-image-preview-scoring" as const,
      nsfw: true,
      messages: [{ role: "user" as const, content: "Score these previews" }],
    };

    expect(resolveDefaultModel(request)).toBeUndefined();
    expect(resolveRequestModel(request)).toBeUndefined();
  });

  it("returns a safe recoverable config error before creating a provider client when preview scoring has no default model", async () => {
    delete process.env.LITELLM_DEFAULT_MODEL;

    const response = await POST(new Request("http://localhost/api/llm/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "explicit-model",
        purpose: "single-image-preview-scoring",
        nsfw: true,
        messages: [{ role: "user", content: "Score these previews" }],
      }),
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "llm_config",
        message: "LITELLM_DEFAULT_MODEL must be configured with a model that supports multimodal image input and permits the content being scored.",
        details: { recoverable: true },
      },
    });
    expect(createLiteLlmClientMock).not.toHaveBeenCalled();
    expect(completeChatMock).not.toHaveBeenCalled();
  });

  it.each(["illustrious", "anima", "krea2"] as const)(
    "routes the exact %s Run scene-prompt response format through Responses",
    async (profile) => {
    const responseFormat = getRunScenePromptResponseFormat(profile);
    completeResponseMock.mockResolvedValue({
      role: "assistant",
      content: "{}",
    });

    const response = await POST(new Request("http://localhost/api/llm/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        purpose: "stable-diffusion-prompt-generation",
        messages: [{ role: "user", content: "Generate a prompt" }],
        responseFormat,
      }),
    }));

    expect(response.status).toBe(200);
    expect(createLiteLlmClientMock).toHaveBeenCalledTimes(1);
    expect(completeResponseMock).toHaveBeenCalledTimes(1);
    expect(completeResponseMock).toHaveBeenCalledWith(expect.objectContaining({
      purpose: "stable-diffusion-prompt-generation",
      model: "default-model",
      responseFormat,
    }));
    expect(completeChatMock).not.toHaveBeenCalled();
  });

  it("keeps the generic Run Scene Prompt Responses local-log payload metadata-only", async () => {
    const responseFormat = getRunScenePromptResponseFormat("krea2");
    process.env.LITELLM_DEFAULT_MODEL = "SENTINEL_SCENE_RESPONSES_MODEL";
    completeResponseMock.mockResolvedValue({
      id: "SENTINEL_SCENE_RESPONSE_ID",
      model: "SENTINEL_SCENE_RESPONSE_MODEL",
      role: "assistant",
      content: "SENTINEL_SCENE_RAW_OUTPUT",
    });

    const response = await POST(new Request("http://localhost/api/llm/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        purpose: "stable-diffusion-prompt-generation",
        messages: [{ role: "user", content: "SENTINEL_SCENE_PROMPT" }],
        responseFormat,
      }),
    }));

    expect(response.status).toBe(200);
    expect(completeResponseMock).toHaveBeenCalledTimes(1);
    expect(completeChatMock).not.toHaveBeenCalled();
    const logs = JSON.stringify(appendLlmLocalLogMock.mock.calls);
    for (const sentinel of [
      "SENTINEL_SCENE_RESPONSES_MODEL",
      "SENTINEL_SCENE_RESPONSE_ID",
      "SENTINEL_SCENE_RESPONSE_MODEL",
      "SENTINEL_SCENE_RAW_OUTPUT",
      "SENTINEL_SCENE_PROMPT",
      JSON.stringify(responseFormat.json_schema.schema),
      responseFormat.json_schema.name,
    ]) {
      expect(logs).not.toContain(sentinel);
    }
    expect(logs).toContain('"privacy":"responses-safe"');
    expect(logs).toContain('"callType":"responses"');
  });

  it.each([
    ["json_object", { type: "json_object" }],
    ["arbitrary schema", {
      type: "json_schema",
      json_schema: {
        name: "caller_authored",
        strict: true,
        schema: { type: "object" },
      },
    }],
    ["malformed schema", {
      type: "json_schema",
      json_schema: { name: "sceneforge_run_scene_prompt_illustrious_v1" },
    }],
    ["mutated authorized schema", (() => {
      const format = JSON.parse(JSON.stringify(getRunScenePromptResponseFormat("illustrious")));
      format.json_schema.schema.additionalProperties = true;
      return format;
    })()],
    ["cross-purpose authorized schema", getRunScenePromptResponseFormat("krea2")],
  ])("rejects %s responseFormat before creating or calling the provider", async (label, responseFormat) => {
    const response = await POST(new Request("http://localhost/api/llm/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        purpose: label === "cross-purpose authorized schema"
          ? "scene-prompt-reverse"
          : "stable-diffusion-prompt-generation",
        messages: [{ role: "user", content: "Generate a prompt" }],
        responseFormat,
      }),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { message: "Request body must include non-empty chat messages." },
    });
    expect(createLiteLlmClientMock).not.toHaveBeenCalled();
    expect(completeChatMock).not.toHaveBeenCalled();
    expect(completeResponseMock).not.toHaveBeenCalled();
  });

  it("keeps requests without responseFormat unchanged", async () => {
    completeChatMock.mockResolvedValue({
      role: "assistant",
      content: "ordinary response",
    });

    const response = await POST(new Request("http://localhost/api/llm/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        purpose: "scene-prompt-reverse",
        messages: [{ role: "user", content: "Reverse a prompt" }],
      }),
    }));

    expect(response.status).toBe(200);
    expect(completeChatMock).toHaveBeenCalledTimes(1);
    expect(completeResponseMock).not.toHaveBeenCalled();
    const forwarded = completeChatMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(forwarded).not.toHaveProperty("responseFormat");
    const logs = JSON.stringify(appendLlmLocalLogMock.mock.calls);
    expect(logs).toContain("Reverse a prompt");
    expect(logs).toContain("ordinary response");
    expect(logs).toContain("default-model");
  });

  it.each([
    "prompt-tag-reverse",
    "stick-figure-pose-generation",
    "stable-diffusion-prompt-generation",
    "comic-sequence-storyboard",
    "story-style-reference-analysis",
  ] as const)("keeps generic %s calls on Chat when they do not cross a Run-only boundary", async (purpose) => {
    completeChatMock.mockResolvedValue({
      role: "assistant",
      content: "ordinary response",
    });

    const response = await POST(new Request("http://localhost/api/llm/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        purpose,
        messages: [{ role: "user", content: "Generic non-Run request" }],
      }),
    }));

    expect(response.status).toBe(200);
    expect(completeChatMock).toHaveBeenCalledTimes(1);
    expect(completeResponseMock).not.toHaveBeenCalled();
  });

  it("returns one sanitized provider rejection without a second call or fallback", async () => {
    const responseFormat = getRunScenePromptResponseFormat("krea2");
    const sensitiveMarkers = [
      "sk-private-route-key-marker",
      "RAW_ROUTE_PROMPT_MARKER",
      "route-provider.private.internal",
      "route-private-model-v4",
    ];
    const fullSchema = JSON.stringify(responseFormat.json_schema.schema);
    const rawDetails = {
      error: {
        message: `Provider ${sensitiveMarkers[2]} rejected ${sensitiveMarkers[3]}`,
        apiKey: sensitiveMarkers[0],
        rawPrompt: sensitiveMarkers[1],
        request: {
          model: sensitiveMarkers[3],
          messages: [{ role: "user", content: sensitiveMarkers[1] }],
          response_format: responseFormat,
        },
      },
    };
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      void args;
    });
    completeResponseMock.mockRejectedValue(new LiteLlmError(
      "LiteLLM Responses request failed.",
      {
        statusCode: 422,
        details: rawDetails,
      },
    ));

    const response = await POST(new Request("http://localhost/api/llm/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        purpose: "stable-diffusion-prompt-generation",
        messages: [{ role: "user", content: "Generate a prompt" }],
        responseFormat,
      }),
    }));

    expect(response.status).toBe(422);
    const responseBody = await response.json();
    expect(responseBody).toEqual({
      error: {
        message: "LiteLLM Responses request failed.",
        details: {
          code: "structured_output_rejected",
          upstreamStatus: 422,
          responseFormat: {
            type: "json_schema",
            schemaName: "sceneforge_run_scene_prompt_krea2_v1",
            strict: true,
          },
        },
      },
    });
    expect(appendLlmLocalLogMock).toHaveBeenCalledTimes(2);
    expect(appendLlmLocalLogMock.mock.calls[1]?.[0]).toMatchObject({
      phase: "error",
      payload: {
        statusCode: 422,
        details: responseBody.error.details,
      },
    });
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);

    const exposedBoundaryData = JSON.stringify({
      responseBody,
      logCalls: appendLlmLocalLogMock.mock.calls,
      consoleErrorCalls: consoleErrorSpy.mock.calls,
    });
    for (const marker of sensitiveMarkers) {
      expect(exposedBoundaryData).not.toContain(marker);
    }
    expect(exposedBoundaryData).not.toContain(fullSchema);
    expect(exposedBoundaryData).not.toContain("rawPrompt");
    expect(exposedBoundaryData).not.toContain("apiKey");
    expect(exposedBoundaryData).not.toContain("response_format");
    expect(createLiteLlmClientMock).toHaveBeenCalledTimes(1);
    expect(completeResponseMock).toHaveBeenCalledTimes(1);
    expect(completeChatMock).not.toHaveBeenCalled();
  });

  it("preserves only an allowlisted Responses output-shape diagnostic at the route boundary", async () => {
    const responseFormat = getRunScenePromptResponseFormat("anima");
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    completeResponseMock.mockRejectedValue(new LiteLlmError(
      "LiteLLM Responses output did not include completed assistant text.",
      {
        statusCode: 502,
        details: {
          outputShape: "no_message_item",
          rawPayload: "RAW_ROUTE_OUTPUT_MARKER",
          credentials: "sk-route-output-marker",
          schema: responseFormat.json_schema.schema,
        },
      },
    ));

    const response = await POST(new Request("http://localhost/api/llm/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        purpose: "stable-diffusion-prompt-generation",
        messages: [{ role: "user", content: "Generate a prompt" }],
        responseFormat,
      }),
    }));

    expect(response.status).toBe(502);
    const responseBody = await response.json();
    expect(responseBody).toEqual({
      error: {
        message: "LiteLLM Responses output did not include completed assistant text.",
        details: {
          code: "structured_output_rejected",
          upstreamStatus: 502,
          responseFormat: {
            type: "json_schema",
            schemaName: "sceneforge_run_scene_prompt_anima_v1",
            strict: true,
          },
          outputShape: "no_message_item",
        },
      },
    });
    expect(appendLlmLocalLogMock.mock.calls[1]?.[0]).toMatchObject({
      phase: "error",
      payload: {
        statusCode: 502,
        details: responseBody.error.details,
      },
    });
    const exposedBoundaryData = JSON.stringify({
      responseBody,
      logCalls: appendLlmLocalLogMock.mock.calls,
      consoleErrorCalls: consoleErrorSpy.mock.calls,
    });
    expect(exposedBoundaryData).not.toContain("RAW_ROUTE_OUTPUT_MARKER");
    expect(exposedBoundaryData).not.toContain("sk-route-output-marker");
    expect(exposedBoundaryData).not.toContain(JSON.stringify(responseFormat.json_schema.schema));
    expect(completeResponseMock).toHaveBeenCalledTimes(1);
    expect(completeChatMock).not.toHaveBeenCalled();
  });

  it("still routes ordinary NSFW requests to the NSFW model", () => {
    expect(
      resolveRequestModel({
        model: "explicit-model",
        purpose: "stable-diffusion-prompt-generation",
        nsfw: true,
        messages: [{ role: "user", content: "Generate a prompt" }],
      }),
    ).toBe("nsfw-model");
  });
});
