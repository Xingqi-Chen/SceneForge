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
import { coercePromptProfileId, isPromptProfileId, type PromptProfileId } from "@/shared/prompt-profile";

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

  const sanitized = sanitizeJsonValue(raw, 0, { redactDataUrls: true });

  if (nodeId !== "story-input" || !isRecord(sanitized)) {
    return sanitized;
  }

  const settingsSnapshot = isRecord(sanitized.settingsSnapshot)
    ? sanitized.settingsSnapshot
    : {};

  return {
    ...sanitized,
    settingsSnapshot: {
      ...settingsSnapshot,
      detailers: sanitizeStoryDetailerSettingsSnapshot(settingsSnapshot.detailers),
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
