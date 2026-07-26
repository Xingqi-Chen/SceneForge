import { describe, expect, it } from "vitest";

import {
  appendKrea2PromptSegmentExactlyOnce,
  buildKrea2AiResponseInstructions,
  hasKrea2PromptSegmentExactlyOnceAtTail,
  parseKrea2PromptSectionsFromResponse,
  renderKrea2Prompt,
} from "./krea2-prompt";

describe("Krea 2 prompt response contract", () => {
  it("parses the canonical environmentAndBackground section", () => {
    expect(parseKrea2PromptSectionsFromResponse(`\`\`\`json
      {
        "krea2Sections": {
          "subjectMood": "A focused courier",
          "environmentAndBackground": "A rain-dark station platform under a steel canopy"
        }
      }
    \`\`\``)).toEqual({
      subjectMood: "A focused courier",
      environmentAndBackground: "A rain-dark station platform under a steel canopy",
    });
  });

  it.each([
    "environment",
    "environment_background",
    "background",
    "setting",
  ])("recognizes the %s environment alias", (alias) => {
    expect(parseKrea2PromptSectionsFromResponse(JSON.stringify({
      sections: {
        [alias]: ["wet platform", "distant station lights"],
      },
    }))).toEqual({
      environmentAndBackground: ["wet platform", "distant station lights"],
    });
  });

  it("preserves quoted content through raw JSON parsing and final rendering while normalizing outside whitespace", () => {
    const sections = parseKrea2PromptSectionsFromResponse(JSON.stringify({
      krea2Sections: {
        subjectMood: '  A   sign reads "GO   NOW  . ,"   beneath   the canopy  ',
        environmentAndBackground: "  Rain   crosses   the station platform  ",
      },
    }));

    expect(sections).toEqual({
      subjectMood: 'A sign reads "GO   NOW  . ," beneath the canopy',
      environmentAndBackground: "Rain crosses the station platform",
    });
    expect(renderKrea2Prompt({ sections: sections ?? undefined })).toBe(
      'A sign reads "GO   NOW  . ," beneath the canopy, Rain crosses the station platform',
    );
  });

  it("requires detailed environment-aware prose without making the word range a hard limit", () => {
    const instructions = buildKrea2AiResponseInstructions();

    expect(instructions).toContain(
      "subjectMood, subjectAttributesAndActions, environmentAndBackground, " +
      "visualStyleAndMedium, lightingColorAndTexture, spatialCompositionAndFraming",
    );
    expect(instructions).toContain("must include environmentAndBackground");
    expect(instructions).toContain("roughly 160-240 English words");
    expect(instructions).toContain("guidance, not a hard limit");
    expect(instructions).toContain("do not truncate, reject, pad, repeat, or force a minimum");
    expect(instructions).toContain(
      "environmentAndBackground alone owns the setting, environment, background",
    );
    expect(instructions).toContain(
      "spatialCompositionAndFraming alone owns foreground, midground, and background placement",
    );
    expect(instructions).toContain("relative scale");
    expect(instructions).toContain("atmospheric depth");
    expect(instructions).toContain("subject-background separation or contrast");
    expect(instructions).toContain("one cohesive paragraph");
    expect(instructions).toContain(
      "Do not invent unsupported characters, animals, concrete objects, clothing, materials, colors, visible text, or events",
    );
  });
});

