// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import type { CharacterSkeleton, Scene } from "@/shared/types";

import { createDefaultScene, defaultCharacter } from "@/features/editor/store/defaults";

import { renderComfyUiNormalControlImage } from "./comfyui-normal-control-image";

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

describe("ComfyUI normal ControlNet image rendering", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is unavailable outside 3D scene mode", async () => {
    const result = await renderComfyUiNormalControlImage(createDefaultScene(), { width: 512, height: 512 });

    expect(result.available).toBe(false);
    expect(result.reason).toBe("scene-not-3d");
    expect(result.imageDataUrl).toBeNull();
  });

  it("is unavailable when a 3D scene has no visible 3D characters", async () => {
    const result = await renderComfyUiNormalControlImage(make3dScene(), { width: 512, height: 512 });

    expect(result.available).toBe(false);
    expect(result.reason).toBe("no-3d-characters");
    expect(result.characterCount).toBe(0);
  });

  it("renders a PNG data URL for visible 3D characters with an offscreen renderer", async () => {
    const render = vi.fn();
    const setSize = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,ZmFrZQ==");

    const result = await renderComfyUiNormalControlImage(
      make3dScene([makeCharacter("left", -0.3), makeCharacter("right", 0.3)]),
      {
        width: 768,
        height: 1152,
        createRenderer: () => ({
          dispose: vi.fn(),
          forceContextLoss: vi.fn(),
          render,
          setClearColor: vi.fn(),
          setPixelRatio: vi.fn(),
          setSize,
        }),
      },
    );

    expect(result.available).toBe(true);
    expect(result.characterCount).toBe(2);
    expect(result.width).toBe(768);
    expect(result.height).toBe(1152);
    expect(result.imageDataUrl).toBe("data:image/png;base64,ZmFrZQ==");
    expect(setSize).toHaveBeenCalledWith(768, 1152, false);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("returns a clear unavailable result when WebGL rendering fails", async () => {
    const result = await renderComfyUiNormalControlImage(
      make3dScene([makeCharacter("hero", 0)]),
      {
        width: 512,
        height: 512,
        createRenderer: () => {
          throw new Error("Error creating WebGL context.");
        },
      },
    );

    expect(result.available).toBe(false);
    expect(result.reason).toBe("webgl-unavailable");
    expect(result.error).toContain("WebGL");
    expect(result.imageDataUrl).toBeNull();
  });
});
