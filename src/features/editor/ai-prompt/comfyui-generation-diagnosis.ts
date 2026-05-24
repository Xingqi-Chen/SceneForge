import type { LlmChatMessage } from "@/features/llm";
import type { CivitaiLoraCategory, CivitaiPromptReference, CivitaiResourceRecommendation } from "@/features/civitai-lora-library";

import type { ComfyUiGenerationSeedMode } from "./comfyui-generation-seed";
import { normalizeComfyUiSamplerSettings } from "./comfyui-generation-options";

export type ComfyUiGenerationDiagnosisLoraConfig = {
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

export type ComfyUiGenerationDiagnosisConfig = {
  checkpointBaseModel?: string | null;
  cfg: number;
  checkpointName: string;
  checkpointPromptReferences?: CivitaiPromptReference[];
  checkpointResourceName?: string;
  checkpointTags?: string[];
  denoise: number;
  height: number;
  imageCount: number;
  loras: ComfyUiGenerationDiagnosisLoraConfig[];
  negativePrompt: string;
  outputPrefix: string;
  positivePrompt: string;
  samplerName: string;
  scheduler: string;
  seed: number;
  seedMode: ComfyUiGenerationSeedMode;
  steps: number;
  width: number;
};

export type ComfyUiGenerationDiagnosisLoraAdjustment = {
  enabled?: boolean;
  loraName: string;
  reason?: string;
  strengthClip?: number;
  strengthModel?: number;
};

export type ComfyUiGenerationDiagnosisObservation = {
  category: string;
  evidence: string;
  fixDirection: string;
  likelyCause: string;
  severity: string;
};

export type ComfyUiGenerationVisualDiagnosisResult = {
  confidence: number | null;
  loraInfluence: string;
  observations: ComfyUiGenerationDiagnosisObservation[];
  promptAlignment: string;
  summary: string;
  warnings: string[];
};

export type ComfyUiGenerationDiagnosisChangeRationale = {
  expectedEffect: string;
  field: string;
  reason: string;
  risk: string;
};

export type ComfyUiDiagnosisWebSource = {
  content: string;
  domain: string;
  query: string;
  relevance: string;
  score?: number;
  title: string;
  url: string;
};

export type ComfyUiDiagnosisWebContext = {
  enabled: boolean;
  queries: string[];
  sources: ComfyUiDiagnosisWebSource[];
  summary: string;
  warnings: string[];
};

export type ComfyUiGenerationDiagnosisAdjustments = {
  cfg?: number;
  denoise?: number;
  height?: number;
  loras?: ComfyUiGenerationDiagnosisLoraAdjustment[];
  negativePrompt?: string;
  positivePrompt?: string;
  samplerName?: string;
  scheduler?: string;
  seed?: number;
  seedMode?: ComfyUiGenerationSeedMode;
  steps?: number;
  width?: number;
};

export type ComfyUiGenerationDiagnosisResult = {
  adjustments: ComfyUiGenerationDiagnosisAdjustments;
  changeRationale: ComfyUiGenerationDiagnosisChangeRationale[];
  confidence: number | null;
  ignored: string[];
  reasoning: string;
  summary: string;
  warnings: string[];
};

export type BuildComfyUiGenerationDiagnosisMessagesInput = {
  config: ComfyUiGenerationDiagnosisConfig;
  imageDataUrl: string;
  userInput: string;
};

export type BuildComfyUiGenerationAdjustmentMessagesInput = {
  config: ComfyUiGenerationDiagnosisConfig;
  userInput: string;
  visualDiagnosis: ComfyUiGenerationVisualDiagnosisResult;
  webContext?: ComfyUiDiagnosisWebContext | null;
};

const MAX_DIMENSION = 16384;
const MIN_DIMENSION = 16;
const MAX_STEPS = 1000;
const MAX_SEED = Number.MAX_SAFE_INTEGER;

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

function sanitizeDimension(value: unknown) {
  const parsed = typeof value === "number" && Number.isFinite(value) ? value : undefined;
  if (parsed === undefined || parsed <= 0) {
    return undefined;
  }

  return clampNumber(Math.round(parsed / 8) * 8, MIN_DIMENSION, MAX_DIMENSION);
}

function sanitizePositiveInteger(value: unknown, max = MAX_STEPS) {
  const parsed = typeof value === "number" && Number.isFinite(value) ? value : undefined;
  if (parsed === undefined || parsed <= 0) {
    return undefined;
  }

  return clampNumber(Math.round(parsed), 1, max);
}

function sanitizeSafeSeed(value: unknown) {
  const parsed = typeof value === "number" && Number.isFinite(value) ? value : undefined;
  if (parsed === undefined || parsed < 0) {
    return undefined;
  }

  return clampNumber(Math.round(parsed), 0, MAX_SEED);
}

function sanitizeDenoise(value: unknown) {
  const parsed = typeof value === "number" && Number.isFinite(value) ? value : undefined;
  return parsed === undefined ? undefined : clampNumber(parsed, 0, 1);
}

function sanitizeWeight(value: unknown) {
  const parsed = typeof value === "number" && Number.isFinite(value) ? value : undefined;
  return parsed === undefined ? undefined : Number(clampNumber(parsed, -2, 2).toFixed(2));
}

function sanitizeSeedMode(value: unknown): ComfyUiGenerationSeedMode | undefined {
  return value === "random" || value === "fixed" ? value : undefined;
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

function findCurrentLora(
  current: ComfyUiGenerationDiagnosisConfig,
  value: string | undefined,
) {
  if (!value) {
    return undefined;
  }

  const normalized = normalizeName(value);
  return current.loras.find((lora) => {
    const loraName = normalizeName(lora.loraName);
    const resourceName = lora.resourceName ? normalizeName(lora.resourceName) : "";
    return loraName === normalized || resourceName === normalized;
  });
}

function sanitizeLoraAdjustments(
  value: unknown,
  current: ComfyUiGenerationDiagnosisConfig,
  ignored: string[],
) {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const results = new Map<string, ComfyUiGenerationDiagnosisLoraAdjustment>();

  for (const entry of value) {
    if (!isRecord(entry)) {
      ignored.push("Ignored invalid LoRA adjustment.");
      continue;
    }

    const loraName = readString(entry, ["loraName", "name", "resourceName"]);
    const currentLora = findCurrentLora(current, loraName);
    if (!currentLora) {
      ignored.push(loraName ? `Ignored unknown LoRA: ${loraName}.` : "Ignored LoRA adjustment without a name.");
      continue;
    }

    const adjustment: ComfyUiGenerationDiagnosisLoraAdjustment = {
      loraName: currentLora.loraName,
    };
    const enabled = readBoolean(entry, ["enabled", "use", "active"]);
    const strengthModel = sanitizeWeight(readNumber(entry, ["strengthModel", "suggestedWeight", "weight", "strength"]));
    const strengthClip = sanitizeWeight(readNumber(entry, ["strengthClip", "clipWeight", "clipStrength"]));
    const reason = readString(entry, ["reason"]);

    if (enabled !== undefined) {
      adjustment.enabled = enabled;
    }

    if (strengthModel !== undefined) {
      adjustment.strengthModel = strengthModel;
    }

    if (strengthClip !== undefined) {
      adjustment.strengthClip = strengthClip;
    }

    if (reason) {
      adjustment.reason = reason;
    }

    if (
      adjustment.enabled === undefined &&
      adjustment.strengthModel === undefined &&
      adjustment.strengthClip === undefined
    ) {
      ignored.push(`Ignored LoRA adjustment without usable changes: ${currentLora.loraName}.`);
      continue;
    }

    results.set(currentLora.loraName, adjustment);
  }

  return results.size > 0 ? Array.from(results.values()) : undefined;
}

function sanitizeAdjustments(
  value: unknown,
  current: ComfyUiGenerationDiagnosisConfig,
  ignored: string[],
): ComfyUiGenerationDiagnosisAdjustments {
  if (!isRecord(value)) {
    return {};
  }

  if ("checkpoint" in value || "checkpointName" in value) {
    ignored.push("Ignored checkpoint change suggestion.");
  }

  const adjustments: ComfyUiGenerationDiagnosisAdjustments = {};
  const positivePrompt = readString(value, ["positivePrompt", "prompt"]);
  const negativePrompt = readStringAllowEmpty(value, ["negativePrompt"]);
  const rawSamplerName = readString(value, ["samplerName", "sampler"]);
  const rawScheduler = readString(value, ["scheduler"]);
  const samplerSettings = normalizeComfyUiSamplerSettings({
    samplerName: rawSamplerName,
    scheduler: rawScheduler,
  });
  const width = sanitizeDimension(readNumber(value, ["width"]));
  const height = sanitizeDimension(readNumber(value, ["height"]));
  const steps = sanitizePositiveInteger(readNumber(value, ["steps"]));
  const cfg = readNumber(value, ["cfg", "cfgScale", "cfg_scale"]);
  const denoise = sanitizeDenoise(readNumber(value, ["denoise"]));
  const seed = sanitizeSafeSeed(readNumber(value, ["seed"]));
  const seedMode = sanitizeSeedMode(value.seedMode);
  const loras = sanitizeLoraAdjustments(value.loras, current, ignored);

  if (positivePrompt) {
    adjustments.positivePrompt = positivePrompt;
  }

  if (negativePrompt !== undefined) {
    adjustments.negativePrompt = negativePrompt;
  }

  if (rawSamplerName && !samplerSettings.samplerName) {
    ignored.push(`Ignored unsupported sampler suggestion: ${rawSamplerName}.`);
  }

  if (samplerSettings.samplerName) {
    adjustments.samplerName = samplerSettings.samplerName;
  }

  if (rawScheduler && !samplerSettings.scheduler) {
    ignored.push(`Ignored unsupported scheduler suggestion: ${rawScheduler}.`);
  }

  if (samplerSettings.scheduler) {
    adjustments.scheduler = samplerSettings.scheduler;
  }

  if (width !== undefined) {
    adjustments.width = width;
  }

  if (height !== undefined) {
    adjustments.height = height;
  }

  if (steps !== undefined) {
    adjustments.steps = steps;
  }

  if (cfg !== undefined && Number.isFinite(cfg)) {
    adjustments.cfg = cfg;
  }

  if (denoise !== undefined) {
    adjustments.denoise = denoise;
  }

  if (seedMode !== undefined) {
    adjustments.seedMode = seedMode;
  }

  if (seed !== undefined) {
    adjustments.seed = seed;
    if (adjustments.seedMode === undefined) {
      adjustments.seedMode = "fixed";
    }
  }

  if (loras) {
    adjustments.loras = loras;
  }

  return adjustments;
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

function readDiagnosisObservations(value: unknown): ComfyUiGenerationDiagnosisObservation[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const observations: ComfyUiGenerationDiagnosisObservation[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }

    observations.push({
      category: readString(item, ["category"]) ?? "general",
      evidence: readString(item, ["evidence"]) ?? "",
      fixDirection: readString(item, ["fixDirection", "fix"]) ?? "",
      likelyCause: readString(item, ["likelyCause", "cause"]) ?? "",
      severity: readString(item, ["severity"]) ?? "medium",
    });
  }

  return observations;
}

function readChangeRationale(value: unknown): ComfyUiGenerationDiagnosisChangeRationale[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const rationales: ComfyUiGenerationDiagnosisChangeRationale[] = [];
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

function compactDiagnosisConfigForLlm(config: ComfyUiGenerationDiagnosisConfig) {
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
  };
}

export function buildComfyUiGenerationDiagnosisMessages({
  config,
  imageDataUrl,
  userInput,
}: BuildComfyUiGenerationDiagnosisMessagesInput): LlmChatMessage[] {
  return [
    {
      role: "system",
      content: [
        "You are an expert Stable Diffusion and ComfyUI image generation diagnostician.",
        "Analyze the generated image against the user's requested diagnosis and the current ComfyUI configuration.",
        "Return JSON only. Do not wrap it in markdown.",
        "Schema: { \"summary\": string, \"reasoning\": string, \"adjustments\": { \"positivePrompt\"?: string, \"negativePrompt\"?: string, \"width\"?: number, \"height\"?: number, \"steps\"?: number, \"cfg\"?: number, \"samplerName\"?: string, \"scheduler\"?: string, \"denoise\"?: number, \"seedMode\"?: \"random\"|\"fixed\", \"seed\"?: number, \"loras\"?: [{ \"loraName\": string, \"enabled\"?: boolean, \"strengthModel\"?: number, \"strengthClip\"?: number, \"reason\"?: string }] }, \"warnings\"?: string[] }.",
        "If changing sampler settings, return ComfyUI samplerName and scheduler separately. Do not combine scheduler words into samplerName.",
        "Do not suggest a new checkpoint or new LoRA. You may only adjust or disable LoRAs already listed in currentConfig.loras.",
        "If currentConfig.checkpointPromptReferences is present, use those prompts only as format and phrasing references for the current checkpoint. Do not copy their subject, character, composition, or scene unless the user explicitly asks for it.",
        "Prefer practical, conservative changes that can be applied before the next ComfyUI run.",
        "Write summary, reasoning, warnings, and LoRA reasons in Simplified Chinese.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              userDiagnosisRequest: userInput.trim() || "请根据当前图片诊断并优化下一次 ComfyUI 生图配置。",
              currentConfig: compactDiagnosisConfigForLlm(config),
              imageNote: "The original generated image was sent without client-side downscaling.",
            },
            null,
            2,
          ),
        },
        {
          type: "image_url",
          image_url: {
            detail: "low",
            url: imageDataUrl,
          },
        },
      ],
    },
  ];
}

