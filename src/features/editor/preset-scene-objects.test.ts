import { describe, expect, it } from "vitest";

import { presetSceneObject3DScale } from "./preset-scene-objects";

describe("presetSceneObject3DScale", () => {
  it("maps layout pixels to positive world scales", () => {
    const s = presetSceneObject3DScale({ width: 200, height: 80 });
    expect(s.x).toBeCloseTo(2, 5);
    expect(s.y).toBeCloseTo(0.8, 5);
    expect(s.z).toBeGreaterThan(0.1);
  });

  it("clamps very small presets", () => {
    const s = presetSceneObject3DScale({ width: 4, height: 4 });
    expect(s.x).toBeGreaterThanOrEqual(0.08);
    expect(s.y).toBeGreaterThanOrEqual(0.08);
  });
});
