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
  storyWorkflowNodeIds,
  type StoryShotId,
  type StoryWorkflowNodeId,
} from "./story-types";
import {
  storyShotExecutionStatuses,
  type StoryShotExecutionError,
  type StoryShotExecutionRecord,
  type StoryShotExecutionStatus,
} from "./story-execution";
import {
  sanitizeStoryDetailerSettingsSnapshot,
} from "./story-detailers";
import {
  sanitizeStoryStyleReferenceSnapshot,
} from "./story-style-palette";
import { sanitizeRunSceneInputSettingsSnapshot } from "./run-input-settings";
import {
  resolveTimelineFinalDimensions,
  timelineFinalGenerationPolicy,
} from "./final-generation-policy";
import {
  type CommonWorkflowArtifactScope,
  type CommonWorkflowDefinitionVersion,
} from "./workflow-definition";
import {
  createTimelinePreviewSelectionFallbackMetadata,
  previewScoringRubric,
  timelinePreviewBlockingDefectCategories,
  timelinePreviewCriticalDefectCategories,
  timelineNodeIds,
  timelineNodeStatuses,
  type TimelineNodeId,
  type TimelineNodeMap,
  type TimelineNodeResult,
  type TimelineNodeStatus,
  type TimelineWorkflowState,
} from "./types";
import { coercePromptProfileId, isPromptProfileId, type PromptProfileId } from "@/shared/prompt-profile";
import {
  normalizeComfyUiViewImageReference,
  normalizeStoredGeneratedImageReference,
} from "@/features/comfyui/generated-image-reference";

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
  let error = sanitizeNodeError(raw.error, { redactDataUrls: nodeId !== "scene-input" });
  if ((nodeId === "preview-execution" || nodeId === "comfyui-execution") &&
      isRecord(raw.error) && isRecord(raw.error.details)) {
    const partialResult = nodeId === "preview-execution"
      ? sanitizePreviewExecutionResult(raw.error.details.partialResult)
      : sanitizeFinalExecutionResult(raw.error.details.partialResult);
    if (error) {
      const safeDetails = isRecord(error.details)
        ? Object.fromEntries(Object.entries(error.details).filter(([key]) => key !== "partialResult"))
        : {};
      error = {
        ...error,
        details: {
          ...safeDetails,
          ...(partialResult ? { partialResult } : {}),
        },
      };
    }
  }
  const sanitizedResult = nodeId === "preview-execution"
    ? sanitizePreviewExecutionResult(raw.result)
    : nodeId === "preview-scoring"
      ? sanitizePreviewScoringResult(raw.result)
    : nodeId === "comfyui-execution"
      ? sanitizeFinalExecutionResult(raw.result)
      : nodeId === "result-display"
        ? sanitizeResultDisplayResult(raw.result)
        : raw.result !== undefined
          ? sanitizeJsonValue(raw.result, 0, { redactDataUrls: nodeId !== "scene-input" })
          : undefined;
  const withoutComfyWorkflow = nodeId === "comfyui-execution" && isRecord(sanitizedResult)
    ? Object.fromEntries(Object.entries(sanitizedResult).filter(([key]) => key !== "workflow"))
    : sanitizedResult;
  const result = nodeId === "scene-input" && isRecord(withoutComfyWorkflow)
    ? {
        ...withoutComfyWorkflow,
        settingsSnapshot: sanitizeRunSceneInputSettingsSnapshot(withoutComfyWorkflow.settingsSnapshot),
      }
    : withoutComfyWorkflow;

  if (status === "running") {
    return {
      nodeId,
      status: "error",
      source: "system",
      updatedAt,
      error: createInterruptedNodeError(),
      ...(result !== undefined ? { result } : {}),
    };
  }

  const invalidCompletedResult =
    nodeId === "preview-execution" && status === "done" &&
      (!isRecord(result) || Number(result.successfulCount) < Number(result.finalCount)) ||
    nodeId === "preview-scoring" && (status === "done" || status === "manual") && !isRecord(result) ||
    nodeId === "comfyui-execution" && status === "done" &&
      (!isRecord(result) || result.completed !== true) ||
    nodeId === "result-display" && status === "done" && result === undefined;
  if (invalidCompletedResult) {
    return {
      nodeId,
      status: "error",
      source: "system",
      updatedAt,
      ...(result !== undefined ? { result } : {}),
      error: createTimelineNodeError(
        nodeId === "preview-scoring" ? "timeline_request_invalid" : "image_storage_invalid",
        nodeId === "preview-scoring"
          ? "Persisted preview scoring was invalid. Retry preview scoring."
          : "Persisted generated-image references were invalid. Retry this generation phase.",
        { recoverable: true },
      ),
    };
  }

  return {
    nodeId,
    status,
    source,
    updatedAt,
    ...(result !== undefined ? { result } : {}),
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

  const sanitized = sanitizeJsonValue(raw, 0, { redactDataUrls: true });

  if (nodeId !== "story-input" || !isRecord(sanitized)) {
    return sanitized;
  }

  const settingsSnapshot = isRecord(sanitized.settingsSnapshot)
    ? sanitized.settingsSnapshot
    : {};
  const styleReference = sanitizeStoryStyleReferenceSnapshot(settingsSnapshot.styleReference);

  return {
    ...sanitized,
    settingsSnapshot: {
      ...settingsSnapshot,
      detailers: sanitizeStoryDetailerSettingsSnapshot(settingsSnapshot.detailers),
      ...(styleReference ? { styleReference } : {}),
    },
  };
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
  const isLegacyWorkflow = !("preview-execution" in rawNodes) || !("preview-scoring" in rawNodes);
  const definition = getTimelineWorkflowDefinition(singleImageWorkflowMode);
  const nodes = Object.fromEntries(
    definition.nodeIds.map((nodeId) => [
      nodeId,
      sanitizeTimelineNode(nodeId, rawNodes[nodeId], updatedAt),
    ]),
  ) as TimelineNodeMap;
  if (!isLegacyWorkflow) {
    const scoringIsTrusted = reconcilePersistedPreviewScoring(nodes, updatedAt);
    reconcilePersistedGenerationLinkage(nodes, updatedAt);
    if (!scoringIsTrusted) {
      invalidatePersistedScoringDownstream(nodes, updatedAt);
    }
  }
  if (!isLegacyWorkflow && nodes["comfyui-execution"].status !== "done" && nodes["result-display"].status === "done") {
    nodes["result-display"] = {
      nodeId: "result-display",
      status: "error",
      source: "system",
      updatedAt,
      error: createTimelineNodeError(
        "image_storage_invalid",
        "Persisted final execution references were invalid. Retry final generation before displaying results.",
        { recoverable: true },
      ),
    };
  }

  const legacyCompleted = nodes["result-display"].status === "done";
  const gateResult = nodes["generation-gate"].result;
  const hasConfirmationFingerprint = isRecord(gateResult) &&
    typeof gateResult.confirmationFingerprint === "string" &&
    /^hmac-sha256:[a-f0-9]{64}$/.test(gateResult.confirmationFingerprint);
  const requiresReconfirmation = !legacyCompleted &&
    (isLegacyWorkflow || raw.generationConfirmed === true && !hasConfirmationFingerprint);
  const generationConfirmed = requiresReconfirmation
    ? false
    : typeof raw.generationConfirmed === "boolean" ? raw.generationConfirmed : false;
  if (requiresReconfirmation) {
    nodes["generation-gate"] = {
      ...nodes["generation-gate"],
      status: "blocked",
      source: "system",
      error: createTimelineNodeError(
        "confirmation_required",
        "This Run uses a legacy or unverifiable confirmation and requires review before continuing.",
      ),
    };
    nodes["comfyui-execution"] = {
      ...nodes["comfyui-execution"],
      status: "blocked",
      error: undefined,
    };
    for (const nodeId of ["preview-execution", "preview-scoring", "result-display"] as const) {
      nodes[nodeId] = {
        ...nodes[nodeId],
        status: "blocked",
        error: undefined,
      };
    }
  }

  return refreshTimelineReadiness({
    workflowId: raw.workflowId.trim(),
    workflowMode: singleImageWorkflowMode,
    createdAt,
    updatedAt,
    generationConfirmed,
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

  return refreshStoryWorkflowReadiness({
    workflowId,
    workflowMode: storyGraphWorkflowMode,
    storyId,
    createdAt,
    updatedAt,
    generationConfirmed: typeof raw.generationConfirmed === "boolean" ? raw.generationConfirmed : false,
    nodes,
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

function getWorkflowSettingsPromptProfile(workflow: TimelineWorkflowRecordState) {
  const inputResult = workflow.workflowMode === storyGraphWorkflowMode
    ? workflow.nodes["story-input"].result
    : workflow.nodes["scene-input"].result;
  const settingsSnapshot = isRecord(inputResult) ? inputResult.settingsSnapshot : undefined;
  const promptProfile = isRecord(settingsSnapshot) ? settingsSnapshot.promptProfile : undefined;

  return coercePromptProfileId(promptProfile);
}

function getWorkflowSelectedPromptProfile(rawValue: unknown, workflow: TimelineWorkflowRecordState) {
  if (isPromptProfileId(rawValue)) {
    return rawValue;
  }

  return getWorkflowSettingsPromptProfile(workflow);
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

  const inputResult = workflow.nodes["scene-input"].result;
  return isRecord(inputResult) ? Math.min(4, Math.max(1, Math.round(Number(inputResult.imageCount) || 1))) : 1;
}

function safeIdentifier(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value) ? value : null;
}

function safePreviewCandidateId(value: unknown) {
  return typeof value === "string" && /^preview-[1-8]$/.test(value) ? value : null;
}

function safeNonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function sanitizeTimelineSourceImageReference(value: unknown) {
  if (!isRecord(value) || !safeIdentifier(value.nodeId)) return null;
  const reference = normalizeComfyUiViewImageReference(value);
  return reference ? { ...reference, nodeId: value.nodeId as string } : null;
}

function sanitizeTimelineStoredImage(value: unknown) {
  return normalizeStoredGeneratedImageReference(value);
}

function sanitizePreviewExecutionResult(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.candidates)) return undefined;
  const finalCount = safeNonNegativeInteger(value.finalCount);
  const candidateCount = safeNonNegativeInteger(value.candidateCount);
  const expectedCandidateCount = finalCount ? Math.min(8, Math.max(4, finalCount * 2)) : 0;
  const previewHeight = safeNonNegativeInteger(value.previewHeight);
  const previewWidth = safeNonNegativeInteger(value.previewWidth);
  const previewSteps = safeNonNegativeInteger(value.previewSteps);
  if (!finalCount || finalCount > 4 || candidateCount !== expectedCandidateCount ||
      value.candidates.length !== candidateCount || !previewHeight || previewHeight > 768 ||
      !previewWidth || previewWidth > 768 || !previewSteps || previewSteps > 20) return undefined;
  const candidates = value.candidates.slice(0, candidateCount).map((entry, fallbackIndex) => {
    const raw = isRecord(entry) ? entry : {};
    const index = safeNonNegativeInteger(raw.index);
    const candidateId = safePreviewCandidateId(raw.candidateId);
    const seed = safeNonNegativeInteger(raw.seed);
    const sourceImage = sanitizeTimelineSourceImageReference(raw.sourceImage);
    const storedImage = sanitizeTimelineStoredImage(raw.storedImage);
    const promptId = safeIdentifier(raw.promptId) ?? undefined;
    const validIdentity = index === fallbackIndex && candidateId === `preview-${fallbackIndex + 1}` && seed !== null;
    const validDone = raw.status === "done" && validIdentity && sourceImage && storedImage && promptId;
    if (validDone) {
      return { candidateId, index, seed, status: "done" as const, promptId, sourceImage, storedImage };
    }
    return {
      candidateId: candidateId ?? `invalid-preview-${fallbackIndex + 1}`,
      index: index ?? fallbackIndex,
      seed: seed ?? 0,
      status: "error" as const,
      error: createTimelineNodeError(
        "image_storage_invalid",
        "A persisted preview reference was invalid and must be regenerated.",
        { recoverable: true },
      ),
    };
  });
  const successfulCount = candidates.filter((candidate) => candidate.status === "done").length;
  return {
    baseSeed: safeNonNegativeInteger(value.baseSeed) ?? 0,
    candidateCount,
    finalCount,
    previewHeight,
    previewWidth,
    previewSteps,
    candidates,
    successfulCount,
    warnings: sanitizeStringArray(value.warnings),
  };
}

function calculatePreviewScoreRawTotal(score: {
  adherence: number;
  anatomy: number;
  composition: number;
  style: number;
  technical: number;
}) {
  return score.adherence * previewScoringRubric.adherence +
    score.composition * previewScoringRubric.composition +
    score.anatomy * previewScoringRubric.anatomy +
    score.style * previewScoringRubric.style +
    score.technical * previewScoringRubric.technical;
}

function isCompatiblePreviewEligibility(
  eligible: boolean,
  criticalDefects: ReadonlyArray<{ category: (typeof timelinePreviewCriticalDefectCategories)[number] }>,
) {
  const hasBlockingDefect = criticalDefects.some((defect) =>
    timelinePreviewBlockingDefectCategories.includes(
      defect.category as (typeof timelinePreviewBlockingDefectCategories)[number],
    ));
  if (hasBlockingDefect) return !eligible;
  if (criticalDefects.length === 0) return eligible;
  // Rubric-v2 records created before soft annotations were introduced marked every
  // defect ineligible. Both that conservative legacy state and the current
  // soft-annotation state remain readable.
  return true;
}

function sanitizePreviewScoringResult(value: unknown) {
  if (!isRecord(value) || (value.rubricVersion !== 1 && value.rubricVersion !== 2) || !Array.isArray(value.scores) ||
      !Array.isArray(value.selectedCandidateIds) ||
      (value.selectionSource !== "ai" && value.selectionSource !== "manual")) return undefined;
  const rubricVersion = value.rubricVersion;
  const criticalDefectCategorySet = new Set<string>(timelinePreviewCriticalDefectCategories);
  const scores = value.scores.map((entry) => {
    if (!isRecord(entry)) return null;
    const candidateId = safePreviewCandidateId(entry.candidateId);
    const rank = safeNonNegativeInteger(entry.rank);
    const dimensionKeys = ["adherence", "composition", "anatomy", "style", "technical", "total"] as const;
    if (!candidateId || rank === null || rank < 1 || rank > 8 ||
        dimensionKeys.some((key) => typeof entry[key] !== "number" || !Number.isFinite(entry[key]) ||
          (entry[key] as number) < 0 || (entry[key] as number) > 100) ||
        (entry.rationale !== undefined && typeof entry.rationale !== "string")) return null;
    const adherence = entry.adherence as number;
    const composition = entry.composition as number;
    const anatomy = entry.anatomy as number;
    const style = entry.style as number;
    const technical = entry.technical as number;
    const total = Number(calculatePreviewScoreRawTotal({
      adherence,
      anatomy,
      composition,
      style,
      technical,
    }).toFixed(2));
    const eligibility = (() => {
      if (rubricVersion === 1) return {};
      if (typeof entry.eligible !== "boolean" || !Array.isArray(entry.criticalDefects) ||
          entry.criticalDefects.length > timelinePreviewCriticalDefectCategories.length) return null;
      const seenCategories = new Set<string>();
      const criticalDefects = entry.criticalDefects.map((defect) => {
        if (!isRecord(defect) || typeof defect.category !== "string" ||
            !criticalDefectCategorySet.has(defect.category) || seenCategories.has(defect.category) ||
            typeof defect.description !== "string" || !defect.description.trim()) return null;
        seenCategories.add(defect.category);
        return {
          category: defect.category as (typeof timelinePreviewCriticalDefectCategories)[number],
          description: defect.description.trim().slice(0, 500),
        };
      });
      if (criticalDefects.some((defect) => !defect) ||
          !isCompatiblePreviewEligibility(
            entry.eligible,
            criticalDefects as Array<{ category: (typeof timelinePreviewCriticalDefectCategories)[number] }>,
          )) return null;
      return { criticalDefects, eligible: entry.eligible };
    })();
    if (!eligibility) return null;
    return {
      adherence,
      anatomy,
      candidateId,
      composition,
      rank,
      style,
      technical,
      total,
      ...eligibility,
      ...(typeof entry.rationale === "string" && entry.rationale.trim()
        ? { rationale: entry.rationale.trim().slice(0, 2_000) }
        : {}),
    };
  });
  if (scores.some((score) => !score)) return undefined;
  const selectedCandidateIds = value.selectedCandidateIds.map(safePreviewCandidateId);
  if (selectedCandidateIds.some((candidateId) => !candidateId)) return undefined;
  const safeScores = scores as Array<NonNullable<(typeof scores)[number]>>;
  const safeSelectedCandidateIds = selectedCandidateIds as string[];
  return {
    rubricVersion,
    scores: safeScores,
    selectedCandidateIds: safeSelectedCandidateIds,
    selectionSource: value.selectionSource,
    ...(rubricVersion === 2
      ? createTimelinePreviewSelectionFallbackMetadata(
          safeScores.map((score) => ({ candidateId: score.candidateId, eligible: score.eligible === true })),
          safeSelectedCandidateIds,
        )
      : {}),
  };
}

function sanitizeFinalExecutionResult(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.finals)) return undefined;
  const finalCount = safeNonNegativeInteger(value.finalCount);
  if (!finalCount || finalCount > 4) return undefined;
  const finalPolicy = isRecord(value.finalPolicy) &&
      value.finalPolicy.version === timelineFinalGenerationPolicy.version &&
      value.finalPolicy.resizeMode === timelineFinalGenerationPolicy.resizeMode
    ? {
        version: timelineFinalGenerationPolicy.version,
        resizeMode: timelineFinalGenerationPolicy.resizeMode,
      }
    : undefined;
  const sanitizePreviewUpscale = (raw: unknown) => {
    if (!isRecord(raw) || raw.policyVersion !== timelineFinalGenerationPolicy.version ||
        raw.resizeMode !== timelineFinalGenerationPolicy.resizeMode) return undefined;
    const width = safeNonNegativeInteger(raw.width);
    const height = safeNonNegativeInteger(raw.height);
    const sourcePreview = sanitizeTimelineStoredImage(raw.sourcePreview);
    const storedImage = sanitizeTimelineStoredImage(raw.storedImage);
    return width && height && sourcePreview && storedImage
      ? {
          policyVersion: timelineFinalGenerationPolicy.version,
          resizeMode: timelineFinalGenerationPolicy.resizeMode,
          width,
          height,
          sourcePreview,
          storedImage,
        }
      : undefined;
  };
  const finals = value.finals.slice(0, finalCount).map((entry, index) => {
    const raw = isRecord(entry) ? entry : {};
    const candidateId = safePreviewCandidateId(raw.candidateId);
    const seed = safeNonNegativeInteger(raw.seed);
    const rank = safeNonNegativeInteger(raw.rank);
    const sourceImage = sanitizeTimelineSourceImageReference(raw.sourceImage);
    const storedImage = sanitizeTimelineStoredImage(raw.storedImage);
    const promptId = safeIdentifier(raw.promptId) ?? undefined;
    const previewUpscale = sanitizePreviewUpscale(raw.previewUpscale);
    const validDone = raw.status === "done" && candidateId && seed !== null && rank !== null && rank >= 1 && rank <= 8 &&
      sourceImage && storedImage && promptId && (!finalPolicy || previewUpscale);
    if (validDone) {
      return {
        candidateId,
        seed,
        rank,
        status: "done" as const,
        promptId,
        sourceImage,
        storedImage,
        ...(previewUpscale ? { previewUpscale } : {}),
      };
    }
    return {
      candidateId: candidateId ?? `invalid-final-${index + 1}`,
      seed: seed ?? 0,
      rank: rank && rank >= 1 ? rank : index + 1,
      status: "error" as const,
      ...(previewUpscale ? { previewUpscale } : {}),
      error: createTimelineNodeError(
        "image_storage_invalid",
        "A persisted final reference was invalid and must be rendered again.",
        { recoverable: true },
      ),
    };
  });
  const done = finals.filter((item) => item.status === "done");
  const validCompleteSet = finals.length === finalCount && done.length === finalCount &&
    new Set(done.map((item) => item.candidateId)).size === finalCount &&
    new Set(done.map((item) => item.rank)).size === finalCount;
  const request = isRecord(value.request)
    ? sanitizeJsonValue(value.request, 0, { redactDataUrls: true })
    : {};
  return {
    completed: value.completed === true && validCompleteSet,
    finalCount,
    finals,
    ...(finalPolicy ? { finalPolicy } : {}),
    request,
    warnings: sanitizeStringArray(value.warnings),
  };
}

