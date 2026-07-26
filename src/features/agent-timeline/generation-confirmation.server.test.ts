import { describe, expect, it } from "vitest";

import {
  createTimelineGenerationConfirmationFingerprint,
  isTimelineGenerationConfirmationCurrent,
} from "./generation-confirmation.server";
import {
  confirmTimelineGeneration,
  createTimelineWorkflowState,
  setTimelineNodeManualResult,
} from "./state";

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

  it("requires the complete Krea v3 preset, family, step, and denoise contract", () => {
    let workflow = createTimelineWorkflowState({
      workflowId: "confirmation-krea-v3-policy",
      promptProfile: "krea2",
      sceneRequest: "A glass greenhouse",
      settingsSnapshot: { finalRedrawPreset: "balanced", promptProfile: "krea2" },
    });
    workflow = setTimelineNodeManualResult(workflow, "parameter-recommendation", {
      requestPreview: {
        checkpointName: "krea-2-turbo-unet.safetensors",
        modelBaseModel: "Krea 2",
        positivePrompt: "glass greenhouse",
        workflowProfile: "krea2",
      },
    });
    workflow = confirmTimelineGeneration(workflow, {
      automaticLocalRepairAuthorized: false,
      confirmationFingerprint: createTimelineGenerationConfirmationFingerprint(workflow),
      confirmationRequired: false,
      confirmed: true,
      finalDenoise: 0.18,
      finalGenerationFamily: "krea2",
      finalPolicyVersion: 3,
      finalRedrawPreset: "balanced",
      finalSteps: 4,
    });

    expect(isTimelineGenerationConfirmationCurrent(workflow)).toBe(true);

    for (const stalePatch of [
      { finalPolicyVersion: 2 },
      { finalRedrawPreset: "strong" },
      { finalGenerationFamily: "fallback" },
      { finalSteps: undefined },
      { finalSteps: 6 },
      { finalDenoise: 0.45 },
    ]) {
      const staleWorkflow = structuredClone(workflow);
      Object.assign(
        staleWorkflow.nodes["generation-gate"].result as Record<string, unknown>,
        stalePatch,
      );
      expect(isTimelineGenerationConfirmationCurrent(staleWorkflow)).toBe(false);
    }
  });
});
