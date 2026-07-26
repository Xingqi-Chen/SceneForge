import { beforeEach, describe, expect, it, vi } from "vitest";

const createSuggestionMock = vi.hoisted(() => vi.fn());

vi.mock("@/features/agent-timeline/run-scene-suggestion.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/agent-timeline/run-scene-suggestion.server")>()),
  createEmptyRunSceneSuggestion: createSuggestionMock,
}));

import { RunSceneSuggestionError } from "@/features/agent-timeline/run-scene-suggestion.server";

import { POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  createSuggestionMock.mockResolvedValue({ sceneRequest: "A complete suggested scene." });
});

describe("POST /api/agent-timeline/run-scene-suggestion", () => {
  it("rejects malformed JSON before calling the suggestion service", async () => {
    const response = await POST(new Request("http://localhost/api/agent-timeline/run-scene-suggestion", {
      body: "{bad",
      headers: { "content-type": "application/json" },
      method: "POST",
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { message: "Request body must be valid JSON." },
    });
    expect(createSuggestionMock).not.toHaveBeenCalled();
  });

  it.each([
    ["array", []],
    ["missing profile", {}],
    ["unknown profile", { promptProfile: "unknown" }],
    ["numeric profile", { promptProfile: 1 }],
    ["non-boolean NSFW flag", { promptProfile: "illustrious", nsfw: "true" }],
  ])("rejects an invalid %s payload without side effects", async (_label, body) => {
    const response = await POST(new Request("http://localhost/api/agent-timeline/run-scene-suggestion", {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST",
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { message: "A valid Run prompt profile is required." },
    });
    expect(createSuggestionMock).not.toHaveBeenCalled();
  });

  it.each([
    [{ promptProfile: "illustrious" }, { promptProfile: "illustrious", nsfw: false }],
    [{ promptProfile: "anima", nsfw: false }, { promptProfile: "anima", nsfw: false }],
    [{ promptProfile: "krea2", nsfw: true }, { promptProfile: "krea2", nsfw: true }],
  ] as const)("passes only validated routing fields to the service", async (body, expected) => {
    createSuggestionMock.mockResolvedValue({
      sceneRequest: "A complete suggested scene.",
      warning: "History was unavailable.",
    });

    const response = await POST(new Request("http://localhost/api/agent-timeline/run-scene-suggestion", {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      sceneRequest: "A complete suggested scene.",
      warning: "History was unavailable.",
    });
    expect(createSuggestionMock).toHaveBeenCalledWith(expected);
  });

  it("returns the actionable zero-candidate error without exposing implementation details", async () => {
    createSuggestionMock.mockRejectedValue(new RunSceneSuggestionError(
      "no_valid_candidates",
      "AI did not return a valid profile-compatible scene suggestion. The Composer was not changed; retry Suggest.",
    ));

    const response = await POST(new Request("http://localhost/api/agent-timeline/run-scene-suggestion", {
      body: JSON.stringify({ promptProfile: "illustrious" }),
      method: "POST",
    }));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "no_valid_candidates",
        message: "AI did not return a valid profile-compatible scene suggestion. The Composer was not changed; retry Suggest.",
      },
    });
  });

  it("redacts provider and credential details from typed upstream errors", async () => {
    createSuggestionMock.mockRejectedValue(new RunSceneSuggestionError(
      "llm_unavailable",
      "Provider rejected Authorization: Bearer credential-marker-123 at https://internal.invalid",
      503,
    ));

    const response = await POST(new Request("http://localhost/api/agent-timeline/run-scene-suggestion", {
      body: JSON.stringify({ promptProfile: "illustrious", nsfw: false }),
      method: "POST",
    }));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({
      error: {
        code: "llm_unavailable",
        message: "Empty Run suggestion is temporarily unavailable.",
      },
    });
    expect(JSON.stringify(body)).not.toContain("credential-marker");
    expect(JSON.stringify(body)).not.toContain("internal.invalid");
  });

  it("uses a generic redacted response for unexpected failures", async () => {
    createSuggestionMock.mockRejectedValue(new Error("sensitive database detail"));

    const response = await POST(new Request("http://localhost/api/agent-timeline/run-scene-suggestion", {
      body: JSON.stringify({ promptProfile: "illustrious" }),
      method: "POST",
    }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: { message: "Unexpected empty Run suggestion failure." } });
    expect(JSON.stringify(body)).not.toContain("sensitive database detail");
  });
});
