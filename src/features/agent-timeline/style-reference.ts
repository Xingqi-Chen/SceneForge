import type { ComfyUiSequenceCharacter } from "@/features/comfyui/sequence";
import type { PromptProfileId } from "@/shared/prompt-profile";

export type StyleReferenceMode = "prompt-only" | "ipadapter";
export type StyleReferenceStatus = "pending" | "ready" | "failed" | "mismatch" | "invalid";

export type StyleReferenceMetadata = {
  byteLength: number;
  contentType: string;
  filename?: string;
  storedFilename: string;
  uploadedAt: string;
  url: string;
};

export type StyleReferenceAnalysis = {
  analyzedAt: string;
  model?: string;
  stylePrompt: string;
  summary: string;
};

export type StyleReferenceIpAdapterSettings = {
  endPercent: number;
  startPercent: number;
  weight: number;
};

export type StyleReferenceSettingsSnapshot = {
  capturedAt: string;
  checkpointBaseModel?: string | null;
  checkpointId?: string;
  modeReason: string;
  promptProfile?: PromptProfileId;
};

export type StyleReferenceSnapshot = {
  analysis?: StyleReferenceAnalysis;
  error?: string;
  ipAdapter?: StyleReferenceIpAdapterSettings;
  metadata?: StyleReferenceMetadata;
  mode: StyleReferenceMode;
  settingsSnapshot?: StyleReferenceSettingsSnapshot;
  status: StyleReferenceStatus;
};

export const STYLE_REFERENCE_IP_ADAPTER_DEFAULTS = {
  endPercent: 1,
  startPercent: 0,
  weight: 0.45,
} as const satisfies StyleReferenceIpAdapterSettings;

const SEQUENCE_REFERENCE_FILENAME_PATTERN = /^[a-f0-9]{32}\.(?:jpg|jpeg|png|webp)$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function positiveInteger(value: unknown) {
  const parsed = finiteNumber(value);
  return parsed === undefined ? undefined : Math.max(1, Math.round(parsed));
}

