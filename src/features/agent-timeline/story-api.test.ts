import { describe, expect, it, vi } from "vitest";

import {
  approveStoryReferenceAsset,
  confirmAndExecuteStoryGeneration,
  editStoryReferenceCanonicalPrompt,
  generateStoryReferencePlate,
  sanitizeStoryWorkflowState,
  StoryApiValidationError,
  uploadStoryReferenceAsset,
} from "./story-api";
import type { StoryReferencePlateGenerationAdapter } from "./story-reference-comfyui";
import type { StoryShotExecutionAdapter } from "./story-execution";
import { startStoryGraphWorkflow } from "./story-input";
import { createStoryWorkflowState, type StoryWorkflowNodeMap } from "./story-state";
import type { StoryReferenceAssetPlan } from "./story-types";

const resourceCandidates = {
  checkpoints: [
    {
      id: "checkpoint-anima",
      name: "Anima Checkpoint",
      baseModel: "Anima",
      modelBaseModel: "Anima",
      modelFileName: "anima.safetensors",
    },
  ],
  loras: [],
};

function createReferenceWorkflow() {
  return startStoryGraphWorkflow({
    rawIntent: "A two-shot courier story through a neon market.",
    targetShotCount: 2,
    storyId: "story-reference-actions",
    workflowId: "workflow-reference-actions",
    now: () => "2026-06-29T00:00:00.000Z",
    settingsSnapshot: {
      resourceCandidates,
    },
  });
}

function getReferencePlan(workflow: ReturnType<typeof createReferenceWorkflow>) {
  return workflow.nodes["reference-asset-plan"].result as StoryReferenceAssetPlan;
}

function referenceAdapterResult(filename: string) {
  return {
    byteLength: 12,
    contentType: "image/png",
    filename,
    metadata: {
      promptId: `prompt-${filename}`,
      referenceId: "character-face:main-character",
      warnings: [],
      workflowProfile: "anima",
    },
    source: "generated" as const,
    url: `/api/comfyui/generated-images/${filename}`,
  };
}

