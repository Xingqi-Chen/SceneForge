import type { CivitaiLoraCategory, CivitaiPromptReference, CivitaiResourceRecommendation } from "@/features/civitai-lora-library";
import {
  COMFYUI_INPAINT_MODE_OPTIONS,
  DEFAULT_COMFYUI_INPAINT_MODE,
  MIN_COMFYUI_VAE_INPAINT_DENOISE,
  normalizeComfyUiInpaintDenoiseForMode,
  normalizeComfyUiInpaintMode,
  type ComfyUiInpaintMode,
} from "@/features/comfyui";
import type { LlmChatMessage } from "@/features/llm";

export type ComfyUiInpaintDiagnosisLoraConfig = {
  averageWeight?: number | null;
  categories?: CivitaiLoraCategory[];
  enabled: boolean;
  loraName: string;
  maxWeight?: number | null;
  minWeight?: number | null;
  recommendations?: CivitaiResourceRecommendation[];
  resourceName?: string;
  strengthClip: number;
  strengthModel: number;
  tags?: string[];
  trainedWords?: string[];
  usageGuide?: string | null;
};

export type ComfyUiInpaintDiagnosisConfig = {
  brushSize: number;
  checkpointBaseModel?: string | null;
  checkpointName: string;
  checkpointPromptReferences?: CivitaiPromptReference[];
  checkpointResourceName?: string;
  checkpointTags?: string[];
  denoise: number;
  faceDetailerEnabled: boolean;
  growMaskBy: number;
  handDetailerEnabled: boolean;
  image: {
    filename: string;
    height: number;
    seed: number;
    width: number;
  };
  loras: ComfyUiInpaintDiagnosisLoraConfig[];
  mode: ComfyUiInpaintMode;
  negativePrompt: string;
  positivePrompt: string;
};

export type ComfyUiInpaintDiagnosisPoint = {
  x: number;
  y: number;
};

export type ComfyUiInpaintDiagnosisMaskShape =
  | {
      brushSize?: number;
      points: ComfyUiInpaintDiagnosisPoint[];
      type: "stroke";
    }
  | {
      radiusX: number;
      radiusY: number;
      rotation?: number;
      type: "ellipse";
      x: number;
      y: number;
    }
  | {
      height: number;
      rotation?: number;
      type: "rect";
      width: number;
      x: number;
      y: number;
    }
  | {
      points: ComfyUiInpaintDiagnosisPoint[];
      type: "polygon";
    };

export type ComfyUiInpaintDiagnosisMask = {
  coverageEstimate: number | null;
  note: string;
  shapes: ComfyUiInpaintDiagnosisMaskShape[];
};

export type ComfyUiInpaintDiagnosisAdjustments = {
  brushSize?: number;
  denoise?: number;
  faceDetailerEnabled?: boolean;
  growMaskBy?: number;
  handDetailerEnabled?: boolean;
  mode?: ComfyUiInpaintMode;
  negativePrompt?: string;
  positivePrompt?: string;
  seed?: number;
};

export type ComfyUiInpaintDiagnosisChangeRationale = {
  expectedEffect: string;
  field: string;
  reason: string;
  risk: string;
};

export type ComfyUiInpaintDiagnosisResult = {
  adjustments: ComfyUiInpaintDiagnosisAdjustments;
  changeRationale: ComfyUiInpaintDiagnosisChangeRationale[];
  confidence: number | null;
  ignored: string[];
  mask: ComfyUiInpaintDiagnosisMask;
  reasoning: string;
  summary: string;
  warnings: string[];
};

export type BuildComfyUiInpaintDiagnosisMessagesInput = {
  config: ComfyUiInpaintDiagnosisConfig;
  imageDataUrl: string;
  userInput: string;
};

const MAX_SEED = Number.MAX_SAFE_INTEGER;
const MAX_GROW_MASK_BY = 512;
const MIN_BRUSH_SIZE = 4;
const MAX_AI_BRUSH_SIZE = 64;
const MAX_AI_BRUSH_SIZE_RATIO = 0.045;

type CoordinateUnit = "normalized" | "percent" | "pixel";

type MaskSanitizeContext = {
  coordinateUnit?: CoordinateUnit;
  imageHeight?: number;
  imageWidth?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeName(value: string) {
  return value.trim().toLowerCase();
}

function readString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function readStringAllowEmpty(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") {
      return value.trim();
    }
  }

  return undefined;
}

function readNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string") {
      const match = value.trim().match(/-?\d+(?:\.\d+)?/);
      const parsed = match ? Number(match[0]) : Number.NaN;
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return undefined;
}

function readBoolean(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value === "string") {
      const normalized = normalizeName(value);
      if (["true", "yes", "enabled", "enable", "on"].includes(normalized)) {
        return true;
      }

      if (["false", "no", "disabled", "disable", "off"].includes(normalized)) {
        return false;
      }
    }
  }

  return undefined;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function parseJsonCandidate(rawContent: string) {
  const trimmed = rawContent.trim();

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    // Continue to fenced JSON fallback.
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (!fenced?.[1]) {
    return null;
  }

  try {
    return JSON.parse(fenced[1].trim()) as unknown;
  } catch {
    return null;
  }
}

function readWarnings(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
}

function readConfidence(value: unknown) {
  const parsed = typeof value === "number" && Number.isFinite(value) ? value : undefined;
  return parsed === undefined ? null : Number(clampNumber(parsed, 0, 1).toFixed(2));
}

function sanitizeDenoise(value: unknown) {
  const parsed = typeof value === "number" && Number.isFinite(value) ? value : undefined;
  return parsed === undefined ? undefined : Number(clampNumber(parsed, 0, 1).toFixed(3));
}

function sanitizePositiveInteger(value: unknown, max: number) {
  const parsed = typeof value === "number" && Number.isFinite(value) ? value : undefined;
  if (parsed === undefined || parsed < 0) {
    return undefined;
  }

  return clampNumber(Math.round(parsed), 0, max);
}

function getAiBrushSizeMax(context?: MaskSanitizeContext) {
  const shortestSide = context?.imageWidth && context.imageHeight
    ? Math.min(context.imageWidth, context.imageHeight)
    : undefined;
  if (!shortestSide) {
    return MAX_AI_BRUSH_SIZE;
  }

  return clampNumber(Math.round(shortestSide * MAX_AI_BRUSH_SIZE_RATIO), MIN_BRUSH_SIZE, MAX_AI_BRUSH_SIZE);
}

function sanitizeBrushSize(value: unknown, context?: MaskSanitizeContext) {
  const parsed = typeof value === "number" && Number.isFinite(value) ? value : undefined;
  if (parsed === undefined || parsed < 0) {
    return undefined;
  }

  const max = getAiBrushSizeMax(context);
  const resolved = parsed > 0 && parsed <= 1 && context?.imageWidth && context.imageHeight
    ? parsed * Math.min(context.imageWidth, context.imageHeight)
    : parsed;

  return clampNumber(Math.round(resolved), MIN_BRUSH_SIZE, max);
}

function sanitizeSeed(value: unknown) {
  const parsed = typeof value === "number" && Number.isFinite(value) ? value : undefined;
  if (parsed === undefined || parsed < 0) {
    return undefined;
  }

  return clampNumber(Math.round(parsed), 0, MAX_SEED);
}

function readCoordinateUnit(record: Record<string, unknown>) {
  const rawUnit = readString(record, ["coordinateUnit", "unit", "coordinates"]);
  const normalized = rawUnit ? normalizeName(rawUnit).replace(/[^a-z0-9]+/g, "") : "";
  if (["normalized", "normalised", "relative", "ratio", "01", "zerotoone"].includes(normalized)) {
    return "normalized";
  }

  if (["percent", "percentage", "pct", "0100"].includes(normalized)) {
    return "percent";
  }

  if (["pixel", "pixels", "px", "imagepixel", "imagepixels"].includes(normalized)) {
    return "pixel";
  }

  return undefined;
}

function sanitizeNormalizedNumber(value: unknown, dimension?: number, unit?: CoordinateUnit) {
  const parsed = typeof value === "number" && Number.isFinite(value) ? value : undefined;
  if (parsed === undefined) {
    return undefined;
  }

  let normalized = parsed;
  if (unit === "percent") {
    normalized = parsed / 100;
  } else if (unit === "pixel") {
    normalized = dimension && dimension > 0 ? parsed / dimension : parsed;
  } else if (unit !== "normalized" && parsed > 1) {
    normalized = parsed <= 2
      ? parsed
      : parsed <= 100
      ? parsed / 100
      : dimension && dimension > 0
        ? parsed / dimension
        : parsed;
  }

  return Number(clampNumber(normalized, 0, 1).toFixed(4));
}

