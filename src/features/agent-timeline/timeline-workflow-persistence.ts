import {
  createTimelineNodeError,
  createTimelineWorkflowState,
  refreshTimelineReadiness,
} from "./state";
import {
  getTimelineWorkflowDefinition,
  singleImageWorkflowMode,
  type TimelineWorkflowMode,
} from "./workflow-definitions";
import {
  refreshStoryWorkflowReadiness,
  type StoryManualEditState,
  type StoryWorkflowNodeMap,
  type StoryWorkflowNodeResult,
  type StoryWorkflowState,
} from "./story-state";
import {
  storyGraphWorkflowMode,
  storyWorkflowDefinition,
  type StoryGraphWorkflowMode,
} from "./story-workflow";
import {
  evaluateStoryReferenceAssetFreezeGate,
} from "./story-reference-assets";
import type {
  StoryGenerationGatePreview,
} from "./story-input";
import type {
  StoryLocationContinuityMode,
  StoryRenderLocationContinuity,
  StoryRenderPlan,
  StoryRenderReferenceRecipe,
} from "./story-planning";
import {
  storyWorkflowNodeIds,
  storyReferenceImportanceValues,
  storyReferenceResolutionStateValues,
  type StoryShotId,
  type StoryReferenceApprovalDecision,
  type StoryReferenceAsset,
  type StoryReferenceAssetFreezeGate,
  type StoryReferenceAssetPlan,
  type StoryReferenceAssetReference,
  type StoryReferenceAssetType,
  type StoryReferenceEntityType,
  type StoryReferenceGenerationFailureAction,
  type StoryReferenceGenerationFailureSummary,
  type StoryReferenceImportance,
  type StoryReferencePromptOnlyFallbackDecision,
  type StoryReferenceRejectionDecision,
  type StoryReferenceResolutionState,
  type StoryWorkflowNodeId,
} from "./story-types";
import {
  storyShotExecutionStatuses,
  type StoryShotExecutionError,
  type StoryShotExecutionRecord,
  type StoryShotExecutionStatus,
} from "./story-execution";
import {
  type CommonWorkflowArtifactScope,
  type CommonWorkflowDefinitionVersion,
} from "./workflow-definition";
import {
  timelineNodeIds,
  timelineNodeStatuses,
  type TimelineNodeId,
  type TimelineNodeMap,
  type TimelineNodeResult,
  type TimelineNodeStatus,
  type TimelineWorkflowState,
} from "./types";
import { normalizePromptProfileId, type PromptProfileId } from "@/shared/prompt-profile";

export const TIMELINE_WORKFLOW_RECORD_KIND = "sceneforge-timeline-workflow" as const;
export const TIMELINE_WORKFLOW_RECORD_VERSION = 1 as const;

export type TimelineWorkflowRecordMode = TimelineWorkflowMode | StoryGraphWorkflowMode;
export type TimelineWorkflowRecordState = TimelineWorkflowState | StoryWorkflowState;
export type TimelineWorkflowRecordNodeId = TimelineNodeId | StoryWorkflowNodeId;
export type TimelineOutputDisplayMode = "json" | "visual";
export type TimelineOutputDisplayModeMap = Partial<Record<TimelineWorkflowRecordNodeId, TimelineOutputDisplayMode>>;

export type TimelineWorkflowRecord = {
  kind: typeof TIMELINE_WORKFLOW_RECORD_KIND;
  version: typeof TIMELINE_WORKFLOW_RECORD_VERSION;
  definitionVersion: CommonWorkflowDefinitionVersion;
  projectId?: string;
  name?: string;
  workflow: TimelineWorkflowRecordState;
  sceneRequest: string;
  selectedPromptProfile: PromptProfileId;
  selectedImageCount: number;
  selectedNodeId: TimelineWorkflowRecordNodeId;
  selectedStoryShotId?: StoryShotId;
  outputDisplayModes: TimelineOutputDisplayModeMap;
  createdAt: string;
  updatedAt: string;
};

export type TimelineWorkflowSummary = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  workflowMode: TimelineWorkflowRecordMode;
};

export type TimelineWorkflowRecordInput = {
  projectId?: string | null;
  name?: string | null;
  workflow: TimelineWorkflowRecordState;
  sceneRequest: string;
  selectedPromptProfile: PromptProfileId;
  selectedImageCount: number;
  selectedNodeId: TimelineWorkflowRecordNodeId;
  selectedStoryShotId?: StoryShotId | null;
  outputDisplayModes?: TimelineOutputDisplayModeMap;
};

const statusSet = new Set<TimelineNodeStatus>(timelineNodeStatuses);
const timelineNodeIdSet = new Set<TimelineNodeId>(timelineNodeIds);
const storyNodeIdSet = new Set<StoryWorkflowNodeId>(storyWorkflowNodeIds);
const storyShotStatusSet = new Set<StoryShotExecutionStatus>(storyShotExecutionStatuses);
const storyExecutionGraphStatuses = new Set(["blocked", "ready", "running", "done", "partial", "stale", "error"]);
const storyReferenceImportanceSet = new Set<StoryReferenceImportance>(storyReferenceImportanceValues);
const storyReferenceResolutionStateSet = new Set<StoryReferenceResolutionState>(
  storyReferenceResolutionStateValues,
);
const storyReferenceAssetTypeSet = new Set<StoryReferenceAssetType>([
  "character-face",
  "character-bust",
  "outfit",
  "prop",
  "location",
]);
const storyReferenceEntityTypeSet = new Set<StoryReferenceEntityType>([
  "character",
  "outfit",
  "prop",
  "location",
]);
const storyReferenceSourceSet = new Set<StoryReferenceAssetReference["source"]>([
  "generated",
  "uploaded",
]);
const storyReferenceFailureActionSet = new Set<StoryReferenceGenerationFailureAction>([
  "reroll",
  "upload",
  "prompt-only",
]);
const storyLocationContinuityModeSet = new Set<StoryLocationContinuityMode>([
  "prompt-only",
  "source-image",
  "inpaint-preferred",
]);
const storyReferenceManagedImageRoutePrefixes = [
  "/api/comfyui/generated-images",
  "/api/comfyui/sequence-references",
] as const;
const storyReferenceImageFilenamePattern = /^[a-z0-9][a-z0-9._-]{0,180}\.(?:gif|jpe?g|png|webp)$/i;
const redactedKeyPattern =
  /(api[-_]?key|authorization|bearer|password|secret|token|env[-_]?local|envlocal|private[-_]?key|sqlite|database|resource[-_]?database|cache|(?:log|logs)[-_]?(?:path|file|dir|directory)|(?:downloaded|local)?[-_]?(?:model|checkpoint|lora|resource)[-_]?(?:path|file[-_]?path)|(?:image|generated|file)?[-_]?(?:bytes|base64|blob|buffer|contents))/i;
const redactedStringPattern =
  /\.env\.local|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:^|[\\/])data[\\/](?:logs?|cache|caches|civitai-lora-library)(?:[\\/]|$)|\.sqlite\b|sceneforge\.sqlite/i;

type JsonSanitizeOptions = {
  redactDataUrls?: boolean;
};

