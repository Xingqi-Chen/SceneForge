// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const recommendRunMock = vi.hoisted(() => vi.fn());
const closeMock = vi.hoisted(() => vi.fn());
const openDatabaseMock = vi.hoisted(() => vi.fn(async () => ({ close: closeMock })));

vi.mock("@/features/civitai-lora-library/ai-recommendation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/civitai-lora-library/ai-recommendation")>();
  return {
    ...actual,
    recommendRunCivitaiResourceCombination: recommendRunMock,
  };
});

vi.mock("@/features/persistence/sqlite-storage", () => ({
  openSceneForgeSqliteDatabase: openDatabaseMock,
}));

import { CivitaiAiRecommendationError } from "@/features/civitai-lora-library/ai-recommendation";
import { POST } from "./route";

function request() {
  return new Request("http://localhost/api/agent-timeline/run-resource-recommendation", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      desiredEffect: "neon courier",
      maxLoras: 3,
      promptProfile: "illustrious",
      visualStyle: "anime",
    }),
  });
}

describe("Run resource recommendation closed error boundary", () => {
  beforeEach(() => {
    recommendRunMock.mockReset();
    closeMock.mockReset();
    openDatabaseMock.mockReset();
    openDatabaseMock.mockResolvedValue({ close: closeMock });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    [400, "invalid_local_candidates", "Run resource recommendation could not find usable local candidates."],
    [409, "index_unavailable", "Run resource recommendation indexes are unavailable. Rebuild the Civitai indexes and try again."],
    [502, "invalid_model_output", "Run resource recommendation returned unusable model output."],
    [503, "request_failed", "Unable to recommend local Civitai resources."],
  ] as const)(
    "closes a Civitai %i failure as %s without arbitrary details",
    async (statusCode, classification, message) => {
      const sentinels = [
        "SENTINEL_CHECKPOINT_ID",
        "SENTINEL_RAW_MODEL_OUTPUT",
        "SENTINEL_PROVIDER_BODY",
        "sk-sentinel-resource-key",
        "C:\\sentinel-private-path\\database.sqlite",
      ];
      const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
      recommendRunMock.mockRejectedValue(new CivitaiAiRecommendationError(
        "SENTINEL_INTERNAL_ERROR_MESSAGE",
        statusCode,
        {
          checkpointId: sentinels[0],
          rawModelOutput: sentinels[1],
          providerBody: sentinels[2],
          apiKey: sentinels[3],
          stack: sentinels[4],
        },
      ));

      const response = await POST(request());
      const payload = await response.json();

      expect(response.status).toBe(statusCode === 503 ? 500 : statusCode);
      expect(payload).toEqual({
        error: {
          message,
          details: {
            code: "run_resource_recommendation_failed",
            classification,
          },
        },
      });
      const exposed = JSON.stringify({ payload, logs: [...consoleInfo.mock.calls, ...consoleError.mock.calls] });
      for (const sentinel of [...sentinels, "SENTINEL_INTERNAL_ERROR_MESSAGE"]) {
        expect(exposed).not.toContain(sentinel);
      }
      expect(exposed).not.toContain("checkpointId");
      expect(exposed).not.toContain("rawModelOutput");
      expect(exposed).not.toContain("providerBody");
      expect(exposed).not.toContain("stack");
      expect(closeMock).toHaveBeenCalledTimes(1);
    },
  );

  it("closes an unexpected database failure without path, stack, or internal text", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    openDatabaseMock.mockRejectedValue(new Error(
      "SENTINEL_DB_FAILURE C:\\sentinel-private-path\\database.sqlite\nSENTINEL_STACK",
    ));

    const response = await POST(request());
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({
      error: {
        message: "Unable to recommend local Civitai resources.",
        details: {
          code: "run_resource_recommendation_failed",
          classification: "unexpected_error",
        },
      },
    });
    const exposed = JSON.stringify({ payload, logs: consoleError.mock.calls });
    expect(exposed).not.toContain("SENTINEL_DB_FAILURE");
    expect(exposed).not.toContain("sentinel-private-path");
    expect(exposed).not.toContain("SENTINEL_STACK");
    expect(exposed).not.toContain("database.sqlite");
    expect(closeMock).not.toHaveBeenCalled();
    expect(recommendRunMock).not.toHaveBeenCalled();
  });
});
