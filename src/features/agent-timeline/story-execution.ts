import type {
  ComfyUiExecutionTimelineResult,
  ResultDisplayTimelineResult,
  TimelineStoredGeneratedImage,
} from "./types";
import type {
  StoryExecutionRequest,
  StoryExecutionRequestBatch,
} from "./story-planning";
import type { StoryShotId } from "./story-types";

export const storyShotExecutionStatuses = [
  "blocked",
  "ready",
  "queued",
  "running",
  "done",
  "stale",
  "error",
] as const;

export type StoryShotExecutionStatus = (typeof storyShotExecutionStatuses)[number];

export type StoryShotExecutionErrorCode =
  | "shot_dependency_cycle"
  | "shot_dependency_missing"
  | "shot_execution_failed"
  | "shot_source_blocked"
  | "shot_source_failed";

export type StoryShotExecutionError = {
  code: StoryShotExecutionErrorCode;
  message: string;
  details?: unknown;
};

export type StoryShotQueueMetadata = {
  nodeErrors?: unknown;
  nodeIds?: unknown;
  number?: number;
  outputNodeId?: string;
  promptId: string;
  queuedAt?: string;
  warnings: string[];
};

export type StoryShotResultImageReference = {
  filename: string;
  nodeId: string;
  subfolder?: string;
  type?: string;
  url: string;
};

export type StoryShotResultReference = {
  completed: boolean;
  image?: StoryShotResultImageReference;
  images?: StoryShotResultImageReference[];
  promptId: string;
  shotId: StoryShotId;
  storedImage?: TimelineStoredGeneratedImage;
  storedImages?: TimelineStoredGeneratedImage[];
  warnings: string[];
};

export type StoryShotExecutionRecord = {
  error?: StoryShotExecutionError;
  queueMetadata?: StoryShotQueueMetadata;
  resultReference?: StoryShotResultReference;
  shotId: StoryShotId;
  sourceShotIds: StoryShotId[];
  status: StoryShotExecutionStatus;
  updatedAt?: string;
};

export type StoryShotGraphExecutionStatus =
  | "blocked"
  | "ready"
  | "running"
  | "done"
  | "partial"
  | "stale"
  | "error";

export type StoryShotGraphExecutionState = {
  errors: StoryShotExecutionError[];
  mode: StoryExecutionRequestBatch["mode"];
  readyShotIds: StoryShotId[];
  shots: StoryShotExecutionRecord[];
  staleShotIds: StoryShotId[];
  status: StoryShotGraphExecutionStatus;
  storyId: string;
  updatedAt?: string;
};

export type StoryShotExecutionAdapterContext = {
  batch: StoryExecutionRequestBatch;
  request: StoryExecutionRequest;
  sourceResults: Record<StoryShotId, StoryShotResultReference>;
  state: StoryShotGraphExecutionState;
};

export type StoryShotExecutionAdapterResult = {
  queueMetadata?: StoryShotQueueMetadata | ComfyUiExecutionTimelineResult;
  resultReference: StoryShotResultReference | ResultDisplayTimelineResult;
};

export type StoryShotExecutionAdapter = (
  context: StoryShotExecutionAdapterContext,
) => Promise<StoryShotExecutionAdapterResult> | StoryShotExecutionAdapterResult;

export type StoryShotExecutionOptions = {
  initialState?: StoryShotGraphExecutionState;
  now?: () => string;
  onStateChange?: (state: StoryShotGraphExecutionState) => void;
};

type StoryShotDependencyIssue = {
  code: "cycle" | "missing";
  message: string;
  shotId?: StoryShotId;
  sourceShotId?: StoryShotId;
};

type MutableRecordMap = Map<StoryShotId, StoryShotExecutionRecord>;

export class StoryShotExecutionSchedulerError extends Error {
  readonly issues: StoryShotDependencyIssue[];

  constructor(message: string, issues: StoryShotDependencyIssue[]) {
    super(message);
    this.name = "StoryShotExecutionSchedulerError";
    this.issues = issues;
  }
}

function defaultNow() {
  return new Date().toISOString();
}