function sanitizePositiveNormalizedNumber(value: unknown, dimension?: number, unit?: CoordinateUnit) {
  const parsed = sanitizeNormalizedNumber(value, dimension, unit);
  return parsed === undefined || parsed <= 0 ? undefined : parsed;
}

function sanitizeRotation(value: unknown) {
  const parsed = typeof value === "number" && Number.isFinite(value) ? value : undefined;
  if (parsed === undefined) {
    return undefined;
  }

  return Number(clampNumber(parsed, -180, 180).toFixed(2));
}

function sanitizePoint(value: unknown, context?: MaskSanitizeContext): ComfyUiInpaintDiagnosisPoint | null {
  if (Array.isArray(value)) {
    const x = sanitizeNormalizedNumber(value[0], context?.imageWidth, context?.coordinateUnit);
    const y = sanitizeNormalizedNumber(value[1], context?.imageHeight, context?.coordinateUnit);
    return x === undefined || y === undefined ? null : { x, y };
  }

  if (!isRecord(value)) {
    return null;
  }

  const coordinateUnit = readCoordinateUnit(value) ?? context?.coordinateUnit;
  const x = sanitizeNormalizedNumber(readNumber(value, ["x", "left"]), context?.imageWidth, coordinateUnit);
  const y = sanitizeNormalizedNumber(readNumber(value, ["y", "top"]), context?.imageHeight, coordinateUnit);
  return x === undefined || y === undefined ? null : { x, y };
}

function sanitizePoints(value: unknown, context?: MaskSanitizeContext) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((point) => sanitizePoint(point, context)).filter((point): point is ComfyUiInpaintDiagnosisPoint => point !== null);
}

function readShapeType(shape: Record<string, unknown>) {
  const rawType = readString(shape, ["type", "kind", "shape"]);
  const normalized = rawType ? normalizeName(rawType).replace(/[_\s-]+/g, "") : "";

  if (["stroke", "brush", "path", "line"].includes(normalized)) {
    return "stroke";
  }

  if (["ellipse", "oval", "circle"].includes(normalized)) {
    return "ellipse";
  }

  if (["rect", "rectangle", "box"].includes(normalized)) {
    return "rect";
  }

  if (["polygon", "poly"].includes(normalized)) {
    return "polygon";
  }

  return null;
}

