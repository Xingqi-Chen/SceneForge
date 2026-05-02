import { describe, expect, it } from "vitest";

import { computeWorldBounds, snapTransformToGround } from "./three-placement";

describe("three-placement", () => {
  it("snapTransformToGround aligns world AABB min.y to 0 for axis-aligned cube", () => {
    const t = snapTransformToGround(
      "cube",
      {
        position: { x: 0, y: 2, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
    );

    const b = computeWorldBounds("cube", t);
    expect(b.min.y).toBeCloseTo(0, 5);
    expect(t.position.x).toBeCloseTo(0, 5);
    expect(t.position.z).toBeCloseTo(0, 5);
  });

  it("does not shift X/Z when grounding", () => {
    const t = snapTransformToGround(
      "cube",
      {
        position: { x: 1.25, y: 2, z: -3.4 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
    );

    expect(t.position.x).toBeCloseTo(1.25, 5);
    expect(t.position.z).toBeCloseTo(-3.4, 5);
    expect(computeWorldBounds("cube", t).min.y).toBeCloseTo(0, 5);
  });

  it("grounds rotated primitives using their world bounds", () => {
    const t = snapTransformToGround("cylinder", {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 45 },
      scale: { x: 1, y: 1, z: 1 },
    });

    expect(computeWorldBounds("cylinder", t).min.y).toBeCloseTo(0, 5);
  });

  it("grounds planes with the same baseline rotation as the viewport", () => {
    const t = snapTransformToGround("plane", {
      position: { x: 0, y: -2, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 2, y: 1, z: 2 },
    });

    expect(computeWorldBounds("plane", t).min.y).toBeCloseTo(0, 5);
  });

  it("grounds preset placeholders like unit cubes", () => {
    const t = snapTransformToGround("preset", {
      position: { x: 0, y: 1, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 2, y: 1, z: 0.5 },
    });

    expect(computeWorldBounds("preset", t).min.y).toBeCloseTo(0, 5);
  });
});
