import { describe, expect, it } from "vitest";

import {
  createStoryShotExecutionState,
  executeStoryShotGraph,
  getStoryShotExecutionGroups,
  markStoryShotAndDownstreamStale,
  StoryShotExecutionSchedulerError,
  type StoryShotExecutionAdapter,
  type StoryShotGraphExecutionState,
} from "./story-execution";
import type { StoryExecutionRequestBatch } from "./story-planning";
import type { StoryShotId } from "./story-types";

const storyId = "story-1";

function createRequestBatch(
  sourcesByShotId: Record<StoryShotId, StoryShotId[]>,
): StoryExecutionRequestBatch {
  return {
    storyId,
    mode: "final",
    nsfwContext: {
      audienceRating: "safe",
      contentWarnings: [],
      enabled: false,
      rationale: "test",
    },
    requests: Object.entries(sourcesByShotId).map(([shotId, sourceShotIds]) => ({
      shotId,
      sourceShotIds,
      nsfwContext: {
        audienceRating: "safe",
        contentWarnings: [],
        enabled: false,
        rationale: "test",
      },
      request: {
        checkpointName: "local.safetensors",
        positivePrompt: `prompt for ${shotId}`,
        preview: false,
      },
    })),
  };
}

function createAdapterResult(shotId: StoryShotId) {
  return {
    queueMetadata: {
      outputNodeId: "9",
      promptId: `prompt-${shotId}`,
      warnings: [],
    },
    resultReference: {
      completed: true,
      image: {
        filename: `${shotId}.png`,
        nodeId: "9",
        type: "output",
        url: `/api/comfyui/generated-images/${shotId}.png`,
      },
      promptId: `prompt-${shotId}`,
      shotId,
      storedImage: {
        byteLength: 12,
        contentType: "image/png",
        filename: `${shotId}.png`,
        url: `/api/comfyui/generated-images/${shotId}.png`,
      },
      warnings: [],
    },
  };
}

function createDoneState(batch: StoryExecutionRequestBatch): StoryShotGraphExecutionState {
  const state = createStoryShotExecutionState({
    batch,
    now: () => "2026-06-14T00:00:00.000Z",
  });

  return {
    ...state,
    readyShotIds: [],
    shots: state.shots.map((record) => ({
      ...record,
      queueMetadata: createAdapterResult(record.shotId).queueMetadata,
      resultReference: createAdapterResult(record.shotId).resultReference,
      status: "done",
    })),
    status: "done",
  };
}

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });

  return { promise, resolve };
}

