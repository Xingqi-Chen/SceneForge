import type { ComfyUiSequenceCharacter } from "@/features/comfyui/sequence";
import type { PromptProfileId } from "@/shared/prompt-profile";
import {
  createGenerationStylePaletteSnapshot,
  sanitizeGenerationStylePaletteSnapshot,
  type GenerationStylePaletteLoraSnapshot,
  type GenerationStylePaletteParameters,
  type GenerationStylePaletteSnapshot,
} from "./generation-style-palette";

export type StoryStylePaletteLoraSnapshot = GenerationStylePaletteLoraSnapshot;
export type StoryStylePaletteGenerationParameters = GenerationStylePaletteParameters;
export type StoryStylePaletteSnapshot = GenerationStylePaletteSnapshot;

export type StoryStyleReferenceMode = "prompt-only" | "ipadapter";

export type StoryStyleReferenceMetadata = {
  byteLength: number;
  contentType: string;
  filename?: string;
  storedFilename: string;
  uploadedAt: string;
  url: string;
};

export type StoryStyleReferenceAnalysis = {
  analyzedAt: string;
  model?: string;
  stylePrompt: string;
  summary: string;
};

export type StoryStyleReferenceIpAdapterSettings = {
  endPercent: number;
  startPercent: number;
  weight: number;
};

export type StoryStyleReferenceSettingsSnapshot = {
  capturedAt: string;
  checkpointBaseModel?: string | null;
  checkpointId?: string;
  modeReason: string;
  promptProfile?: PromptProfileId;
};

export type StoryStyleReferenceSnapshot = {
  analysis?: StoryStyleReferenceAnalysis;
  error?: string;
  ipAdapter?: StoryStyleReferenceIpAdapterSettings;
  metadata?: StoryStyleReferenceMetadata;
  mode: StoryStyleReferenceMode;
  settingsSnapshot?: StoryStyleReferenceSettingsSnapshot;
  status: "ready" | "invalid";
};

export const STORY_STYLE_REFERENCE_IP_ADAPTER_DEFAULTS = {
  endPercent: 1,
  startPercent: 0,
  weight: 0.45,
} as const satisfies StoryStyleReferenceIpAdapterSettings;