type SanitizedNodeError = {
  code: string;
  message: string;
  details?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTimelineNodeId(value: unknown): value is TimelineNodeId {
  return typeof value === "string" && timelineNodeIdSet.has(value as TimelineNodeId);
}

function isStoryWorkflowNodeId(value: unknown): value is StoryWorkflowNodeId {
  return typeof value === "string" && storyNodeIdSet.has(value as StoryWorkflowNodeId);
}

function isWorkflowNodeIdForMode(
  mode: TimelineWorkflowRecordMode,
  value: unknown,
): value is TimelineWorkflowRecordNodeId {
  return mode === storyGraphWorkflowMode ? isStoryWorkflowNodeId(value) : isTimelineNodeId(value);
}

function sanitizeDateString(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

export function sanitizeTimelineWorkflowProjectName(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function sanitizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}

function sanitizeCompactString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const text = value.replace(/\s+/g, " ").trim();
  return text || undefined;
}

function sanitizeSafeCompactString(value: unknown, options: JsonSanitizeOptions = {}): string | undefined {
  const text = sanitizeCompactString(value);
  if (!text) {
    return undefined;
  }

  if (
    (options.redactDataUrls && text.trimStart().toLowerCase().startsWith("data:")) ||
    redactedStringPattern.test(text)
  ) {
    return "[redacted]";
  }

  return text;
}

function sanitizeFiniteNumber(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function sanitizeNonNegativeInteger(value: unknown): number | undefined {
  const parsed = sanitizeFiniteNumber(value);
  if (parsed === undefined || parsed < 0) {
    return undefined;
  }

  return Math.round(parsed);
}

function sanitizeSafeUrl(value: unknown): string | undefined {
  const text = sanitizeSafeCompactString(value, { redactDataUrls: true });
  if (!text) {
    return undefined;
  }

  if (text === "[redacted]") {
    return text;
  }

  for (const prefix of storyReferenceManagedImageRoutePrefixes) {
    const routePrefix = `${prefix}/`;
    if (!text.startsWith(routePrefix)) {
      continue;
    }

    const filename = text.slice(routePrefix.length);
    const safeFilename = sanitizeStoryReferenceImageFilename(filename);

    return safeFilename && safeFilename !== "[redacted]" && filename === safeFilename
      ? text
      : "[redacted]";
  }

  return "[redacted]";
}

function sanitizeStoryReferenceImageFilename(value: unknown): string | undefined {
  const text = sanitizeSafeCompactString(value, { redactDataUrls: true });
  if (!text) {
    return undefined;
  }

  if (
    text === "[redacted]" ||
    text.includes("/") ||
    text.includes("\\") ||
    text.includes(":") ||
    text.includes("?") ||
    text.includes("#") ||
    text.includes("..") ||
    !storyReferenceImageFilenamePattern.test(text)
  ) {
    return "[redacted]";
  }

  return text;
}

function cloneSanitizedSafeStringArray(
  value: unknown,
  maxItems = 64,
  options: JsonSanitizeOptions = {},
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const entry of sanitizeStringArray(value)) {
    const text = sanitizeSafeCompactString(entry, options);
    if (!text || seen.has(text)) {
      continue;
    }

    seen.add(text);
    result.push(text);

    if (result.length >= maxItems) {
      break;
    }
  }

  return result;
}

function sanitizeJsonValue(value: unknown, depth = 0, options: JsonSanitizeOptions = {}): unknown {
  if (depth > 12) {
    return null;
  }

  if (value === null || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    if (options.redactDataUrls && value.trimStart().toLowerCase().startsWith("data:")) {
      return "[redacted]";
    }

    return redactedStringPattern.test(value) ? "[redacted]" : value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeJsonValue(entry, depth + 1, options));
  }

  if (!isRecord(value)) {
    return null;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      redactedKeyPattern.test(key) ? "[redacted]" : sanitizeJsonValue(entry, depth + 1, options),
    ]),
  );
}

function sanitizeNodeStatus(value: unknown): TimelineNodeStatus {
  return typeof value === "string" && statusSet.has(value as TimelineNodeStatus)
    ? value as TimelineNodeStatus
    : "blocked";
}

function sanitizeNodeSource(value: unknown): TimelineNodeResult["source"] {
  return value === "ai" || value === "manual" || value === "system" ? value : "system";
}

function sanitizeNodeError(raw: unknown, options: JsonSanitizeOptions): SanitizedNodeError | undefined {
  if (!isRecord(raw) || typeof raw.message !== "string" || typeof raw.code !== "string") {
    return undefined;
  }

  return {
    code: raw.code,
    message: raw.message,
    ...(raw.details !== undefined ? { details: sanitizeJsonValue(raw.details, 0, options) } : {}),
  };
}

function createInterruptedNodeError() {
  return createTimelineNodeError(
    "timeline_node_failed",
    "This node was interrupted while the workflow was away. Rerun it to continue.",
  );
}

function createReferenceRecoveryError(message: string, details?: unknown) {
  return createTimelineNodeError("timeline_node_stale", message, details);
}

