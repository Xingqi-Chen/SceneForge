// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CIVITAI_IMAGE_UNAVAILABLE_MESSAGE } from "@/features/civitai-lora-library";
import {
  CIVITAI_INCREMENTAL_INDEX_REBUILD_MESSAGE,
  assertCivitaiEmbeddingIndexReady,
} from "@/features/persistence/civitai-embedding-index";
import { rankCivitaiResourceIdsBySearchIndex } from "@/features/persistence/civitai-search-index";
import {
  openSceneForgeSqliteDatabase,
  upsertCivitaiResourceToSqlite,
} from "@/features/persistence/sqlite-storage";

import { POST } from "./route";

function makeRequest(imageUrl: unknown): Request {
  return new Request("http://localhost/api/civitai-lora-library/import-image", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ imageUrl }),
  });
}

async function importFetchImplementation(input: RequestInfo | URL): Promise<Response> {
  const url = String(input);
  if (url === "https://civitai.com/api/v1/images?imageId=135795968&nsfw=X") {
    return Response.json({
      items: [{
        id: 135795968,
        width: 1024,
        height: 1024,
        nsfw: false,
        meta: {
          modelVersionIds: [200],
          prompt: "neon portrait",
        },
      }],
    });
  }
  if (url === "https://civitai.com/api/v1/model-versions/200") {
    return Response.json({
      id: 200,
      modelId: 100,
      name: "v1",
      baseModel: "Illustrious",
      trainedWords: ["route_neon"],
      files: [],
      images: [],
      model: {
        id: 100,
        type: "LORA",
        name: "Route Neon LoRA",
        description: "Neon portrait style.",
        creator: { username: "fixture" },
        tags: ["neon", "portrait"],
      },
    });
  }
  if (url === "https://litellm.test/v1/chat/completions") {
    return Response.json({
      id: "chatcmpl-route",
      model: "test-chat-model",
      choices: [{
        message: {
          role: "assistant",
          content: JSON.stringify({
            usageGuide: "Use for neon portraits.",
            categories: ["style"],
            triggerWords: ["route_neon"],
            recommendations: [],
            aiNsfwLevel: "sfw",
            aiNsfwConfidence: 0.99,
            aiNsfwReason: "No sensitive content.",
          }),
        },
        finish_reason: "stop",
      }],
    });
  }
  if (url === "https://litellm.test/v1/embeddings") {
    return Response.json({
      model: "test-embedding-model",
      data: [{ index: 0, embedding: [1, 0] }],
    });
  }

  throw new Error(`Unexpected mocked request: ${url}`);
}