function cloneResultReference(reference: StoryShotResultReference): StoryShotResultReference {
  return {
    ...reference,
    image: reference.image ? { ...reference.image } : undefined,
    images: reference.images?.map((image) => ({ ...image })),
    storedImage: reference.storedImage ? { ...reference.storedImage } : undefined,
    storedImages: reference.storedImages?.map((image) => ({ ...image })),
    warnings: [...reference.warnings],
  };
}

function cloneQueueMetadata(metadata: StoryShotQueueMetadata): StoryShotQueueMetadata {
  return {
    ...metadata,
    warnings: [...metadata.warnings],
  };
}

function cloneRecord(record: StoryShotExecutionRecord): StoryShotExecutionRecord {
  return {
    ...record,
    error: record.error ? { ...record.error } : undefined,
    queueMetadata: record.queueMetadata ? cloneQueueMetadata(record.queueMetadata) : undefined,
    resultReference: record.resultReference ? cloneResultReference(record.resultReference) : undefined,
    sourceShotIds: [...record.sourceShotIds],
  };
}

function getRequestOrder(batch: StoryExecutionRequestBatch) {
  return new Map(batch.requests.map((request, index) => [request.shotId, index]));
}

function sortShotIdsByRequestOrder(shotIds: Iterable<StoryShotId>, order: Map<StoryShotId, number>) {
  return [...shotIds].sort((left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0));
}

function getRequestMap(batch: StoryExecutionRequestBatch) {
  return new Map(batch.requests.map((request) => [request.shotId, request]));
}

function collectDependencyIssues(batch: StoryExecutionRequestBatch): StoryShotDependencyIssue[] {
  const requestMap = getRequestMap(batch);
  const issues: StoryShotDependencyIssue[] = [];

  for (const request of batch.requests) {
    for (const sourceShotId of request.sourceShotIds) {
      if (sourceShotId === request.shotId) {
        issues.push({
          code: "cycle",
          message: `Shot "${request.shotId}" cannot depend on itself.`,
          shotId: request.shotId,
          sourceShotId,
        });
        continue;
      }

      if (!requestMap.has(sourceShotId)) {
        issues.push({
          code: "missing",
          message: `Shot "${request.shotId}" references missing source shot "${sourceShotId}".`,
          shotId: request.shotId,
          sourceShotId,
        });
      }
    }
  }

  return issues;
}

function assertSchedulable(batch: StoryExecutionRequestBatch) {
  const issues = collectDependencyIssues(batch);

  if (issues.length > 0) {
    throw new StoryShotExecutionSchedulerError("Story shot execution dependencies are invalid.", issues);
  }
}

function getOutgoingDependents(batch: StoryExecutionRequestBatch) {
  const outgoing = new Map<StoryShotId, StoryShotId[]>();

  for (const request of batch.requests) {
    for (const sourceShotId of request.sourceShotIds) {
      outgoing.set(sourceShotId, [...(outgoing.get(sourceShotId) ?? []), request.shotId]);
    }
  }

  return outgoing;
}

function getTopologicalGroups(batch: StoryExecutionRequestBatch) {
  assertSchedulable(batch);

  const order = getRequestOrder(batch);
  const outgoing = getOutgoingDependents(batch);
  const incomingCounts = new Map(batch.requests.map((request) => [request.shotId, request.sourceShotIds.length]));
  const remaining = new Set(batch.requests.map((request) => request.shotId));
  const groups: StoryShotId[][] = [];
  let ready = sortShotIdsByRequestOrder(
    batch.requests.filter((request) => request.sourceShotIds.length === 0).map((request) => request.shotId),
    order,
  );

  while (ready.length > 0) {
    groups.push(ready);

    const nextReady = new Set<StoryShotId>();
    for (const shotId of ready) {
      remaining.delete(shotId);

      for (const dependentShotId of outgoing.get(shotId) ?? []) {
        const nextCount = (incomingCounts.get(dependentShotId) ?? 0) - 1;
        incomingCounts.set(dependentShotId, nextCount);

        if (nextCount === 0) {
          nextReady.add(dependentShotId);
        }
      }
    }

    ready = sortShotIdsByRequestOrder(nextReady, order);
  }

  if (remaining.size > 0) {
    throw new StoryShotExecutionSchedulerError(
      "Story shot execution dependencies contain a cycle.",
      sortShotIdsByRequestOrder(remaining, order).map((shotId) => ({
        code: "cycle",
        message: `Shot "${shotId}" is part of a dependency cycle.`,
        shotId,
      })),
    );
  }

  return groups;
}

