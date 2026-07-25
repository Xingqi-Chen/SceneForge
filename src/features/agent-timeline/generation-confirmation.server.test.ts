import { describe, expect, it } from "vitest";

import { createTimelineGenerationConfirmationFingerprint } from "./generation-confirmation.server";
import { createTimelineWorkflowState, setTimelineNodeManualResult } from "./state";

describe("Run generation confirmation contract", () => {
  it("binds the selected preset and resolved family/denoise policy", () => {
    const createWorkflow = (finalRedrawPreset: "balanced" | "strong") => {
      let workflow = createTimelineWorkflowState({
        workflowId: "confirmation-final-policy",
        sceneRequest: "A glass greenhouse",
        settingsSnapshot: { finalRedrawPreset },
      });
      workflow = setTimelineNodeManualResult(workflow, "parameter-recommendation", {
        requestPreview: {
          checkpointName: "local.safetensors",
          modelBaseModel: "Illustrious",
          positivePrompt: "glass greenhouse",
        },
      });
      return workflow;
    };

    expect(createTimelineGenerationConfirmationFingerprint(createWorkflow("balanced")))
      .not.toBe(createTimelineGenerationConfirmationFingerprint(createWorkflow("strong")));
  });

  it("binds the default-off automatic local repair authorization", () => {
    const disabled = createTimelineWorkflowState({
      workflowId: "confirmation-repair-policy",
      sceneRequest: "A glass greenhouse",
      settingsSnapshot: { automaticLocalRepair: false },
    });
    const enabled = createTimelineWorkflowState({
      workflowId: "confirmation-repair-policy",
      sceneRequest: "A glass greenhouse",
      settingsSnapshot: { automaticLocalRepair: true },
    });

    expect(createTimelineGenerationConfirmationFingerprint(disabled))
      .not.toBe(createTimelineGenerationConfirmationFingerprint(enabled));
  });
});
