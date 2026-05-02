import { describe, expect, it } from "vitest";

import { isThreeDViewportPrimitive, sceneObjectsVisibleOn2DCanvas } from "./scene-viewport-objects";
import type { SceneObject } from "@/shared/types";

function makeRect(id: string): SceneObject {
  return {
    id,
    kind: "rectangle",
    name: "r",
    description: "",
    position: { x: 0, y: 0 },
    size: { width: 10, height: 10 },
    rotation: 0,
    layer: 0,
    fill: "#000",
    includeInPrompt: true,
    weight: { enabled: false, value: 1 },
    promptTags: [],
  };
}

function makePrimitive(id: string, kind: "cube" | "sphere" | "cylinder" | "plane"): SceneObject {
  return {
    ...makeRect(id),
    id,
    kind,
    name: kind,
    transform3D: {
      position: { x: 0, y: 0.5, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
  };
}

function makePreset3d(id: string): SceneObject {
  return {
    ...makeRect(id),
    id,
    kind: "preset",
    name: "desk",
    presetKey: "preset-table",
    transform3D: {
      position: { x: 0, y: 0.5, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 2, y: 0.8, z: 0.5 },
    },
  };
}

describe("scene-viewport-objects", () => {
  it("flags 3D primitives with transform3D", () => {
    expect(isThreeDViewportPrimitive(makePrimitive("cube", "cube"))).toBe(true);
    expect(isThreeDViewportPrimitive(makePrimitive("sphere", "sphere"))).toBe(true);
    expect(isThreeDViewportPrimitive(makePrimitive("cylinder", "cylinder"))).toBe(true);
    expect(isThreeDViewportPrimitive(makePrimitive("plane", "plane"))).toBe(true);
    expect(isThreeDViewportPrimitive(makePreset3d("preset-a"))).toBe(true);
    expect(isThreeDViewportPrimitive(makeRect("b"))).toBe(false);
  });

  it("does not treat primitive kinds as 3D without transform3D", () => {
    const planeWithoutTransform = { ...makeRect("p"), kind: "plane" as const };

    expect(isThreeDViewportPrimitive(planeWithoutTransform)).toBe(false);
  });

  it("excludes 3D primitives from 2D canvas list", () => {
    const list = sceneObjectsVisibleOn2DCanvas([
      makeRect("r"),
      makePrimitive("c", "cube"),
      makePreset3d("p"),
    ]);
    expect(list.map((o) => o.id)).toEqual(["r"]);
  });
});