function sanitizeResultDisplayResult(value: unknown) {
  if (!isRecord(value) || value.completed !== true) return undefined;
  const rawStoredImages = Array.isArray(value.storedImages) ? value.storedImages : [value.storedImage];
  const rawSourceImages = Array.isArray(value.sourceImages) ? value.sourceImages : [value.sourceImage];
  const rawImages = Array.isArray(value.images) ? value.images : [value.image];
  const storedImages = rawStoredImages.map(sanitizeTimelineStoredImage);
  const sourceImages = rawSourceImages.map(sanitizeTimelineSourceImageReference);
  if (!storedImages.length || storedImages.some((item) => !item) || sourceImages.length !== storedImages.length ||
      sourceImages.some((item) => !item)) return undefined;
  const images = rawImages.map((item, index) => {
    const source = sanitizeTimelineSourceImageReference(item);
    return source && isRecord(item) && item.url === storedImages[index]?.url
      ? { ...source, url: item.url as string }
      : null;
  });
  if (images.length !== storedImages.length || images.some((item) => !item)) return undefined;
  const promptId = safeIdentifier(value.promptId);
  if (!promptId) return undefined;
  const finalLinks = Array.isArray(value.finalLinks)
    ? value.finalLinks.map((entry) => {
        if (!isRecord(entry) || !safePreviewCandidateId(entry.candidateId) ||
            safeNonNegativeInteger(entry.seed) === null || safeNonNegativeInteger(entry.rank) === null ||
            (entry.rank as number) < 1 || (entry.rank as number) > 8 ||
            !safeIdentifier(entry.promptId)) return null;
        return {
          candidateId: entry.candidateId as string,
          promptId: safeIdentifier(entry.promptId)!,
          rank: entry.rank as number,
          seed: entry.seed as number,
        };
      })
    : undefined;
  if (finalLinks && (finalLinks.length !== storedImages.length || finalLinks.some((entry) => !entry) ||
      new Set(finalLinks.map((entry) => entry?.candidateId)).size !== finalLinks.length ||
      new Set(finalLinks.map((entry) => entry?.rank)).size !== finalLinks.length)) return undefined;
  const fallbacks = Array.isArray(value.fallbacks)
    ? value.fallbacks.map((entry) => {
        if (!isRecord(entry) || !safePreviewCandidateId(entry.candidateId) ||
            safeNonNegativeInteger(entry.seed) === null || safeNonNegativeInteger(entry.rank) === null ||
            (entry.rank as number) < 1 || (entry.rank as number) > 8) return null;
        const storedImage = sanitizeTimelineStoredImage(entry.storedImage);
        return storedImage ? {
          candidateId: entry.candidateId as string,
          rank: entry.rank as number,
          seed: entry.seed as number,
          storedImage,
        } : null;
      })
    : undefined;
  if (fallbacks && (fallbacks.length !== storedImages.length || fallbacks.some((entry) => !entry) ||
      new Set(fallbacks.map((entry) => entry?.candidateId)).size !== fallbacks.length ||
      new Set(fallbacks.map((entry) => entry?.rank)).size !== fallbacks.length)) return undefined;
  return {
    completed: true,
    image: images[0],
    images,
    promptId,
    sourceImage: sourceImages[0],
    sourceImages,
    storedImage: storedImages[0],
    storedImages,
    ...(fallbacks ? { fallbacks } : {}),
    warnings: sanitizeStringArray(value.warnings),
    ...(finalLinks ? { finalLinks } : {}),
  };
}

