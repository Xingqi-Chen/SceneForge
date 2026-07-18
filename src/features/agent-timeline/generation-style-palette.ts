import type { SelectedCivitaiResourcesPreview } from "@/features/civitai-lora-library";
import type { SavedComfyUiGenerationParams } from "@/shared/types";

export type GenerationStylePaletteLoraSnapshot = {
  id: string;
  enabled: boolean;
  strengthModel?: number;
  strengthClip?: number;
};

export type GenerationStylePaletteParameters = {
  width: number;
  height: number;
  steps: number;
  cfg: number;
  samplerName: string;
  scheduler: string;
  denoise: number;
  seed?: number;
};

export type GenerationStylePaletteSnapshot = {
  checkpointId?: string;
  loras: GenerationStylePaletteLoraSnapshot[];
  parameters?: GenerationStylePaletteParameters;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanId(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function finiteNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function positiveInteger(value: unknown) {
  const parsed = finiteNumber(value);
  return parsed === undefined ? undefined : Math.max(1, Math.round(parsed));
}

function dimension(value: unknown) {
  const parsed = positiveInteger(value);
  return parsed === undefined ? undefined : Math.max(8, Math.round(parsed / 8) * 8);
}

function optionalWeight(value: unknown) {
  const parsed = finiteNumber(value);
  return parsed === undefined ? undefined : Math.min(2, Math.max(-2, Number(parsed.toFixed(2))));
}

function requiredString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function fixedSeed(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function normalizeSavedParameters(
  savedParameters: SavedComfyUiGenerationParams | null | undefined,
): GenerationStylePaletteParameters | undefined {
  if (!savedParameters) {
    return undefined;
  }

  const width = dimension(savedParameters.width);
  const height = dimension(savedParameters.height);
  const steps = positiveInteger(savedParameters.steps);
  const cfg = finiteNumber(savedParameters.cfg);
  const samplerName = requiredString(savedParameters.samplerName);
  const scheduler = requiredString(savedParameters.scheduler);
  const denoise = finiteNumber(savedParameters.denoise);

  if (
    width === undefined ||
    height === undefined ||
    steps === undefined ||
    cfg === undefined ||
    samplerName === undefined ||
    scheduler === undefined ||
    denoise === undefined
  ) {
    return undefined;
  }

  const seed = savedParameters.seedMode === "fixed" ? fixedSeed(savedParameters.seed) : undefined;

  return {
    width,
    height,
    steps,
    cfg: Number(cfg.toFixed(2)),
    samplerName,
    scheduler,
    denoise: Math.min(1, Math.max(0, Number(denoise.toFixed(2)))),
    ...(seed !== undefined ? { seed } : {}),
  };
}

export function createGenerationStylePaletteSnapshot({
  checkpointId,
  loraIds,
  savedParameters,
}: {
  checkpointId: string | null;
  loraIds: readonly string[];
  savedParameters?: SavedComfyUiGenerationParams | null;
}): GenerationStylePaletteSnapshot | undefined {
  const checkpoint = cleanId(checkpointId);

  if (!checkpoint) {
    return undefined;
  }

  const savedLoras = savedParameters?.loras ?? [];
  const loras = loraIds
    .map(cleanId)
    .filter((id): id is string => Boolean(id))
    .map((id, index) => {
      const savedLora = savedLoras[index];
      const strengthModel = optionalWeight(savedLora?.strengthModel);
      const strengthClip = optionalWeight(savedLora?.strengthClip);

      return {
        id,
        enabled: savedLora?.enabled ?? true,
        ...(strengthModel !== undefined ? { strengthModel } : {}),
        ...(strengthClip !== undefined ? { strengthClip } : {}),
      };
    });
  const parameters = normalizeSavedParameters(savedParameters);

  return {
    checkpointId: checkpoint,
    loras,
    ...(parameters ? { parameters } : {}),
  };
}

export function sanitizeGenerationStylePaletteSnapshot(value: unknown): GenerationStylePaletteSnapshot | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const checkpointId = cleanId(value.checkpointId);
  if (!checkpointId) {
    return undefined;
  }

  const loras = (Array.isArray(value.loras) ? value.loras : [])
    .filter(isRecord)
    .map((lora) => {
      const id = cleanId(lora.id);
      if (!id) {
        return null;
      }

      const strengthModel = optionalWeight(lora.strengthModel);
      const strengthClip = optionalWeight(lora.strengthClip);
      return {
        id,
        enabled: lora.enabled !== false,
        ...(strengthModel !== undefined ? { strengthModel } : {}),
        ...(strengthClip !== undefined ? { strengthClip } : {}),
      };
    })
    .filter((lora): lora is GenerationStylePaletteLoraSnapshot => Boolean(lora));
  const rawParameters = isRecord(value.parameters) ? value.parameters : undefined;
  const parameters = rawParameters
    ? normalizeSavedParameters({
        cfg: rawParameters.cfg as number,
        denoise: rawParameters.denoise as number,
        height: rawParameters.height as number,
        imageCount: 1,
        loras: [],
        outputPrefix: "SceneForge",
        samplerName: rawParameters.samplerName as string,
        savedAt: "",
        scheduler: rawParameters.scheduler as string,
        seed: fixedSeed(rawParameters.seed) ?? 0,
        seedMode: fixedSeed(rawParameters.seed) === undefined ? "random" : "fixed",
        steps: rawParameters.steps as number,
        width: rawParameters.width as number,
      })
    : undefined;

  return {
    checkpointId,
    loras,
    ...(parameters ? { parameters } : {}),
  };
}

export function createSavedParametersFromGenerationStylePalette(
  stylePalette: GenerationStylePaletteSnapshot | undefined,
  resources: SelectedCivitaiResourcesPreview,
): SavedComfyUiGenerationParams | null {
  if (!stylePalette?.parameters || !resources.checkpoint) {
    return null;
  }

  return {
    ...stylePalette.parameters,
    imageCount: 1,
    loras: stylePalette.loras.map((snapshot) => {
      const resource = resources.loras.find((candidate) => candidate.id === snapshot.id);
      return {
        loraName: resource?.modelFileName ?? snapshot.id,
        enabled: snapshot.enabled,
        strengthModel: snapshot.strengthModel ?? resource?.averageWeight ?? 1,
        strengthClip: snapshot.strengthClip ?? snapshot.strengthModel ?? resource?.averageWeight ?? 1,
      };
    }),
    outputPrefix: "SceneForge",
    savedAt: new Date(0).toISOString(),
    seed: stylePalette.parameters.seed ?? 0,
    seedMode: stylePalette.parameters.seed === undefined ? "random" : "fixed",
  };
}
