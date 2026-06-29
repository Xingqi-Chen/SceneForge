import type { SavedComfyUiGenerationParams } from "@/shared/types";

export type StoryStylePaletteLoraSnapshot = {
  id: string;
  enabled: boolean;
  strengthModel?: number;
  strengthClip?: number;
};

export type StoryStylePaletteGenerationParameters = {
  width: number;
  height: number;
  steps: number;
  cfg: number;
  samplerName: string;
  scheduler: string;
  denoise: number;
  seed?: number;
};

export type StoryStylePaletteSnapshot = {
  checkpointId?: string;
  loras: StoryStylePaletteLoraSnapshot[];
  parameters?: StoryStylePaletteGenerationParameters;
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
): StoryStylePaletteGenerationParameters | undefined {
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

export function createStoryStylePaletteSnapshot({
  checkpointId,
  loraIds,
  savedParameters,
}: {
  checkpointId: string | null;
  loraIds: readonly string[];
  savedParameters?: SavedComfyUiGenerationParams | null;
}): StoryStylePaletteSnapshot | undefined {
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

export function sanitizeStoryStylePaletteSnapshot(value: unknown): StoryStylePaletteSnapshot | undefined {
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
    .filter((lora): lora is StoryStylePaletteLoraSnapshot => Boolean(lora));
  const parameters = isRecord(value.parameters)
    ? normalizeSavedParameters({
        cfg: value.parameters.cfg as number,
        denoise: value.parameters.denoise as number,
        height: value.parameters.height as number,
        imageCount: 1,
        loras: [],
        outputPrefix: "SceneForge",
        samplerName: value.parameters.samplerName as string,
        savedAt: "",
        scheduler: value.parameters.scheduler as string,
        seed: fixedSeed(value.parameters.seed) ?? 0,
        seedMode: fixedSeed(value.parameters.seed) === undefined ? "random" : "fixed",
        steps: value.parameters.steps as number,
        width: value.parameters.width as number,
      })
    : undefined;

  return {
    checkpointId,
    loras,
    ...(parameters ? { parameters } : {}),
  };
}