function sanitizeStoryReferenceMetadata(
  raw: unknown,
): StoryReferenceAssetReference["metadata"] | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }

  const metadata: NonNullable<StoryReferenceAssetReference["metadata"]> = {};
  const checkpointResourceId = sanitizeSafeCompactString(raw.checkpointResourceId, { redactDataUrls: true });
  const height = sanitizeNonNegativeInteger(raw.height);
  const loraResourceIds = cloneSanitizedSafeStringArray(raw.loraResourceIds, 32, { redactDataUrls: true });
  const negativePrompt = sanitizeSafeCompactString(raw.negativePrompt, { redactDataUrls: true });
  const positivePrompt = sanitizeSafeCompactString(raw.positivePrompt, { redactDataUrls: true });
  const promptId = sanitizeSafeCompactString(raw.promptId, { redactDataUrls: true });
  const referenceId = sanitizeSafeCompactString(raw.referenceId, { redactDataUrls: true });
  const warnings = cloneSanitizedSafeStringArray(raw.warnings, 32, { redactDataUrls: true });
  const width = sanitizeNonNegativeInteger(raw.width);
  const workflowProfile = sanitizeSafeCompactString(raw.workflowProfile, { redactDataUrls: true });

  if (checkpointResourceId) {
    metadata.checkpointResourceId = checkpointResourceId;
  }
  if (height !== undefined) {
    metadata.height = height;
  }
  if (loraResourceIds.length > 0) {
    metadata.loraResourceIds = loraResourceIds;
  }
  if (negativePrompt) {
    metadata.negativePrompt = negativePrompt;
  }
  if (positivePrompt) {
    metadata.positivePrompt = positivePrompt;
  }
  if (promptId) {
    metadata.promptId = promptId;
  }
  if (referenceId) {
    metadata.referenceId = referenceId;
  }
  if (warnings.length > 0) {
    metadata.warnings = warnings;
  }
  if (width !== undefined) {
    metadata.width = width;
  }
  if (workflowProfile) {
    metadata.workflowProfile = workflowProfile;
  }

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function sanitizeStoryReferenceAssetReference(raw: unknown): StoryReferenceAssetReference | null {
  if (!isRecord(raw) || !storyReferenceSourceSet.has(raw.source as StoryReferenceAssetReference["source"])) {
    return null;
  }

  const byteLength = sanitizeNonNegativeInteger(raw.byteLength);
  const canonicalPromptRevision = sanitizeNonNegativeInteger(raw.canonicalPromptRevision);
  const contentType = sanitizeSafeCompactString(raw.contentType, { redactDataUrls: true });
  const createdAt = sanitizeSafeCompactString(raw.createdAt, { redactDataUrls: true });
  const filename = sanitizeStoryReferenceImageFilename(raw.filename);
  const id = sanitizeSafeCompactString(raw.id, { redactDataUrls: true });
  const metadata = sanitizeStoryReferenceMetadata(raw.metadata);
  const url = sanitizeSafeUrl(raw.url);

  return {
    source: raw.source as StoryReferenceAssetReference["source"],
    ...(byteLength !== undefined ? { byteLength } : {}),
    ...(canonicalPromptRevision !== undefined ? { canonicalPromptRevision } : {}),
    ...(contentType ? { contentType } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(filename ? { filename } : {}),
    ...(id ? { id } : {}),
    ...(metadata ? { metadata } : {}),
    ...(url ? { url } : {}),
  };
}

function sanitizeStoryReferenceApprovalDecision(
  raw: unknown,
): StoryReferenceApprovalDecision | undefined {
  if (
    !isRecord(raw) ||
    raw.approvedBy !== "user" ||
    !storyReferenceSourceSet.has(raw.source as StoryReferenceAssetReference["source"])
  ) {
    return undefined;
  }

  const approvedAssetReferenceId = sanitizeSafeCompactString(raw.approvedAssetReferenceId, { redactDataUrls: true });
  const approvedAt = sanitizeSafeCompactString(raw.approvedAt, { redactDataUrls: true });

  return {
    approvedBy: "user",
    source: raw.source as StoryReferenceApprovalDecision["source"],
    ...(approvedAssetReferenceId ? { approvedAssetReferenceId } : {}),
    ...(approvedAt ? { approvedAt } : {}),
  };
}

function sanitizeStoryReferenceFailureSummary(
  raw: unknown,
): StoryReferenceGenerationFailureSummary | undefined {
  if (!isRecord(raw) || raw.recoverable !== true) {
    return undefined;
  }

  const message = sanitizeSafeCompactString(raw.message, { redactDataUrls: true });
  if (!message) {
    return undefined;
  }

  const code = sanitizeSafeCompactString(raw.code, { redactDataUrls: true });
  const failedAt = sanitizeSafeCompactString(raw.failedAt, { redactDataUrls: true });
  const recoverableActions = cloneSanitizedSafeStringArray(raw.recoverableActions, 64, { redactDataUrls: true })
    .filter((action): action is StoryReferenceGenerationFailureAction =>
      storyReferenceFailureActionSet.has(action as StoryReferenceGenerationFailureAction),
    );

  return {
    message,
    recoverable: true,
    recoverableActions: recoverableActions.length > 0
      ? recoverableActions
      : ["reroll", "upload", "prompt-only"],
    ...(code ? { code } : {}),
    ...(failedAt ? { failedAt } : {}),
  };
}

function sanitizeStoryReferencePromptOnlyFallback(
  raw: unknown,
): StoryReferencePromptOnlyFallbackDecision | undefined {
  if (!isRecord(raw) || raw.decidedBy !== "user") {
    return undefined;
  }

  const reason = sanitizeSafeCompactString(raw.reason, { redactDataUrls: true });
  if (!reason) {
    return undefined;
  }

  const decidedAt = sanitizeSafeCompactString(raw.decidedAt, { redactDataUrls: true });

  return {
    decidedBy: "user",
    reason,
    ...(decidedAt ? { decidedAt } : {}),
  };
}

function sanitizeStoryReferenceRejectionDecision(
  raw: unknown,
): StoryReferenceRejectionDecision | undefined {
  if (!isRecord(raw) || raw.rejectedBy !== "user") {
    return undefined;
  }

  const reason = sanitizeSafeCompactString(raw.reason, { redactDataUrls: true });
  const rejectedAt = sanitizeSafeCompactString(raw.rejectedAt, { redactDataUrls: true });

  return {
    rejectedBy: "user",
    ...(reason ? { reason } : {}),
    ...(rejectedAt ? { rejectedAt } : {}),
  };
}

function getApprovedReferenceFromCandidates({
  approval,
  candidates,
}: {
  approval?: StoryReferenceApprovalDecision;
  candidates: StoryReferenceAssetReference[];
}) {
  return approval?.approvedAssetReferenceId
    ? candidates.find((candidate) => candidate.id === approval.approvedAssetReferenceId)
    : undefined;
}

function hasUsableStoryReferenceLocation(reference: StoryReferenceAssetReference | undefined) {
  return Boolean(reference?.url && reference.url !== "[redacted]");
}

function sanitizeStoryReferenceAsset(
  raw: unknown,
  fallbackStoryId: string,
): { asset?: StoryReferenceAsset; stale: boolean } {
  if (!isRecord(raw)) {
    return { stale: true };
  }

  const id = sanitizeSafeCompactString(raw.id, { redactDataUrls: true });
  const referenceType = raw.referenceType as StoryReferenceAssetType;
  const importance = raw.importance as StoryReferenceImportance;
  const rawResolutionState = raw.resolutionState as StoryReferenceResolutionState;
  const canonicalPrompt = sanitizeSafeCompactString(raw.canonicalPrompt, { redactDataUrls: true });
  const rationale = sanitizeSafeCompactString(raw.rationale, { redactDataUrls: true }) ?? "";
  const rawSourceEntity = raw.sourceEntity;

  if (
    !id ||
    !storyReferenceAssetTypeSet.has(referenceType) ||
    !storyReferenceImportanceSet.has(importance) ||
    !storyReferenceResolutionStateSet.has(rawResolutionState) ||
    !canonicalPrompt ||
    !isRecord(rawSourceEntity)
  ) {
    return { stale: true };
  }

  const sourceEntityId = sanitizeSafeCompactString(rawSourceEntity.id, { redactDataUrls: true });
  const sourceEntityName = sanitizeSafeCompactString(rawSourceEntity.name, { redactDataUrls: true });
  const sourceEntityType = rawSourceEntity.type as StoryReferenceEntityType;
  if (!sourceEntityId || !sourceEntityName || !storyReferenceEntityTypeSet.has(sourceEntityType)) {
    return { stale: true };
  }

  const candidateAssetReferences = Array.isArray(raw.candidateAssetReferences)
    ? raw.candidateAssetReferences.flatMap((entry) => {
        const reference = sanitizeStoryReferenceAssetReference(entry);
        return reference ? [reference] : [];
      })
    : [];
  const approval = sanitizeStoryReferenceApprovalDecision(raw.approval);
  const approvedAssetReference = sanitizeStoryReferenceAssetReference(raw.approvedAssetReference)
    ?? getApprovedReferenceFromCandidates({ approval, candidates: candidateAssetReferences });
  const canonicalPromptRevision = sanitizeNonNegativeInteger(raw.canonicalPromptRevision);
  const failure = sanitizeStoryReferenceFailureSummary(raw.failure);
  const promptOnlyFallback = sanitizeStoryReferencePromptOnlyFallback(raw.promptOnlyFallback);
  const rejection = sanitizeStoryReferenceRejectionDecision(raw.rejection);
  let resolutionState = rawResolutionState;
  let stale = false;

  if (
    resolutionState === "approved" &&
    (
      !approval ||
      !approvedAssetReference ||
      !hasUsableStoryReferenceLocation(approvedAssetReference) ||
      (
        canonicalPromptRevision !== undefined &&
        approvedAssetReference.canonicalPromptRevision !== undefined &&
        approvedAssetReference.canonicalPromptRevision !== canonicalPromptRevision
      )
    )
  ) {
    resolutionState = "stale";
    stale = true;
  }

  if ((resolutionState === "generated" || resolutionState === "uploaded") && candidateAssetReferences.length === 0) {
    resolutionState = "stale";
    stale = true;
  }

  if (resolutionState === "prompt-only" && !promptOnlyFallback) {
    resolutionState = "stale";
    stale = true;
  }

  return {
    asset: {
      id,
      storyId: sanitizeSafeCompactString(raw.storyId, { redactDataUrls: true }) ?? fallbackStoryId,
      referenceType,
      importance,
      resolutionState,
      canonicalPrompt,
      rationale,
      sourceEntity: {
        id: sourceEntityId,
        name: sourceEntityName,
        type: sourceEntityType,
      },
      sourceShotIds: cloneSanitizedSafeStringArray(raw.sourceShotIds, 64, { redactDataUrls: true }) as StoryShotId[],
      candidateAssetReferences,
      ...(approval ? { approval } : {}),
      ...(approvedAssetReference ? { approvedAssetReference } : {}),
      ...(canonicalPromptRevision !== undefined ? { canonicalPromptRevision } : {}),
      ...(failure ? { failure } : {}),
      ...(promptOnlyFallback ? { promptOnlyFallback } : {}),
      ...(rejection ? { rejection } : {}),
    },
    stale,
  };
}

function sanitizeStoryReferenceAssetPlan(
  raw: unknown,
  fallbackStoryId: string,
): { plan?: StoryReferenceAssetPlan; stale: boolean; valid: boolean } {
  if (!isRecord(raw) || !Array.isArray(raw.assets)) {
    return { stale: false, valid: false };
  }

  let stale = false;
  const assets = raw.assets.flatMap((entry) => {
    const result = sanitizeStoryReferenceAsset(entry, fallbackStoryId);
    stale ||= result.stale;
    return result.asset ? [result.asset] : [];
  });

  if (assets.length !== raw.assets.length) {
    stale = true;
  }

  return {
    plan: {
      storyId: sanitizeSafeCompactString(raw.storyId, { redactDataUrls: true }) ?? fallbackStoryId,
      assets,
      planningNotes: cloneSanitizedSafeStringArray(raw.planningNotes, 32, { redactDataUrls: true }),
    },
    stale,
    valid: true,
  };
}

function sanitizeStoryRenderReferenceRecipe(
  raw: unknown,
): { recipe: StoryRenderReferenceRecipe; stale: boolean } {
  if (!isRecord(raw)) {
    return {
      recipe: {
        summary: "Use prompt text only; no valid persisted reference recipe was available.",
        referenceIds: [],
        approvedReferenceIds: [],
        promptOnlyReferenceIds: [],
        unresolvedReferenceIds: [],
        notes: [],
      },
      stale: true,
    };
  }

  return {
    recipe: {
      summary: sanitizeSafeCompactString(raw.summary, { redactDataUrls: true }) ??
        "Use prompt text only; no reference assets are attached to this shot.",
      referenceIds: cloneSanitizedSafeStringArray(raw.referenceIds, 32, { redactDataUrls: true }),
      approvedReferenceIds: cloneSanitizedSafeStringArray(raw.approvedReferenceIds, 32, { redactDataUrls: true }),
      promptOnlyReferenceIds: cloneSanitizedSafeStringArray(raw.promptOnlyReferenceIds, 32, { redactDataUrls: true }),
      unresolvedReferenceIds: cloneSanitizedSafeStringArray(raw.unresolvedReferenceIds, 32, { redactDataUrls: true }),
      notes: cloneSanitizedSafeStringArray(raw.notes, 16, { redactDataUrls: true }),
    },
    stale: false,
  };
}

function sanitizeStoryRenderLocationContinuity(
  raw: unknown,
): { continuity: StoryRenderLocationContinuity; stale: boolean } {
  if (!isRecord(raw) || !storyLocationContinuityModeSet.has(raw.mode as StoryLocationContinuityMode)) {
    return {
      continuity: {
        mode: "prompt-only",
        sourceShotIds: [],
        reason: "Carry location continuity through prompt text and planning notes only.",
        notes: [],
      },
      stale: true,
    };
  }

  const mode = raw.mode as StoryLocationContinuityMode;
  const sourceShotIds = cloneSanitizedSafeStringArray(raw.sourceShotIds, 64, { redactDataUrls: true }) as StoryShotId[];
  const sourceIdsShouldBeEmpty = mode !== "source-image" && sourceShotIds.length > 0;

  return {
    continuity: {
      mode,
      sourceShotIds: mode === "source-image" ? sourceShotIds : [],
      reason: sanitizeSafeCompactString(raw.reason, { redactDataUrls: true }) ?? (
        mode === "source-image"
          ? "Use the listed source shot as executable img2img location continuity."
          : mode === "inpaint-preferred"
            ? "Inpaint is preferred for location continuity when a future backend supports it; v1 remains prompt-only."
            : "Carry location continuity through prompt text and planning notes only."
      ),
      notes: cloneSanitizedSafeStringArray(raw.notes, 16, { redactDataUrls: true }),
    },
    stale: sourceIdsShouldBeEmpty,
  };
}

function hasOnlyKnownReferenceIds(recipe: StoryRenderReferenceRecipe, knownReferenceIds: ReadonlySet<string>) {
  return [
    ...recipe.referenceIds,
    ...recipe.approvedReferenceIds,
    ...recipe.promptOnlyReferenceIds,
    ...recipe.unresolvedReferenceIds,
  ].every((referenceId) => knownReferenceIds.has(referenceId));
}

function sanitizeStoryRenderPlan(
  raw: unknown,
  referencePlan?: StoryReferenceAssetPlan,
): { plan?: StoryRenderPlan; stale: boolean; valid: boolean } {
  if (!isRecord(raw) || !Array.isArray(raw.shots)) {
    return { stale: false, valid: false };
  }

  const knownReferenceIds = referencePlan ? new Set(referencePlan.assets.map((asset) => asset.id)) : undefined;
  const shotIds = raw.shots.flatMap((entry) =>
    isRecord(entry) && sanitizeCompactString(entry.shotId) ? [sanitizeCompactString(entry.shotId) as string] : [],
  );
  const shotIdSet = new Set(shotIds);
  let stale = shotIds.length !== raw.shots.length;
  const shots = raw.shots.flatMap((entry, index) => {
    if (!isRecord(entry)) {
      stale = true;
      return [];
    }

    const shotId = sanitizeCompactString(entry.shotId);
    if (!shotId) {
      stale = true;
      return [];
    }

    const recipeResult = sanitizeStoryRenderReferenceRecipe(entry.referenceRecipe);
    const continuityResult = sanitizeStoryRenderLocationContinuity(entry.locationContinuity);
    const continuity = continuityResult.continuity;
    let sourceShotIds = continuity.sourceShotIds;

    stale ||= recipeResult.stale || continuityResult.stale;
    if (knownReferenceIds && !hasOnlyKnownReferenceIds(recipeResult.recipe, knownReferenceIds)) {
      stale = true;
    }
    if (!knownReferenceIds && recipeResult.recipe.referenceIds.length > 0) {
      stale = true;
    }

    if (continuity.mode === "source-image") {
      const validSourceShotIds = sourceShotIds.filter((sourceShotId) =>
        sourceShotId !== shotId &&
        shotIdSet.has(sourceShotId) &&
        shotIds.indexOf(sourceShotId) > -1 &&
        shotIds.indexOf(sourceShotId) < index,
      );

      if (validSourceShotIds.length !== sourceShotIds.length || validSourceShotIds.length === 0) {
        stale = true;
      }

      sourceShotIds = validSourceShotIds;
    }

    const sanitizedShot = sanitizeJsonValue(entry, 0, { redactDataUrls: true });

    return [{
      ...(isRecord(sanitizedShot) ? sanitizedShot : {}),
      shotId,
      locationContinuity: {
        ...continuity,
        sourceShotIds,
      },
      referenceRecipe: recipeResult.recipe,
      sourceShotIds,
    }];
  });
  const sanitizedPlan = sanitizeJsonValue(raw, 0, { redactDataUrls: true });

  return {
    plan: {
      ...(isRecord(sanitizedPlan) ? sanitizedPlan : {}),
      storyId: sanitizeSafeCompactString(raw.storyId, { redactDataUrls: true }) ?? referencePlan?.storyId ?? "",
      shots,
      warnings: cloneSanitizedSafeStringArray(raw.warnings, 64, { redactDataUrls: true }),
    } as StoryRenderPlan,
    stale,
    valid: shots.length > 0,
  };
}

function createUnavailableReferenceAssetFreezeGate(): StoryReferenceAssetFreezeGate {
  return {
    blockingReferences: [],
    ready: false,
    requiredReferenceCount: 0,
    resolvedRequiredReferenceCount: 0,
  };
}

function sanitizeStoryGenerationGatePreview(
  raw: unknown,
  {
    referencePlan,
    upstreamReady,
  }: {
    referencePlan?: StoryReferenceAssetPlan;
    upstreamReady: boolean;
  },
): { gate?: StoryGenerationGatePreview; stale: boolean; valid: boolean } {
  if (!isRecord(raw)) {
    return { stale: false, valid: false };
  }

  const assetFreezeGate = referencePlan
    ? evaluateStoryReferenceAssetFreezeGate(referencePlan)
    : createUnavailableReferenceAssetFreezeGate();
  const persistedHasAssetFreezeGate = isRecord(raw.assetFreezeGate);
  const ready = raw.ready === true && raw.executionAvailable === true && upstreamReady && assetFreezeGate.ready;
  const stale = !persistedHasAssetFreezeGate ||
    raw.ready !== ready ||
    raw.executionAvailable !== ready ||
    raw.assetFreezeGate === undefined;
  const sanitizedGate = sanitizeJsonValue(raw, 0, { redactDataUrls: true });

  return {
    gate: {
      ...(isRecord(sanitizedGate) ? sanitizedGate : {}),
      storyId: sanitizeSafeCompactString(raw.storyId, { redactDataUrls: true }) ?? referencePlan?.storyId ?? "",
      ready,
      executionAvailable: ready,
      assetFreezeGate,
      blockingReason: ready
        ? "Confirm generation to start shot graph execution."
        : assetFreezeGate.blockingReferences[0]?.reason ??
          sanitizeSafeCompactString(raw.blockingReason, { redactDataUrls: true }) ??
          "Resolve required Story reference assets before generation.",
      confirmationRequired: raw.confirmationRequired !== false,
      renderPlanShotCount: sanitizeNonNegativeInteger(raw.renderPlanShotCount) ?? 0,
      previewEnabled: raw.previewEnabled === true,
      requestPreview: Array.isArray(raw.requestPreview)
        ? raw.requestPreview.map((entry) => sanitizeJsonValue(entry, 0, { redactDataUrls: true }))
        : [],
    } as StoryGenerationGatePreview,
    stale,
    valid: true,
  };
}

function isRecoverableStatus(status: StoryWorkflowNodeResult["status"]) {
  return status === "done" || status === "manual" || status === "ready" || status === "running" || status === "stale";
}

function staleStoryNode(
  node: StoryWorkflowNodeResult,
  message: string,
  updatedAt: string,
  details?: unknown,
): StoryWorkflowNodeResult {
  if (node.result === undefined && node.status === "blocked") {
    return node;
  }

  return {
    ...node,
    error: createReferenceRecoveryError(message, details),
    status: "stale",
    updatedAt,
  };
}

function sanitizeTimelineNode(
  nodeId: TimelineNodeId,
  raw: unknown,
  fallbackUpdatedAt: string,
): TimelineNodeResult {
  if (!isRecord(raw)) {
    return {
      nodeId,
      status: "blocked",
      source: "system",
      updatedAt: fallbackUpdatedAt,
    };
  }

  const status = sanitizeNodeStatus(raw.status);
  const updatedAt = sanitizeDateString(raw.updatedAt, fallbackUpdatedAt);
  const source = sanitizeNodeSource(raw.source);
  const error = sanitizeNodeError(raw.error, {});

  if (status === "running") {
    return {
      nodeId,
      status: "error",
      source: "system",
      updatedAt,
      error: createInterruptedNodeError(),
      ...(raw.result !== undefined ? { result: sanitizeJsonValue(raw.result) } : {}),
    };
  }

  return {
    nodeId,
    status,
    source,
    updatedAt,
    ...(raw.result !== undefined ? { result: sanitizeJsonValue(raw.result) } : {}),
    ...(error ? { error: error as TimelineNodeResult["error"] } : {}),
  };
}

function sanitizeStoryShotExecutionError(raw: unknown): StoryShotExecutionError | undefined {
  const error = sanitizeNodeError(raw, { redactDataUrls: true });

  return error
    ? {
        code: error.code as StoryShotExecutionError["code"],
        message: error.message,
        ...(error.details !== undefined ? { details: error.details } : {}),
      }
    : undefined;
}

function createInterruptedShotExecutionError(
  shotId: StoryShotId,
  interruptedStatus: StoryShotExecutionStatus,
): StoryShotExecutionError {
  return {
    code: "shot_execution_failed",
    message: `Shot "${shotId}" was interrupted while the workflow was away. Rerun the shot to continue.`,
    details: {
      interruptedStatus,
      recoverable: true,
    },
  };
}

function getStoryShotExecutionErrorKey(error: StoryShotExecutionError) {
  return JSON.stringify({
    code: error.code,
    message: error.message,
    details: error.details ?? null,
  });
}

function uniqueStoryShotExecutionErrors(errors: StoryShotExecutionError[]) {
  const seen = new Set<string>();
  const result: StoryShotExecutionError[] = [];

  for (const error of errors) {
    const key = getStoryShotExecutionErrorKey(error);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(error);
  }

  return result;
}

function sanitizeStoryShotStatus(value: unknown): StoryShotExecutionStatus {
  return typeof value === "string" && storyShotStatusSet.has(value as StoryShotExecutionStatus)
    ? value as StoryShotExecutionStatus
    : "blocked";
}

function sanitizeStoryShotExecutionRecord(
  raw: unknown,
  fallbackUpdatedAt: string,
): StoryShotExecutionRecord | null {
  if (!isRecord(raw) || typeof raw.shotId !== "string" || !raw.shotId.trim()) {
    return null;
  }

  const shotId = raw.shotId.trim();
  const status = sanitizeStoryShotStatus(raw.status);
  const interrupted = status === "running" || status === "queued";
  const error = interrupted
    ? createInterruptedShotExecutionError(shotId, status)
    : sanitizeStoryShotExecutionError(raw.error);

  return {
    shotId,
    sourceShotIds: sanitizeStringArray(raw.sourceShotIds),
    status: interrupted ? "error" : status,
    ...(sanitizeDateString(raw.updatedAt, fallbackUpdatedAt) ? {
      updatedAt: sanitizeDateString(raw.updatedAt, fallbackUpdatedAt),
    } : {}),
    ...(raw.queueMetadata !== undefined
      ? { queueMetadata: sanitizeJsonValue(raw.queueMetadata, 0, { redactDataUrls: true }) as StoryShotExecutionRecord["queueMetadata"] }
      : {}),
    ...(raw.resultReference !== undefined
      ? { resultReference: sanitizeJsonValue(raw.resultReference, 0, { redactDataUrls: true }) as StoryShotExecutionRecord["resultReference"] }
      : {}),
    ...(error ? { error } : {}),
  };
}

function sanitizeStoryShotGraphExecutionResult(raw: unknown, fallbackUpdatedAt: string): unknown {
  if (!isRecord(raw) || !Array.isArray(raw.shots)) {
    return sanitizeJsonValue(raw, 0, { redactDataUrls: true });
  }

  const shots = raw.shots.flatMap((entry) => {
    const shot = sanitizeStoryShotExecutionRecord(entry, fallbackUpdatedAt);
    return shot ? [shot] : [];
  });
  const interruptedErrors = shots.flatMap((shot) =>
    shot.error?.details &&
    isRecord(shot.error.details) &&
    shot.error.details.recoverable === true
      ? [shot.error]
      : [],
  );
  const rawErrors = Array.isArray(raw.errors)
    ? raw.errors.flatMap((entry) => {
        const error = sanitizeStoryShotExecutionError(entry);
        return error ? [error] : [];
      })
    : [];
  const rawStatus = typeof raw.status === "string" && storyExecutionGraphStatuses.has(raw.status)
    ? raw.status
    : "blocked";
  const hasInterruptedShot = interruptedErrors.length > 0;

  return {
    errors: uniqueStoryShotExecutionErrors([...rawErrors, ...interruptedErrors]),
    mode: raw.mode === "preview" ? "preview" : "final",
    readyShotIds: sanitizeStringArray(raw.readyShotIds),
    shots,
    staleShotIds: sanitizeStringArray(raw.staleShotIds),
    status: rawStatus === "running" || hasInterruptedShot ? "error" : rawStatus,
    storyId: typeof raw.storyId === "string" ? raw.storyId : "",
    updatedAt: sanitizeDateString(raw.updatedAt, fallbackUpdatedAt),
  };
}

function sanitizeArtifactScope(raw: unknown, fallbackStoryId: StoryShotId): CommonWorkflowArtifactScope {
  if (!isRecord(raw)) {
    return {
      kind: "story",
      storyId: fallbackStoryId,
    };
  }

  if (raw.kind === "workflow") {
    return {
      kind: "workflow",
    };
  }

  if (raw.kind === "shot" && typeof raw.shotId === "string" && raw.shotId.trim()) {
    return {
      kind: "shot",
      shotId: raw.shotId.trim(),
      ...(typeof raw.storyId === "string" && raw.storyId.trim()
        ? { storyId: raw.storyId.trim() }
        : { storyId: fallbackStoryId }),
    };
  }

  return {
    kind: "story",
    ...(typeof raw.storyId === "string" && raw.storyId.trim()
      ? { storyId: raw.storyId.trim() }
      : { storyId: fallbackStoryId }),
  };
}

function sanitizeStoryManualEdit(
  raw: unknown,
  fallbackUpdatedAt: string,
  storyId: StoryShotId,
): StoryManualEditState | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }

  return {
    editedAt: sanitizeDateString(raw.editedAt, fallbackUpdatedAt),
    scope: sanitizeArtifactScope(raw.scope, storyId),
    staleNodeIds: sanitizeStringArray(raw.staleNodeIds).filter(isStoryWorkflowNodeId),
    staleShotIds: sanitizeStringArray(raw.staleShotIds),
  };
}

