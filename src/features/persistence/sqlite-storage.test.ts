// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDefaultProject, createDefaultPromptBindingState } from "@/features/editor/store/defaults";

import { stripSharedPromptStateFromProject } from "./project-serialization";
import {
  deleteProjectFromSqlite,
  listProjectSummariesFromSqlite,
  loadProjectFromSqlite,
  loadPromptBindingsFromSqlite,
  loadPromptLibraryFromSqlite,
  openSceneForgeSqliteDatabase,
  saveProjectToSqlite,
  savePromptBindingsToSqlite,
  savePromptLibraryToSqlite,
  type SceneForgeSqliteDatabase,
} from "./sqlite-storage";

describe("sqlite persistence support", () => {
  let tempDir: string;
  let db: SceneForgeSqliteDatabase;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sceneforge-sqlite-"));
    db = await openSceneForgeSqliteDatabase(path.join(tempDir, "sceneforge.sqlite"));
  });

  afterEach(async () => {
    db.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("round-trips projects through SQLite without changing the active disk flow", () => {
    const project = createDefaultProject();
    project.id = "sqlite-project";
    project.name = "SQLite Project";
    project.updatedAt = "2026-05-17T00:00:00.000Z";
    project.settings.promptLibraryTags = [
      {
        id: "shared-tag",
        label: "Shared",
        prompt: "shared prompt",
        category: "style",
        weight: { enabled: false, value: 1 },
      },
    ];

    saveProjectToSqlite(db, project);

    expect(listProjectSummariesFromSqlite(db)).toEqual([
      {
        id: "sqlite-project",
        name: "SQLite Project",
        updatedAt: "2026-05-17T00:00:00.000Z",
      },
    ]);
    expect(stripSharedPromptStateFromProject(loadProjectFromSqlite(db, project.id)!)).toEqual(
      stripSharedPromptStateFromProject(project),
    );
    expect(deleteProjectFromSqlite(db, project.id)).toBe(true);
    expect(loadProjectFromSqlite(db, project.id)).toBeUndefined();
  });

  it("stores shared prompt library and binding state in SQLite", () => {
    const library = {
      promptLibraryTags: [
        {
          id: "tag-1",
          label: "Tag",
          prompt: "prompt",
          category: "style" as const,
          weight: { enabled: false, value: 1 },
        },
      ],
      deletedBuiltInPromptLibraryTagIds: ["builtin-1"],
    };
    const bindings = createDefaultPromptBindingState();
    bindings.scene.promptCategoryBindings = ["scene"];

    savePromptLibraryToSqlite(db, library);
    savePromptBindingsToSqlite(db, bindings);

    expect(loadPromptLibraryFromSqlite(db)).toEqual(library);
    expect(loadPromptBindingsFromSqlite(db)).toEqual(bindings);
  });
});
