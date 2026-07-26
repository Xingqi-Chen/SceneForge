import { describe, expect, it, vi } from "vitest";

import {
  createRunSceneSuggestionFingerprintKey,
  isUnambiguous21PlusAgeGroup,
  parseRunSceneSuggestionCandidates,
  rankRunSceneSuggestionCandidates,
  runSceneSuggestionFingerprintFields,
  sanitizeRunSceneSuggestionCandidate,
  sanitizeRunSceneSuggestionFingerprint,
  selectWeightedRunSceneSuggestion,
  type RunSceneSuggestionCandidate,
  type RunSceneSuggestionFingerprint,
} from "./run-scene-suggestion";

function candidate(
  index: number,
  overrides: Partial<RunSceneSuggestionCandidate> = {},
): RunSceneSuggestionCandidate {
  return {
    sceneRequest: `A complete scene concept number ${index} with a visible protagonist performing a clear action in a detailed setting.`,
    compatiblePromptProfiles: ["illustrious"],
    protagonistType: `protagonist-${index}`,
    ageGroup: `age-${index}`,
    occupationFamily: `occupation-${index}`,
    settingCategory: `setting-${index}`,
    era: `era-${index}`,
    primaryAction: `action-${index}`,
    emotionalTone: `tone-${index}`,
    dominantPalette: `palette-${index}`,
    ...overrides,
  };
}

function payload(candidates: unknown[]) {
  return JSON.stringify({ candidates });
}

describe("Run empty-scene suggestion candidate contract", () => {
  it("accepts exactly six complete candidates and preserves each sceneRequest except outer trim", () => {
    const values = Array.from({ length: 6 }, (_, index) => candidate(index + 1));
    values[0]!.sceneRequest =
      " \n  A lighthouse keeper maps a midnight storm.\nInternal spacing stays  exactly as authored.  \n ";

    const parsed = parseRunSceneSuggestionCandidates(payload(values), "illustrious");

    expect(parsed).toMatchObject({ malformed: false, rejectedCount: 0 });
    expect(parsed.candidates).toHaveLength(6);
    expect(parsed.candidates[0]?.sceneRequest).toBe(
      "A lighthouse keeper maps a midnight storm.\nInternal spacing stays  exactly as authored.",
    );
  });

  it.each([
    ["missing sceneRequest", (value: Record<string, unknown>) => delete value.sceneRequest],
    ["short sceneRequest", (value: Record<string, unknown>) => { value.sceneRequest = "too short"; }],
    ["oversized sceneRequest", (value: Record<string, unknown>) => { value.sceneRequest = "x".repeat(1_201); }],
    ["control character", (value: Record<string, unknown>) => { value.sceneRequest = `valid scene request with bad\u0000control`; }],
    ["missing fingerprint field", (value: Record<string, unknown>) => delete value.primaryAction],
    ["empty fingerprint field", (value: Record<string, unknown>) => { value.emotionalTone = "  "; }],
    ["oversized fingerprint field", (value: Record<string, unknown>) => { value.dominantPalette = "x".repeat(65); }],
    ["invalid fingerprint characters", (value: Record<string, unknown>) => { value.era = "<script>"; }],
    ["missing profile marker", (value: Record<string, unknown>) => delete value.compatiblePromptProfiles],
    ["unknown compatible profile", (value: Record<string, unknown>) => { value.compatiblePromptProfiles = ["unknown"]; }],
    ["selected-profile mismatch", (value: Record<string, unknown>) => { value.compatiblePromptProfiles = ["anima"]; }],
    ["explicit profile mismatch", (value: Record<string, unknown>) => {
      value.promptProfile = "anima";
      value.compatiblePromptProfiles = ["illustrious"];
    }],
  ])("rejects %s", (_label, mutate) => {
    const value = { ...candidate(1) } as Record<string, unknown>;
    mutate(value);
    expect(sanitizeRunSceneSuggestionCandidate(value, "illustrious")).toBeNull();
  });

  it.each([
    "21+",
    "age 21",
    "aged 35 years old",
    "42-year-old adult",
    "adults ages 21 and 67",
    "ages 21-25",
  ])("accepts the unambiguous NSFW ageGroup format %s", (ageGroup) => {
    expect(isUnambiguous21PlusAgeGroup(ageGroup)).toBe(true);
    expect(sanitizeRunSceneSuggestionCandidate(
      candidate(1, { ageGroup }),
      "illustrious",
      true,
    )).toMatchObject({ ageGroup: ageGroup.toLocaleLowerCase() });
  });

  it.each([
    ["vague adult label", "adult"],
    ["ambiguous young-adult label", "young adult"],
    ["bare age without context", "21"],
    ["below-21 age", "20 years old"],
    ["multiple ages all below 21", "ages 18 and 20"],
    ["mixed ages", "adults ages 21 and 19"],
    ["mixed ages with an older adult", "ages 25 and 20"],
    ["non-adult category despite a numeric age", "teen aged 25"],
    ["plural minor category despite a numeric age", "minors age 25"],
    ["youth category despite a numeric age", "youth aged 25"],
    ["schoolgirl category despite a numeric age", "schoolgirl age 25"],
    ["schoolboy category despite a numeric age", "schoolboy age 25"],
    ["preteen category despite a numeric age", "preteen age 25"],
    ["toddler category despite a numeric age", "toddler age 25"],
    ["incidental non-age number", "adult shoe size 25"],
  ])("rejects %s only for NSFW candidates", (_label, ageGroup) => {
    const value = candidate(1, { ageGroup });

    expect(isUnambiguous21PlusAgeGroup(ageGroup)).toBe(false);
    expect(sanitizeRunSceneSuggestionCandidate(value, "illustrious", true)).toBeNull();
    expect(sanitizeRunSceneSuggestionCandidate(value, "illustrious", false)).toMatchObject({
      ageGroup: ageGroup.toLocaleLowerCase(),
    });
  });

  it("normalizes only bounded fingerprint fields and creates a stable identity key", () => {
    const value = candidate(1, {
      protagonistType: "  Human   Explorer ",
      emotionalTone: "Hopeful & tense",
    });
    const fingerprint = sanitizeRunSceneSuggestionFingerprint(value);

    expect(fingerprint).toEqual({
      protagonistType: "human explorer",
      ageGroup: "age-1",
      occupationFamily: "occupation-1",
      settingCategory: "setting-1",
      era: "era-1",
      primaryAction: "action-1",
      emotionalTone: "hopeful & tense",
      dominantPalette: "palette-1",
    });
    expect(createRunSceneSuggestionFingerprintKey(fingerprint!)).toBe(
      runSceneSuggestionFingerprintFields
        .map((field) => `${field}:${fingerprint![field]}`)
        .join("|"),
    );
  });

  it("rejects duplicate scene text and duplicate fingerprint identities", () => {
    const values = Array.from({ length: 6 }, (_, index) => candidate(index + 1));
    values[1] = candidate(2, {
      sceneRequest: `  ${values[0]!.sceneRequest.toLocaleUpperCase()}  `,
    });
    values[3] = candidate(4, {
      protagonistType: values[2]!.protagonistType,
      ageGroup: values[2]!.ageGroup,
      occupationFamily: values[2]!.occupationFamily,
      settingCategory: values[2]!.settingCategory,
      era: values[2]!.era,
      primaryAction: values[2]!.primaryAction,
      emotionalTone: values[2]!.emotionalTone,
      dominantPalette: values[2]!.dominantPalette,
    });

    const parsed = parseRunSceneSuggestionCandidates(payload(values), "illustrious");

    expect(parsed).toMatchObject({ malformed: false, rejectedCount: 2 });
    expect(parsed.candidates.map((entry) => entry.sceneRequest)).toEqual([
      values[0]!.sceneRequest,
      values[2]!.sceneRequest,
      values[4]!.sceneRequest,
      values[5]!.sceneRequest,
    ]);
  });

  it("marks malformed JSON and candidate counts other than six", () => {
    expect(parseRunSceneSuggestionCandidates("not json", "illustrious")).toEqual({
      candidates: [],
      malformed: true,
      rejectedCount: 0,
    });
    expect(parseRunSceneSuggestionCandidates(payload([candidate(1)]), "illustrious"))
      .toMatchObject({ malformed: true, candidates: [expect.any(Object)] });
    expect(parseRunSceneSuggestionCandidates(
      payload(Array.from({ length: 7 }, (_, index) => candidate(index + 1))),
      "illustrious",
    )).toMatchObject({ malformed: true, rejectedCount: 1 });
  });
});