function sanitizeStoryNodeResult(
  nodeId: StoryWorkflowNodeId,
  raw: unknown,
  fallbackUpdatedAt: string,
): unknown {
  if (nodeId === "shot-graph-execution") {
    return sanitizeStoryShotGraphExecutionResult(raw, fallbackUpdatedAt);
  }

  return sanitizeJsonValue(raw, 0, { redactDataUrls: true });
}

function sanitizeStoryNode(
  nodeId: StoryWorkflowNodeId,
  raw: unknown,
  fallbackUpdatedAt: string,
  storyId: StoryShotId,
): StoryWorkflowNodeResult {
  if (!isRecord(raw)) {
    return {
      nodeId,
      status: "blocked",
      source: "system",
      updatedAt: fallbackUpdatedAt,
    };
  }

  const status = sanitizeNodeStatus(raw.status);
  const updatedAt = sanitizeDateString(raw.updatedAt, fallbackUpdatedAt);
  const source = sanitizeNodeSource(raw.source);
  const error = sanitizeNodeError(raw.error, { redactDataUrls: true });
  const result = raw.result !== undefined ? sanitizeStoryNodeResult(nodeId, raw.result, updatedAt) : undefined;
  const manualEdit = sanitizeStoryManualEdit(raw.manualEdit, updatedAt, storyId);

  if (status === "running") {
    return {
      nodeId,
      status: "error",
      source: "system",
      updatedAt,
      error: createInterruptedNodeError(),
      ...(result !== undefined ? { result } : {}),
      ...(manualEdit ? { manualEdit } : {}),
    };
  }

  return {
    nodeId,
    status,
    source,
    updatedAt,
    ...(result !== undefined ? { result } : {}),
    ...(error ? { error } : {}),
    ...(manualEdit ? { manualEdit } : {}),
  };
}

