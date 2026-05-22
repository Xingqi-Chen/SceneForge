import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildCivitaiResourceEnrichmentMessages,
  enrichCivitaiResource,
  mergeCivitaiTriggerWords,
  parseCivitaiResourceEnrichmentContent,
} from "./enrichment";
import type { CivitaiResourceUpsertInput } from "./types";

function makeResourceInput(overrides: Partial<CivitaiResourceUpsertInput> = {}): CivitaiResourceUpsertInput {
  return {
    resourceType: "lora",
    civitaiModelId: 1,
    civitaiModelVersionId: 2,
    name: "Example LoRA",
    versionName: "v1",
    hash: null,
    baseModel: "Illustrious",
    trainedWords: [],
    tags: [],
    description: "Trigger word: example",
    creator: null,
    downloadUrl: null,
    filesJson: null,
    officialImagesJson: null,
    category: null,
    categories: [],
    usageGuide: null,
    recommendations: [],
    enrichmentStatus: "fallback",
    enrichmentError: null,
    nsfw: null,
    aiNsfwLevel: "unknown",
    aiNsfwConfidence: null,
    aiNsfwReason: null,
    rawVersionJson: null,
    ...overrides,
  };
}

describe("Civitai resource enrichment", () => {
  let tempDir: string;
  let previousLogFile: string | undefined;
  let previousBaseUrl: string | undefined;
  let previousDefaultModel: string | undefined;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sceneforge-civitai-enrichment-"));
    previousLogFile = process.env.SCENEFORGE_LLM_LOG_FILE;
    previousBaseUrl = process.env.LITELLM_BASE_URL;
    previousDefaultModel = process.env.LITELLM_DEFAULT_MODEL;
    process.env.SCENEFORGE_LLM_LOG_FILE = path.join(tempDir, "llm-chat.jsonl");
    process.env.LITELLM_BASE_URL = "https://litellm.test";
    process.env.LITELLM_DEFAULT_MODEL = "test-model";
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (previousLogFile === undefined) {
      delete process.env.SCENEFORGE_LLM_LOG_FILE;
    } else {
      process.env.SCENEFORGE_LLM_LOG_FILE = previousLogFile;
    }
    if (previousBaseUrl === undefined) {
      delete process.env.LITELLM_BASE_URL;
    } else {
      process.env.LITELLM_BASE_URL = previousBaseUrl;
    }
    if (previousDefaultModel === undefined) {
      delete process.env.LITELLM_DEFAULT_MODEL;
    } else {
      process.env.LITELLM_DEFAULT_MODEL = previousDefaultModel;
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("parses fenced JSON with categories, trigger words, ranges, and redraw rates", () => {
    const parsed = parseCivitaiResourceEnrichmentContent(
      `\`\`\`json
{
  "usageGuide": "适合想要绘画感和降低 AI 感的图像。",
  "categories": ["style", "lighting", "not-valid"],
  "triggerWords": ["XUER guangying,", " xuer guangying "],
  "aiNsfwLevel": "suggestive",
  "aiNsfwConfidence": "0.75",
  "aiNsfwReason": "Style focused, with possible mildly suggestive examples.",
  "recommendations": [
    {
      "condition": "通用",
      "sampler": "DPM++ 2M",
      "loraWeight": "0.8-0.9",
      "hdRedrawRate": "0.42",
      "notes": "厚涂质感更好"
    }
  ]
}
\`\`\``,
      ["other"],
    );

    expect(parsed.usageGuide).toContain("绘画感");
    expect(parsed.categories).toEqual(["style", "lighting"]);
    expect(parsed.triggerWords).toEqual(["XUER guangying"]);
    expect(parsed.aiNsfwLevel).toBe("suggestive");
    expect(parsed.aiNsfwConfidence).toBe(0.75);
    expect(parsed.aiNsfwReason).toContain("suggestive");
    expect(parsed.recommendations).toEqual([
      {
        condition: "通用",
        baseModel: null,
        checkpoint: null,
        sampler: "DPM++ 2M",
        loraWeightMin: 0.8,
        loraWeightMax: 0.9,
        loraWeight: null,
        hdRedrawRate: 0.42,
        notes: "厚涂质感更好",
      },
    ]);
  });

  it("falls back to provided categories when the LLM categories are invalid", () => {
    const parsed = parseCivitaiResourceEnrichmentContent(
      JSON.stringify({
        usageGuide: "",
        categories: ["invalid"],
        triggerWords: [],
        aiNsfwLevel: "invalid",
        aiNsfwConfidence: 2,
        aiNsfwReason: "",
        recommendations: [{ loraWeight: 0.7 }],
      }),
      ["style"],
    );

    expect(parsed.categories).toEqual(["style"]);
    expect(parsed.aiNsfwLevel).toBe("unknown");
    expect(parsed.aiNsfwConfidence).toBe(1);
    expect(parsed.aiNsfwReason).toBeNull();
    expect(parsed.recommendations[0]?.loraWeight).toBe(0.7);
  });

  it("normalizes percentage values from LLM output", () => {
    const parsed = parseCivitaiResourceEnrichmentContent(
      JSON.stringify({
        categories: ["style"],
        aiNsfwLevel: "suggestive",
        aiNsfwConfidence: "70%",
        recommendations: [{ loraWeight: "80%", hdRedrawRate: "42%" }],
      }),
      ["other"],
    );

    expect(parsed.aiNsfwConfidence).toBe(0.7);
    expect(parsed.recommendations[0]?.loraWeight).toBe(0.8);
    expect(parsed.recommendations[0]?.hdRedrawRate).toBe(0.42);
  });

  it("throws for invalid JSON and dedupes merged trigger words case-insensitively", () => {
    expect(() => parseCivitaiResourceEnrichmentContent("not json", ["other"])).toThrow();
    expect(mergeCivitaiTriggerWords(["Alpha", " beta ", "vr4_zk4r1,"], ["alpha", "Gamma", "vr4_zk4r1"])).toEqual([
      "Alpha",
      "beta",
      "vr4_zk4r1",
      "Gamma",
    ]);
  });

  it("does not send source image prompt or sampler as recommendation evidence", () => {
    const messages = buildCivitaiResourceEnrichmentMessages({
      resourceType: "lora",
      civitaiModelId: 1,
      civitaiModelVersionId: 2,
      name: "Example LoRA",
      versionName: "v1",
      hash: null,
      baseModel: "Illustrious",
      trainedWords: [],
      tags: [],
      description: "Trigger word: example",
      creator: null,
      downloadUrl: null,
      filesJson: null,
      officialImagesJson: null,
      category: null,
      categories: [],
      usageGuide: null,
      recommendations: [],
      enrichmentStatus: "fallback",
      enrichmentError: null,
      nsfw: null,
      aiNsfwLevel: "unknown",
      aiNsfwConfidence: null,
      aiNsfwReason: null,
      rawVersionJson: null,
    });

    expect(messages[1]?.content).not.toContain("sourceImage");
    expect(messages[1]?.content).toContain("civitaiNsfw");
    expect(messages[0]?.content).toContain("Do NOT infer recommendations from a source image prompt");
  });

  it("writes direct enrichment LLM calls to llm-chat.jsonl", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          id: "chatcmpl-test",
          model: "test-model",
          choices: [
            {
              message: {
                role: "assistant",
                content: JSON.stringify({
                  usageGuide: "适合写实细节。",
                  categories: ["style"],
                  triggerWords: ["example"],
                  recommendations: [{ loraWeight: 0.7 }],
                  aiNsfwLevel: "sfw",
                  aiNsfwConfidence: 0.9,
                  aiNsfwReason: "描述中未出现敏感内容。",
                }),
              },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 12,
            total_tokens: 22,
          },
        }),
      ),
    );

    const result = await enrichCivitaiResource(makeResourceInput());
    const logLines = (await fs.readFile(process.env.SCENEFORGE_LLM_LOG_FILE!, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { phase: string; route: string; payload: Record<string, unknown> });

    expect(result.status).toBe("ai_enriched");
    expect(logLines).toHaveLength(2);
    expect(logLines.map((line) => line.phase)).toEqual(["request", "response"]);
    expect(logLines.every((line) => line.route === "civitai-lora-library/enrichment")).toBe(true);
    expect(logLines[0]?.payload).toMatchObject({
      purpose: "civitai-resource-enrichment",
      model: "test-model",
      resource: {
        resourceType: "lora",
        civitaiModelId: 1,
        civitaiModelVersionId: 2,
        name: "Example LoRA",
      },
    });
    expect(logLines[1]?.payload.completion).toMatchObject({
      id: "chatcmpl-test",
      model: "test-model",
    });
  });

  it("writes an error log when direct enrichment receives an invalid LLM response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
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
      ),
    );

    const result = await enrichCivitaiResource(makeResourceInput());
    const logLines = (await fs.readFile(process.env.SCENEFORGE_LLM_LOG_FILE!, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { phase: string; payload: Record<string, unknown> });

    expect(result.status).toBe("ai_failed");
    expect(logLines.map((line) => line.phase)).toEqual(["request", "response", "error"]);
    expect(logLines[2]?.payload.error).toMatchObject({
      name: "SyntaxError",
    });
  });
});
