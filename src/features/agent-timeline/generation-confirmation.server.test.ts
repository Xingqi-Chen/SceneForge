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
  it("binds the selected Run character storage identity and strength", () => {
    const characterReference = {
      status: "ready" as const,
      strength: 0.8,
      metadata: {
        byteLength: 512,
        contentType: "image/png",
        storedFilename: "fedcba9876543210fedcba9876543210.png",
        uploadedAt: "2026-07-19T00:00:00.000Z",
        url: "/api/comfyui/sequence-references/fedcba9876543210fedcba9876543210.png",
      },
    };
    let workflow = createTimelineWorkflowState({
      workflowId: "confirmation-character-reference",
      sceneRequest: "A glass greenhouse",
      settingsSnapshot: { characterReference, promptProfile: "illustrious" },
    });
    workflow = setTimelineNodeManualResult(workflow, "parameter-recommendation", {
      characterReference,
      requestPreview: { checkpointName: "local.safetensors", positivePrompt: "glass greenhouse" },
    });
    const fingerprint = createTimelineGenerationConfirmationFingerprint(workflow);

    const differentImage = structuredClone(workflow);
    ((differentImage.nodes["scene-input"].result as { settingsSnapshot: { characterReference: { metadata: { storedFilename: string } } } })
      .settingsSnapshot.characterReference.metadata.storedFilename = "00112233445566778899aabbccddeeff.png");
    const differentStrength = structuredClone(workflow);
    ((differentStrength.nodes["scene-input"].result as { settingsSnapshot: { characterReference: { strength: number } } })
      .settingsSnapshot.characterReference.strength = 0.35);

    expect(createTimelineGenerationConfirmationFingerprint(differentImage)).not.toBe(fingerprint);
    expect(createTimelineGenerationConfirmationFingerprint(differentStrength)).not.toBe(fingerprint);
  });

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

  it("binds the normalized visual style", () => {
    const anime = createTimelineWorkflowState({
      workflowId: "confirmation-visual-style",
      sceneRequest: "A glass greenhouse",
      settingsSnapshot: { visualStyle: "anime" },
    });
    const photoreal = createTimelineWorkflowState({
      workflowId: "confirmation-visual-style",
      sceneRequest: "A glass greenhouse",
      settingsSnapshot: { visualStyle: "photoreal" },
    });

    expect(createTimelineGenerationConfirmationFingerprint(anime))
      .not.toBe(createTimelineGenerationConfirmationFingerprint(photoreal));
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
      visualStyle: "anime",
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