function getPreviousRecord(
  initialState: StoryShotGraphExecutionState | undefined,
  shotId: StoryShotId,
) {
  return initialState?.shots.find((record) => record.shotId === shotId);
}

function getRecordsByShotId(records: readonly StoryShotExecutionRecord[]): MutableRecordMap {
  return new Map(records.map((record) => [record.shotId, cloneRecord(record)]));
}

function sourceError(sourceRecord: StoryShotExecutionRecord): StoryShotExecutionError {
  if (sourceRecord.status === "error") {
    return {
      code: "shot_source_failed",
      message: `Shot "${sourceRecord.shotId}" failed, so dependent shots cannot run.`,
      details: {
        sourceError: sourceRecord.error,
        sourceShotId: sourceRecord.shotId,
      },
    };
  }

  return {
    code: "shot_source_blocked",
    message: `Shot "${sourceRecord.shotId}" does not have a usable result yet, so dependent shots cannot run.`,
    details: {
      sourceShotId: sourceRecord.shotId,
      sourceStatus: sourceRecord.status,
    },
  };
}

function missingSourceError(shotId: StoryShotId, sourceShotId: StoryShotId): StoryShotExecutionError {
  return {
    code: "shot_dependency_missing",
    message: `Shot "${shotId}" references missing source shot "${sourceShotId}".`,
    details: {
      sourceShotId,
    },
  };
}

function executionError(error: unknown): StoryShotExecutionError {
  if (error instanceof Error) {
    return {
      code: "shot_execution_failed",
      message: error.message,
      details: error,
    };
  }

  return {
    code: "shot_execution_failed",
    message: "Shot execution failed.",
    details: error,
  };
}

function getBlockingSourceError(
  records: MutableRecordMap,
  request: StoryExecutionRequest,
): StoryShotExecutionError | null {
  for (const sourceShotId of request.sourceShotIds) {
    const sourceRecord = records.get(sourceShotId);

    if (!sourceRecord) {
      return missingSourceError(request.shotId, sourceShotId);
    }

    if (sourceRecord.status !== "done" || !sourceRecord.resultReference) {
      return sourceError(sourceRecord);
    }
  }

  return null;
}

function collectSourceResults(
  records: MutableRecordMap,
  request: StoryExecutionRequest,
): Record<StoryShotId, StoryShotResultReference> {
  return Object.fromEntries(
    request.sourceShotIds.flatMap((sourceShotId) => {
      const reference = records.get(sourceShotId)?.resultReference;
      return reference ? [[sourceShotId, cloneResultReference(reference)]] : [];
    }),
  );
}

function normalizeQueueMetadata(
  metadata: StoryShotQueueMetadata | ComfyUiExecutionTimelineResult | undefined,
  timestamp: string,
): StoryShotQueueMetadata | undefined {
  if (!metadata || typeof metadata.promptId !== "string" || typeof metadata.outputNodeId !== "string") {
    return undefined;
  }

  return {
    nodeErrors: metadata.nodeErrors,
    nodeIds: metadata.nodeIds ?? {},
    number: metadata.number,
    outputNodeId: metadata.outputNodeId,
    promptId: metadata.promptId,
    queuedAt: "queuedAt" in metadata && typeof metadata.queuedAt === "string" ? metadata.queuedAt : timestamp,
    warnings: [...(metadata.warnings ?? [])],
  };
}

function isStoryShotResultReference(value: StoryShotResultReference | ResultDisplayTimelineResult): value is StoryShotResultReference {
  return "shotId" in value;
}

function normalizeResultReference({
  queueMetadata,
  result,
  shotId,
}: {
  queueMetadata?: StoryShotQueueMetadata;
  result: StoryShotResultReference | ResultDisplayTimelineResult;
  shotId: StoryShotId;
}): StoryShotResultReference {
  if (isStoryShotResultReference(result)) {
    return cloneResultReference(result);
  }

  return {
    completed: result.completed,
    image: result.image ? { ...result.image } : undefined,
    images: result.images?.map((image) => ({ ...image })),
    promptId: result.promptId || queueMetadata?.promptId || "",
    shotId,
    storedImage: result.storedImage ? { ...result.storedImage } : undefined,
    storedImages: result.storedImages?.map((image) => ({ ...image })),
    warnings: [...result.warnings],
  };
}

