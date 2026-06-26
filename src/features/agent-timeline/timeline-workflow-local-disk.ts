import { promises as fs } from "node:fs";
import path from "node:path";

import {
  parseTimelineWorkflowRecordJson,
  sanitizeTimelineWorkflowProjectName,
  sanitizeTimelineWorkflowRecord,
  serializeTimelineWorkflowRecord,
  type TimelineWorkflowRecord,
  type TimelineWorkflowSummary,
} from "./timeline-workflow-persistence";

const ACTIVE_TIMELINE_WORKFLOW_FILE = "active-workflow.json";
const TIMELINE_WORKFLOW_FILE_SUFFIX = ".json";
const TIMELINE_WORKFLOW_ID_PATTERN = /^[a-zA-Z0-9_-]{1,96}$/;

export class TimelineWorkflowStorageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimelineWorkflowStorageValidationError";
  }
}

export function getResolvedTimelineWorkflowsDir(): string {
  return path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "timeline-workflows");
}

function getActiveTimelineWorkflowPath() {
  return path.join(
    /*turbopackIgnore: true*/ getResolvedTimelineWorkflowsDir(),
    ACTIVE_TIMELINE_WORKFLOW_FILE,
  );
}

async function ensureTimelineWorkflowsDir() {
  await fs.mkdir(/*turbopackIgnore: true*/ getResolvedTimelineWorkflowsDir(), { recursive: true });
}

export function sanitizeTimelineWorkflowProjectId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const id = value.trim();
  if (!TIMELINE_WORKFLOW_ID_PATTERN.test(id) || id === "active-workflow") {
    return null;
  }

  return id;
}

