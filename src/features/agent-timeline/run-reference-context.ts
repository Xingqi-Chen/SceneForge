import {
  resolveComfyUiTextToImageWorkflowProfile,
  type ComfyUiTextToImageRequest,
} from "@/features/comfyui";

import {
  getKreaReferenceStrength,
  getRunSceneInputSettings,
} from "./run-input-settings";
import {
  isCharacterReferenceReady,
  isKrea2ReIdReferenceReady,
  isStyleReferenceReady,
  getStyleReferenceCapability,
  sanitizeCharacterReferenceSnapshot,
  sanitizeStyleReferenceSnapshot,
} from "./style-reference";
import type { TimelineWorkflowState } from "./types";

export type TimelineReferenceRole = "style" | "character";

/**
 * This is deliberately a byte-free, ordered queue contract. The uploaded
 * ComfyUI input name is transient and is attached only immediately before a
 * queue request; workflow persistence retains the managed storage identity.
 */
export type TimelineConfirmedReferenceContext = {
  /** Existing IP/style contexts remain v1; the corrected Krea2 ReID contract requires v3. */
  version: 1 | 3;
  adapter: "ipadapter" | "krea2-ostris" | "krea2-reid";
  references: Array<{
    role: TimelineReferenceRole;
    storedFilename: string;
    contentType: "image/png" | "image/jpeg" | "image/webp";
    byteLength: number;
    strength: number;
  }>;
  startPercent: 0;
  endPercent: 1;
};

const SEQUENCE_REFERENCE_FILENAME_PATTERN = /^[a-f0-9]{32}\.(?:jpg|jpeg|png|webp)$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeStrength(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? Math.min(1, Math.max(0, Number(numeric.toFixed(2)))) : null;
}

function getRequestPreview(workflow: TimelineWorkflowState): ComfyUiTextToImageRequest | null {
  const parameters = workflow.nodes["parameter-recommendation"].result;
  return isRecord(parameters) && isRecord(parameters.requestPreview) &&
      typeof parameters.requestPreview.checkpointName === "string" &&
      typeof parameters.requestPreview.positivePrompt === "string"
    ? parameters.requestPreview as ComfyUiTextToImageRequest
    : null;
}

function getSelectedCheckpoint(workflow: TimelineWorkflowState) {
  const resources = workflow.nodes["resource-recommendation"].result;
  const checkpoint = isRecord(resources) && isRecord(resources.checkpoint) && isRecord(resources.checkpoint.resource)
    ? resources.checkpoint.resource
    : null;
  if (!checkpoint) return null;
  return {
    baseModel: typeof checkpoint.baseModel === "string" ? checkpoint.baseModel : undefined,
    modelFileName: typeof checkpoint.modelFileName === "string" ? checkpoint.modelFileName : undefined,
    name: typeof checkpoint.name === "string" ? checkpoint.name : undefined,
  };
}

function supportsEffectiveStyleReferenceAdapter({
  request,
  settings,
  checkpoint,
}: {
  request: ComfyUiTextToImageRequest;
  settings: ReturnType<typeof getRunSceneInputSettings>;
  checkpoint: ReturnType<typeof getSelectedCheckpoint>;
}) {
  const profile = resolveComfyUiTextToImageWorkflowProfile(request).id;
  if (profile === "krea2") return true;
  return getStyleReferenceCapability({
    baseModel: checkpoint?.baseModel,
    modelBaseModel: request.modelBaseModel,
    modelFileName: checkpoint?.modelFileName ?? request.checkpointName,
    name: checkpoint?.name,
    promptProfile: profile === "anima" ? "anima" : settings.promptProfile,
  }).mode === "ipadapter";
}