function reconcilePersistedPreviewScoring(nodes: TimelineNodeMap, updatedAt: string) {
  const scoringNode = nodes["preview-scoring"];
  if (scoringNode.status === "error" && scoringNode.error?.code === "timeline_request_invalid") {
    const details = scoringNode.error.details;
    if (isRecord(details) && details.retryFrom === "preview-execution") {
      const eligibleCount = safeNonNegativeInteger(details.eligibleCount);
      const finalCount = safeNonNegativeInteger(details.finalCount);
      nodes["preview-scoring"] = {
        ...scoringNode,
        updatedAt,
        error: createTimelineNodeError(
          "timeline_request_invalid",
          "This preview round can now use annotated fallback selection. Retry preview scoring to continue.",
          {
            recoverable: true,
            ...(eligibleCount !== null ? { eligibleCount } : {}),
            ...(finalCount !== null ? { finalCount } : {}),
          },
        ),
      };
    }
    return false;
  }
  if (scoringNode.status !== "done" && scoringNode.status !== "manual") return true;

  const preview = nodes["preview-execution"].result;
  const scoring = scoringNode.result;
  let valid = nodes["preview-execution"].status === "done" &&
    isRecord(preview) && Array.isArray(preview.candidates) &&
    isRecord(scoring) && (scoring.rubricVersion === 1 || scoring.rubricVersion === 2) && Array.isArray(scoring.scores) &&
    Array.isArray(scoring.selectedCandidateIds) &&
    (scoring.selectionSource === "ai" || scoring.selectionSource === "manual");
  if (valid && isRecord(preview) && Array.isArray(preview.candidates) &&
      isRecord(scoring) && Array.isArray(scoring.scores) && Array.isArray(scoring.selectedCandidateIds)) {
    const successfulCandidates = preview.candidates.filter((candidate) =>
      isRecord(candidate) && candidate.status === "done" && safePreviewCandidateId(candidate.candidateId),
    );
    const successful = successfulCandidates.flatMap((candidate) => {
      if (!isRecord(candidate) || !safePreviewCandidateId(candidate.candidateId)) return [];
      const index = safeNonNegativeInteger(candidate.index);
      return index === null ? [] : [{ candidateId: candidate.candidateId as string, index }];
    });
    const successfulIds = successful.map((candidate) => candidate.candidateId);
    const previewIndexById = new Map(successful.map((candidate) => [candidate.candidateId, candidate.index]));
    const validatedScores = scoring.scores.flatMap((score) => {
      if (!isRecord(score) || !safePreviewCandidateId(score.candidateId) ||
          typeof score.adherence !== "number" || !Number.isFinite(score.adherence) ||
          typeof score.composition !== "number" || !Number.isFinite(score.composition) ||
          typeof score.anatomy !== "number" || !Number.isFinite(score.anatomy) ||
          typeof score.style !== "number" || !Number.isFinite(score.style) ||
          typeof score.technical !== "number" || !Number.isFinite(score.technical)) return [];
      const rank = safeNonNegativeInteger(score.rank);
      if (rank === null || rank < 1) return [];
      const eligible = scoring.rubricVersion === 2 ? score.eligible : true;
      if (typeof eligible !== "boolean" ||
          (scoring.rubricVersion === 2 && (!Array.isArray(score.criticalDefects) ||
            score.criticalDefects.some((defect) => !isRecord(defect) ||
              typeof defect.category !== "string" ||
              !timelinePreviewCriticalDefectCategories.includes(
                defect.category as (typeof timelinePreviewCriticalDefectCategories)[number],
              ) || typeof defect.description !== "string" || !defect.description.trim()) ||
            !isCompatiblePreviewEligibility(
              eligible,
              score.criticalDefects as Array<{
                category: (typeof timelinePreviewCriticalDefectCategories)[number];
              }>,
            )))) return [];
      return [{
        adherence: score.adherence,
        anatomy: score.anatomy,
        candidateId: score.candidateId as string,
        composition: score.composition,
        eligible,
        rank,
        style: score.style,
        technical: score.technical,
      }];
    });
    const expectedOrder = [...validatedScores].sort((left, right) =>
      Number(right.eligible) - Number(left.eligible) ||
      calculatePreviewScoreRawTotal(right) - calculatePreviewScoreRawTotal(left) ||
      right.composition - left.composition ||
      (previewIndexById.get(left.candidateId) ?? Number.MAX_SAFE_INTEGER) -
        (previewIndexById.get(right.candidateId) ?? Number.MAX_SAFE_INTEGER),
    );
    const expectedCandidateIds = expectedOrder.map((score) => score.candidateId);
    const ranksMatchExpectedOrder = expectedOrder.every((score, index) => score.rank === index + 1);
    const finalCount = safeNonNegativeInteger(preview.finalCount);
    const selectedFallbackMetadata = createTimelinePreviewSelectionFallbackMetadata(
      expectedOrder,
      scoring.selectedCandidateIds as string[],
    );
    const fallbackMetadataMatches = scoring.rubricVersion === 1 || (
      scoring.eligibleCount === selectedFallbackMetadata.eligibleCount &&
      Array.isArray(scoring.fallbackCandidateIds) &&
      scoring.fallbackCandidateIds.length === selectedFallbackMetadata.fallbackCandidateIds.length &&
      scoring.fallbackCandidateIds.every(
        (candidateId, index) => candidateId === selectedFallbackMetadata.fallbackCandidateIds[index],
      ) &&
      scoring.selectionWarning === selectedFallbackMetadata.selectionWarning
    );
    valid = Boolean(finalCount && finalCount <= 4 && successfulIds.length >= finalCount &&
      successful.length === successfulCandidates.length &&
      successfulIds.length === new Set(successfulIds).size &&
      new Set(successful.map((candidate) => candidate.index)).size === successful.length &&
      scoring.scores.length === successfulIds.length &&
      validatedScores.length === successfulIds.length &&
      expectedCandidateIds.every((candidateId) => successfulIds.includes(candidateId)) &&
      new Set(expectedCandidateIds).size === successfulIds.length &&
      ranksMatchExpectedOrder &&
      scoring.selectedCandidateIds.length === finalCount &&
      new Set(scoring.selectedCandidateIds).size === finalCount &&
      scoring.selectedCandidateIds.every((candidateId) => typeof candidateId === "string" && successfulIds.includes(candidateId)) &&
      fallbackMetadataMatches &&
      (scoring.selectionSource === "manual"
        ? true
        : scoring.selectedCandidateIds.every((candidateId, index) => candidateId === expectedCandidateIds[index])));
  }
  if (valid) return true;

  nodes["preview-scoring"] = {
    nodeId: "preview-scoring",
    status: "error",
    source: "system",
    updatedAt,
    error: createTimelineNodeError(
      "timeline_request_invalid",
      "Persisted preview scoring did not match the successful preview pool. Retry preview scoring.",
      { recoverable: true },
    ),
  };
  return false;
}

