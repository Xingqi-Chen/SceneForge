import { describe, expect, it } from "vitest";

import {
  isCivitaiBaseModelCompatibleWithPromptProfile,
  isKrea2CivitaiBaseModel,
} from "./base-model";

describe("Civitai prompt-profile compatibility", () => {
  it("accepts only normalized Krea 2 family metadata for the Krea profile", () => {
    expect(isKrea2CivitaiBaseModel("Krea 2")).toBe(true);
    expect(isKrea2CivitaiBaseModel(" krea-2 turbo ")).toBe(true);
    expect(isKrea2CivitaiBaseModel("Krea_2")).toBe(true);
    expect(isKrea2CivitaiBaseModel("Krea 3")).toBe(false);
    expect(isKrea2CivitaiBaseModel("Kreation 2")).toBe(false);

    expect(isCivitaiBaseModelCompatibleWithPromptProfile("Krea 2", "krea2")).toBe(true);
    expect(isCivitaiBaseModelCompatibleWithPromptProfile("Krea 2 Turbo", "krea2")).toBe(true);
    expect(isCivitaiBaseModelCompatibleWithPromptProfile("Anima", "krea2")).toBe(false);
    expect(isCivitaiBaseModelCompatibleWithPromptProfile("Krea 2", "anima")).toBe(false);
  });
});
