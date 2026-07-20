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
  sanitizeStyleReferenceSnapshot,
  type StyleReferenceSnapshot,
} from "./style-reference";

export type RunSceneInputSettingsSnapshot = {
  detailers: GenerationDetailerSettingsSnapshot;
  promptProfile?: PromptProfileId;
  stylePalette?: GenerationStylePaletteSnapshot;
  styleReference?: StyleReferenceSnapshot;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createRunSceneInputSettingsSnapshot(
  value: {
    detailers?: Partial<GenerationDetailerSettingsSnapshot>;
    promptProfile?: PromptProfileId;
    stylePalette?: GenerationStylePaletteSnapshot;
    styleReference?: StyleReferenceSnapshot;
  } = {},
): RunSceneInputSettingsSnapshot {
  const stylePalette = sanitizeGenerationStylePaletteSnapshot(value.stylePalette);
  const styleReference = sanitizeStyleReferenceSnapshot(value.styleReference);
  return {
    detailers: createGenerationDetailerSettingsSnapshot(value.detailers),
    ...(value.promptProfile ? { promptProfile: normalizePromptProfileId(value.promptProfile) } : {}),
    ...(stylePalette ? { stylePalette } : {}),
    ...(styleReference ? { styleReference } : {}),
  };
}

export function sanitizeRunSceneInputSettingsSnapshot(value: unknown): RunSceneInputSettingsSnapshot {
  const raw = isRecord(value) ? value : {};
  const stylePalette = sanitizeGenerationStylePaletteSnapshot(raw.stylePalette);
  const styleReference = sanitizeStyleReferenceSnapshot(raw.styleReference);
  return {
    detailers: sanitizeGenerationDetailerSettingsSnapshot(raw.detailers),
    ...(typeof raw.promptProfile === "string"
      ? { promptProfile: coercePromptProfileId(raw.promptProfile) }
      : {}),
    ...(stylePalette ? { stylePalette } : {}),
    ...(styleReference ? { styleReference } : {}),
  };
}

export function getRunSceneInputSettings(input: { settingsSnapshot?: unknown }) {
  return sanitizeRunSceneInputSettingsSnapshot(input.settingsSnapshot);
}