function invalidatePersistedScoringDownstream(nodes: TimelineNodeMap, updatedAt: string) {
  for (const nodeId of ["comfyui-execution", "result-display"] as const) {
    nodes[nodeId] = {
      nodeId,
      status: "error",
      source: "system",
      updatedAt,
      error: createTimelineNodeError(
        "timeline_request_invalid",
        "Persisted preview scoring was invalid. Retry scoring before final generation.",
        { recoverable: true },
      ),
    };
  }
}

type PersistedFinalLink = {
  candidateId: string;
  rank: number;
  seed: number;
  formalHeight: number | null;
  formalWidth: number | null;
  sourcePreview: unknown;
};

function getPersistedExpectedFinalLinks(nodes: TimelineNodeMap) {
  const preview = nodes["preview-execution"].result;
  const scoring = nodes["preview-scoring"].result;
  if (!isRecord(preview) || !Array.isArray(preview.candidates) ||
      !isRecord(scoring) || !Array.isArray(scoring.scores) ||
      !Array.isArray(scoring.selectedCandidateIds)) return null;

  const finalCount = safeNonNegativeInteger(preview.finalCount);
  const previewCandidates = preview.candidates as unknown[];
  const scoringScores = scoring.scores as unknown[];
  const selectedCandidateIds = scoring.selectedCandidateIds;
  const parameters = nodes["parameter-recommendation"].result;
  const requestPreview = isRecord(parameters) && isRecord(parameters.requestPreview)
    ? parameters.requestPreview
    : {};
  const sceneInput = nodes["scene-input"].result;
  const sourceImage = isRecord(sceneInput) && isRecord(sceneInput.sourceImage)
    ? {
        width: safeNonNegativeInteger(sceneInput.sourceImage.width) ?? 0,
        height: safeNonNegativeInteger(sceneInput.sourceImage.height) ?? 0,
      }
    : undefined;
  const formalDimensions = resolveTimelineFinalDimensions({
    request: {
      width: safeNonNegativeInteger(requestPreview.width) ?? undefined,
      height: safeNonNegativeInteger(requestPreview.height) ?? undefined,
    },
    ...(sourceImage?.width && sourceImage.height ? { sourceImage } : {}),
  });
  if (!finalCount || finalCount > 4 || selectedCandidateIds.length !== finalCount ||
      new Set(selectedCandidateIds).size !== finalCount ||
      selectedCandidateIds.some((candidateId) => !safePreviewCandidateId(candidateId))) return null;

  const links = selectedCandidateIds.flatMap((candidateId): PersistedFinalLink[] => {
    const candidates = previewCandidates.filter((candidate) =>
      isRecord(candidate) && candidate.candidateId === candidateId && candidate.status === "done",
    );
    const scores = scoringScores.filter((score) =>
      isRecord(score) && score.candidateId === candidateId,
    );
    if (candidates.length !== 1 || scores.length !== 1) return [];
    const seed = safeNonNegativeInteger(isRecord(candidates[0]) ? candidates[0].seed : undefined);
    const rank = safeNonNegativeInteger(isRecord(scores[0]) ? scores[0].rank : undefined);
    const storedImage = isRecord(candidates[0]) && isRecord(candidates[0].storedImage)
      ? candidates[0].storedImage
      : null;
    if (seed === null || rank === null || rank < 1 || rank > scoringScores.length ||
        !storedImage || typeof storedImage.filename !== "string") return [];
    return [{
      candidateId: candidateId as string,
      rank,
      seed,
      formalHeight: formalDimensions?.height ?? null,
      formalWidth: formalDimensions?.width ?? null,
      sourcePreview: storedImage,
    }];
  });
  if (links.length !== finalCount || new Set(links.map((link) => link.rank)).size !== finalCount) return null;

  return {
    finalCount,
    links: links.sort((left, right) => left.rank - right.rank),
  };
}