function isStoryConsistencyCheckResult(raw: unknown): raw is { passed: boolean } {
  return isRecord(raw) &&
    typeof raw.passed === "boolean" &&
    Array.isArray(raw.issues) &&
    Array.isArray(raw.warnings);
}

function recoverStoryReferenceEraState({
  generationConfirmed,
  nodes,
  storyId,
  updatedAt,
}: {
  generationConfirmed: boolean;
  nodes: StoryWorkflowNodeMap;
  storyId: StoryShotId;
  updatedAt: string;
}): { generationConfirmed: boolean; nodes: StoryWorkflowNodeMap } {
  const nextNodes = Object.fromEntries(
    storyWorkflowDefinition.nodeIds.map((nodeId) => [nodeId, { ...nodes[nodeId] }]),
  ) as StoryWorkflowNodeMap;
  let nextGenerationConfirmed = generationConfirmed;

  const referenceNode = nextNodes["reference-asset-plan"];
  const referenceResult = sanitizeStoryReferenceAssetPlan(referenceNode.result, storyId);
  const referenceNodeInterrupted =
    referenceNode.status === "error" &&
    referenceNode.error?.code === "timeline_node_failed";
  let referencePlan = referenceResult.plan;
  let referenceAffected = referenceNodeInterrupted;

  if (referenceNode.result !== undefined && referenceResult.valid && referenceResult.plan) {
    nextNodes["reference-asset-plan"] = {
      ...referenceNode,
      result: referenceResult.plan,
    };

    if (referenceResult.stale) {
      nextNodes["reference-asset-plan"] = staleStoryNode(
        nextNodes["reference-asset-plan"],
        "Story reference asset state was recovered from an incomplete persisted record. Review or rerun references before generation.",
        updatedAt,
      );
      referenceAffected = true;
    }
  } else if (referenceNode.result !== undefined || isRecoverableStatus(referenceNode.status)) {
    referencePlan = undefined;
    if (referenceNode.result !== undefined || referenceNode.status !== "blocked") {
      nextNodes["reference-asset-plan"] = staleStoryNode(
        referenceNode,
        "Story reference asset plan is missing or malformed. Rerun reference planning before generation.",
        updatedAt,
      );
    }
    referenceAffected = true;
  }

  const renderNode = nextNodes["story-render-plan"];
  const renderResult = sanitizeStoryRenderPlan(renderNode.result, referencePlan);
  let renderPlanValid = false;
  let renderAffected = false;

  if (renderNode.result !== undefined && renderResult.valid && renderResult.plan) {
    nextNodes["story-render-plan"] = {
      ...renderNode,
      result: renderResult.plan,
    };
    renderPlanValid = true;

    if (renderResult.stale || !referencePlan || referenceAffected) {
      nextNodes["story-render-plan"] = staleStoryNode(
        nextNodes["story-render-plan"],
        "Story render plan was restored with stale or incomplete reference-era data. Rerun render planning before generation.",
        updatedAt,
      );
      renderAffected = true;
    }
  } else if (renderNode.result !== undefined || (referenceAffected && isRecoverableStatus(renderNode.status))) {
    nextNodes["story-render-plan"] = staleStoryNode(
      renderNode,
      "Story render plan is missing reference recipes or structured location continuity. Rerun render planning before generation.",
      updatedAt,
    );
    renderAffected = true;
  }

  const consistencyNode = nextNodes["story-consistency-check"];
  const consistencyValid = isStoryConsistencyCheckResult(consistencyNode.result);
  let consistencyAffected = false;
  if (!consistencyValid && (consistencyNode.result !== undefined || isRecoverableStatus(consistencyNode.status))) {
    nextNodes["story-consistency-check"] = staleStoryNode(
      consistencyNode,
      "Story consistency check is missing or malformed. Rerun consistency checks before generation.",
      updatedAt,
    );
    consistencyAffected = true;
  } else if ((referenceAffected || renderAffected) && isRecoverableStatus(consistencyNode.status)) {
    nextNodes["story-consistency-check"] = staleStoryNode(
      consistencyNode,
      "Story consistency check depends on recovered reference-era state. Rerun consistency checks before generation.",
      updatedAt,
    );
    consistencyAffected = true;
  }

  const consistencyPassed =
    isStoryConsistencyCheckResult(nextNodes["story-consistency-check"].result) &&
    nextNodes["story-consistency-check"].result.passed === true &&
    !consistencyAffected;
  const gateNode = nextNodes["generation-gate"];
  const gateResult = sanitizeStoryGenerationGatePreview(gateNode.result, {
    referencePlan,
    upstreamReady: Boolean(referencePlan && renderPlanValid && consistencyPassed),
  });
  let gateReady = false;
  let gateAffected = false;

  if (gateNode.result !== undefined && gateResult.valid && gateResult.gate) {
    nextNodes["generation-gate"] = {
      ...gateNode,
      result: gateResult.gate,
    };
    gateReady = gateResult.gate.ready === true && gateResult.gate.executionAvailable === true;

    if (gateResult.stale || referenceAffected || renderAffected || consistencyAffected) {
      nextNodes["generation-gate"] = staleStoryNode(
        nextNodes["generation-gate"],
        "Story generation gate depends on recovered reference-era state. Rerun the gate before generation.",
        updatedAt,
      );
      gateAffected = true;
      gateReady = false;
    }
  } else if (gateNode.result !== undefined || isRecoverableStatus(gateNode.status)) {
    nextNodes["generation-gate"] = staleStoryNode(
      gateNode,
      "Story generation gate is missing reference freeze metadata. Rerun the gate before generation.",
      updatedAt,
    );
    gateAffected = true;
  }

  const upstreamAffected = referenceAffected || renderAffected || consistencyAffected || gateAffected;
  const executionNode = nextNodes["shot-graph-execution"];
  const executionShouldRecover = upstreamAffected ||
    (isRecoverableStatus(executionNode.status) && !gateReady);

  if (executionShouldRecover) {
    nextNodes["shot-graph-execution"] = staleStoryNode(
      executionNode,
      "Story shot execution depends on stale reference-era planning state. Confirm generation again after rerunning the gate.",
      updatedAt,
    );
    nextGenerationConfirmed = false;
  }

  const resultDisplayNode = nextNodes["story-result-display"];
  if (executionShouldRecover && (resultDisplayNode.result !== undefined || isRecoverableStatus(resultDisplayNode.status))) {
    nextNodes["story-result-display"] = staleStoryNode(
      resultDisplayNode,
      "Story result display depends on stale execution state. Regenerate affected shots before treating results as current.",
      updatedAt,
    );
  }

  if (upstreamAffected) {
    nextGenerationConfirmed = false;
  }
  if (!gateReady) {
    nextGenerationConfirmed = false;
  }

  return {
    generationConfirmed: nextGenerationConfirmed,
    nodes: nextNodes,
  };
}