export function createTimelineConfirmedReferenceContext({
  request,
  settings,
  styleReferenceAdapterSupported,
}: {
  request: ComfyUiTextToImageRequest;
  settings: ReturnType<typeof getRunSceneInputSettings>;
  /** The workflow-derived selected resource is authoritative when available. */
  styleReferenceAdapterSupported?: boolean;
}): TimelineConfirmedReferenceContext {
  const isKrea2 = resolveComfyUiTextToImageWorkflowProfile(request).id === "krea2";
  const styleReference = sanitizeStyleReferenceSnapshot(settings.styleReference);
  const characterReference = sanitizeCharacterReferenceSnapshot(settings.characterReference);
  const kreaStrength = getKreaReferenceStrength(settings);
  const references: TimelineConfirmedReferenceContext["references"] = [];
  const hasKrea2ReId = isKrea2 && isKrea2ReIdReferenceReady(characterReference);

  if (isStyleReferenceReady(styleReference) && styleReference.mode === "ipadapter" &&
      styleReferenceAdapterSupported !== false && !hasKrea2ReId) {
    references.push({
      role: "style",
      storedFilename: styleReference.metadata.storedFilename,
      contentType: styleReference.metadata.contentType as TimelineConfirmedReferenceContext["references"][number]["contentType"],
      byteLength: styleReference.metadata.byteLength,
      strength: isKrea2 ? kreaStrength : styleReference.ipAdapter?.weight ?? 0.45,
    });
  }
  if (hasKrea2ReId || !isKrea2 && isCharacterReferenceReady(characterReference) &&
      characterReference.kind !== "krea2-reid") {
    references.push({
      role: "character",
      storedFilename: characterReference.metadata.storedFilename,
      contentType: characterReference.metadata.contentType as TimelineConfirmedReferenceContext["references"][number]["contentType"],
      byteLength: characterReference.metadata.byteLength,
      strength: hasKrea2ReId ? 1 : characterReference.strength,
    });
  }

  return {
    version: hasKrea2ReId ? 3 : 1,
    adapter: hasKrea2ReId ? "krea2-reid" : isKrea2 ? "krea2-ostris" : "ipadapter",
    references,
    startPercent: 0,
    endPercent: 1,
  };
}

export function deriveTimelineConfirmedReferenceContext(workflow: TimelineWorkflowState) {
  const sceneInput = workflow.nodes["scene-input"].result;
  const settings = getRunSceneInputSettings(isRecord(sceneInput) ? sceneInput : {});
  const request = getRequestPreview(workflow);
  const checkpoint = getSelectedCheckpoint(workflow);
  return request ? createTimelineConfirmedReferenceContext({
    request,
    settings,
    styleReferenceAdapterSupported: supportsEffectiveStyleReferenceAdapter({ request, settings, checkpoint }),
  }) : null;
}

export function sanitizeTimelineConfirmedReferenceContext(
  value: unknown,
): TimelineConfirmedReferenceContext | undefined {
  if (!isRecord(value) ||
      (value.version !== 1 && value.version !== 3) ||
      (value.adapter !== "ipadapter" && value.adapter !== "krea2-ostris" && value.adapter !== "krea2-reid") ||
      (value.version === 3) !== (value.adapter === "krea2-reid") ||
      value.startPercent !== 0 || value.endPercent !== 1 || !Array.isArray(value.references) ||
      value.references.length > 2) {
    return undefined;
  }
  const seen = new Set<TimelineReferenceRole>();
  const references = value.references.map((raw) => {
    if (!isRecord(raw) || (raw.role !== "style" && raw.role !== "character") || seen.has(raw.role) ||
        typeof raw.storedFilename !== "string" || !SEQUENCE_REFERENCE_FILENAME_PATTERN.test(raw.storedFilename) ||
        (raw.contentType !== "image/png" && raw.contentType !== "image/jpeg" && raw.contentType !== "image/webp") ||
        typeof raw.byteLength !== "number" || !Number.isSafeInteger(raw.byteLength) || raw.byteLength < 1) {
      return null;
    }
    const strength = normalizeStrength(raw.strength);
    if (strength === null) return null;
    seen.add(raw.role);
    return {
      role: raw.role,
      storedFilename: raw.storedFilename,
      contentType: raw.contentType,
      byteLength: raw.byteLength,
      strength,
    };
  });
  if (references.some((reference) => !reference) ||
      references.length === 2 && (references[0]?.role !== "style" || references[1]?.role !== "character") ||
      value.adapter === "krea2-ostris" &&
        (references.length > 1 || references.some((reference) => reference?.role !== "style")) ||
      value.adapter === "krea2-reid" &&
        (references.length !== 1 || references[0]?.role !== "character" || references[0]?.strength !== 1)) {
    return undefined;
  }
  return {
    version: value.version,
    adapter: value.adapter,
    references: references as TimelineConfirmedReferenceContext["references"],
    startPercent: 0,
    endPercent: 1,
  };
}

export function getConfirmedTimelineReferenceContext(workflow: TimelineWorkflowState) {
  const gate = workflow.nodes["generation-gate"].result;
  return isRecord(gate) ? sanitizeTimelineConfirmedReferenceContext(gate.referenceContext) : undefined;
}
