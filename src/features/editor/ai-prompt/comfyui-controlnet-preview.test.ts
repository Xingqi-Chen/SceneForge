import { describe, expect, it } from "vitest";

import type { CharacterSkeleton, Scene } from "@/shared/types";

import { createDefaultScene, defaultCharacter } from "@/features/editor/store/defaults";

import { buildComfyUiControlNetOpenPosePreview } from "./comfyui-controlnet-preview";

function make3dScene(characters: CharacterSkeleton[] = []): Scene {
  return {
    ...createDefaultScene(),
    mode: "3d",
    characters,
    three: {
      ...createDefaultScene().three,
      camera: {
        position: { x: 0, y: 1.15, z: 5 },
        target: { x: 0, y: 1.05, z: 0 },
        fov: 45,
      },
    },
  };
}

function makeCharacter(id: string, x: number): CharacterSkeleton {
  return {
    ...defaultCharacter,
    id,
    characterSpace: "3d",
    transform3D: {
      position: { x, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
  };
}

describe("ComfyUI ControlNet OpenPose preview", () => {
  it("is unavailable outside 3D scene mode", () => {
    const scene = createDefaultScene();
    const result = buildComfyUiControlNetOpenPosePreview(scene, { width: 512, height: 512 });

    expect(result.available).toBe(false);
    expect(result.reason).toBe("scene-not-3d");
    expect(result.svg).toBeNull();
    expect(result.depth.svg).toBeNull();
  });

  it("is unavailable when a 3D scene has no visible 3D characters", () => {
    const result = buildComfyUiControlNetOpenPosePreview(make3dScene(), { width: 512, height: 512 });

    expect(result.available).toBe(false);
    expect(result.reason).toBe("no-3d-characters");
    expect(result.characterCount).toBe(0);
  });

  it("returns OpenPose and Depth SVGs for one visible 3D character", () => {
    const result = buildComfyUiControlNetOpenPosePreview(
      make3dScene([makeCharacter("hero", 0)]),
      { width: 512, height: 512 },
    );

    expect(result.available).toBe(true);
    expect(result.characterCount).toBe(1);
    expect(result.visibleSkeletonCount).toBe(1);
    expect(result.svg).toContain("<svg");
    expect(result.svg).toContain("<line ");
    expect(result.openPose.svg).toContain("<line ");
    expect(result.depth.svg).toContain("<line ");
    expect(result.depth.depthRange).not.toBeNull();
  });

  it("composes multiple visible 3D characters into one OpenPose and Depth SVG", () => {
    const result = buildComfyUiControlNetOpenPosePreview(
      make3dScene([makeCharacter("left", -0.35), makeCharacter("right", 0.35)]),
      { width: 512, height: 512 },
    );

    expect(result.available).toBe(true);
    expect(result.characterCount).toBe(2);
    expect(result.skeletons.map((skeleton) => skeleton.id)).toEqual(["left", "right"]);
    expect(result.visibleSkeletonCount).toBe(2);
    expect(result.openPose.skeletons.map((skeleton) => skeleton.id)).toEqual(["left", "right"]);
    expect(result.depth.skeletons.map((skeleton) => skeleton.id)).toEqual(["left", "right"]);
    expect(result.depth.visibleSkeletonCount).toBe(2);
  });

  it("uses the requested generation dimensions for the preview SVG", () => {
    const result = buildComfyUiControlNetOpenPosePreview(
      make3dScene([makeCharacter("hero", 0)]),
      { width: 768, height: 1152 },
    );

    expect(result.width).toBe(768);
    expect(result.height).toBe(1152);
    expect(result.svg).toContain('width="768"');
    expect(result.svg).toContain('height="1152"');
    expect(result.svg).toContain('viewBox="0 0 768 1152"');
    expect(result.depth.svg).toContain('width="768"');
    expect(result.depth.svg).toContain('height="1152"');
    expect(result.depth.svg).toContain('viewBox="0 0 768 1152"');
  });
});