function createUntrustedPersistedFinal(link: PersistedFinalLink) {
  const { candidateId, rank, seed } = link;
  return {
    candidateId,
    rank,
    seed,
    status: "error" as const,
    error: createTimelineNodeError(
      "image_storage_invalid",
      "This persisted final no longer matches its selected preview and must be rendered again.",
      { recoverable: true },
    ),
  };
}

function reconcilePersistedFinalResult(
  value: unknown,
  expected: ReturnType<typeof getPersistedExpectedFinalLinks>,
) {
  if (!expected || !isRecord(value) || !Array.isArray(value.finals) ||
      value.finalCount !== expected.finalCount) return null;

  const rawRecords = value.finals.filter(isRecord);
  const rawDone = rawRecords.filter((item) => item.status === "done");
  const currentPolicy = isRecord(value.finalPolicy) &&
    value.finalPolicy.version === timelineFinalGenerationPolicy.version &&
    value.finalPolicy.resizeMode === timelineFinalGenerationPolicy.resizeMode;
  const matchesCurrentFallback = (item: Record<string, unknown>, link: PersistedFinalLink) =>
    link.formalWidth !== null && link.formalHeight !== null &&
    isRecord(item.previewUpscale) && item.previewUpscale.policyVersion === timelineFinalGenerationPolicy.version &&
    item.previewUpscale.resizeMode === timelineFinalGenerationPolicy.resizeMode &&
    item.previewUpscale.width === link.formalWidth && item.previewUpscale.height === link.formalHeight &&
    samePersistedStoredImage(item.previewUpscale.sourcePreview, link.sourcePreview) &&
    isRecord(item.previewUpscale.storedImage);
  const trustedFinals = expected.links.map((link) => {
    const matches = rawRecords.filter((item) =>
      item.candidateId === link.candidateId && item.seed === link.seed && item.rank === link.rank,
    );
    const trusted = matches.filter((item) =>
      item.status === "done" ? (!currentPolicy || matchesCurrentFallback(item, link))
        : item.status === "error" && currentPolicy && matchesCurrentFallback(item, link),
    );
    return matches.length === 1 && trusted.length === 1 ? trusted[0] : createUntrustedPersistedFinal(link);
  });
  const trustedDoneCount = trustedFinals.filter((item) => item.status === "done").length;
  const invalidDone = rawDone.length !== trustedDoneCount || rawDone.some((item) =>
    !expected.links.some((link) =>
      item.candidateId === link.candidateId && item.seed === link.seed && item.rank === link.rank,
    ),
  );
  const completed = value.completed === true && !invalidDone &&
    value.finals.length === expected.finalCount && trustedDoneCount === expected.finalCount;

  return {
    result: {
      ...value,
      completed,
      finalCount: expected.finalCount,
      finals: trustedFinals,
    },
    completed,
    invalidDone,
    trustedDoneCount,
  };
}

