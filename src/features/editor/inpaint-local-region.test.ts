import { describe, expect, it } from "vitest";

import {
  findMaskAlphaBounds,
  padAndAlignLocalRegion,
  resolveInpaintLocalRegion,
} from "./inpaint-local-region";

function makeMask(width: number, height: number, points: Array<[number, number]>) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (const [x, y] of points) {
    data[(y * width + x) * 4 + 3] = 255;
  }

  return {
    data,
    width,
    height,
  };
}

describe("inpaint local region helpers", () => {
  it("finds mask alpha bounds", () => {
    expect(findMaskAlphaBounds(makeMask(16, 12, [[4, 3], [9, 7]]))).toEqual({
      x: 4,
      y: 3,
      width: 6,
      height: 5,
    });
  });

  it("prefers a box over mask bounds", () => {
    const region = resolveInpaintLocalRegion({
      box: {
        x: 20,
        y: 12,
        width: 20,
        height: 18,
      },
      feather: 32,
      mask: makeMask(128, 96, [[2, 2], [3, 3]]),
      padding: 8,
      sourceSize: {
        width: 128,
        height: 96,
      },
    });

    expect(region).toMatchObject({
      x: 8,
      y: 0,
      width: 40,
      height: 40,
      source: "box",
      padding: 8,
      feather: 32,
    });
  });

  it("pads, clamps, and aligns regions to image bounds", () => {
    expect(
      padAndAlignLocalRegion(
        {
          x: 5,
          y: 7,
          width: 10,
          height: 11,
        },
        {
          width: 64,
          height: 64,
        },
        9,
        8,
      ),
    ).toEqual({
      x: 0,
      y: 0,
      width: 24,
      height: 32,
    });
  });

  it("returns null when no mask and no box are available", () => {
    expect(
      resolveInpaintLocalRegion({
        feather: 16,
        mask: makeMask(32, 32, []),
        padding: 16,
        sourceSize: {
          width: 32,
          height: 32,
        },
      }),
    ).toBeNull();
  });
});
