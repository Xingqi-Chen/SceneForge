import { beforeEach, describe, expect, it } from "vitest";

import { createDefaultProject } from "./defaults";
import { useEditorStore } from "./editor-store";

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
});