function samePersistedSourceImage(left: unknown, right: unknown) {
  if (!isRecord(left) || !isRecord(right)) return false;
  return left.filename === right.filename && left.nodeId === right.nodeId &&
    left.subfolder === right.subfolder && left.type === right.type;
}

function samePersistedStoredImage(left: unknown, right: unknown) {
  if (!isRecord(left) || !isRecord(right)) return false;
  return left.byteLength === right.byteLength && left.contentType === right.contentType &&
    left.filename === right.filename && left.url === right.url;
}

function resultDisplayMatchesFinals(display: unknown, finalResult: unknown) {
  if (!isRecord(display) || !isRecord(finalResult) || !Array.isArray(finalResult.finals) ||
      !Array.isArray(display.images) || !Array.isArray(display.sourceImages) ||
      !Array.isArray(display.storedImages) || !Array.isArray(display.finalLinks)) return false;
  const finals = finalResult.finals;
  const images = display.images as unknown[];
  const sourceImages = display.sourceImages as unknown[];
  const storedImages = display.storedImages as unknown[];
  const finalLinks = display.finalLinks as unknown[];
  const fallbackFinals = finals.filter((final) => isRecord(final) && isRecord(final.previewUpscale));
  const fallbacks = Array.isArray(display.fallbacks) ? display.fallbacks : [];
  if (finals.length !== finalResult.finalCount || images.length !== finals.length ||
      sourceImages.length !== finals.length || storedImages.length !== finals.length ||
      finalLinks.length !== finals.length ||
      (fallbackFinals.length > 0 && fallbacks.length !== finals.length) ||
      (fallbackFinals.length === 0 && fallbacks.length > 0)) return false;

  return finals.every((final, index) => {
    if (!isRecord(final) || final.status !== "done" || !isRecord(images[index]) ||
        !isRecord(finalLinks[index])) return false;
    const image = images[index];
    const link = finalLinks[index];
    const fallbackMatches = fallbackFinals.length === 0 || (
      isRecord(fallbacks[index]) && isRecord(final.previewUpscale) &&
      fallbacks[index].candidateId === final.candidateId && fallbacks[index].seed === final.seed &&
      fallbacks[index].rank === final.rank &&
      samePersistedStoredImage(fallbacks[index].storedImage, final.previewUpscale.storedImage)
    );
    return fallbackMatches && samePersistedSourceImage(sourceImages[index], final.sourceImage) &&
      samePersistedStoredImage(storedImages[index], final.storedImage) &&
      samePersistedSourceImage(image, final.sourceImage) &&
      image.url === (isRecord(final.storedImage) ? final.storedImage.url : undefined) &&
      link.candidateId === final.candidateId && link.seed === final.seed &&
      link.rank === final.rank && link.promptId === final.promptId;
  }) && display.promptId === (isRecord(finals[0]) ? finals[0].promptId : undefined) &&
    samePersistedSourceImage(display.sourceImage, isRecord(finals[0]) ? finals[0].sourceImage : undefined) &&
    samePersistedStoredImage(display.storedImage, isRecord(finals[0]) ? finals[0].storedImage : undefined);
}