function sanitizeMaskShape(value: unknown, ignored: string[], context?: MaskSanitizeContext): ComfyUiInpaintDiagnosisMaskShape | null {
  if (!isRecord(value)) {
    ignored.push("Ignored invalid mask shape.");
    return null;
  }

  const shapeContext = {
    ...context,
    coordinateUnit: readCoordinateUnit(value) ?? context?.coordinateUnit,
  };
  const type = readShapeType(value);
  if (!type) {
    ignored.push("Ignored mask shape without a supported type.");
    return null;
  }

  if (type === "stroke") {
    const points = sanitizePoints(value.points, shapeContext);
    if (points.length === 0) {
      ignored.push("Ignored stroke mask shape without valid points.");
      return null;
    }

    const brushSize = sanitizeBrushSize(readNumber(value, ["brushSize", "size", "strokeWidth"]), shapeContext);
    return {
      type,
      points,
      ...(brushSize !== undefined ? { brushSize } : {}),
    };
  }

  if (type === "polygon") {
    const points = sanitizePoints(value.points, shapeContext);
    if (points.length < 3) {
      ignored.push("Ignored polygon mask shape with fewer than three points.");
      return null;
    }

    return {
      type,
      points,
    };
  }

  if (type === "ellipse") {
    const x = sanitizeNormalizedNumber(readNumber(value, ["x", "centerX", "cx"]), shapeContext.imageWidth, shapeContext.coordinateUnit);
    const y = sanitizeNormalizedNumber(readNumber(value, ["y", "centerY", "cy"]), shapeContext.imageHeight, shapeContext.coordinateUnit);
    const radiusX = sanitizePositiveNormalizedNumber(
      readNumber(value, ["radiusX", "rx"]) ?? (readNumber(value, ["width", "w"]) ?? 0) / 2,
      shapeContext.imageWidth,
      shapeContext.coordinateUnit,
    );
    const radiusY = sanitizePositiveNormalizedNumber(
      readNumber(value, ["radiusY", "ry"]) ?? (readNumber(value, ["height", "h"]) ?? 0) / 2,
      shapeContext.imageHeight,
      shapeContext.coordinateUnit,
    );

    if (x === undefined || y === undefined || radiusX === undefined || radiusY === undefined) {
      ignored.push("Ignored ellipse mask shape with invalid geometry.");
      return null;
    }

    const rotation = sanitizeRotation(readNumber(value, ["rotation", "angle"]));
    return {
      type,
      x,
      y,
      radiusX,
      radiusY,
      ...(rotation !== undefined ? { rotation } : {}),
    };
  }

  const width = sanitizePositiveNormalizedNumber(readNumber(value, ["width", "w"]), shapeContext.imageWidth, shapeContext.coordinateUnit);
  const height = sanitizePositiveNormalizedNumber(readNumber(value, ["height", "h"]), shapeContext.imageHeight, shapeContext.coordinateUnit);
  const centerX = sanitizeNormalizedNumber(readNumber(value, ["centerX", "cx"]), shapeContext.imageWidth, shapeContext.coordinateUnit);
  const centerY = sanitizeNormalizedNumber(readNumber(value, ["centerY", "cy"]), shapeContext.imageHeight, shapeContext.coordinateUnit);
  const left = sanitizeNormalizedNumber(readNumber(value, ["left", "x"]), shapeContext.imageWidth, shapeContext.coordinateUnit);
  const top = sanitizeNormalizedNumber(readNumber(value, ["top", "y"]), shapeContext.imageHeight, shapeContext.coordinateUnit);
  const x = centerX ?? (left !== undefined && width !== undefined ? left + width / 2 : undefined);
  const y = centerY ?? (top !== undefined && height !== undefined ? top + height / 2 : undefined);

  if (x === undefined || y === undefined || width === undefined || height === undefined) {
    ignored.push("Ignored rect mask shape with invalid geometry.");
    return null;
  }

  const rotation = sanitizeRotation(readNumber(value, ["rotation", "angle"]));
  return {
    type,
    x: Number(clampNumber(x, 0, 1).toFixed(4)),
    y: Number(clampNumber(y, 0, 1).toFixed(4)),
    width,
    height,
    ...(rotation !== undefined ? { rotation } : {}),
  };
}

function sanitizeMask(value: unknown, ignored: string[], context?: MaskSanitizeContext): ComfyUiInpaintDiagnosisMask {
  const maskRecord = isRecord(value) ? value : {};
  const maskContext = {
    ...context,
    coordinateUnit: readCoordinateUnit(maskRecord) ?? context?.coordinateUnit,
  };
  const rawShapes = Array.isArray(maskRecord.shapes)
    ? maskRecord.shapes
    : Array.isArray(maskRecord.maskShapes)
      ? maskRecord.maskShapes
      : [];
  const shapes = rawShapes
    .map((shape) => sanitizeMaskShape(shape, ignored, maskContext))
    .filter((shape): shape is ComfyUiInpaintDiagnosisMaskShape => shape !== null);

  if (rawShapes.length > 0 && shapes.length === 0) {
    ignored.push("Ignored empty or invalid AI mask suggestion.");
  }

  return {
    coverageEstimate: readConfidence(maskRecord.coverageEstimate),
    note: readString(maskRecord, ["note", "maskNote", "reason"]) ?? "",
    shapes,
  };
}

function sanitizeAdjustments(value: unknown, context?: MaskSanitizeContext): ComfyUiInpaintDiagnosisAdjustments {
  if (!isRecord(value)) {
    return {};
  }

  const mode = normalizeComfyUiInpaintMode(readString(value, ["mode", "inpaintMode"]));
  const positivePrompt = readString(value, ["positivePrompt", "prompt"]);
  const negativePrompt = readStringAllowEmpty(value, ["negativePrompt"]);
  const denoise = sanitizeDenoise(readNumber(value, ["denoise"]));
  const growMaskBy = sanitizePositiveInteger(readNumber(value, ["growMaskBy", "growMask", "maskGrow"]), MAX_GROW_MASK_BY);
  const seed = sanitizeSeed(readNumber(value, ["seed"]));
  const brushSize = sanitizeBrushSize(readNumber(value, ["brushSize"]), context);
  const faceDetailerEnabled = readBoolean(value, ["faceDetailerEnabled", "faceDetailer"]);
  const handDetailerEnabled = readBoolean(value, ["handDetailerEnabled", "handDetailer"]);

  return {
    ...(positivePrompt !== undefined ? { positivePrompt } : {}),
    ...(negativePrompt !== undefined ? { negativePrompt } : {}),
    ...(denoise !== undefined ? { denoise } : {}),
    ...(growMaskBy !== undefined ? { growMaskBy } : {}),
    ...(mode !== undefined ? { mode } : {}),
    ...(seed !== undefined ? { seed } : {}),
    ...(brushSize !== undefined ? { brushSize } : {}),
    ...(faceDetailerEnabled !== undefined ? { faceDetailerEnabled } : {}),
    ...(handDetailerEnabled !== undefined ? { handDetailerEnabled } : {}),
  };
}

