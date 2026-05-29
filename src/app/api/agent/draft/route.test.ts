// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const ENV_KEYS = ["LITELLM_BASE_URL", "LITELLM_API_KEY", "LITELLM_DEFAULT_MODEL", "LITELLM_NSFW_MODEL"] as const;

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/agent/draft", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function draftContent(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    title: "Rain Alley",
    positivePrompt: "cinematic rain alley, neon reflections",
    negativePrompt: "low quality",
    comfyUiRequest: {
      checkpointName: "llm-checkpoint.safetensors",
      loras: [{ loraName: "rain-style.safetensors", strengthModel: 0.8, strengthClip: 0.75 }],
      width: 768,
      height: 1024,
      steps: 28,
      cfg: 6.5,
      samplerName: "euler",
      scheduler: "normal",
      denoise: 1,
      batchSize: 1,
      latentImageNode: "EmptyLatentImage",
      outputPrefix: "AgentDraft",
      seed: 123,
    },
    warnings: ["Verify the checkpoint and LoRA exist locally before generation."],
    ...overrides,
  });
}

describe("Agent draft route", () => {
  let previousEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;

  beforeEach(() => {
    previousEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    process.env.LITELLM_BASE_URL = "https://litellm.test";
    process.env.LITELLM_API_KEY = "secret";
    process.env.LITELLM_DEFAULT_MODEL = "agent-model";
    process.env.LITELLM_NSFW_MODEL = "agent-nsfw-model";
  });

  afterEach(() => {
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

  it("returns an editable draft with LLM-selected generation defaults", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      expect(input).toBe("https://litellm.test/v1/chat/completions");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        "content-type": "application/json",
        authorization: "Bearer secret",
      });

      const requestBody = JSON.parse(String(init?.body)) as {
        model: string;
        messages: Array<{ role: string; content: string }>;
        stream: boolean;
      };
      expect(requestBody.model).toBe("agent-model");
      expect(requestBody.stream).toBe(true);
      expect(requestBody.messages[0]?.content).toContain("Choose checkpointName and LoRAs");
      expect(JSON.parse(requestBody.messages[1]?.content ?? "{}")).toEqual({
        userRequest: "make a cinematic rain alley",
        nsfw: false,
      });

      return Response.json({
        choices: [
          {
            message: {
              role: "assistant",
              content: draftContent(),
            },
            finish_reason: "stop",
          },
        ],
      });
    });

    const response = await POST(makeRequest({ userRequest: "make a cinematic rain alley" }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(payload).toMatchObject({
      status: "draft",
      title: "Rain Alley",
      positivePrompt: "cinematic rain alley, neon reflections",
      negativePrompt: "low quality",
      confirmationRequired: true,
      comfyUiRequest: {
        checkpointName: "llm-checkpoint.safetensors",
        positivePrompt: "cinematic rain alley, neon reflections",
        negativePrompt: "low quality",
        width: 768,
        height: 1024,
        steps: 28,
        cfg: 6.5,
        samplerName: "euler",
        scheduler: "normal",
        denoise: 1,
        batchSize: 1,
        latentImageNode: "EmptyLatentImage",
        outputPrefix: "AgentDraft",
        loras: [{ loraName: "rain-style.safetensors", strengthModel: 0.8, strengthClip: 0.75 }],
      },
    });
    expect(payload.draftId).toEqual(expect.any(String));
    expect(payload.warnings).toEqual(
      expect.arrayContaining([
        "Verify the checkpoint and LoRA exist locally before generation.",
        "Ignored LLM-suggested seed; seed selection belongs to the confirmed execution step.",
      ]),
    );
  });

  it("uses the configured NSFW model for NSFW drafts", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const requestBody = JSON.parse(String(init?.body)) as { model: string };
      expect(requestBody.model).toBe("agent-nsfw-model");

      return Response.json({
        choices: [
          {
            message: {
              role: "assistant",
              content: draftContent({
                positivePrompt: "moody portrait lighting",
              }),
            },
          },
        ],
      });
    });

    const response = await POST(makeRequest({ userRequest: "draft a portrait", nsfw: true }));

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("ignores request model and default overrides and uses environment model selection", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const requestBody = JSON.parse(String(init?.body)) as {
        messages: Array<{ content: string }>;
        model: string;
      };
      expect(requestBody.model).toBe("agent-model");
      expect(JSON.parse(requestBody.messages[1]?.content ?? "{}")).toEqual({
        userRequest: "draft a castle",
        nsfw: false,
      });

      return Response.json({
        choices: [
          {
            message: {
              role: "assistant",
              content: draftContent(),
            },
          },
        ],
      });
    });

    const response = await POST(makeRequest({
      userRequest: "draft a castle",
      model: "manual-model",
      generationDefaults: {
        checkpointName: "client-checkpoint.safetensors",
        width: 512,
      },
    }));

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid draft requests before calling LiteLLM", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await POST(makeRequest({ userRequest: " " }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatchObject({
      code: "agent_request_invalid",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns llm_config when LiteLLM configuration is missing", async () => {
    delete process.env.LITELLM_BASE_URL;
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const response = await POST(makeRequest({ userRequest: "draft a fantasy tower" }));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toMatchObject({
      code: "llm_config",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("maps malformed LiteLLM chat completions to llm_malformed_response", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json({
        choices: [],
      }),
    );

    const response = await POST(makeRequest({ userRequest: "draft a mountain village" }));
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(payload.error).toMatchObject({
      code: "llm_malformed_response",
    });
  });

  it("maps non-JSON draft content to agent_draft_invalid", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json({
        choices: [
          {
            message: {
              role: "assistant",
              content: "not json",
            },
          },
        ],
      }),
    );

    const response = await POST(makeRequest({ userRequest: "draft a forest shrine" }));
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(payload.error).toMatchObject({
      code: "agent_draft_invalid",
    });
  });

  it("rejects draft content without editable generation defaults", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json({
        choices: [
          {
            message: {
              role: "assistant",
              content: JSON.stringify({
                positivePrompt: "forest shrine",
              }),
            },
          },
        ],
      }),
    );

    const response = await POST(makeRequest({ userRequest: "draft a forest shrine" }));
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(payload.error).toMatchObject({
      code: "agent_draft_invalid",
    });
  });

  it("rejects draft content with incomplete generation defaults", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json({
        choices: [
          {
            message: {
              role: "assistant",
              content: draftContent({
                comfyUiRequest: {
                  checkpointName: "llm-checkpoint.safetensors",
                },
              }),
            },
          },
        ],
      }),
    );

    const response = await POST(makeRequest({ userRequest: "draft a forest shrine" }));
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(payload.error).toMatchObject({
      code: "agent_draft_invalid",
      details: {
        missingFields: expect.arrayContaining(["width", "height", "steps", "cfg"]),
      },
    });
  });
});