function compactText(value: unknown, max = 1800) {
  if (typeof value !== "string") {
    return "";
  }

  const text = value.replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, max).trimEnd()}...`;
}

function getSequenceReferenceUrl(storedFilename: string) {
  return `/api/comfyui/sequence-references/${encodeURIComponent(storedFilename)}`;
}

function sanitizeDisplayFilename(value: unknown) {
  const filename = optionalString(value);
  if (!filename || filename === "[redacted]") {
    return undefined;
  }

  if (
    filename.includes("/") ||
    filename.includes("\\") ||
    filename.includes("\0") ||
    filename.includes("..") ||
    /%2f|%5c/i.test(filename) ||
    /^[a-z][a-z0-9+.-]*:/i.test(filename) ||
    filename.toLowerCase().startsWith("data:")
  ) {
    return undefined;
  }

  return filename.length <= 180 ? filename : undefined;
}

function numberZeroToOne(value: unknown, fallback: number) {
  const parsed = finiteNumber(value);
  return parsed === undefined ? fallback : Math.min(1, Math.max(0, Number(parsed.toFixed(2))));
}

function normalizeStatus(value: unknown): StyleReferenceStatus {
  return value === "pending" || value === "failed" || value === "mismatch" || value === "invalid"
    ? value
    : "ready";
}

function normalizeMode(value: unknown): StyleReferenceMode {
  return value === "ipadapter" ? "ipadapter" : "prompt-only";
}

function invalidStyleReference(message: string): StyleReferenceSnapshot {
  return { error: message, mode: "prompt-only", status: "invalid" };
}

export function sanitizeStyleReferenceMetadata(value: unknown): StyleReferenceMetadata | null {
  if (!isRecord(value)) {
    return null;
  }

  const storedFilename = optionalString(value.storedFilename);
  const contentType = optionalString(value.contentType);
  const byteLength = positiveInteger(value.byteLength);
  const uploadedAt = optionalString(value.uploadedAt);
  const filename = sanitizeDisplayFilename(value.filename);
  if (
    !storedFilename ||
    !SEQUENCE_REFERENCE_FILENAME_PATTERN.test(storedFilename) ||
    !contentType ||
    !["image/png", "image/jpeg", "image/webp"].includes(contentType.toLowerCase()) ||
    byteLength === undefined ||
    !uploadedAt
  ) {
    return null;
  }

  return {
    byteLength,
    contentType: contentType.toLowerCase(),
    ...(filename ? { filename } : {}),
    storedFilename,
    uploadedAt,
    url: getSequenceReferenceUrl(storedFilename),
  };
}

export function sanitizeStyleReferenceAnalysis(value: unknown): StyleReferenceAnalysis | null {
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

export function sanitizeStyleReferenceIpAdapterSettings(value: unknown): StyleReferenceIpAdapterSettings {
  const raw = isRecord(value) ? value : {};
  const weight = numberZeroToOne(raw.weight, STYLE_REFERENCE_IP_ADAPTER_DEFAULTS.weight);
  let startPercent = numberZeroToOne(
    raw.startPercent ?? raw.start_at,
    STYLE_REFERENCE_IP_ADAPTER_DEFAULTS.startPercent,
  );
  let endPercent = numberZeroToOne(raw.endPercent ?? raw.end_at, STYLE_REFERENCE_IP_ADAPTER_DEFAULTS.endPercent);

  if (startPercent > endPercent) {
    startPercent = STYLE_REFERENCE_IP_ADAPTER_DEFAULTS.startPercent;
    endPercent = STYLE_REFERENCE_IP_ADAPTER_DEFAULTS.endPercent;
  }

  return { endPercent, startPercent, weight };
}

export function sanitizeStyleReferenceSettingsSnapshot(
  value: unknown,
): StyleReferenceSettingsSnapshot | undefined {
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
    ...(optionalString(value.checkpointBaseModel)
      ? { checkpointBaseModel: optionalString(value.checkpointBaseModel) }
      : {}),
    ...(value.checkpointBaseModel === null ? { checkpointBaseModel: null } : {}),
    ...(optionalString(value.checkpointId) ? { checkpointId: optionalString(value.checkpointId) } : {}),
    modeReason,
    ...(optionalString(value.promptProfile)
      ? { promptProfile: optionalString(value.promptProfile) as PromptProfileId }
      : {}),
  };
}

export function getStyleReferenceCapability({
  baseModel,
  modelBaseModel,
  modelFileName,
  name,
}: {
  baseModel?: string | null;
  modelBaseModel?: string | null;
  modelFileName?: string | null;
  name?: string | null;
}): { mode: StyleReferenceMode; reason: string } {
  const text = [modelBaseModel, baseModel, modelFileName, name]
    .map((item) => item?.trim().toLocaleLowerCase())
    .filter(Boolean)
    .join(" ");

  if (/\banima\b/.test(text)) {
    return { mode: "prompt-only", reason: "Anima workflows use the analyzed style prompt only." };
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

export function parseStyleReferenceAnalysisContent(
  content: string,
  { analyzedAt, model }: { analyzedAt: string; model?: string },
): StyleReferenceAnalysis {
  const parsed = parseJsonObjectFromText(content);
  if (!isRecord(parsed)) {
    throw new Error("Style reference analysis response must be valid JSON.");
  }

  const stylePrompt = compactText(parsed.stylePrompt ?? parsed.prompt, 2400);
  const summary = compactText(parsed.summary ?? parsed.styleSummary, 1000) || stylePrompt;
  if (!stylePrompt) {
    throw new Error("Style reference analysis did not include a reusable stylePrompt.");
  }

  return { analyzedAt, ...(model ? { model } : {}), stylePrompt, summary };
}

export function createStyleReferenceSnapshot({
  analysis,
  capturedAt,
  checkpointBaseModel,
  checkpointId,
  ipAdapter,
  metadata,
  mode,
  modeReason,
  promptProfile,
}: {
  analysis: StyleReferenceAnalysis;
  capturedAt: string;
  checkpointBaseModel?: string | null;
  checkpointId?: string | null;
  ipAdapter?: StyleReferenceIpAdapterSettings;
  metadata: StyleReferenceMetadata;
  mode: StyleReferenceMode;
  modeReason: string;
  promptProfile?: PromptProfileId;
}): StyleReferenceSnapshot {
  return sanitizeStyleReferenceSnapshot({
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
  }) ?? invalidStyleReference("Style reference is invalid.");
}

export function sanitizeStyleReferenceSnapshot(value: unknown): StyleReferenceSnapshot | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!isRecord(value)) {
    return invalidStyleReference("Style reference must be a metadata object.");
  }

  const status = normalizeStatus(value.status);
  const metadata = sanitizeStyleReferenceMetadata(value.metadata);
  const analysis = sanitizeStyleReferenceAnalysis(value.analysis);
  const mode = normalizeMode(value.mode);
  const settingsSnapshot = sanitizeStyleReferenceSettingsSnapshot(value.settingsSnapshot);
  const error = compactText(value.error, 600);

  if (status === "ready" && !metadata) {
    return invalidStyleReference("Style reference storage is missing or invalid. Retry the upload or remove the reference.");
  }
  if (status === "ready" && !analysis) {
    return invalidStyleReference("Style reference analysis is missing or invalid. Retry analysis or remove the reference.");
  }

  return {
    ...(analysis ? { analysis } : {}),
    ...(error ? { error } : {}),
    ...(mode === "ipadapter" ? { ipAdapter: sanitizeStyleReferenceIpAdapterSettings(value.ipAdapter) } : {}),
    ...(metadata ? { metadata } : {}),
    mode,
    ...(settingsSnapshot ? { settingsSnapshot } : {}),
    status,
  };
}

export function getStyleReferenceBlockingIssue(value: StyleReferenceSnapshot | undefined, label = "Style") {
  if (!value || value.status === "ready") {
    return "";
  }
  return value.error ?? `${label} style reference must be analyzed or removed before continuing.`;
}

export function isStyleReferenceReady(
  value: StyleReferenceSnapshot | undefined,
): value is StyleReferenceSnapshot & { analysis: StyleReferenceAnalysis; metadata: StyleReferenceMetadata } {
  return Boolean(value?.status === "ready" && value.analysis?.stylePrompt && value.metadata?.storedFilename);
}

export function getStyleReferencePrompt(value: StyleReferenceSnapshot | undefined) {
  return isStyleReferenceReady(value) ? value.analysis.stylePrompt : "";
}

export function appendStyleReferencePromptExactlyOnce(
  positivePrompt: string,
  value: StyleReferenceSnapshot | undefined,
) {
  const stylePrompt = getStyleReferencePrompt(value).trim();
  if (!stylePrompt) {
    return positivePrompt.trim();
  }

  const prompt = positivePrompt.trim();
  if (prompt === stylePrompt || prompt.endsWith(`, ${stylePrompt}`)) {
    return prompt;
  }
  return prompt ? `${prompt}, ${stylePrompt}` : stylePrompt;
}

export function getStyleReferenceFromSettingsSnapshot(value: unknown) {
  return isRecord(value) ? sanitizeStyleReferenceSnapshot(value.styleReference) : undefined;
}

export function getStyleReferenceAiContext(value: StyleReferenceSnapshot | undefined) {
  return isStyleReferenceReady(value)
    ? { mode: value.mode, stylePrompt: value.analysis.stylePrompt, summary: value.analysis.summary }
    : undefined;
}

function normalizeContextValue(value: string | null | undefined) {
  return value?.trim().toLowerCase() || null;
}

export function getStyleReferenceContextMismatch(
  value: StyleReferenceSnapshot | undefined,
  current: {
    checkpointBaseModel?: string | null;
    checkpointId?: string | null;
    promptProfile?: PromptProfileId;
  },
) {
  if (!isStyleReferenceReady(value)) {
    return "";
  }
  const analyzed = value.settingsSnapshot;
  if (!analyzed) {
    return "Style reference must be reanalyzed for the current model context.";
  }
  if (
    (current.promptProfile !== undefined && analyzed.promptProfile !== current.promptProfile) ||
    normalizeContextValue(analyzed.checkpointBaseModel) !== normalizeContextValue(current.checkpointBaseModel) ||
    (analyzed.checkpointId !== undefined && analyzed.checkpointId !== (current.checkpointId ?? undefined))
  ) {
    return "Style reference was analyzed for a different base model or checkpoint. Retry analysis or remove the reference.";
  }
  return "";
}

export function buildStyleReferenceSequenceCharacter(
  value: StyleReferenceSnapshot | undefined,
  options: { id?: string; name?: string } = {},
): ComfyUiSequenceCharacter | null {
  if (!isStyleReferenceReady(value) || value.mode !== "ipadapter") {
    return null;
  }
  const ipAdapter = sanitizeStyleReferenceIpAdapterSettings(value.ipAdapter);
  const id = options.id ?? "style-reference";
  return {
    id,
    name: options.name ?? "Style reference",
    prompt: value.analysis.stylePrompt,
    enabled: true,
    mode: "ipadapter",
    references: [{ id: `${id}-image`, storedFilename: value.metadata.storedFilename }],
    weight: ipAdapter.weight,
    startPercent: ipAdapter.startPercent,
    endPercent: ipAdapter.endPercent,
  };
}
