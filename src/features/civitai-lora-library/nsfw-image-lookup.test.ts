// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { CivitaiClient } from "./client";
import {
  importCivitaiImageUrlToSqlite,
  parseCivitaiImageUrl,
} from "./service";
import type { NormalizedCivitaiImage } from "./types";
import {
  openSceneForgeSqliteDatabase,
  saveSceneForgeUserSettingsToSqlite,
  type SceneForgeSqliteDatabase,
} from "@/features/persistence/sqlite-storage";

function makeImage(imageId: number): NormalizedCivitaiImage {
  return {
    civitaiImageId: imageId,
    civitaiImagePageUrl: `https://civitai.com/images/${imageId}`,
    imageUrl: null,
    sourceImageUrl: null,
    width: null,
    height: null,
    nsfw: true,
    nsfwLevel: 4,
    browsingLevel: 4,
    createdAtOnCivitai: null,
    postId: null,
    username: null,
    baseModel: null,
    prompt: null,
    negativePrompt: null,
    sampler: null,
    steps: null,
    cfgScale: null,
    seed: null,
    modelVersionIds: [],
    resources: [],
    rawMetaJson: {},
  };
}

function makeClient(getImageById: CivitaiClient["getImageById"]): CivitaiClient {
  return {
    getImageById,
    async getModelVersion() {
      throw new Error("model lookup should not be used");
    },
    async getModelVersionByHash() {
      throw new Error("hash lookup should not be used");
    },
    async searchModelVersionByName() {
      throw new Error("name lookup should not be used");
    },
  };
}

async function withDatabase(
  run: (db: SceneForgeSqliteDatabase) => Promise<void>,
): Promise<void> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sceneforge-civitai-nsfw-"));
  const db = await openSceneForgeSqliteDatabase(path.join(tempDir, "sceneforge.sqlite"));
  try {
    await run(db);
  } finally {
    db.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

const previousNsfwEnv = process.env.SCENEFORGE_SHOW_NSFW_BUTTON;
const previousFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = previousFetch;
  if (previousNsfwEnv === undefined) {
    delete process.env.SCENEFORGE_SHOW_NSFW_BUTTON;
  } else {
    process.env.SCENEFORGE_SHOW_NSFW_BUTTON = previousNsfwEnv;
  }
});

describe("Civitai image lookup settings independence", () => {
  it.each([
    { envValue: undefined, supportsNsfw: false },
    { envValue: undefined, supportsNsfw: true },
    { envValue: "true", supportsNsfw: false },
    { envValue: "true", supportsNsfw: true },
  ])(
    "uses the same fixed query for parse and import with env=$envValue and persisted supportsNsfw=$supportsNsfw",
    async ({ envValue, supportsNsfw }) => {
      await withDatabase(async (db) => {
        if (envValue === undefined) {
          delete process.env.SCENEFORGE_SHOW_NSFW_BUTTON;
        } else {
          process.env.SCENEFORGE_SHOW_NSFW_BUTTON = envValue;
        }
        saveSceneForgeUserSettingsToSqlite(db, { supportsNsfw });
        const fetchMock = vi.fn<typeof fetch>(async () =>
          Response.json({
            items: [
              {
                id: 135795968,
                nsfw: true,
                nsfwLevel: 4,
                browsingLevel: 4,
              },
            ],
          }),
        );
        globalThis.fetch = fetchMock;

        await expect(
          parseCivitaiImageUrl({
            db,
            imageUrl: "https://www.civitai.red/images/135795968?from=preview",
          }),
        ).resolves.toMatchObject({
          image: {
            civitaiImageId: 135795968,
            nsfw: true,
            nsfwLevel: 4,
          },
          resources: [],
        });

        await expect(
          importCivitaiImageUrlToSqlite({
            db,
            imageUrl: "135795968",
          }),
        ).rejects.toMatchObject({
          name: "CivitaiImageImportInputError",
          statusCode: 400,
        });

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
          "https://civitai.com/api/v1/images?imageId=135795968&nsfw=X",
          "https://civitai.com/api/v1/images?imageId=135795968&nsfw=X",
        ]);
      });
    },
  );

  it("does not read SQLite settings in either service path", async () => {
    const prepare = vi.fn(() => {
      throw new Error("service must not read SQLite settings");
    });
    const poisonDb: SceneForgeSqliteDatabase = {
      close: vi.fn(),
      exec: vi.fn(() => {
        throw new Error("service must not write for an empty resource list");
      }),
      prepare,
    };
    const getImageById = vi.fn<CivitaiClient["getImageById"]>(async (imageId) =>
      makeImage(imageId),
    );
    const client = makeClient(getImageById);

    await expect(
      parseCivitaiImageUrl({
        db: poisonDb,
        imageUrl: "https://civitai.com/images/135795968",
        client,
      }),
    ).resolves.toMatchObject({
      image: {
        nsfw: true,
        nsfwLevel: 4,
      },
      resources: [],
    });

    await expect(
      importCivitaiImageUrlToSqlite({
        db: poisonDb,
        imageUrl: "https://civitai.red/images/135795968",
        client,
      }),
    ).rejects.toMatchObject({
      name: "CivitaiImageImportInputError",
      statusCode: 400,
    });

    expect(getImageById).toHaveBeenCalledTimes(2);
    expect(getImageById).toHaveBeenNthCalledWith(1, 135795968);
    expect(getImageById).toHaveBeenNthCalledWith(2, 135795968);
    expect(prepare).not.toHaveBeenCalled();
  });
});
