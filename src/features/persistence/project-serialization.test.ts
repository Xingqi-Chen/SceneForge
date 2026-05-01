import { describe, expect, it } from "vitest";

import { createDefaultProject, defaultCharacter } from "@/features/editor/store/defaults";
import { serializePromptExport } from "@/features/prompt-engine";

import {
  getProjectContentFingerprint,
  importCanvasBundleFromJson,
  importProjectFromJson,
  importPromptLibraryBundleFromJson,
  isSceneForgeProject,
  parseProjectJson,
  SCENEFORGE_PROMPT_LIBRARY_EXPORT_KIND,
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
        subcategory: "style-rendering",
        weight: { enabled: false, value: 1 },
      },
    ];
    project.settings.deletedBuiltInPromptLibraryTagIds = ["builtin-a"];
    const lib = importPromptLibraryBundleFromJson(serializePromptLibraryExport(project));
    expect(lib.promptLibraryTags).toEqual(project.settings.promptLibraryTags);
    expect(lib.deletedBuiltInPromptLibraryTagIds).toEqual(["builtin-a"]);
  });

  it("importPromptLibraryBundleFromJson extracts library from full project JSON", () => {
    const project = createDefaultProject();
    project.settings.promptLibraryTags = [
      {
        id: "x",
        label: "L",
        prompt: "p",
        category: "style",
        subcategory: "style-color",
        weight: { enabled: false, value: 1 },
      },
    ];
    const lib = importPromptLibraryBundleFromJson(serializeProject(project));
    expect(lib.promptLibraryTags).toEqual(project.settings.promptLibraryTags);
  });

  it("keeps valid prompt library subcategories and drops invalid ones", () => {
    const json = JSON.stringify({
      kind: SCENEFORGE_PROMPT_LIBRARY_EXPORT_KIND,
      version: 1,
      promptLibraryTags: [
        {
          id: "valid",
          label: "雨天",
          prompt: "rainy day",
          category: "scene",
          subcategory: "scene-weather",
          weight: { value: 1, enabled: false },
        },
        {
          id: "invalid",
          label: "错位",
          prompt: "blue eyes",
          category: "body-part",
          subcategory: "scene-weather",
          weight: { value: 1, enabled: false },
        },
      ],
      deletedBuiltInPromptLibraryTagIds: [],
    });

    const lib = importPromptLibraryBundleFromJson(json);
    expect(lib.promptLibraryTags[0]?.subcategory).toBe("scene-weather");
    expect(lib.promptLibraryTags[1]?.subcategory).toBeUndefined();
  });

  it("importCanvasBundleFromJson extracts scene from full project JSON", () => {
    const project = createDefaultProject();
    project.scene.name = "从完整项目来";
    const scene = importCanvasBundleFromJson(serializeProject(project));
    expect(scene.name).toBe("从完整项目来");
  });

  it("importPromptLibraryBundleFromJson accepts version as string and skips junk entries", () => {
    const json = JSON.stringify({
      kind: SCENEFORGE_PROMPT_LIBRARY_EXPORT_KIND,
      version: "1",
      promptLibraryTags: [
        null,
        { id: "keep", label: "OK", prompt: "p", category: "style", weight: { value: 1, enabled: false } },
        { id: "keep", label: "Dup id", prompt: "p2", category: "scene", weight: { value: 1, enabled: false } },
      ],
      deletedBuiltInPromptLibraryTagIds: [],
    });
    const lib = importPromptLibraryBundleFromJson(json);
    expect(lib.promptLibraryTags).toHaveLength(1);
    expect(lib.promptLibraryTags[0]?.id).toBe("keep");
    expect(lib.promptLibraryTags[0]?.label).toBe("OK");
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

  it("coerces target prompt category bindings on import", () => {
    const project = createDefaultProject();
    project.scene.promptCategoryBindings = ["scene", "scene", "bad" as never];
    project.scene.promptSubcategoryBindings = [
      "scene-weather",
      "scene-weather",
      "style-color",
      "bad" as never,
    ];
    project.scene.objects.push({
      id: "object-1",
      kind: "rectangle",
      name: "对象",
      description: "",
      position: { x: 0, y: 0 },
      size: { width: 120, height: 120 },
      rotation: 0,
      layer: 1,
      fill: "#e2e8f0",
      includeInPrompt: true,
      weight: { enabled: false, value: 1 },
      promptTags: [],
      promptCategoryBindings: ["character"],
      promptSubcategoryBindings: ["character-pose", "scene-prop"],
    });
    project.scene.characters.push({
      ...structuredClone(defaultCharacter),
      id: "character-1",
      promptCategoryBindings: [],
      promptSubcategoryBindings: ["character-expression"],
      bodyParts: [
        {
          id: "head",
          label: "头部",
          promptTags: [],
          promptCategoryBindings: ["body-part", "negative", "body-part"],
          promptSubcategoryBindings: [
            "body-part-hair",
            "negative-quality",
            "scene-weather",
            "body-part-hair",
          ],
        },
      ],
    });

    const imported = importProjectFromJson(serializeProject(project));

    expect(imported.scene.promptCategoryBindings).toEqual(["scene"]);
    expect(imported.scene.promptSubcategoryBindings).toEqual(["scene-weather"]);
    expect(imported.scene.objects[0]?.promptCategoryBindings).toEqual(["character"]);
    expect(imported.scene.objects[0]?.promptSubcategoryBindings).toEqual(["character-pose"]);
    expect(imported.scene.characters[0]?.promptCategoryBindings).toEqual([
      "style",
      "lighting",
      "quality",
      "character",
      "negative",
    ]);
    expect(imported.scene.characters[0]?.promptSubcategoryBindings).toEqual([
      "character-expression",
    ]);
    expect(imported.scene.characters[0]?.bodyParts[0]?.promptCategoryBindings).toEqual([
      "body-part",
      "negative",
    ]);
    expect(imported.scene.characters[0]?.bodyParts[0]?.promptSubcategoryBindings).toEqual([
      "body-part-hair",
      "negative-quality",
    ]);
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
