import { describe, expect, it } from "vitest";

import { createDefaultProject } from "@/features/editor/store/defaults";
import { serializePromptExport } from "@/features/prompt-engine";

import {
  getProjectContentFingerprint,
  importCanvasBundleFromJson,
  importProjectFromJson,
  importPromptLibraryBundleFromJson,
  isSceneForgeProject,
  parseProjectJson,
  serializeCanvasExport,
  serializeProject,
  serializePromptLibraryExport,
} from "./project-serialization";

describe("project serialization", () => {
  it("round-trips valid project data", () => {
    const project = createDefaultProject();
    const serialized = serializeProject(project);

    expect(parseProjectJson(serialized)).toEqual(project);
  });

  it("rejects invalid imported data", () => {
    expect(isSceneForgeProject({ version: 1 })).toBe(false);
    expect(() => parseProjectJson(JSON.stringify({ version: 1 }))).toThrow(
      "Invalid SceneForge project data.",
    );
  });

  it("importProjectFromJson rejects prompt export files", () => {
    const promptJson = serializePromptExport(createDefaultProject(), "");
    expect(() => importProjectFromJson(promptJson)).toThrow("导入词库 JSON");
  });

  it("importProjectFromJson rejects canvas bundle files", () => {
    const canvasJson = serializeCanvasExport(createDefaultProject());
    expect(() => importProjectFromJson(canvasJson)).toThrow("导入画布 JSON");
  });

  it("importProjectFromJson rejects prompt library bundle files", () => {
    const libJson = serializePromptLibraryExport(createDefaultProject());
    expect(() => importProjectFromJson(libJson)).toThrow("导入词库 JSON");
  });

  it("round-trips canvas export bundle", () => {
    const project = createDefaultProject();
    project.scene.name = "画布备份";
    const scene = importCanvasBundleFromJson(serializeCanvasExport(project));
    expect(scene).toEqual(project.scene);
  });

  it("round-trips prompt library export bundle", () => {
    const project = createDefaultProject();
    project.settings.promptLibraryTags = [
      {
        id: "custom-1",
        label: "测试",
        prompt: "test",
        category: "style",
        weight: { enabled: false, value: 1 },
      },
    ];
    project.settings.deletedBuiltInPromptLibraryTagIds = ["builtin-a"];
    const lib = importPromptLibraryBundleFromJson(serializePromptLibraryExport(project));
    expect(lib.promptLibraryTags).toEqual(project.settings.promptLibraryTags);
    expect(lib.deletedBuiltInPromptLibraryTagIds).toEqual(["builtin-a"]);
  });

  it("importProjectFromJson coerces missing scene arrays", () => {
    const minimal = {
      id: "p1",
      name: "Test",
      version: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      scene: {},
      settings: {},
    };
    const imported = importProjectFromJson(JSON.stringify(minimal));
    expect(imported.scene.objects).toEqual([]);
    expect(imported.scene.characters).toEqual([]);
    expect(imported.scene.promptTags).toEqual([]);
    expect(Array.isArray(imported.settings.promptLibraryTags)).toBe(true);
  });

  it("dedupes duplicate ids in scene and settings on import", () => {
    const project = createDefaultProject();
    const tag: (typeof project.scene.promptTags)[number] = {
      id: "dup-tag",
      label: "重复",
      prompt: "test",
      category: "style",
      weight: { enabled: false, value: 1 },
    };
    project.scene.promptTags = [tag, { ...tag }];

    const libTag: (typeof project.settings.promptLibraryTags)[number] = {
      id: "lib-dup",
      label: "库",
      prompt: "lib",
      category: "scene",
      weight: { enabled: false, value: 1 },
    };
    project.settings.promptLibraryTags = [libTag, { ...libTag }];
    project.settings.deletedBuiltInPromptLibraryTagIds = ["a", "a", "b"];

    const imported = importProjectFromJson(serializeProject(project));
    expect(imported.scene.promptTags).toHaveLength(1);
    expect(imported.settings.promptLibraryTags).toHaveLength(1);
    expect(imported.settings.deletedBuiltInPromptLibraryTagIds).toEqual(["a", "b"]);
  });

  it("getProjectContentFingerprint ignores id and timestamps", () => {
    const base = createDefaultProject();
    const other: typeof base = {
      ...base,
      id: "other-id",
      createdAt: "2000-01-01T00:00:00.000Z",
      updatedAt: "2099-01-01T00:00:00.000Z",
    };
    expect(getProjectContentFingerprint(base)).toBe(getProjectContentFingerprint(other));
  });
});
