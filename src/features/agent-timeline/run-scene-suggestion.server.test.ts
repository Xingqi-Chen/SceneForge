import { beforeEach, describe, expect, it, vi } from "vitest";

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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.appendHistory.mockResolvedValue(undefined);
  mocks.appendLog.mockResolvedValue(undefined);
  mocks.loadHistory.mockResolvedValue([]);
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
