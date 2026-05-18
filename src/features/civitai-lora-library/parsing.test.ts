import { describe, expect, it } from "vitest";

import { parseCivitaiImageIdFromUrl, parseLoraWeightsFromPrompt } from "./parsing";

describe("Civitai parsing helpers", () => {
  it("parses Civitai image ids from supported inputs", () => {
    expect(parseCivitaiImageIdFromUrl("https://civitai.com/images/29900440")).toBe(29900440);
    expect(parseCivitaiImageIdFromUrl("https://www.civitai.com/images/29900440?foo=bar")).toBe(29900440);
    expect(parseCivitaiImageIdFromUrl("29900440")).toBe(29900440);
  });

  it("rejects non-Civitai image urls", () => {
    expect(parseCivitaiImageIdFromUrl("https://example.com/images/29900440")).toBeNull();
    expect(parseCivitaiImageIdFromUrl("https://civitai.com/models/29900440")).toBeNull();
    expect(parseCivitaiImageIdFromUrl("not a url")).toBeNull();
  });

  it("extracts LoRA prompt weights", () => {
    expect(
      parseLoraWeightsFromPrompt(
        "masterpiece, <lora:绪儿 光影滤镜 XUER guangying:0.8>, <lora:style test:-1.25>, <lora:no weight>",
      ),
    ).toEqual([
      { name: "绪儿 光影滤镜 XUER guangying", weight: 0.8, raw: "<lora:绪儿 光影滤镜 XUER guangying:0.8>" },
      { name: "style test", weight: -1.25, raw: "<lora:style test:-1.25>" },
      { name: "no weight", weight: null, raw: "<lora:no weight>" },
    ]);
  });
});
