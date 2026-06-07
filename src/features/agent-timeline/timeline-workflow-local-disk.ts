import { promises as fs } from "node:fs";
import path from "node:path";

import {
  parseTimelineWorkflowRecordJson,
  serializeTimelineWorkflowRecord,
  type TimelineWorkflowRecord,
} from "./timeline-workflow-persistence";

const ACTIVE_TIMELINE_WORKFLOW_FILE = "active-workflow.json";

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

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
