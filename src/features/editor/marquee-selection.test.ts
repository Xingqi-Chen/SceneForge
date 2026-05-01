import { describe, expect, it } from "vitest";

import type { SceneObject } from "@/shared/types";

import {
  boundsIntersect,
  collectMarqueeSelection,
  getObjectWorldBounds,
  normalizeMarqueeRect,
} from "./marquee-selection";

describe("marquee-selection", () => {
  it("normalizes marquee corners", () => {
    expect(normalizeMarqueeRect(10, 10, 0, 0)).toEqual({
      left: 0,
      top: 0,
      right: 10,
      bottom: 10,
    });
  });

  it("detects intersection", () => {
    const a = { left: 0, top: 0, right: 10, bottom: 10 };
    const b = { left: 8, top: 8, right: 20, bottom: 20 };
    const c = { left: 100, top: 100, right: 110, bottom: 110 };
    expect(boundsIntersect(a, b)).toBe(true);
    expect(boundsIntersect(a, c)).toBe(false);
  });

  it("uses rotated AABB for scene objects", () => {
    const object: SceneObject = {
      id: "o1",
      kind: "rectangle",
      name: "r",
      description: "",
      position: { x: 100, y: 100 },
      size: { width: 40, height: 20 },
      rotation: 45,
      layer: 1,
      fill: "#000",
      includeInPrompt: true,
      weight: { enabled: false, value: 1 },
      promptTags: [],
    };
    const bounds = getObjectWorldBounds(object);
    expect(bounds.right - bounds.left).toBeGreaterThan(40);
    expect(bounds.bottom - bounds.top).toBeGreaterThan(20);
  });

  it("collects objects overlapping marquee", () => {
    const objects: SceneObject[] = [
      {
        id: "a",
        kind: "rectangle",
        name: "",
        description: "",
        position: { x: 50, y: 50 },
        size: { width: 40, height: 40 },
        rotation: 0,
        layer: 0,
        fill: "#fff",
        includeInPrompt: true,
        weight: { enabled: false, value: 1 },
        promptTags: [],
      },
      {
        id: "b",
        kind: "rectangle",
        name: "",
        description: "",
        position: { x: 400, y: 400 },
        size: { width: 40, height: 40 },
        rotation: 0,
        layer: 1,
        fill: "#fff",
        includeInPrompt: true,
        weight: { enabled: false, value: 1 },
        promptTags: [],
      },
    ];
    const marquee = { left: 0, top: 0, right: 200, bottom: 200 };
    const result = collectMarqueeSelection(objects, [], marquee);
    expect(result.objectIds).toEqual(["a"]);
    expect(result.characterIds).toEqual([]);
  });
});
