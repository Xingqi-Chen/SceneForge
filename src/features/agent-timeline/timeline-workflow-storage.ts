import {
  createTimelineWorkflowRecord,
  sanitizeTimelineWorkflowRecord,
  type TimelineWorkflowRecord,
  type TimelineWorkflowRecordInput,
  type TimelineWorkflowSummary,
} from "./timeline-workflow-persistence";

const ACTIVE_TIMELINE_WORKFLOW_ROUTE = "/api/agent-timeline/active-workflow";
const NAMED_TIMELINE_WORKFLOWS_ROUTE = "/api/agent-timeline/workflows";
const NAMED_TIMELINE_WORKFLOW_ITEM_ROUTE = "/api/agent-timeline/workflows/item";

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

export async function listTimelineWorkflowSummaries(): Promise<TimelineWorkflowSummary[]> {
  const response = await fetch(NAMED_TIMELINE_WORKFLOWS_ROUTE, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  const payload: unknown = await response.json().catch(() => null);
  if (
    typeof payload === "object" &&
    payload !== null &&
    "workflows" in payload &&
    Array.isArray((payload as { workflows?: unknown }).workflows)
  ) {
    return (payload as { workflows: TimelineWorkflowSummary[] }).workflows;
  }

  return [];
}

export async function loadTimelineWorkflowRecord(id: string): Promise<TimelineWorkflowRecord | null> {
  const response = await fetch(`${NAMED_TIMELINE_WORKFLOW_ITEM_ROUTE}?id=${encodeURIComponent(id)}`, {
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

export async function saveTimelineWorkflowRecord({
  id,
  input,
  name,
}: {
  id?: string | null;
  input: TimelineWorkflowRecordInput;
  name?: string | null;
}): Promise<TimelineWorkflowRecord> {
  const record = createTimelineWorkflowRecord({
    ...input,
    ...(id ? { projectId: id } : {}),
    ...(name ? { name } : {}),
  });
  const response = await fetch(NAMED_TIMELINE_WORKFLOWS_ROUTE, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id,
      name,
      record,
    }),
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

export async function renameTimelineWorkflowRecord(id: string, name: string): Promise<TimelineWorkflowRecord> {
  const response = await fetch(`${NAMED_TIMELINE_WORKFLOW_ITEM_ROUTE}?id=${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  const payload: unknown = await response.json().catch(() => null);
  const record = sanitizeTimelineWorkflowRecord(
    typeof payload === "object" && payload !== null && "record" in payload
      ? (payload as { record?: unknown }).record
      : payload,
  );

  if (!record) {
    throw new Error("Timeline workflow rename response was invalid.");
  }

  return record;
}

export async function deleteTimelineWorkflowRecord(id: string): Promise<void> {
  const response = await fetch(`${NAMED_TIMELINE_WORKFLOW_ITEM_ROUTE}?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
}