function sanitizeWorkflowMode(value: unknown): TimelineWorkflowRecordMode {
  return value === storyGraphWorkflowMode ? storyGraphWorkflowMode : singleImageWorkflowMode;
}

function getDefinitionVersion(mode: TimelineWorkflowRecordMode): CommonWorkflowDefinitionVersion {
  return mode === storyGraphWorkflowMode
    ? storyWorkflowDefinition.version
    : getTimelineWorkflowDefinition(singleImageWorkflowMode).version;
}

function getStoryId(raw: Record<string, unknown>, fallbackWorkflowId: string) {
  const storyInput = isRecord(raw.nodes)
    ? raw.nodes["story-input"]
    : undefined;
  const storyInputResult = isRecord(storyInput) ? storyInput.result : undefined;

  if (typeof raw.storyId === "string" && raw.storyId.trim()) {
    return raw.storyId.trim();
  }

  if (isRecord(storyInputResult) && typeof storyInputResult.storyId === "string" && storyInputResult.storyId.trim()) {
    return storyInputResult.storyId.trim();
  }

  return fallbackWorkflowId;
}

function sanitizeSingleImageWorkflowState(raw: Record<string, unknown>): TimelineWorkflowState | null {
  if (typeof raw.workflowId !== "string" || !raw.workflowId.trim()) {
    return null;
  }

  const fallback = createTimelineWorkflowState({ workflowId: raw.workflowId.trim() });
  const createdAt = sanitizeDateString(raw.createdAt, fallback.createdAt);
  const updatedAt = sanitizeDateString(raw.updatedAt, fallback.updatedAt);
  const rawNodes = isRecord(raw.nodes) ? raw.nodes : {};
  const definition = getTimelineWorkflowDefinition(singleImageWorkflowMode);
  const nodes = Object.fromEntries(
    definition.nodeIds.map((nodeId) => [
      nodeId,
      sanitizeTimelineNode(nodeId, rawNodes[nodeId], updatedAt),
    ]),
  ) as TimelineNodeMap;

  return refreshTimelineReadiness({
    workflowId: raw.workflowId.trim(),
    workflowMode: singleImageWorkflowMode,
    createdAt,
    updatedAt,
    generationConfirmed: typeof raw.generationConfirmed === "boolean" ? raw.generationConfirmed : false,
    nodes,
  });
}

