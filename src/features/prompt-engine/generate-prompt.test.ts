import { describe, expect, it } from "vitest";

import { createDefaultProject, defaultCharacter } from "@/features/editor/store/defaults";
import type { SceneForgeProject, SceneObject } from "@/shared/types";

import { upsertFaceTemplateTagsOnHead } from "./face-templates";
import { formatPromptForClipboardCopy, generatePrompt } from "./generate-prompt";

function addTableObject(project: SceneForgeProject) {
  const tableObject: SceneObject = {
    id: "object-table",
    kind: "rectangle",
    name: "桌子",
    description: "wooden table in the foreground",
    position: { x: 320, y: 476 },
    size: { width: 360, height: 92 },
    rotation: 0,
    layer: 1,
    fill: "#92400e",
    includeInPrompt: true,
    weight: { enabled: false, value: 1 },
    promptTags: [],
  };

  project.scene.objects.push(tableObject);

  return tableObject;
}

function addSceneObject(project: SceneForgeProject, object: Partial<SceneObject> & Pick<SceneObject, "id">) {
  const sceneObject: SceneObject = {
    id: object.id,
    kind: object.kind ?? "rectangle",
    name: object.name ?? "场景对象",
    description: object.description ?? "",
    position: object.position ?? { x: 0, y: 0 },
    size: object.size ?? { width: 120, height: 120 },
    rotation: object.rotation ?? 0,
    layer: object.layer ?? 1,
    fill: object.fill ?? "#e2e8f0",
    includeInPrompt: object.includeInPrompt ?? true,
    weight: object.weight ?? { enabled: false, value: 1 },
    promptTags: object.promptTags ?? [],
    lineEndpoints: object.lineEndpoints,
    polygonPoints: object.polygonPoints,
    presetKey: object.presetKey,
    imageLabel: object.imageLabel,
    transform3D: object.transform3D,
  };

  project.scene.objects.push(sceneObject);

  return sceneObject;
}

function addDefaultCharacter(project: SceneForgeProject) {
  const character = structuredClone(defaultCharacter);

  project.scene.characters.push(character);

  return character;
}

