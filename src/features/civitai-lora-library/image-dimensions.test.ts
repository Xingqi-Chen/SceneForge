import { describe, expect, it } from "vitest";

import { extractCivitaiExampleImageDimensions } from "./image-dimensions";

describe("Civitai image dimensions", () => {
  it("summarizes official example image dimensions by frequency", () => {
    expect(extractCivitaiExampleImageDimensions([
      { width: 896, height: 1152 },
      { width: 1152, height: 896 },
      { width: 896, height: 1152 },
      { width: 1024, height: 1024 },
      { width: "bad", height: 1024 },
    ])).toEqual([
      "896x1152 (2 examples)",
      "1152x896",
      "1024x1024",
    ]);
  });
});
