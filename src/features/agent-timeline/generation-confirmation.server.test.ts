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

  it("binds prepared ReID identity, v3 reference context, and Krea policy v5 against tampering", () => {
    const characterReference = {
      kind: "krea2-reid" as const,
      status: "ready" as const,
      strength: 1,
      metadata: {
        byteLength: 777,
        contentType: "image/png",
        storedFilename: "fedcba9876543210fedcba9876543210.png",
        uploadedAt: "2026-08-02T00:00:00.000Z",
        url: "/api/comfyui/sequence-references/fedcba9876543210fedcba9876543210.png",
      },
      reIdPreparation: {
        choice: "crop" as const,
        detector: "yunet-2023mar-int8" as const,
        detectorSha256: "a".repeat(64),
        faceDetected: true,
        height: 256,
        version: 2 as const,
        width: 256,
      },
    };
    let workflow = createTimelineWorkflowState({
      workflowId: "confirmation-krea-reid-v5",
      promptProfile: "krea2",
      sceneRequest: "A greenhouse portrait",
      settingsSnapshot: {
        characterReference,
        finalRedrawPreset: "balanced",
        promptProfile: "krea2",
      },
    });
    workflow = setTimelineNodeManualResult(workflow, "parameter-recommendation", {
      requestPreview: {
        checkpointName: "RedCraft_v4_fp8_scaled.safetensors",
        clipName: "qwen3vl_4b_fp8_scaled.safetensors",
        vaeName: "qwen_image_vae.safetensors",
        unetWeightDtype: "default",
        modelBaseModel: "Krea 2",
        modelStorageKind: "diffusion",
        positivePrompt: "greenhouse portrait",
        workflowProfile: "krea2",
      },
    });
    const fingerprint = createTimelineGenerationConfirmationFingerprint(workflow);
    workflow = confirmTimelineGeneration(workflow, {
      automaticLocalRepairAuthorized: false,
      confirmationFingerprint: fingerprint,
      confirmationRequired: false,
      confirmed: true,
      finalDenoise: 1,
      finalGenerationFamily: "krea2",
      finalPolicyVersion: 5,
      finalRedrawPreset: "balanced",
      finalSteps: 8,
      referenceContext: {
        version: 3 as never,
        adapter: "krea2-reid",
        references: [{
          role: "character",
          storedFilename: characterReference.metadata.storedFilename,
          contentType: "image/png",
          byteLength: 777,
          strength: 1,
        }],
        startPercent: 0,
        endPercent: 1,
      },
      visualStyle: "anime",
    });

    expect(isTimelineGenerationConfirmationCurrent(workflow)).toBe(true);
    for (const [label, mutate] of [
      ["policy version", (copy: typeof workflow) => {
        (copy.nodes["generation-gate"].result as Record<string, unknown>).finalPolicyVersion = 3;
      }],
      ["reference context version", (copy: typeof workflow) => {
        (copy.nodes["generation-gate"].result as { referenceContext: { version: number } }).referenceContext.version = 1;
      }],
      ["reference strength", (copy: typeof workflow) => {
        (copy.nodes["generation-gate"].result as { referenceContext: { references: Array<{ strength: number }> } })
          .referenceContext.references[0]!.strength = 0.8;
      }],
      ["prepared choice", (copy: typeof workflow) => {
        ((copy.nodes["scene-input"].result as { settingsSnapshot: { characterReference: { reIdPreparation: { choice: string } } } })
          .settingsSnapshot.characterReference.reIdPreparation.choice = "original");
      }],
    ] as const) {
      const tampered = structuredClone(workflow);
      mutate(tampered);
      expect(isTimelineGenerationConfirmationCurrent(tampered), label).toBe(false);
    }
  });
});
