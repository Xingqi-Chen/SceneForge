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
  it.each(documents)("documents the baseline v3 and active-ReID v4 branches in %s", async (filename) => {
    const text = await fs.readFile(path.join(process.cwd(), filename), "utf8");

    expect(text).toMatch(/Krea[^\n]{0,500}policy v3|policy v3[^\n]{0,500}Krea/i);
    expect(text).toMatch(/ReID[^\n]{0,500}policy v4|policy v4[^\n]{0,500}ReID/i);
  });

  it("does not retain the superseded Krea dual-role image2 workflow as an active contract", async () => {
    const text = await fs.readFile(path.join(process.cwd(), "docs/tech-spec.md"), "utf8");

    expect(text).not.toMatch(/dual-reference uses `image1=style,image2=character`/i);
    expect(text).not.toMatch(/character-only uses `image1=character`/i);
  });

  it.each(documents)("never presents the Krea 4/4/6 Final presets as active-ReID behavior in %s", async (filename) => {
    const text = await fs.readFile(path.join(process.cwd(), filename), "utf8");
    const presetLines = text.split(/\r?\n/).filter((line) =>
      /Krea/i.test(line) &&
      /Conservative[^.\n]{0,100}4(?: steps|\/0\.12| at)/i.test(line) &&
      /Balanced[^.\n]{0,100}4(?: steps|\/0\.18| at)/i.test(line) &&
      /Strong[^.\n]{0,100}6(?: steps|\/0\.28| at)/i.test(line),
    );

    expect(presetLines.length).toBeGreaterThan(0);
    for (const line of presetLines) {
      expect(line).toMatch(/without active ReID|active ReID (?:instead )?uses policy v4/i);
    }
  });
});
