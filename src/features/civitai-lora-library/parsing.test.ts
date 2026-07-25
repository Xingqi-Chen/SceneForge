import { describe, expect, it } from "vitest";

import { parseCivitaiImageIdFromUrl, parseLoraWeightsFromPrompt } from "./parsing";

describe("Civitai parsing helpers", () => {
  it.each([
    ["https://civitai.com/images/29900440", 29900440],
    ["https://www.civitai.com/images/29900440?foo=bar#preview", 29900440],
    ["https://civitai.red/images/135795968", 135795968],
    ["http://www.civitai.red/images/42?foo=bar#preview", 42],
    ["29900440", 29900440],
    ["  7  ", 7],
    [String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER],
  ])("parses supported Civitai image input %s", (input, expectedImageId) => {
    expect(parseCivitaiImageIdFromUrl(input)).toBe(expectedImageId);
  });

  it.each([
    "https://example.com/images/29900440",
    "https://civitai.red.example.com/images/29900440",
    "https://images.civitai.red/images/29900440",
    "https://civitai.com.evil.test/images/29900440",
    "https://civitai.red@evil.test/images/29900440",
    "https://civitai.com/models/29900440",
    "https://civitai.red/posts/29900440",
    "https://civitai.red/foo/images/29900440",
    "https://civitai.red/images/29900440/extra",
    "https://civitai.red/images",
    "ftp://civitai.red/images/29900440",
    "file://civitai.red/images/29900440",
    "not a url",
    "0",
    "-1",
    "1.5",
    String(Number.MAX_SAFE_INTEGER + 1),
    "https://civitai.red/images/0",
    "https://civitai.red/images/-1",
    `https://civitai.red/images/${Number.MAX_SAFE_INTEGER + 1}`,
  ])("rejects unsupported or unsafe Civitai image input %s", (input) => {
    expect(parseCivitaiImageIdFromUrl(input)).toBeNull();
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
