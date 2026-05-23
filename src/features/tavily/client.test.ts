import { describe, expect, it } from "vitest";

import { createTavilyClient } from "./client";

describe("Tavily client", () => {
  it("posts search requests with bearer auth and default body parameters", async () => {
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://tavily.test/search");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        accept: "application/json",
        authorization: "Bearer tvly-secret",
        "content-type": "application/json",
      });

      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        query: "ComfyUI euler normal cfg steps face detail",
        search_depth: "basic",
        max_results: 5,
        include_answer: "basic",
        include_raw_content: false,
        include_images: false,
        include_domains: ["civitai.com"],
      });

      return Response.json({
        answer: "Use moderate CFG and LoRA weight.",
        query: body.query,
        results: [
          {
            title: "ComfyUI settings guide",
            url: "https://civitai.com/articles/1",
            content: " ".repeat(2) + "CFG around 5-7 can help avoid harsh faces.",
            score: 0.9,
            raw_content: "should not be exposed",
          },
        ],
      });
    };

    const client = createTavilyClient({
      apiKey: "tvly-secret",
      baseUrl: "https://tavily.test/",
      fetcher: fetcher as typeof fetch,
    });

    await expect(
      client.search("ComfyUI euler normal cfg steps face detail", {
        includeDomains: ["civitai.com"],
      }),
    ).resolves.toMatchObject({
      answer: "Use moderate CFG and LoRA weight.",
      query: "ComfyUI euler normal cfg steps face detail",
      results: [
        {
          title: "ComfyUI settings guide",
          url: "https://civitai.com/articles/1",
          content: "CFG around 5-7 can help avoid harsh faces.",
          score: 0.9,
        },
      ],
    });
  });

  it("throws TavilyApiError with status and details for non-2xx responses", async () => {
    const client = createTavilyClient({
      apiKey: "tvly-secret",
      baseUrl: "https://tavily.test",
      fetcher: (async () =>
        Response.json(
          {
            error: "quota exceeded",
          },
          { status: 429 },
        )) as typeof fetch,
    });

    await expect(client.search("query")).rejects.toMatchObject({
      name: "TavilyApiError",
      statusCode: 429,
      details: {
        error: "quota exceeded",
      },
    });
  });
});
