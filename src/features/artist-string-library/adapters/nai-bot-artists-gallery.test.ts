import { describe, expect, it } from "vitest";

import { parseNaiBotArtistsGalleryHtml } from "./nai-bot-artists-gallery";

describe("nai-bot artists gallery adapter", () => {
  it("parses gallery rows into structured NovelAI artist strings", () => {
    const html = `
      <span>总计: 433 个画风组合</span><span>更新时间: 2025/9/6</span>
      <table><tbody>
        <tr class="artist-row astro">
          <td class="sequence astro"> 000 </td>
          <td class="artist-name astro">
            <span class="artist-text copyable astro">{mafuyu (chibi21)},{{rurudo,gusha s}},[[murata range]],</span>
          </td>
          <td><img src="/assets/300_artists/artist_000/img_1.webp" alt="000 - SMEA False"></td>
          <td><img src="/assets/300_artists/artist_000/img_2.webp" alt="000 - SMEA True"></td>
          <td><img src="/assets/300_artists/artist_000/img_3.webp" alt="000 - bikini style"></td>
        </tr>
        <tr class="artist-row astro">
          <td class="sequence astro"> 268 </td>
          <td><span class="artist-text copyable astro">artist:wlop, year_2023,</span></td>
          <td><img src="/assets/300_artists/artist_268/img_1.webp" alt="268 - SMEA False"></td>
        </tr>
      </tbody></table>
    `;

    const result = parseNaiBotArtistsGalleryHtml(html, "https://nai-bot.pages.dev/%E6%B3%95%E5%85%B8/artists-gallery/");

    expect(result.platform.sourceUpdatedAtText).toBe("2025/9/6");
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      sourceSequence: 0,
      categoryKey: "independent",
      promptFormat: "novelai",
      parseStatus: "parsed",
      formattedPrompt: "(mafuyu (chibi21):1.1),(rurudo:1.2),(gusha s:1.2),(murata range:0.8)",
    });
    expect(result.items[0]?.referenceImages.map((image) => image.role)).toEqual([
      "SMEA False",
      "SMEA True",
      "bikini style",
    ]);
    expect(result.items[0]?.referenceImages[0]?.sourceUrl).toBe(
      "https://nai-bot.pages.dev/assets/300_artists/artist_000/img_1.webp",
    );
    expect(result.items[1]).toMatchObject({
      sourceSequence: 268,
      categoryKey: "wlop",
      formattedPrompt: "artist:wlop,year_2023",
    });
  });
});
