import { describe, expect, it } from "vitest";

import { createDefaultProject, defaultCharacter } from "@/features/editor/store/defaults";
import type { SceneForgeProject, SceneObject } from "@/shared/types";

import { generatePrompt } from "./generate-prompt";

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
  it("builds a stable diffusion prompt from semantic scene data", () => {
    const project = createDefaultProject();
    project.settings.modelFormat = "stable-diffusion";
    addTableObject(project);
    const character = addDefaultCharacter(project);

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
    expect(result.negativePrompt).toBe("low quality, blurry, extra fingers");
  });

  it("uses Midjourney weight formatting when configured", () => {
    const project = {
      ...createDefaultProject(),
      settings: {
        ...createDefaultProject().settings,
        modelFormat: "midjourney" as const,
      },
    };
    project.scene.promptTags.push({
      id: "tag-cinematic-style",
      label: "电影感",
      prompt: "cinematic composition",
      category: "style",
      weight: { enabled: true, value: 1.15 },
    });

    const result = generatePrompt(project);

    expect(result.prompt).toContain("cinematic composition::1.15");
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

  it("adds upper-left sky hints for sky objects when spatial hints are enabled", () => {
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

    expect(result.parts).toContain("full moon in the upper left sky");
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

  it("adds scale and foreground hints for large lower objects", () => {
    const project = createDefaultProject();

    addSceneObject(project, {
      id: "object-meadow",
      name: "meadow",
      description: "wildflower meadow",
      position: { x: 300, y: 500 },
      size: { width: 600, height: 220 },
    });

    const result = generatePrompt(project);

    expect(result.parts).toContain("wildflower meadow large in the foreground");
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
});
