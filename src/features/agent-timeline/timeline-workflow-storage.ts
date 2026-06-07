import {
  createTimelineWorkflowRecord,
  sanitizeTimelineWorkflowRecord,
  type TimelineWorkflowRecord,
  type TimelineWorkflowRecordInput,
} from "./timeline-workflow-persistence";

const ACTIVE_TIMELINE_WORKFLOW_ROUTE = "/api/agent-timeline/active-workflow";

type ApiErrorBody = {
  error?: {
    message?: string;
  };
};

async function readErrorMessage(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) {
    return response.statusText || `Request failed (${response.status})`;
  }

  try {
    const data = JSON.parse(text) as ApiErrorBody;
    if (typeof data.error?.message === "string" && data.error.message) {
      return data.error.message;
    }
  } catch {
    /* ignore */
  }

  return text;
}

export async function loadActiveTimelineWorkflowRecord(): Promise<TimelineWorkflowRecord | null> {
  const response = await fetch(ACTIVE_TIMELINE_WORKFLOW_ROUTE, {
    cache: "no-store",
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  const payload: unknown = await response.json().catch(() => null);
  return sanitizeTimelineWorkflowRecord(payload);
}

export async function saveActiveTimelineWorkflowRecord(
  input: TimelineWorkflowRecordInput,
): Promise<TimelineWorkflowRecord> {
  const record = createTimelineWorkflowRecord(input);
  const response = await fetch(ACTIVE_TIMELINE_WORKFLOW_ROUTE, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(record),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  const payload: unknown = await response.json().catch(() => null);
  const savedRecord = sanitizeTimelineWorkflowRecord(
    typeof payload === "object" && payload !== null && "record" in payload
      ? (payload as { record?: unknown }).record
      : payload,
  );

  return savedRecord ?? record;
}

export async function deleteActiveTimelineWorkflowRecord(): Promise<void> {
  const response = await fetch(ACTIVE_TIMELINE_WORKFLOW_ROUTE, {
    method: "DELETE",
  });

  if (!response.ok && response.status !== 404) {
    throw new Error(await readErrorMessage(response));
  }
}