function readChangeRationale(value: unknown): ComfyUiInpaintDiagnosisChangeRationale[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const rationales: ComfyUiInpaintDiagnosisChangeRationale[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }

    const field = readString(item, ["field"]);
    if (!field) {
      continue;
    }

    rationales.push({
      expectedEffect: readString(item, ["expectedEffect"]) ?? "",
      field,
      reason: readString(item, ["reason"]) ?? "",
      risk: readString(item, ["risk"]) ?? "",
    });
  }

  return rationales;
}

function compactInpaintConfigForLlm(config: ComfyUiInpaintDiagnosisConfig) {
  return {
    ...config,
    checkpointPromptReferences: config.checkpointPromptReferences?.slice(0, 1).map((reference) => ({
      cfgScale: reference.cfgScale,
      negativePrompt: reference.negativePrompt,
      prompt: reference.prompt,
      sampler: reference.sampler,
      seed: reference.seed,
      steps: reference.steps,
    })),
    loras: config.loras.map((lora) => ({
      averageWeight: lora.averageWeight,
      categories: lora.categories,
      enabled: lora.enabled,
      loraName: lora.loraName,
      maxWeight: lora.maxWeight,
      minWeight: lora.minWeight,
      recommendations: lora.recommendations,
      resourceName: lora.resourceName,
      strengthClip: lora.strengthClip,
      strengthModel: lora.strengthModel,
      tags: lora.tags,
      trainedWords: lora.trainedWords,
      usageGuide: lora.usageGuide,
    })),
    supportedInpaintModes: COMFYUI_INPAINT_MODE_OPTIONS.map((option) => option.value),
  };
}