describe("story shot execution scheduler", () => {
  it("groups shots by topological parallel-ready layers", () => {
    const batch = createRequestBatch({
      "shot-a": [],
      "shot-b": [],
      "shot-c": ["shot-a"],
      "shot-d": ["shot-a", "shot-b"],
      "shot-e": ["shot-c"],
    });

    expect(getStoryShotExecutionGroups(batch)).toEqual([
      ["shot-a", "shot-b"],
      ["shot-c", "shot-d"],
      ["shot-e"],
    ]);
  });

  it("marks independent shots ready together and waits for source results before dependents run", async () => {
    const batch = createRequestBatch({
      "shot-a": [],
      "shot-b": [],
      "shot-c": ["shot-a"],
    });
    const shotA = createDeferred();
    const shotB = createDeferred();
    const started: StoryShotId[] = [];
    const adapter: StoryShotExecutionAdapter = async ({ request, sourceResults }) => {
      started.push(request.shotId);

      if (request.shotId === "shot-a") {
        await shotA.promise;
      }

      if (request.shotId === "shot-b") {
        await shotB.promise;
      }

      if (request.shotId === "shot-c") {
        expect(Object.keys(sourceResults)).toEqual(["shot-a"]);
      }

      return createAdapterResult(request.shotId);
    };
    const executing = executeStoryShotGraph(batch, adapter, {
      now: () => "2026-06-14T00:00:00.000Z",
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(started).toEqual(["shot-a", "shot-b"]);

    shotA.resolve();
    shotB.resolve();

    const result = await executing;

    expect(started).toEqual(["shot-a", "shot-b", "shot-c"]);
    expect(result.shots.map((shot) => [shot.shotId, shot.status])).toEqual([
      ["shot-a", "done"],
      ["shot-b", "done"],
      ["shot-c", "done"],
    ]);
  });

  it("waits for every source result before running a multi-reference shot", async () => {
    const batch = createRequestBatch({
      "shot-a": [],
      "shot-b": [],
      "shot-c": ["shot-a", "shot-b"],
    });
    const sourceKeysByShot = new Map<StoryShotId, string[]>();
    const adapter: StoryShotExecutionAdapter = ({ request, sourceResults }) => {
      sourceKeysByShot.set(request.shotId, Object.keys(sourceResults));
      return createAdapterResult(request.shotId);
    };

    const result = await executeStoryShotGraph(batch, adapter, {
      now: () => "2026-06-14T00:00:00.000Z",
    });

    expect(sourceKeysByShot.get("shot-c")).toEqual(["shot-a", "shot-b"]);
    expect(result.status).toBe("done");
  });

  it("stores generated image references and metadata without image bytes", async () => {
    const batch = createRequestBatch({
      "shot-a": [],
    });

    const result = await executeStoryShotGraph(batch, ({ request }) => ({
      queueMetadata: {
        outputNodeId: "9",
        promptId: `prompt-${request.shotId}`,
        warnings: [],
      },
      resultReference: {
        completed: true,
        image: {
          filename: `${request.shotId}.png`,
          nodeId: "9",
          type: "output",
          url: `/api/comfyui/generated-images/${request.shotId}.png`,
        },
        promptId: `prompt-${request.shotId}`,
        sourceImage: {
          filename: `${request.shotId}.png`,
          nodeId: "9",
          type: "output",
        },
        storedImage: {
          byteLength: 12,
          contentType: "image/png",
          filename: `${request.shotId}.png`,
          url: `/api/comfyui/generated-images/${request.shotId}.png`,
        },
        warnings: [],
      },
    }));

    const shot = result.shots[0];
    expect(shot?.resultReference?.image?.url).toBe("/api/comfyui/generated-images/shot-a.png");
    expect(Object.keys(shot?.resultReference?.storedImage ?? {}).sort()).toEqual([
      "byteLength",
      "contentType",
      "filename",
      "url",
    ]);
    expect(JSON.stringify(result)).not.toContain("data:image");
    expect(JSON.stringify(result)).not.toContain("base64");
  });

  it("blocks dependents with clear errors when a source shot fails", async () => {
    const batch = createRequestBatch({
      "shot-a": [],
      "shot-b": ["shot-a"],
      "shot-c": [],
      "shot-d": ["shot-b"],
    });
    const started: StoryShotId[] = [];
    const adapter: StoryShotExecutionAdapter = ({ request }) => {
      started.push(request.shotId);

      if (request.shotId === "shot-a") {
        throw new Error("ComfyUI queue rejected shot-a.");
      }

      return createAdapterResult(request.shotId);
    };

    const result = await executeStoryShotGraph(batch, adapter, {
      now: () => "2026-06-14T00:00:00.000Z",
    });

    expect(started).toEqual(["shot-a", "shot-c"]);
    expect(result.shots.find((shot) => shot.shotId === "shot-a")).toMatchObject({
      status: "error",
      error: {
        code: "shot_execution_failed",
        message: "ComfyUI queue rejected shot-a.",
      },
    });
    expect(result.shots.find((shot) => shot.shotId === "shot-b")).toMatchObject({
      status: "blocked",
      error: {
        code: "shot_source_failed",
        message: 'Shot "shot-b" is blocked because a source shot failed or is unavailable.',
      },
    });
    expect(result.shots.find((shot) => shot.shotId === "shot-c")?.status).toBe("done");
    expect(result.shots.find((shot) => shot.shotId === "shot-d")).toMatchObject({
      status: "blocked",
      error: {
        code: "shot_source_blocked",
        message: 'Shot "shot-d" is blocked because a source shot failed or is unavailable.',
      },
    });
  });

  it("rejects cyclic or missing shot dependencies before execution", async () => {
    const cyclicBatch = createRequestBatch({
      "shot-a": ["shot-b"],
      "shot-b": ["shot-a"],
    });
    const missingBatch = createRequestBatch({
      "shot-a": ["shot-missing"],
    });

    expect(() => getStoryShotExecutionGroups(cyclicBatch)).toThrow(StoryShotExecutionSchedulerError);
    await expect(
      executeStoryShotGraph(missingBatch, ({ request }) => createAdapterResult(request.shotId)),
    ).rejects.toThrow(StoryShotExecutionSchedulerError);
  });

  it("marks only a selected shot and downstream dependents stale for regeneration", () => {
    const batch = createRequestBatch({
      "shot-a": [],
      "shot-b": ["shot-a"],
      "shot-c": ["shot-a"],
      "shot-d": ["shot-b"],
    });
    const doneState = createDoneState(batch);
    const staleState = markStoryShotAndDownstreamStale({
      batch,
      now: () => "2026-06-14T00:00:01.000Z",
      selectedShotId: "shot-b",
      state: doneState,
    });

    expect(staleState.staleShotIds).toEqual(["shot-b", "shot-d"]);
    expect(staleState.shots.find((shot) => shot.shotId === "shot-b")).toMatchObject({
      status: "stale",
      resultReference: expect.objectContaining({
        promptId: "prompt-shot-b",
      }),
    });
    expect(staleState.shots.find((shot) => shot.shotId === "shot-d")?.status).toBe("stale");
    expect(staleState.shots.find((shot) => shot.shotId === "shot-a")).toEqual(doneState.shots[0]);
    expect(staleState.shots.find((shot) => shot.shotId === "shot-c")).toEqual(doneState.shots[2]);
  });
});
