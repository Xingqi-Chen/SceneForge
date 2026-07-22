import { afterEach, describe, expect, it, vi } from "vitest";

import {
  canRunTimelineNode,
  completeTimelineNode,
  confirmTimelineGeneration,
  createTimelineWorkflowState,
  executeTimelineGraph,
  getRunnableTimelineNodeIds,
  getTimelineDownstreamClosure,
  getTimelineNodeDependencies,
  isReservedTimelineNodeId,
  isTimelineNodeRegenerationEligible,
  requireTimelineGenerationReconfirmation,
  retryTimelineGenerationFrom,
  setTimelineNodeManualResult,
  updateTimelineSceneInputSettings,
  updateTimelineFinalRedrawPreset,
  validateTimelineDependencyDag,
  type TimelineNodeAdapters,
  type TimelineWorkflowState,
} from ".";
import { sanitizeRunSceneInputSettingsSnapshot } from "./run-input-settings";

function createClock() {
  let tick = 0;

  return () => {
    tick += 1;
    return `2026-05-29T00:00:${String(tick).padStart(2, "0")}.000Z`;
  };
}

const runStyleReference = {
  status: "ready" as const,
  mode: "ipadapter" as const,
  metadata: {
    byteLength: 512,
    contentType: "image/png",
    filename: "style.png",
    storedFilename: "0123456789abcdef0123456789abcdef.png",
    uploadedAt: "2026-07-19T00:00:00.000Z",
    url: "/api/comfyui/sequence-references/0123456789abcdef0123456789abcdef.png",
  },
  analysis: {
    analyzedAt: "2026-07-19T00:00:01.000Z",
    stylePrompt: "soft gouache, cobalt shadows",
    summary: "Soft gouache.",
  },
  ipAdapter: { weight: 0.45, startPercent: 0, endPercent: 1 },
  settingsSnapshot: {
    capturedAt: "2026-07-19T00:00:02.000Z",
    checkpointBaseModel: "Illustrious",
    checkpointId: "checkpoint-a",
    modeReason: "Illustrious supports IPAdapter.",
    promptProfile: "illustrious" as const,
  },
};

function createReadyForGateWorkflow(clock = createClock()) {
  let workflow = createTimelineWorkflowState({
    workflowId: "workflow-ready-for-gate",
    sceneRequest: "A pilot in a glass greenhouse",
    now: clock,
  });

  workflow = setTimelineNodeManualResult(workflow, "scene-prompt", { prompt: "glass greenhouse" }, { now: clock });
  workflow = setTimelineNodeManualResult(workflow, "character-tags", { tags: ["pilot"] }, { now: clock });
  workflow = setTimelineNodeManualResult(workflow, "character-action", { action: "checking controls" }, { now: clock });
  workflow = setTimelineNodeManualResult(workflow, "canvas-binding", { primaryCharacterId: "character-1" }, { now: clock });
  workflow = setTimelineNodeManualResult(
    workflow,
    "resource-recommendation",
    { checkpoint: "local.safetensors", loras: [] },
    { now: clock },
  );
  workflow = setTimelineNodeManualResult(workflow, "parameter-recommendation", { width: 1024 }, { now: clock });

  return workflow;
}