function shotAdapterResult(shotId: string) {
  return {
    resultReference: {
      completed: true,
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

function approveAllRequiredReferences(
  workflow: ReturnType<typeof createReferenceWorkflow>,
  excludedReferenceIds: string[] = [],
) {
  const excluded = new Set(excludedReferenceIds);

  return getReferencePlan(workflow).assets
    .filter((asset) => asset.importance === "required" && !excluded.has(asset.id))
    .reduce((currentWorkflow, asset) =>
      uploadStoryReferenceAsset({
        workflow: currentWorkflow,
        referenceId: asset.id,
        approve: true,
        now: () => "2026-06-29T00:01:00.000Z",
        assetReference: {
          filename: `${asset.id.replace(/[^a-z0-9]+/gi, "-")}.png`,
          source: "uploaded",
          url: `/api/comfyui/sequence-references/${asset.id}.png`,
        },
      }), workflow);
}

describe("story API workflow sanitizer", () => {
  it("restores legacy Story Graph workflows that are missing entity-card and reference-plan nodes", () => {
    const workflow = createStoryWorkflowState({
      now: () => "2026-06-14T00:00:00.000Z",
      storyId: "story-legacy",
      workflowId: "workflow-legacy",
    });
    const legacyNodes = { ...workflow.nodes } as Partial<StoryWorkflowNodeMap>;
    delete legacyNodes["entity-cards"];
    delete legacyNodes["reference-asset-plan"];

    const sanitized = sanitizeStoryWorkflowState({
      ...workflow,
      nodes: legacyNodes,
    });

    expect(sanitized).not.toBeNull();
    if (!sanitized) {
      throw new Error("Expected legacy Story Graph workflow to sanitize.");
    }

    expect(sanitized.nodes["story-input"]).toMatchObject({
      nodeId: "story-input",
      status: "ready",
    });
    expect(sanitized.nodes["entity-cards"]).toMatchObject({
      nodeId: "entity-cards",
      source: "system",
      status: "blocked",
      updatedAt: workflow.updatedAt,
    });
    expect(sanitized.nodes["reference-asset-plan"]).toMatchObject({
      nodeId: "reference-asset-plan",
      source: "system",
      status: "blocked",
      updatedAt: workflow.updatedAt,
    });
  });

  it("recomputes the reference asset freeze gate before executing a forged ready gate", async () => {
    const workflow = startStoryGraphWorkflow({
      rawIntent: "A two-shot courier story through a neon market.",
      targetShotCount: 2,
      storyId: "story-forged-ready-gate",
      workflowId: "workflow-forged-ready-gate",
      now: () => "2026-06-14T00:00:00.000Z",
      settingsSnapshot: {
        resourceCandidates: {
          checkpoints: [
            {
              id: "checkpoint-local",
              name: "Local Checkpoint",
              baseModel: "Illustrious",
              modelFileName: "local.safetensors",
            },
          ],
          loras: [],
        },
      },
    });
    const gateResult = workflow.nodes["generation-gate"].result as Record<string, unknown>;
    const forgedReadyWorkflow = {
      ...workflow,
      nodes: {
        ...workflow.nodes,
        "generation-gate": {
          ...workflow.nodes["generation-gate"],
          result: {
            ...gateResult,
            blockingReason: "Confirm generation to start shot graph execution.",
            executionAvailable: true,
            ready: true,
          },
        },
      },
    };
    const executeShot: StoryShotExecutionAdapter = vi.fn();
    let error: unknown;

    try {
      await confirmAndExecuteStoryGeneration({
        executeShot,
        workflow: forgedReadyWorkflow,
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(StoryApiValidationError);
    expect(error).toMatchObject({
      details: {
        blockingReferences: expect.arrayContaining([
          expect.objectContaining({
            entityName: "Main character",
            importance: "required",
            referenceType: "character-face",
            resolutionState: "missing",
          }),
        ]),
      },
      status: 400,
    });
    expect((error as Error).message).toBe("Story reference asset freeze gate is blocked.");
    expect(executeShot).not.toHaveBeenCalled();
  });

  it("generates exactly one reference candidate and keeps the gate blocked until approval", async () => {
    const referenceId = "character-face:main-character";
    const workflow = approveAllRequiredReferences(createReferenceWorkflow(), [referenceId]);
    const generatePlate: StoryReferencePlateGenerationAdapter = vi.fn(() => referenceAdapterResult("face-1.png"));
    const generated = await generateStoryReferencePlate({
      workflow,
      referenceId,
      generatePlate,
      now: () => "2026-06-29T00:02:00.000Z",
    });
    const asset = getReferencePlan(generated).assets.find((candidate) => candidate.id === referenceId);

    expect(generatePlate).toHaveBeenCalledTimes(1);
    expect(asset).toMatchObject({
      resolutionState: "generated",
      approvedAssetReference: undefined,
      candidateAssetReferences: [
        expect.objectContaining({
          filename: "face-1.png",
          source: "generated",
        }),
      ],
    });
    expect(asset?.candidateAssetReferences).toHaveLength(1);
    expect(generated.nodes["generation-gate"].result).toMatchObject({
      ready: false,
      assetFreezeGate: {
        blockingReferences: expect.arrayContaining([
          expect.objectContaining({
            referenceId,
            resolutionState: "generated",
          }),
        ]),
      },
    });
  });

  it("rerolls one new generated candidate per request", async () => {
    const referenceId = "character-face:main-character";
    const workflow = approveAllRequiredReferences(createReferenceWorkflow(), [referenceId]);
    const first = await generateStoryReferencePlate({
      workflow,
      referenceId,
      generatePlate: () => referenceAdapterResult("face-1.png"),
      now: () => "2026-06-29T00:02:00.000Z",
    });
    const second = await generateStoryReferencePlate({
      workflow: first,
      referenceId,
      generatePlate: () => referenceAdapterResult("face-2.png"),
      now: () => "2026-06-29T00:03:00.000Z",
    });
    const asset = getReferencePlan(second).assets.find((candidate) => candidate.id === referenceId);

    expect(asset?.resolutionState).toBe("generated");
    expect(asset?.candidateAssetReferences.map((candidate) => candidate.filename)).toEqual([
      "face-1.png",
      "face-2.png",
    ]);
  });

  it("records failed reference generation as recoverable workflow state", async () => {
    const workflow = approveAllRequiredReferences(createReferenceWorkflow());
    const referenceId = "character-face:main-character";
    const failed = await generateStoryReferencePlate({
      workflow,
      referenceId,
      generatePlate: () => {
        throw Object.assign(new Error("ComfyUI rejected the reference plate."), { code: "comfyui_execution_failed" });
      },
      now: () => "2026-06-29T00:04:00.000Z",
    });
    const asset = getReferencePlan(failed).assets.find((candidate) => candidate.id === referenceId);

    expect(asset).toMatchObject({
      resolutionState: "failed",
      failure: {
        code: "comfyui_execution_failed",
        message: "ComfyUI rejected the reference plate.",
        recoverableActions: ["reroll", "upload", "prompt-only"],
      },
      promptOnlyFallback: undefined,
    });
    expect(failed.nodes["generation-gate"].result).toMatchObject({
      ready: false,
    });
  });

  it("uploads references as candidates and supports direct approval", () => {
    const workflow = approveAllRequiredReferences(createReferenceWorkflow());
    const referenceId = "character-face:main-character";
    const uploaded = uploadStoryReferenceAsset({
      workflow,
      referenceId,
      now: () => "2026-06-29T00:05:00.000Z",
      assetReference: {
        byteLength: 24,
        contentType: "image/webp",
        filename: "uploaded.webp",
        source: "uploaded",
        url: "/api/comfyui/sequence-references/uploaded.webp",
      },
    });
    const approved = approveStoryReferenceAsset({
      workflow: uploaded,
      referenceId,
      now: () => "2026-06-29T00:06:00.000Z",
    });

    expect(getReferencePlan(uploaded).assets.find((asset) => asset.id === referenceId)).toMatchObject({
      resolutionState: "uploaded",
      approvedAssetReference: undefined,
    });
    expect(uploaded.nodes["generation-gate"].result).toMatchObject({ ready: false });
    expect(getReferencePlan(approved).assets.find((asset) => asset.id === referenceId)).toMatchObject({
      resolutionState: "approved",
      approval: {
        approvedBy: "user",
        source: "uploaded",
      },
      approvedAssetReference: expect.objectContaining({
        filename: "uploaded.webp",
      }),
    });
    expect(approved.nodes["generation-gate"].result).toMatchObject({ ready: true });
  });

  it("stales an approved reference and downstream readiness after canonical prompt edits", () => {
    const workflow = approveAllRequiredReferences(createReferenceWorkflow());
    const referenceId = "character-face:main-character";
    const edited = editStoryReferenceCanonicalPrompt({
      workflow,
      referenceId,
      canonicalPrompt: "clean face reference plate, Main character, updated silver hair cue",
      now: () => "2026-06-29T00:07:30.000Z",
    });
    const reference = getReferencePlan(edited).assets.find((asset) => asset.id === referenceId);

    expect(reference).toMatchObject({
      canonicalPrompt: "clean face reference plate, Main character, updated silver hair cue",
      resolutionState: "stale",
      approval: undefined,
      approvedAssetReference: undefined,
    });
    expect(reference?.candidateAssetReferences).toHaveLength(1);
    expect(edited.generationConfirmed).toBe(false);
    expect(edited.nodes["reference-asset-plan"]).toMatchObject({
      source: "manual",
      status: "manual",
    });
    expect(edited.nodes["story-render-plan"].status).toBe("stale");
    expect(edited.nodes["story-consistency-check"].status).toBe("stale");
    expect(edited.nodes["generation-gate"]).toMatchObject({
      source: "system",
      status: "stale",
      result: {
        ready: false,
        assetFreezeGate: {
          blockingReferences: expect.arrayContaining([
            expect.objectContaining({
              referenceId,
              resolutionState: "stale",
            }),
          ]),
        },
      },
    });
  });

  it("does not inject approved Story references into final shot execution", async () => {
    const workflow = approveAllRequiredReferences(createReferenceWorkflow());
    const requests: unknown[] = [];
    const executeShot: StoryShotExecutionAdapter = vi.fn(({ request }) => {
      requests.push(request.request.characterReferences);
      return shotAdapterResult(request.shotId);
    });

    const executed = await confirmAndExecuteStoryGeneration({
      workflow,
      executeShot,
      now: () => "2026-06-29T00:07:00.000Z",
    });

    expect(executed.nodes["story-result-display"].result).toMatchObject({
      status: "complete",
    });
    expect(requests).toEqual([undefined, undefined]);
  });

  it("rejects stored render plans with self or future source-image continuity before execution", async () => {
    const workflow = approveAllRequiredReferences(createReferenceWorkflow());
    const renderPlan = workflow.nodes["story-render-plan"].result as Record<string, unknown>;
    const renderShots = Array.isArray(renderPlan.shots) ? renderPlan.shots : [];
    const tamperedRenderPlan = {
      ...renderPlan,
      shots: renderShots.map((shot, index) =>
        index === 0 && typeof shot === "object" && shot !== null
          ? {
              ...shot,
              locationContinuity: {
                mode: "source-image",
                sourceShotIds: ["shot-1", "shot-2"],
                reason: "Tampered stored plan points at self and a future shot.",
                notes: [],
              },
              sourceShotIds: ["shot-1", "shot-2"],
            }
          : shot,
      ),
    };
    const tamperedWorkflow = {
      ...workflow,
      nodes: {
        ...workflow.nodes,
        "story-render-plan": {
          ...workflow.nodes["story-render-plan"],
          result: tamperedRenderPlan,
          source: "manual" as const,
          status: "manual" as const,
        },
      },
    };
    const executeShot: StoryShotExecutionAdapter = vi.fn();
    let error: unknown;

    try {
      await confirmAndExecuteStoryGeneration({
        executeShot,
        workflow: tamperedWorkflow,
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(StoryApiValidationError);
    expect((error as Error).message).toBe("Story consistency checks must pass before generation.");
    expect(error).toMatchObject({
      details: {
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: "render-source-self",
            shotIds: ["shot-1"],
          }),
          expect.objectContaining({
            code: "render-source-order",
            shotIds: ["shot-1"],
          }),
        ]),
      },
      status: 400,
    });
    expect(executeShot).not.toHaveBeenCalled();
  });
});
