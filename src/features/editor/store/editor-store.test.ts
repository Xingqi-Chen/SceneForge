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
