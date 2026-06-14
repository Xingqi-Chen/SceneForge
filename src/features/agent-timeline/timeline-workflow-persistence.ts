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
  timelineNodeIds,
  timelineNodeStatuses,
  type TimelineNodeId,
  type TimelineNodeMap,
  type TimelineErrorCode,
  type TimelineNodeResult,
  type TimelineNodeStatus,
  type TimelineWorkflowState,
} from "./types";
import { normalizePromptProfileId, type PromptProfileId } from "@/shared/prompt-profile";

export const TIMELINE_WORKFLOW_RECORD_KIND = "sceneforge-timeline-workflow" as const;
export const TIMELINE_WORKFLOW_RECORD_VERSION = 1 as const;

export type TimelineOutputDisplayMode = "json" | "visual";
export type TimelineOutputDisplayModeMap = Partial<Record<TimelineNodeId, TimelineOutputDisplayMode>>;

export type TimelineWorkflowRecord = {
  kind: typeof TIMELINE_WORKFLOW_RECORD_KIND;
  version: typeof TIMELINE_WORKFLOW_RECORD_VERSION;
  projectId?: string;
  name?: string;
  workflow: TimelineWorkflowState;
  sceneRequest: string;
  selectedPromptProfile: PromptProfileId;
  selectedImageCount: number;
  selectedNodeId: TimelineNodeId;
  outputDisplayModes: TimelineOutputDisplayModeMap;
  createdAt: string;
  updatedAt: string;
};

export type TimelineWorkflowSummary = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type TimelineWorkflowRecordInput = {
  projectId?: string | null;
  name?: string | null;
  workflow: TimelineWorkflowState;
  sceneRequest: string;
  selectedPromptProfile: PromptProfileId;
  selectedImageCount: number;
  selectedNodeId: TimelineNodeId;
  outputDisplayModes?: TimelineOutputDisplayModeMap;
};

const statusSet = new Set<TimelineNodeStatus>(timelineNodeStatuses);
const nodeIdSet = new Set<TimelineNodeId>(timelineNodeIds);
const redactedKeyPattern = /(api[-_]?key|authorization|bearer|password|secret|token)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTimelineNodeId(value: unknown): value is TimelineNodeId {
  return typeof value === "string" && nodeIdSet.has(value as TimelineNodeId);
}

function sanitizeDateString(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

export function sanitizeTimelineWorkflowProjectName(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 120) : "";
}

function sanitizeJsonValue(value: unknown, depth = 0): unknown {
  if (depth > 12) {
    return null;
  }

  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeJsonValue(entry, depth + 1));
  }

  if (!isRecord(value)) {
    return null;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      redactedKeyPattern.test(key) ? "[redacted]" : sanitizeJsonValue(entry, depth + 1),
    ]),
  );
}

function sanitizeNodeStatus(value: unknown): TimelineNodeStatus {
  return typeof value === "string" && statusSet.has(value as TimelineNodeStatus)
    ? value as TimelineNodeStatus
    : "blocked";
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
  const source =
    raw.source === "ai" || raw.source === "manual" || raw.source === "system"
      ? raw.source
      : "system";
  const error = isRecord(raw.error) && typeof raw.error.message === "string" && typeof raw.error.code === "string"
    ? {
        code: raw.error.code as TimelineErrorCode,
        message: raw.error.message,
        ...(raw.error.details !== undefined ? { details: sanitizeJsonValue(raw.error.details) } : {}),
      }
    : undefined;

  if (status === "running") {
    return {
      nodeId,
      status: "error",
      source: "system",
      updatedAt,
      error: createTimelineNodeError(
        "timeline_node_failed",
        "This node was interrupted while the workflow was away. Rerun it to continue.",
      ),
      ...(raw.result !== undefined ? { result: sanitizeJsonValue(raw.result) } : {}),
    };
  }

  return {
    nodeId,
    status,
    source,
    updatedAt,
    ...(raw.result !== undefined ? { result: sanitizeJsonValue(raw.result) } : {}),
    ...(error ? { error } : {}),
  };
}

function sanitizeWorkflowMode(value: unknown): TimelineWorkflowMode {
  return value === singleImageWorkflowMode ? singleImageWorkflowMode : singleImageWorkflowMode;
}

