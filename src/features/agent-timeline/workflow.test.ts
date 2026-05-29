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
  setTimelineNodeManualResult,
  validateTimelineDependencyDag,
  type TimelineNodeAdapters,
  type TimelineWorkflowState,
} from ".";

function createClock() {
  let tick = 0;

  return () => {
    tick += 1;
    return `2026-05-29T00:00:${String(tick).padStart(2, "0")}.000Z`;
  };
}

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
    expect(getTimelineNodeDependencies("comfyui-execution")).toEqual(["generation-gate"]);
    expect(getTimelineDownstreamClosure("canvas-binding")).toEqual([
      "parameter-recommendation",
      "generation-gate",
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
    expect(workflowWithInput.nodes["scene-prompt"].status).toBe("ready");
    expect(canRunTimelineNode(workflowWithInput, "scene-prompt")).toBe(true);
    expect(canRunTimelineNode(workflowWithInput, "character-tags")).toBe(false);
  });

  it("runs nodes only after predecessors are done or manual and never exposes reserved nodes", () => {
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

    expect(getRunnableTimelineNodeIds(workflow)).toEqual(["canvas-binding"]);
    expect(isReservedTimelineNodeId("resource-recommendation")).toBe(true);
    expect(isReservedTimelineNodeId("parameter-recommendation")).toBe(true);
    expect(canRunTimelineNode(workflow, "resource-recommendation")).toBe(false);
    expect(canRunTimelineNode(workflow, "parameter-recommendation")).toBe(false);
    expect(isReservedTimelineNodeId("comfyui-execution")).toBe(true);
    expect(isReservedTimelineNodeId("result-display")).toBe(true);
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

  it("runs canvas binding while keeping future resource and parameter nodes blocked", async () => {
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
    };
    const workflow = createTimelineWorkflowState({
      workflowId: "branch-merge",
      sceneRequest: "A runner leaping over a city rooftop",
      now: clock,
    });

    const result = await executeTimelineGraph(workflow, adapters, { now: clock });

    expect(seen).toEqual(["canvas-binding"]);
    expect(result.nodes["canvas-binding"]).toMatchObject({
      status: "done",
      result: { primaryCharacterId: "character-1" },
    });
    expect(result.nodes["resource-recommendation"].status).toBe("blocked");
    expect(result.nodes["parameter-recommendation"].status).toBe("blocked");
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
    };
    const workflow = createTimelineWorkflowState({
      workflowId: "memory-only",
      sceneRequest: "An archivist sorting glass slides",
      now: clock,
    });

    const result = await executeTimelineGraph(workflow, adapters, { now: clock });

    expect(result.nodes["canvas-binding"].status).toBe("done");
    expect(result.nodes["resource-recommendation"].status).toBe("blocked");
    expect(result.nodes["parameter-recommendation"].status).toBe("blocked");
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
    };

    const result = await executeTimelineGraph(workflow, adapters, { now: clock });

    expect(result.generationConfirmed).toBe(false);
    expect(result.nodes["resource-recommendation"].status).toBe("stale");
    expect(result.nodes["parameter-recommendation"].status).toBe("stale");
    expect(result.nodes["generation-gate"].status).toBe("stale");
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
});