export function buildComfyUiInpaintDiagnosisMessages({
  config,
  imageDataUrl,
  userInput,
}: BuildComfyUiInpaintDiagnosisMessagesInput): LlmChatMessage[] {
  return [
    {
      role: "system",
      content: [
        "You are an expert Stable Diffusion and ComfyUI inpainting diagnostician.",
        "Analyze the selected image and the user's inpaint goal, then propose a mask, prompt edits, and local inpaint-only parameter adjustments.",
        "Return JSON only. Do not wrap it in markdown.",
        "Schema: { \"summary\": string, \"reasoning\": string, \"mask\": { \"note\"?: string, \"coverageEstimate\"?: number, \"coordinateUnit\"?: \"normalized\"|\"percent\"|\"pixel\", \"shapes\": [{ \"type\": \"stroke\", \"points\": [{\"x\": number, \"y\": number}], \"brushSize\"?: number } | { \"type\": \"ellipse\", \"x\": number, \"y\": number, \"radiusX\": number, \"radiusY\": number, \"rotation\"?: number } | { \"type\": \"rect\", \"x\": number, \"y\": number, \"width\": number, \"height\": number, \"rotation\"?: number } | { \"type\": \"polygon\", \"points\": [{\"x\": number, \"y\": number}] }] }, \"adjustments\": { \"positivePrompt\"?: string, \"negativePrompt\"?: string, \"denoise\"?: number, \"growMaskBy\"?: number, \"mode\"?: \"latent-noise-mask\"|\"vae-inpaint\", \"seed\"?: number, \"brushSize\"?: number, \"faceDetailerEnabled\"?: boolean, \"handDetailerEnabled\"?: boolean }, \"confidence\": number, \"changeRationale\"?: [{ \"field\": string, \"reason\": string, \"expectedEffect\": string, \"risk\": string }], \"warnings\"?: string[] }.",
        "All mask coordinates and sizes must be normalized to image space from 0 to 1, where x=0/y=0 is top-left and x=1/y=1 is bottom-right.",
        "For rect shapes, x and y mean the top-left corner. Use centerX/centerY only if you intentionally want to provide the rectangle center.",
        "For ellipse shapes, x and y mean the ellipse center.",
        "Prefer ellipse or polygon shapes for compact local repairs. Use stroke only for thin features. If using stroke, keep brushSize in image pixels between 8 and 48, or omit brushSize.",
        "Only mask pixels that should be changed or repaired. Keep masks focused and avoid covering the whole subject unless the user explicitly asks for a broad repaint.",
        "You may not change checkpoint, LoRA list, LoRA weights, CFG, steps, sampler, scheduler, resolution, output prefix, or prompt wrapper.",
        "If currentConfig.checkpointPromptReferences is present, use them only as format references. Do not copy their subject, character, composition, or scene unless the user explicitly asks for it.",
        `Prefer conservative inpaint settings: denoise around 0.35-0.75 for repairs, higher only for replacement. For vae-inpaint, denoise must be at least ${MIN_COMFYUI_VAE_INPAINT_DENOISE} to avoid neutral gray masked regions.`,
        "Write summary, reasoning, warnings, changeRationale, and mask note in Simplified Chinese.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              currentConfig: compactInpaintConfigForLlm(config),
              imageNote: "The original selected image was sent without client-side downscaling.",
              maskCoordinateGuidance: `Use the full ${config.image.width}x${config.image.height} image coordinate space. Do not estimate coordinates from a cropped thumbnail.`,
              task: "inpaint-diagnosis",
              userInpaintRequest: userInput.trim() || "请诊断当前图片中适合局部重绘的区域，并给出 mask、prompt 和 inpaint 参数建议。",
            },
            null,
            2,
          ),
        },
        {
          type: "image_url",
          image_url: {
            detail: "high",
            url: imageDataUrl,
          },
        },
      ],
    },
  ];
}

export function parseComfyUiInpaintDiagnosisResponse(
  rawContent: string,
  current?: ComfyUiInpaintDiagnosisConfig,
): ComfyUiInpaintDiagnosisResult | null {
  const parsed = parseJsonCandidate(rawContent);
  if (!isRecord(parsed)) {
    return null;
  }

  const ignored: string[] = [];
  const context: MaskSanitizeContext | undefined = current
    ? {
        imageHeight: current.image.height,
        imageWidth: current.image.width,
      }
    : undefined;
  const mask = sanitizeMask(parsed.mask, ignored, context);

  return {
    adjustments: sanitizeAdjustments(parsed.adjustments, context),
    changeRationale: readChangeRationale(parsed.changeRationale),
    confidence: readConfidence(parsed.confidence),
    ignored,
    mask,
    reasoning: readString(parsed, ["reasoning"]) ?? "",
    summary: readString(parsed, ["summary"]) ?? "",
    warnings: readWarnings(parsed.warnings),
  };
}

export function applyComfyUiInpaintDiagnosisAdjustments(
  current: ComfyUiInpaintDiagnosisConfig,
  adjustments: ComfyUiInpaintDiagnosisAdjustments,
): ComfyUiInpaintDiagnosisConfig {
  const mode = adjustments.mode ?? current.mode ?? DEFAULT_COMFYUI_INPAINT_MODE;
  const denoise = normalizeComfyUiInpaintDenoiseForMode(adjustments.denoise ?? current.denoise, mode);

  return {
    ...current,
    brushSize: adjustments.brushSize ?? current.brushSize,
    denoise,
    faceDetailerEnabled: adjustments.faceDetailerEnabled ?? current.faceDetailerEnabled,
    growMaskBy: adjustments.growMaskBy ?? current.growMaskBy,
    handDetailerEnabled: adjustments.handDetailerEnabled ?? current.handDetailerEnabled,
    mode,
    negativePrompt: adjustments.negativePrompt ?? current.negativePrompt,
    positivePrompt: adjustments.positivePrompt ?? current.positivePrompt,
    image: {
      ...current.image,
      seed: adjustments.seed ?? current.image.seed,
    },
  };
}

export function hasComfyUiInpaintDiagnosisMask(result: ComfyUiInpaintDiagnosisResult | null) {
  return Boolean(result && result.mask.shapes.length > 0);
}
