import { describe, expect, it } from "vitest";

import { getCivitaiImageVariantUrl } from "./image-url";

describe("Civitai image URL variants", () => {
  it("uses width variants for original Civitai image URLs", () => {
    expect(
      getCivitaiImageVariantUrl(
        "https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/320ab95c/original=true/44214657.jpeg",
        512,
      ),
    ).toBe("https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/320ab95c/width=512/44214657.jpeg");
  });

  it("replaces existing width variants without changing non-Civitai URLs", () => {
    expect(
      getCivitaiImageVariantUrl(
        "https://imagecache.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/320ab95c/width=1024,metadata=keep/44214657.jpeg",
        512,
      ),
    ).toBe("https://imagecache.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/320ab95c/width=512/44214657.jpeg");
    expect(getCivitaiImageVariantUrl("https://example.com/image/original=true/file.jpeg", 512)).toBeNull();
  });
});
