import { describe, expect, it } from "vitest";

import { createDefaultProject, defaultCharacter, defaultCharacterMannequinJoints3D } from "@/features/editor/store/defaults";
import { serializePromptExport } from "@/features/prompt-engine";
import { isThreeDViewportPrimitive, sceneObjectsVisibleOn2DCanvas } from "@/features/editor/scene-viewport-objects";

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
  stripPromptBindingsFromScene,
  stripSharedPromptStateFromProject,
} from "./project-serialization";

describe("project serialization", () => {
  it("round-trips valid project data without embedding prompt library in project JSON", () => {
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
    const serialized = serializeProject(project);
    const parsed = parseProjectJson(serialized);

    expect(stripSharedPromptStateFromProject(parsed)).toEqual(stripSharedPromptStateFromProject(project));
  });

  it("rejects invalid imported data", () => {
    expect(isSceneForgeProject({ version: 1 })).toBe(false);
    expect(() => parseProjectJson(JSON.stringify({ version: 1 }))).toThrow(
      "Invalid SceneForge project data.",
    );
  });

  it("clamps imported 3D scene config to viewport-safe ranges", () => {
    const project = createDefaultProject();
    project.scene.three.camera.fov = 500;
    project.scene.three.lighting.ambientIntensity = -1;
    project.scene.three.lighting.directionalIntensity = 9;
    project.scene.three.grid = { size: 0, divisions: 2.6 };

    const imported = importProjectFromJson(JSON.stringify(project));

    expect(imported.scene.three.camera.fov).toBe(100);
    expect(imported.scene.three.lighting.ambientIntensity).toBe(0);
    expect(imported.scene.three.lighting.directionalIntensity).toBe(3);
    expect(imported.scene.three.grid).toEqual({ size: 2, divisions: 3 });
  });

  it("round-trips and sanitizes character 3D transforms", () => {
    const project = createDefaultProject();
    project.scene.characters.push({
      ...structuredClone(defaultCharacter),
      id: "character-3d",
      transform3D: {
        position: { x: 2, y: 0, z: -1 },
        rotation: { x: 0, y: 45, z: 0 },
        scale: { x: 1.2, y: 1.2, z: 1.2 },
      },
    });

    const imported = importProjectFromJson(serializeProject(project));

    expect(imported.scene.characters[0].transform3D).toEqual({
      position: { x: 2, y: 0, z: -1 },
      rotation: { x: 0, y: 45, z: 0 },
      scale: { x: 1.2, y: 1.2, z: 1.2 },
    });

    const raw = JSON.parse(serializeProject(project));
    raw.scene.characters[0].transform3D = {
      position: { x: "bad", y: 3, z: Number.NaN },
      rotation: { x: 10, y: "bad", z: 20 },
      scale: { x: 2, y: null, z: 3 },
    };

    const sanitized = importProjectFromJson(JSON.stringify(raw));
    expect(sanitized.scene.characters[0].transform3D).toEqual({
      position: { x: 0, y: 3, z: 0 },
      rotation: { x: 10, y: 0, z: 20 },
      scale: { x: 2, y: 1, z: 3 },
    });
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
    expect(stripPromptBindingsFromScene(scene)).toEqual(stripPromptBindingsFromScene(project.scene));
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
    const lib = importPromptLibraryBundleFromJson(serializePromptLibraryExport(project));
    expect(lib.promptLibraryTags).toEqual(project.settings.promptLibraryTags);
  });

  it("remaps dropped outfit subcategories when importing prompt library", () => {
    const json = JSON.stringify({
      kind: SCENEFORGE_PROMPT_LIBRARY_EXPORT_KIND,
      version: 1,
      promptLibraryTags: [
        {
          id: "old-bag",
          label: "包",
          prompt: "backpack",
          category: "outfit",
          subcategory: "outfit-bag",
          weight: { value: 1, enabled: false },
        },
      ],
      deletedBuiltInPromptLibraryTagIds: [],
    });

    const lib = importPromptLibraryBundleFromJson(json);
    expect(lib.promptLibraryTags[0]?.subcategory).toBe("outfit-accessory");
  });

  it("migrates legacy character clothing/accessory tags to the outfit taxonomy", () => {
    const json = JSON.stringify({
      kind: SCENEFORGE_PROMPT_LIBRARY_EXPORT_KIND,
      version: 1,
      promptLibraryTags: [
        {
          id: "old-shirt",
          label: "衬衫",
          prompt: "white shirt",
          category: "character",
          subcategory: "character-clothing",
          weight: { value: 1, enabled: false },
        },
        {
          id: "old-ring",
          label: "戒指",
          prompt: "ring",
          category: "character",
          subcategory: "character-accessory",
          weight: { value: 1, enabled: false },
        },
      ],
      deletedBuiltInPromptLibraryTagIds: [],
    });

    const lib = importPromptLibraryBundleFromJson(json);
    expect(lib.promptLibraryTags[0]?.category).toBe("outfit");
    expect(lib.promptLibraryTags[0]?.subcategory).toBe("outfit-full");
    expect(lib.promptLibraryTags[1]?.category).toBe("outfit");
    expect(lib.promptLibraryTags[1]?.subcategory).toBe("outfit-accessory");
  });

  it("migrates legacy prompt subcategory bindings on character import", () => {
    const project = createDefaultProject();
    const raw = JSON.parse(serializeProject(project)) as Record<string, unknown>;
    const char = structuredClone(defaultCharacter) as Record<string, unknown>;
    char.id = "legacy-bindings";
    char.promptCategoryBindings = ["character", "body-part"];
    char.promptSubcategoryBindings = ["character-subject", "character-clothing", "body-part-hair"];
    raw.scene = { ...(raw.scene as object), characters: [char] } as unknown;

    const imported = importProjectFromJson(JSON.stringify(raw));
    const first = imported.scene.characters[0];
    expect(first?.promptCategoryBindings).toEqual(["character", "outfit", "body-part"]);
    expect(first?.promptSubcategoryBindings).toContain("outfit-full");
    expect(first?.promptSubcategoryBindings).not.toContain("character-clothing");
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

    const imported = importProjectFromJson(JSON.stringify(project));

    expect(imported.scene.promptCategoryBindings).toEqual(["scene"]);
    expect(imported.scene.promptSubcategoryBindings).toEqual(["scene-weather"]);
    expect(imported.scene.objects[0]?.promptCategoryBindings).toEqual(["character"]);
    expect(imported.scene.objects[0]?.promptSubcategoryBindings).toEqual(["character-pose"]);
    expect(imported.scene.characters[0]?.promptCategoryBindings).toEqual(["character", "outfit", "body-part"]);
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

    const imported = importProjectFromJson(JSON.stringify(project));
    expect(imported.scene.promptTags).toHaveLength(1);
    expect(imported.settings.promptLibraryTags).toHaveLength(1);
    expect(imported.settings.deletedBuiltInPromptLibraryTagIds).toEqual(["a", "b"]);
  });

  it("getProjectContentFingerprint ignores id, timestamps, and prompt library", () => {
    const base = createDefaultProject();
    base.settings.promptLibraryTags = [
      {
        id: "only-in-base",
        label: "L",
        prompt: "p",
        category: "style",
        weight: { enabled: false, value: 1 },
      },
    ];
    const other: typeof base = {
      ...base,
      id: "other-id",
      createdAt: "2000-01-01T00:00:00.000Z",
      updatedAt: "2099-01-01T00:00:00.000Z",
      settings: {
        ...base.settings,
        promptLibraryTags: [],
        deletedBuiltInPromptLibraryTagIds: [],
      },
    };
    expect(getProjectContentFingerprint(base)).toBe(getProjectContentFingerprint(other));
  });

  it("round-trips line, polygon, preset, and image-placeholder scene objects", () => {
    const project = createDefaultProject();
    project.scene.objects = [
      {
        id: "obj-line",
        kind: "line",
        name: "线",
        description: "",
        position: { x: 10, y: 20 },
        size: { width: 100, height: 40 },
        rotation: 0,
        layer: 0,
        fill: "#000000",
        includeInPrompt: true,
        weight: { enabled: false, value: 1 },
        promptTags: [],
        lineEndpoints: { x1: 0, y1: 20, x2: 100, y2: 20 },
      },
      {
        id: "obj-poly",
        kind: "polygon",
        name: "三",
        description: "",
        position: { x: 0, y: 0 },
        size: { width: 50, height: 50 },
        rotation: 0,
        layer: 1,
        fill: "#00ff00",
        includeInPrompt: true,
        weight: { enabled: false, value: 1 },
        promptTags: [],
        polygonPoints: [
          { x: 0, y: 50 },
          { x: 25, y: 0 },
          { x: 50, y: 50 },
        ],
      },
      {
        id: "obj-preset",
        kind: "preset",
        name: "树",
        description: "tree",
        position: { x: 5, y: 5 },
        size: { width: 80, height: 100 },
        rotation: 0,
        layer: 2,
        fill: "#006600",
        includeInPrompt: true,
        weight: { enabled: false, value: 1 },
        promptTags: [],
        presetKey: "preset-tree",
      },
      {
        id: "obj-img",
        kind: "image-placeholder",
        name: "图",
        description: "",
        position: { x: 1, y: 2 },
        size: { width: 60, height: 70 },
        rotation: 0,
        layer: 3,
        fill: "#cccccc",
        includeInPrompt: true,
        weight: { enabled: false, value: 1 },
        promptTags: [],
        imageLabel: "Ref",
      },
    ];

    const imported = importProjectFromJson(serializeProject(project));

    expect(imported.scene.objects).toHaveLength(4);
    expect(imported.scene.objects[0]?.kind).toBe("line");
    expect(imported.scene.objects[0]?.lineEndpoints).toEqual({ x1: 0, y1: 20, x2: 100, y2: 20 });
    expect(imported.scene.objects[1]?.polygonPoints).toHaveLength(3);
    expect(imported.scene.objects[2]?.presetKey).toBe("preset-tree");
    expect(imported.scene.objects[3]?.imageLabel).toBe("Ref");
  });

  it("round-trips 3D scene mode and primitive transforms", () => {
    const project = createDefaultProject();
    project.scene.mode = "3d";
    project.scene.three.camera.position = { x: 7, y: 6, z: 8 };
    project.scene.three.camera.target = { x: 0, y: 1.2, z: -1 };
    project.scene.three.camera.fov = 52;
    project.scene.three.lighting.ambientIntensity = 0.35;
    project.scene.three.lighting.directionalIntensity = 1.7;
    project.scene.three.lighting.directionalPosition = { x: -3, y: 9, z: 2 };
    project.scene.three.grid = { size: 18, divisions: 9 };
    project.scene.objects = [
      {
        id: "obj-cube",
        kind: "cube",
        name: "立方体",
        description: "blue cube",
        position: { x: 0, y: 0 },
        size: { width: 120, height: 120 },
        rotation: 0,
        layer: 0,
        fill: "#60a5fa",
        includeInPrompt: true,
        weight: { enabled: false, value: 1 },
        promptTags: [],
        transform3D: {
          position: { x: 1, y: 0.5, z: -2 },
          rotation: { x: 0, y: 45, z: 0 },
          scale: { x: 1.5, y: 1, z: 1 },
        },
      },
    ];

    const imported = importProjectFromJson(serializeProject(project));

    expect(imported.scene.mode).toBe("3d");
    expect(imported.scene.three).toMatchObject({
      camera: {
        position: { x: 7, y: 6, z: 8 },
        target: { x: 0, y: 1.2, z: -1 },
        fov: 52,
      },
      lighting: {
        ambientIntensity: 0.35,
        directionalIntensity: 1.7,
        directionalPosition: { x: -3, y: 9, z: 2 },
      },
      grid: { size: 18, divisions: 9 },
    });
    expect(imported.scene.objects[0]?.kind).toBe("cube");
    expect(imported.scene.objects[0]?.transform3D).toEqual({
      position: { x: 1, y: 0.5, z: -2 },
      rotation: { x: 0, y: 45, z: 0 },
      scale: { x: 1.5, y: 1, z: 1 },
    });
  });

  it("round-trips 3D preset transforms so they stay in the 3D viewport", () => {
    const project = createDefaultProject();
    project.scene.mode = "3d";
    project.scene.objects = [
      {
        id: "obj-preset-3d",
        kind: "preset",
        name: "桌子",
        description: "table",
        position: { x: 0, y: 0 },
        size: { width: 160, height: 80 },
        rotation: 0,
        layer: 0,
        fill: "#a16207",
        includeInPrompt: true,
        weight: { enabled: false, value: 1 },
        promptTags: [],
        presetKey: "preset-table",
        transform3D: {
          position: { x: 2, y: 0.4, z: -1 },
          rotation: { x: 0, y: 30, z: 0 },
          scale: { x: 1.6, y: 0.8, z: 0.8 },
        },
      },
    ];

    const imported = importProjectFromJson(serializeProject(project));
    const object = imported.scene.objects[0];

    expect(object?.transform3D).toEqual({
      position: { x: 2, y: 0.4, z: -1 },
      rotation: { x: 0, y: 30, z: 0 },
      scale: { x: 1.6, y: 0.8, z: 0.8 },
    });
    expect(object && isThreeDViewportPrimitive(object)).toBe(true);
    expect(sceneObjectsVisibleOn2DCanvas(imported.scene.objects)).toHaveLength(0);
  });

  it("migrates legacy character joints3D to stickFigurePose3D on import", () => {
    const base = createDefaultProject();
    const payload = {
      ...base,
      scene: {
        ...base.scene,
        characters: [
          {
            ...defaultCharacter,
            id: "char-migrate",
            name: "迁移",
            characterSpace: "3d" as const,
            joints3D: { ...defaultCharacterMannequinJoints3D },
          },
        ],
      },
    };
    const imported = importProjectFromJson(JSON.stringify(payload));
    const ch = imported.scene.characters[0];
    expect(ch?.stickFigurePose3D?.version).toBe(1);
    expect(Number.isFinite(ch?.stickFigurePose3D?.joints.pelvis.y)).toBe(true);
    expect(ch?.joints3D).toBeUndefined();
  });
});
