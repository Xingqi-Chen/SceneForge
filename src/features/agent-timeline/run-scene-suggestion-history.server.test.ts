import { beforeEach, describe, expect, it, vi } from "vitest";

const fsMocks = vi.hoisted(() => ({
  mkdir: vi.fn(),
  readFile: vi.fn(),
  rename: vi.fn(),
  rm: vi.fn(),
  stat: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock("node:fs", () => ({
  default: { promises: fsMocks },
  promises: fsMocks,
}));

import {
  appendRunSceneSuggestionHistory,
  getRunSceneSuggestionHistoryPath,
  loadRunSceneSuggestionHistory,
  parseRunSceneSuggestionHistory,
  RUN_SCENE_SUGGESTION_HISTORY_LIMIT,
  RUN_SCENE_SUGGESTION_HISTORY_VERSION,
  type RunSceneSuggestionHistoryRecord,
} from "./run-scene-suggestion-history.server";

function record(
  index: number,
  disposition: RunSceneSuggestionHistoryRecord["disposition"] = "not-selected",
): RunSceneSuggestionHistoryRecord {
  return {
    schemaVersion: RUN_SCENE_SUGGESTION_HISTORY_VERSION,
    timestamp: `2026-07-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
    disposition,
    fingerprint: {
      protagonistType: `protagonist-${index}`,
      ageGroup: `age-${index}`,
      occupationFamily: `occupation-${index}`,
      settingCategory: `setting-${index}`,
      era: `era-${index}`,
      primaryAction: `action-${index}`,
      emotionalTone: `tone-${index}`,
      dominantPalette: `palette-${index}`,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fsMocks.mkdir.mockResolvedValue(undefined);
  fsMocks.rename.mockResolvedValue(undefined);
  fsMocks.rm.mockResolvedValue(undefined);
  fsMocks.writeFile.mockResolvedValue(undefined);
});

describe("Run scene suggestion history reader", () => {
  it("uses the dedicated ignored runtime-data path", () => {
    expect(getRunSceneSuggestionHistoryPath()).toMatch(
      /data[\\/]agent-timeline-run-suggestion-history[\\/]history\.json$/,
    );
  });

  it.each([
    ["missing", () => fsMocks.stat.mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" }))],
    ["non-file", () => fsMocks.stat.mockResolvedValue({ isFile: () => false, size: 10 })],
    ["oversized", () => fsMocks.stat.mockResolvedValue({ isFile: () => true, size: 64 * 1024 + 1 })],
    ["unreadable", () => {
      fsMocks.stat.mockResolvedValue({ isFile: () => true, size: 10 });
      fsMocks.readFile.mockRejectedValue(new Error("EACCES"));
    }],
    ["corrupt JSON", () => {
      fsMocks.stat.mockResolvedValue({ isFile: () => true, size: 10 });
      fsMocks.readFile.mockResolvedValue("{ corrupt");
    }],
  ] as const)("treats %s history as empty", async (_label, arrange) => {
    arrange();
    await expect(loadRunSceneSuggestionHistory()).resolves.toEqual([]);
  });

  it("keeps the latest 20 valid records and sanitizes invalid entries", () => {
    const records: unknown[] = [
      { ...record(0), disposition: "permanent-dislike" },
      ...Array.from({ length: 25 }, (_, index) => record(index + 1)),
      { ...record(99), timestamp: "not-a-date" },
    ];

    const parsed = parseRunSceneSuggestionHistory({
      schemaVersion: RUN_SCENE_SUGGESTION_HISTORY_VERSION,
      records,
    });

    expect(parsed).toHaveLength(RUN_SCENE_SUGGESTION_HISTORY_LIMIT);
    expect(parsed).toEqual(Array.from({ length: 20 }, (_, index) => record(index + 6)));
  });
});

describe("Run scene suggestion history writer", () => {
  it("writes only version, timestamp, disposition, and bounded fingerprint fields", async () => {
    fsMocks.stat.mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" }));
    let serialized = "";
    fsMocks.writeFile.mockImplementation(async (_filename, value) => {
      serialized = String(value);
    });

    await appendRunSceneSuggestionHistory([
      { ...record(1, "selected"), sceneRequest: "must never persist" } as RunSceneSuggestionHistoryRecord,
      { ...record(2), rawResponse: "must never persist" } as RunSceneSuggestionHistoryRecord,
    ]);

    const written = JSON.parse(serialized) as {
      schemaVersion: number;
      records: Array<Record<string, unknown>>;
    };
    expect(written.schemaVersion).toBe(1);
    expect(written.records).toHaveLength(2);
    expect(written.records.every((entry) =>
      Object.keys(entry).sort().join(",") === "disposition,fingerprint,schemaVersion,timestamp" &&
      Object.keys(entry.fingerprint as object).sort().join(",") ===
        "ageGroup,dominantPalette,emotionalTone,era,occupationFamily,primaryAction,protagonistType,settingCategory"
    )).toBe(true);
    expect(serialized).not.toContain("sceneRequest");
    expect(serialized).not.toContain("rawResponse");
    expect(fsMocks.writeFile).toHaveBeenCalledWith(
      expect.stringMatching(/\.history\.json\.[a-f0-9-]+\.tmp$/),
      expect.any(String),
      { encoding: "utf8", flag: "wx" },
    );
    expect(fsMocks.rename).toHaveBeenCalledWith(
      expect.stringMatching(/\.history\.json\.[a-f0-9-]+\.tmp$/),
      expect.stringMatching(/history\.json$/),
    );
  });

  it("rejects an unwritable history after attempting temporary-file cleanup", async () => {
    fsMocks.stat.mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" }));
    fsMocks.writeFile.mockRejectedValue(new Error("EACCES"));

    await expect(appendRunSceneSuggestionHistory([record(1)])).rejects.toThrow("EACCES");
    expect(fsMocks.rename).not.toHaveBeenCalled();
    expect(fsMocks.rm).toHaveBeenCalledWith(
      expect.stringMatching(/\.history\.json\.[a-f0-9-]+\.tmp$/),
      { force: true },
    );
  });

  it("serializes concurrent atomic writes and preserves both additions", async () => {
    let currentFile: string | undefined;
    const temporaryFiles = new Map<string, string>();
    let activeWrites = 0;
    let maximumActiveWrites = 0;
    fsMocks.stat.mockImplementation(async () => {
      if (currentFile === undefined) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return { isFile: () => true, size: Buffer.byteLength(currentFile) };
    });
    fsMocks.readFile.mockImplementation(async () => currentFile);
    fsMocks.writeFile.mockImplementation(async (filename, value) => {
      activeWrites += 1;
      maximumActiveWrites = Math.max(maximumActiveWrites, activeWrites);
      await Promise.resolve();
      temporaryFiles.set(String(filename), String(value));
      activeWrites -= 1;
    });
    fsMocks.rename.mockImplementation(async (temporary) => {
      currentFile = temporaryFiles.get(String(temporary));
    });

    await Promise.all([
      appendRunSceneSuggestionHistory([record(1, "selected")]),
      appendRunSceneSuggestionHistory([record(2, "not-selected")]),
    ]);

    expect(maximumActiveWrites).toBe(1);
    expect(fsMocks.writeFile).toHaveBeenCalledTimes(2);
    expect(fsMocks.rename).toHaveBeenCalledTimes(2);
    expect(JSON.parse(currentFile!).records).toEqual([record(1, "selected"), record(2, "not-selected")]);
  });

  it("prunes combined existing and new history to the latest 20 records", async () => {
    const existing = Array.from({ length: 19 }, (_, index) => record(index + 1));
    fsMocks.stat.mockResolvedValue({ isFile: () => true, size: 1_000 });
    fsMocks.readFile.mockResolvedValue(JSON.stringify({
      schemaVersion: RUN_SCENE_SUGGESTION_HISTORY_VERSION,
      records: existing,
    }));
    let serialized = "";
    fsMocks.writeFile.mockImplementation(async (_filename, value) => {
      serialized = String(value);
    });

    await appendRunSceneSuggestionHistory([record(20), record(21), record(22)]);

    const written = JSON.parse(serialized) as { records: RunSceneSuggestionHistoryRecord[] };
    expect(written.records).toHaveLength(20);
    expect(written.records).toEqual([
      ...existing.slice(2),
      record(20),
      record(21),
      record(22),
    ]);
  });
});
