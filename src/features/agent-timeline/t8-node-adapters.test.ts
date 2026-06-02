import { describe, expect, it } from "vitest";

import {
  confirmTimelineGeneration,
  createConfirmedTimelineComfyUiRequest,
  createTimelineWorkflowState,
  setTimelineNodeManualResult,
} from ".";

function createConfirmedWorkflow(imageCount?: number) {
  let workflow = createTimelineWorkflowState({
    imageCount,
    sceneRequest: "A pilot in a greenhouse",
    workflowId: "t8-request",
  });

  workflow = setTimelineNodeManualResult(workflow, "scene-prompt", {
    positivePrompt: "glass greenhouse pilot",
  });
  workflow = setTimelineNodeManualResult(workflow, "character-tags", { items: [] });
  workflow = setTimelineNodeManualResult(workflow, "character-action", { action: "checking controls" });
  workflow = setTimelineNodeManualResult(workflow, "canvas-binding", { spatialSummary: "centered character" });
  workflow = setTimelineNodeManualResult(workflow, "resource-recommendation", {
    checkpoint: "local.safetensors",
    loras: [],
  });
  workflow = setTimelineNodeManualResult(workflow, "parameter-recommendation", {
    requestPreview: {
      batchSize: 4,
      checkpointName: "local.safetensors",
      negativePrompt: "low detail",
      positivePrompt: "glass greenhouse pilot",
      preview: true,
      steps: 30,
      width: 1024,
      height: 1024,
    },
  });

  return workflow;
}

describe("timeline T8 ComfyUI request conversion", () => {
  it("refuses to construct the ComfyUI request before explicit confirmation", () => {
    const workflow = createConfirmedWorkflow();

    expect(() => createConfirmedTimelineComfyUiRequest(workflow)).toThrow(
      "Confirm generation before constructing or executing a ComfyUI request.",
    );
  });

  it("converts the confirmed parameter preview to a default single-image execution request", () => {
    const workflow = confirmTimelineGeneration(createConfirmedWorkflow());

    expect(createConfirmedTimelineComfyUiRequest(workflow)).toEqual({
      batchSize: 1,
      checkpointName: "local.safetensors",
      negativePrompt: "low detail",
      positivePrompt: "glass greenhouse pilot",
      preview: false,
      steps: 30,
      width: 1024,
      height: 1024,
    });
  });

  it("uses the T1 image count as the confirmed execution batch size", () => {
    const workflow = confirmTimelineGeneration(createConfirmedWorkflow(3));

    expect(createConfirmedTimelineComfyUiRequest(workflow)).toMatchObject({
      batchSize: 3,
      checkpointName: "local.safetensors",
      preview: false,
    });
  });
});
