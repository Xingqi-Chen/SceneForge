import { beforeEach, describe, expect, it } from "vitest";

import type { CharacterSkeleton, PromptTag } from "@/shared/types";

import { cloneStickFigurePose } from "@/features/editor/stick-figure-3d/stick-figure-pose-io";
import { getCharacterStickFigurePose } from "@/features/editor/stick-figure-3d/get-character-stick-pose";
import { mergeTargets, solveStickFigurePose, stickPoseToTargets } from "@/features/editor/stick-figure-3d/solveStickFigurePose";
import { stickFigureBoundsMinY } from "@/features/editor/stick-figure-3d/snap-stick-figure-ground";

import { createDefaultProject, createDefaultStickFigurePoseV1 } from "./defaults";
import { useEditorStore } from "./editor-store";

const testTag: PromptTag = {
  id: "tag-test",
  label: "测试标签",
  prompt: "dramatic rim light",
  category: "lighting",
  weight: { enabled: false, value: 1 },
};

function stickGroundSnapY(character: CharacterSkeleton): number {
  const pose = getCharacterStickFigurePose(character);
  const scaledMinY = stickFigureBoundsMinY(pose) * (character.transform3D?.scale.y ?? 1);
  return Math.abs(scaledMinY) < 0.01 ? 0 : Number((-scaledMinY).toFixed(3));
}