describe("Run empty-scene suggestion ranking and weighted selection", () => {
  it("ranks deterministically using both recent-history and intra-batch novelty", () => {
    const repeated = candidate(1);
    const nearDuplicate = candidate(2, {
      protagonistType: repeated.protagonistType,
      ageGroup: repeated.ageGroup,
      occupationFamily: repeated.occupationFamily,
      settingCategory: repeated.settingCategory,
      era: repeated.era,
      primaryAction: repeated.primaryAction,
      emotionalTone: repeated.emotionalTone,
    });
    const novel = candidate(3);
    const history: RunSceneSuggestionFingerprint[] = [{
      protagonistType: repeated.protagonistType,
      ageGroup: repeated.ageGroup,
      occupationFamily: repeated.occupationFamily,
      settingCategory: repeated.settingCategory,
      era: repeated.era,
      primaryAction: repeated.primaryAction,
      emotionalTone: repeated.emotionalTone,
      dominantPalette: repeated.dominantPalette,
    }];

    const first = rankRunSceneSuggestionCandidates([repeated, nearDuplicate, novel], history);
    const second = rankRunSceneSuggestionCandidates([repeated, nearDuplicate, novel], history);

    expect(second).toEqual(first);
    expect(first.map(({ candidate: value }) => value)).toEqual([novel, nearDuplicate, repeated]);
    expect(first[0]!.score).toBeGreaterThan(first[1]!.score);
    expect(first[1]!.score).toBeGreaterThan(first[2]!.score);
  });

  it.each([
    [3, 0, 0],
    [3, 0.499999, 0],
    [3, 0.5, 1],
    [3, 0.799999, 1],
    [3, 0.8, 2],
    [3, 0.999999, 2],
    [2, 0, 0],
    [2, 0.624999, 0],
    [2, 0.625, 1],
    [2, 0.999999, 1],
    [1, 0.999999, 0],
  ] as const)("selects from %i ranked candidates at random=%s using the required weights", (
    count,
    randomValue,
    expectedIndex,
  ) => {
    const ranked = rankRunSceneSuggestionCandidates(
      Array.from({ length: count }, (_, index) => candidate(index + 1)),
      [],
    );
    const random = vi.fn(() => randomValue);

    expect(selectWeightedRunSceneSuggestion(ranked, random)).toBe(ranked[expectedIndex]);
    expect(random).toHaveBeenCalledTimes(count === 1 ? 0 : 1);
  });

  it("returns null without consuming randomness when there are no candidates", () => {
    const random = vi.fn(() => 0);
    expect(selectWeightedRunSceneSuggestion([], random)).toBeNull();
    expect(random).not.toHaveBeenCalled();
  });
});