function reconcilePersistedGenerationLinkage(nodes: TimelineNodeMap, updatedAt: string) {
  const expected = getPersistedExpectedFinalLinks(nodes);
  const finalNode = nodes["comfyui-execution"];
  const errorPartial = isRecord(finalNode.error?.details)
    ? finalNode.error.details.partialResult
    : undefined;
  const reconciled = reconcilePersistedFinalResult(finalNode.result ?? errorPartial, expected);

  if (finalNode.status === "done" && (!reconciled || !reconciled.completed)) {
    const partialResult = reconciled && reconciled.trustedDoneCount > 0 ? reconciled.result : undefined;
    nodes["comfyui-execution"] = {
      nodeId: "comfyui-execution",
      status: "error",
      source: "system",
      updatedAt,
      ...(partialResult ? { result: partialResult } : {}),
      error: createTimelineNodeError(
        "image_storage_invalid",
        "Persisted final images did not match the selected previews. Retry final generation.",
        { recoverable: true, ...(partialResult ? { partialResult } : {}) },
      ),
    };
  } else if (finalNode.status === "done" && reconciled) {
    nodes["comfyui-execution"] = { ...finalNode, result: reconciled.result };
  } else if (finalNode.status === "error" && reconciled) {
    const safeDetails = isRecord(finalNode.error?.details)
      ? Object.fromEntries(Object.entries(finalNode.error.details).filter(([key]) => key !== "partialResult"))
      : {};
    const error = reconciled.invalidDone
      ? createTimelineNodeError(
          "image_storage_invalid",
          "Some persisted final images did not match the selected previews and must be rendered again.",
          { ...safeDetails, recoverable: true, partialResult: reconciled.result },
        )
      : finalNode.error
        ? { ...finalNode.error, details: { ...safeDetails, partialResult: reconciled.result } }
        : undefined;
    nodes["comfyui-execution"] = {
      ...finalNode,
      result: reconciled.result,
      ...(error ? { error } : {}),
    };
  } else if (finalNode.status === "error" && !expected) {
    nodes["comfyui-execution"] = {
      ...finalNode,
      result: undefined,
      error: createTimelineNodeError(
        "image_storage_invalid",
        "Persisted final selections could not be verified. Regenerate previews or scoring before retrying finals.",
        { recoverable: true },
      ),
    };
  }

  const trustedFinalNode = nodes["comfyui-execution"];
  const trustedFinalResult = trustedFinalNode.result;
  const displayNode = nodes["result-display"];
  if (displayNode.status === "done" &&
      (trustedFinalNode.status !== "done" || !resultDisplayMatchesFinals(displayNode.result, trustedFinalResult))) {
    nodes["result-display"] = {
      nodeId: "result-display",
      status: "error",
      source: "system",
      updatedAt,
      error: createTimelineNodeError(
        "image_storage_invalid",
        "Persisted display results did not match the verified final images. Retry final generation.",
        { recoverable: true },
      ),
    };
  }
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
    selectedPromptProfile: getWorkflowSelectedPromptProfile(input.selectedPromptProfile, workflow),
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
