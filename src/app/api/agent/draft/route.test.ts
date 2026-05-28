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

  it("returns an editable draft and preserves explicit model defaults", async () => {
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
      expect(requestBody.messages[0]?.content).toContain("Do not invent checkpointName");
      expect(JSON.parse(requestBody.messages[1]?.content ?? "{}")).toMatchObject({
        userRequest: "make a cinematic rain alley",
        generationDefaults: {
          checkpointName: "approved.safetensors",
          width: 512,
        },
      });

      return Response.json({
        choices: [
          {
            message: {
              role: "assistant",
              content: JSON.stringify({
                title: "Rain Alley",
                positivePrompt: "cinematic rain alley, neon reflections",
                negativePrompt: "low quality",
                comfyUiRequest: {
                  checkpointName: "invented.safetensors",
                  loras: [{ loraName: "invented.safetensors", strengthModel: 0.8 }],
                  width: 768,
                  height: 1024,
                  seed: 123,
                },
                warnings: ["Select a local checkpoint before generation."],
              }),
            },
            finish_reason: "stop",
          },
        ],
      });
    });

    const response = await POST(
      makeRequest({
        userRequest: "make a cinematic rain alley",
        generationDefaults: {
          checkpointName: "approved.safetensors",
          width: 512,
          loras: [{ loraName: "approved-lora.safetensors", strengthModel: 0.7 }],
        },
      }),
    );
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
        checkpointName: "approved.safetensors",
        positivePrompt: "cinematic rain alley, neon reflections",
        negativePrompt: "low quality",
        width: 512,
        height: 1024,
        loras: [{ loraName: "approved-lora.safetensors", strengthModel: 0.7 }],
      },
    });
    expect(payload.draftId).toEqual(expect.any(String));
    expect(payload.warnings).toEqual(
      expect.arrayContaining([
        "Select a local checkpoint before generation.",
        "Ignored LLM-suggested checkpointName; choose a checkpoint explicitly before confirmation.",
        "Ignored LLM-suggested LoRAs; choose LoRAs explicitly before confirmation.",
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
              content: JSON.stringify({
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
});
