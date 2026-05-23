import { describe, expect, it } from "vitest";

import {
  formatArtistStringForPlatform,
  formatNovelAiArtistString,
  formatWeightedNovelAiArtistString,
  parseNovelAiArtistString,
} from "./novelai-artist-string";

describe("NovelAI artist string parsing", () => {
  it("parses plain tags and artist-prefixed tags", () => {
    const ast = parseNovelAiArtistString("naga_u, artist:berryverrine, year 2023,");

    expect(ast.nodes).toMatchObject([
      { type: "tag", text: "naga_u", artistPrefix: false },
      { type: "tag", text: "berryverrine", artistPrefix: true },
      { type: "tag", text: "year 2023", artistPrefix: false },
    ]);
    expect(formatNovelAiArtistString(ast)).toBe("naga_u,artist:berryverrine,year 2023");
  });

  it("parses explicit artist and by-prefix weights", () => {
    const ast = parseNovelAiArtistString("(artist:torino aqua:0.8), by torino aqua:0.8");

    expect(ast.nodes).toMatchObject([
      { type: "tag", text: "torino aqua", artistPrefix: true, artistSyntax: "artist-prefix", weight: 0.8 },
      { type: "tag", text: "torino aqua", artistPrefix: false, artistSyntax: "by-prefix", weight: 0.8 },
    ]);
    expect(formatWeightedNovelAiArtistString(ast)).toBe(
      "(artist:torino aqua:0.8),(artist:torino aqua:0.8)",
    );
    expect(formatWeightedNovelAiArtistString(ast, { artistReferenceSyntax: "by-prefix" })).toBe(
      "by torino aqua:0.8,by torino aqua:0.8",
    );
    expect(formatWeightedNovelAiArtistString(ast, { artistReferenceSyntax: "preserve" })).toBe(
      "(artist:torino aqua:0.8),by torino aqua:0.8",
    );
  });

  it("converts structured artist references to artist-prefix or by-prefix weighted syntax", () => {
    const ast = parseNovelAiArtistString("[artist:torino aqua,{artist:ask}]");

    expect(formatWeightedNovelAiArtistString(ast, { artistReferenceSyntax: "artist-prefix" })).toBe(
      "(artist:torino aqua:0.9),artist:ask",
    );
    expect(formatWeightedNovelAiArtistString(ast, { artistReferenceSyntax: "by-prefix" })).toBe(
      "by torino aqua:0.9,by ask",
    );
  });

  it("preserves nested NovelAI emphasis groups", () => {
    const ast = parseNovelAiArtistString(
      "{mafuyu (chibi21)},{{rurudo,gusha s}},[[murata range]]",
    );

    expect(formatNovelAiArtistString(ast)).toBe(
      "{mafuyu (chibi21)},{{rurudo,gusha s}},[[murata range]]",
    );
    expect(formatWeightedNovelAiArtistString(ast)).toBe(
      "(mafuyu (chibi21):1.1),(rurudo:1.2),(gusha s:1.2),(murata range:0.8)",
    );
  });

  it("parses mixed nested groups", () => {
    const ast = parseNovelAiArtistString(
      "[artist:eip_pepai,[nekojira,[[rucaco, wlop, ciloranko]]]]",
    );

    expect(formatArtistStringForPlatform(ast, "novelai")).toBe(
      "(artist:eip_pepai:0.9),(nekojira:0.8),(rucaco:0.6),(wlop:0.6),(ciloranko:0.6)",
    );
  });

  it("formats platform prompts with all supported render modes", () => {
    const ast = parseNovelAiArtistString("[artist:torino aqua,{artist:ask}]");

    expect(formatArtistStringForPlatform(ast, "novelai", { renderMode: "novelai" })).toBe(
      "[artist:torino aqua,{artist:ask}]",
    );
    expect(formatArtistStringForPlatform(ast, "novelai", { renderMode: "artist-weight" })).toBe(
      "(artist:torino aqua:0.9),artist:ask",
    );
    expect(formatArtistStringForPlatform(ast, "novelai", { renderMode: "by-weight" })).toBe(
      "by torino aqua:0.9,by ask",
    );
  });

  it("keeps malformed unclosed groups structured and reports warnings", () => {
    const ast = parseNovelAiArtistString("[artist:kedama milk,[[artist:sho_(sho_lwlw)]");

    expect(ast.warnings.length).toBeGreaterThan(0);
    expect(formatNovelAiArtistString(ast)).toBe("[artist:kedama milk,[[artist:sho_(sho_lwlw)]]]");
  });

  it("records unexpected top-level closing tokens as raw nodes", () => {
    const ast = parseNovelAiArtistString("artist:foo],bar");

    expect(ast.warnings.length).toBeGreaterThan(0);
    expect(formatNovelAiArtistString(ast)).toBe("artist:foo,],bar");
  });
});
