import { describe, expect, it } from "vitest";

import {
  coercePromptProfileId,
  defaultPromptProfileId,
  formatPromptProfileLabel,
  normalizePromptProfileId,
  promptProfileIds,
} from "./prompt-profile";

describe("prompt profiles", () => {
  it("only exposes supported profiles and rejects non-empty invalid profiles", () => {
    expect(promptProfileIds).toEqual(["illustrious", "anima", "krea2"]);
    expect(promptProfileIds).not.toContain("generic");
    expect(defaultPromptProfileId).toBe("illustrious");

    expect(normalizePromptProfileId(undefined)).toBe("illustrious");
    expect(normalizePromptProfileId("")).toBe("illustrious");
    expect(normalizePromptProfileId("krea2")).toBe("krea2");
    expect(() => normalizePromptProfileId("generic")).toThrow("Invalid promptProfile");
    expect(() => normalizePromptProfileId("pony")).toThrow("Invalid promptProfile");
  });

  it("coerces legacy or invalid persisted profile values to a safe fallback", () => {
    expect(coercePromptProfileId("anima")).toBe("anima");
    expect(coercePromptProfileId("krea2")).toBe("krea2");
    expect(coercePromptProfileId("generic")).toBe("illustrious");
    expect(coercePromptProfileId("pony", "anima")).toBe("anima");
    expect(formatPromptProfileLabel("krea2")).toBe("Krea 2 Turbo");
  });
});