export function createTimelineWorkflowProjectId() {
  return `workflow-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function timelineWorkflowFileName(id: string) {
  return `${id}${TIMELINE_WORKFLOW_FILE_SUFFIX}`;
}

function resolveNamedTimelineWorkflowPath(id: string) {
  const sanitizedId = sanitizeTimelineWorkflowProjectId(id);
  if (!sanitizedId) {
    throw new TimelineWorkflowStorageValidationError("Timeline workflow id is invalid.");
  }

  const dir = path.resolve(/*turbopackIgnore: true*/ getResolvedTimelineWorkflowsDir());
  const fullPath = path.resolve(/*turbopackIgnore: true*/ path.join(dir, timelineWorkflowFileName(sanitizedId)));
  const relative = path.relative(dir, fullPath);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new TimelineWorkflowStorageValidationError("Timeline workflow id is invalid.");
  }

  return fullPath;
}

function getTimelineWorkflowName(record: TimelineWorkflowRecord, fallbackDate = new Date()) {
  const explicitName = sanitizeTimelineWorkflowProjectName(record.name);
  if (explicitName) {
    return explicitName;
  }

  const sceneName = sanitizeTimelineWorkflowProjectName(record.sceneRequest);
  if (sceneName) {
    return sceneName;
  }

  return `Timeline workflow ${fallbackDate.toLocaleString()}`;
}

function withNamedMetadata(
  record: TimelineWorkflowRecord,
  id: string,
  name?: string | null,
  existing?: TimelineWorkflowRecord,
  options: { touchUpdatedAt?: boolean } = {},
) {
  const nextName = sanitizeTimelineWorkflowProjectName(name) || getTimelineWorkflowName(record);
  const nextRecord = sanitizeTimelineWorkflowRecord({
    ...record,
    projectId: id,
    name: nextName,
    createdAt: existing?.createdAt ?? record.createdAt,
    updatedAt: options.touchUpdatedAt ? new Date().toISOString() : record.updatedAt,
  });

  if (!nextRecord) {
    throw new TimelineWorkflowStorageValidationError("Timeline workflow record is invalid.");
  }

  return nextRecord;
}

export async function saveActiveTimelineWorkflowToDisk(record: TimelineWorkflowRecord) {
  await ensureTimelineWorkflowsDir();
  await fs.writeFile(
    /*turbopackIgnore: true*/ getActiveTimelineWorkflowPath(),
    serializeTimelineWorkflowRecord(record),
    "utf8",
  );
}

export async function loadActiveTimelineWorkflowFromDisk(): Promise<TimelineWorkflowRecord | undefined> {
  try {
    const text = await fs.readFile(/*turbopackIgnore: true*/ getActiveTimelineWorkflowPath(), "utf8");
    return parseTimelineWorkflowRecordJson(text) ?? undefined;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

export async function deleteActiveTimelineWorkflowFromDisk(): Promise<boolean> {
  try {
    await fs.unlink(/*turbopackIgnore: true*/ getActiveTimelineWorkflowPath());
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

export async function saveNamedTimelineWorkflowToDisk({
  id,
  name,
  record,
}: {
  id?: string | null;
  name?: string | null;
  record: TimelineWorkflowRecord;
}): Promise<TimelineWorkflowRecord> {
  await ensureTimelineWorkflowsDir();

  const workflowId = id ? sanitizeTimelineWorkflowProjectId(id) : createTimelineWorkflowProjectId();
  if (!workflowId) {
    throw new TimelineWorkflowStorageValidationError("Timeline workflow id is invalid.");
  }

  const fullPath = resolveNamedTimelineWorkflowPath(workflowId);
  const existing = await loadNamedTimelineWorkflowFromDisk(workflowId);
  const namedRecord = withNamedMetadata(record, workflowId, name, existing, { touchUpdatedAt: true });

  await fs.writeFile(
    /*turbopackIgnore: true*/ fullPath,
    serializeTimelineWorkflowRecord(namedRecord),
    "utf8",
  );

  return namedRecord;
}

export async function loadNamedTimelineWorkflowFromDisk(id: string): Promise<TimelineWorkflowRecord | undefined> {
  const fullPath = resolveNamedTimelineWorkflowPath(id);

  try {
    const text = await fs.readFile(/*turbopackIgnore: true*/ fullPath, "utf8");
    const record = parseTimelineWorkflowRecordJson(text);
    if (!record) {
      return undefined;
    }

    return withNamedMetadata(record, sanitizeTimelineWorkflowProjectId(id) ?? id, record.name, record);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

export async function renameNamedTimelineWorkflowOnDisk(
  id: string,
  name: string,
): Promise<TimelineWorkflowRecord | undefined> {
  const existing = await loadNamedTimelineWorkflowFromDisk(id);
  if (!existing) {
    return undefined;
  }

  return saveNamedTimelineWorkflowToDisk({
    id,
    name,
    record: existing,
  });
}

export async function deleteNamedTimelineWorkflowFromDisk(id: string): Promise<boolean> {
  const fullPath = resolveNamedTimelineWorkflowPath(id);

  try {
    await fs.unlink(/*turbopackIgnore: true*/ fullPath);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

export async function listNamedTimelineWorkflowSummariesFromDisk(): Promise<TimelineWorkflowSummary[]> {
  await ensureTimelineWorkflowsDir();

  let entries: string[];
  try {
    entries = await fs.readdir(/*turbopackIgnore: true*/ getResolvedTimelineWorkflowsDir());
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const summaries: TimelineWorkflowSummary[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(TIMELINE_WORKFLOW_FILE_SUFFIX) || entry === ACTIVE_TIMELINE_WORKFLOW_FILE) {
      continue;
    }

    const id = sanitizeTimelineWorkflowProjectId(entry.slice(0, -TIMELINE_WORKFLOW_FILE_SUFFIX.length));
    if (!id) {
      continue;
    }

    try {
      const record = await loadNamedTimelineWorkflowFromDisk(id);
      if (!record) {
        continue;
      }

      summaries.push({
        id,
        name: getTimelineWorkflowName(record),
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        workflowMode: record.workflow.workflowMode,
      });
    } catch (error) {
      console.warn("[SceneForge] [agent-timeline] skipped unreadable workflow file", { entry, error });
    }
  }

  return summaries.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
