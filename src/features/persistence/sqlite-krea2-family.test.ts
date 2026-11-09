// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CivitaiResourceUpsertInput } from "@/features/civitai-lora-library/types";
import { isCivitaiSearchIndexAvailable } from "./civitai-search-index";
import {
  listCivitaiResourcesFromSqlite,
  listImportedImagesFromSqlite,
  openSceneForgeSqliteDatabase,
  upsertCivitaiResourceToSqlite,
  upsertImportedCivitaiImageToSqlite,
  upsertImageResourceUsageToSqlite,
  type SceneForgeSqliteDatabase,
} from "./sqlite-storage";

function resource(baseModel: string | null, index: number, resourceType: "model" | "lora" = "lora"): CivitaiResourceUpsertInput {
  return {
    resourceType, civitaiModelId: index + 1000, civitaiModelVersionId: index + 2000,
    name: `Family fixture ${index}`, versionName: "v1", hash: null, baseModel,
    trainedWords: [], tags: ["fixture"], description: null, creator: null, downloadUrl: null,
    filesJson: null, officialImagesJson: null, category: index === 2 ? "detail" : "style",
    categories: [index === 2 ? "detail" : "style"], usageGuide: null, recommendations: [],
    enrichmentStatus: "fallback", enrichmentError: null, nsfw: index === 1,
    aiNsfwLevel: "unknown", aiNsfwConfidence: null, aiNsfwReason: null,
    rawVersionJson: { baseModel },
  };
}

const aliases = ["Krea 2", "Krea 2 Turbo", " KREA_2_TURBO ", "Krea2", "Krea2Turbo", "Krea-2", "krea-2-turbo", "krea2_turbo", "krea  2  turbo"];
const otherLabels = ["Krea 3", "Krea 20", "Krea 2 Pro", "Krea 2 Turbo Plus", "Anima", "Illustrious", "Illustrious XL", null, ""];