describe("Civitai import-image route", () => {
  let tempDir: string;
  let previousSqliteFile: string | undefined;
  let previousNsfwEnv: string | undefined;
  let previousLlmLogFile: string | undefined;
  let previousLiteLlmBaseUrl: string | undefined;
  let previousDefaultModel: string | undefined;
  let previousEmbeddingModel: string | undefined;
  let previousFetch: typeof fetch;
  let fetchMock = vi.fn<typeof fetch>();
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sceneforge-civitai-import-route-"));
    previousSqliteFile = process.env.SCENEFORGE_SQLITE_FILE;
    previousNsfwEnv = process.env.SCENEFORGE_SHOW_NSFW_BUTTON;
    previousLlmLogFile = process.env.SCENEFORGE_LLM_LOG_FILE;
    previousLiteLlmBaseUrl = process.env.LITELLM_BASE_URL;
    previousDefaultModel = process.env.LITELLM_DEFAULT_MODEL;
    previousEmbeddingModel = process.env.LITELLM_CIVITAI_EMBEDDING_MODEL;
    previousFetch = globalThis.fetch;
    process.env.SCENEFORGE_SQLITE_FILE = path.join(tempDir, "sceneforge.sqlite");
    process.env.SCENEFORGE_LLM_LOG_FILE = "off";
    process.env.LITELLM_BASE_URL = "https://litellm.test/v1";
    process.env.LITELLM_DEFAULT_MODEL = "test-chat-model";
    process.env.LITELLM_CIVITAI_EMBEDDING_MODEL = "test-embedding-model";
    delete process.env.SCENEFORGE_SHOW_NSFW_BUTTON;
    fetchMock = vi.fn<typeof fetch>();
    globalThis.fetch = fetchMock;
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    globalThis.fetch = previousFetch;
    consoleErrorSpy.mockRestore();
    if (previousSqliteFile === undefined) {
      delete process.env.SCENEFORGE_SQLITE_FILE;
    } else {
      process.env.SCENEFORGE_SQLITE_FILE = previousSqliteFile;
    }
    if (previousNsfwEnv === undefined) {
      delete process.env.SCENEFORGE_SHOW_NSFW_BUTTON;
    } else {
      process.env.SCENEFORGE_SHOW_NSFW_BUTTON = previousNsfwEnv;
    }
    if (previousLlmLogFile === undefined) {
      delete process.env.SCENEFORGE_LLM_LOG_FILE;
    } else {
      process.env.SCENEFORGE_LLM_LOG_FILE = previousLlmLogFile;
    }
    if (previousLiteLlmBaseUrl === undefined) {
      delete process.env.LITELLM_BASE_URL;
    } else {
      process.env.LITELLM_BASE_URL = previousLiteLlmBaseUrl;
    }
    if (previousDefaultModel === undefined) {
      delete process.env.LITELLM_DEFAULT_MODEL;
    } else {
      process.env.LITELLM_DEFAULT_MODEL = previousDefaultModel;
    }
    if (previousEmbeddingModel === undefined) {
      delete process.env.LITELLM_CIVITAI_EMBEDDING_MODEL;
    } else {
      process.env.LITELLM_CIVITAI_EMBEDDING_MODEL = previousEmbeddingModel;
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it.each([
    "https://civitai.red.evil.test/images/135795968",
    "https://civitai.red/images/135795968/extra",
    "file://civitai.red/images/135795968",
    String(Number.MAX_SAFE_INTEGER + 1),
    "",
    null,
    { imageId: 135795968 },
  ])("returns 400 without fetching for illegal input %j", async (imageUrl) => {
    const response = await POST(makeRequest(imageUrl));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toMatchObject({
      error: {
        message: expect.any(String),
      },
    });
    expect(JSON.stringify(payload)).not.toContain("details");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a neutral 404 for an empty upstream image result", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        items: [],
        details: {
          secret: "empty-import-secret",
        },
      }),
    );

    const response = await POST(makeRequest("https://www.civitai.red/images/135795968"));
    const payload = await response.json();
    const serialized = JSON.stringify(payload);

    expect(response.status).toBe(404);
    expect(payload).toEqual({
      error: {
        message: CIVITAI_IMAGE_UNAVAILABLE_MESSAGE,
      },
    });
    expect(serialized).not.toContain("empty-import-secret");
    expect(serialized).not.toContain("details");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://civitai.com/api/v1/images?imageId=135795968&nsfw=X",
    );
  });

  it("maps upstream client errors without exposing raw details or secrets", async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        {
          error: "raw-import-error",
          details: {
            apiKey: "import-upstream-secret",
          },
        },
        { status: 403 },
      ),
    );

    const response = await POST(makeRequest("https://civitai.red/images/135795968"));
    const payload = await response.json();
    const serialized = JSON.stringify(payload);

    expect(response.status).toBe(502);
    expect(payload).toEqual({
      error: {
        message: "Civitai request failed.",
      },
    });
    expect(serialized).not.toContain("raw-import-error");
    expect(serialized).not.toContain("import-upstream-secret");
    expect(serialized).not.toContain("details");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps unknown failures to a generic response without exposing the thrown error", async () => {
    fetchMock.mockRejectedValue(new Error("unknown-secret-import-failure"));

    const response = await POST(makeRequest("https://civitai.red/images/135795968"));
    const payload = await response.json();
    const serialized = JSON.stringify(payload);

    expect(response.status).toBe(500);
    expect(payload).toEqual({
      error: {
        message: "导入 Civitai 图片元数据失败。",
      },
    });
    expect(serialized).not.toContain("unknown-secret-import-failure");
    expect(serialized).not.toContain("details");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("bootstraps recommendation indexes during a successful first import", async () => {
    fetchMock.mockImplementation(importFetchImplementation);

    const response = await POST(makeRequest("https://www.civitai.red/images/135795968"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.resources).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);

    const db = await openSceneForgeSqliteDatabase(undefined, { allowExtensions: true });
    try {
      const resourceId = payload.resources[0]?.resource.id as string;
      expect(assertCivitaiEmbeddingIndexReady(db, "test-embedding-model")).toMatchObject({
        dimensions: 2,
        indexedCount: 1,
      });
      expect(rankCivitaiResourceIdsBySearchIndex(db, {
        desiredEffect: "neon portrait",
        resourceIds: [resourceId],
        resourceType: "lora",
      }).has(resourceId)).toBe(true);
    } finally {
      db.close();
    }
  });

  it("preserves a 409 incremental-index status without exposing internal details", async () => {
    const db = await openSceneForgeSqliteDatabase(undefined, { allowExtensions: true });
    try {
      upsertCivitaiResourceToSqlite(db, {
        resourceType: "model",
        civitaiModelId: 900,
        civitaiModelVersionId: 901,
        name: "Existing Unindexed Checkpoint",
        versionName: "v1",
        hash: "existing-unindexed-checkpoint",
        baseModel: "Illustrious",
        trainedWords: [],
        tags: ["existing"],
        description: "A nonempty library without recommendation indexes.",
        creator: "fixture",
        downloadUrl: null,
        filesJson: null,
        officialImagesJson: null,
        category: null,
        categories: [],
        usageGuide: null,
        recommendations: [],
        enrichmentStatus: "fallback",
        enrichmentError: null,
        nsfw: false,
        aiNsfwLevel: "unknown",
        aiNsfwConfidence: null,
        aiNsfwReason: null,
        rawVersionJson: {},
      });
    } finally {
      db.close();
    }
    fetchMock.mockImplementation(importFetchImplementation);

    const response = await POST(makeRequest("https://www.civitai.red/images/135795968"));
    const payload = await response.json();
    const serialized = JSON.stringify(payload);

    expect(response.status).toBe(409);
    expect(payload).toEqual({
      error: {
        message: CIVITAI_INCREMENTAL_INDEX_REBUILD_MESSAGE,
      },
    });
    expect(serialized).not.toContain("details");
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      "https://civitai.com/api/v1/images?imageId=135795968&nsfw=X",
      "https://civitai.com/api/v1/model-versions/200",
      "https://litellm.test/v1/chat/completions",
    ]);
  });
});