const SEQUENCE_REFERENCE_FILENAME_PATTERN = /^[a-f0-9]{32}\.(?:jpg|jpeg|png|webp)$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function positiveInteger(value: unknown) {
  const parsed = finiteNumber(value);
  return parsed === undefined ? undefined : Math.max(1, Math.round(parsed));
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getSequenceReferenceUrl(storedFilename: string) {
  return `/api/comfyui/sequence-references/${encodeURIComponent(storedFilename)}`;
}

function sanitizeDisplayFilename(value: unknown) {
  const filename = optionalString(value);

  if (!filename || filename === "[redacted]") {
    return undefined;
  }

  const normalized = filename.toLowerCase();
  if (
    filename.includes("/") ||
    filename.includes("\\") ||
    filename.includes("\0") ||
    filename.includes("..") ||
    /%2f|%5c/i.test(filename) ||
    /^[a-z][a-z0-9+.-]*:/i.test(filename) ||
    normalized.startsWith("data:")
  ) {
    return undefined;
  }

  return filename.length <= 180 ? filename : undefined;
}

function compactText(value: unknown, max = 1800) {
  if (typeof value !== "string") {
    return "";
  }

  const text = value.replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, max).trimEnd()}...`;
}

function numberZeroToOne(value: unknown, fallback: number) {
  const parsed = finiteNumber(value);
  return parsed === undefined ? fallback : Math.min(1, Math.max(0, Number(parsed.toFixed(2))));
}

function normalizeStyleReferenceMode(value: unknown): StoryStyleReferenceMode {
  return value === "ipadapter" ? "ipadapter" : "prompt-only";
}

function invalidStyleReference(message: string): StoryStyleReferenceSnapshot {
  return {
    error: message,
    mode: "prompt-only",
    status: "invalid",
  };
}

function sanitizeStoryStyleReferenceMetadata(value: unknown): StoryStyleReferenceMetadata | null {
  if (!isRecord(value)) {
    return null;
  }

  const storedFilename = optionalString(value.storedFilename);
  const filename = sanitizeDisplayFilename(value.filename);
  const contentType = optionalString(value.contentType);
  const byteLength = positiveInteger(value.byteLength);
  const uploadedAt = optionalString(value.uploadedAt);

  if (
    !storedFilename ||
    !SEQUENCE_REFERENCE_FILENAME_PATTERN.test(storedFilename) ||
    !contentType ||
    !contentType.toLowerCase().startsWith("image/") ||
    byteLength === undefined ||
    !uploadedAt
  ) {
    return null;
  }

  return {
    byteLength,
    contentType,
    ...(filename ? { filename } : {}),
    storedFilename,
    uploadedAt,
    url: getSequenceReferenceUrl(storedFilename),
  };
}

function sanitizeStoryStyleReferenceAnalysis(value: unknown): StoryStyleReferenceAnalysis | null {
  if (!isRecord(value)) {
    return null;
  }

  const stylePrompt = compactText(value.stylePrompt, 2400);
  const summary = compactText(value.summary, 1000) || stylePrompt;
  const analyzedAt = optionalString(value.analyzedAt);

  if (!stylePrompt || !summary || !analyzedAt) {
    return null;
  }

  return {
    analyzedAt,
    ...(optionalString(value.model) ? { model: optionalString(value.model) } : {}),
    stylePrompt,
    summary,
  };
}

export function sanitizeStoryStyleReferenceIpAdapterSettings(
  value: unknown,
): StoryStyleReferenceIpAdapterSettings {
  const raw = isRecord(value) ? value : {};
  const weight = numberZeroToOne(raw.weight, STORY_STYLE_REFERENCE_IP_ADAPTER_DEFAULTS.weight);
  let startPercent = numberZeroToOne(raw.startPercent ?? raw.start_at, STORY_STYLE_REFERENCE_IP_ADAPTER_DEFAULTS.startPercent);
  let endPercent = numberZeroToOne(raw.endPercent ?? raw.end_at, STORY_STYLE_REFERENCE_IP_ADAPTER_DEFAULTS.endPercent);

  if (startPercent > endPercent) {
    startPercent = STORY_STYLE_REFERENCE_IP_ADAPTER_DEFAULTS.startPercent;
    endPercent = STORY_STYLE_REFERENCE_IP_ADAPTER_DEFAULTS.endPercent;
  }

  return {
    endPercent,
    startPercent,
    weight,
  };
}

function sanitizeStoryStyleReferenceSettingsSnapshot(value: unknown): StoryStyleReferenceSettingsSnapshot | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const capturedAt = optionalString(value.capturedAt);
  const modeReason = optionalString(value.modeReason);

  if (!capturedAt || !modeReason) {
    return undefined;
  }

  return {
    capturedAt,
    ...(optionalString(value.checkpointBaseModel) ? { checkpointBaseModel: optionalString(value.checkpointBaseModel) } : {}),
    ...(value.checkpointBaseModel === null ? { checkpointBaseModel: null } : {}),
    ...(optionalString(value.checkpointId) ? { checkpointId: optionalString(value.checkpointId) } : {}),
    modeReason,
    ...(optionalString(value.promptProfile) ? { promptProfile: optionalString(value.promptProfile) as PromptProfileId } : {}),
  };
}

export function createStoryStylePaletteSnapshot({
  checkpointId,
  loraIds,
  savedParameters,
}: {
  checkpointId: string | null;
  loraIds: readonly string[];
  savedParameters?: Parameters<typeof createGenerationStylePaletteSnapshot>[0]["savedParameters"];
}): StoryStylePaletteSnapshot | undefined {
  return createGenerationStylePaletteSnapshot({ checkpointId, loraIds, savedParameters });
}

export function sanitizeStoryStylePaletteSnapshot(value: unknown): StoryStylePaletteSnapshot | undefined {
  return sanitizeGenerationStylePaletteSnapshot(value);
}

export function getStoryStyleReferenceCapability({
  baseModel,
  modelBaseModel,
  modelFileName,
  name,
}: {
  baseModel?: string | null;
  modelBaseModel?: string | null;
  modelFileName?: string | null;
  name?: string | null;
}): { mode: StoryStyleReferenceMode; reason: string } {
  const text = [modelBaseModel, baseModel, modelFileName, name]
    .map((value) => value?.trim().toLocaleLowerCase())
    .filter(Boolean)
    .join(" ");

  if (/\banima\b/.test(text)) {
    return {
      mode: "prompt-only",
      reason: "Anima workflows use the analyzed style prompt only.",
    };
  }

  if (/\billustrious\b/.test(text)) {
    return {
      mode: "ipadapter",
      reason: "Illustrious base models support the sequence-style IPAdapter reference.",
    };
  }

  return {
    mode: "prompt-only",
    reason: "Unsupported or unknown checkpoints use the analyzed style prompt only.",
  };
}

function parseJsonObjectFromText(value: string): unknown {
  const trimmed = value.trim();

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const match = /\{[\s\S]*\}/.exec(trimmed);
    if (!match) {
      return null;
    }

    try {
      return JSON.parse(match[0]) as unknown;
    } catch {
      return null;
    }
  }
}

export function parseStoryStyleReferenceAnalysisContent(
  content: string,
  {
    analyzedAt,
    model,
  }: {
    analyzedAt: string;
    model?: string;
  },
): StoryStyleReferenceAnalysis {
  const parsed = parseJsonObjectFromText(content);

  if (!isRecord(parsed)) {
    throw new Error("Style reference analysis response must be valid JSON.");
  }

  const stylePrompt = compactText(parsed.stylePrompt ?? parsed.prompt, 2400);
  const summary = compactText(parsed.summary ?? parsed.styleSummary, 1000) || stylePrompt;

  if (!stylePrompt) {
    throw new Error("Style reference analysis did not include a reusable stylePrompt.");
  }

  return {
    analyzedAt,
    ...(model ? { model } : {}),
    stylePrompt,
    summary,
  };
}

export function createStoryStyleReferenceSnapshot({
  analysis,
  checkpointBaseModel,
  checkpointId,
  ipAdapter,
  metadata,
  mode,
  modeReason,
  promptProfile,
  capturedAt,
}: {
  analysis: StoryStyleReferenceAnalysis;
  capturedAt: string;
  checkpointBaseModel?: string | null;
  checkpointId?: string | null;
  ipAdapter?: StoryStyleReferenceIpAdapterSettings;
  metadata: StoryStyleReferenceMetadata;
  mode: StoryStyleReferenceMode;
  modeReason: string;
  promptProfile?: PromptProfileId;
}): StoryStyleReferenceSnapshot {
  return sanitizeStoryStyleReferenceSnapshot({
    analysis,
    metadata,
    mode,
    ...(mode === "ipadapter" ? { ipAdapter } : {}),
    settingsSnapshot: {
      capturedAt,
      checkpointBaseModel: checkpointBaseModel ?? null,
      ...(checkpointId ? { checkpointId } : {}),
      modeReason,
      ...(promptProfile ? { promptProfile } : {}),
    },
    status: "ready",
  }) ?? invalidStyleReference("Story style reference is invalid.");
}

export function sanitizeStoryStyleReferenceSnapshot(value: unknown): StoryStyleReferenceSnapshot | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!isRecord(value)) {
    return invalidStyleReference("Story style reference must be a metadata object.");
  }

  const metadata = sanitizeStoryStyleReferenceMetadata(value.metadata);
  const analysis = sanitizeStoryStyleReferenceAnalysis(value.analysis);
  if (!metadata) {
    return invalidStyleReference("Story style reference storage is missing or invalid. Retry the upload or remove the reference.");
  }

  if (!analysis) {
    return invalidStyleReference("Story style reference analysis is missing or invalid. Retry analysis or remove the reference.");
  }

  const mode = normalizeStyleReferenceMode(value.mode);
  const settingsSnapshot = sanitizeStoryStyleReferenceSettingsSnapshot(value.settingsSnapshot);

  return {
    analysis,
    ...(mode === "ipadapter"
      ? { ipAdapter: sanitizeStoryStyleReferenceIpAdapterSettings(value.ipAdapter) }
      : {}),
    metadata,
    mode,
    ...(settingsSnapshot ? { settingsSnapshot } : {}),
    status: "ready",
  };
}

export function getStoryStyleReferenceBlockingIssue(value: StoryStyleReferenceSnapshot | undefined) {
  return value && value.status !== "ready"
    ? value.error ?? "Story style reference must be analyzed or removed before continuing."
    : "";
}

export function isStoryStyleReferenceReady(
  value: StoryStyleReferenceSnapshot | undefined,
): value is StoryStyleReferenceSnapshot & {
  analysis: StoryStyleReferenceAnalysis;
  metadata: StoryStyleReferenceMetadata;
} {
  return Boolean(value?.status === "ready" && value.analysis?.stylePrompt && value.metadata?.storedFilename);
}

export function getStoryStyleReferencePrompt(value: StoryStyleReferenceSnapshot | undefined) {
  return isStoryStyleReferenceReady(value) ? value.analysis.stylePrompt : "";
}

export function getStoryStyleReferenceFromSettingsSnapshot(value: unknown) {
  if (!isRecord(value)) {
    return undefined;
  }

  return sanitizeStoryStyleReferenceSnapshot(value.styleReference);
}

export function getStoryStyleReferenceAiContext(value: StoryStyleReferenceSnapshot | undefined) {
  if (!isStoryStyleReferenceReady(value)) {
    return undefined;
  }

  return {
    mode: value.mode,
    stylePrompt: value.analysis.stylePrompt,
    summary: value.analysis.summary,
  };
}

export function buildStoryStyleReferenceSequenceCharacter(
  value: StoryStyleReferenceSnapshot | undefined,
): ComfyUiSequenceCharacter | null {
  if (!isStoryStyleReferenceReady(value) || value.mode !== "ipadapter") {
    return null;
  }

  const ipAdapter = sanitizeStoryStyleReferenceIpAdapterSettings(value.ipAdapter);

  return {
    id: "story-style-reference",
    name: "Story style reference",
    prompt: value.analysis.stylePrompt,
    enabled: true,
    mode: "ipadapter",
    references: [
      {
        id: "story-style-reference-image",
        storedFilename: value.metadata.storedFilename,
      },
    ],
    weight: ipAdapter.weight,
    startPercent: ipAdapter.startPercent,
    endPercent: ipAdapter.endPercent,
  };
}