describe("SQLite Krea 2 read-time family filters", () => {
  let tempDir: string;
  let db: SceneForgeSqliteDatabase;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sceneforge-krea-family-"));
    db = await openSceneForgeSqliteDatabase(path.join(tempDir, "fixture.sqlite"));
  });
  afterEach(async () => {
    db.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  function seed() {
    return [...aliases, ...otherLabels].map((baseModel, index) => {
      const saved = upsertCivitaiResourceToSqlite(db, resource(baseModel, index)).resource;
      const image = upsertImportedCivitaiImageToSqlite(db, {
        civitaiImageId: index === 1 ? 147820382 : 9000000 + index,
        civitaiImagePageUrl: `https://civitai.test/images/${index}`, imageUrl: null,
        width: 1024, height: 1024, nsfw: index === 1, nsfwLevel: null, browsingLevel: null,
        createdAtOnCivitai: null, postId: null, username: "fixture", baseModel,
        prompt: `family scene ${index}`, negativePrompt: null, sampler: null, steps: null,
        cfgScale: null, seed: null, modelVersionIds: [], resources: [], rawMetaJson: { baseModel },
      });
      db.prepare("UPDATE imported_images SET imported_at = ? WHERE id = ?").run(`2026-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`, image.id);
      db.prepare("UPDATE civitai_resources SET updated_at = ? WHERE id = ?").run(`2026-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`, saved.id);
      if (index < 2) {
        upsertImageResourceUsageToSqlite(db, {
          importedImageId: image.id, resourceId: saved.id, weight: 0.7, triggerWordsUsed: [],
          source: "civitai_image_meta", resolveStatus: "resolved", rawResourceJson: null,
        });
      }
      return { saved, image };
    });
  }

  it.each(aliases)("lists both original labels and all aliases for filter %s without changing rows", (baseModel) => {
    const fixtures = seed();
    const resourceRows = db.prepare("SELECT * FROM civitai_resources ORDER BY id").all();
    const imageRows = db.prepare("SELECT * FROM imported_images ORDER BY id").all();
    const schema = db.prepare("SELECT name, sql FROM sqlite_master ORDER BY name").all();
    const images = listImportedImagesFromSqlite(db, { baseModel });
    const resources = listCivitaiResourcesFromSqlite(db, { baseModel });

    expect(images.map((entry) => entry.id)).toEqual(fixtures.slice(0, aliases.length).reverse().map((entry) => entry.image.id));
    expect(resources.map((entry) => entry.id)).toEqual([
      fixtures[1].saved.id, fixtures[0].saved.id,
      ...fixtures.slice(2, aliases.length).reverse().map((entry) => entry.saved.id),
    ]);
    expect(images.find((entry) => entry.civitaiImageId === 147820382)?.baseModel).toBe("Krea 2 Turbo");
    expect(images.map((entry) => entry.baseModel).sort()).toEqual([...aliases].sort());
    expect(resources.map((entry) => entry.baseModel).sort()).toEqual([...aliases].sort());
    expect(db.prepare("SELECT * FROM civitai_resources ORDER BY id").all()).toEqual(resourceRows);
    expect(db.prepare("SELECT * FROM imported_images ORDER BY id").all()).toEqual(imageRows);
    expect(db.prepare("SELECT name, sql FROM sqlite_master ORDER BY name").all()).toEqual(schema);
    expect(isCivitaiSearchIndexAvailable(db)).toBe(false);
  });

  it("retains NSFW, query, resource-count, category, type, and import-count filters", () => {
    const fixtures = seed();
    const model = upsertCivitaiResourceToSqlite(db, resource("Krea 2 Turbo", 100, "model")).resource;
    expect(listImportedImagesFromSqlite(db, { baseModel: "Krea2", nsfw: "nsfw", resourceCount: "with" }).map(({ id }) => id)).toEqual([fixtures[1].image.id]);
    expect(listImportedImagesFromSqlite(db, { baseModel: "Krea 2 Turbo", nsfw: "sfw", resourceCount: "with" }).map(({ id }) => id)).toEqual([fixtures[0].image.id]);
    expect(listImportedImagesFromSqlite(db, { baseModel: "Krea_2", query: "147820382" }).map(({ id }) => id)).toEqual([fixtures[1].image.id]);
    expect(listImportedImagesFromSqlite(db, { baseModel: "Krea 2", resourceCount: "none" })).toHaveLength(aliases.length - 2);
    expect(listCivitaiResourcesFromSqlite(db, { baseModel: "Krea 2", category: "detail" }).map(({ id }) => id)).toEqual([fixtures[2].saved.id]);
    expect(listCivitaiResourcesFromSqlite(db, { baseModel: "Krea2Turbo", nsfw: "nsfw", importedCount: "one", query: "Family fixture 1" }).map(({ id }) => id)).toEqual([fixtures[1].saved.id]);
    expect(listCivitaiResourcesFromSqlite(db, { baseModel: "Krea 2", resourceType: "model" }).map(({ id }) => id)).toEqual([model.id]);
    expect(listCivitaiResourcesFromSqlite(db, { baseModel: "Krea2", importedCount: "multiple" })).toEqual([]);
  });

  it("keeps other families and unknown Krea variants as exact filters", () => {
    const fixtures = seed();
    for (let index = 0; index < otherLabels.length; index += 1) {
      const baseModel = otherLabels[index];
      if (!baseModel) continue;
      const fixture = fixtures[aliases.length + index];
      expect(listImportedImagesFromSqlite(db, { baseModel }).map(({ id }) => id)).toEqual([fixture.image.id]);
      expect(listCivitaiResourcesFromSqlite(db, { baseModel }).map(({ id }) => id)).toEqual([fixture.saved.id]);
    }
    expect(listImportedImagesFromSqlite(db, { baseModel: "anima" })).toEqual([]);
    expect(listCivitaiResourcesFromSqlite(db, { baseModel: "Illustrious XL" })).toHaveLength(1);
  });

  it("preserves separate persisted fallback identity and normalized dedup keys for original labels", () => {
    const input = { ...resource("Krea 2", 0), name: "Same name", civitaiModelId: null, civitaiModelVersionId: null, versionName: null };
    const standard = upsertCivitaiResourceToSqlite(db, input);
    const turbo = upsertCivitaiResourceToSqlite(db, { ...input, baseModel: "Krea 2 Turbo" });
    expect(standard.isNew).toBe(true);
    expect(turbo.isNew).toBe(true);
    expect(standard.resource.id).not.toBe(turbo.resource.id);
    expect(db.prepare("SELECT base_model, normalized_base_model FROM civitai_resources ORDER BY base_model").all()).toEqual([
      { base_model: "Krea 2", normalized_base_model: "krea 2" },
      { base_model: "Krea 2 Turbo", normalized_base_model: "krea 2 turbo" },
    ]);
    expect(listCivitaiResourcesFromSqlite(db, { baseModel: "Krea2" })).toHaveLength(2);
  });
});