function makeState({
  batch,
  records,
  updatedAt,
}: {
  batch: StoryExecutionRequestBatch;
  records: MutableRecordMap;
  updatedAt?: string;
}): StoryShotGraphExecutionState {
  const orderedRecords = batch.requests.map((request) => records.get(request.shotId) ?? {
    shotId: request.shotId,
    sourceShotIds: [...request.sourceShotIds],
    status: "blocked" as const,
  });
  const errors = orderedRecords.flatMap((record) => (record.error ? [record.error] : []));
  const staleShotIds = orderedRecords
    .filter((record) => record.status === "stale")
    .map((record) => record.shotId);
  const readyShotIds = orderedRecords
    .filter((record) => record.status === "ready" || record.status === "stale")
    .map((record) => record.shotId);
  const doneCount = orderedRecords.filter((record) => record.status === "done").length;
  const status: StoryShotGraphExecutionStatus = orderedRecords.some((record) => record.status === "running" || record.status === "queued")
    ? "running"
    : orderedRecords.some((record) => record.status === "error")
      ? "error"
      : staleShotIds.length > 0
        ? "stale"
        : doneCount === orderedRecords.length && orderedRecords.length > 0
          ? "done"
          : doneCount > 0
            ? "partial"
            : readyShotIds.length > 0
              ? "ready"
              : "blocked";

  return {
    errors,
    mode: batch.mode,
    readyShotIds,
    shots: orderedRecords.map(cloneRecord),
    staleShotIds,
    status,
    storyId: batch.storyId,
    updatedAt,
  };
}

function blockDependentsFromFailedSources(
  batch: StoryExecutionRequestBatch,
  records: MutableRecordMap,
  timestamp: string,
) {
  let changed = false;

  for (const request of batch.requests) {
    const record = records.get(request.shotId);
    if (!record || record.status === "done" || record.status === "error") {
      continue;
    }

    const blockingError = getBlockingSourceError(records, request);
    if (!blockingError) {
      continue;
    }

    records.set(request.shotId, {
      ...record,
      error: {
        ...blockingError,
        message: `Shot "${request.shotId}" is blocked because a source shot failed or is unavailable.`,
      },
      status: "blocked",
      updatedAt: timestamp,
    });
    changed = true;
  }

  return changed;
}

function buildInitialRecords(batch: StoryExecutionRequestBatch, initialState?: StoryShotGraphExecutionState) {
  const records: MutableRecordMap = new Map();

  for (const request of batch.requests) {
    const previous = getPreviousRecord(initialState, request.shotId);
    records.set(request.shotId, {
      ...previous,
      shotId: request.shotId,
      sourceShotIds: [...request.sourceShotIds],
      status: previous?.status === "stale"
        ? "stale"
        : previous?.status === "done" && previous.resultReference
        ? "done"
        : request.sourceShotIds.length === 0
          ? "ready"
          : "blocked",
    });
  }

  return records;
}

export function getStoryShotExecutionGroups(batch: StoryExecutionRequestBatch): StoryShotId[][] {
  return getTopologicalGroups(batch).map((group) => [...group]);
}

export function createStoryShotExecutionState({
  batch,
  initialState,
  now = defaultNow,
}: {
  batch: StoryExecutionRequestBatch;
  initialState?: StoryShotGraphExecutionState;
  now?: () => string;
}): StoryShotGraphExecutionState {
  const timestamp = now();
  const groups = getTopologicalGroups(batch);
  const records = buildInitialRecords(batch, initialState);

  for (const group of groups) {
    for (const shotId of group) {
      const request = getRequestMap(batch).get(shotId);
      const record = records.get(shotId);

      if (!request || !record || record.status === "done") {
        continue;
      }

      const blockingError = getBlockingSourceError(records, request);

      records.set(shotId, {
        ...record,
        error: blockingError ?? undefined,
        status: blockingError ? "blocked" : record.status === "stale" ? "stale" : "ready",
        updatedAt: timestamp,
      });
    }
  }

  return makeState({ batch, records, updatedAt: timestamp });
}