describe("agent timeline workflow foundation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defines a valid MVP dependency DAG with reserved ComfyUI nodes downstream of the gate", () => {
    expect(validateTimelineDependencyDag()).toEqual([]);
    expect(getTimelineNodeDependencies("scene-input")).toEqual([]);
    expect(getTimelineNodeDependencies("character-tags")).toEqual(["scene-prompt"]);
    expect(getTimelineNodeDependencies("character-action")).toEqual(["scene-prompt"]);
    expect(getTimelineNodeDependencies("canvas-binding")).toEqual([
      "scene-prompt",
      "character-tags",
      "character-action",
    ]);
    expect(getTimelineNodeDependencies("generation-gate")).toEqual([
      "scene-prompt",
      "character-tags",
      "character-action",
      "canvas-binding",
      "resource-recommendation",
      "parameter-recommendation",
    ]);
    expect(getTimelineNodeDependencies("preview-execution")).toEqual(["generation-gate"]);
    expect(getTimelineNodeDependencies("preview-scoring")).toEqual(["preview-execution"]);
    expect(getTimelineNodeDependencies("comfyui-execution")).toEqual(["preview-scoring"]);
    expect(getTimelineDownstreamClosure("canvas-binding")).toEqual([
      "parameter-recommendation",
      "generation-gate",
      "preview-execution",
      "preview-scoring",
      "comfyui-execution",
      "result-display",
    ]);
  });

  it("initializes only dependency-valid nodes as ready", () => {
    const workflow = createTimelineWorkflowState({
      workflowId: "empty-workflow",
      now: createClock(),
    });

    expect(workflow.nodes["scene-input"].status).toBe("ready");
    expect(workflow.nodes["scene-prompt"].status).toBe("blocked");
    expect(workflow.nodes["generation-gate"].status).toBe("blocked");
    expect(workflow.nodes["comfyui-execution"].status).toBe("blocked");

    const workflowWithInput = createTimelineWorkflowState({
      workflowId: "with-input",
      sceneRequest: "A neon market at night",
      now: createClock(),
    });

    expect(workflowWithInput.nodes["scene-input"]).toMatchObject({
      status: "manual",
      source: "manual",
      result: { rawIntent: "A neon market at night" },
    });
    expect(workflowWithInput.workflowMode).toBe("single-image");
    expect(workflowWithInput.nodes["scene-prompt"].status).toBe("ready");
    expect(canRunTimelineNode(workflowWithInput, "scene-prompt")).toBe(true);
    expect(canRunTimelineNode(workflowWithInput, "character-tags")).toBe(false);
  });

  it("runs nodes only after predecessors are done or manual and keeps execution blocked before confirmation", () => {
    const clock = createClock();
    let workflow = createTimelineWorkflowState({
      workflowId: "dependency-gates",
      sceneRequest: "A robot sketching in a station cafe",
      now: clock,
    });

    expect(getRunnableTimelineNodeIds(workflow)).toEqual(["scene-prompt"]);
    expect(canRunTimelineNode(workflow, "scene-prompt")).toBe(true);
    expect(canRunTimelineNode(workflow, "character-tags")).toBe(false);

    workflow = completeTimelineNode(workflow, "scene-prompt", { prompt: "station cafe robot" }, "ai", {
      now: clock,
    });

    expect(getRunnableTimelineNodeIds(workflow)).toEqual(["character-tags", "character-action"]);
    expect(canRunTimelineNode(workflow, "character-tags")).toBe(true);
    expect(canRunTimelineNode(workflow, "character-action")).toBe(true);
    expect(canRunTimelineNode(workflow, "canvas-binding")).toBe(false);

    workflow = completeTimelineNode(workflow, "character-action", { action: "sketching" }, "ai", { now: clock });

    expect(canRunTimelineNode(workflow, "character-action")).toBe(false);
    expect(canRunTimelineNode(workflow, "character-tags")).toBe(true);
    expect(canRunTimelineNode(workflow, "canvas-binding")).toBe(false);

    workflow = completeTimelineNode(workflow, "character-tags", { tags: ["robot"] }, "ai", { now: clock });

    expect(getRunnableTimelineNodeIds(workflow)).toEqual(["canvas-binding", "resource-recommendation"]);
    expect(isReservedTimelineNodeId("resource-recommendation")).toBe(false);
    expect(isReservedTimelineNodeId("parameter-recommendation")).toBe(false);
    expect(canRunTimelineNode(workflow, "resource-recommendation")).toBe(true);
    expect(canRunTimelineNode(workflow, "parameter-recommendation")).toBe(false);
    expect(isReservedTimelineNodeId("comfyui-execution")).toBe(false);
    expect(isReservedTimelineNodeId("result-display")).toBe(false);
    expect(canRunTimelineNode(workflow, "comfyui-execution")).toBe(false);
    expect(canRunTimelineNode(workflow, "result-display")).toBe(false);
    expect(getRunnableTimelineNodeIds(workflow)).not.toContain("comfyui-execution");
    expect(getRunnableTimelineNodeIds(workflow)).not.toContain("result-display");
  });

  it("marks manual edit downstream nodes stale while preserving unrelated branch results", () => {
    const clock = createClock();
    const workflow = createReadyForGateWorkflow(clock);

    const edited = setTimelineNodeManualResult(
      workflow,
      "canvas-binding",
      { primaryCharacterId: "character-2" },
      { now: clock },
    );

    expect(edited.nodes["canvas-binding"]).toMatchObject({
      status: "manual",
      result: { primaryCharacterId: "character-2" },
    });
    expect(edited.nodes["resource-recommendation"]).toMatchObject({
      status: "manual",
      result: { checkpoint: "local.safetensors", loras: [] },
    });
    expect(edited.nodes["parameter-recommendation"].status).toBe("stale");
    expect(edited.nodes["generation-gate"].status).toBe("stale");
    expect(edited.nodes["comfyui-execution"].status).toBe("stale");
    expect(edited.nodes["result-display"].status).toBe("stale");
  });

  it("stales from resource recommendation after Run resource edits and preserves upstream work", () => {
    const clock = createClock();
    const workflow = confirmTimelineGeneration(createReadyForGateWorkflow(clock), undefined, { now: clock });
    const edited = updateTimelineSceneInputSettings(
      workflow,
      sanitizeRunSceneInputSettingsSnapshot({
        detailers: {
          faceDetailer: { enabled: false },
          handDetailer: { enabled: false },
        },
        promptProfile: "illustrious",
        stylePalette: {
          checkpointId: "checkpoint-new",
          loras: [],
        },
      }),
      "resource-recommendation",
      { now: clock },
    );

    expect(edited.generationConfirmed).toBe(false);
    expect(edited.nodes["scene-prompt"]).toMatchObject(workflow.nodes["scene-prompt"]);
    expect(edited.nodes["character-tags"]).toMatchObject(workflow.nodes["character-tags"]);
    expect(edited.nodes["character-action"]).toMatchObject(workflow.nodes["character-action"]);
    expect(edited.nodes["canvas-binding"]).toMatchObject(workflow.nodes["canvas-binding"]);
    expect(edited.nodes["resource-recommendation"].status).toBe("stale");
    expect(edited.nodes["parameter-recommendation"].status).toBe("stale");
    expect(edited.nodes["generation-gate"].status).toBe("stale");
    expect(edited.nodes["comfyui-execution"].status).toBe("stale");
    expect(edited.nodes["result-display"].status).toBe("stale");
    expect(edited.nodes["scene-input"].result).toMatchObject({
      settingsSnapshot: {
        stylePalette: { checkpointId: "checkpoint-new", loras: [] },
      },
    });
  });

  it("stales from parameter recommendation after Run parameter or detailer edits", () => {
    const clock = createClock();
    const workflow = confirmTimelineGeneration(createReadyForGateWorkflow(clock), undefined, { now: clock });
    const edited = updateTimelineSceneInputSettings(
      workflow,
      sanitizeRunSceneInputSettingsSnapshot({
        detailers: {
          faceDetailer: { enabled: true, detectorModelName: "bbox/custom-face.pt", steps: 18 },
          handDetailer: { enabled: false },
        },
        promptProfile: "illustrious",
      }),
      "parameter-recommendation",
      { now: clock },
    );

    expect(edited.generationConfirmed).toBe(false);
    expect(edited.nodes["resource-recommendation"]).toMatchObject(workflow.nodes["resource-recommendation"]);
    expect(edited.nodes["parameter-recommendation"].status).toBe("stale");
    expect(edited.nodes["generation-gate"].status).toBe("stale");
    expect(edited.nodes["comfyui-execution"].status).toBe("stale");
    expect(edited.nodes["result-display"].status).toBe("stale");
    expect(edited.nodes["scene-input"].result).toMatchObject({
      settingsSnapshot: {
        detailers: {
          faceDetailer: {
            enabled: true,
            detectorModelName: "bbox/custom-face.pt",
            steps: 18,
          },
          handDetailer: { enabled: false },
        },
      },
    });
  });

  it("stales only from parameter recommendation and cancels confirmation after a Run style-reference edit", () => {
    const clock = createClock();
    const workflow = confirmTimelineGeneration(createReadyForGateWorkflow(clock), undefined, { now: clock });
    const edited = updateTimelineSceneInputSettings(
      workflow,
      sanitizeRunSceneInputSettingsSnapshot({
        detailers: {
          faceDetailer: { enabled: false },
          handDetailer: { enabled: false },
        },
        promptProfile: "illustrious",
        styleReference: runStyleReference,
      }),
      "parameter-recommendation",
      { now: clock },
    );

    expect(edited.generationConfirmed).toBe(false);
    for (const nodeId of [
      "scene-prompt",
      "character-tags",
      "character-action",
      "canvas-binding",
      "resource-recommendation",
    ] as const) {
      expect(edited.nodes[nodeId]).toMatchObject(workflow.nodes[nodeId]);
    }
    for (const nodeId of [
      "parameter-recommendation",
      "generation-gate",
      "comfyui-execution",
      "result-display",
    ] as const) {
      expect(edited.nodes[nodeId].status).toBe("stale");
    }
    expect(edited.nodes["scene-input"].result).toMatchObject({
      settingsSnapshot: { styleReference: runStyleReference },
    });
  });

  it("allows stale nodes to regenerate only after dependencies are valid", () => {
    const clock = createClock();
    const workflow = createReadyForGateWorkflow(clock);
    const edited = setTimelineNodeManualResult(
      workflow,
      "scene-prompt",
      { prompt: "rainy greenhouse" },
      { now: clock },
    );

    expect(edited.nodes["character-tags"].status).toBe("stale");
    expect(edited.nodes["character-action"].status).toBe("stale");
    expect(edited.nodes["canvas-binding"].status).toBe("stale");
    expect(isTimelineNodeRegenerationEligible(edited, "character-tags")).toBe(true);
    expect(isTimelineNodeRegenerationEligible(edited, "character-action")).toBe(true);
    expect(isTimelineNodeRegenerationEligible(edited, "canvas-binding")).toBe(false);

    const regeneratedTags = setTimelineNodeManualResult(
      edited,
      "character-tags",
      { tags: ["pilot", "raincoat"] },
      { now: clock },
    );

    expect(regeneratedTags.nodes["character-action"].status).toBe("stale");
    expect(regeneratedTags.nodes["canvas-binding"].status).toBe("stale");
    expect(isTimelineNodeRegenerationEligible(regeneratedTags, "character-action")).toBe(true);
    expect(isTimelineNodeRegenerationEligible(regeneratedTags, "canvas-binding")).toBe(false);

    const regeneratedAction = setTimelineNodeManualResult(
      regeneratedTags,
      "character-action",
      { action: "checking controls" },
      { now: clock },
    );

    expect(isTimelineNodeRegenerationEligible(regeneratedAction, "canvas-binding")).toBe(true);
  });

  it("marks only the T5 layout join stale after editing either parallel branch", () => {
    const clock = createClock();
    const workflow = createReadyForGateWorkflow(clock);

    const editedTags = setTimelineNodeManualResult(
      workflow,
      "character-tags",
      { tags: ["pilot", "raincoat"] },
      { now: clock },
    );

    expect(editedTags.nodes["character-action"]).toMatchObject({
      status: "manual",
      result: { action: "checking controls" },
    });
    expect(editedTags.nodes["canvas-binding"].status).toBe("stale");

    const editedAction = setTimelineNodeManualResult(
      workflow,
      "character-action",
      { action: "checking an overhead switch" },
      { now: clock },
    );

    expect(editedAction.nodes["character-tags"]).toMatchObject({
      status: "manual",
      result: { tags: ["pilot"] },
    });
    expect(editedAction.nodes["canvas-binding"].status).toBe("stale");
  });

  it("executes ready nodes with injected adapters and normalizes failed node errors", async () => {
    const clock = createClock();
    const observedStatuses: string[] = [];
    const adapters: TimelineNodeAdapters = {
      "scene-prompt": (context) => {
        observedStatuses.push(context.workflow.nodes["scene-prompt"].status);
        return { value: { prompt: "a quiet forest" }, source: "ai" };
      },
      "character-tags": () => {
        throw new Error("tag inference failed");
      },
      "character-action": () => ({ value: { action: "walking under trees" }, source: "ai" }),
    };
    const workflow = createTimelineWorkflowState({
      workflowId: "adapter-failure",
      sceneRequest: "A quiet forest",
      now: clock,
    });

    const result = await executeTimelineGraph(workflow, adapters, { now: clock });

    expect(observedStatuses).toEqual(["running"]);
    expect(result.nodes["scene-prompt"]).toMatchObject({
      status: "done",
      result: { prompt: "a quiet forest" },
      source: "ai",
    });
    expect(result.nodes["character-tags"].status).toBe("error");
    expect(result.nodes["character-tags"].error).toMatchObject({
      code: "timeline_node_failed",
      message: "tag inference failed",
    });
    expect(result.nodes["character-action"]).toMatchObject({
      status: "done",
      result: { action: "walking under trees" },
    });
    expect(result.nodes["canvas-binding"].status).toBe("blocked");
  });

  it("runs canvas binding and resource recommendation while keeping execution nodes blocked", async () => {
    const clock = createClock();
    const seen: string[] = [];
    const adapters: TimelineNodeAdapters = {
      "scene-prompt": () => ({ value: { prompt: "city rooftop" }, source: "ai" }),
      "character-tags": () => ({ value: { tags: ["runner"] }, source: "ai" }),
      "character-action": () => ({ value: { action: "leaping" }, source: "ai" }),
      "canvas-binding": () => {
        seen.push("canvas-binding");
        return { value: { primaryCharacterId: "character-1" }, source: "system" };
      },
      "resource-recommendation": () => {
        seen.push("resource-recommendation");
        return { value: { checkpoint: "local.safetensors", loras: [] }, source: "ai" };
      },
      "parameter-recommendation": () => {
        seen.push("parameter-recommendation");
        return { value: { width: 1024 }, source: "system" };
      },
    };
    const workflow = createTimelineWorkflowState({
      workflowId: "branch-merge",
      sceneRequest: "A runner leaping over a city rooftop",
      now: clock,
    });

    const result = await executeTimelineGraph(workflow, adapters, { now: clock });

    expect(result.workflowMode).toBe("single-image");
    expect(seen).toEqual(["canvas-binding", "resource-recommendation", "parameter-recommendation"]);
    expect(result.nodes["canvas-binding"]).toMatchObject({
      status: "done",
      result: { primaryCharacterId: "character-1" },
    });
    expect(result.nodes["resource-recommendation"].status).toBe("done");
    expect(result.nodes["parameter-recommendation"].status).toBe("done");
    expect(result.nodes["generation-gate"].status).toBe("blocked");
  });

  it("keeps runtime timeline execution in memory without browser persistence writes", async () => {
    window.localStorage.clear();
    window.sessionStorage.clear();

    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const clock = createClock();
    const adapters: TimelineNodeAdapters = {
      "scene-prompt": () => ({ value: { prompt: "memory only" }, source: "ai" }),
      "character-tags": () => ({ value: { tags: ["archivist"] }, source: "ai" }),
      "character-action": () => ({ value: { action: "sorting slides" }, source: "ai" }),
      "canvas-binding": () => ({ value: { primaryCharacterId: "character-1" }, source: "system" }),
      "resource-recommendation": () => ({ value: { checkpoint: "local.safetensors", loras: [] }, source: "ai" }),
      "parameter-recommendation": () => ({ value: { width: 1024 }, source: "system" }),
    };
    const workflow = createTimelineWorkflowState({
      workflowId: "memory-only",
      sceneRequest: "An archivist sorting glass slides",
      now: clock,
    });

    const result = await executeTimelineGraph(workflow, adapters, { now: clock });

    expect(result.nodes["canvas-binding"].status).toBe("done");
    expect(result.nodes["resource-recommendation"].status).toBe("done");
    expect(result.nodes["parameter-recommendation"].status).toBe("done");
    expect(result.nodes["generation-gate"].status).toBe("blocked");
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("invalidates prior generation confirmation after an upstream manual edit", async () => {
    const clock = createClock();
    let workflow = createReadyForGateWorkflow(clock);
    workflow = confirmTimelineGeneration(workflow, undefined, { now: clock });

    expect(workflow.generationConfirmed).toBe(true);
    expect(workflow.nodes["generation-gate"].status).toBe("manual");

    workflow = setTimelineNodeManualResult(
      workflow,
      "scene-prompt",
      { prompt: "rainy glass greenhouse" },
      { now: clock },
    );

    expect(workflow.generationConfirmed).toBe(false);
    expect(workflow.nodes["generation-gate"].status).toBe("stale");

    const adapters: TimelineNodeAdapters = {
      "character-tags": () => ({ value: { tags: ["pilot", "raincoat"] }, source: "ai" }),
      "character-action": () => ({ value: { action: "checking controls" }, source: "ai" }),
      "canvas-binding": () => ({ value: { primaryCharacterId: "character-1" }, source: "system" }),
      "resource-recommendation": () => ({ value: { checkpoint: "local.safetensors", loras: [] }, source: "ai" }),
      "parameter-recommendation": () => ({ value: { width: 1024 }, source: "system" }),
    };

    const result = await executeTimelineGraph(workflow, adapters, { now: clock });

    expect(result.generationConfirmed).toBe(false);
    expect(result.nodes["resource-recommendation"].status).toBe("done");
    expect(result.nodes["parameter-recommendation"].status).toBe("done");
    expect(result.nodes["generation-gate"].status).toBe("blocked");
    expect(result.nodes["comfyui-execution"].status).not.toBe("done");
    expect(result.nodes["result-display"].status).not.toBe("done");
  });

  it("blocks at the generation gate before any ComfyUI execution can run", async () => {
    const clock = createClock();
    const workflow: TimelineWorkflowState = createReadyForGateWorkflow(clock);

    const result = await executeTimelineGraph(workflow, {}, { now: clock });

    expect(result.nodes["generation-gate"]).toMatchObject({
      status: "blocked",
      error: {
        code: "confirmation_required",
        message: "User confirmation is required before ComfyUI execution can start.",
      },
    });
    expect(result.nodes["comfyui-execution"].status).not.toBe("running");
    expect(result.nodes["comfyui-execution"].status).not.toBe("done");
    expect(result.nodes["result-display"].status).not.toBe("running");
    expect(result.nodes["result-display"].status).not.toBe("done");
  });

  it("runs ComfyUI execution and result display only after explicit confirmation", async () => {
    const clock = createClock();
    let workflow: TimelineWorkflowState = createReadyForGateWorkflow(clock);
    workflow = confirmTimelineGeneration(workflow, undefined, { now: clock });

    const adapters: TimelineNodeAdapters = {
      "preview-execution": (context) => {
        expect(context.workflow.generationConfirmed).toBe(true);
        return {
          value: {
            finalCount: 1,
            candidates: [{ candidateId: "preview-1", status: "done" }],
          },
          source: "system",
        };
      },
      "preview-scoring": (context) => {
        expect(context.workflow.nodes["preview-execution"].status).toBe("done");
        return {
          value: {
            selectedCandidateIds: ["preview-1"],
            scores: [],
          },
          source: "ai",
        };
      },
      "comfyui-execution": (context) => {
        expect(context.workflow.generationConfirmed).toBe(true);
        expect(context.workflow.nodes["generation-gate"].status).toBe("manual");

        return {
          value: {
            nodeIds: {},
            outputNodeId: "9",
            promptId: "prompt-1",
            request: {
              checkpointName: "local.safetensors",
              positivePrompt: "glass greenhouse",
            },
            warnings: [],
          },
          source: "system",
        };
      },
      "result-display": (context) => {
        expect(context.workflow.nodes["comfyui-execution"].result).toMatchObject({
          promptId: "prompt-1",
        });

        return {
          value: {
            completed: true,
            image: {
              filename: "stored.png",
              nodeId: "9",
              url: "/api/comfyui/generated-images/stored.png",
            },
            promptId: "prompt-1",
            sourceImage: {
              filename: "source.png",
              nodeId: "9",
              type: "temp",
            },
            storedImage: {
              byteLength: 10,
              contentType: "image/png",
              filename: "stored.png",
              url: "/api/comfyui/generated-images/stored.png",
            },
            warnings: [],
          },
          source: "system",
        };
      },
    };

    const result = await executeTimelineGraph(workflow, adapters, { now: clock });

    expect(result.nodes["comfyui-execution"]).toMatchObject({
      status: "done",
      result: {
        promptId: "prompt-1",
      },
    });
    expect(result.nodes["result-display"]).toMatchObject({
      status: "done",
      result: {
        image: {
          url: "/api/comfyui/generated-images/stored.png",
        },
      },
    });
  });

  it.each([
    ["preview-execution", ["preview-execution", "preview-scoring", "comfyui-execution", "result-display"]],
    ["preview-scoring", ["preview-scoring", "comfyui-execution", "result-display"]],
    ["comfyui-execution", ["comfyui-execution", "result-display"]],
  ] as const)("stales only the %s retry phase and its descendants", (nodeId, expectedStale) => {
    const clock = createClock();
    let workflow = confirmTimelineGeneration(createReadyForGateWorkflow(clock), undefined, { now: clock });
    for (const phase of ["preview-execution", "preview-scoring", "comfyui-execution", "result-display"] as const) {
      workflow = completeTimelineNode(workflow, phase, { phase }, "system", { now: clock });
    }

    const retried = retryTimelineGenerationFrom(workflow, nodeId, { now: clock });
    for (const phase of ["preview-execution", "preview-scoring", "comfyui-execution", "result-display"] as const) {
      expect(retried.nodes[phase].status, phase).toBe((expectedStale as readonly string[]).includes(phase) ? "stale" : "done");
    }
    expect(retried.generationConfirmed).toBe(true);
    expect(retried.nodes["generation-gate"].status).toBe("manual");
    expect(retried.nodes["preview-execution"].result).toMatchObject({ phase: "preview-execution" });
    expect(retried.nodes["preview-execution"].result).not.toHaveProperty("advanceSeedOnRetry");
  });

  it("strips legacy preview retry markers across upstream edits, settings staleness, and reconfirmation", () => {
    const createMarkedWorkflow = () => {
      const clock = createClock();
      let workflow = confirmTimelineGeneration(createReadyForGateWorkflow(clock), undefined, { now: clock });
      workflow = completeTimelineNode(workflow, "preview-execution", {
        advanceSeedOnRetry: true,
        baseSeed: 100,
        candidateCount: 4,
        finalCount: 1,
        previewHeight: 768,
        previewWidth: 768,
        previewSteps: 20,
        candidates: [],
        successfulCount: 0,
        warnings: [],
      }, "system", { now: clock });
      return { clock, workflow };
    };

    const upstream = createMarkedWorkflow();
    const afterUpstreamEdit = setTimelineNodeManualResult(
      upstream.workflow,
      "scene-prompt",
      { prompt: "revised glass greenhouse" },
      { now: upstream.clock },
    );
    expect(afterUpstreamEdit.nodes["preview-execution"].result).not.toHaveProperty("advanceSeedOnRetry");

    const settings = createMarkedWorkflow();
    const afterSettingsEdit = updateTimelineSceneInputSettings(
      settings.workflow,
      sanitizeRunSceneInputSettingsSnapshot({
        detailers: { faceDetailer: { enabled: true }, handDetailer: { enabled: false } },
        promptProfile: "illustrious",
      }),
      "parameter-recommendation",
      { now: settings.clock },
    );
    expect(afterSettingsEdit.nodes["preview-execution"].result).not.toHaveProperty("advanceSeedOnRetry");

    const reconfirmation = createMarkedWorkflow();
    const afterReconfirmation = requireTimelineGenerationReconfirmation(
      reconfirmation.workflow,
      undefined,
      { now: reconfirmation.clock },
    );
    expect(afterReconfirmation.nodes["preview-execution"].result).not.toHaveProperty("advanceSeedOnRetry");
  });

  it("manual preview selection stales only final execution and result display", () => {
    const clock = createClock();
    let workflow = confirmTimelineGeneration(createReadyForGateWorkflow(clock), undefined, { now: clock });
    workflow = completeTimelineNode(workflow, "preview-execution", { finalCount: 1, candidates: [] }, "system", { now: clock });
    workflow = completeTimelineNode(workflow, "preview-scoring", {
      selectedCandidateIds: ["preview-1"],
      selectionSource: "ai",
      scores: [],
    }, "ai", { now: clock });
    workflow = completeTimelineNode(workflow, "comfyui-execution", { completed: true }, "system", { now: clock });
    workflow = completeTimelineNode(workflow, "result-display", { completed: true }, "system", { now: clock });

    const edited = setTimelineNodeManualResult(workflow, "preview-scoring", {
      selectedCandidateIds: ["preview-2"],
      selectionSource: "manual",
      scores: [],
    }, { now: clock });

    expect(edited.nodes["preview-execution"].status).toBe("done");
    expect(edited.nodes["preview-scoring"]).toMatchObject({ status: "manual", source: "manual" });
    expect(edited.nodes["comfyui-execution"].status).toBe("stale");
    expect(edited.nodes["result-display"].status).toBe("stale");
    expect(edited.generationConfirmed).toBe(true);
  });

  it("changes Final redraw strength without staling the selected Preview pool or advancing its seed", () => {
    const clock = createClock();
    let workflow = confirmTimelineGeneration(createReadyForGateWorkflow(clock), undefined, { now: clock });
    workflow = completeTimelineNode(workflow, "preview-execution", {
      baseSeed: 100,
      candidateCount: 4,
      finalCount: 1,
      candidates: [{ candidateId: "preview-1", seed: 100 }],
    }, "system", { now: clock });
    workflow = completeTimelineNode(workflow, "preview-scoring", {
      selectedCandidateIds: ["preview-1"],
      selectionSource: "ai",
      scores: [{ candidateId: "preview-1", rank: 1 }],
    }, "ai", { now: clock });
    workflow = setTimelineNodeManualResult(
      workflow,
      "preview-scoring",
      workflow.nodes["preview-scoring"].result,
      { now: clock },
    );
    workflow = completeTimelineNode(workflow, "comfyui-execution", { completed: true }, "system", { now: clock });
    workflow = completeTimelineNode(workflow, "result-display", { completed: true }, "system", { now: clock });

    const edited = updateTimelineFinalRedrawPreset(workflow, sanitizeRunSceneInputSettingsSnapshot({
      finalRedrawPreset: "strong",
    }), { now: clock });

    expect(edited.generationConfirmed).toBe(false);
    expect(edited.nodes["generation-gate"]).toMatchObject({
      status: "blocked",
      error: { code: "confirmation_required" },
    });
    expect(edited.nodes["preview-execution"]).toMatchObject({
      status: "done",
      result: { baseSeed: 100 },
    });
    expect(edited.nodes["preview-scoring"]).toMatchObject({
      status: "manual",
      result: { selectedCandidateIds: ["preview-1"] },
    });
    expect(edited.nodes["comfyui-execution"].status).toBe("stale");
    expect(edited.nodes["result-display"].status).toBe("stale");
  });

  it("changes Final redraw strength before Preview without staling completed parameters", () => {
    const clock = createClock();
    const workflow = createReadyForGateWorkflow(clock);
    const parameters = workflow.nodes["parameter-recommendation"].result;

    const edited = updateTimelineFinalRedrawPreset(workflow, sanitizeRunSceneInputSettingsSnapshot({
      finalRedrawPreset: "strong",
    }), { now: clock });

    expect(edited.nodes["parameter-recommendation"]).toMatchObject({
      status: "manual",
      result: parameters,
    });
    expect(edited.nodes["preview-execution"].status).toBe("stale");
    expect(edited.nodes["generation-gate"]).toMatchObject({
      status: "blocked",
      error: { code: "confirmation_required" },
    });
  });
});
