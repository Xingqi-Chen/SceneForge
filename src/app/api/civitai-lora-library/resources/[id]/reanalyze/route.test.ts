// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CivitaiResourceUpsertInput } from "@/features/civitai-lora-library";
import {
  getCivitaiResourceDetailFromSqlite,
  openSceneForgeSqliteDatabase,
  upsertCivitaiResourceToSqlite,
  type SceneForgeSqliteDatabase,
} from "@/features/persistence/sqlite-storage";

import { PATCH, POST } from "./route";

function makeResourceInput(overrides: Partial<CivitaiResourceUpsertInput> = {}): CivitaiResourceUpsertInput {
  return {
    resourceType: "lora",
    civitaiModelId: 100,
    civitaiModelVersionId: 200,
    name: "Portrait Detail LoRA",
    versionName: "v1",
    hash: "portrait-detail-hash",
    baseModel: "Illustrious",
    trainedWords: ["portrait_detail"],
    tags: ["portrait", "detail"],
    description: "Use for cinematic portraits. Recommended LoRA weight 0.65 with DPM++ 2M.",
    creator: "creator",
    downloadUrl: "https://download.test/lora.safetensors",
    filesJson: null,
    officialImagesJson: null,
    category: "detail",
    categories: ["detail"],
    usageGuide: "Old usage guide.",
    recommendations: [
      {
        condition: "old",
        baseModel: null,
        checkpoint: null,
        sampler: null,
        loraWeightMin: null,
        loraWeightMax: null,
        loraWeight: 0.4,
        hdRedrawRate: null,
        notes: "Old recommendation.",
      },
    ],
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

function routeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("Civitai resource reanalysis route", () => {
  let tempDir: string;
  let db: SceneForgeSqliteDatabase;
  let previousSqliteFile: string | undefined;
  let previousLogFile: string | undefined;
  let previousBaseUrl: string | undefined;
  let previousDefaultModel: string | undefined;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sceneforge-civitai-reanalysis-"));
    previousSqliteFile = process.env.SCENEFORGE_SQLITE_FILE;
    previousLogFile = process.env.SCENEFORGE_LLM_LOG_FILE;
    previousBaseUrl = process.env.LITELLM_BASE_URL;
    previousDefaultModel = process.env.LITELLM_DEFAULT_MODEL;
    process.env.SCENEFORGE_SQLITE_FILE = path.join(tempDir, "sceneforge.sqlite");
    process.env.SCENEFORGE_LLM_LOG_FILE = path.join(tempDir, "llm-chat.jsonl");
    process.env.LITELLM_BASE_URL = "https://litellm.test";
    process.env.LITELLM_DEFAULT_MODEL = "test-model";
    db = await openSceneForgeSqliteDatabase();
  });

  afterEach(async () => {
    db.close();
    vi.unstubAllGlobals();
    if (previousSqliteFile === undefined) {
      delete process.env.SCENEFORGE_SQLITE_FILE;
    } else {
      process.env.SCENEFORGE_SQLITE_FILE = previousSqliteFile;
    }
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

  it("previews description reanalysis without overwriting the stored resource", async () => {
    const resource = upsertCivitaiResourceToSqlite(db, makeResourceInput()).resource;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://civitai.com/api/v1/models/100") {
        return Response.json({
          id: 100,
          name: "Portrait Detail LoRA",
          type: "LORA",
          description: "Long model page description with generation settings and prompting guidance.",
          nsfw: false,
          creator: { username: "creator" },
          tags: ["portrait", "detail"],
          modelVersions: [
            {
              id: 200,
              modelId: 100,
              name: "v1",
              baseModel: "Illustrious",
              description: "Short about this version note.",
              trainedWords: ["portrait_detail"],
              files: [],
              images: [],
              downloadUrl: "https://download.test/lora.safetensors",
            },
          ],
        });
      }

      return Response.json({
          id: "chatcmpl-test",
          model: "test-model",
          choices: [
            {
              message: {
                role: "assistant",
                content: JSON.stringify({
                  usageGuide: "New portrait detail usage.",
                  categories: ["detail"],
                  triggerWords: ["new_token"],
                  recommendations: [{ sampler: "DPM++ 2M", loraWeight: 0.65, notes: "Use moderate strength." }],
                  aiNsfwLevel: "sfw",
                  aiNsfwConfidence: 0.9,
                  aiNsfwReason: "No sensitive content.",
                }),
              },
              finish_reason: "stop",
            },
          ],
        });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(new Request("http://localhost/api/civitai-lora-library/resources/id/reanalyze"), routeContext(resource.id));
    const payload = await response.json();
    const stored = getCivitaiResourceDetailFromSqlite(db, resource.id);
    const llmRequest = JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string) as { messages: Array<{ content: string }> };

    expect(response.status).toBe(200);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://civitai.com/api/v1/models/100");
    expect(llmRequest.messages[1]?.content).toContain("Long model page description");
    expect(llmRequest.messages[1]?.content).not.toContain("Short about this version note");
    expect(payload).toMatchObject({
      resourceId: resource.id,
      usageGuide: "New portrait detail usage.",
      enrichmentStatus: "ai_enriched",
    });
    expect(payload.recommendations[0]).toMatchObject({ sampler: "DPM++ 2M", loraWeight: 0.65 });
    expect(stored?.usageGuide).toBe("Old usage guide.");
    expect(stored?.recommendations[0]?.loraWeight).toBe(0.4);
  });

  it("applies a confirmed reanalysis overwrite", async () => {
    const resource = upsertCivitaiResourceToSqlite(db, makeResourceInput()).resource;

    const response = await PATCH(
      new Request("http://localhost/api/civitai-lora-library/resources/id/reanalyze", {
        method: "PATCH",
        body: JSON.stringify({
          confirm: true,
          usageGuide: "Confirmed usage guide.",
          enrichmentStatus: "ai_enriched",
          enrichmentError: null,
          recommendations: [
            {
              condition: "portrait",
              baseModel: "Illustrious",
              checkpoint: null,
              sampler: "Euler a",
              loraWeightMin: null,
              loraWeightMax: null,
              loraWeight: 0.72,
              hdRedrawRate: null,
              notes: "Confirmed recommendation.",
            },
          ],
        }),
      }),
      routeContext(resource.id),
    );
    const payload = await response.json();
    const stored = getCivitaiResourceDetailFromSqlite(db, resource.id);

    expect(response.status).toBe(200);
    expect(payload.resource.usageGuide).toBe("Confirmed usage guide.");
    expect(stored?.usageGuide).toBe("Confirmed usage guide.");
    expect(stored?.recommendations).toHaveLength(1);
    expect(stored?.recommendations[0]).toMatchObject({
      condition: "portrait",
      sampler: "Euler a",
      loraWeight: 0.72,
      notes: "Confirmed recommendation.",
    });
    expect(stored?.trainedWords).toEqual(["portrait_detail"]);
    expect(stored?.categories).toEqual(["detail"]);
  });
});