export async function executeStoryShotGraph(
  batch: StoryExecutionRequestBatch,
  executeShot: StoryShotExecutionAdapter,
  options: StoryShotExecutionOptions = {},
): Promise<StoryShotGraphExecutionState> {
  const now = options.now ?? defaultNow;
  const groups = getTopologicalGroups(batch);
  const requests = getRequestMap(batch);
  const records = getRecordsByShotId(createStoryShotExecutionState({
    batch,
    initialState: options.initialState,
    now,
  }).shots);

  for (const group of groups) {
    const runnable = group.filter((shotId) => {
      const record = records.get(shotId);
      return record && record.status !== "done" && record.status !== "error";
    });

    if (runnable.length === 0) {
      continue;
    }

    const timestamp = now();
    const readyToRun = runnable.filter((shotId) => {
      const request = requests.get(shotId);
      const record = records.get(shotId);

      if (!request || !record) {
        return false;
      }

      const blockingError = getBlockingSourceError(records, request);
      if (blockingError) {
        records.set(shotId, {
          ...record,
          error: blockingError,
          status: "blocked",
          updatedAt: timestamp,
        });
        return false;
      }

      records.set(shotId, {
        ...record,
        error: undefined,
        status: "running",
        updatedAt: timestamp,
      });
      return true;
    });

    if (readyToRun.length > 0) {
      options.onStateChange?.(makeState({ batch, records, updatedAt: timestamp }));
    }

    await Promise.all(readyToRun.map(async (shotId) => {
      const request = requests.get(shotId);
      const record = records.get(shotId);

      if (!request || !record) {
        return;
      }

      try {
        const adapterResult = await executeShot({
          batch,
          request,
          sourceResults: collectSourceResults(records, request),
          state: makeState({ batch, records, updatedAt: timestamp }),
        });
        const completedAt = now();
        const queueMetadata = normalizeQueueMetadata(adapterResult.queueMetadata, completedAt);
        const resultReference = normalizeResultReference({
          queueMetadata,
          result: adapterResult.resultReference,
          shotId,
        });

        records.set(shotId, {
          ...record,
          error: undefined,
          queueMetadata,
          resultReference,
          status: "done",
          updatedAt: completedAt,
        });
      } catch (error) {
        const failedAt = now();
        records.set(shotId, {
          ...record,
          error: executionError(error),
          status: "error",
          updatedAt: failedAt,
        });
      }
    }));

    const afterGroupAt = now();
    blockDependentsFromFailedSources(batch, records, afterGroupAt);
    options.onStateChange?.(makeState({ batch, records, updatedAt: afterGroupAt }));
  }

  return makeState({ batch, records, updatedAt: now() });
}

export function markStoryShotAndDownstreamStale({
  batch,
  now = defaultNow,
  selectedShotId,
  state,
}: {
  batch: StoryExecutionRequestBatch;
  now?: () => string;
  selectedShotId: StoryShotId;
  state: StoryShotGraphExecutionState;
}): StoryShotGraphExecutionState {
  const requests = getRequestMap(batch);

  if (!requests.has(selectedShotId)) {
    throw new StoryShotExecutionSchedulerError("Cannot regenerate an unknown story shot.", [
      {
        code: "missing",
        message: `Shot "${selectedShotId}" is not part of the execution batch.`,
        shotId: selectedShotId,
      },
    ]);
  }

  const outgoing = getOutgoingDependents(batch);
  const staleShotIds = new Set<StoryShotId>([selectedShotId]);
  const queue = [...(outgoing.get(selectedShotId) ?? [])];

  for (let index = 0; index < queue.length; index += 1) {
    const shotId = queue[index];

    if (staleShotIds.has(shotId)) {
      continue;
    }

    staleShotIds.add(shotId);
    queue.push(...(outgoing.get(shotId) ?? []));
  }

  const timestamp = now();
  const records = getRecordsByShotId(state.shots);

  for (const shotId of staleShotIds) {
    const request = requests.get(shotId);
    const record = records.get(shotId);

    if (!request || !record) {
      continue;
    }

    records.set(shotId, {
      ...record,
      error: undefined,
      sourceShotIds: [...request.sourceShotIds],
      status: "stale",
      updatedAt: timestamp,
    });
  }

  return makeState({ batch, records, updatedAt: timestamp });
}