export function sanitizeTimelineWorkflowState(raw: unknown): TimelineWorkflowState | null {
  if (!isRecord(raw) || typeof raw.workflowId !== "string" || !raw.workflowId.trim()) {
    return null;
  }

  const workflowMode = sanitizeWorkflowMode(raw.workflowMode);
  const definition = getTimelineWorkflowDefinition(workflowMode);
  const fallback = createTimelineWorkflowState({ workflowId: raw.workflowId.trim() });
  const createdAt = sanitizeDateString(raw.createdAt, fallback.createdAt);
  const updatedAt = sanitizeDateString(raw.updatedAt, fallback.updatedAt);
  const rawNodes = isRecord(raw.nodes) ? raw.nodes : {};
  const nodes = Object.fromEntries(
    definition.nodeIds.map((nodeId) => [
      nodeId,
      sanitizeTimelineNode(nodeId, rawNodes[nodeId], updatedAt),
    ]),
  ) as TimelineNodeMap;

  return refreshTimelineReadiness({
    workflowId: raw.workflowId.trim(),
    workflowMode,
    createdAt,
    updatedAt,
    generationConfirmed: typeof raw.generationConfirmed === "boolean" ? raw.generationConfirmed : false,
    nodes,
  });
}

function sanitizeOutputDisplayModes(raw: unknown): TimelineOutputDisplayModeMap {
  if (!isRecord(raw)) {
    return {};
  }

  const result: TimelineOutputDisplayModeMap = {};
  for (const [key, value] of Object.entries(raw)) {
    if (isTimelineNodeId(key) && (value === "json" || value === "visual")) {
      result[key] = value;
    }
  }

  return result;
}

export function createTimelineWorkflowRecord(
  input: TimelineWorkflowRecordInput,
): TimelineWorkflowRecord {
  const workflow = sanitizeTimelineWorkflowState(input.workflow) ?? input.workflow;
  const now = new Date().toISOString();

  return {
    kind: TIMELINE_WORKFLOW_RECORD_KIND,
    version: TIMELINE_WORKFLOW_RECORD_VERSION,
    ...(typeof input.projectId === "string" && input.projectId.trim()
      ? { projectId: input.projectId.trim() }
      : {}),
    ...(sanitizeTimelineWorkflowProjectName(input.name)
      ? { name: sanitizeTimelineWorkflowProjectName(input.name) }
      : {}),
    workflow,
    sceneRequest: input.sceneRequest.trim(),
    selectedPromptProfile: normalizePromptProfileId(input.selectedPromptProfile),
    selectedImageCount: input.selectedImageCount,
    selectedNodeId: input.selectedNodeId,
    outputDisplayModes: sanitizeOutputDisplayModes(input.outputDisplayModes),
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

  const sceneRequest =
    typeof raw.sceneRequest === "string"
      ? raw.sceneRequest
      : isRecord(workflow.nodes["scene-input"].result) &&
          typeof workflow.nodes["scene-input"].result.rawIntent === "string"
        ? workflow.nodes["scene-input"].result.rawIntent
        : "";

  return {
    kind: TIMELINE_WORKFLOW_RECORD_KIND,
    version: TIMELINE_WORKFLOW_RECORD_VERSION,
    ...(typeof raw.projectId === "string" && raw.projectId.trim()
      ? { projectId: raw.projectId.trim() }
      : {}),
    ...(sanitizeTimelineWorkflowProjectName(raw.name)
      ? { name: sanitizeTimelineWorkflowProjectName(raw.name) }
      : {}),
    workflow,
    sceneRequest,
    selectedPromptProfile: normalizePromptProfileId(raw.selectedPromptProfile),
    selectedImageCount:
      typeof raw.selectedImageCount === "number" && Number.isFinite(raw.selectedImageCount)
        ? raw.selectedImageCount
        : 1,
    selectedNodeId: isTimelineNodeId(raw.selectedNodeId) ? raw.selectedNodeId : "scene-input",
    outputDisplayModes: sanitizeOutputDisplayModes(raw.outputDisplayModes),
    createdAt: sanitizeDateString(raw.createdAt, workflow.createdAt),
    updatedAt: sanitizeDateString(raw.updatedAt, workflow.updatedAt),
  };
}

export function parseTimelineWorkflowRecordJson(json: string): TimelineWorkflowRecord | null {
  return sanitizeTimelineWorkflowRecord(JSON.parse(json) as unknown);
}

export function serializeTimelineWorkflowRecord(record: TimelineWorkflowRecord): string {
  return JSON.stringify(sanitizeTimelineWorkflowRecord(record) ?? record, null, 2);
}
