// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const documents = [
  "README.md",
  "docs/product-spec.md",
  "docs/tech-spec.md",
] as const;

describe("Krea2 ReID documentation contract", () => {
  it.each(documents)("documents the baseline v3 and active-ReID v5 branches in %s", async (filename) => {
    const text = await fs.readFile(path.join(process.cwd(), filename), "utf8");

    expect(text).toMatch(/Krea[^\n]{0,500}policy v3|policy v3[^\n]{0,500}Krea/i);
    expect(text).toMatch(/ReID[^\n]{0,500}policy v5|policy v5[^\n]{0,500}ReID/i);
    for (const line of text.split(/\r?\n/).filter((candidate) => /Verified setup/i.test(candidate))) {
      expect(line).toMatch(/no (?:separate )?Verified setup|without (?:a )?Verified setup/i);
    }
    expect(text).toMatch(/Experimental/i);
  });

  it.each(documents)("keeps metadata-valid FP8/RedCraft ReID Experimental rather than resource-gated in %s", async (filename) => {
    const text = await fs.readFile(path.join(process.cwd(), filename), "utf8");

    expect(text).not.toMatch(/FP8[^\n]{0,200}(?:block|unsupported|cannot (?:prepare|run) ReID)/i);
    expect(text).not.toMatch(/RedCraft[^\n]{0,200}(?:block|unsupported|cannot (?:prepare|run) ReID)/i);
  });

  it("does not retain the superseded Krea dual-role image2 workflow as an active contract", async () => {
    const text = await fs.readFile(path.join(process.cwd(), "docs/tech-spec.md"), "utf8");

    expect(text).not.toMatch(/dual-reference uses `image1=style,image2=character`/i);
    expect(text).not.toMatch(/character-only uses `image1=character`/i);
  });

  it.each(documents)("never presents the Krea 4/4/6 Final presets as active-ReID behavior in %s", async (filename) => {
    const text = await fs.readFile(path.join(process.cwd(), filename), "utf8");
    const presetLines = text.split(/\r?\n/).filter((line) =>
      /without active ReID/i.test(line) &&
      /Conservative/i.test(line) &&
      /Balanced/i.test(line) &&
      /Strong/i.test(line),
    );

    expect(presetLines.length).toBeGreaterThan(0);
    for (const line of presetLines) {
      expect(line).toMatch(/Conservative[^\n]{0,120}(?:4 steps[^\n]{0,40}0\.12|4\/0\.12|steps:\s*4[^\n]{0,40}0\.12)/i);
      expect(line).toMatch(/Balanced[^\n]{0,120}(?:4 (?:steps )?at 0\.18|4\/0\.18|steps:\s*4[^\n]{0,40}0\.18)/i);
      expect(line).toMatch(/Strong[^\n]{0,120}(?:6 (?:steps )?at 0\.28|6\/0\.28|steps:\s*6[^\n]{0,40}0\.28)/i);
    }
  });
});
