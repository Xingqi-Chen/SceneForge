import { describe, expect, it } from "vitest";

import {
  getKrea2PreviewDimensions,
  isValidKrea2FormalDimensions,
  normalizeKrea2AiDimensions,
} from "./preview-dimensions";

describe("Krea AI dimension normalization", () => {
  it("normalizes the live portrait regression to an exact-aspect eligible Preview", () => {
    expect(getKrea2PreviewDimensions(1328, 1952)).toBeNull();
    const normalized = normalizeKrea2AiDimensions(1328, 1952);

    expect(normalized).toEqual({ width: 1344, height: 1968 });
    expect(getKrea2PreviewDimensions(normalized!.width, normalized!.height)).toEqual({
      width: 448,
      height: 656,
    });
  });

  it.each([
    [1216, 832, 1216, 832],
    [1952, 1328, 1968, 1344],
    [1000, 1024, 992, 1024],
    [997, 991, 992, 992],
    [20_000, 20_000, 16_384, 16_384],
    [1, 1, 16, 16],
  ])("maps %ix%i deterministically to feasible %ix%i", (
    advisedWidth,
    advisedHeight,
    expectedWidth,
    expectedHeight,
  ) => {
    const normalized = normalizeKrea2AiDimensions(advisedWidth, advisedHeight);

    expect(normalized).toEqual({ width: expectedWidth, height: expectedHeight });
    expect(isValidKrea2FormalDimensions(normalized!.width, normalized!.height)).toBe(true);
    const preview = getKrea2PreviewDimensions(normalized!.width, normalized!.height);
    expect(preview).not.toBeNull();
    expect(preview!.width * normalized!.height).toBe(preview!.height * normalized!.width);
    expect(preview!.width % 16).toBe(0);
    expect(preview!.height % 16).toBe(0);
    expect(Math.max(preview!.width, preview!.height)).toBeLessThanOrEqual(768);
  });

  it("uses the specified aspect and area tie-breaks", () => {
    expect(normalizeKrea2AiDimensions(24, 16)).toEqual({ width: 32, height: 16 });
    expect(normalizeKrea2AiDimensions(24, 24)).toEqual({ width: 16, height: 16 });
  });

  it.each([
    [0, 1024],
    [-16, 1024],
    [1024, 0],
    [1024, -16],
    [1024.5, 1024],
    [Number.NaN, 1024],
    [Number.POSITIVE_INFINITY, 1024],
  ])("does not fabricate dimensions from invalid advice %sx%s", (width, height) => {
    expect(normalizeKrea2AiDimensions(width, height)).toBeNull();
  });
});
