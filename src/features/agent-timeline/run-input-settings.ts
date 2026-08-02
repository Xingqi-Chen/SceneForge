import {
  createGenerationDetailerSettingsSnapshot,
  sanitizeGenerationDetailerSettingsSnapshot,
  type GenerationDetailerSettingsSnapshot,
} from "./generation-detailers";
import {
  sanitizeGenerationStylePaletteSnapshot,
  type GenerationStylePaletteSnapshot,
} from "./generation-style-palette";
import { coercePromptProfileId, normalizePromptProfileId, type PromptProfileId } from "@/shared/prompt-profile";
import {
  KREA_REFERENCE_DEFAULT_STRENGTH,
  sanitizeCharacterReferenceSnapshot,
  sanitizeStyleReferenceSnapshot,
  type CharacterReferenceSnapshot,
  type StyleReferenceSnapshot,
} from "./style-reference";
import {
  sanitizeTimelineFinalRedrawPreset,
  type TimelineFinalRedrawPreset,
} from "./final-generation-policy";
import {
  normalizeRunVisualStyle,
  type RunVisualStyle,
} from "./run-visual-style";

export type RunSceneInputSettingsSnapshot = {
  automaticLocalRepair: boolean;
  detailers: GenerationDetailerSettingsSnapshot;
  finalRedrawPreset: TimelineFinalRedrawPreset;
  promptProfile?: PromptProfileId;
  characterReference?: CharacterReferenceSnapshot;
  /** Krea's verified dual-reference graph has one shared effective weight. */
  kreaReferenceStrength?: number;
  stylePalette?: GenerationStylePaletteSnapshot;
  styleReference?: StyleReferenceSnapshot;
  visualStyle: RunVisualStyle;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createRunSceneInputSettingsSnapshot(
  value: {
    automaticLocalRepair?: boolean;
    characterReference?: CharacterReferenceSnapshot;
    detailers?: Partial<GenerationDetailerSettingsSnapshot>;
    finalRedrawPreset?: TimelineFinalRedrawPreset;
    kreaReferenceStrength?: number;
    promptProfile?: PromptProfileId;
    stylePalette?: GenerationStylePaletteSnapshot;
    styleReference?: StyleReferenceSnapshot;
    visualStyle?: RunVisualStyle;
  } = {},
): RunSceneInputSettingsSnapshot {
  const stylePalette = sanitizeGenerationStylePaletteSnapshot(value.stylePalette);
  const styleReference = sanitizeStyleReferenceSnapshot(value.styleReference);
  const characterReference = sanitizeCharacterReferenceSnapshot(value.characterReference);
  const kreaReferenceStrength = sanitizeKreaReferenceStrength(value.kreaReferenceStrength);
  return {
    automaticLocalRepair: value.automaticLocalRepair === true,
    detailers: createGenerationDetailerSettingsSnapshot(value.detailers),
    finalRedrawPreset: sanitizeTimelineFinalRedrawPreset(value.finalRedrawPreset),
    visualStyle: normalizeRunVisualStyle(value.visualStyle),
    ...(value.promptProfile ? { promptProfile: normalizePromptProfileId(value.promptProfile) } : {}),
    ...(characterReference ? { characterReference } : {}),
    ...(kreaReferenceStrength !== undefined ? { kreaReferenceStrength } : {}),
    ...(stylePalette ? { stylePalette } : {}),
    ...(styleReference ? { styleReference } : {}),
  };
}

export function sanitizeRunSceneInputSettingsSnapshot(value: unknown): RunSceneInputSettingsSnapshot {
  const raw = isRecord(value) ? value : {};
  const stylePalette = sanitizeGenerationStylePaletteSnapshot(raw.stylePalette);
  const styleReference = sanitizeStyleReferenceSnapshot(raw.styleReference);
  const characterReference = sanitizeCharacterReferenceSnapshot(raw.characterReference);
  const kreaReferenceStrength = sanitizeKreaReferenceStrength(raw.kreaReferenceStrength);
  return {
    automaticLocalRepair: raw.automaticLocalRepair === true,
    detailers: sanitizeGenerationDetailerSettingsSnapshot(raw.detailers),
    finalRedrawPreset: sanitizeTimelineFinalRedrawPreset(raw.finalRedrawPreset),
    visualStyle: normalizeRunVisualStyle(raw.visualStyle),
    ...(typeof raw.promptProfile === "string"
      ? { promptProfile: coercePromptProfileId(raw.promptProfile) }
      : {}),
    ...(characterReference ? { characterReference } : {}),
    ...(kreaReferenceStrength !== undefined ? { kreaReferenceStrength } : {}),
    ...(stylePalette ? { stylePalette } : {}),
    ...(styleReference ? { styleReference } : {}),
  };
}

export function sanitizeKreaReferenceStrength(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return KREA_REFERENCE_DEFAULT_STRENGTH;
  }
  return Math.min(1, Math.max(0, Number(numeric.toFixed(2))));
}

export function getKreaReferenceStrength(settings: Pick<RunSceneInputSettingsSnapshot, "kreaReferenceStrength">) {
  return settings.kreaReferenceStrength ?? KREA_REFERENCE_DEFAULT_STRENGTH;
}

export function getRunSceneInputSettings(input: { settingsSnapshot?: unknown }) {
  return sanitizeRunSceneInputSettingsSnapshot(input.settingsSnapshot);
}