export function buildComfyUiGenerationVisualDiagnosisMessages({
  config,
  imageDataUrl,
  userInput,
}: BuildComfyUiGenerationDiagnosisMessagesInput): LlmChatMessage[] {
  return [
    {
      role: "system",
      content: [
        "You are an expert Stable Diffusion and ComfyUI image generation diagnostician.",
        "Stage 1 task: analyze the generated image only. Do not propose concrete parameter values yet.",
        "Compare the image against the user's diagnosis request, current prompt, model resources, and ComfyUI settings.",
        "Return JSON only. Do not wrap it in markdown.",
        "Schema: { \"summary\": string, \"observations\": [{ \"category\": string, \"severity\": string, \"evidence\": string, \"likelyCause\": string, \"fixDirection\": string }], \"promptAlignment\": string, \"loraInfluence\": string, \"confidence\": number, \"warnings\"?: string[] }.",
        "Use categories such as anatomy, face, hands, composition, lighting, color, texture, detail, style, prompt_alignment, lora_weight, sampler_noise, or resolution.",
        "If currentConfig.checkpointPromptReferences is present, use the prompt only as a format and phrasing reference for the current checkpoint. Do not copy its subject, character, composition, or scene unless the user explicitly asks for it.",
        "Write all natural-language fields in Simplified Chinese.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              currentConfig: compactDiagnosisConfigForLlm(config),
              imageNote: "The original generated image was sent without client-side downscaling.",
              stage: "visual-diagnosis",
              userDiagnosisRequest: userInput.trim() || "请根据当前图片诊断并优化下一次 ComfyUI 生图配置。",
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

export function buildComfyUiGenerationAdjustmentMessages({
  config,
  userInput,
  visualDiagnosis,
  webContext,
}: BuildComfyUiGenerationAdjustmentMessagesInput): LlmChatMessage[] {
  return [
    {
      role: "system",
      content: [
        "You are an expert Stable Diffusion and ComfyUI parameter tuning assistant.",
        "Stage 2 task: convert the supplied visual diagnosis into practical ComfyUI adjustments.",
        "Return JSON only. Do not wrap it in markdown.",
        "Schema: { \"summary\": string, \"reasoning\": string, \"adjustments\": { \"positivePrompt\"?: string, \"negativePrompt\"?: string, \"width\"?: number, \"height\"?: number, \"steps\"?: number, \"cfg\"?: number, \"samplerName\"?: string, \"scheduler\"?: string, \"denoise\"?: number, \"seedMode\"?: \"random\"|\"fixed\", \"seed\"?: number, \"loras\"?: [{ \"loraName\": string, \"enabled\"?: boolean, \"strengthModel\"?: number, \"strengthClip\"?: number, \"reason\"?: string }] }, \"confidence\": number, \"changeRationale\"?: [{ \"field\": string, \"reason\": string, \"expectedEffect\": string, \"risk\": string }], \"warnings\"?: string[] }.",
        "If changing sampler settings, return ComfyUI samplerName and scheduler separately. Do not combine scheduler words into samplerName.",
        "Balanced adjustment policy: you may edit positivePrompt, negativePrompt, sampler/latent parameters, seed mode, and current LoRA enabled/weight values.",
        "Do not suggest a new checkpoint or new LoRA. You may only adjust or disable LoRAs already listed in currentConfig.loras.",
        "When rewriting prompts, preserve the original subject, composition intent, and scene. Do not copy checkpoint reference prompt subjects unless the user asks.",
        "If webContext is present, use it only as supporting evidence for current resources and parameter behavior. Do not introduce checkpoint or LoRA resources that are not already in currentConfig.",
        "When a web source directly informs a change, mention that source title or domain in changeRationale.reason.",
        "Prefer targeted changes over generic quality-word stuffing. Include a changeRationale entry for each changed field.",
        "Write summary, reasoning, warnings, changeRationale, and LoRA reasons in Simplified Chinese.",
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          currentConfig: compactDiagnosisConfigForLlm(config),
          stage: "parameter-adjustment",
          userDiagnosisRequest: userInput.trim() || "请根据当前图片诊断并优化下一次 ComfyUI 生图配置。",
          visualDiagnosis,
          webContext: webContext ?? undefined,
        },
        null,
        2,
      ),
    },
  ];
}

export function parseComfyUiGenerationVisualDiagnosisResponse(
  rawContent: string,
): ComfyUiGenerationVisualDiagnosisResult | null {
  const parsed = parseJsonCandidate(rawContent);
  if (!isRecord(parsed)) {
    return null;
  }

  return {
    confidence: readConfidence(parsed.confidence),
    loraInfluence: readString(parsed, ["loraInfluence"]) ?? "",
    observations: readDiagnosisObservations(parsed.observations),
    promptAlignment: readString(parsed, ["promptAlignment"]) ?? "",
    summary: readString(parsed, ["summary"]) ?? "",
    warnings: readWarnings(parsed.warnings),
  };
}

export function parseComfyUiGenerationDiagnosisResponse(
  rawContent: string,
  current: ComfyUiGenerationDiagnosisConfig,
): ComfyUiGenerationDiagnosisResult | null {
  const parsed = parseJsonCandidate(rawContent);
  if (!isRecord(parsed)) {
    return null;
  }

  const ignored: string[] = [];
  const adjustments = sanitizeAdjustments(parsed.adjustments, current, ignored);
  const summary = readString(parsed, ["summary"]) ?? "";
  const reasoning = readString(parsed, ["reasoning"]) ?? "";

  return {
    adjustments,
    changeRationale: readChangeRationale(parsed.changeRationale),
    confidence: readConfidence(parsed.confidence),
    ignored,
    reasoning,
    summary,
    warnings: readWarnings(parsed.warnings),
  };
}

export function applyComfyUiGenerationDiagnosisAdjustments(
  current: ComfyUiGenerationDiagnosisConfig,
  adjustments: ComfyUiGenerationDiagnosisAdjustments,
): ComfyUiGenerationDiagnosisConfig {
  const loraAdjustmentByName = new Map((adjustments.loras ?? []).map((lora) => [lora.loraName, lora]));
  const samplerSettings = normalizeComfyUiSamplerSettings({
    samplerName: adjustments.samplerName,
    scheduler: adjustments.scheduler,
  });

  return {
    ...current,
    cfg: adjustments.cfg ?? current.cfg,
    denoise: adjustments.denoise ?? current.denoise,
    height: adjustments.height ?? current.height,
    loras: current.loras.map((lora) => {
      const adjustment = loraAdjustmentByName.get(lora.loraName);
      return adjustment
        ? {
            ...lora,
            enabled: adjustment.enabled ?? lora.enabled,
            strengthClip: adjustment.strengthClip ?? adjustment.strengthModel ?? lora.strengthClip,
            strengthModel: adjustment.strengthModel ?? lora.strengthModel,
          }
        : lora;
    }),
    negativePrompt: adjustments.negativePrompt ?? current.negativePrompt,
    positivePrompt: adjustments.positivePrompt ?? current.positivePrompt,
    samplerName: samplerSettings.samplerName ?? current.samplerName,
    scheduler: samplerSettings.scheduler ?? current.scheduler,
    seed: adjustments.seed ?? current.seed,
    seedMode: adjustments.seedMode ?? current.seedMode,
    steps: adjustments.steps ?? current.steps,
    width: adjustments.width ?? current.width,
  };
}
