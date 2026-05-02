import { describe, expect, it } from "vitest";

import type { CharacterSkeleton } from "@/shared/types";

import { characterAppearsInThreeViewport, characterAppearsOn2dCanvas } from "./character-space";

const base = { id: "c1" } as CharacterSkeleton;

describe("character-space", () => {
  it("treats missing characterSpace as visible on both viewports", () => {
    expect(characterAppearsOn2dCanvas(base)).toBe(true);
    expect(characterAppearsInThreeViewport(base)).toBe(true);
  });

  it("isolates explicit 3D characters from the 2D canvas", () => {
    const c = { ...base, characterSpace: "3d" as const };
    expect(characterAppearsOn2dCanvas(c)).toBe(false);
    expect(characterAppearsInThreeViewport(c)).toBe(true);
  });

  it("isolates explicit 2D characters from the Three viewport", () => {
    const c = { ...base, characterSpace: "2d" as const };
    expect(characterAppearsOn2dCanvas(c)).toBe(true);
    expect(characterAppearsInThreeViewport(c)).toBe(false);
  });
});