describe("Krea 2 prompt renderer", () => {
  it("renders supplied author sections in the fixed order without inventing details", () => {
    const prompt = renderKrea2Prompt({
      sections: {
        subjectMood: "A calm courier",
        subjectAttributesAndActions: "wearing a yellow jacket and holding a blue parcel",
        environmentAndBackground: "a quiet station with rain beyond the canopy",
        visualStyleAndMedium: "watercolor illustration",
        lightingColorAndTexture: "soft amber sunrise light",
        spatialCompositionAndFraming: "the courier stands in the foreground against the distant platform",
      },
    });

    expect(prompt).toBe(
      "A calm courier, wearing a yellow jacket and holding a blue parcel, " +
      "a quiet station with rain beyond the canopy, watercolor illustration, " +
      "soft amber sunrise light, the courier stands in the foreground against the distant platform",
    );
    expect(prompt.match(/quiet station/g)).toHaveLength(1);
    expect(prompt).not.toContain("dog");
    expect(prompt).not.toContain("leather");
  });

  it("preserves quoted visible text and requested medium while appending each LoRA trigger once", () => {
    const prompt = renderKrea2Prompt({
      resources: {
        checkpoint: null,
        loras: [
          {
            id: "style-lora",
            resourceType: "lora",
            name: "Style LoRA",
            versionName: "v1",
            baseModel: "Krea 2",
            creator: "creator",
            trainedWords: ["neon_station", "NEON_STATION", "soft ink"],
            tags: [],
            categories: [],
            usageGuide: null,
            descriptionSnippet: null,
            averageWeight: 0.7,
            minWeight: null,
            maxWeight: null,
            recommendations: [],
            previewImage: null,
            modelFileName: "style-lora.safetensors",
          },
        ],
      },
      sections: {
        subjectMood: 'A sign reads "OPEN ALL NIGHT"',
        visualStyleAndMedium: "35mm film photography",
        selectedLoraTriggerWords: ["neon_station", "soft ink"],
      },
    });

    expect(prompt).toBe(
      'A sign reads "OPEN ALL NIGHT", 35mm film photography, neon_station, soft ink',
    );
    expect(prompt.match(/neon_station/gi)).toHaveLength(1);
    expect(prompt.match(/soft ink/gi)).toHaveLength(1);
  });

  it("uses a flat manual prompt as the subject clause without reordering quoted text", () => {
    expect(renderKrea2Prompt({
      sourcePrompt: 'A poster says "KREA" in oil pastel',
      sections: { lightingColorAndTexture: "cool window light" },
    })).toBe('A poster says "KREA" in oil pastel, cool window light');
  });

  it("deduplicates exact one-word, multi-word, and quoted trigger matches without treating substrings as matches", () => {
    const prompt = renderKrea2Prompt({
      resources: {
        checkpoint: null,
        loras: [{
          id: "exact-trigger-lora",
          resourceType: "lora",
          name: "Exact Trigger LoRA",
          versionName: "v1",
          baseModel: "Krea 2",
          creator: "creator",
          trainedWords: ["art", "portrait", "soft ink", "soft inking"],
          tags: [],
          categories: [],
          usageGuide: null,
          descriptionSnippet: null,
          averageWeight: 0.7,
          minWeight: null,
          maxWeight: null,
          recommendations: [],
          previewImage: null,
          modelFileName: "exact-trigger-lora.safetensors",
        }],
      },
      sections: {
        subjectMood: 'A portrait displays the quoted text "soft ink"',
        visualStyleAndMedium: "illustration",
      },
    });

    expect(prompt).toBe(
      'A portrait displays the quoted text "soft ink", illustration, art, soft inking',
    );
    expect(prompt.match(/soft ink/gi)).toHaveLength(2);
    expect(prompt).not.toContain(", portrait");
  });

  it("keeps art_style, standalone art, and art-based as three distinct selected LoRA triggers", () => {
    const prompt = renderKrea2Prompt({
      sections: {
        subjectMood: "A courier portrait",
        selectedLoraTriggerWords: ["art_style", "art", "art-based", "ART"],
      },
    });
    const clauses = prompt.split(", ").map((clause) => clause.toLocaleLowerCase());

    expect(prompt).toBe("A courier portrait, art_style, art, art-based");
    expect(clauses.filter((clause) => clause === "art_style")).toHaveLength(1);
    expect(clauses.filter((clause) => clause === "art")).toHaveLength(1);
    expect(clauses.filter((clause) => clause === "art-based")).toHaveLength(1);
    expect(renderKrea2Prompt({
      sections: {
        subjectMood: "art",
        selectedLoraTriggerWords: ["art", "ART"],
      },
    })).toBe("art");
  });

  it("normalizes arrays and punctuation-aware boundaries while preserving quoted text and exact de-duplication", () => {
    const prompt = renderKrea2Prompt({
      sections: {
        subjectMood: ["A courier waits.,", "A courier waits."],
        subjectAttributesAndActions: [
          "holding a blue parcel; ,",
          'a sign reads "GO, NOW!"',
        ],
        environmentAndBackground: ["inside a rain-dark station,,", "distant lamps recede"],
        visualStyleAndMedium: "watercolor illustration; ,",
        lightingColorAndTexture: "soft amber light.,",
        spatialCompositionAndFraming:
          "the courier fills the foreground, rails cross the midground, the platform recedes into atmospheric depth",
        selectedLoraTriggerWords: ["krea_style", "KREA_STYLE"],
      },
    });

    expect(prompt.match(/A courier waits/gi)).toHaveLength(1);
    expect(prompt.match(/krea_style/gi)).toHaveLength(1);
    expect(prompt).toContain('a sign reads "GO, NOW!"');
    expect(prompt.indexOf("inside a rain-dark station")).toBeLessThan(
      prompt.indexOf("watercolor illustration"),
    );
    expect(prompt.indexOf("watercolor illustration")).toBeLessThan(
      prompt.indexOf("soft amber light"),
    );
    expect(prompt.indexOf("soft amber light")).toBeLessThan(
      prompt.indexOf("the courier fills the foreground"),
    );
    expect(prompt).not.toMatch(/\.\s*,/u);
    expect(prompt).not.toContain(".,");
    expect(prompt).not.toContain(",,");
    expect(prompt).not.toMatch(/;\s*,/u);
    expect(prompt).not.toMatch(/\s+[,.!?;:]/u);
  });

  it("preserves terminal punctuation and internal whitespace byte-for-byte inside visible quoted text", () => {
    const terminalPunctuation = renderKrea2Prompt({
      sections: {
        subjectMood: 'A sign reads "GO.,"',
        environmentAndBackground: "Rain crosses the station platform",
      },
    });
    const internalWhitespace = renderKrea2Prompt({
      sections: {
        subjectMood: 'A sign reads "GO   NOW  . ,"',
        environmentAndBackground: "Rain crosses the station platform",
      },
    });

    expect(terminalPunctuation).toBe(
      'A sign reads "GO.," Rain crosses the station platform',
    );
    expect(internalWhitespace).toBe(
      'A sign reads "GO   NOW  . ," Rain crosses the station platform',
    );
  });

  it("preserves ASCII and curly contractions without treating apostrophes as quote boundaries", () => {
    expect(renderKrea2Prompt({
      sections: {
        subjectMood: "A courier doesn't stop",
        subjectAttributesAndActions: "the courier isn’t looking back",
        environmentAndBackground: "rain falls across the station",
      },
    })).toBe(
      "A courier doesn't stop, the courier isn’t looking back, rain falls across the station",
    );
  });

  it("joins CJK punctuation and em/en dashes without injecting an ASCII comma", () => {
    expect(renderKrea2Prompt({
      sections: {
        subjectMood: "夜の駅。",
        subjectAttributesAndActions: "A courier waits—",
        environmentAndBackground: "雨のホーム、",
        visualStyleAndMedium: "watercolor，",
        lightingColorAndTexture: "soft light–",
        spatialCompositionAndFraming: "centered composition",
      },
    })).toBe(
      "夜の駅。 A courier waits— 雨のホーム、 watercolor， soft light– centered composition",
    );
  });

  it("appends an opaque style-reference clause once with safe paragraph punctuation", () => {
    const rendered = renderKrea2Prompt({
      sections: {
        subjectMood: "A courier waits.",
        environmentAndBackground: "Rain crosses the station beyond the canopy.",
        visualStyleAndMedium: "35mm film photography",
      },
    });
    const stylePrompt = "soft gouache, cobalt shadows; ,";
    const first = appendKrea2PromptSegmentExactlyOnce(rendered, stylePrompt);
    const second = appendKrea2PromptSegmentExactlyOnce(first, stylePrompt);

    expect(first).toBe(
      "A courier waits. Rain crosses the station beyond the canopy. " +
      "35mm film photography, soft gouache, cobalt shadows",
    );
    expect(second).toBe(first);
    expect(first.match(/soft gouache, cobalt shadows/g)).toHaveLength(1);
    expect(hasKrea2PromptSegmentExactlyOnceAtTail(first, stylePrompt)).toBe(true);
    expect(hasKrea2PromptSegmentExactlyOnceAtTail(
      `soft gouache, cobalt shadows. ${first}`,
      stylePrompt,
    )).toBe(false);
    expect(first).not.toMatch(/\.\s*,|,,|;\s*,|\s+[,.!?;:]/u);
  });

  it.each([
    ["double hyphen", " -- "],
    ["em dash", " — "],
    ["pipe", " | "],
    ["CJK full stop", "。 "],
    ["CJK comma", "、 "],
    ["parentheses", " (bridge) "],
    ["brackets", " [bridge] "],
  ])("rejects a prior duplicate style segment separated by %s", (_label, separator) => {
    const stylePrompt = "soft gouache, cobalt shadows";
    const prompt = `${stylePrompt}${separator}main subject, ${stylePrompt}`;

    expect(hasKrea2PromptSegmentExactlyOnceAtTail(prompt, stylePrompt)).toBe(false);
  });
});