function sanitizeStoryWorkflowState(raw: Record<string, unknown>): StoryWorkflowState | null {
  if (typeof raw.workflowId !== "string" || !raw.workflowId.trim()) {
    return null;
  }

  const workflowId = raw.workflowId.trim();
  const storyId = getStoryId(raw, workflowId);
  const createdAt = sanitizeDateString(raw.createdAt, new Date().toISOString());
  const updatedAt = sanitizeDateString(raw.updatedAt, createdAt);
  const rawNodes = isRecord(raw.nodes) ? raw.nodes : {};
  const nodes = Object.fromEntries(
    storyWorkflowDefinition.nodeIds.map((nodeId) => [
      nodeId,
      sanitizeStoryNode(nodeId, rawNodes[nodeId], updatedAt, storyId),
    ]),
  ) as StoryWorkflowNodeMap;
  const recovered = recoverStoryReferenceEraState({
    generationConfirmed: typeof raw.generationConfirmed === "boolean" ? raw.generationConfirmed : false,
    nodes,
    storyId,
    updatedAt,
  });

  return refreshStoryWorkflowReadiness({
    workflowId,
    workflowMode: storyGraphWorkflowMode,
    storyId,
    createdAt,
    updatedAt,
    generationConfirmed: recovered.generationConfirmed,
    nodes: recovered.nodes,
  });
}

export function sanitizeTimelineWorkflowState(raw: unknown): TimelineWorkflowRecordState | null {
  if (!isRecord(raw)) {
    return null;
  }

  const workflowMode = sanitizeWorkflowMode(raw.workflowMode);

  return workflowMode === storyGraphWorkflowMode
    ? sanitizeStoryWorkflowState(raw)
    : sanitizeSingleImageWorkflowState(raw);
}

