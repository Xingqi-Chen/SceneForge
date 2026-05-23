// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const validBody = {
  config: {
    cfg: 7,
    checkpointBaseModel: "Pony",
    checkpointName: "base.safetensors",
    checkpointResourceName: "Base Checkpoint",
    denoise: 1,
    height: 768,
    imageCount: 1,
    loras: [
      {
        enabled: true,
        loraName: "style.safetensors",
        resourceName: "Style LoRA",
        strengthClip: 0.7,
        strengthModel: 0.7,
        tags: ["cinematic"],
        trainedWords: ["style trigger"],
      },
    ],
    negativePrompt: "low quality",
    outputPrefix: "SceneForge",
    positivePrompt: "portrait",
    samplerName: "euler",
    scheduler: "normal",
    seed: 123,
    seedMode: "random",
    steps: 30,
    width: 1024,
  },
  userInput: "make face sharper",
  visualDiagnosis: {
    confidence: 0.8,
    loraInfluence: "Style LoRA is a bit strong.",
    observations: [
      {
        category: "face",
        evidence: "soft eyes",
        fixDirection: "increase facial detail",
        likelyCause: "prompt lacks face detail",
        severity: "medium",
      },
    ],
    promptAlignment: "mostly aligned",
    summary: "Face is soft.",
    warnings: [],
  },
};

describe("ComfyUI diagnosis web context route", () => {
  const previousTavilyApiKey = process.env.TAVILY_API_KEY;
  const previousTavilyBaseUrl = process.env.TAVILY_BASE_URL;

  afterEach(() => {
    if (previousTavilyApiKey === undefined) {
      delete process.env.TAVILY_API_KEY;
    } else {
      process.env.TAVILY_API_KEY = previousTavilyApiKey;
    }

    if (previousTavilyBaseUrl === undefined) {
      delete process.env.TAVILY_BASE_URL;
    } else {
      process.env.TAVILY_BASE_URL = previousTavilyBaseUrl;
    }

    vi.restoreAllMocks();
  });

  it("returns disabled context when Tavily is not configured", async () => {
    delete process.env.TAVILY_API_KEY;

    const response = await POST(
      new Request("http://localhost/api/comfyui/diagnosis/web-context", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validBody),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      enabled: false,
      sources: [],
    });
    expect(payload.queries).toHaveLength(3);
    expect(payload.warnings[0]).toContain("TAVILY_API_KEY");
  });

  it("searches Tavily with at most three generated queries", async () => {
    process.env.TAVILY_API_KEY = "tvly-secret";
    process.env.TAVILY_BASE_URL = "https://tavily.test";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      expect(String(input)).toBe("https://tavily.test/search");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        authorization: "Bearer tvly-secret",
        "content-type": "application/json",
      });

      const body = JSON.parse(String(init?.body));
      expect(body.include_domains).toContain("civitai.com");
      expect(body.max_results).toBe(5);
      expect(body.search_depth).toBe("basic");

      return Response.json({
        answer: `answer for ${body.query}`,
        query: body.query,
        results: [
          {
            title: `Source for ${body.query}`,
            url: `https://civitai.com/articles/${fetchSpy.mock.calls.length}`,
            content: "Use moderate LoRA weight and focused face detail prompts.",
            score: 0.9,
          },
        ],
      });
    });

    const response = await POST(
      new Request("http://localhost/api/comfyui/diagnosis/web-context", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validBody),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(payload.enabled).toBe(true);
    expect(payload.queries).toHaveLength(3);
    expect(payload.sources).toHaveLength(3);
    expect(payload.summary).toContain("answer for");
  });

  it("returns warnings instead of failing when Tavily search fails", async () => {
    process.env.TAVILY_API_KEY = "tvly-secret";
    process.env.TAVILY_BASE_URL = "https://tavily.test";
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json({ error: "quota exceeded" }, { status: 429 }),
    );

    const response = await POST(
      new Request("http://localhost/api/comfyui/diagnosis/web-context", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validBody),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.enabled).toBe(true);
    expect(payload.sources).toEqual([]);
    expect(payload.warnings.join("\n")).toContain("Tavily search failed");
  });
});
