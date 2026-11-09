import { describe, expect, it } from "vitest";

import {
  isCivitaiBaseModelCompatibleWithPromptProfile,
  isKrea2CivitaiBaseModel,
  isSameCivitaiBaseModel,
  normalizeCivitaiBaseModel,
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

describe("Krea 2 compatibility aliases", () => {
  const aliases = ["Krea 2", "Krea 2 Turbo", "Krea2", "Krea2Turbo", " kReA 2 tUrBo ", "Krea-2", "KREA_2", "Krea-2-Turbo", "Krea_2_Turbo", "krea2_turbo", "krea  2   turbo"];

  it.each(aliases)("maps %s to krea2 and matches every known alias bidirectionally", (label) => {
    expect(normalizeCivitaiBaseModel(label)).toBe("krea2");
    expect(isKrea2CivitaiBaseModel(label)).toBe(true);
    expect(isCivitaiBaseModelCompatibleWithPromptProfile(label, "krea2")).toBe(true);
    for (const other of aliases) {
      expect(isSameCivitaiBaseModel(label, other)).toBe(true);
      expect(isSameCivitaiBaseModel(other, label)).toBe(true);
    }
  });

  it.each(["Krea", "Krea 3", "Krea 20", "Krea 2.1", "Krea2.0", "Krea 2 Dev", "Krea 2 Pro", "Krea 2 Turbo 2", "Krea 2 Turbo Plus", "Krea2Turbocharged", "Kreation 2", "Anima", "Illustrious", "Pony", "SDXL 1.0", "", " ", null, undefined])("does not merge unknown or missing label %s", (label) => {
    expect(isKrea2CivitaiBaseModel(label)).toBe(false);
    expect(isSameCivitaiBaseModel(label, "Krea 2")).toBe(false);
    expect(isSameCivitaiBaseModel("Krea 2 Turbo", label)).toBe(false);
    expect(isCivitaiBaseModelCompatibleWithPromptProfile(label, "krea2")).toBe(false);
  });

  it("keeps non-Krea exact family comparisons and raw unknown-label normalization", () => {
    expect(normalizeCivitaiBaseModel(" Krea 2 Pro ")).toBe("krea 2 pro");
    expect(isSameCivitaiBaseModel(" Anima ", "ANIMA")).toBe(true);
    expect(isSameCivitaiBaseModel("Illustrious", "Illustrious XL")).toBe(false);
    expect(isSameCivitaiBaseModel("SDXL 1.0", "SDXL_1.0")).toBe(false);
    expect(isSameCivitaiBaseModel(null, null)).toBe(false);
    expect(isCivitaiBaseModelCompatibleWithPromptProfile("Illustrious XL", "illustrious")).toBe(true);
  });
});
