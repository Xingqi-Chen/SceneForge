import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendHistory: vi.fn(),
  appendLog: vi.fn(),
  completeChat: vi.fn(),
  loadHistory: vi.fn(),
}));

vi.mock("@/features/llm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/llm")>()),
  createLiteLlmClient: vi.fn(() => ({ completeChat: mocks.completeChat })),
}));

vi.mock("@/features/llm/llm-local-log", () => ({
  appendLlmChatLocalLog: mocks.appendLog,
  serializeErrorForLlmLog: vi.fn(() => ({ name: "redacted" })),
}));

vi.mock("./run-scene-suggestion-history.server", () => ({
  appendRunSceneSuggestionHistory: mocks.appendHistory,
  loadRunSceneSuggestionHistory: mocks.loadHistory,
  RUN_SCENE_SUGGESTION_HISTORY_VERSION: 1,
}));

import {
  buildEmptyRunSceneSuggestionRequest,
  createEmptyRunSceneSuggestion,
  RunSceneSuggestionError,
} from "./run-scene-suggestion.server";
import type {
  RunSceneSuggestionCandidate,
  RunSceneSuggestionFingerprint,
} from "./run-scene-suggestion";

function candidate(
  index: number,
  overrides: Partial<RunSceneSuggestionCandidate> = {},
): RunSceneSuggestionCandidate {
  return {
    sceneRequest: `  A complete generation-ready scene ${index} with a clear subject, action, setting, mood, and palette.  `,
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

function completion(candidates: unknown[]) {
  return {
    content: JSON.stringify({ candidates }),
    finishReason: "stop",
    model: "test-model",
    usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
  };
}

function historyFingerprint(index: number): RunSceneSuggestionFingerprint {
  const value = candidate(index);
  return {
    protagonistType: value.protagonistType,
    ageGroup: value.ageGroup,
    occupationFamily: value.occupationFamily,
    settingCategory: value.settingCategory,
    era: value.era,
    primaryAction: value.primaryAction,
    emotionalTone: value.emotionalTone,
    dominantPalette: value.dominantPalette,
  };
}

function adultCandidates() {
  return Array.from({ length: 6 }, (_, index) =>
    candidate(index + 1, { ageGroup: `age ${index + 21}` }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.appendHistory.mockResolvedValue(undefined);
  mocks.appendLog.mockResolvedValue(undefined);
  mocks.loadHistory.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("empty Run scene suggestion request", () => {
  it("builds the exact six-candidate bounded structured request with at most 20 fingerprint records", () => {
    const recentConceptsToAvoid = Array.from({ length: 25 }, (_, index) => historyFingerprint(index + 1));
    const request = buildEmptyRunSceneSuggestionRequest({
      nsfw: false,
      promptProfile: "illustrious",
      recentConceptsToAvoid,
    });
    const user = request.messages[1]?.content;
    const payload = typeof user === "string" ? JSON.parse(user) as Record<string, unknown> : {};

    expect(request).toMatchObject({
      purpose: "stable-diffusion-prompt-generation",
      nsfw: false,
      temperature: 0.9,
      maxTokens: 2_400,
    });
    expect(request.messages).toHaveLength(2);
    expect(request.messages[0]?.content).toEqual(expect.stringContaining("Return exactly 6 diverse candidates"));
    expect(request.messages[0]?.content).toEqual(expect.stringContaining("at most 64 characters"));
    expect(payload).toEqual({
      action: "suggest-empty-scene",
      candidateCount: 6,
      promptProfile: "illustrious",
      recentConceptsToAvoid: recentConceptsToAvoid.slice(-20),
    });
    expect(JSON.stringify(payload)).not.toContain("sceneRequest");
  });

  it("applies the sole-female safe-scene contract to both SFW initial and repair requests", () => {
    const initial = buildEmptyRunSceneSuggestionRequest({
      nsfw: false,
      promptProfile: "illustrious",
      recentConceptsToAvoid: [],
    });
    const repair = buildEmptyRunSceneSuggestionRequest({
      nsfw: false,
      promptProfile: "illustrious",
      recentConceptsToAvoid: [],
      repairReason: "Only 0 valid candidates remained.",
    });

    for (const request of [initial, repair]) {
      const system = String(request.messages[0]?.content);
      expect(request).toMatchObject({
        purpose: "stable-diffusion-prompt-generation",
        nsfw: false,
        temperature: 0.9,
        maxTokens: 2_400,
      });
      expect(request.messages).toHaveLength(2);
      expect(system).toContain(
        "Every candidate must depict exactly one person as the sole visual subject.",
      );
      expect(system).toContain(
        "Never include a multi-person scene, another person, a couple, group, crowd, or any person in the background.",
      );
      expect(system).toContain("The sole protagonist in every candidate must be female.");
      expect(system).toContain("Use diverse safe settings across the six candidates.");
      expect(system).toContain("A campus is one optional possibility, not a requirement or default.");
      expect(system).toContain(
        '"sceneRequest":"one complete generation-ready English scene request depicting exactly one female protagonist as the sole person and visual subject"',
      );
      expect(system).toContain(
        '"protagonistType":"bounded category for exactly one sole female protagonist"',
      );
      expect(system).toContain('"ageGroup":"bounded category"');
      expect(system).not.toMatch(
        /\bNSFW\b|21\+|21 years|minors|ambiguous-age|youth-coded|coercion|exploitation|non-consensual|unlawful/i,
      );
    }

    expect(String(initial.messages[0]?.content)).not.toContain("single permitted schema-repair attempt");
    expect(String(repair.messages[0]?.content)).toContain("single permitted schema-repair attempt");
  });

  it("adds the complete adult NSFW constraints to both the initial and repair request without changing request shape", () => {
    const initial = buildEmptyRunSceneSuggestionRequest({
      nsfw: true,
      promptProfile: "illustrious",
      recentConceptsToAvoid: [],
    });
    const repair = buildEmptyRunSceneSuggestionRequest({
      nsfw: true,
      promptProfile: "illustrious",
      recentConceptsToAvoid: [],
      repairReason: "Only 0 valid candidates remained.",
    });

    for (const request of [initial, repair]) {
      const system = String(request.messages[0]?.content);
      expect(request).toMatchObject({
        purpose: "stable-diffusion-prompt-generation",
        nsfw: true,
        temperature: 0.9,
        maxTokens: 2_400,
      });
      expect(request.messages).toHaveLength(2);
      expect(system).toContain(
        "Every candidate must depict exactly one person as the sole visual subject.",
      );
      expect(system).toContain(
        "Never include a multi-person scene, another person, a couple, group, crowd, or any person in the background.",
      );
      expect(system).toContain("clearly adult and NSFW");
      expect(system).toContain("varied mature intensity across sensual, nude, and erotic concepts");
      expect(system).toContain("Every depicted person must be explicitly 21 years old or older");
      expect(system).toContain("unambiguous numeric 21+ declaration");
      expect(system).toContain("minors, ambiguous-age or youth-coded subjects or settings");
      expect(system).toContain("coercion, exploitation, non-consensual sexual content, or unlawful sexual content");
      expect(system).toContain(
        '"sceneRequest":"one complete generation-ready English scene request depicting exactly one protagonist as the sole person and visual subject"',
      );
      expect(system).toContain(
        '"protagonistType":"bounded category for exactly one sole protagonist"',
      );
      expect(system).toContain('"ageGroup":"unambiguous numeric age declaration of 21 years or older"');
      expect(system).not.toMatch(/\bfemale\b/i);
    }

    expect(String(initial.messages[0]?.content)).not.toContain("single permitted schema-repair attempt");
    expect(String(repair.messages[0]?.content)).toContain("single permitted schema-repair attempt");
    expect(JSON.parse(String(initial.messages[1]?.content))).toMatchObject({
      action: "suggest-empty-scene",
      candidateCount: 6,
      promptProfile: "illustrious",
    });
    expect(JSON.parse(String(repair.messages[1]?.content))).toMatchObject({
      action: "repair-empty-suggestion-candidates",
      candidateCount: 6,
      promptProfile: "illustrious",
    });
  });
});

describe("empty Run scene suggestion orchestration", () => {
  it("parses six candidates, selects once, trims only the selected outer whitespace, and writes fingerprint dispositions", async () => {
    const candidates = Array.from({ length: 6 }, (_, index) => candidate(index + 1));
    mocks.completeChat.mockResolvedValue(completion(candidates));
    const random = vi.fn(() => 0);

    const result = await createEmptyRunSceneSuggestion({
      nsfw: false,
      promptProfile: "illustrious",
      random,
      now: () => new Date("2026-07-27T00:00:00.000Z"),
    });

    expect(result.sceneRequest).toBe(candidates[0]!.sceneRequest.trim());
    expect(mocks.completeChat).toHaveBeenCalledTimes(1);
    expect(random).toHaveBeenCalledTimes(1);
    expect(mocks.appendHistory).toHaveBeenCalledTimes(1);
    const additions = mocks.appendHistory.mock.calls[0]?.[0] as Array<Record<string, unknown>>;
    expect(additions).toHaveLength(6);
    expect(additions.filter((record) => record.disposition === "selected")).toHaveLength(1);
    expect(additions.filter((record) => record.disposition === "not-selected")).toHaveLength(5);
    expect(additions.every((record) =>
      record.schemaVersion === 1 &&
      record.timestamp === "2026-07-27T00:00:00.000Z" &&
      Object.keys(record).sort().join(",") === "disposition,fingerprint,schemaVersion,timestamp"
    )).toBe(true);
    expect(JSON.stringify(additions)).not.toContain("sceneRequest");
    expect(JSON.stringify(additions)).not.toContain("complete generation-ready");
  });

  it.each([
    [3, 0.5, 1],
    [2, 0.625, 1],
    [1, 0.99, 0],
  ] as const)("uses one repair and the %i-candidate fallback", async (
    validCount,
    randomValue,
    selectedIndex,
  ) => {
    const validRepaired = Array.from({ length: validCount }, (_, index) => candidate(index + 1));
    const repaired = [
      ...validRepaired,
      ...Array.from({ length: 6 - validCount }, () => ({ invalid: true })),
    ];
    mocks.completeChat
      .mockResolvedValueOnce({ ...completion([]), content: "{ malformed" })
      .mockResolvedValueOnce(completion(repaired));
    const random = vi.fn(() => randomValue);

    const result = await createEmptyRunSceneSuggestion({
      nsfw: false,
      promptProfile: "illustrious",
      random,
    });

    expect(mocks.completeChat).toHaveBeenCalledTimes(2);
    expect(mocks.completeChat.mock.calls[1]?.[0]).toMatchObject({
      temperature: 0.9,
      maxTokens: 2_400,
    });
    expect(JSON.stringify(mocks.completeChat.mock.calls[1]?.[0]))
      .toContain("single permitted schema-repair attempt");
    expect(result.sceneRequest).toBe(validRepaired[selectedIndex]!.sceneRequest.trim());
    expect(mocks.appendHistory).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ disposition: "selected" }),
    ]));
    expect(mocks.appendHistory.mock.calls[0]?.[0]).toHaveLength(validCount);
    expect(random).toHaveBeenCalledTimes(validCount === 1 ? 0 : 1);
  });

  it("stops after one repair, writes no history, and returns an actionable zero-candidate error", async () => {
    mocks.completeChat
      .mockResolvedValueOnce({ ...completion([]), content: "not json" })
      .mockResolvedValueOnce(completion(Array.from({ length: 6 }, () => ({ invalid: true }))));

    await expect(createEmptyRunSceneSuggestion({
      nsfw: false,
      promptProfile: "illustrious",
    })).rejects.toEqual(expect.objectContaining({
      name: "RunSceneSuggestionError",
      code: "no_valid_candidates",
      statusCode: 502,
      message: expect.stringContaining("Composer was not changed"),
    }));
    expect(mocks.completeChat).toHaveBeenCalledTimes(2);
    expect(mocks.appendHistory).not.toHaveBeenCalled();
  });

  it("repairs an NSFW pool rejected for ambiguous ages and accepts a fresh valid adult pool", async () => {
    const ambiguous = Array.from({ length: 6 }, (_, index) =>
      candidate(index + 1, { ageGroup: "young adult" }));
    const repaired = adultCandidates();
    mocks.completeChat
      .mockResolvedValueOnce(completion(ambiguous))
      .mockResolvedValueOnce(completion(repaired));

    const result = await createEmptyRunSceneSuggestion({
      nsfw: true,
      promptProfile: "illustrious",
      random: () => 0,
    });

    expect(result.sceneRequest).toBe(repaired[0]!.sceneRequest.trim());
    expect(mocks.completeChat).toHaveBeenCalledTimes(2);
    expect(mocks.completeChat.mock.calls[1]?.[0]).toMatchObject({
      nsfw: true,
      purpose: "stable-diffusion-prompt-generation",
    });
    expect(String(mocks.completeChat.mock.calls[1]?.[0].messages[0].content))
      .toContain("Only 0 valid unique profile-compatible candidates remained after validation; 6 were rejected.");
    expect(mocks.appendHistory.mock.calls[0]?.[0]).toHaveLength(6);
  });

  it("stops after the one NSFW age repair with a retryable failure and no history write", async () => {
    const invalid = Array.from({ length: 6 }, (_, index) =>
      candidate(index + 1, { ageGroup: index === 0 ? "20 years old" : "adult" }));
    mocks.completeChat
      .mockResolvedValueOnce(completion(invalid))
      .mockResolvedValueOnce(completion(invalid));

    await expect(createEmptyRunSceneSuggestion({
      nsfw: true,
      promptProfile: "illustrious",
    })).rejects.toMatchObject({
      name: "RunSceneSuggestionError",
      code: "no_valid_candidates",
      statusCode: 502,
      message: expect.stringContaining("Composer was not changed; retry Suggest"),
    });
    expect(mocks.completeChat).toHaveBeenCalledTimes(2);
    expect(mocks.appendHistory).not.toHaveBeenCalled();
  });

  it("selects from six valid NSFW candidates and writes the same privacy-bounded history shape", async () => {
    const candidates = adultCandidates();
    mocks.completeChat.mockResolvedValue(completion(candidates));

    const result = await createEmptyRunSceneSuggestion({
      nsfw: true,
      promptProfile: "illustrious",
      random: () => 0,
      now: () => new Date("2026-07-27T02:00:00.000Z"),
    });

    expect(result.sceneRequest).toBe(candidates[0]!.sceneRequest.trim());
    expect(mocks.completeChat).toHaveBeenCalledTimes(1);
    const additions = mocks.appendHistory.mock.calls[0]?.[0] as Array<Record<string, unknown>>;
    expect(additions).toHaveLength(6);
    expect(additions.filter((record) => record.disposition === "selected")).toHaveLength(1);
    expect(JSON.stringify(additions)).not.toContain("sceneRequest");
    expect(JSON.stringify(additions)).not.toContain("complete generation-ready");
  });

  it.each([
    ["NSFW dedicated model", true, "nsfw-model", "default-model", "nsfw-model"],
    ["NSFW default fallback", true, "", "default-model", "default-model"],
    ["SFW default model", false, "nsfw-model", "default-model", "default-model"],
  ] as const)("preserves the %s routing contract", async (
    _label,
    nsfw,
    nsfwModel,
    defaultModel,
    expectedModel,
  ) => {
    vi.stubEnv("LITELLM_NSFW_MODEL", nsfwModel);
    vi.stubEnv("LITELLM_DEFAULT_MODEL", defaultModel);
    mocks.completeChat.mockResolvedValue(completion(
      nsfw ? adultCandidates() : Array.from({ length: 6 }, (_, index) => candidate(index + 1)),
    ));

    await createEmptyRunSceneSuggestion({
      nsfw,
      promptProfile: "illustrious",
      random: () => 0,
    });

    expect(mocks.completeChat).toHaveBeenCalledWith(expect.objectContaining({
      model: expectedModel,
      nsfw,
    }));
  });

  it("uses at most the latest 20 history fingerprints for ranking and the provider request", async () => {
    const records = Array.from({ length: 25 }, (_, index) => ({
      schemaVersion: 1 as const,
      timestamp: `2026-07-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
      disposition: index % 2 === 0 ? "selected" as const : "not-selected" as const,
      fingerprint: historyFingerprint(index + 1),
    }));
    mocks.loadHistory.mockResolvedValue(records);
    mocks.completeChat.mockResolvedValue(completion(
      Array.from({ length: 6 }, (_, index) => candidate(index + 30)),
    ));

    await createEmptyRunSceneSuggestion({
      nsfw: false,
      promptProfile: "illustrious",
      random: () => 0,
    });

    const request = mocks.completeChat.mock.calls[0]?.[0];
    const userContent = request.messages[1].content as string;
    expect(JSON.parse(userContent).recentConceptsToAvoid).toEqual(
      records.slice(-20).map((record) => record.fingerprint),
    );
  });

  it("keeps a valid suggestion when history writing fails and returns a nonblocking warning", async () => {
    mocks.completeChat.mockResolvedValue(completion(
      Array.from({ length: 6 }, (_, index) => candidate(index + 1)),
    ));
    mocks.appendHistory.mockRejectedValue(new Error("EACCES sensitive filesystem detail"));

    await expect(createEmptyRunSceneSuggestion({
      nsfw: false,
      promptProfile: "illustrious",
      random: () => 0,
    })).resolves.toEqual({
      sceneRequest: candidate(1).sceneRequest.trim(),
      warning: "Suggestion created, but local diversity history could not be saved.",
    });
  });

  it("redacts provider failures behind the typed service error contract", async () => {
    mocks.completeChat.mockRejectedValue(new Error("provider sensitive credential marker"));

    await expect(createEmptyRunSceneSuggestion({
      nsfw: false,
      promptProfile: "illustrious",
    })).rejects.toBeInstanceOf(RunSceneSuggestionError);
    expect(mocks.appendHistory).not.toHaveBeenCalled();
  });
});
