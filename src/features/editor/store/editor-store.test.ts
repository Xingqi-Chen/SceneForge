import { beforeEach, describe, expect, it } from "vitest";

import type { PromptTag } from "@/shared/types";

import { createDefaultProject } from "./defaults";
import { useEditorStore } from "./editor-store";

const testTag: PromptTag = {
  id: "tag-test",
  label: "测试标签",
  prompt: "dramatic rim light",
  category: "lighting",
  weight: { enabled: false, value: 1 },
};

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

  it("moves the selected object forward and backward by swapping layers", () => {
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
    });
  });

  it("adds a character and updates a joint", () => {
    const initialCharacterCount = useEditorStore.getState().project.scene.characters.length;

    useEditorStore.getState().addCharacter();

    const { project, selection } = useEditorStore.getState();
    const character = project.scene.characters.at(-1);

    expect(project.scene.characters).toHaveLength(initialCharacterCount + 1);
    expect(selection).toEqual({ kind: "character", id: character?.id });

    useEditorStore.getState().updateCharacterJoint(character?.id ?? "", "leftWrist", {
      x: -96,
      y: 150,
    });

    expect(useEditorStore.getState().project.scene.characters.at(-1)?.joints.leftWrist).toEqual({
      x: -96,
      y: 150,
    });
  });

  it("duplicates, moves, and deletes the selected character", () => {
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

  it("adds and removes prompt tags on objects and body parts", () => {
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

    useEditorStore
      .getState()
      .removePromptTag({ kind: "object", id: object.id }, addedObjectTag?.id ?? "");

    expect(useEditorStore.getState().project.scene.objects[0].promptTags).not.toContainEqual(
      expect.objectContaining({ prompt: testTag.prompt }),
    );
  });
});