function sanitizeSelectedNodeId(
  raw: unknown,
  mode: TimelineWorkflowRecordMode,
): TimelineWorkflowRecordNodeId {
  if (isWorkflowNodeIdForMode(mode, raw)) {
    return raw;
  }

  return mode === storyGraphWorkflowMode ? "story-input" : "scene-input";
}

function sanitizeSelectedShotId(raw: unknown, workflow: TimelineWorkflowRecordState): StoryShotId | undefined {
  if (workflow.workflowMode !== storyGraphWorkflowMode || typeof raw !== "string" || !raw.trim()) {
    return undefined;
  }

  return raw.trim();
}

function sanitizeOutputDisplayModes(
  raw: unknown,
  mode: TimelineWorkflowRecordMode,
): TimelineOutputDisplayModeMap {
  if (!isRecord(raw)) {
    return {};
  }

  const result: TimelineOutputDisplayModeMap = {};
  for (const [key, value] of Object.entries(raw)) {
    if (isWorkflowNodeIdForMode(mode, key) && (value === "json" || value === "visual")) {
      result[key] = value;
    }
  }

  return result;
}

function getWorkflowSceneRequest(workflow: TimelineWorkflowRecordState) {
  if (workflow.workflowMode === storyGraphWorkflowMode) {
    const result = workflow.nodes["story-input"].result;
    return isRecord(result) && typeof result.rawIntent === "string" ? result.rawIntent : "";
  }

  const result = workflow.nodes["scene-input"].result;
  return isRecord(result) && typeof result.rawIntent === "string" ? result.rawIntent : "";
}

function getWorkflowSelectedPromptProfile(rawValue: unknown, workflow: TimelineWorkflowRecordState) {
  if (typeof rawValue === "string") {
    return normalizePromptProfileId(rawValue);
  }

  const inputResult = workflow.workflowMode === storyGraphWorkflowMode
    ? workflow.nodes["story-input"].result
    : workflow.nodes["scene-input"].result;
  const settingsSnapshot = isRecord(inputResult) ? inputResult.settingsSnapshot : undefined;

  return normalizePromptProfileId(
    isRecord(settingsSnapshot) && typeof settingsSnapshot.promptProfile === "string"
      ? settingsSnapshot.promptProfile
      : undefined,
  );
}

function getWorkflowSelectedImageCount(rawValue: unknown, workflow: TimelineWorkflowRecordState) {
  if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
    return rawValue;
  }

  if (workflow.workflowMode === storyGraphWorkflowMode) {
    const inputResult = workflow.nodes["story-input"].result;
    const targetShotCount = isRecord(inputResult) ? inputResult.targetShotCount : undefined;
    return typeof targetShotCount === "number" && Number.isFinite(targetShotCount) ? targetShotCount : 1;
  }

  return 1;
}

export function createTimelineWorkflowRecord(
  input: TimelineWorkflowRecordInput,
): TimelineWorkflowRecord {
  const workflow = sanitizeTimelineWorkflowState(input.workflow) ?? input.workflow;
  const now = new Date().toISOString();
  const selectedNodeId = sanitizeSelectedNodeId(input.selectedNodeId, workflow.workflowMode);
  const selectedStoryShotId = sanitizeSelectedShotId(input.selectedStoryShotId, workflow);

  return {
    kind: TIMELINE_WORKFLOW_RECORD_KIND,
    version: TIMELINE_WORKFLOW_RECORD_VERSION,
    definitionVersion: getDefinitionVersion(workflow.workflowMode),
    ...(typeof input.projectId === "string" && input.projectId.trim()
      ? { projectId: input.projectId.trim() }
      : {}),
    ...(sanitizeTimelineWorkflowProjectName(input.name)
      ? { name: sanitizeTimelineWorkflowProjectName(input.name) }
      : {}),
    workflow,
    sceneRequest: input.sceneRequest.trim() || getWorkflowSceneRequest(workflow),
    selectedPromptProfile: normalizePromptProfileId(input.selectedPromptProfile),
    selectedImageCount: input.selectedImageCount,
    selectedNodeId,
    ...(selectedStoryShotId ? { selectedStoryShotId } : {}),
    outputDisplayModes: sanitizeOutputDisplayModes(input.outputDisplayModes, workflow.workflowMode),
    createdAt: workflow.createdAt,
    updatedAt: now,
  };
}

export function sanitizeTimelineWorkflowRecord(raw: unknown): TimelineWorkflowRecord | null {
  if (
    !isRecord(raw) ||
    raw.kind !== TIMELINE_WORKFLOW_RECORD_KIND ||
    raw.version !== TIMELINE_WORKFLOW_RECORD_VERSION
  ) {
    return null;
  }

  const workflow = sanitizeTimelineWorkflowState(raw.workflow);
  if (!workflow) {
    return null;
  }

  const selectedNodeId = sanitizeSelectedNodeId(raw.selectedNodeId, workflow.workflowMode);
  const selectedStoryShotId = sanitizeSelectedShotId(raw.selectedStoryShotId ?? raw.selectedShotId, workflow);
  const sceneRequest = typeof raw.sceneRequest === "string" ? raw.sceneRequest : getWorkflowSceneRequest(workflow);

  return {
    kind: TIMELINE_WORKFLOW_RECORD_KIND,
    version: TIMELINE_WORKFLOW_RECORD_VERSION,
    definitionVersion: getDefinitionVersion(workflow.workflowMode),
    ...(typeof raw.projectId === "string" && raw.projectId.trim()
      ? { projectId: raw.projectId.trim() }
      : {}),
    ...(sanitizeTimelineWorkflowProjectName(raw.name)
      ? { name: sanitizeTimelineWorkflowProjectName(raw.name) }
      : {}),
    workflow,
    sceneRequest,
    selectedPromptProfile: getWorkflowSelectedPromptProfile(raw.selectedPromptProfile, workflow),
    selectedImageCount: getWorkflowSelectedImageCount(raw.selectedImageCount, workflow),
    selectedNodeId,
    ...(selectedStoryShotId ? { selectedStoryShotId } : {}),
    outputDisplayModes: sanitizeOutputDisplayModes(raw.outputDisplayModes, workflow.workflowMode),
    createdAt: sanitizeDateString(raw.createdAt, workflow.createdAt),
    updatedAt: sanitizeDateString(raw.updatedAt, workflow.updatedAt),
  };
}

export function isSingleImageTimelineWorkflowRecord(
  record: TimelineWorkflowRecord,
): record is TimelineWorkflowRecord & {
  workflow: TimelineWorkflowState;
  selectedNodeId: TimelineNodeId;
  outputDisplayModes: Partial<Record<TimelineNodeId, TimelineOutputDisplayMode>>;
} {
  return record.workflow.workflowMode === singleImageWorkflowMode && isTimelineNodeId(record.selectedNodeId);
}

export function isStoryGraphTimelineWorkflowRecord(
  record: TimelineWorkflowRecord,
): record is TimelineWorkflowRecord & {
  workflow: StoryWorkflowState;
  selectedNodeId: StoryWorkflowNodeId;
  outputDisplayModes: Partial<Record<StoryWorkflowNodeId, TimelineOutputDisplayMode>>;
} {
  return record.workflow.workflowMode === storyGraphWorkflowMode && isStoryWorkflowNodeId(record.selectedNodeId);
}

export function parseTimelineWorkflowRecordJson(json: string): TimelineWorkflowRecord | null {
  return sanitizeTimelineWorkflowRecord(JSON.parse(json) as unknown);
}

export function serializeTimelineWorkflowRecord(record: TimelineWorkflowRecord): string {
  return JSON.stringify(sanitizeTimelineWorkflowRecord(record) ?? record, null, 2);
}