describe("editor store", () => {
  beforeEach(() => {
    useEditorStore.getState().setProject(createDefaultProject());
  });

  it("adds a scene object and selects it", () => {
    useEditorStore.getState().addObject({
      kind: "rectangle",
      name: "路灯",
      description: "street lamp on the left",
      fill: "#facc15",
    });

    const { project, selection } = useEditorStore.getState();
    const addedObject = project.scene.objects.at(-1);

    expect(addedObject).toMatchObject({
      kind: "rectangle",
      name: "路灯",
      description: "street lamp on the left",
      fill: "#facc15",
      includeInPrompt: true,
    });
    expect(selection).toEqual({ kind: "object", id: addedObject?.id });
  });

  it("updates object properties without replacing other objects", () => {
    useEditorStore.getState().addObject({
      kind: "rectangle",
      name: "窗户",
      description: "large window with soft morning light",
      fill: "#bfdbfe",
    });
    useEditorStore.getState().addObject({
      kind: "rectangle",
      name: "桌子",
      description: "wooden table in the foreground",
      fill: "#92400e",
    });

    const firstObject = useEditorStore.getState().project.scene.objects[0];
    const secondObject = useEditorStore.getState().project.scene.objects[1];

    useEditorStore.getState().updateObject(firstObject.id, {
      name: "大窗户",
      position: { x: 200, y: 120 },
    });

    const objects = useEditorStore.getState().project.scene.objects;

    expect(objects[0]).toMatchObject({
      id: firstObject.id,
      name: "大窗户",
      position: { x: 200, y: 120 },
    });
    expect(objects[1]).toEqual(secondObject);
  });

  it("duplicates, moves, and deletes the selected object", () => {
    useEditorStore.getState().addObject({
      kind: "rectangle",
      name: "路灯",
      description: "street lamp on the left",
      fill: "#facc15",
    });

    const initialObjects = useEditorStore.getState().project.scene.objects;
    const selectedObject = initialObjects[0];

    useEditorStore.getState().selectObject(selectedObject.id);
    useEditorStore.getState().duplicateSelection();

    const { project, selection } = useEditorStore.getState();
    const duplicatedObject = project.scene.objects.at(-1);

    expect(project.scene.objects).toHaveLength(initialObjects.length + 1);
    expect(selection).toEqual({ kind: "object", id: duplicatedObject?.id });
    expect(duplicatedObject).toMatchObject({
      name: `${selectedObject.name} 副本`,
      position: {
        x: selectedObject.position.x + 32,
        y: selectedObject.position.y + 32,
      },
    });
    expect(duplicatedObject?.id).not.toBe(selectedObject.id);

    useEditorStore.getState().moveSelectionBy({ x: 10, y: -5 });

    expect(useEditorStore.getState().project.scene.objects.at(-1)?.position).toEqual({
      x: selectedObject.position.x + 42,
      y: selectedObject.position.y + 27,
    });

    useEditorStore.getState().deleteSelection();

    expect(useEditorStore.getState().project.scene.objects).toHaveLength(initialObjects.length);
    expect(useEditorStore.getState().selection).toEqual({ kind: "scene" });
  });

  it("duplicates a previously copied selection even after the active selection changes", () => {
    useEditorStore.getState().addObject({
      kind: "rectangle",
      name: "窗户",
      description: "large window with soft morning light",
      fill: "#bfdbfe",
    });
    useEditorStore.getState().addObject({
      kind: "rectangle",
      name: "桌子",
      description: "wooden table in the foreground",
      fill: "#92400e",
    });

    const [firstObject, secondObject] = useEditorStore.getState().project.scene.objects;

    useEditorStore.getState().selectObject(firstObject.id);
    const copiedSelection = useEditorStore.getState().selection;
    useEditorStore.getState().selectObject(secondObject.id);
    useEditorStore.getState().duplicateSelection(copiedSelection);

    const { project, selection } = useEditorStore.getState();
    const duplicatedObject = project.scene.objects.at(-1);

    expect(project.scene.objects).toHaveLength(3);
    expect(selection).toEqual({ kind: "object", id: duplicatedObject?.id });
    expect(duplicatedObject).toMatchObject({
      name: `${firstObject.name} 副本`,
      position: {
        x: firstObject.position.x + 32,
        y: firstObject.position.y + 32,
      },
    });
  });

  it("undoes the latest canvas edit and restores the previous selection", () => {
    useEditorStore.getState().addObject({
      kind: "rectangle",
      name: "路灯",
      description: "street lamp on the left",
      fill: "#facc15",
    });

    const addedObject = useEditorStore.getState().project.scene.objects[0];
    expect(useEditorStore.getState().selection).toEqual({ kind: "object", id: addedObject.id });

    useEditorStore.getState().undo();

    expect(useEditorStore.getState().project.scene.objects).toHaveLength(0);
    expect(useEditorStore.getState().selection).toEqual({ kind: "scene" });
  });

  it("does not add selection-only changes to the undo stack", () => {
    useEditorStore.getState().addObject({
      kind: "rectangle",
      name: "路灯",
      description: "street lamp on the left",
      fill: "#facc15",
    });
    useEditorStore.getState().addObject({
      kind: "rectangle",
      name: "桌子",
      description: "wooden table in the foreground",
      fill: "#92400e",
    });

    const [firstObject, secondObject] = useEditorStore.getState().project.scene.objects;

    useEditorStore.getState().selectObject(firstObject.id);
    useEditorStore.getState().selectObject(secondObject.id);
    useEditorStore.getState().undo();

    expect(useEditorStore.getState().project.scene.objects).toHaveLength(1);
    expect(useEditorStore.getState().project.scene.objects[0].id).toBe(firstObject.id);
  });

  it("moves the selected object forward and backward by swapping layers", () => {
    useEditorStore.getState().addObject({
      kind: "rectangle",
      name: "窗户",
      description: "large window with soft morning light",
      fill: "#bfdbfe",
    });
    useEditorStore.getState().addObject({
      kind: "rectangle",
      name: "桌子",
      description: "wooden table in the foreground",
      fill: "#92400e",
    });

    const firstObject = useEditorStore.getState().project.scene.objects[0];
    const secondObject = useEditorStore.getState().project.scene.objects[1];

    useEditorStore.getState().selectObject(firstObject.id);
    useEditorStore.getState().bringSelectionForward();

    let objects = useEditorStore.getState().project.scene.objects;

    expect(objects.find((object) => object.id === firstObject.id)?.layer).toBe(secondObject.layer);
    expect(objects.find((object) => object.id === secondObject.id)?.layer).toBe(firstObject.layer);

    useEditorStore.getState().sendSelectionBackward();

    objects = useEditorStore.getState().project.scene.objects;

    expect(objects.find((object) => object.id === firstObject.id)?.layer).toBe(firstObject.layer);
    expect(objects.find((object) => object.id === secondObject.id)?.layer).toBe(secondObject.layer);
  });

  it("updates scene and project settings", () => {
    useEditorStore.getState().updateScene({ description: "rainy cyberpunk street" });
    useEditorStore.getState().updateProjectSettings({
      modelFormat: "midjourney",
      negativePrompt: "washed out",
    });

    const { project } = useEditorStore.getState();

    expect(project.scene.description).toBe("rainy cyberpunk street");
    expect(project.settings).toMatchObject({
      modelFormat: "midjourney",
      negativePrompt: "washed out",
      promptLibraryTags: [],
      deletedBuiltInPromptLibraryTagIds: [],
    });
  });

  it("switches to 3D mode, adds a primitive, and updates its transform", () => {
    useEditorStore.getState().setSceneMode("3d");
    useEditorStore.getState().addObject({
      kind: "cube",
      name: "立方体",
      fill: "#60a5fa",
    });

    const addedObject = useEditorStore.getState().project.scene.objects[0];

    expect(useEditorStore.getState().project.scene.mode).toBe("3d");
    expect(addedObject).toMatchObject({
      kind: "cube",
      transform3D: {
        position: expect.objectContaining({ y: 0.5 }),
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
    });

    useEditorStore.getState().updateObject3DTransform(addedObject.id, {
      position: { x: 2, y: 0.75, z: -1 },
    });

    expect(useEditorStore.getState().project.scene.objects[0].transform3D?.position).toEqual({
      x: 2,
      y: 0.75,
      z: -1,
    });

    useEditorStore.getState().setObject3DTransform(addedObject.id, {
      position: { x: -1, y: 1.25, z: 3 },
      rotation: { x: 10, y: 25, z: -5 },
      scale: { x: 1.2, y: 0.8, z: 2 },
    });

    expect(useEditorStore.getState().project.scene.objects[0].transform3D).toEqual({
      position: { x: -1, y: 1.25, z: 3 },
      rotation: { x: 10, y: 25, z: -5 },
      scale: { x: 1.2, y: 0.8, z: 2 },
    });

    useEditorStore.getState().updateScene({
      three: {
        ...useEditorStore.getState().project.scene.three,
        camera: {
          position: { x: 4, y: 3, z: 5 },
          target: { x: 0, y: 1, z: 0 },
          fov: 55,
        },
        lighting: {
          ambientIntensity: 0.4,
          directionalIntensity: 1.8,
          directionalPosition: { x: -2, y: 6, z: 3 },
        },
        grid: { size: 16, divisions: 8 },
      },
    });

    expect(useEditorStore.getState().project.scene.three).toMatchObject({
      camera: {
        position: { x: 4, y: 3, z: 5 },
        target: { x: 0, y: 1, z: 0 },
        fov: 55,
      },
      lighting: {
        ambientIntensity: 0.4,
        directionalIntensity: 1.8,
        directionalPosition: { x: -2, y: 6, z: 3 },
      },
      grid: { size: 16, divisions: 8 },
    });
  });

  it("moves selected 3D primitives across the ground plane and vertical axis", () => {
    useEditorStore.getState().setSceneMode("3d");
    useEditorStore.getState().addObject({
      kind: "cube",
      name: "立方体",
    });
    useEditorStore.getState().addObject({
      kind: "sphere",
      name: "球体",
    });

    const [cube, sphere] = useEditorStore.getState().project.scene.objects;

    useEditorStore.getState().selectObject(cube.id);
    useEditorStore.getState().moveSelectionBy({ x: 10, y: -5 });
    useEditorStore.getState().moveSelectionIn3DBy({ x: 0, y: 0.25, z: 0 });

    expect(useEditorStore.getState().project.scene.objects[0].transform3D?.position).toEqual({
      x: -1,
      y: 0.75,
      z: -0.5,
    });

    useEditorStore.getState().selectMultiple([cube.id, sphere.id], []);
    useEditorStore.getState().moveSelectionBy({ x: -5, y: 10 });
    useEditorStore.getState().moveSelectionIn3DBy({ x: 0, y: -0.2, z: 0 });

    expect(useEditorStore.getState().project.scene.objects[0].transform3D?.position).toEqual({
      x: -1.5,
      y: 0.55,
      z: 0.5,
    });
    expect(useEditorStore.getState().project.scene.objects[1].transform3D?.position).toEqual({
      x: -1.5,
      y: 0.3,
      z: 1,
    });
  });

  it("snaps 3D primitives to the ground in 3D mode", () => {
    useEditorStore.getState().setSceneMode("3d");
    useEditorStore.getState().addObject({
      kind: "cube",
      name: "立方体",
      transform3D: {
        position: { x: 2, y: 3, z: -1 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
    });

    const cube = useEditorStore.getState().project.scene.objects[0];
    useEditorStore.getState().snapObjectToGround(cube.id);

    expect(useEditorStore.getState().project.scene.objects[0].transform3D?.position).toEqual({
      x: 2,
      y: 0.5,
      z: -1,
    });
  });

  it("resets the 2D scene without clearing the prompt library", () => {
    useEditorStore.getState().importPromptLibraryTags([
      {
        label: "雨景",
        prompt: "heavy rain on cobblestones",
        category: "scene",
        weight: { enabled: false, value: 1 },
      },
    ]);
    expect(useEditorStore.getState().deletePromptLibraryTag("library-blue-eyes")).toBe(true);
    useEditorStore.getState().addObject({
      kind: "rectangle",
      name: "路灯",
      description: "street lamp on the left",
    });
    useEditorStore.getState().addPromptTag({ kind: "scene" }, testTag);
    useEditorStore.getState().setAiGeneratedPrompt("generated prompt");

    useEditorStore.getState().resetProject();

    const { aiGeneratedPrompt, project, selection } = useEditorStore.getState();

    expect(project.scene.objects).toHaveLength(0);
    expect(project.scene.promptTags).toEqual(createDefaultProject().scene.promptTags);
    expect(project.settings.promptLibraryTags).toContainEqual(
      expect.objectContaining({
        label: "雨景",
        prompt: "heavy rain on cobblestones",
        category: "scene",
      }),
    );
    expect(project.settings.deletedBuiltInPromptLibraryTagIds).toContain("library-blue-eyes");
    expect(selection).toEqual({ kind: "scene" });
    expect(aiGeneratedPrompt).toBe("");
  });

  it("clears the canvas back to the default scene without clearing default negatives", () => {
    useEditorStore.getState().importPromptLibraryTags([
      {
        label: "闆ㄦ櫙",
        prompt: "heavy rain on cobblestones",
        category: "scene",
        weight: { enabled: false, value: 1 },
      },
    ]);
    useEditorStore.getState().updateProjectSettings({
      modelFormat: "midjourney",
      negativePrompt: "washed out",
    });
    useEditorStore.getState().updateScene({
      canvas: {
        ...useEditorStore.getState().project.scene.canvas,
        background: "#020617",
      },
      promptTags: [],
    });
    useEditorStore.getState().addObject({
      kind: "rectangle",
      name: "璺伅",
      description: "street lamp on the left",
    });
    useEditorStore.getState().addCharacter();
    useEditorStore.getState().setAiGeneratedPrompt("generated prompt");

    useEditorStore.getState().resetCanvas();

    const { aiGeneratedPrompt, project, selection } = useEditorStore.getState();

    expect(project.scene).toEqual(createDefaultProject().scene);
    expect(project.settings).toMatchObject({
      modelFormat: "midjourney",
      negativePrompt: "washed out",
      promptLibraryTags: [
        expect.objectContaining({
          label: "闆ㄦ櫙",
          prompt: "heavy rain on cobblestones",
          category: "scene",
        }),
      ],
    });
    expect(project.scene.promptTags).toEqual(createDefaultProject().scene.promptTags);
    expect(project.scene.promptTags.length).toBeGreaterThan(0);
    expect(selection).toEqual({ kind: "scene" });
    expect(aiGeneratedPrompt).toBe("");
  });

  it("imports prompt library tags into project settings", () => {
    const added = useEditorStore.getState().importPromptLibraryTags([
      {
        label: "雨景",
        prompt: "heavy rain on cobblestones",
        category: "scene",
        weight: { enabled: false, value: 1 },
      },
    ]);

    expect(added).toBe(1);
    expect(useEditorStore.getState().project.settings.promptLibraryTags).toEqual([
      expect.objectContaining({
        label: "雨景",
        prompt: "heavy rain on cobblestones",
        category: "scene",
      }),
    ]);

    const secondPass = useEditorStore.getState().importPromptLibraryTags([
      {
        label: "重复",
        prompt: "heavy rain on cobblestones",
        category: "scene",
        weight: { enabled: false, value: 1 },
      },
    ]);

    expect(secondPass).toBe(0);
    expect(useEditorStore.getState().project.settings.promptLibraryTags).toHaveLength(1);
  });

  it("deletes custom and built-in prompt library tags from project settings", () => {
    useEditorStore.getState().importPromptLibraryTags([
      {
        label: "雨景",
        prompt: "heavy rain on cobblestones",
        category: "scene",
        weight: { enabled: false, value: 1 },
      },
    ]);

    const customTagId = useEditorStore.getState().project.settings.promptLibraryTags[0]?.id;
    const customTag = useEditorStore.getState().project.settings.promptLibraryTags[0];
    expect(customTag).toBeDefined();
    if (!customTag) {
      throw new Error("Expected imported tag.");
    }

    useEditorStore.getState().addPromptTag({ kind: "scene" }, customTag);
    expect(useEditorStore.getState().project.scene.promptTags).toContainEqual(
      expect.objectContaining({ prompt: "heavy rain on cobblestones" }),
    );

    expect(useEditorStore.getState().deletePromptLibraryTag(customTagId ?? "")).toBe(true);
    expect(useEditorStore.getState().project.settings.promptLibraryTags).toHaveLength(0);
    expect(useEditorStore.getState().project.scene.promptTags).not.toContainEqual(
      expect.objectContaining({ prompt: "heavy rain on cobblestones" }),
    );

    useEditorStore.getState().addPromptTag(
      { kind: "scene" },
      {
        id: "library-blue-eyes",
        label: "蓝色眼睛",
        prompt: "blue eyes",
        category: "body-part",
        weight: { enabled: false, value: 1 },
      },
    );
    expect(useEditorStore.getState().deletePromptLibraryTag("library-blue-eyes")).toBe(true);
    expect(useEditorStore.getState().project.settings.deletedBuiltInPromptLibraryTagIds).toContain(
      "library-blue-eyes",
    );
    expect(useEditorStore.getState().project.scene.promptTags).not.toContainEqual(
      expect.objectContaining({ prompt: "blue eyes" }),
    );
  });

  it("updates custom prompt library tags", () => {
    useEditorStore.getState().importPromptLibraryTags([
      {
        label: "雨景",
        prompt: "heavy rain on cobblestones",
        category: "scene",
        weight: { enabled: false, value: 1 },
      },
    ]);

    const tag = useEditorStore.getState().project.settings.promptLibraryTags[0];
    expect(tag).toBeDefined();
    if (!tag) {
      throw new Error("Expected imported tag.");
    }

    expect(
      useEditorStore.getState().updatePromptLibraryTag({
        ...tag,
        label: "强雨",
        prompt: "heavy rain",
        category: "scene",
      }),
    ).toBe(true);

    expect(useEditorStore.getState().project.settings.promptLibraryTags[0]).toEqual(
      expect.objectContaining({
        id: tag.id,
        label: "强雨",
        prompt: "heavy rain",
        category: "scene",
      }),
    );
  });

  it("updates built-in prompt library tags by hiding the original and adding a custom copy", () => {
    expect(
      useEditorStore.getState().updatePromptLibraryTag({
        id: "library-blue-eyes",
        label: "青色眼睛",
        prompt: "cyan eyes",
        category: "body-part",
        weight: { enabled: false, value: 1 },
      }),
    ).toBe(true);

    const { deletedBuiltInPromptLibraryTagIds, promptLibraryTags } =
      useEditorStore.getState().project.settings;

    expect(deletedBuiltInPromptLibraryTagIds).toContain("library-blue-eyes");
    expect(promptLibraryTags).toContainEqual(
      expect.objectContaining({
        label: "青色眼睛",
        prompt: "cyan eyes",
        category: "body-part",
      }),
    );
  });

  it("adds a character and updates a joint", () => {
    const initialCharacterCount = useEditorStore.getState().project.scene.characters.length;

    useEditorStore.getState().addCharacter();

    const { project, selection } = useEditorStore.getState();
    const character = project.scene.characters.at(-1);

    expect(project.scene.characters).toHaveLength(initialCharacterCount + 1);
    expect(selection).toEqual({ kind: "character", id: character?.id });
    expect(character?.description).toBe("");
    expect(character?.characterSpace).toBe("2d");

    useEditorStore.getState().updateCharacterJoint(character?.id ?? "", "leftWrist", {
      x: -96,
      y: 150,
    });

    expect(useEditorStore.getState().project.scene.characters.at(-1)?.joints.leftWrist).toEqual({
      x: -96,
      y: 150,
    });
  });

  it("selects a body part on a character", () => {
    useEditorStore.getState().addCharacter();

    const character = useEditorStore.getState().project.scene.characters[0];

    useEditorStore.getState().selectBodyPart(character.id, "rightHand");

    expect(useEditorStore.getState().selection).toEqual({
      kind: "bodyPart",
      characterId: character.id,
      bodyPartId: "rightHand",
    });
  });

  it("selects a body part on a character in 3D mode", () => {
    useEditorStore.getState().setSceneMode("3d");
    useEditorStore.getState().addCharacter();

    const character = useEditorStore.getState().project.scene.characters[0];
    expect(character.characterSpace).toBe("3d");

    useEditorStore.getState().selectBodyPart(character.id, "leftThigh");

    expect(useEditorStore.getState().selection).toEqual({
      kind: "bodyPart",
      characterId: character.id,
      bodyPartId: "leftThigh",
    });
  });

  it("duplicates, moves, and deletes the selected character", () => {
    useEditorStore.getState().addCharacter();

    const selectedCharacter = useEditorStore.getState().project.scene.characters[0];

    useEditorStore.getState().selectCharacter(selectedCharacter.id);
    useEditorStore.getState().duplicateSelection();

    const duplicatedCharacter = useEditorStore.getState().project.scene.characters.at(-1);

    expect(useEditorStore.getState().project.scene.characters).toHaveLength(2);
    expect(useEditorStore.getState().selection).toEqual({
      kind: "character",
      id: duplicatedCharacter?.id,
    });
    expect(duplicatedCharacter).toMatchObject({
      name: `${selectedCharacter.name} 副本`,
      characterSpace: "2d",
      position: {
        x: selectedCharacter.position.x + 48,
        y: selectedCharacter.position.y + 24,
      },
    });
    expect(duplicatedCharacter?.id).not.toBe(selectedCharacter.id);

    useEditorStore.getState().moveSelectionBy({ x: -20, y: 10 });

    expect(useEditorStore.getState().project.scene.characters.at(-1)?.position).toEqual({
      x: selectedCharacter.position.x + 28,
      y: selectedCharacter.position.y + 34,
    });

    useEditorStore.getState().deleteSelection();

    expect(useEditorStore.getState().project.scene.characters).toHaveLength(1);
    expect(useEditorStore.getState().selection).toEqual({ kind: "scene" });
  });

  it("selects and moves characters in 3D mode", () => {
    useEditorStore.getState().setSceneMode("3d");
    useEditorStore.getState().addCharacter();

    const character = useEditorStore.getState().project.scene.characters[0];

    expect(useEditorStore.getState().selection).toEqual({ kind: "character", id: character.id });
    expect(character.characterSpace).toBe("3d");
    expect(character.transform3D).toEqual({
      position: { x: -1.5, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    });

    useEditorStore.getState().updateCharacter3DTransform(character.id, {
      position: { x: 1, y: 2, z: -1 },
    });
    useEditorStore.getState().moveSelectionBy({ x: 10, y: -5 });
    useEditorStore.getState().moveSelectionIn3DBy({ x: 0, y: 0.25, z: 0 });

    expect(useEditorStore.getState().project.scene.characters[0].transform3D?.position).toEqual({
      x: 2,
      y: 2.25,
      z: -1.5,
    });

    useEditorStore.getState().snapCharacterToGround(character.id);

    const snapped = useEditorStore.getState().project.scene.characters[0];
    expect(snapped.transform3D?.position).toEqual({
      x: 2,
      y: stickGroundSnapY(snapped),
      z: -1.5,
    });

    useEditorStore.getState().duplicateSelection();

    const duplicatedCharacter = useEditorStore.getState().project.scene.characters.at(-1);
    expect(duplicatedCharacter?.characterSpace).toBe("3d");
    expect(duplicatedCharacter?.transform3D?.position).toEqual({
      x: 2.6,
      y: stickGroundSnapY(duplicatedCharacter!),
      z: -0.9,
    });
    expect(useEditorStore.getState().selection).toEqual({
      kind: "character",
      id: duplicatedCharacter?.id,
    });
  });

  it("does not select a 3D-only character after switching to 2D mode", () => {
    useEditorStore.getState().setSceneMode("3d");
    useEditorStore.getState().addCharacter();
    const id = useEditorStore.getState().project.scene.characters[0].id;

    useEditorStore.getState().setSceneMode("2d");
    useEditorStore.getState().selectCharacter(id);

    expect(useEditorStore.getState().selection).toEqual({ kind: "scene" });
  });

  it("does not select a 2D-only character after switching to 3D mode", () => {
    useEditorStore.getState().addCharacter();
    const id = useEditorStore.getState().project.scene.characters[0].id;

    useEditorStore.getState().setSceneMode("3d");
    useEditorStore.getState().selectCharacter(id);

    expect(useEditorStore.getState().selection).toEqual({ kind: "scene" });
  });

  it("snaps posed 3D characters by their stick figure bounds", () => {
    useEditorStore.getState().setSceneMode("3d");
    useEditorStore.getState().addCharacter();

    const character = useEditorStore.getState().project.scene.characters[0];
    const base = createDefaultStickFigurePoseV1();
    const targets = mergeTargets(stickPoseToTargets(base), {
      leftFoot: { ...base.joints.leftFoot, y: -0.18 },
      rightFoot: { ...base.joints.rightFoot, y: -0.18 },
    });
    const lowPose = solveStickFigurePose(targets, base, undefined);
    useEditorStore.getState().updateCharacter(character.id, {
      stickFigurePose3D: cloneStickFigurePose(lowPose),
    });
    useEditorStore.getState().snapCharacterToGround(character.id);

    const snapped = useEditorStore.getState().project.scene.characters[0];
    expect(snapped.transform3D?.position.y ?? 0).toBeCloseTo(stickGroundSnapY(snapped), 2);
  });

  it("coalesces 3D stick pose drag into a single undo stack entry", () => {
    useEditorStore.getState().setSceneMode("3d");
    useEditorStore.getState().addCharacter();
    const characterId = useEditorStore.getState().project.scene.characters[0].id;
    const hand = getCharacterStickFigurePose(useEditorStore.getState().project.scene.characters[0]).joints.leftHand;
    const undoLenBeforeDrag = useEditorStore.getState().undoStack.length;

    useEditorStore.getState().beginStickFigurePoseDrag();
    useEditorStore.getState().updateCharacterStickFigureTargets(characterId, {
      leftHand: { ...hand, x: hand.x + 0.02 },
    });
    useEditorStore.getState().updateCharacterStickFigureTargets(characterId, {
      leftHand: { ...hand, x: hand.x + 0.05 },
    });
    useEditorStore.getState().endStickFigurePoseDrag();

    expect(useEditorStore.getState().undoStack.length).toBe(undoLenBeforeDrag + 1);
  });

  it("updates 3D stick pose pole controls and re-solves the bend joint", () => {
    useEditorStore.getState().setSceneMode("3d");
    useEditorStore.getState().addCharacter();
    const characterId = useEditorStore.getState().project.scene.characters[0].id;
    const before = getCharacterStickFigurePose(useEditorStore.getState().project.scene.characters[0]);
    const pole = {
      x: before.joints.leftKnee.x - 0.2,
      y: before.joints.leftKnee.y + 0.1,
      z: before.joints.leftKnee.z + 0.6,
    };

    useEditorStore.getState().updateCharacterStickFigurePoles(characterId, {
      leftKneePole: pole,
    });

    const after = getCharacterStickFigurePose(useEditorStore.getState().project.scene.characters[0]);
    expect(after.poles?.leftKneePole).toEqual(pole);
    expect(after.joints.leftKnee.z).not.toBeCloseTo(before.joints.leftKnee.z, 4);
  });

  it("toggles 3D stick pose pole control visibility as UI state", () => {
    expect(useEditorStore.getState().showStickFigurePoleControls).toBe(true);

    useEditorStore.getState().setShowStickFigurePoleControls(false);
    expect(useEditorStore.getState().showStickFigurePoleControls).toBe(false);

    useEditorStore.getState().setShowStickFigurePoleControls(true);
    expect(useEditorStore.getState().showStickFigurePoleControls).toBe(true);
  });

  it("records separate undo entries for stick pose updates without drag coalesce", () => {
    useEditorStore.getState().setSceneMode("3d");
    useEditorStore.getState().addCharacter();
    const characterId = useEditorStore.getState().project.scene.characters[0].id;
    const hand = getCharacterStickFigurePose(useEditorStore.getState().project.scene.characters[0]).joints.leftHand;
    const undoLenBefore = useEditorStore.getState().undoStack.length;

    useEditorStore.getState().updateCharacterStickFigureTargets(characterId, {
      leftHand: { ...hand, x: hand.x + 0.02 },
    });
    useEditorStore.getState().updateCharacterStickFigureTargets(characterId, {
      leftHand: { ...hand, x: hand.x + 0.05 },
    });

    expect(useEditorStore.getState().undoStack.length).toBe(undoLenBefore + 2);
  });

  it("adds and removes prompt tags on objects and body parts", () => {
    useEditorStore.getState().addObject({
      kind: "rectangle",
      name: "路灯",
      description: "street lamp on the left",
      fill: "#facc15",
    });
    useEditorStore.getState().addCharacter();

    const object = useEditorStore.getState().project.scene.objects[0];
    const character = useEditorStore.getState().project.scene.characters[0];

    useEditorStore.getState().addPromptTag({ kind: "object", id: object.id }, testTag);
    useEditorStore.getState().addPromptTag({ kind: "object", id: object.id }, testTag);

    const objectTags = useEditorStore.getState().project.scene.objects[0].promptTags;

    expect(objectTags.filter((tag) => tag.prompt === testTag.prompt)).toHaveLength(1);

    useEditorStore
      .getState()
      .addPromptTag(
        { kind: "bodyPart", characterId: character.id, bodyPartId: "rightHand" },
        testTag,
      );

    expect(
      useEditorStore
        .getState()
        .project.scene.characters[0].bodyParts.find((bodyPart) => bodyPart.id === "rightHand")
        ?.promptTags,
    ).toEqual([expect.objectContaining({ prompt: testTag.prompt })]);

    const addedObjectTag = objectTags.find((tag) => tag.prompt === testTag.prompt);

    useEditorStore.getState().updatePromptTag(
      { kind: "object", id: object.id },
      addedObjectTag?.id ?? "",
      {
        weight: { enabled: true, value: 1.35 },
      },
    );

    expect(useEditorStore.getState().project.scene.objects[0].promptTags[0].weight).toEqual({
      enabled: true,
      value: 1.35,
    });

    useEditorStore
      .getState()
      .removePromptTag({ kind: "object", id: object.id }, addedObjectTag?.id ?? "");

    expect(useEditorStore.getState().project.scene.objects[0].promptTags).not.toContainEqual(
      expect.objectContaining({ prompt: testTag.prompt }),
    );
  });

  it("supports multi-select move and delete", () => {
    useEditorStore.getState().addObject({
      kind: "rectangle",
      name: "a",
      fill: "#ffffff",
    });
    useEditorStore.getState().addObject({
      kind: "rectangle",
      name: "b",
      fill: "#ffffff",
    });

    const objectsBefore = useEditorStore.getState().project.scene.objects;
    const [first, second] = objectsBefore;

    useEditorStore.getState().selectMultiple([first.id, second.id], []);

    expect(useEditorStore.getState().selection).toEqual({
      kind: "multiple",
      objectIds: [first.id, second.id],
      characterIds: [],
    });

    useEditorStore.getState().moveSelectionBy({ x: 10, y: -5 });

    const afterMove = useEditorStore.getState().project.scene.objects;
    expect(afterMove[0].position).toEqual({
      x: first.position.x + 10,
      y: first.position.y - 5,
    });
    expect(afterMove[1].position).toEqual({
      x: second.position.x + 10,
      y: second.position.y - 5,
    });

    useEditorStore.getState().deleteSelection();

    expect(useEditorStore.getState().project.scene.objects).toHaveLength(0);
    expect(useEditorStore.getState().selection.kind).toBe("scene");
  });

  it("setMultiSelectionPositions updates multiple object positions at once", () => {
    useEditorStore.getState().addObject({
      kind: "rectangle",
      name: "a",
      fill: "#ffffff",
    });
    useEditorStore.getState().addObject({
      kind: "rectangle",
      name: "b",
      fill: "#ffffff",
    });

    const [first, second] = useEditorStore.getState().project.scene.objects;
    useEditorStore.getState().selectMultiple([first.id, second.id], []);

    useEditorStore.getState().setMultiSelectionPositions({
      objects: {
        [first.id]: { x: 100, y: 200 },
        [second.id]: { x: 300, y: 400 },
      },
      characters: {},
    });

    const objs = useEditorStore.getState().project.scene.objects;
    expect(objs.find((o) => o.id === first.id)?.position).toEqual({ x: 100, y: 200 });
    expect(objs.find((o) => o.id === second.id)?.position).toEqual({ x: 300, y: 400 });
  });

  it("normalizes selectMultiple to single-object selection when only one id", () => {
    useEditorStore.getState().addObject({
      kind: "rectangle",
      name: "solo",
      fill: "#ffffff",
    });

    const objectId = useEditorStore.getState().project.scene.objects[0].id;

    useEditorStore.getState().selectMultiple([objectId], []);

    expect(useEditorStore.getState().selection).toEqual({ kind: "object", id: objectId });
  });

  it("ctrl-style toggle merges and splits multi-selection", () => {
    useEditorStore.getState().addObject({
      kind: "rectangle",
      name: "a",
      fill: "#ffffff",
    });
    useEditorStore.getState().addObject({
      kind: "rectangle",
      name: "b",
      fill: "#ffffff",
    });

    const [a, b] = useEditorStore.getState().project.scene.objects;

    useEditorStore.getState().selectObject(a.id);
    useEditorStore.getState().toggleObjectInSelection(b.id);

    expect(useEditorStore.getState().selection).toEqual({
      kind: "multiple",
      objectIds: [a.id, b.id],
      characterIds: [],
    });

    useEditorStore.getState().toggleObjectInSelection(a.id);

    expect(useEditorStore.getState().selection).toEqual({ kind: "object", id: b.id });
  });

  it("drops 3D-only selection when switching to 2D mode", () => {
    useEditorStore.getState().setSceneMode("3d");
    useEditorStore.getState().addObject({
      kind: "cube",
      name: "立方体",
      fill: "#60a5fa",
    });
    const cubeId = useEditorStore.getState().project.scene.objects[0]?.id;
    expect(cubeId).toBeDefined();
    if (!cubeId) {
      throw new Error("Expected cube.");
    }

    useEditorStore.getState().selectObject(cubeId);
    useEditorStore.getState().setSceneMode("2d");

    expect(useEditorStore.getState().selection).toEqual({ kind: "scene" });
  });

  it("drops 2D-only selection when switching to 3D mode", () => {
    useEditorStore.getState().addObject({
      kind: "rectangle",
      name: "rect",
      fill: "#ffffff",
    });
    const rectId = useEditorStore.getState().project.scene.objects[0]?.id;
    expect(rectId).toBeDefined();
    if (!rectId) {
      throw new Error("Expected rectangle.");
    }

    useEditorStore.getState().selectObject(rectId);
    useEditorStore.getState().setSceneMode("3d");

    expect(useEditorStore.getState().selection).toEqual({ kind: "scene" });
  });

  it("rejects selectObject when object is not on the active viewport", () => {
    useEditorStore.getState().setSceneMode("3d");
    useEditorStore.getState().addObject({
      kind: "rectangle",
      name: "rect",
      fill: "#ffffff",
    });
    const rectId = useEditorStore.getState().project.scene.objects[0]?.id;
    expect(rectId).toBeDefined();
    if (!rectId) {
      throw new Error("Expected rectangle.");
    }

    useEditorStore.getState().selectObject(rectId);

    expect(useEditorStore.getState().selection).toEqual({ kind: "scene" });
  });
});