describe("generatePrompt", () => {
  it("includes canvas aspect ratio and pixel dimensions", () => {
    const project = createDefaultProject();
    const result = generatePrompt(project);

    expect(result.parts).toContain("16:9 aspect ratio, 1280x720 pixels");
    expect(result.prompt).toMatch(/16:9 aspect ratio/);
    expect(result.prompt).toMatch(/1280x720 pixels/);
  });

  it("builds a stable diffusion prompt from semantic scene data", () => {
    const project = createDefaultProject();
    project.settings.modelFormat = "stable-diffusion";
    addTableObject(project);
    const character = addDefaultCharacter(project);
    project.scene.description = "场景描述";

    character.bodyParts[0].promptTags.push({
      id: "tag-long-hair",
      label: "头发提示词",
      prompt: "long flowing hair",
      category: "body-part",
      weight: { enabled: true, value: 1.2 },
    });

    const result = generatePrompt(project);

    expect(result.prompt).toContain("场景描述");
    expect(result.prompt).toContain("wooden table in the foreground");
    expect(result.parts).toContain("head with (long flowing hair:1.2)");
    expect(result.negativePrompt).toBe(
      "low quality, extra fingers, CGI, 3D render, over-smoothed skin, plastic skin, overly glossy, unnatural symmetry, saturated colors, digital airbrush",
    );
  });

  it("keeps legacy settings negative prompts and dedupes against default negative tags", () => {
    const project = createDefaultProject();
    project.settings.negativePrompt = "low quality, blurry, extra fingers";

    const result = generatePrompt(project);

    expect(result.negativePrompt).toContain("blurry");
    expect(result.negativePrompt.match(/\blow quality\b/g)).toHaveLength(1);
    expect(result.negativePrompt.match(/\bextra fingers\b/g)).toHaveLength(1);
  });

  it("keeps object tags scoped to their scene object prompt", () => {
    const project = createDefaultProject();
    const tableObject = addTableObject(project);

    tableObject.promptTags.push({
      id: "tag-polished-wood",
      label: "抛光木材",
      prompt: "polished wood surface",
      category: "scene",
      weight: { enabled: false, value: 1 },
    });

    const result = generatePrompt(project);

    expect(result.parts).toContain("wooden table in the foreground with polished wood surface");
  });

  it("keeps body-part tags scoped to their body part prompt", () => {
    const project = createDefaultProject();
    const character = addDefaultCharacter(project);
    const rightHand = character.bodyParts.find((bodyPart) => bodyPart.id === "rightHand");

    rightHand?.promptTags.push({
      id: "tag-holding-sword",
      label: "手持剑",
      prompt: "holding a sword",
      category: "body-part",
      weight: { enabled: false, value: 1 },
    });

    const result = generatePrompt(project);

    expect(result.parts).toContain("right hand holding a sword");
  });

  it("collects body-part negative tags", () => {
    const project = createDefaultProject();
    const character = addDefaultCharacter(project);

    character.bodyParts[0].promptTags.push({
      id: "tag-bad-hands",
      label: "手部错误",
      prompt: "bad hands",
      category: "negative",
      weight: { enabled: false, value: 1 },
      negative: true,
    });

    const result = generatePrompt(project);

    expect(result.negativePrompt).toContain("bad hands");
  });

  it("adds weighted face template tags to the scoped head prompt", () => {
    const project = createDefaultProject();
    project.settings.modelFormat = "stable-diffusion";
    const character = addDefaultCharacter(project);
    character.bodyParts = upsertFaceTemplateTagsOnHead(
      character.bodyParts,
      "real-human-face",
      1,
    );

    const result = generatePrompt(project);
    const headPrompt = result.parts.find((part) => part.startsWith("head with "));

    expect(headPrompt).toContain("(multi-tone living skin:1.16)");
    expect(headPrompt).toContain("(natural skin microtexture:1.12)");
    expect(headPrompt).toContain("slight facial asymmetry");
    expect(result.parts.filter((part) => part.startsWith("head with "))).toHaveLength(1);
    expect(result.negativePrompt).toContain("waxy face");
    expect(result.negativePrompt).toContain("dead eyes");
  });

  it("dedupes face template negative tags against existing negative prompts", () => {
    const project = createDefaultProject();
    const character = addDefaultCharacter(project);
    character.bodyParts = upsertFaceTemplateTagsOnHead(
      character.bodyParts,
      "real-human-face",
      1,
    );

    const result = generatePrompt(project);

    expect(result.negativePrompt.match(/\bover-smoothed skin\b/g)).toHaveLength(1);
    expect(result.negativePrompt).toContain("dead eyes");
  });

  it("adds anime hand-drawn face template tags to the head prompt", () => {
    const project = createDefaultProject();
    project.settings.modelFormat = "stable-diffusion";
    const character = addDefaultCharacter(project);
    character.bodyParts = upsertFaceTemplateTagsOnHead(
      character.bodyParts,
      "anime-handdrawn-face",
      1,
    );

    const result = generatePrompt(project);
    const headPrompt = result.parts.find((part) => part.startsWith("head with "));

    expect(headPrompt).toContain("(clean hand-drawn anime face lineart:1.12)");
    expect(headPrompt).toContain("(consistent anime eye shapes:1.1)");
    expect(headPrompt).toContain("simple readable anime nose and mouth");
    expect(result.negativePrompt).toContain("broken eye details");
    expect(result.negativePrompt).toContain("melted iris");
    expect(result.negativePrompt).toContain("AI-generated eye artifacts");
  });

  it("adds transparent hand-drawn anime face template tags to the head prompt", () => {
    const project = createDefaultProject();
    project.settings.modelFormat = "stable-diffusion";
    const character = addDefaultCharacter(project);
    character.bodyParts = upsertFaceTemplateTagsOnHead(
      character.bodyParts,
      "transparent-handdrawn-anime-face",
      1,
    );

    const result = generatePrompt(project);
    const headPrompt = result.parts.find((part) => part.startsWith("head with "));

    expect(headPrompt).toContain("(transparent watercolor-like skin shading:1.12)");
    expect(headPrompt).toContain("(detailed layered iris highlights:1.12)");
    expect(headPrompt).toContain("gentle hand-painted skin gradients");
    expect(result.negativePrompt).toContain("plastic anime face");
    expect(result.negativePrompt).toContain("flat dead eyes");
    expect(result.negativePrompt).toContain("muddy facial lineart");
  });

  it("uses layout constraints as the default source for canvas placement hints", () => {
    const project = createDefaultProject();

    addSceneObject(project, {
      id: "object-moon",
      kind: "circle",
      name: "moon",
      description: "full moon",
      position: { x: 48, y: 40 },
      size: { width: 100, height: 100 },
    });

    const result = generatePrompt(project);

    expect(result.prompt).toContain("full moon placed in the upper left");
    expect(result.parts).not.toContain("full moon");
    expect(result.parts).not.toContain("full moon in the upper left sky");
  });

  it("adds per-object canvas placement hints when layout constraints are disabled", () => {
    const project = createDefaultProject();

    addSceneObject(project, {
      id: "object-moon",
      kind: "circle",
      name: "moon",
      description: "full moon",
      position: { x: 48, y: 40 },
      size: { width: 100, height: 100 },
    });

    const result = generatePrompt(project, { includeLayoutConstraints: false });

    expect(result.parts).toContain("full moon in the upper left sky");
    expect(result.prompt).not.toContain("placed in the upper left");
  });

  it("does not add spatial hints when spatial hints are disabled", () => {
    const project = createDefaultProject();
    project.settings.includeSpatialHints = false;

    addSceneObject(project, {
      id: "object-moon",
      kind: "circle",
      name: "moon",
      description: "full moon",
      position: { x: 48, y: 40 },
      size: { width: 100, height: 100 },
    });

    const result = generatePrompt(project);

    expect(result.parts).toContain("full moon");
    expect(result.prompt).not.toContain("upper left sky");
  });

  it("keeps scale hints while layout constraints own canvas placement", () => {
    const project = createDefaultProject();

    addSceneObject(project, {
      id: "object-meadow",
      name: "meadow",
      description: "wildflower meadow",
      position: { x: 300, y: 500 },
      size: { width: 600, height: 220 },
    });

    const result = generatePrompt(project);

    expect(result.parts).toContain("wildflower meadow large");
    expect(result.prompt).toContain("wildflower meadow placed in the lower foreground");
    expect(result.parts).not.toContain("wildflower meadow large in the foreground");
  });

  it("omits plain object prompts when global layout constraints already describe the object", () => {
    const project = createDefaultProject();

    addSceneObject(project, {
      id: "object-table",
      name: "Table",
      description: "a wooden table",
      position: { x: 520, y: 40 },
      size: { width: 180, height: 120 },
    });

    const result = generatePrompt(project);

    expect(result.prompt).toContain("a wooden table placed in the upper center");
    expect(result.parts).not.toContain("a wooden table");
  });

  it("adds character-relative hints for nearby objects", () => {
    const project = createDefaultProject();
    addDefaultCharacter(project);

    addSceneObject(project, {
      id: "object-lantern",
      name: "lantern",
      description: "glowing lantern",
      position: { x: 500, y: 260 },
      size: { width: 80, height: 120 },
    });

    const result = generatePrompt(project);

    expect(result.parts).toContain("glowing lantern near the character");
  });

  it("adds a global layout constraint from canvas placement", () => {
    const project = createDefaultProject();
    const character = addDefaultCharacter(project);
    character.description = "1girl sitting on a chair";
    character.position = { x: 900, y: 260 };

    addSceneObject(project, {
      id: "object-window",
      name: "Window",
      description: "large window",
      position: { x: 300, y: 120 },
      size: { width: 560, height: 320 },
    });
    addSceneObject(project, {
      id: "object-table",
      name: "Table",
      description: "small marble table",
      position: { x: 120, y: 500 },
      size: { width: 220, height: 120 },
    });
    addSceneObject(project, {
      id: "object-river",
      name: "River",
      description: "scenic river",
      position: { x: 180, y: 80 },
      size: { width: 520, height: 100 },
    });

    const result = generatePrompt(project);

    expect(result.parts).toEqual(
      expect.arrayContaining([
        expect.stringContaining("layout constraint: composition must follow the 2D canvas layout"),
      ]),
    );
    expect(result.prompt).toContain("large window placed in the center");
    expect(result.prompt).toContain("small marble table placed in the lower left foreground");
    expect(result.prompt).toContain("1girl sitting on a chair placed in the right side");
    expect(result.prompt).toContain("scenic river visible outside or through the window");
  });

  it("includes line and polygon objects via descriptions like other scene objects", () => {
    const project = createDefaultProject();
    addSceneObject(project, {
      id: "line-1",
      kind: "line",
      name: "Line",
      description: "thin horizon outline",
      position: { x: 0, y: 0 },
      size: { width: 200, height: 40 },
      lineEndpoints: { x1: 0, y1: 20, x2: 200, y2: 20 },
    });
    addSceneObject(project, {
      id: "poly-1",
      kind: "polygon",
      name: "Poly",
      description: "triangular shade shape",
      position: { x: 10, y: 10 },
      size: { width: 60, height: 50 },
      polygonPoints: [
        { x: 0, y: 50 },
        { x: 30, y: 0 },
        { x: 60, y: 50 },
      ],
    });

    const result = generatePrompt(project);
    expect(result.prompt).toMatch(/thin horizon outline/);
    expect(result.prompt).toMatch(/triangular shade shape/);
  });

  it("adds conservative 3D stage placement hints for primitive objects", () => {
    const project = createDefaultProject();
    project.scene.mode = "3d";
    addSceneObject(project, {
      id: "cube-1",
      kind: "cube",
      name: "stone block",
      description: "ancient stone block",
      transform3D: {
        position: { x: 2, y: 0.5, z: 2 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1.8, y: 1, z: 1 },
      },
    });

    const result = generatePrompt(project);

    expect(result.prompt).toContain("layout constraint: composition must follow the 3D stage arrangement");
    expect(result.prompt).toContain("ancient stone block prominent in the foreground on the right");
  });

  it("adds 3D stage placement hints for characters and nearby objects", () => {
    const project = createDefaultProject();
    project.scene.mode = "3d";
    const character = addDefaultCharacter(project);
    character.description = "hero character";
    character.transform3D = {
      position: { x: -2, y: 0, z: 2 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    };
    addSceneObject(project, {
      id: "cube-1",
      kind: "cube",
      name: "sword pedestal",
      description: "stone sword pedestal",
      transform3D: {
        position: { x: -2.2, y: 0.5, z: 2.4 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
    });

    const result = generatePrompt(project);

    expect(result.prompt).toContain("hero character in the foreground on the left");
    expect(result.prompt).toContain("stone sword pedestal near hero character");
  });
});

describe("formatPromptForClipboardCopy", () => {
  it("appends Please avoid when negative is non-empty", () => {
    expect(formatPromptForClipboardCopy("a, b", "x, y")).toBe("a, b\n\nPlease avoid: x, y");
  });

  it("returns only positive when negative is empty or whitespace", () => {
    expect(formatPromptForClipboardCopy("a", "")).toBe("a");
    expect(formatPromptForClipboardCopy("a", "   ")).toBe("a");
  });

  it("trims positive and negative segments", () => {
    expect(formatPromptForClipboardCopy("  hi  ", "  bad  ")).toBe("hi\n\nPlease avoid: bad");
  });
});
