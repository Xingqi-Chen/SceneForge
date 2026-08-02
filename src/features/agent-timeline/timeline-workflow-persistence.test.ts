import { describe, expect, it } from "vitest";

import {
  completeTimelineNode,
  createTimelineNodeError,
  createTimelineWorkflowState,
  markTimelineNodeRunning,
} from "./state";
import {
  createTimelineWorkflowRecord,
  isStoryGraphTimelineWorkflowRecord,
  isSingleImageTimelineWorkflowRecord,
  parseTimelineWorkflowRecordJson,
  sanitizeTimelineWorkflowRecord,
  sanitizeTimelineWorkflowState,
  serializeTimelineWorkflowRecord,
} from "./timeline-workflow-persistence";
import { startStoryGraphWorkflow } from "./story-input";
import { sanitizeRunSceneInputSettingsSnapshot } from "./run-input-settings";
import { createTimelineFinalRequests } from "./t8-node-adapters";
import { resolveTimelineFinalGenerationPolicy, timelineFinalGenerationPolicy } from "./final-generation-policy";
import {
  deriveRepairAttemptId,
  deriveRepairBaseRequestDigest,
  deriveRepairOutputNodeId,
  deriveRepairRequestDigest,
} from "./final-repair";
import type {
  FinalRepairTimelineResult,
  TimelineFinalExecutionRecord,
  TimelineRepairParentBinding,
  TimelineWorkflowState,
} from "./types";

const persistedBalancedFallbackPolicy = resolveTimelineFinalGenerationPolicy({}, "balanced");
const persistedBalancedKreaV2Policy = {
  version: 2,
  resizeMode: "lanczos3-exact",
  preset: "balanced",
  family: "krea2",
  denoise: 0.45,
} as const;

function managedStoredImage(hex: string) {
  const filename = `${hex.repeat(32)}.png`;
  return {
    byteLength: 128,
    contentType: "image/png",
    filename,
    url: `/api/comfyui/generated-images/${filename}`,
  };
}

function createPersistedV2GenerationWorkflow(finalCount = 2) {
  let workflow = createTimelineWorkflowState({
    workflowId: `persisted-v2-${finalCount}`,
    sceneRequest: "A persisted scored-preview Run",
    imageCount: finalCount,
  });
  workflow = completeTimelineNode(workflow, "scene-prompt", {
    positivePrompt: "persisted scene",
    visualStyle: "anime",
  }, "ai");
  workflow = completeTimelineNode(workflow, "character-tags", { items: [] }, "ai");
  workflow = completeTimelineNode(workflow, "character-action", { action: "standing" }, "ai");
  workflow = completeTimelineNode(workflow, "canvas-binding", { spatialSummary: "centered" }, "system");
  workflow = completeTimelineNode(workflow, "resource-recommendation", {
    checkpoint: { resource: { id: "checkpoint-a", modelFileName: "local.safetensors" } },
    loras: [],
  }, "ai");
  workflow = completeTimelineNode(workflow, "parameter-recommendation", {
    width: 1024,
    height: 1024,
    steps: 24,
    cfg: 6,
    samplerName: "euler",
    scheduler: "normal",
    denoise: 1,
    seedPolicy: { mode: "fixed", seed: 100 },
    requestPreview: {
      batchSize: 1,
      checkpointName: "local.safetensors",
      positivePrompt: "persisted scene",
      steps: 24,
      width: 1024,
      height: 1024,
    },
  }, "system");
  const candidateCount = Math.min(8, Math.max(4, finalCount * 2));
  const candidates = Array.from({ length: candidateCount }, (_, index) => ({
    candidateId: `preview-${index + 1}`,
    index,
    seed: 100 + index,
    status: "done" as const,
    promptId: `preview-prompt-${index + 1}`,
    sourceImage: { filename: `preview-output-${index + 1}.png`, nodeId: "9", type: "output" },
    storedImage: managedStoredImage((index + 1).toString(16)),
  }));
  const selected = candidates.slice(0, finalCount);
  const scores = candidates.map((candidate, index) => ({
    candidateId: candidate.candidateId,
    adherence: 100 - index,
    composition: 100 - index,
    anatomy: 100 - index,
    style: 100 - index,
    technical: 100 - index,
    total: 100 - index,
    criticalDefects: [],
    eligible: true,
    visualStyleMatch: true,
    rank: index + 1,
  }));
  const finals = selected.map((candidate, index) => ({
    candidateId: candidate.candidateId,
    seed: candidate.seed,
    rank: index + 1,
    status: "done" as const,
    promptId: `final-prompt-${index + 1}`,
    sourceImage: { filename: `final-output-${index + 1}.png`, nodeId: "9", type: "output" },
    storedImage: managedStoredImage((index + 9).toString(16)),
    previewUpscale: {
      policyVersion: timelineFinalGenerationPolicy.version,
      resizeMode: timelineFinalGenerationPolicy.resizeMode,
      width: 1024,
      height: 1024,
      sourcePreview: candidate.storedImage,
      storedImage: managedStoredImage(["d", "e", "f", "0"][index]!),
    },
    finalPolicy: persistedBalancedFallbackPolicy,
  }));
  workflow = completeTimelineNode(workflow, "preview-execution", {
    baseSeed: 100,
    candidateCount,
    finalCount,
    previewHeight: 768,
    previewWidth: 768,
    previewSteps: 20,
    candidates,
    successfulCount: candidateCount,
    warnings: [],
  }, "system");
  workflow = completeTimelineNode(workflow, "preview-scoring", {
    rubricVersion: 2,
    visualStyle: "anime",
    scores,
    selectedCandidateIds: selected.map((candidate) => candidate.candidateId),
    selectionSource: "ai",
  }, "ai");
  workflow = completeTimelineNode(workflow, "comfyui-execution", {
    completed: true,
    finalCount,
    finals,
    finalPolicy: persistedBalancedFallbackPolicy,
    request: { checkpointName: "local.safetensors", positivePrompt: "persisted scene" },
    warnings: [],
  }, "system");
  workflow = completeTimelineNode(workflow, "result-display", {
    completed: true,
    visualStyle: "anime",
    visualStyleAssessment: "verified",
    image: { ...finals[0]!.sourceImage, url: finals[0]!.storedImage.url },
    images: finals.map((item) => ({ ...item.sourceImage, url: item.storedImage.url })),
    promptId: finals[0]!.promptId,
    sourceImage: finals[0]!.sourceImage,
    sourceImages: finals.map((item) => item.sourceImage),
    storedImage: finals[0]!.storedImage,
    storedImages: finals.map((item) => item.storedImage),
    fallbacks: finals.map((item) => ({
      candidateId: item.candidateId,
      rank: item.rank,
      seed: item.seed,
      storedImage: item.previewUpscale.storedImage,
    })),
    warnings: [],
    finalLinks: finals.map((item) => ({
      candidateId: item.candidateId,
      promptId: item.promptId,
      rank: item.rank,
      seed: item.seed,
    })),
  }, "system");
  return {
    ...workflow,
    generationConfirmed: true,
    nodes: {
      ...workflow.nodes,
      "generation-gate": {
        nodeId: "generation-gate" as const,
        status: "manual" as const,
        source: "manual" as const,
        updatedAt: workflow.updatedAt,
        result: {
          confirmationRequired: false,
          confirmed: true,
          confirmationFingerprint: `hmac-sha256:${"a".repeat(64)}`,
          finalPolicyVersion: timelineFinalGenerationPolicy.version,
          finalRedrawPreset: persistedBalancedFallbackPolicy.preset,
          finalGenerationFamily: persistedBalancedFallbackPolicy.family,
          finalDenoise: persistedBalancedFallbackPolicy.denoise,
          visualStyle: "anime",
        },
      },
    },
  } satisfies TimelineWorkflowState;
}

function createPersistedStagedKreaV2Workflow(finalCount = 1) {
  const raw = JSON.parse(JSON.stringify(
    createPersistedV2GenerationWorkflow(finalCount),
  )) as TimelineWorkflowState;
  raw.workflowId = `persisted-staged-krea-v2-${finalCount}`;
  const sceneInput = raw.nodes["scene-input"].result as Record<string, unknown>;
  sceneInput.promptProfile = "krea2";
  sceneInput.settingsSnapshot = {
    ...((sceneInput.settingsSnapshot as Record<string, unknown> | undefined) ?? {}),
    finalRedrawPreset: "balanced",
    promptProfile: "krea2",
  };
  const parameters = raw.nodes["parameter-recommendation"].result as {
    requestPreview: Record<string, unknown>;
  } & Record<string, unknown>;
  Object.assign(parameters, {
    steps: 8,
    cfg: 1,
    samplerName: "euler",
    scheduler: "simple",
  });
  parameters.requestPreview = {
    ...parameters.requestPreview,
    checkpointName: "krea-2-turbo-unet.safetensors",
    modelBaseModel: "Krea 2",
    modelStorageKind: "diffusion",
    workflowProfile: "krea2",
    steps: 8,
    cfg: 1,
    samplerName: "euler",
    scheduler: "simple",
  };
  const execution = raw.nodes["comfyui-execution"].result as {
    finalPolicy: unknown;
    finals: Array<{
      finalPolicy: unknown;
      previewUpscale: { policyVersion: number };
    }>;
    request: Record<string, unknown>;
  };
  execution.request = {
    batchSize: 1,
    checkpointName: "krea-2-turbo-unet.safetensors",
    cfg: 1,
    denoise: persistedBalancedKreaV2Policy.denoise,
    modelBaseModel: "Krea 2",
    modelStorageKind: "diffusion",
    positivePrompt: "persisted staged Krea v2 scene",
    preview: false,
    samplerName: "euler",
    scheduler: "simple",
    steps: 8,
    workflowProfile: "krea2",
    width: 1024,
    height: 1024,
  };
  execution.finalPolicy = persistedBalancedKreaV2Policy;
  for (const final of execution.finals) {
    final.finalPolicy = persistedBalancedKreaV2Policy;
    final.previewUpscale.policyVersion = persistedBalancedKreaV2Policy.version;
  }
  const gate = raw.nodes["generation-gate"].result as Record<string, unknown>;
  Object.assign(gate, {
    finalPolicyVersion: persistedBalancedKreaV2Policy.version,
    finalRedrawPreset: persistedBalancedKreaV2Policy.preset,
    finalGenerationFamily: persistedBalancedKreaV2Policy.family,
    finalDenoise: persistedBalancedKreaV2Policy.denoise,
  });
  delete gate.finalSteps;
  return raw;
}

type MutablePersistedPreviewScore = Record<string, unknown>;

type MutablePersistedPreviewScoring = {
  eligibleCount?: unknown;
  fallbackCandidateIds?: unknown;
  rubricVersion: unknown;
  scores: MutablePersistedPreviewScore[];
  selectedCandidateIds: unknown[];
  selectionWarning?: unknown;
  selectionSource: unknown;
};

function getMutablePersistedPreviewScoring(workflow: TimelineWorkflowState) {
  return workflow.nodes["preview-scoring"].result as MutablePersistedPreviewScoring;
}

function createPersistedFinalErrorWorkflow(error: {
  code: string;
  message: string;
  details?: unknown;
}) {
  const raw = JSON.parse(JSON.stringify(createPersistedV2GenerationWorkflow(1))) as TimelineWorkflowState;
  const partial = raw.nodes["comfyui-execution"].result as {
    completed: boolean;
    finals: Array<Record<string, unknown>>;
  } & Record<string, unknown>;
  const original = partial.finals[0]!;
  partial.completed = false;
  partial.finals[0] = {
    candidateId: original.candidateId,
    seed: original.seed,
    rank: original.rank,
    status: "error",
    previewUpscale: original.previewUpscale,
    finalPolicy: original.finalPolicy,
    error,
  };
  raw.nodes["comfyui-execution"] = {
    ...raw.nodes["comfyui-execution"],
    status: "error",
    result: undefined,
    error: {
      code: "comfyui_execution_failed",
      message: "0 of 1 final images completed.",
      details: { recoverable: true, partialResult: partial },
    },
  };
  raw.nodes["result-display"] = {
    ...raw.nodes["result-display"],
    status: "blocked",
    result: undefined,
  };
  return raw;
}

const readyStyleReference = {
  status: "ready",
  mode: "ipadapter",
  metadata: {
    byteLength: 1234,
    contentType: "image/png",
    filename: "story-style.png",
    storedFilename: "0123456789abcdef0123456789abcdef.png",
    uploadedAt: "2026-06-14T00:00:00.000Z",
    url: "/api/comfyui/sequence-references/0123456789abcdef0123456789abcdef.png",
    dataUrl: "data:image/png;base64,SHOULD_NOT_PERSIST",
  },
  analysis: {
    analyzedAt: "2026-06-14T00:00:01.000Z",
    model: "vision-model",
    summary: "Soft watercolor anime rendering with pastel highlights.",
    stylePrompt: "soft watercolor anime rendering, clean pencil linework, pastel highlights",
    dataUrl: "data:image/png;base64,SHOULD_NOT_PERSIST",
  },
  ipAdapter: {
    weight: 0.45,
    startPercent: 0,
    endPercent: 1,
  },
  settingsSnapshot: {
    capturedAt: "2026-06-14T00:00:02.000Z",
    checkpointBaseModel: "Illustrious",
    checkpointId: "local-checkpoint",
    modeReason: "Illustrious base models support the sequence-style IPAdapter reference.",
    promptProfile: "illustrious",
    visualStyle: "anime",
  },
  dataUrl: "data:image/png;base64,SHOULD_NOT_PERSIST",
} as const;

describe("timeline workflow persistence", () => {
  it("round-trips environmentAndBackground only inside a new Krea scene result", () => {
    let workflow = createTimelineWorkflowState({
      promptProfile: "krea2",
      sceneRequest: "A courier waits on a rain-dark station platform",
      workflowId: "krea-environment-round-trip",
    });
    workflow = completeTimelineNode(workflow, "scene-prompt", {
      promptProfile: "krea2",
      visualStyle: "anime",
      primaryCharacter: {
        name: "Courier",
        identity: "A focused courier",
        publicFacts: ["blue parcel"],
      },
      sceneIntent: "A courier waits on a rain-dark station platform",
      styleTone: "cinematic",
      setting: "station platform",
      sharedFacts: ["rain"],
      positivePrompt: "A focused courier waits on a rain-dark station platform.",
      negativeSuggestions: ["blur"],
      style: [],
      camera: [],
      lighting: [],
      krea2Sections: {
        subjectMood: "A focused courier waits",
        subjectAttributesAndActions: "holding a blue parcel",
        environmentAndBackground: "rain crosses the station platform beneath a steel canopy",
        visualStyleAndMedium: "cinematic digital photography",
        lightingColorAndTexture: "cool reflections on wet pavement",
        spatialCompositionAndFraming:
          "the courier fills the foreground against a smaller distant platform",
      },
    }, "ai");

    const serialized = serializeTimelineWorkflowRecord(createTimelineWorkflowRecord({
      projectId: "krea-environment-round-trip",
      name: "Krea environment round trip",
      workflow,
      sceneRequest: "A courier waits on a rain-dark station platform",
      selectedPromptProfile: "krea2",
      selectedImageCount: 1,
      selectedNodeId: "scene-prompt",
    }));
    const parsed = parseTimelineWorkflowRecordJson(serialized);

    expect(parsed && isSingleImageTimelineWorkflowRecord(parsed)).toBe(true);
    if (!parsed || !isSingleImageTimelineWorkflowRecord(parsed)) {
      throw new Error("Expected a single-image Krea timeline record.");
    }
    expect(parsed.workflow.nodes["scene-prompt"].result).toMatchObject({
      promptProfile: "krea2",
      krea2Sections: {
        environmentAndBackground:
          "rain crosses the station platform beneath a steel canopy",
      },
    });
    expect(serialized.match(/environmentAndBackground/g)).toHaveLength(1);

    const illustrious = createTimelineWorkflowRecord({
      projectId: "illustrious-no-krea-environment",
      name: "Illustrious scene",
      workflow: completeTimelineNode(createTimelineWorkflowState({
        promptProfile: "illustrious",
        sceneRequest: "A courier portrait",
      }), "scene-prompt", {
        promptProfile: "illustrious",
        positivePrompt: "solo courier portrait",
        visualStyle: "anime",
        illustriousSections: { subjectIdentity: ["solo courier"] },
      }, "ai"),
      sceneRequest: "A courier portrait",
      selectedPromptProfile: "illustrious",
      selectedImageCount: 1,
      selectedNodeId: "scene-prompt",
    });
    expect(serializeTimelineWorkflowRecord(illustrious)).not.toContain(
      "environmentAndBackground",
    );
  });

  it("restores legacy Story Krea profile fields as Illustrious without enabling Run-only behavior", () => {
    const started = startStoryGraphWorkflow({
      rawIntent: "A persisted legacy Story record.",
      settingsSnapshot: { promptProfile: "illustrious" },
      storyId: "story-krea-persistence",
      workflowId: "story-krea-persistence",
    });
    const raw = JSON.parse(JSON.stringify(createTimelineWorkflowRecord({
      workflow: started,
      sceneRequest: "A persisted legacy Story record.",
      selectedPromptProfile: "illustrious",
      selectedImageCount: 1,
      selectedNodeId: "story-input",
    }))) as {
      selectedPromptProfile: unknown;
      workflow: { nodes: { "story-input": { result: { settingsSnapshot: Record<string, unknown> } } } };
    };
    raw.selectedPromptProfile = "krea2";
    raw.workflow.nodes["story-input"].result.settingsSnapshot.promptProfile = "krea2";

    const restored = sanitizeTimelineWorkflowRecord(raw);

    expect(restored && isStoryGraphTimelineWorkflowRecord(restored)).toBe(true);
    if (!restored || !isStoryGraphTimelineWorkflowRecord(restored)) {
      throw new Error("Expected a restored Story workflow.");
    }
    expect(restored.selectedPromptProfile).toBe("illustrious");
    expect((restored.workflow.nodes["story-input"].result as {
      settingsSnapshot?: { promptProfile?: string };
    }).settingsSnapshot?.promptProfile).toBe("illustrious");
  });

  it("marks incomplete legacy Krea direct runs stale and requires reconfirmation", () => {
    const raw = JSON.parse(JSON.stringify(createTimelineWorkflowState({
      promptProfile: "krea2",
      sceneRequest: "A direct Krea render",
      workflowId: "persisted-krea-direct",
    }))) as { nodes: Record<string, Record<string, unknown>> };
    const skippedNodes = [
      "preview-execution",
      "preview-scoring",
      "final-review",
      "final-repair",
      "repair-verification",
    ] as const;
    for (const nodeId of skippedNodes) {
      raw.nodes[nodeId] = {
        ...raw.nodes[nodeId],
        status: "done",
        source: "system",
        result: {
          status: "not-applicable",
          reason: "krea2-direct-txt2img",
          message: `Krea skipped ${nodeId}`,
        },
      };
    }

    const restored = sanitizeTimelineWorkflowState(raw);
    if (!restored || !("scene-input" in restored.nodes)) {
      throw new Error("Expected a single-image Krea workflow.");
    }

    expect((restored.nodes["scene-input"].result as { promptProfile?: string }).promptProfile).toBe("krea2");
    expect(restored.generationConfirmed).toBe(false);
    expect(restored.nodes["generation-gate"]).toMatchObject({
      status: "blocked",
      error: { code: "confirmation_required" },
    });
    for (const nodeId of skippedNodes) {
      expect(restored.nodes[nodeId]).toMatchObject({
        status: "stale",
        result: undefined,
      });
    }
  });

  it("keeps completed legacy Krea direct output readable without reopening generation", () => {
    const raw = JSON.parse(JSON.stringify(createPersistedV2GenerationWorkflow(1))) as {
      nodes: Record<string, { result?: Record<string, unknown>; source?: unknown; status?: unknown }>;
    };
    const sceneInput = raw.nodes["scene-input"]?.result;
    const parameters = raw.nodes["parameter-recommendation"]?.result;
    const execution = raw.nodes["comfyui-execution"]?.result;
    if (!sceneInput || !parameters || !execution) {
      throw new Error("Expected a complete legacy workflow fixture.");
    }
    sceneInput.promptProfile = "krea2";
    sceneInput.settingsSnapshot = {
      ...(sceneInput.settingsSnapshot as Record<string, unknown>),
      promptProfile: "krea2",
    };
    parameters.requestPreview = {
      ...(parameters.requestPreview as Record<string, unknown>),
      checkpointName: "krea-2-turbo-unet.safetensors",
      modelBaseModel: "Krea 2",
      modelStorageKind: "diffusion",
      workflowProfile: "krea2",
    };
    execution.request = {
      checkpointName: "krea-2-turbo-unet.safetensors",
      modelBaseModel: "Krea 2",
      modelStorageKind: "diffusion",
      positivePrompt: "persisted scene",
      workflowProfile: "krea2",
    };
    delete execution.finalPolicy;
    execution.finals = (execution.finals as Array<Record<string, unknown>>).map((entry) => {
      const final = { ...entry };
      delete final.previewUpscale;
      delete final.finalPolicy;
      return final;
    });
    for (const nodeId of [
      "preview-execution",
      "preview-scoring",
      "final-review",
      "final-repair",
      "repair-verification",
    ]) {
      raw.nodes[nodeId] = {
        ...raw.nodes[nodeId],
        status: "done",
        source: "system",
        result: {
          status: "not-applicable",
          reason: "krea2-direct-txt2img",
          message: `Legacy Krea skipped ${nodeId}`,
        },
      } as { result?: Record<string, unknown> };
    }

    const restored = sanitizeTimelineWorkflowState(raw);
    if (!restored || !("scene-input" in restored.nodes)) {
      throw new Error("Expected a completed single-image Krea workflow.");
    }

    expect(restored.generationConfirmed).toBe(true);
    expect(restored.nodes["comfyui-execution"]).toMatchObject({ status: "done" });
    expect(restored.nodes["result-display"]).toMatchObject({
      status: "done",
      result: { completed: true },
    });
    expect(restored.nodes["generation-gate"].status).not.toBe("blocked");
  });

  it("keeps a completed staged Krea v2 result and its linked fallback safely displayable", () => {
    const restored = sanitizeTimelineWorkflowState(
      createPersistedStagedKreaV2Workflow(1),
    ) as TimelineWorkflowState;
    const execution = restored.nodes["comfyui-execution"].result as {
      finalPolicy?: Record<string, unknown>;
      finals: Array<{
        finalPolicy?: Record<string, unknown>;
        previewUpscale?: { policyVersion?: number; sourcePreview?: unknown; storedImage?: unknown };
        status: string;
      }>;
    };

    expect(restored.legacyDirectProvenance).toBeUndefined();
    expect(restored.generationConfirmed).toBe(true);
    expect(restored.nodes["generation-gate"].status).not.toBe("blocked");
    expect(restored.nodes["comfyui-execution"].status).toBe("done");
    expect(execution.finalPolicy).toEqual(persistedBalancedKreaV2Policy);
    expect(execution.finalPolicy).not.toHaveProperty("steps");
    expect(execution.finals).toEqual([
      expect.objectContaining({
        status: "done",
        finalPolicy: persistedBalancedKreaV2Policy,
        previewUpscale: expect.objectContaining({
          policyVersion: 2,
          sourcePreview: expect.any(Object),
          storedImage: expect.any(Object),
        }),
      }),
    ]);
    expect(restored.nodes["result-display"]).toMatchObject({
      status: "done",
      result: {
        completed: true,
        fallbacks: [expect.objectContaining({ candidateId: "preview-1" })],
        storedImages: [expect.any(Object)],
      },
    });
  });

  it("requires reconfirmation for an incomplete confirmed staged Krea v2 Run", () => {
    const raw = createPersistedStagedKreaV2Workflow(1);
    raw.nodes["result-display"] = {
      ...raw.nodes["result-display"],
      status: "blocked",
      result: undefined,
    };

    const restored = sanitizeTimelineWorkflowState(raw) as TimelineWorkflowState;

    expect(restored.generationConfirmed).toBe(false);
    expect(restored.nodes["generation-gate"]).toMatchObject({
      status: "blocked",
      error: { code: "confirmation_required" },
    });
    for (const nodeId of [
      "preview-execution",
      "preview-scoring",
      "comfyui-execution",
      "final-review",
      "final-repair",
      "repair-verification",
      "result-display",
    ] as const) {
      expect(restored.nodes[nodeId].status, nodeId).toBe("blocked");
    }
    const serialized = JSON.stringify(restored);
    expect(serialized).not.toContain('"finalSteps"');
    expect(serialized).toContain('"finalPolicyVersion":2');
    expect(serialized).toContain('"finalDenoise":0.45');
  });

  it("fails closed when staged Krea artifacts are rebound to v3 without a complete same-policy contract", () => {
    const raw = JSON.parse(JSON.stringify(createPersistedV2GenerationWorkflow(1))) as {
      nodes: Record<string, { result?: Record<string, unknown>; source?: unknown; status?: unknown }>;
    };
    const sceneInput = raw.nodes["scene-input"]?.result;
    const execution = raw.nodes["comfyui-execution"]?.result;
    const gate = raw.nodes["generation-gate"]?.result;
    if (!sceneInput || !execution || !gate) {
      throw new Error("Expected a completed staged workflow fixture.");
    }
    const kreaPolicy = resolveTimelineFinalGenerationPolicy({ workflowProfile: "krea2" }, "balanced");
    sceneInput.promptProfile = "krea2";
    sceneInput.settingsSnapshot = {
      ...(sceneInput.settingsSnapshot as Record<string, unknown>),
      promptProfile: "krea2",
    };
    execution.request = {
      checkpointName: "krea-2-turbo-unet.safetensors",
      modelBaseModel: "Krea 2",
      modelStorageKind: "diffusion",
      positivePrompt: "persisted staged Krea scene",
      workflowProfile: "krea2",
    };
    execution.finalPolicy = kreaPolicy;
    execution.finals = (execution.finals as Array<Record<string, unknown>>).map((final) => ({
      ...final,
      finalPolicy: kreaPolicy,
    }));
    Object.assign(gate, {
      finalPolicyVersion: kreaPolicy.version,
      finalRedrawPreset: kreaPolicy.preset,
      finalGenerationFamily: "krea2",
      finalSteps: kreaPolicy.steps,
      finalDenoise: kreaPolicy.denoise,
    });
    for (const nodeId of ["final-review", "final-repair", "repair-verification"] as const) {
      raw.nodes[nodeId] = {
        ...raw.nodes[nodeId],
        status: "done",
        source: "system",
        result: {
          status: "not-applicable",
          reason: "krea2-t42-unavailable",
          message: `T41 Krea skipped ${nodeId}`,
        },
      };
    }

    const restored = sanitizeTimelineWorkflowState(raw) as TimelineWorkflowState;
    expect(restored.generationConfirmed).toBe(false);
    expect(restored.nodes["generation-gate"]).toMatchObject({
      status: "blocked",
      error: { code: "confirmation_required" },
    });
    expect(restored.nodes["preview-execution"].status).toBe("blocked");
    expect(restored.nodes["preview-scoring"].status).toBe("blocked");
    expect(restored.nodes["comfyui-execution"].status).toBe("blocked");
    expect(restored.nodes["final-review"].status).toBe("blocked");
    expect(restored.nodes["final-repair"].status).toBe("blocked");
    expect(restored.nodes["repair-verification"].status).toBe("blocked");
    expect(restored.nodes["result-display"].status).toBe("blocked");
  });

  it.each([
    ["parameter dimensions", { height: 1024, requestHeight: 1024, requestWidth: 1024, width: 1025 }],
    ["request preview dimensions", { height: 1024, requestHeight: 1023, requestWidth: 1024, width: 1024 }],
  ])("fails closed for persisted staged Krea %s that are not exact multiples of 16", (_label, dimensions) => {
    const raw = JSON.parse(JSON.stringify(createTimelineWorkflowState({
      promptProfile: "krea2",
      sceneRequest: "A direct Krea render",
      workflowId: "persisted-krea-dimensions",
    }))) as { nodes: Record<string, Record<string, unknown>> };
    raw.nodes["parameter-recommendation"] = {
      ...raw.nodes["parameter-recommendation"],
      status: "done",
      source: "system",
      result: {
        width: dimensions.width,
        height: dimensions.height,
        requestPreview: {
          checkpointName: "krea-2-turbo-unet.safetensors",
          workflowProfile: "krea2",
          modelBaseModel: "Krea 2",
          modelStorageKind: "diffusion",
          positivePrompt: "a quiet station",
          width: dimensions.requestWidth,
          height: dimensions.requestHeight,
        },
      },
    };

    const restored = sanitizeTimelineWorkflowState(raw);
    if (!restored || !("scene-input" in restored.nodes)) {
      throw new Error("Expected a single-image Krea workflow.");
    }
    const parameters = restored.nodes["parameter-recommendation"].result as {
      width?: number;
      height?: number;
      requestPreview?: { width?: number; height?: number };
    };

    expect(restored.generationConfirmed).toBe(false);
    expect(restored.nodes["parameter-recommendation"]).toMatchObject({
      status: "error",
      error: {
        code: "timeline_request_invalid",
        message: "Persisted Krea 2 Turbo dimensions must be exact multiples of 16. Regenerate parameters before continuing.",
      },
    });
    expect(parameters).toMatchObject({
      width: dimensions.width,
      height: dimensions.height,
      requestPreview: { width: dimensions.requestWidth, height: dimensions.requestHeight },
    });
    for (const nodeId of [
      "generation-gate",
      "preview-execution",
      "preview-scoring",
      "comfyui-execution",
      "final-review",
      "final-repair",
      "repair-verification",
      "result-display",
    ] as const) {
      expect(restored.nodes[nodeId]).toMatchObject({ status: "stale", result: undefined });
    }
  });

  function createPersistedRepairWorkflow() {
    let workflow: TimelineWorkflowState = createPersistedV2GenerationWorkflow(1);
    const sceneInput = workflow.nodes["scene-input"].result as Record<string, unknown>;
    workflow.nodes["scene-input"].result = {
      ...sceneInput,
      settingsSnapshot: {
        ...((sceneInput.settingsSnapshot as Record<string, unknown> | undefined) ?? {}),
        automaticLocalRepair: true,
      },
    };
    (workflow.nodes["generation-gate"].result as Record<string, unknown>).automaticLocalRepairAuthorized = true;
    const final = (workflow.nodes["comfyui-execution"].result as {
      finals: TimelineFinalExecutionRecord[];
    }).finals[0]!;
    if (!final.storedImage || !final.previewUpscale) {
      throw new Error("Persisted Repair fixture requires a completed Final and Preview Upscale.");
    }
    const scores = { adherence: 80, composition: 80, anatomy: 80, style: 80, technical: 80, total: 80 };
    const findings = [
      { operation: "pose", severity: "none", scope: "pair", introducedByFinal: false, description: "Stable." },
      { operation: "contact", severity: "major", scope: "final", introducedByFinal: true, description: "Hand misses cup." },
      { operation: "object-count", severity: "none", scope: "pair", introducedByFinal: false, description: "Stable." },
      { operation: "composition-consistency", severity: "none", scope: "pair", introducedByFinal: false, description: "Stable." },
    ] satisfies TimelineRepairParentBinding["reviewedFindings"];
    const targets = [{ operation: "contact" as const, severity: "major" as const, description: "Hand misses cup." }];
    workflow = completeTimelineNode(workflow, "final-review", {
      reviewVersion: 1,
      status: "reviewed",
      visualStyle: "anime",
      pairs: [{
        candidateId: final.candidateId,
        rank: final.rank,
        seed: final.seed,
        variants: { final: final.storedImage, previewUpscale: final.previewUpscale.storedImage },
        scores: { final: scores, previewUpscale: scores },
        findings,
        recommendedVariant: "preview-upscale",
        defaultVariant: "preview-upscale",
        userSelectedVariant: "repair",
        visualStyleMatch: {
          final: true,
          previewUpscale: true,
        },
      }],
    }, "ai");
    const parent = {
      finalStoredImage: final.storedImage,
      reviewUpdatedAt: workflow.nodes["final-review"].updatedAt,
      reviewedFindings: findings,
      reviewedTargets: targets,
      visualStyle: "anime",
    } satisfies TimelineRepairParentBinding;
    const diagnosis = {
      shapes: [{ type: "rect" as const, x: 0.4, y: 0.4, width: 0.1, height: 0.1 }],
      growMaskBy: 16,
      faceDetailerEnabled: true,
      handDetailerEnabled: false,
    };
    const repairExecution = workflow.nodes["comfyui-execution"].result as Parameters<typeof deriveRepairOutputNodeId>[0];
    const repairAttemptId = deriveRepairAttemptId(
      workflow.workflowId,
      final.candidateId,
      parent,
      deriveRepairBaseRequestDigest(repairExecution, final)!,
    );
    const repairOutputNodeId = deriveRepairOutputNodeId(
      repairExecution,
      final,
      diagnosis,
      repairAttemptId,
    )!;
    workflow = completeTimelineNode(workflow, "final-repair", {
      repairVersion: 1,
      authorized: true,
      completed: true,
      pairs: [{
        candidateId: final.candidateId,
        rank: final.rank,
        seed: final.seed,
        status: "repaired",
        targets,
        parent,
        diagnosis: {
          ...diagnosis,
          rawResponse: "PRIVATE_RAW_DIAGNOSIS",
        },
        mask: {
          provenance: "structured-diagnosis",
          refinement: { status: "skipped", reason: "sam2-unavailable" },
          coverageBeforeGrowth: 0.01,
          coverageAfterGrowth: 0.02,
          growMaskBy: 16,
          width: final.previewUpscale.width,
          height: final.previewUpscale.height,
          storedImage: { ...managedStoredImage("3"), absolutePath: "C:\\PRIVATE\\mask.png", dataUrl: "data:image/png;base64,SECRET" },
        },
        requestPolicy: {
          version: 1,
          sourceVariant: "final",
          requestLocalFaceDetailer: true,
          requestLocalHandDetailer: false,
        },
        promptId: "repair-prompt-1",
        sourceImage: { filename: "repair-output.png", nodeId: repairOutputNodeId, type: "output" },
        storedImage: { ...managedStoredImage("c"), dataUrl: "data:image/png;base64,SECRET" },
        attempt: {
          attemptId: repairAttemptId,
          status: "stored",
          promptId: "repair-prompt-1",
          outputNodeId: repairOutputNodeId,
          requestDigest: deriveRepairRequestDigest(
            repairExecution,
            final,
            diagnosis,
            repairAttemptId,
          )!,
          sourceImage: { filename: "repair-output.png", nodeId: repairOutputNodeId, type: "output" },
          storedImage: { ...managedStoredImage("c"), dataUrl: "data:image/png;base64,SECRET" },
        },
      }],
    }, "system");
    workflow = completeTimelineNode(workflow, "repair-verification", {
      verificationVersion: 1,
      status: "verified",
      visualStyle: "anime",
      pairs: [{
        candidateId: final.candidateId,
        repairParent: (workflow.nodes["final-repair"].result as FinalRepairTimelineResult).pairs[0]!.parent!,
        repairStoredImage: (workflow.nodes["final-repair"].result as FinalRepairTimelineResult).pairs[0]!.storedImage!,
        scores: {
          final: scores,
          repair: { adherence: 82, composition: 82, anatomy: 82, style: 82, technical: 82, total: 82 },
        },
        targetedDefectsResolved: true,
        newMajorOrBlockingIssue: false,
        findings: findings.map((finding) => finding.operation === "contact"
          ? { ...finding, severity: "none", scope: "pair", introducedByFinal: false, description: "Resolved." }
          : finding),
        recommended: true,
        visualStyleMatch: true,
        rationale: "Repair resolved the target.",
        rawResponse: "PRIVATE_RAW_VERIFICATION",
      }],
    }, "ai");
    return workflow;
  }

  it("round-trips safe repair, verification, and explicit promotion without mutating Composer settings", () => {
    const workflow = createPersistedRepairWorkflow();
    const settingsBefore = JSON.stringify((workflow.nodes["scene-input"].result as Record<string, unknown>).settingsSnapshot);
    const serialized = serializeTimelineWorkflowRecord(createTimelineWorkflowRecord({
      projectId: "t38c-repair-persistence",
      name: "Repair persistence",
      workflow,
      sceneRequest: "A persisted repaired Run",
      selectedPromptProfile: "illustrious",
      selectedImageCount: 1,
      selectedNodeId: "result-display",
    }));
    const restored = parseTimelineWorkflowRecordJson(serialized);

    expect(restored && isSingleImageTimelineWorkflowRecord(restored)).toBe(true);
    if (!restored || !isSingleImageTimelineWorkflowRecord(restored)) throw new Error("Expected repaired Run record.");
    expect(restored.workflow.nodes["final-repair"]).toMatchObject({
      status: "done",
      result: {
        authorized: true,
        pairs: [{
          status: "repaired",
          requestPolicy: { requestLocalFaceDetailer: true, requestLocalHandDetailer: false },
          mask: { provenance: "structured-diagnosis", coverageAfterGrowth: 0.02 },
        }],
      },
    });
    expect(restored.workflow.nodes["repair-verification"]).toMatchObject({
      status: "done",
      result: { status: "verified", pairs: [{ recommended: true }] },
    });
    expect(restored.workflow.nodes["final-review"].result).toMatchObject({
      pairs: [{ userSelectedVariant: "repair" }],
    });
    expect(JSON.stringify((restored.workflow.nodes["scene-input"].result as Record<string, unknown>).settingsSnapshot))
      .toBe(settingsBefore);
    expect(serialized).not.toContain("PRIVATE_");
    expect(serialized).not.toContain("data:image");
    expect(serialized).not.toContain("C:\\\\PRIVATE");
  });

  it("canonicalizes a reordered workflow Repair attempt through the shared sanitizer", () => {
    const raw = JSON.parse(JSON.stringify(createPersistedRepairWorkflow())) as TimelineWorkflowState;
    const repair = raw.nodes["final-repair"].result as FinalRepairTimelineResult;
    const original = structuredClone(repair.pairs[0]!.attempt!);
    repair.pairs[0]!.attempt = {
      storedImage: {
        url: original.storedImage!.url,
        filename: original.storedImage!.filename,
        contentType: original.storedImage!.contentType,
        byteLength: original.storedImage!.byteLength,
        token: "sk-secret-attempt",
      },
      sourceImage: {
        type: original.sourceImage!.type,
        nodeId: original.sourceImage!.nodeId,
        filename: original.sourceImage!.filename,
        dataUrl: "data:image/png;base64,PRIVATE_ATTEMPT_IMAGE",
      },
      outputNodeId: original.outputNodeId,
      requestDigest: original.requestDigest,
      promptId: original.promptId,
      status: original.status,
      attemptId: original.attemptId,
      custom: { absolutePath: "C:\\Users\\PRIVATE\\attempt.json", prompt: "PRIVATE_ATTEMPT_PROMPT" },
    } as never;

    const restored = sanitizeTimelineWorkflowState(raw) as TimelineWorkflowState;
    const restoredAttempt = (restored.nodes["final-repair"].result as FinalRepairTimelineResult).pairs[0]!.attempt;
    const serialized = JSON.stringify(restored);
    const expected = {
      attemptId: original.attemptId,
      status: original.status,
      promptId: original.promptId,
      outputNodeId: original.outputNodeId,
      requestDigest: original.requestDigest,
      sourceImage: original.sourceImage,
      storedImage: {
        byteLength: original.storedImage!.byteLength,
        contentType: original.storedImage!.contentType,
        filename: original.storedImage!.filename,
        url: original.storedImage!.url,
      },
    };

    expect(restored.nodes["comfyui-execution"].status).toBe("done");
    expect(restored.nodes["final-review"]).toMatchObject({
      status: "done",
      result: { pairs: [{ userSelectedVariant: "repair" }] },
    });
    expect(restoredAttempt).toEqual(expected);
    expect(Object.keys(restoredAttempt!)).toEqual([
      "attemptId",
      "status",
      "promptId",
      "outputNodeId",
      "requestDigest",
      "sourceImage",
      "storedImage",
    ]);
    expect(serialized).not.toMatch(/PRIVATE|data:image|sk-secret|absolutePath|custom/);
  });

  it.each([
    ["queued state retaining output and stored references", (attempt: Record<string, unknown>) => {
      attempt.status = "queued";
    }],
    ["missing stored-state source reference", (attempt: Record<string, unknown>) => {
      delete attempt.sourceImage;
    }],
    ["unsafe output-node identifier", (attempt: Record<string, unknown>) => {
      attempt.outputNodeId = "9/../../private";
    }],
    ["noncanonical managed-image reference", (attempt: Record<string, unknown>) => {
      (attempt.storedImage as Record<string, unknown>).url = "https://private.example/repair.png";
    }],
  ] as const)("fails closed on a persisted Repair attempt with %s while preserving Preview and Final", (_name, mutate) => {
    const raw = JSON.parse(JSON.stringify(createPersistedRepairWorkflow())) as TimelineWorkflowState;
    const repair = raw.nodes["final-repair"].result as FinalRepairTimelineResult;
    mutate(repair.pairs[0]!.attempt as unknown as Record<string, unknown>);
    const expectedPreview = structuredClone(raw.nodes["preview-execution"].result);
    const expectedFinal = structuredClone(raw.nodes["comfyui-execution"].result);

    const restored = sanitizeTimelineWorkflowState(raw) as TimelineWorkflowState;

    expect(restored.nodes["preview-execution"].result).toEqual(expectedPreview);
    expect(restored.nodes["comfyui-execution"].status).toBe("done");
    expect(restored.nodes["comfyui-execution"].result).toEqual(expectedFinal);
    expect(restored.nodes["final-review"]).toMatchObject({
      status: "done",
      result: { pairs: [{ userSelectedVariant: "preview-upscale" }] },
    });
    expect(restored.nodes["final-repair"]).toMatchObject({
      status: "error",
      error: { code: "node_output_invalid", details: { recoverable: true } },
    });
    expect(restored.nodes["repair-verification"]).toMatchObject({
      status: "done",
      result: { status: "skipped", pairs: [] },
    });
  });

  it.each([
    ["filename", (sourceImage: Record<string, unknown>) => {
      sourceImage.filename = "different-repair-output.png";
    }],
    ["nodeId", (sourceImage: Record<string, unknown>) => {
      sourceImage.nodeId = "different-source";
    }],
  ] as const)(
    "demotes a persisted Repair whose top-level sourceImage %s differs from its canonical attempt source",
    (_name, mutate) => {
      const raw = JSON.parse(JSON.stringify(createPersistedRepairWorkflow())) as TimelineWorkflowState;
      const repair = raw.nodes["final-repair"].result as FinalRepairTimelineResult;
      mutate(repair.pairs[0]!.sourceImage as unknown as Record<string, unknown>);
      const expectedPreview = structuredClone(raw.nodes["preview-execution"].result);
      const expectedFinal = structuredClone(raw.nodes["comfyui-execution"].result);

      const restored = sanitizeTimelineWorkflowState(raw) as TimelineWorkflowState;

      expect(restored.nodes["preview-execution"].result).toEqual(expectedPreview);
      expect(restored.nodes["comfyui-execution"]).toMatchObject({
        status: "done",
        result: expectedFinal,
      });
      expect(restored.nodes["final-review"]).toMatchObject({
        status: "done",
        result: { pairs: [{ userSelectedVariant: "preview-upscale" }] },
      });
      expect(restored.nodes["final-repair"]).toMatchObject({
        status: "error",
        error: { code: "node_output_invalid", details: { recoverable: true } },
      });
      expect(restored.nodes["repair-verification"]).toMatchObject({
        status: "done",
        result: { status: "skipped", pairs: [] },
      });
    },
  );

  it.each([
    ["queued", false, false],
    ["output-ready", true, false],
    ["stored", true, true],
  ] as const)(
    "fails closed on a persisted %s Repair attempt whose safe output node does not match the rebuilt workflow",
    (status, includeSource, includeStored) => {
      const raw = JSON.parse(JSON.stringify(createPersistedRepairWorkflow())) as TimelineWorkflowState;
      const repair = raw.nodes["final-repair"].result as FinalRepairTimelineResult;
      const original = repair.pairs[0]!.attempt!;
      repair.pairs[0]!.status = "failed";
      repair.pairs[0]!.attempt = {
        attemptId: original.attemptId,
        status,
        promptId: original.promptId,
        outputNodeId: "different-output",
        ...(includeSource
          ? { sourceImage: { filename: "repair-output.png", nodeId: "different-output", type: "output" } }
          : {}),
        ...(includeStored ? { storedImage: original.storedImage } : {}),
      };
      const expectedPreview = structuredClone(raw.nodes["preview-execution"].result);
      const expectedFinal = structuredClone(raw.nodes["comfyui-execution"].result);

      const restored = sanitizeTimelineWorkflowState(raw) as TimelineWorkflowState;

      expect(restored.nodes["preview-execution"].result).toEqual(expectedPreview);
      expect(restored.nodes["comfyui-execution"]).toMatchObject({
        status: "done",
        result: expectedFinal,
      });
      expect(restored.nodes["final-review"]).toMatchObject({
        status: "done",
        result: { pairs: [{ userSelectedVariant: "preview-upscale" }] },
      });
      expect(restored.nodes["final-repair"]).toMatchObject({
        status: "error",
        error: { code: "node_output_invalid" },
      });
      expect(restored.nodes["repair-verification"]).toMatchObject({
        status: "done",
        result: { status: "skipped", pairs: [] },
      });
    },
  );

  it.each(["output-ready", "stored"] as const)(
    "fails closed on a persisted %s Repair attempt whose source node differs from its output node",
    (status) => {
      const raw = JSON.parse(JSON.stringify(createPersistedRepairWorkflow())) as TimelineWorkflowState;
      const repair = raw.nodes["final-repair"].result as FinalRepairTimelineResult;
      repair.pairs[0]!.status = "failed";
      repair.pairs[0]!.attempt = {
        ...repair.pairs[0]!.attempt!,
        status,
        sourceImage: {
          ...repair.pairs[0]!.attempt!.sourceImage!,
          nodeId: "different-source",
        },
        ...(status === "output-ready" ? { storedImage: undefined } : {}),
      };
      const expectedPreview = structuredClone(raw.nodes["preview-execution"].result);
      const expectedFinal = structuredClone(raw.nodes["comfyui-execution"].result);

      const restored = sanitizeTimelineWorkflowState(raw) as TimelineWorkflowState;

      expect(restored.nodes["preview-execution"].result).toEqual(expectedPreview);
      expect(restored.nodes["comfyui-execution"]).toMatchObject({
        status: "done",
        result: expectedFinal,
      });
      expect(restored.nodes["final-review"]).toMatchObject({
        status: "done",
        result: { pairs: [{ userSelectedVariant: "preview-upscale" }] },
      });
      expect(restored.nodes["final-repair"]).toMatchObject({
        status: "error",
        error: { code: "node_output_invalid" },
      });
      expect(restored.nodes["repair-verification"]).toMatchObject({
        status: "done",
        result: { status: "skipped", pairs: [] },
      });
    },
  );

  it("fails closed on tampered repair linkage while preserving independently valid Preview and Final", () => {
    const raw = JSON.parse(JSON.stringify(createPersistedRepairWorkflow())) as TimelineWorkflowState;
    const repair = raw.nodes["final-repair"].result as { pairs: Array<{ mask: { width: number } }> };
    repair.pairs[0]!.mask.width = 2048;

    const restored = sanitizeTimelineWorkflowState(raw) as TimelineWorkflowState;

    expect(restored.nodes["comfyui-execution"].status).toBe("done");
    expect(restored.nodes["final-review"]).toMatchObject({
      status: "done",
      result: { pairs: [{ userSelectedVariant: "preview-upscale" }] },
    });
    expect(restored.nodes["final-repair"]).toMatchObject({
      status: "done",
      result: { authorized: false, pairs: [{ status: "skipped", skipReason: "repair-disabled" }] },
    });
    expect(restored.nodes["repair-verification"]).toMatchObject({
      status: "done",
      result: { status: "skipped", pairs: [] },
    });
  });

  it("fails closed on a path-unsafe persisted mask and removes stale Repair promotion/verification", () => {
    const raw = JSON.parse(JSON.stringify(createPersistedRepairWorkflow())) as TimelineWorkflowState;
    const repair = raw.nodes["final-repair"].result as {
      pairs: Array<{ mask: { storedImage: { filename: string; url: string } } }>;
    };
    repair.pairs[0]!.mask.storedImage.filename = "..\\PRIVATE\\mask.png";
    repair.pairs[0]!.mask.storedImage.url = "/api/comfyui/generated-images/..%2FPRIVATE%2Fmask.png";

    const restored = sanitizeTimelineWorkflowState(raw) as TimelineWorkflowState;

    expect(restored.nodes["comfyui-execution"].status).toBe("done");
    expect(restored.nodes["final-review"]).toMatchObject({
      status: "done",
      result: { pairs: [{ userSelectedVariant: "preview-upscale" }] },
    });
    expect(restored.nodes["final-repair"]).toMatchObject({
      status: "error",
      error: { code: "node_output_invalid", details: { recoverable: true } },
    });
    expect(restored.nodes["repair-verification"]).toMatchObject({
      status: "done",
      result: { status: "skipped", pairs: [] },
    });
  });

  it.each([
    "parent Final",
    "review timestamp",
    "review findings",
    "review targets",
  ])("fails closed when persisted Repair changes its exact %s binding", (field) => {
    const raw = JSON.parse(JSON.stringify(createPersistedRepairWorkflow())) as TimelineWorkflowState;
    const repair = raw.nodes["final-repair"].result as {
      pairs: Array<{ parent: {
        finalStoredImage: { filename: string; url: string };
        reviewUpdatedAt: string;
        reviewedFindings: Array<{ description: string }>;
        reviewedTargets: Array<{ description: string }>;
      } }>;
    };
    const parent = repair.pairs[0]!.parent;
    if (field === "parent Final") {
      parent.finalStoredImage = managedStoredImage("d");
    } else if (field === "review timestamp") {
      parent.reviewUpdatedAt = "2026-07-22T12:34:56.000Z";
    } else if (field === "review findings") {
      parent.reviewedFindings[1]!.description = "Tampered finding.";
    } else {
      parent.reviewedTargets[0]!.description = "Tampered target.";
    }

    const restored = sanitizeTimelineWorkflowState(raw) as TimelineWorkflowState;

    expect(restored.nodes["comfyui-execution"].status).toBe("done");
    expect(restored.nodes["final-review"].result).toMatchObject({
      pairs: [{ userSelectedVariant: "preview-upscale" }],
    });
    if (field === "review targets") {
      expect(restored.nodes["final-repair"]).toMatchObject({
        status: "error",
        error: { code: "node_output_invalid" },
      });
    } else {
      expect(restored.nodes["final-repair"].result).toMatchObject({
        authorized: false,
        pairs: [{ status: "skipped", skipReason: "repair-disabled" }],
      });
    }
    expect(restored.nodes["repair-verification"].result).toMatchObject({ status: "skipped", pairs: [] });
  });

  it("fails closed when a persisted Repair attempt no longer identifies its recorded prompt", () => {
    const raw = JSON.parse(JSON.stringify(createPersistedRepairWorkflow())) as TimelineWorkflowState;
    const repair = raw.nodes["final-repair"].result as {
      pairs: Array<{ attempt: { promptId: string } }>;
    };
    repair.pairs[0]!.attempt.promptId = "other-safe-prompt";

    const restored = sanitizeTimelineWorkflowState(raw) as TimelineWorkflowState;

    expect(restored.nodes["comfyui-execution"].status).toBe("done");
    expect(restored.nodes["final-review"].result).toMatchObject({
      pairs: [{ userSelectedVariant: "preview-upscale" }],
    });
    expect(restored.nodes["final-repair"]).toMatchObject({
      status: "error",
      error: { code: "node_output_invalid" },
    });
    expect(restored.nodes["repair-verification"].result).toMatchObject({ status: "skipped", pairs: [] });
  });

  it("downgrades a syntactically valid Repair attempt digest that does not match its exact workflow binding", () => {
    const raw = JSON.parse(JSON.stringify(createPersistedRepairWorkflow())) as TimelineWorkflowState;
    const repair = raw.nodes["final-repair"].result as {
      pairs: Array<{ attempt: { attemptId: string } }>;
    };
    repair.pairs[0]!.attempt.attemptId = `sha256:${"b".repeat(64)}`;

    const restored = sanitizeTimelineWorkflowState(raw) as TimelineWorkflowState;

    expect(restored.nodes["comfyui-execution"].status).toBe("done");
    expect(restored.nodes["final-repair"]).toMatchObject({
      status: "done",
      result: {
        authorized: false,
        pairs: [{ status: "skipped", skipReason: "repair-disabled" }],
      },
    });
    expect(restored.nodes["repair-verification"].result).toMatchObject({ status: "skipped", pairs: [] });
    expect(restored.nodes["final-review"].result).toMatchObject({
      pairs: [{ userSelectedVariant: "preview-upscale" }],
    });
  });

  it("serializes Repair errors through a fixed safe allowlist instead of raw filesystem or payload text", () => {
    const workflow = createPersistedRepairWorkflow();
    const pair = (workflow.nodes["final-repair"].result as FinalRepairTimelineResult).pairs[0]!;
    pair.error = createTimelineNodeError(
      "image_storage_failed",
      "C:\\Users\\PRIVATE\\repair.png /var/private/repair.png data:image/png;base64,PRIVATE_IMAGE PRIVATE_PROMPT sk-secret-value",
      {
        stage: "repair-storage",
        recoverable: true,
        absolutePath: "C:\\Users\\PRIVATE\\repair.png",
        payload: "data:image/png;base64,PRIVATE_IMAGE",
        prompt: "PRIVATE_PROMPT",
        apiKey: "sk-secret-value",
      },
    );

    const serialized = serializeTimelineWorkflowRecord(createTimelineWorkflowRecord({
      workflow,
      sceneRequest: "A persisted repaired Run",
      selectedPromptProfile: "illustrious",
      selectedImageCount: 1,
      selectedNodeId: "result-display",
      outputDisplayModes: {},
    }));

    expect(serialized).toContain("A managed Repair image could not be stored safely.");
    expect(serialized).toContain("\"stage\": \"repair-storage\"");
    expect(serialized).not.toContain("C:\\\\Users\\\\PRIVATE");
    expect(serialized).not.toContain("/var/private");
    expect(serialized).not.toContain("data:image");
    expect(serialized).not.toContain("PRIVATE_IMAGE");
    expect(serialized).not.toContain("PRIVATE_PROMPT");
    expect(serialized).not.toContain("sk-secret-value");
  });

  it.each([
    ["diagnosis-outcome", "diagnosis", "llm_upstream"],
    ["sam2-outcome", "mask", "comfyui_execution_failed"],
  ] as const)(
    "preserves closed %s manual-recovery state without a retry stage",
    (stage, retryStage, code) => {
      const raw = JSON.parse(JSON.stringify(createPersistedRepairWorkflow())) as TimelineWorkflowState;
      const pair = (raw.nodes["final-repair"].result as FinalRepairTimelineResult).pairs[0]!;
      pair.status = "failed";
      pair.skipReason = "repair-failed";
      pair.retryStage = retryStage;
      pair.error = createTimelineNodeError(
        code,
        "PRIVATE upstream outcome text",
        { recoverable: false, stage, token: "sk-secret-value" },
      );
      delete pair.attempt;
      delete pair.mask;
      delete pair.promptId;
      delete pair.sourceImage;
      delete pair.storedImage;
      delete pair.requestPolicy;

      const restored = sanitizeTimelineWorkflowState(raw) as TimelineWorkflowState;
      const restoredPair = (restored.nodes["final-repair"].result as FinalRepairTimelineResult).pairs[0]!;
      const serialized = JSON.stringify(restored);

      expect(restoredPair).toMatchObject({
        status: "failed",
        error: {
          code,
          details: { recoverable: false, stage },
        },
      });
      expect(restoredPair.retryStage).toBeUndefined();
      expect(serialized).not.toMatch(/PRIVATE|sk-secret/);
    },
  );

  it.each(["final-repair", "repair-verification"] as const)(
    "normalizes unsafe node-level %s errors through a closed allowlist",
    (nodeId) => {
      const raw = JSON.parse(JSON.stringify(createPersistedRepairWorkflow())) as TimelineWorkflowState;
      raw.nodes[nodeId].status = "error";
      raw.nodes[nodeId].error = {
        code: "custom_private_code",
        message: "C:\\Users\\PRIVATE\\node.png /var/private/node.png data:image/png;base64,PRIVATE_IMAGE PRIVATE_PROMPT sk-secret-value",
        details: {
          recoverable: true,
          name: "PrivateFilesystemError",
          absolutePath: "C:\\Users\\PRIVATE\\node.png",
          payload: "data:image/png;base64,PRIVATE_IMAGE",
          prompt: "PRIVATE_PROMPT",
          token: "sk-secret-value",
        },
      } as never;

      const restored = sanitizeTimelineWorkflowState(raw) as TimelineWorkflowState;
      const serialized = JSON.stringify(restored);

      expect(restored.nodes[nodeId].error).toMatchObject({
        code: nodeId === "final-repair" ? "comfyui_execution_failed" : "timeline_node_failed",
        details: { recoverable: true },
      });
      expect(serialized).not.toContain("custom_private_code");
      expect(serialized).not.toContain("PrivateFilesystemError");
      expect(serialized).not.toContain("C:\\\\Users\\\\PRIVATE");
      expect(serialized).not.toContain("/var/private");
      expect(serialized).not.toContain("data:image");
      expect(serialized).not.toContain("PRIVATE_PROMPT");
      expect(serialized).not.toContain("sk-secret-value");
    },
  );

  it("normalizes an unsafe failed verification-result error through the verification allowlist", () => {
    const raw = JSON.parse(JSON.stringify(createPersistedRepairWorkflow())) as TimelineWorkflowState;
    raw.nodes["repair-verification"].result = {
      verificationVersion: 1,
      status: "failed",
      pairs: [],
      error: {
        code: "custom_private_code",
        message: "C:\\Users\\PRIVATE\\verify.png /var/private/verify.png data:image/png;base64,PRIVATE_IMAGE PRIVATE_PROMPT sk-secret-value",
        details: {
          recoverable: true,
          name: "PrivateVerificationError",
          payload: "data:image/png;base64,PRIVATE_IMAGE",
          token: "sk-secret-value",
        },
      },
    } as never;

    const restored = sanitizeTimelineWorkflowState(raw) as TimelineWorkflowState;
    const serialized = JSON.stringify(restored);

    expect(restored.nodes["repair-verification"].result).toMatchObject({
      status: "failed",
      error: {
        code: "timeline_node_failed",
        message: "Repair verification could not be completed safely.",
        details: { recoverable: true },
      },
    });
    expect(serialized).not.toContain("custom_private_code");
    expect(serialized).not.toContain("PrivateVerificationError");
    expect(serialized).not.toContain("C:\\\\Users\\\\PRIVATE");
    expect(serialized).not.toContain("/var/private");
    expect(serialized).not.toContain("data:image");
    expect(serialized).not.toContain("PRIVATE_PROMPT");
    expect(serialized).not.toContain("sk-secret-value");
  });

  it.each([
    {
      location: "final-repair node",
      prepare(workflow: TimelineWorkflowState) {
        workflow.nodes["final-repair"].status = "error";
        workflow.nodes["final-repair"].error = {
          code: "custom_private_code",
          message: "C:\\Users\\PRIVATE\\repair.png data:image/png;base64,PRIVATE_IMAGE PRIVATE_PROMPT",
          details: {
            recoverable: true,
            stage: "checkpoint-read",
            name: "PrivateFilesystemError",
            token: "sk-secret-value",
          },
        } as never;
      },
      read(workflow: TimelineWorkflowState) {
        return workflow.nodes["final-repair"].error;
      },
      expected: {
        code: "comfyui_execution_failed",
        message: "Repair checkpoint state could not be read safely. This Repair remains closed.",
        details: { recoverable: false, stage: "checkpoint-read" },
      },
    },
    {
      location: "repair-verification node",
      prepare(workflow: TimelineWorkflowState) {
        workflow.nodes["repair-verification"].status = "error";
        workflow.nodes["repair-verification"].error = {
          code: "custom_private_code",
          message: "/var/private/verify.png data:image/png;base64,PRIVATE_IMAGE PRIVATE_PROMPT",
          details: {
            recoverable: true,
            name: "PrivateVerificationError",
            absolutePath: "C:\\Users\\PRIVATE\\verify.png",
            token: "sk-secret-value",
          },
        } as never;
      },
      read(workflow: TimelineWorkflowState) {
        return workflow.nodes["repair-verification"].error;
      },
      expected: {
        code: "timeline_node_failed",
        message: "Repair verification could not be completed safely.",
        details: { recoverable: true },
      },
    },
    {
      location: "failed verification result",
      prepare(workflow: TimelineWorkflowState) {
        workflow.nodes["repair-verification"].result = {
          verificationVersion: 1,
          status: "failed",
          pairs: [],
          error: {
            code: "llm_config",
            message: "/var/private/config.json data:image/png;base64,PRIVATE_IMAGE PRIVATE_PROMPT",
            details: {
              recoverable: true,
              name: "PrivateConfigError",
              absolutePath: "C:\\Users\\PRIVATE\\config.json",
              token: "sk-secret-value",
            },
          },
        } as never;
      },
      read(workflow: TimelineWorkflowState) {
        return (workflow.nodes["repair-verification"].result as {
          error: unknown;
        }).error;
      },
      expected: {
        code: "llm_config",
        message: "Repair verification configuration is unavailable. Preview and Final remain selectable.",
        details: { recoverable: true },
      },
    },
  ])("sanitizes and serializes the unsafe $location error with bounded metadata", ({ prepare, read, expected }) => {
    const raw = createPersistedRepairWorkflow();
    prepare(raw);

    const serialized = serializeTimelineWorkflowRecord(createTimelineWorkflowRecord({
      workflow: raw,
      sceneRequest: "A persisted repaired Run",
      selectedPromptProfile: "illustrious",
      selectedImageCount: 1,
      selectedNodeId: "result-display",
      outputDisplayModes: {},
    }));
    const restored = parseTimelineWorkflowRecordJson(serialized);

    expect(restored && isSingleImageTimelineWorkflowRecord(restored)).toBe(true);
    if (!restored || !isSingleImageTimelineWorkflowRecord(restored)) throw new Error("Expected repaired Run record.");
    expect(read(restored.workflow)).toEqual(expected);
    expect(Object.keys((read(restored.workflow) as { details: Record<string, unknown> }).details)).toEqual(
      Object.keys(expected.details),
    );
    expect(serialized).not.toMatch(
      /custom_private_code|PrivateFilesystemError|PrivateVerificationError|PrivateConfigError|C:\\\\Users\\\\PRIVATE|\/var\/private|data:image|PRIVATE_PROMPT|sk-secret-value|absolutePath|token/,
    );
  });

  it.each(["Repair parent", "Repair image"])("rejects verification with a changed exact %s binding", (field) => {
    const raw = JSON.parse(JSON.stringify(createPersistedRepairWorkflow())) as TimelineWorkflowState;
    const verification = raw.nodes["repair-verification"].result as {
      pairs: Array<{
        repairParent: { finalStoredImage: { filename: string; url: string } };
        repairStoredImage: { filename: string; url: string };
      }>;
    };
    if (field === "Repair parent") {
      verification.pairs[0]!.repairParent.finalStoredImage = managedStoredImage("d");
    } else {
      verification.pairs[0]!.repairStoredImage = managedStoredImage("d");
    }

    const restored = sanitizeTimelineWorkflowState(raw) as TimelineWorkflowState;

    expect(restored.nodes["final-repair"].result).toMatchObject({ pairs: [{ status: "repaired" }] });
    expect(restored.nodes["repair-verification"].result).toMatchObject({ status: "skipped", pairs: [] });
    expect(restored.nodes["final-review"].result).toMatchObject({
      pairs: [{ userSelectedVariant: "preview-upscale" }],
    });
  });

  it("reconciles a persisted Repair selection when verification failed", () => {
    const raw = JSON.parse(JSON.stringify(createPersistedRepairWorkflow())) as TimelineWorkflowState;
    raw.nodes["repair-verification"].result = {
      verificationVersion: 1,
      status: "failed",
      pairs: [],
      visualStyle: "anime",
      error: createTimelineNodeError("llm_upstream", "Repair verification failed.", { recoverable: true }),
    };

    const restored = sanitizeTimelineWorkflowState(raw) as TimelineWorkflowState;

    expect(restored.nodes["final-repair"].result).toMatchObject({ pairs: [{ status: "repaired" }] });
    expect(restored.nodes["repair-verification"].result).toMatchObject({ status: "failed", pairs: [] });
    expect(restored.nodes["final-review"].result).toMatchObject({
      pairs: [{ userSelectedVariant: "preview-upscale" }],
    });
  });

  it("round-trips Final review variants, local defaults, and explicit user selection without unsafe payloads", () => {
    let workflow: TimelineWorkflowState = createPersistedV2GenerationWorkflow(2);
    const finals = (workflow.nodes["comfyui-execution"].result as {
      finals: Array<{
        candidateId: string;
        rank: number;
        seed: number;
        storedImage: ReturnType<typeof managedStoredImage>;
        previewUpscale: { storedImage: ReturnType<typeof managedStoredImage> };
      }>;
    }).finals;
    const displayResult = workflow.nodes["result-display"].result;
    workflow = completeTimelineNode(workflow, "final-review", {
      reviewVersion: 1,
      status: "reviewed",
      visualStyle: "anime",
      pairs: finals.map((final, index) => ({
        candidateId: final.candidateId,
        rank: final.rank,
        seed: final.seed,
        variants: {
          final: { ...final.storedImage, dataUrl: "data:image/png;base64,SECRET_BYTES", absolutePath: "C:\\PRIVATE\\final.png" },
          previewUpscale: final.previewUpscale.storedImage,
        },
        scores: {
          final: { adherence: 80, composition: 80, anatomy: 80, style: 80, technical: 80, total: 80 },
          previewUpscale: { adherence: 70, composition: 70, anatomy: 70, style: 70, technical: 70, total: 70 },
        },
        findings: [
          { operation: "pose", severity: index === 0 ? "major" : "none", scope: index === 0 ? "final" : "pair", introducedByFinal: index === 0, description: "Pose comparison." },
          { operation: "contact", severity: "none", scope: "pair", introducedByFinal: false, description: "Contact comparison." },
          { operation: "object-count", severity: "none", scope: "pair", introducedByFinal: false, description: "Object count comparison." },
          { operation: "composition-consistency", severity: "none", scope: "pair", introducedByFinal: false, description: "Composition comparison." },
        ],
        rationale: "Safe normalized rationale.",
        recommendedVariant: index === 0 ? "preview-upscale" : "final",
        defaultVariant: index === 0 ? "preview-upscale" : "final",
        ...(index === 0 ? { userSelectedVariant: "final" } : {}),
        visualStyleMatch: {
          final: true,
          previewUpscale: true,
        },
        rawResponse: "PRIVATE_RAW_RESPONSE",
        prompt: "PRIVATE_PROMPT",
      })),
      rawResponse: "PRIVATE_RAW_RESPONSE",
    }, "ai");
    workflow = completeTimelineNode(workflow, "result-display", displayResult, "system");

    const serialized = serializeTimelineWorkflowRecord(createTimelineWorkflowRecord({
      projectId: "t38b-review-persistence",
      name: "Final review persistence",
      workflow,
      sceneRequest: "A persisted scored-preview Run",
      selectedPromptProfile: "illustrious",
      selectedImageCount: 2,
      selectedNodeId: "result-display",
      outputDisplayModes: { "final-review": "visual", "result-display": "visual" },
    }));
    const restored = parseTimelineWorkflowRecordJson(serialized);

    expect(restored && isSingleImageTimelineWorkflowRecord(restored)).toBe(true);
    if (!restored || !isSingleImageTimelineWorkflowRecord(restored)) throw new Error("Expected Run record.");
    expect(restored.workflow.nodes["final-review"]).toMatchObject({
      status: "done",
      result: {
        reviewVersion: 1,
        status: "reviewed",
        pairs: [
          {
            candidateId: "preview-1",
            recommendedVariant: "preview-upscale",
            defaultVariant: "preview-upscale",
            userSelectedVariant: "final",
          },
          {
            candidateId: "preview-2",
            recommendedVariant: "final",
            defaultVariant: "final",
          },
        ],
      },
    });
    expect(serialized).not.toContain("SECRET_BYTES");
    expect(serialized).not.toContain("PRIVATE_RAW_RESPONSE");
    expect(serialized).not.toContain("PRIVATE_PROMPT");
    expect(serialized).not.toContain("C:\\\\PRIVATE");
  });

  it("rejects tampered Final-review linkage against verified generated variants", () => {
    const raw = JSON.parse(JSON.stringify(createPersistedV2GenerationWorkflow(1))) as TimelineWorkflowState;
    const final = (raw.nodes["comfyui-execution"].result as {
      finals: Array<{
        candidateId: string;
        rank: number;
        seed: number;
        storedImage: ReturnType<typeof managedStoredImage>;
        previewUpscale: { storedImage: ReturnType<typeof managedStoredImage> };
      }>;
    }).finals[0]!;
    raw.nodes["final-review"] = {
      nodeId: "final-review",
      status: "done",
      source: "ai",
      updatedAt: raw.updatedAt,
      result: {
        reviewVersion: 1,
        status: "unavailable",
        pairs: [{
          candidateId: final.candidateId,
          rank: final.rank,
          seed: final.seed,
          variants: {
            final: managedStoredImage("c"),
            previewUpscale: final.previewUpscale.storedImage,
          },
          recommendedVariant: null,
          defaultVariant: "final",
        }],
      },
    };

    const restored = sanitizeTimelineWorkflowState(raw) as TimelineWorkflowState;

    expect(restored.nodes["final-review"]).toMatchObject({
      status: "error",
      error: { code: "image_storage_invalid", details: { recoverable: true } },
    });
  });

  it("restores a completed legacy workflow without initiating review and keeps its managed variants visible", () => {
    const raw = JSON.parse(JSON.stringify(createPersistedV2GenerationWorkflow(1))) as TimelineWorkflowState;
    delete (raw.nodes as Partial<TimelineWorkflowState["nodes"]>)["final-review"];
    delete (raw.nodes as Partial<TimelineWorkflowState["nodes"]>)["final-repair"];
    delete (raw.nodes as Partial<TimelineWorkflowState["nodes"]>)["repair-verification"];

    const restored = sanitizeTimelineWorkflowState(raw) as TimelineWorkflowState;

    expect(restored.nodes["comfyui-execution"].status).toBe("done");
    expect(restored.nodes["final-review"]).toMatchObject({
      status: "done",
      source: "system",
      result: {
        reviewVersion: 1,
        status: "unavailable",
        pairs: [{ recommendedVariant: null, defaultVariant: "final" }],
      },
    });
    expect(restored.nodes["final-repair"]).toMatchObject({
      status: "done",
      result: { authorized: false, pairs: [{ status: "skipped", skipReason: "repair-disabled" }] },
    });
    expect(restored.nodes["repair-verification"]).toMatchObject({
      status: "done",
      result: { status: "skipped", pairs: [] },
    });
    expect(restored.nodes["result-display"].status).toBe("done");
  });

  it("keeps completed pre-policy results displayable without authorizing their old confirmation", () => {
    const raw = JSON.parse(JSON.stringify(createPersistedV2GenerationWorkflow(1))) as TimelineWorkflowState;
    const execution = raw.nodes["comfyui-execution"].result as {
      finalPolicy?: unknown;
      finals: Array<{ previewUpscale?: unknown }>;
    };
    const gate = raw.nodes["generation-gate"].result as Record<string, unknown>;
    const display = raw.nodes["result-display"].result as { fallbacks?: unknown };
    delete execution.finalPolicy;
    execution.finals.forEach((final) => delete final.previewUpscale);
    delete gate.finalPolicyVersion;
    delete gate.finalRedrawPreset;
    delete gate.finalGenerationFamily;
    delete gate.finalDenoise;
    delete display.fallbacks;

    const restored = sanitizeTimelineWorkflowState(raw) as TimelineWorkflowState;

    expect(restored.nodes["comfyui-execution"].status).toBe("done");
    expect(restored.nodes["result-display"].status).toBe("done");
  });

  it.each([
    ["missing execution policy", (execution: Record<string, unknown>) => {
      delete execution.finalPolicy;
    }],
    ["tampered execution denoise", (execution: Record<string, unknown>) => {
      (execution.finalPolicy as Record<string, unknown>).denoise = 0.99;
    }],
    ["missing candidate policy", (execution: Record<string, unknown>) => {
      delete ((execution.finals as Array<Record<string, unknown>>)[0]!).finalPolicy;
    }],
    ["cross-preset candidate policy", (execution: Record<string, unknown>) => {
      const candidatePolicy = ((execution.finals as Array<Record<string, unknown>>)[0]!).finalPolicy as Record<string, unknown>;
      candidatePolicy.preset = "strong";
      candidatePolicy.denoise = 0.55;
    }],
    ...(["__proto__", "constructor", "toString", 1] as const).map((preset) => [
      `invalid aggregate preset ${String(preset)}`,
      (execution: Record<string, unknown>) => {
        (execution.finalPolicy as Record<string, unknown>).preset = preset;
      },
    ] as const),
    ...(["__proto__", "constructor", "toString", 1] as const).map((preset) => [
      `invalid candidate preset ${String(preset)}`,
      (execution: Record<string, unknown>) => {
        const candidatePolicy = ((execution.finals as Array<Record<string, unknown>>)[0]!).finalPolicy as Record<string, unknown>;
        candidatePolicy.preset = preset;
      },
    ] as const),
  ] as const)("fails closed for a current policy-v2 result with %s", (_case, mutate) => {
    const raw = JSON.parse(JSON.stringify(createPersistedV2GenerationWorkflow(1))) as TimelineWorkflowState;
    mutate(raw.nodes["comfyui-execution"].result as Record<string, unknown>);

    const restored = sanitizeTimelineWorkflowState(raw) as TimelineWorkflowState;

    expect(restored.nodes["comfyui-execution"]).toMatchObject({
      status: "error",
      error: { code: "image_storage_invalid", details: { recoverable: true } },
    });
    expect(restored.nodes["result-display"].status).toBe("error");
  });

  it("persists only normalized managed Preview-upscale linkage and strips embedded payloads", () => {
    const raw = JSON.parse(JSON.stringify(createPersistedV2GenerationWorkflow(1))) as TimelineWorkflowState;
    const execution = raw.nodes["comfyui-execution"].result as {
      finals: Array<{ previewUpscale: Record<string, unknown> }>;
    };
    const artifact = execution.finals[0]!.previewUpscale;
    artifact.imageBytes = "data:image/png;base64,SECRET_FALLBACK_BYTES";
    artifact.absolutePath = "C:\\private\\fallback.png";
    artifact.workflow = { "9": { class_type: "SaveImage" } };
    artifact.apiKey = "SECRET_FALLBACK_KEY";
    artifact.sourcePreview = {
      ...(artifact.sourcePreview as object),
      dataUrl: "data:image/png;base64,SECRET_SOURCE_BYTES",
      path: "C:\\private\\preview.png",
    };
    artifact.storedImage = {
      ...(artifact.storedImage as object),
      bytes: [1, 2, 3],
      path: "C:\\private\\formal.png",
    };

    const restored = sanitizeTimelineWorkflowState(raw) as TimelineWorkflowState;
    const serialized = JSON.stringify(restored);

    expect(restored.nodes["comfyui-execution"]).toMatchObject({
      status: "done",
      result: {
        finalPolicy: { version: timelineFinalGenerationPolicy.version, resizeMode: "lanczos3-exact" },
        finals: [expect.objectContaining({
          status: "done",
          previewUpscale: {
            policyVersion: timelineFinalGenerationPolicy.version,
            resizeMode: "lanczos3-exact",
            width: 1024,
            height: 1024,
            sourcePreview: expect.objectContaining({ filename: expect.stringMatching(/^[a-f0-9]{32}\.png$/) }),
            storedImage: expect.objectContaining({ filename: expect.stringMatching(/^[a-f0-9]{32}\.png$/) }),
          },
        })],
      },
    });
    expect(serialized).not.toContain("SECRET_FALLBACK_BYTES");
    expect(serialized).not.toContain("SECRET_SOURCE_BYTES");
    expect(serialized).not.toContain("SECRET_FALLBACK_KEY");
    expect(serialized).not.toContain("C:\\\\private");
    expect(serialized).not.toContain("class_type");
    expect(serialized).not.toContain('"bytes"');
  });

  it("persists only the signed Krea adapter descriptor and Final digest, never its transport image", () => {
    const raw = JSON.parse(JSON.stringify(createPersistedV2GenerationWorkflow(1))) as TimelineWorkflowState;
    const execution = raw.nodes["comfyui-execution"].result as {
      finals: Array<Record<string, unknown>>;
      request: Record<string, unknown>;
    };
    execution.finals[0]!.finalRequestDigest = `sha256:${"b".repeat(64)}`;
    execution.request = {
      checkpointName: "krea-2-turbo-unet.safetensors",
      modelBaseModel: "Krea 2",
      modelStorageKind: "diffusion",
      workflowProfile: "krea2",
      positivePrompt: "persisted Krea scene",
      sourceImageDataUrl: "data:image/png;base64,PRIVATE_FINAL_SOURCE",
      imageName: "sceneforge-final-source.png",
      outputPrefix: "C:\\private\\sceneforge-final",
      krea2StyleReference: {
        imageName: "sceneforge-krea-style-transport.png",
        loraName: "krea2_style_reference.safetensors",
        weight: 0.45,
        startPercent: 0,
        endPercent: 1,
      },
      krea2StyleReferenceDescriptor: {
        version: 1,
        referenceDigest: `sha256:${"a".repeat(64)}`,
        loraName: "krea2_style_reference.safetensors",
        weight: 0.45,
        startPercent: 0,
        endPercent: 1,
      },
    };

    const restored = sanitizeTimelineWorkflowState(raw) as TimelineWorkflowState;
    const result = restored.nodes["comfyui-execution"].result as {
      finals: Array<{ finalRequestDigest?: string }>;
      request: Record<string, unknown>;
    };
    const serialized = JSON.stringify(result);

    expect(result.finals[0]?.finalRequestDigest).toBe(`sha256:${"b".repeat(64)}`);
    expect(result.request.krea2StyleReferenceDescriptor).toEqual({
      version: 1,
      referenceDigest: `sha256:${"a".repeat(64)}`,
      loraName: "krea2_style_reference.safetensors",
      weight: 0.45,
      startPercent: 0,
      endPercent: 1,
    });
    expect(result.request).not.toHaveProperty("krea2StyleReference");
    expect(result.request).not.toHaveProperty("sourceImageDataUrl");
    expect(result.request).not.toHaveProperty("imageName");
    expect(result.request).not.toHaveProperty("outputPrefix");
    expect(serialized).not.toContain("sceneforge-krea-style-transport.png");
    expect(serialized).not.toContain("PRIVATE_FINAL_SOURCE");
    expect(serialized).not.toContain("C:\\\\private");
  });

  it("round-trips an active workflow record without preserving secrets", () => {
    let workflow = createTimelineWorkflowState({
      workflowId: "timeline-persisted",
      sceneRequest: "A glass greenhouse command deck",
      promptProfile: "anima",
      imageCount: 3,
      now: () => "2026-06-05T00:00:00.000Z",
    });
    workflow = completeTimelineNode(
      workflow,
      "resource-recommendation",
      {
        checkpoint: {
          resource: {
            id: "checkpoint-a",
            apiKey: "should-not-persist",
            modelFileName: "checkpoint.safetensors",
          },
          reason: "Local checkpoint",
        },
        loras: [],
      },
      "ai",
      { now: () => "2026-06-05T00:01:00.000Z" },
    );

    const record = createTimelineWorkflowRecord({
      projectId: "workflow-round-trip",
      name: "  Glass greenhouse project  ",
      workflow,
      sceneRequest: "A glass greenhouse command deck",
      selectedPromptProfile: "anima",
      selectedImageCount: 3,
      selectedNodeId: "resource-recommendation",
      outputDisplayModes: {
        "resource-recommendation": "visual",
      },
    });
    const serialized = serializeTimelineWorkflowRecord(record);

    expect(serialized).not.toContain("should-not-persist");
    expect(serialized).toContain("[redacted]");

    const parsed = parseTimelineWorkflowRecordJson(serialized);
    expect(parsed && isSingleImageTimelineWorkflowRecord(parsed)).toBe(true);

    if (!parsed || !isSingleImageTimelineWorkflowRecord(parsed)) {
      throw new Error("Expected a single-image timeline record.");
    }

    expect(parsed).toMatchObject({
      kind: "sceneforge-timeline-workflow",
      version: 1,
      projectId: "workflow-round-trip",
      name: "Glass greenhouse project",
      sceneRequest: "A glass greenhouse command deck",
      selectedPromptProfile: "anima",
      selectedImageCount: 3,
      selectedNodeId: "resource-recommendation",
      outputDisplayModes: {
        "resource-recommendation": "visual",
      },
      workflow: {
        workflowId: "timeline-persisted",
        workflowMode: "single-image",
      },
    });
    expect(parsed?.workflow.nodes["resource-recommendation"].result).toMatchObject({
      checkpoint: {
        resource: {
          apiKey: "[redacted]",
        },
      },
    });
  });

  it("round-trips Run resources, parameters, and detailers for active or named workflows", () => {
    const workflow = createTimelineWorkflowState({
      workflowId: "timeline-run-controls",
      sceneRequest: "A styled greenhouse command deck",
      promptProfile: "illustrious",
      settingsSnapshot: sanitizeRunSceneInputSettingsSnapshot({
        finalRedrawPreset: "strong",
        promptProfile: "illustrious",
        stylePalette: {
          checkpointId: "checkpoint-a",
          loras: [
            { id: "lora-a", enabled: true, strengthModel: 0.64, strengthClip: 0.43 },
          ],
          parameters: {
            width: 960,
            height: 1280,
            steps: 38,
            cfg: 5.75,
            samplerName: "euler",
            scheduler: "normal",
            denoise: 0.84,
            seed: 9876,
          },
        },
        detailers: {
          faceDetailer: {
            enabled: true,
            detectorModelName: "bbox/custom-face.pt",
            steps: 18,
            denoise: 0.42,
          },
          handDetailer: {
            enabled: false,
            detectorModelName: "bbox/custom-hand.pt",
            steps: 21,
          },
        },
        styleReference: readyStyleReference,
      }),
      now: () => "2026-07-18T00:00:00.000Z",
    });
    const serialized = serializeTimelineWorkflowRecord(createTimelineWorkflowRecord({
      projectId: "named-run-controls",
      name: "Named Run controls",
      workflow,
      sceneRequest: "A styled greenhouse command deck",
      selectedPromptProfile: "illustrious",
      selectedImageCount: 3,
      selectedNodeId: "scene-input",
    }));
    const parsed = parseTimelineWorkflowRecordJson(serialized);

    expect(parsed && isSingleImageTimelineWorkflowRecord(parsed)).toBe(true);
    if (!parsed || !isSingleImageTimelineWorkflowRecord(parsed)) {
      throw new Error("Expected a single-image timeline record.");
    }

    expect(parsed.projectId).toBe("named-run-controls");
    expect(parsed.name).toBe("Named Run controls");
    expect(parsed.workflow.nodes["scene-input"].result).toMatchObject({
      settingsSnapshot: {
        finalRedrawPreset: "strong",
        stylePalette: {
          checkpointId: "checkpoint-a",
          loras: [
            { id: "lora-a", enabled: true, strengthModel: 0.64, strengthClip: 0.43 },
          ],
          parameters: {
            width: 960,
            height: 1280,
            steps: 38,
            cfg: 5.75,
            samplerName: "euler",
            scheduler: "normal",
            denoise: 0.84,
            seed: 9876,
          },
        },
        detailers: {
          faceDetailer: {
            enabled: true,
            detectorModelName: "bbox/custom-face.pt",
            steps: 18,
            denoise: 0.42,
          },
          handDetailer: {
            enabled: false,
            detectorModelName: "bbox/custom-hand.pt",
            steps: 21,
          },
        },
        styleReference: {
          status: "ready",
          mode: "ipadapter",
          metadata: {
            filename: "story-style.png",
            storedFilename: "0123456789abcdef0123456789abcdef.png",
            url: "/api/comfyui/sequence-references/0123456789abcdef0123456789abcdef.png",
          },
          analysis: {
            stylePrompt: "soft watercolor anime rendering, clean pencil linework, pastel highlights",
          },
          ipAdapter: { weight: 0.45, startPercent: 0, endPercent: 1 },
        },
      },
    });
    expect(serialized).not.toContain("SHOULD_NOT_PERSIST");
  });

  it("restores legacy Run records with automatic resources and both detailers disabled", () => {
    const workflow = createTimelineWorkflowState({
      workflowId: "timeline-legacy-run-controls",
      sceneRequest: "A legacy Run record",
    });
    const raw = JSON.parse(serializeTimelineWorkflowRecord(createTimelineWorkflowRecord({
      workflow,
      sceneRequest: "A legacy Run record",
      selectedPromptProfile: "illustrious",
      selectedImageCount: 1,
      selectedNodeId: "scene-input",
    }))) as {
      workflow: { nodes: Record<string, { result?: { settingsSnapshot?: unknown } }> };
    };
    delete raw.workflow.nodes["scene-input"].result?.settingsSnapshot;

    const restored = sanitizeTimelineWorkflowRecord(raw);
    expect(restored && isSingleImageTimelineWorkflowRecord(restored)).toBe(true);
    if (!restored || !isSingleImageTimelineWorkflowRecord(restored)) {
      throw new Error("Expected a single-image timeline record.");
    }

    expect(restored.workflow.nodes["scene-input"].result).toMatchObject({
      settingsSnapshot: {
        detailers: {
          faceDetailer: { enabled: false },
          handDetailer: { enabled: false },
        },
      },
    });
    expect(restored.workflow.nodes["scene-input"].result).not.toMatchObject({
      settingsSnapshot: { stylePalette: expect.anything() },
    });
    expect(restored.workflow.nodes["scene-input"].result).not.toMatchObject({
      settingsSnapshot: { styleReference: expect.anything() },
    });
  });

  it("sanitizes crafted Run style-reference payloads in active and named workflow records", () => {
    const workflow = createTimelineWorkflowState({
      workflowId: "timeline-run-style-crafted",
      sceneRequest: "A crafted Run style reference",
      promptProfile: "illustrious",
      settingsSnapshot: sanitizeRunSceneInputSettingsSnapshot({
        promptProfile: "illustrious",
        styleReference: readyStyleReference,
      }),
    });
    const raw = JSON.parse(serializeTimelineWorkflowRecord(createTimelineWorkflowRecord({
      projectId: "named-run-style",
      name: "Named Run style",
      workflow,
      sceneRequest: "A crafted Run style reference",
      selectedPromptProfile: "illustrious",
      selectedImageCount: 4,
      selectedNodeId: "scene-input",
    }))) as {
      workflow: { nodes: Record<string, { result: { settingsSnapshot: Record<string, unknown> } }> };
    };
    const styleReference = raw.workflow.nodes["scene-input"].result.settingsSnapshot.styleReference as Record<string, unknown>;
    styleReference.dataUrl = "data:image/png;base64,SECRET_IMAGE";
    styleReference.bytes = [1, 2, 3];
    styleReference.apiKey = "SECRET_KEY";
    styleReference.cache = { path: "C:\\private\\style-cache" };
    styleReference.metadata = {
      ...(styleReference.metadata as Record<string, unknown>),
      filename: "..\\private\\style.png",
      url: "https://attacker.invalid/style.png",
    };

    const restored = sanitizeTimelineWorkflowRecord(raw);
    expect(restored && isSingleImageTimelineWorkflowRecord(restored)).toBe(true);
    if (!restored || !isSingleImageTimelineWorkflowRecord(restored)) {
      throw new Error("Expected a single-image timeline record.");
    }
    const restoredStyle = (restored.workflow.nodes["scene-input"].result as {
      settingsSnapshot?: { styleReference?: { metadata?: Record<string, unknown> } };
    }).settingsSnapshot?.styleReference;
    expect(restoredStyle?.metadata).toMatchObject({
      storedFilename: "0123456789abcdef0123456789abcdef.png",
      url: "/api/comfyui/sequence-references/0123456789abcdef0123456789abcdef.png",
    });
    expect(restoredStyle?.metadata).not.toHaveProperty("filename");
    const serialized = JSON.stringify(restoredStyle);
    expect(serialized).not.toContain("SECRET");
    expect(serialized).not.toContain("attacker.invalid");
    expect(serialized).not.toContain("private");
  });

  it("persists only safe Run character-reference metadata and restores legacy records without character bytes", () => {
    const workflow = createTimelineWorkflowState({
      workflowId: "timeline-run-character-crafted",
      sceneRequest: "A crafted Run character reference",
      promptProfile: "illustrious",
      settingsSnapshot: sanitizeRunSceneInputSettingsSnapshot({
        characterReference: {
          status: "ready",
          strength: 0.8,
          metadata: {
            byteLength: 512,
            contentType: "image/png",
            filename: "hero.png",
            storedFilename: "fedcba9876543210fedcba9876543210.png",
            uploadedAt: "2026-07-19T00:00:00.000Z",
          },
        },
        promptProfile: "illustrious",
      }),
    });
    const raw = JSON.parse(serializeTimelineWorkflowRecord(createTimelineWorkflowRecord({
      workflow,
      sceneRequest: "A crafted Run character reference",
      selectedPromptProfile: "illustrious",
      selectedImageCount: 1,
      selectedNodeId: "scene-input",
    }))) as {
      workflow: { nodes: Record<string, { result: { settingsSnapshot: Record<string, unknown> } }> };
    };
    const characterReference = raw.workflow.nodes["scene-input"]!.result.settingsSnapshot.characterReference as Record<string, unknown>;
    characterReference.dataUrl = "data:image/png;base64,CHARACTER_SECRET";
    characterReference.bytes = [1, 2, 3];
    characterReference.cache = { path: "C:\\private\\hero-cache" };
    characterReference.metadata = {
      ...(characterReference.metadata as Record<string, unknown>),
      bytes: [1, 2, 3],
      filename: "..\\private\\hero.png",
      url: "https://attacker.invalid/hero.png",
    };

    const restored = sanitizeTimelineWorkflowRecord(raw);
    if (!restored || !isSingleImageTimelineWorkflowRecord(restored)) {
      throw new Error("Expected a single-image timeline record.");
    }
    const restoredSettings = (restored.workflow.nodes["scene-input"].result as {
      settingsSnapshot?: { characterReference?: { metadata?: Record<string, unknown>; strength?: number } };
    }).settingsSnapshot;
    expect(restoredSettings?.characterReference).toMatchObject({
      status: "ready",
      strength: 0.8,
      metadata: {
        storedFilename: "fedcba9876543210fedcba9876543210.png",
        url: "/api/comfyui/sequence-references/fedcba9876543210fedcba9876543210.png",
      },
    });
    expect(restoredSettings?.characterReference?.metadata).not.toHaveProperty("filename");
    const serialized = JSON.stringify(restored);
    expect(serialized).not.toContain("CHARACTER_SECRET");
    expect(serialized).not.toContain("attacker.invalid");
    expect(serialized).not.toContain("C:\\\\private");
    expect(serialized).not.toContain('"bytes"');

    delete raw.workflow.nodes["scene-input"]!.result.settingsSnapshot.characterReference;
    const legacy = sanitizeTimelineWorkflowRecord(raw);
    if (!legacy || !isSingleImageTimelineWorkflowRecord(legacy)) {
      throw new Error("Expected a legacy single-image timeline record.");
    }
    expect((legacy.workflow.nodes["scene-input"].result as {
      settingsSnapshot?: Record<string, unknown>;
    }).settingsSnapshot).not.toHaveProperty("characterReference");
  });

  it("preserves scene input source image data through workflow sanitization", () => {
    const sourceImageDataUrl = "data:image/png;base64,aGVsbG8=";
    let workflow = createTimelineWorkflowState({
      workflowId: "timeline-source-image",
      sceneRequest: "A source-guided portrait",
      imageCount: 4,
      sourceImage: {
        dataUrl: sourceImageDataUrl,
        filename: "source.png",
        height: 768,
        mimeType: "image/png",
        uploadedAt: "2026-06-07T00:00:00.000Z",
        width: 1024,
      },
      now: () => "2026-06-07T00:00:00.000Z",
    });
    workflow = completeTimelineNode(
      workflow,
      "parameter-recommendation",
      {
        requestPreview: {
          batchSize: 1,
          denoise: 0.6,
          height: 768,
          imageHeight: 768,
          imageWidth: 1024,
          width: 1024,
        },
      },
      "ai",
    );

    const record = createTimelineWorkflowRecord({
      workflow,
      sceneRequest: "A source-guided portrait",
      selectedPromptProfile: "illustrious",
      selectedImageCount: 1,
      selectedNodeId: "scene-input",
    });
    const serialized = serializeTimelineWorkflowRecord(record);
    const parsed = parseTimelineWorkflowRecordJson(serialized);
    expect(parsed && isSingleImageTimelineWorkflowRecord(parsed)).toBe(true);

    if (!parsed || !isSingleImageTimelineWorkflowRecord(parsed)) {
      throw new Error("Expected a single-image timeline record.");
    }

    expect(serialized.match(/data:image\/png;base64,aGVsbG8=/g) ?? []).toHaveLength(1);
    expect(parsed?.workflow.nodes["scene-input"].result).toMatchObject({
      imageCount: 4,
      sourceImage: {
        dataUrl: sourceImageDataUrl,
        filename: "source.png",
        height: 768,
        mimeType: "image/png",
        width: 1024,
      },
    });
    expect(parsed?.workflow.nodes["parameter-recommendation"].result).toMatchObject({
      requestPreview: {
        batchSize: 1,
        height: 768,
        imageHeight: 768,
        imageWidth: 1024,
        width: 1024,
      },
    });
    expect(parsed?.workflow.nodes["parameter-recommendation"].result).not.toHaveProperty(
      "requestPreview.sourceImageDataUrl",
    );
  });

  it("round-trips v2 preview and final references separately while redacting unsafe payloads", () => {
    const workflow = createPersistedV2GenerationWorkflow(1);
    const preview = workflow.nodes["preview-execution"].result as {
      candidates: Array<Record<string, unknown>>;
    };
    Object.assign(preview.candidates[0]!, {
      imageBytes: "data:image/png;base64,SECRET_PREVIEW",
      apiKey: "SECRET_API_KEY",
      downloadedModelPath: "C:\\private\\model.safetensors",
    });
    const execution = workflow.nodes["comfyui-execution"].result as Record<string, unknown>;
    execution.workflow = { secretNode: { class_type: "SaveImage" } };
    const expectedPreviewFilename = (
      preview.candidates[0]!.storedImage as { filename: string }
    ).filename;
    const expectedFinalFilename = (
      (execution.finals as Array<{ storedImage: { filename: string } }>)[0]!.storedImage
    ).filename;

    const record = createTimelineWorkflowRecord({
      workflow,
      sceneRequest: "A scored preview run",
      selectedPromptProfile: "illustrious",
      selectedImageCount: 1,
      selectedNodeId: "preview-scoring",
    });
    const serialized = serializeTimelineWorkflowRecord(record);
    const restored = parseTimelineWorkflowRecordJson(serialized);
    expect(restored && isSingleImageTimelineWorkflowRecord(restored)).toBe(true);
    if (!restored || !isSingleImageTimelineWorkflowRecord(restored)) throw new Error("Expected v2 Run record.");

    expect(restored.definitionVersion).toBe(4);
    expect(restored.workflow.nodes["preview-execution"].result).toMatchObject({
      candidates: expect.arrayContaining([
        expect.objectContaining({ storedImage: expect.objectContaining({ filename: expectedPreviewFilename }) }),
      ]),
    });
    expect(restored.workflow.nodes["comfyui-execution"].result).toMatchObject({
      finals: [expect.objectContaining({
        candidateId: "preview-1",
        storedImage: expect.objectContaining({ filename: expectedFinalFilename }),
      })],
    });
    expect(restored.workflow.nodes["comfyui-execution"].result).not.toHaveProperty("workflow");
    expect(serialized).not.toContain("SECRET_PREVIEW");
    expect(serialized).not.toContain("SECRET_API_KEY");
    expect(serialized).not.toContain("C:\\private");
  });

  it("round-trips real ComfyUI temp preview references with an empty subfolder", () => {
    const workflow = createPersistedV2GenerationWorkflow(2);
    const preview = workflow.nodes["preview-execution"].result as {
      candidates: Array<Record<string, unknown>>;
    };
    preview.candidates.forEach((candidate, index) => {
      candidate.sourceImage = {
        filename: `ComfyUI_temp_0000${index + 1}_.png`,
        subfolder: index % 2 === 0 ? "" : "   ",
        type: "temp",
        nodeId: String(20 + index),
      };
    });
    const record = createTimelineWorkflowRecord({
      workflow,
      sceneRequest: "A persisted real ComfyUI temp preview Run",
      selectedPromptProfile: "illustrious",
      selectedImageCount: 2,
      selectedNodeId: "preview-execution",
    });
    const restored = parseTimelineWorkflowRecordJson(serializeTimelineWorkflowRecord(record));
    expect(restored && isSingleImageTimelineWorkflowRecord(restored)).toBe(true);
    if (!restored || !isSingleImageTimelineWorkflowRecord(restored)) throw new Error("Expected a single-image Run record.");

    expect(restored.workflow.nodes["preview-execution"]).toMatchObject({
      status: "done",
      result: {
        successfulCount: 4,
        candidates: expect.arrayContaining([
          expect.objectContaining({
            candidateId: "preview-1",
            status: "done",
            sourceImage: {
              filename: "ComfyUI_temp_00001_.png",
              type: "temp",
              nodeId: "20",
            },
          }),
        ]),
      },
    });
    const restoredPreview = restored.workflow.nodes["preview-execution"].result as {
      candidates: Array<{ sourceImage?: { subfolder?: string } }>;
    };
    expect(restoredPreview.candidates.every((candidate) => candidate.sourceImage?.subfolder === undefined)).toBe(true);
    expect(restored.workflow.nodes["preview-scoring"].status).toBe("done");
    expect(restored.workflow.nodes["comfyui-execution"].status).toBe("done");
    expect(restored.workflow.nodes["result-display"].status).toBe("done");
  });

  it("preserves exact-aspect 8-aligned preview dimensions in a current-v2 round trip", () => {
    const workflow = createPersistedV2GenerationWorkflow(2);
    const parameters = workflow.nodes["parameter-recommendation"].result as {
      width: number;
      height: number;
      requestPreview: { width: number; height: number };
    };
    parameters.width = 832;
    parameters.height = 1216;
    parameters.requestPreview.width = 832;
    parameters.requestPreview.height = 1216;
    const preview = workflow.nodes["preview-execution"].result as {
      previewWidth: number;
      previewHeight: number;
    };
    preview.previewWidth = 520;
    preview.previewHeight = 760;

    const record = createTimelineWorkflowRecord({
      workflow,
      sceneRequest: "An exact-aspect portrait preview Run",
      selectedPromptProfile: "illustrious",
      selectedImageCount: 2,
      selectedNodeId: "preview-execution",
    });
    const restored = parseTimelineWorkflowRecordJson(serializeTimelineWorkflowRecord(record));
    expect(restored && isSingleImageTimelineWorkflowRecord(restored)).toBe(true);
    if (!restored || !isSingleImageTimelineWorkflowRecord(restored)) throw new Error("Expected a single-image Run record.");
    const restoredPreview = restored.workflow.nodes["preview-execution"].result as {
      previewWidth: number;
      previewHeight: number;
    };

    expect(restored.workflow.nodes["preview-execution"].status).toBe("done");
    expect(restoredPreview).toMatchObject({ previewWidth: 520, previewHeight: 760 });
    expect(restoredPreview.previewWidth % 8).toBe(0);
    expect(restoredPreview.previewHeight % 8).toBe(0);
    expect(restoredPreview.previewWidth * 1216).toBe(restoredPreview.previewHeight * 832);
  });

  it.each([
    ["path traversal", (candidate: Record<string, unknown>) => {
      candidate.storedImage = {
        ...candidate.storedImage as object,
        filename: "../preview.png",
        url: "/api/comfyui/generated-images/../preview.png",
      };
    }],
    ["arbitrary URL", (candidate: Record<string, unknown>) => {
      candidate.storedImage = {
        ...candidate.storedImage as object,
        url: "https://attacker.invalid/preview.png",
      };
    }],
    ["missing references", (candidate: Record<string, unknown>) => {
      delete candidate.storedImage;
      delete candidate.sourceImage;
    }],
  ] as const)("fails closed for persisted preview %s", (_case, mutate) => {
    const raw = JSON.parse(JSON.stringify(createPersistedV2GenerationWorkflow())) as TimelineWorkflowState;
    const preview = raw.nodes["preview-execution"].result as { candidates: Array<Record<string, unknown>> };
    mutate(preview.candidates[0]!);

    const restored = sanitizeTimelineWorkflowState(raw) as TimelineWorkflowState;
    expect((restored.nodes["preview-execution"].result as {
      candidates: Array<{ status: string; error?: { code: string } }>;
    }).candidates[0]).toMatchObject({
      status: "error",
      error: { code: "image_storage_invalid" },
    });
    expect(() => createTimelineFinalRequests(restored)).toThrow(/preview scoring|required|exactly 2/i);
    expect(JSON.stringify(restored)).not.toContain("attacker.invalid");
    expect(JSON.stringify(restored)).not.toContain("../preview.png");
  });

  it.each([
    ["path traversal", { filename: "..\\final.png", url: "/api/comfyui/generated-images/../final.png" }],
    ["arbitrary URL", { url: "https://attacker.invalid/final.png" }],
    ["missing reference", null],
  ])("marks completed final/result nodes recoverable when a stored final has %s", (_case, replacement) => {
    const raw = JSON.parse(JSON.stringify(createPersistedV2GenerationWorkflow())) as TimelineWorkflowState;
    const final = (raw.nodes["comfyui-execution"].result as {
      finals: Array<Record<string, unknown>>;
    }).finals[0]!;
    if (replacement === null) {
      delete final.storedImage;
    } else {
      final.storedImage = { ...(final.storedImage as object), ...replacement };
    }

    const restored = sanitizeTimelineWorkflowState(raw) as TimelineWorkflowState;
    expect(restored.nodes["comfyui-execution"]).toMatchObject({
      status: "error",
      error: { code: "image_storage_invalid", details: { recoverable: true } },
    });
    expect(restored.nodes["result-display"]).toMatchObject({
      status: "error",
      error: { code: "image_storage_invalid", details: { recoverable: true } },
    });
  });

  it.each([
    ["seed", (workflow: TimelineWorkflowState) => {
      const final = (workflow.nodes["comfyui-execution"].result as { finals: Array<{ seed: number }> }).finals[0]!;
      final.seed += 999;
    }],
    ["rank", (workflow: TimelineWorkflowState) => {
      const finals = (workflow.nodes["comfyui-execution"].result as { finals: Array<{ rank: number }> }).finals;
      [finals[0]!.rank, finals[1]!.rank] = [finals[1]!.rank, finals[0]!.rank];
    }],
    ["selection", (workflow: TimelineWorkflowState) => {
      const scoring = workflow.nodes["preview-scoring"].result as {
        selectedCandidateIds: string[];
        selectionSource: string;
      };
      scoring.selectedCandidateIds = [
        "preview-1",
        "preview-3",
      ];
      scoring.selectionSource = "manual";
    }],
  ] as const)("fails closed when persisted final %s linkage disagrees with selection", (_case, mutate) => {
    const raw = JSON.parse(JSON.stringify(createPersistedV2GenerationWorkflow())) as TimelineWorkflowState;
    mutate(raw);

    const restored = sanitizeTimelineWorkflowState(raw) as TimelineWorkflowState;
    expect(restored.nodes["comfyui-execution"]).toMatchObject({
      status: "error",
      error: { code: "image_storage_invalid", details: { recoverable: true } },
    });
    expect(restored.nodes["result-display"].status).toBe("error");
  });

  it("round-trips a Detailed K=2 manual selection with global scoring ranks 1 and 3", () => {
    const raw = JSON.parse(JSON.stringify(createPersistedV2GenerationWorkflow(2))) as TimelineWorkflowState;
    const scoring = raw.nodes["preview-scoring"].result as {
      selectedCandidateIds: string[];
      selectionSource: string;
    };
    scoring.selectedCandidateIds = ["preview-1", "preview-3"];
    scoring.selectionSource = "manual";

    const execution = raw.nodes["comfyui-execution"].result as {
      finals: Array<Record<string, unknown>>;
    };
    const resultDisplay = raw.nodes["result-display"].result as {
      finalLinks: Array<Record<string, unknown>>;
      image: Record<string, unknown>;
      images: Array<Record<string, unknown>>;
      promptId: string;
      sourceImage: Record<string, unknown>;
      sourceImages: Array<Record<string, unknown>>;
      storedImage: Record<string, unknown>;
      storedImages: Array<Record<string, unknown>>;
      fallbacks: Array<Record<string, unknown>>;
    };
    const candidates = (raw.nodes["preview-execution"].result as {
      candidates: Array<Record<string, unknown>>;
    }).candidates;
    const selectedIndexes = [0, 2];
    execution.finals = selectedIndexes.map((candidateIndex) => {
      const candidate = candidates[candidateIndex]!;
      const rank = candidateIndex + 1;
      return {
        candidateId: candidate.candidateId,
        seed: candidate.seed,
        rank,
        status: "done",
        promptId: `final-prompt-${rank}`,
        sourceImage: { filename: `final-output-${rank}.png`, nodeId: "9", type: "output" },
        storedImage: managedStoredImage((rank + 8).toString(16)),
        previewUpscale: {
          policyVersion: timelineFinalGenerationPolicy.version,
          resizeMode: timelineFinalGenerationPolicy.resizeMode,
          width: 1024,
          height: 1024,
          sourcePreview: candidate.storedImage,
          storedImage: managedStoredImage(rank === 1 ? "d" : "f"),
        },
        finalPolicy: persistedBalancedFallbackPolicy,
      };
    });
    resultDisplay.finalLinks = execution.finals.map((item) => ({
      candidateId: item.candidateId,
      promptId: item.promptId,
      rank: item.rank,
      seed: item.seed,
    }));
    resultDisplay.promptId = execution.finals[0]!.promptId as string;
    resultDisplay.sourceImages = execution.finals.map((item) => item.sourceImage as Record<string, unknown>);
    resultDisplay.sourceImage = resultDisplay.sourceImages[0]!;
    resultDisplay.storedImages = execution.finals.map((item) => item.storedImage as Record<string, unknown>);
    resultDisplay.storedImage = resultDisplay.storedImages[0]!;
    resultDisplay.fallbacks = execution.finals.map((item) => ({
      candidateId: item.candidateId,
      rank: item.rank,
      seed: item.seed,
      storedImage: (item.previewUpscale as { storedImage: Record<string, unknown> }).storedImage,
    }));
    resultDisplay.images = execution.finals.map((item) => ({
      ...(item.sourceImage as Record<string, unknown>),
      url: (item.storedImage as { url: string }).url,
    }));
    resultDisplay.image = resultDisplay.images[0]!;

    const record = createTimelineWorkflowRecord({
      workflow: raw,
      sceneRequest: "A persisted scored-preview Run",
      selectedPromptProfile: "illustrious",
      selectedImageCount: 2,
      selectedNodeId: "result-display",
    });
    const restored = parseTimelineWorkflowRecordJson(serializeTimelineWorkflowRecord(record));
    expect(restored && isSingleImageTimelineWorkflowRecord(restored)).toBe(true);
    if (!restored || !isSingleImageTimelineWorkflowRecord(restored)) throw new Error("Expected a single-image Run record.");

    expect(restored.workflow.nodes["preview-scoring"].result).toMatchObject({
      selectedCandidateIds: ["preview-1", "preview-3"],
      selectionSource: "manual",
    });
    expect(restored.workflow.nodes["comfyui-execution"]).toMatchObject({
      status: "done",
      result: {
        finals: [
          { candidateId: "preview-1", rank: 1 },
          { candidateId: "preview-3", rank: 3 },
        ],
      },
    });
    expect(restored.workflow.nodes["result-display"]).toMatchObject({
      status: "done",
      result: {
        finalLinks: [
          { candidateId: "preview-1", rank: 1 },
          { candidateId: "preview-3", rank: 3 },
        ],
      },
    });
  });

  it.each([
    ["unsupported rubric version", (scoring: MutablePersistedPreviewScoring) => {
      scoring.rubricVersion = 3;
    }],
    ["missing candidate coverage", (scoring: MutablePersistedPreviewScoring) => {
      scoring.scores.pop();
    }],
    ["duplicate candidate coverage", (scoring: MutablePersistedPreviewScoring) => {
      scoring.scores[1]!.candidateId = scoring.scores[0]!.candidateId;
    }],
    ["unknown candidate coverage", (scoring: MutablePersistedPreviewScoring) => {
      scoring.scores[0]!.candidateId = "preview-8";
    }],
    ["NaN score dimension", (scoring: MutablePersistedPreviewScoring) => {
      scoring.scores[0]!.adherence = Number.NaN;
    }],
    ["string score dimension", (scoring: MutablePersistedPreviewScoring) => {
      scoring.scores[0]!.composition = "90";
    }],
    ["negative score dimension", (scoring: MutablePersistedPreviewScoring) => {
      scoring.scores[0]!.anatomy = -1;
    }],
    ["score dimension over 100", (scoring: MutablePersistedPreviewScoring) => {
      scoring.scores[0]!.style = 101;
    }],
    ["NaN total", (scoring: MutablePersistedPreviewScoring) => {
      scoring.scores[0]!.total = Number.NaN;
    }],
    ["string total", (scoring: MutablePersistedPreviewScoring) => {
      scoring.scores[0]!.total = "100";
    }],
    ["negative total", (scoring: MutablePersistedPreviewScoring) => {
      scoring.scores[0]!.total = -1;
    }],
    ["total over 100", (scoring: MutablePersistedPreviewScoring) => {
      scoring.scores[0]!.total = 101;
    }],
    ["duplicate rank", (scoring: MutablePersistedPreviewScoring) => {
      scoring.scores[1]!.rank = scoring.scores[0]!.rank;
    }],
    ["rank gap", (scoring: MutablePersistedPreviewScoring) => {
      scoring.scores.at(-1)!.rank = scoring.scores.length + 1;
    }],
    ["rank out of range", (scoring: MutablePersistedPreviewScoring) => {
      scoring.scores[0]!.rank = 0;
    }],
    ["too few selected candidates", (scoring: MutablePersistedPreviewScoring) => {
      scoring.selectedCandidateIds.pop();
    }],
    ["too many selected candidates", (scoring: MutablePersistedPreviewScoring) => {
      scoring.selectedCandidateIds.push("preview-3");
    }],
    ["duplicate selected candidates", (scoring: MutablePersistedPreviewScoring) => {
      scoring.selectedCandidateIds[1] = scoring.selectedCandidateIds[0];
    }],
    ["unknown selected candidate", (scoring: MutablePersistedPreviewScoring) => {
      scoring.selectedCandidateIds[0] = "preview-8";
    }],
    ["unsupported selection source", (scoring: MutablePersistedPreviewScoring) => {
      scoring.selectionSource = "system";
    }],
    ["missing v2 eligibility", (scoring: MutablePersistedPreviewScoring) => {
      delete scoring.scores[0]!.eligible;
    }],
    ["missing v2 critical defects", (scoring: MutablePersistedPreviewScoring) => {
      delete scoring.scores[0]!.criticalDefects;
    }],
    ["eligible with a critical defect", (scoring: MutablePersistedPreviewScoring) => {
      scoring.scores[0]!.criticalDefects = [{ category: "severe_exposure", description: "blown highlights" }];
    }],
    ["ineligible without a critical defect", (scoring: MutablePersistedPreviewScoring) => {
      scoring.scores[0]!.eligible = false;
    }],
    ["unknown critical defect category", (scoring: MutablePersistedPreviewScoring) => {
      scoring.scores[0]!.eligible = false;
      scoring.scores[0]!.criticalDefects = [{ category: "unknown", description: "unsupported" }];
    }],
    ["duplicate critical defect category", (scoring: MutablePersistedPreviewScoring) => {
      scoring.scores[0]!.eligible = false;
      scoring.scores[0]!.criticalDefects = [
        { category: "anatomy_or_structure", description: "first" },
        { category: "anatomy_or_structure", description: "second" },
      ];
    }],
    ["blank critical defect description", (scoring: MutablePersistedPreviewScoring) => {
      scoring.scores[0]!.eligible = false;
      scoring.scores[0]!.criticalDefects = [{ category: "gaze_or_action_mismatch", description: "   " }];
    }],
  ] as const)("fails closed for persisted preview scoring with %s", (_case, mutate) => {
    const raw = createPersistedV2GenerationWorkflow(2);
    mutate(getMutablePersistedPreviewScoring(raw));

    const restored = sanitizeTimelineWorkflowState(raw) as TimelineWorkflowState;
    expect(restored.nodes["preview-scoring"]).toMatchObject({
      status: "error",
      error: { code: "timeline_request_invalid", details: { recoverable: true } },
    });
    expect(restored.nodes["preview-scoring"].result).toBeUndefined();
    for (const nodeId of ["comfyui-execution", "result-display"] as const) {
      expect(restored.nodes[nodeId]).toMatchObject({
        status: "error",
        error: { code: "timeline_request_invalid", details: { recoverable: true } },
      });
      expect(restored.nodes[nodeId].result).toBeUndefined();
    }
    expect(() => createTimelineFinalRequests(restored)).toThrow();
  });

  it.each([
    ["swapped ranks", (scoring: MutablePersistedPreviewScoring) => {
      [scoring.scores[0]!.rank, scoring.scores[1]!.rank] = [
        scoring.scores[1]!.rank,
        scoring.scores[0]!.rank,
      ];
    }],
    ["AI non-Top-K selection", (scoring: MutablePersistedPreviewScoring) => {
      scoring.selectedCandidateIds = ["preview-1", "preview-3"];
    }],
    ["incorrect composition tie-break", (scoring: MutablePersistedPreviewScoring) => {
      Object.assign(scoring.scores[0]!, {
        adherence: 80,
        composition: 80,
        anatomy: 80,
        style: 80,
        technical: 80,
        total: 80,
        rank: 1,
      });
      Object.assign(scoring.scores[1]!, {
        adherence: 63.333333333333336,
        composition: 100,
        anatomy: 80,
        style: 80,
        technical: 80,
        total: 80,
        rank: 2,
      });
      Object.assign(scoring.scores[2]!, {
        adherence: 60, composition: 60, anatomy: 60, style: 60, technical: 60, total: 60, rank: 3,
      });
      Object.assign(scoring.scores[3]!, {
        adherence: 50, composition: 50, anatomy: 50, style: 50, technical: 50, total: 50, rank: 4,
      });
      scoring.selectedCandidateIds = ["preview-2", "preview-1"];
    }],
    ["incorrect preview-index tie-break", (scoring: MutablePersistedPreviewScoring) => {
      for (const [index, score] of scoring.scores.entries()) {
        const value = index < 2 ? 80 : 60 - index;
        Object.assign(score, {
          adherence: value,
          composition: value,
          anatomy: value,
          style: value,
          technical: value,
          total: value,
        });
      }
      scoring.scores[0]!.rank = 2;
      scoring.scores[1]!.rank = 1;
      scoring.scores[2]!.rank = 3;
      scoring.scores[3]!.rank = 4;
      scoring.selectedCandidateIds = ["preview-1", "preview-2"];
    }],
    ["dimension drift with stale ranks", (scoring: MutablePersistedPreviewScoring) => {
      scoring.scores[0]!.adherence = 90;
    }],
  ] as const)("fails closed for semantically inconsistent persisted scoring with %s", (_case, mutate) => {
    const raw = createPersistedV2GenerationWorkflow(2);
    mutate(getMutablePersistedPreviewScoring(raw));

    const restored = sanitizeTimelineWorkflowState(raw) as TimelineWorkflowState;
    expect(restored.nodes["preview-scoring"]).toMatchObject({
      status: "error",
      error: { code: "timeline_request_invalid", details: { recoverable: true } },
    });
    expect(restored.nodes["preview-scoring"].result).toBeUndefined();
    for (const nodeId of ["comfyui-execution", "result-display"] as const) {
      expect(restored.nodes[nodeId]).toMatchObject({
        status: "error",
        error: { code: "timeline_request_invalid", details: { recoverable: true } },
      });
      expect(restored.nodes[nodeId].result).toBeUndefined();
    }
    expect(() => createTimelineFinalRequests(restored)).toThrow(/preview scoring|required/i);
  });

  it("recomputes a forged persisted total from the fixed scoring weights", () => {
    const raw = createPersistedV2GenerationWorkflow(2);
    const scoring = getMutablePersistedPreviewScoring(raw);
    scoring.scores[0]!.total = 0;

    const restored = sanitizeTimelineWorkflowState(raw) as TimelineWorkflowState;
    const restoredScoring = restored.nodes["preview-scoring"].result as {
      scores: Array<{ candidateId: string; total: number }>;
    };
    expect(restored.nodes["preview-scoring"].status).toBe("done");
    expect(restoredScoring.scores.find((score) => score.candidateId === "preview-1")?.total).toBe(100);
    expect(restored.nodes["comfyui-execution"].status).toBe("done");
    expect(restored.nodes["result-display"].status).toBe("done");
  });

  it("fails closed on continuable rubric v1 scoring and blocks fresh Final continuation", () => {
    const raw = createPersistedV2GenerationWorkflow(2);
    const scoring = getMutablePersistedPreviewScoring(raw);
    scoring.rubricVersion = 1;
    for (const score of scoring.scores) {
      delete score.eligible;
      delete score.criticalDefects;
    }
    raw.nodes["comfyui-execution"] = {
      ...raw.nodes["comfyui-execution"],
      status: "blocked",
      result: undefined,
      error: undefined,
    };
    raw.nodes["result-display"] = {
      ...raw.nodes["result-display"],
      status: "blocked",
      result: undefined,
      error: undefined,
    };

    const restored = sanitizeTimelineWorkflowState(raw) as TimelineWorkflowState;
    expect(restored.nodes["preview-scoring"]).toMatchObject({
      status: "error",
      error: { code: "timeline_request_invalid" },
    });
    expect(() => createTimelineFinalRequests(restored)).toThrow(/visual-style-verified Preview scoring is required/i);
  });

  it("rewrites a persisted legacy eligibility shortfall to retry preview scoring", () => {
    const raw = createPersistedV2GenerationWorkflow(2);
    raw.nodes["preview-scoring"] = {
      nodeId: "preview-scoring",
      status: "error",
      source: "system",
      updatedAt: raw.updatedAt,
      error: {
        code: "timeline_request_invalid",
        message: "Only 1 of 2 required previews passed critical visual checks.",
        details: {
          recoverable: true,
          retryFrom: "preview-execution",
          eligibleCount: 1,
          finalCount: 2,
        },
      },
    };

    const restored = sanitizeTimelineWorkflowState(raw) as TimelineWorkflowState;

    expect(restored.nodes["preview-scoring"]).toMatchObject({
      status: "error",
      error: {
        code: "timeline_request_invalid",
        message: expect.stringContaining("Retry preview scoring"),
        details: {
          recoverable: true,
          eligibleCount: 1,
          finalCount: 2,
        },
      },
    });
    expect(restored.nodes["preview-scoring"].error?.details).not.toHaveProperty("retryFrom");
    expect(restored.nodes["comfyui-execution"].status).toBe("error");
    expect(restored.nodes["result-display"].status).toBe("error");
  });

  it("accepts previewSteps=20 and rejects persisted preview steps above the cap", () => {
    const valid = createPersistedV2GenerationWorkflow(1);
    (valid.nodes["preview-execution"].result as { advanceSeedOnRetry?: true }).advanceSeedOnRetry = true;
    const restored = sanitizeTimelineWorkflowState(valid) as TimelineWorkflowState;
    expect(restored.nodes["preview-execution"]).toMatchObject({
      status: "done",
      result: { previewSteps: 20 },
    });
    expect(restored.nodes["preview-execution"].result).not.toHaveProperty("advanceSeedOnRetry");

    const invalid = createPersistedV2GenerationWorkflow(1);
    (invalid.nodes["preview-execution"].result as { previewSteps: number }).previewSteps = 21;
    const rejected = sanitizeTimelineWorkflowState(invalid) as TimelineWorkflowState;
    expect(rejected.nodes["preview-execution"]).toMatchObject({
      status: "error",
    });
    expect(rejected.nodes["preview-execution"].result).toBeUndefined();
    expect(rejected.nodes["preview-scoring"].status).toBe("error");
  });

  it("keeps a manual exact-K non-Top-K selection valid", () => {
    const raw = createPersistedV2GenerationWorkflow(2);
    const scoring = getMutablePersistedPreviewScoring(raw);
    scoring.selectedCandidateIds = ["preview-1", "preview-3"];
    scoring.selectionSource = "manual";
    raw.nodes["comfyui-execution"] = {
      ...raw.nodes["comfyui-execution"],
      status: "blocked",
      result: undefined,
      error: undefined,
    };
    raw.nodes["result-display"] = {
      ...raw.nodes["result-display"],
      status: "blocked",
      result: undefined,
      error: undefined,
    };

    const restored = sanitizeTimelineWorkflowState(raw) as TimelineWorkflowState;
    expect(restored.nodes["preview-scoring"]).toMatchObject({
      status: "done",
      result: {
        selectionSource: "manual",
        selectedCandidateIds: ["preview-1", "preview-3"],
      },
    });
    expect(createTimelineFinalRequests(restored)).toMatchObject([
      { candidateId: "preview-1", rank: 1 },
      { candidateId: "preview-3", rank: 3 },
    ]);
  });

  it("preserves eligible-first ranking even when an ineligible candidate has the highest weighted total", () => {
    const raw = createPersistedV2GenerationWorkflow(2);
    const scoring = getMutablePersistedPreviewScoring(raw);
    scoring.scores[0]!.eligible = false;
    scoring.scores[0]!.criticalDefects = [{
      category: "spatial_physical_contradiction",
      description: "Subject contradicts the requested placement.",
    }];
    scoring.scores[0]!.rank = 4;
    scoring.scores[1]!.rank = 1;
    scoring.scores[2]!.rank = 2;
    scoring.scores[3]!.rank = 3;
    scoring.selectedCandidateIds = ["preview-2", "preview-3"];
    for (const nodeId of ["comfyui-execution", "result-display"] as const) {
      raw.nodes[nodeId] = { ...raw.nodes[nodeId], status: "blocked", result: undefined, error: undefined };
    }

    const restored = sanitizeTimelineWorkflowState(raw) as TimelineWorkflowState;
    expect(restored.nodes["preview-scoring"]).toMatchObject({
      status: "done",
      result: { selectedCandidateIds: ["preview-2", "preview-3"] },
    });
    const restoredScores = (restored.nodes["preview-scoring"].result as {
      scores: Array<{ candidateId: string; eligible: boolean; rank: number }>;
    }).scores;
    expect(restoredScores.find((score) => score.candidateId === "preview-1")).toMatchObject({ eligible: false, rank: 4 });
    expect(restoredScores.find((score) => score.candidateId === "preview-2")).toMatchObject({ eligible: true, rank: 1 });
    expect(restoredScores.find((score) => score.candidateId === "preview-3")).toMatchObject({ eligible: true, rank: 2 });
    expect(restoredScores.find((score) => score.candidateId === "preview-4")).toMatchObject({ eligible: true, rank: 3 });
    expect(createTimelineFinalRequests(restored)).toMatchObject([
      { candidateId: "preview-2", rank: 1 },
      { candidateId: "preview-3", rank: 2 },
    ]);
  });

  it("restores an old-v2 soft-only ineligible manual fallback and recomputes selection metadata", () => {
    const raw = createPersistedV2GenerationWorkflow(2);
    const scoring = getMutablePersistedPreviewScoring(raw);
    scoring.scores[0]!.eligible = false;
    scoring.scores[0]!.criticalDefects = [{
      category: "gaze_or_action_mismatch",
      description: "The subject performs the wrong action.",
    }];
    scoring.scores[0]!.rank = 4;
    scoring.scores[1]!.rank = 1;
    scoring.scores[2]!.rank = 2;
    scoring.scores[3]!.rank = 3;
    scoring.selectedCandidateIds = ["preview-1", "preview-2"];
    scoring.selectionSource = "manual";
    scoring.eligibleCount = 99;
    scoring.fallbackCandidateIds = ["preview-4"];
    scoring.selectionWarning = "FORGED WARNING";
    for (const nodeId of ["comfyui-execution", "result-display"] as const) {
      raw.nodes[nodeId] = { ...raw.nodes[nodeId], status: "blocked", result: undefined, error: undefined };
    }

    const restored = sanitizeTimelineWorkflowState(raw) as TimelineWorkflowState;
    expect(restored.nodes["preview-scoring"]).toMatchObject({
      status: "done",
      result: {
        eligibleCount: 3,
        fallbackCandidateIds: ["preview-1"],
        selectedCandidateIds: ["preview-1", "preview-2"],
        selectionSource: "manual",
        selectionWarning: expect.stringContaining("1 annotated fallback candidate was selected"),
      },
    });
    expect(JSON.stringify(restored.nodes["preview-scoring"].result)).not.toContain("FORGED WARNING");
    expect(createTimelineFinalRequests(restored)).toMatchObject([
      { candidateId: "preview-1", rank: 4 },
      { candidateId: "preview-2", rank: 1 },
    ]);
  });

  it("restores current soft annotations as eligible and keeps them in strict AI Top-K", () => {
    const raw = createPersistedV2GenerationWorkflow(2);
    const scoring = getMutablePersistedPreviewScoring(raw);
    scoring.scores[0]!.criticalDefects = [{
      category: "subject_scale_or_framing",
      description: "Non-blocking framing mismatch.",
    }];

    const restored = sanitizeTimelineWorkflowState(raw) as TimelineWorkflowState;
    expect(restored.nodes["preview-scoring"]).toMatchObject({
      status: "done",
      result: {
        eligibleCount: 4,
        fallbackCandidateIds: [],
        selectedCandidateIds: ["preview-1", "preview-2"],
        scores: expect.arrayContaining([expect.objectContaining({
          candidateId: "preview-1",
          eligible: true,
          criticalDefects: [expect.objectContaining({ category: "subject_scale_or_framing" })],
        })]),
      },
    });
  });

  it("restores zero-eligible strict AI Top-K with recomputed fallback metadata", () => {
    const raw = createPersistedV2GenerationWorkflow(2);
    const scoring = getMutablePersistedPreviewScoring(raw);
    for (const score of scoring.scores) {
      score.eligible = false;
      score.criticalDefects = [{ category: "anatomy_or_structure", description: "Unusable structure." }];
    }
    scoring.eligibleCount = 4;
    scoring.fallbackCandidateIds = [];
    delete scoring.selectionWarning;
    for (const nodeId of ["comfyui-execution", "result-display"] as const) {
      raw.nodes[nodeId] = { ...raw.nodes[nodeId], status: "blocked", result: undefined, error: undefined };
    }

    const restored = sanitizeTimelineWorkflowState(raw) as TimelineWorkflowState;
    expect(restored.nodes["preview-scoring"]).toMatchObject({
      status: "done",
      result: {
        eligibleCount: 0,
        fallbackCandidateIds: ["preview-1", "preview-2"],
        selectedCandidateIds: ["preview-1", "preview-2"],
        selectionWarning: expect.stringContaining("Only 0 preview candidates passed blocking-defect checks"),
      },
    });
    expect(createTimelineFinalRequests(restored)).toHaveLength(2);
  });

  it("preserves only cross-node-valid done records from a persisted partial final", () => {
    const raw = JSON.parse(JSON.stringify(createPersistedV2GenerationWorkflow())) as TimelineWorkflowState;
    const complete = raw.nodes["comfyui-execution"].result as {
      completed: boolean;
      finals: Array<{ seed: number }>;
    };
    complete.completed = false;
    complete.finals[1]!.seed += 500;
    raw.nodes["comfyui-execution"] = {
      ...raw.nodes["comfyui-execution"],
      status: "error",
      result: undefined,
      error: {
        code: "comfyui_execution_failed",
        message: "1 of 2 final images completed.",
        details: { recoverable: true, partialResult: complete },
      },
    };
    raw.nodes["result-display"] = {
      ...raw.nodes["result-display"],
      status: "blocked",
      result: undefined,
    };

    const restored = sanitizeTimelineWorkflowState(raw) as TimelineWorkflowState;
    const partial = (restored.nodes["comfyui-execution"].error?.details as {
      partialResult?: { completed: boolean; finals: Array<{ candidateId: string; status: string }> };
    }).partialResult;
    expect(partial).toMatchObject({
      completed: false,
      finals: [
        { candidateId: "preview-1", status: "done" },
        { candidateId: "preview-2", status: "error" },
      ],
    });
  });

  it("preserves a fallback-only error record across reload for Final retry reuse", () => {
    const raw = JSON.parse(JSON.stringify(createPersistedV2GenerationWorkflow(1))) as TimelineWorkflowState;
    const partial = raw.nodes["comfyui-execution"].result as {
      completed: boolean;
      finals: Array<Record<string, unknown>>;
    };
    partial.completed = false;
    partial.finals[0] = {
      candidateId: partial.finals[0]!.candidateId,
      seed: partial.finals[0]!.seed,
      rank: partial.finals[0]!.rank,
      status: "error",
      previewUpscale: partial.finals[0]!.previewUpscale,
      error: {
        code: "comfyui_execution_failed",
        message: "Final queue failed after the fallback was stored.",
        details: { recoverable: true },
      },
    };
    raw.nodes["comfyui-execution"] = {
      ...raw.nodes["comfyui-execution"],
      status: "error",
      result: undefined,
      error: {
        code: "comfyui_execution_failed",
        message: "0 of 1 final images completed.",
        details: { recoverable: true, partialResult: partial },
      },
    };
    raw.nodes["result-display"] = {
      ...raw.nodes["result-display"],
      status: "blocked",
      result: undefined,
    };

    const restored = sanitizeTimelineWorkflowState(raw) as TimelineWorkflowState;
    const restoredPartial = (restored.nodes["comfyui-execution"].error?.details as {
      partialResult?: { finals: Array<Record<string, unknown>> };
    }).partialResult;

    expect(restoredPartial?.finals[0]).toMatchObject({
      candidateId: "preview-1",
      status: "error",
      previewUpscale: {
        resizeMode: "lanczos3-exact",
        storedImage: expect.objectContaining({ filename: `${"d".repeat(32)}.png` }),
      },
    });
  });

  it("round-trips the original sanitized Final execution error without retaining sensitive details", () => {
    const liveError = {
      code: "comfyui_execution_failed",
      message: "Maximum call stack size exceeded",
      details: {
        name: "RangeError",
        sourceImageDataUrl: "data:image/png;base64,PRIVATE_IMAGE_BYTES",
        apiKey: "PRIVATE_API_KEY",
        nested: {
          token: "PRIVATE_TOKEN",
          note: "safe diagnostic",
        },
      },
    };
    const restored = sanitizeTimelineWorkflowState(
      createPersistedFinalErrorWorkflow(liveError),
    ) as TimelineWorkflowState;
    const readFinalError = (workflow: TimelineWorkflowState) => {
      const partialResult = (workflow.nodes["comfyui-execution"].error?.details as {
        partialResult?: { finals?: Array<{ error?: unknown }> };
      } | undefined)?.partialResult;
      return partialResult?.finals?.[0]?.error;
    };

    expect(readFinalError(restored)).toEqual({
      code: "comfyui_execution_failed",
      message: "Maximum call stack size exceeded",
      details: {
        name: "RangeError",
        sourceImageDataUrl: "[redacted]",
        apiKey: "[redacted]",
        nested: {
          token: "[redacted]",
          note: "safe diagnostic",
        },
      },
    });

    const serialized = serializeTimelineWorkflowRecord(createTimelineWorkflowRecord({
      projectId: "final-error-round-trip",
      name: "Final error round trip",
      workflow: restored,
      sceneRequest: "A persisted scored-preview Run",
      selectedPromptProfile: "illustrious",
      selectedImageCount: 1,
      selectedNodeId: "comfyui-execution",
      outputDisplayModes: { "comfyui-execution": "visual" },
    }));
    const roundTripped = parseTimelineWorkflowRecordJson(serialized);

    expect(roundTripped && isSingleImageTimelineWorkflowRecord(roundTripped)).toBe(true);
    if (!roundTripped || !isSingleImageTimelineWorkflowRecord(roundTripped)) {
      throw new Error("Expected a single-image Final error record.");
    }
    expect(readFinalError(roundTripped.workflow)).toEqual(readFinalError(restored));
    expect(serialized).not.toContain("PRIVATE_IMAGE_BYTES");
    expect(serialized).not.toContain("PRIVATE_API_KEY");
    expect(serialized).not.toContain("PRIVATE_TOKEN");
    expect(serialized).not.toContain("data:image");
  });

  it("preserves a legitimate pre-upscale Final error without previewUpscale through sanitize and round-trip", () => {
    const originalError = {
      code: "comfyui_execution_failed",
      message: "Final preparation failed before Preview upscale.",
      details: { name: "RangeError", stage: "preview_upscale" },
    };
    const raw = createPersistedFinalErrorWorkflow(originalError);
    const rawPartial = (raw.nodes["comfyui-execution"].error?.details as {
      partialResult: { finals: Array<Record<string, unknown>> };
    }).partialResult;
    delete rawPartial.finals[0]!.previewUpscale;

    const restored = sanitizeTimelineWorkflowState(raw) as TimelineWorkflowState;
    const readFinal = (workflow: TimelineWorkflowState) => {
      const partialResult = (workflow.nodes["comfyui-execution"].error?.details as {
        partialResult?: { finals?: Array<Record<string, unknown>> };
      } | undefined)?.partialResult;
      return partialResult?.finals?.[0];
    };
    expect(readFinal(restored)).toMatchObject({
      candidateId: "preview-1",
      seed: 100,
      rank: 1,
      status: "error",
      error: originalError,
    });
    expect(readFinal(restored)).not.toHaveProperty("previewUpscale");

    const serialized = serializeTimelineWorkflowRecord(createTimelineWorkflowRecord({
      projectId: "pre-upscale-error-round-trip",
      name: "Pre-upscale Final error",
      workflow: restored,
      sceneRequest: "A persisted pre-upscale Final error",
      selectedPromptProfile: "illustrious",
      selectedImageCount: 1,
      selectedNodeId: "comfyui-execution",
      outputDisplayModes: { "comfyui-execution": "visual" },
    }));
    const roundTripped = parseTimelineWorkflowRecordJson(serialized);

    expect(roundTripped && isSingleImageTimelineWorkflowRecord(roundTripped)).toBe(true);
    if (!roundTripped || !isSingleImageTimelineWorkflowRecord(roundTripped)) {
      throw new Error("Expected a round-tripped pre-upscale Final error.");
    }
    expect(readFinal(roundTripped.workflow)).toEqual(readFinal(restored));
  });

  it("fails closed when an error record includes a mismatched Preview upscale", () => {
    const raw = createPersistedFinalErrorWorkflow({
      code: "comfyui_execution_failed",
      message: "Final queue failed after Preview upscale.",
      details: { recoverable: true },
    });
    const rawPartial = (raw.nodes["comfyui-execution"].error?.details as {
      partialResult: { finals: Array<Record<string, unknown>> };
    }).partialResult;
    const previewUpscale = rawPartial.finals[0]!.previewUpscale as Record<string, unknown>;
    previewUpscale.width = 512;

    const restored = sanitizeTimelineWorkflowState(raw) as TimelineWorkflowState;
    const restoredPartial = (restored.nodes["comfyui-execution"].error?.details as {
      partialResult?: { finals?: Array<{ error?: { code?: string; message?: string } }> };
    } | undefined)?.partialResult;

    expect(restoredPartial?.finals?.[0]?.error).toMatchObject({
      code: "image_storage_invalid",
    });
    expect(restoredPartial?.finals?.[0]?.error?.message).not.toBe(
      "Final queue failed after Preview upscale.",
    );
  });

  it.each([
    ["forged done image storage", (raw: TimelineWorkflowState) => {
      const result = raw.nodes["comfyui-execution"].result as {
        finals: Array<{ storedImage: Record<string, unknown> }>;
      };
      result.finals[0]!.storedImage = {
        byteLength: 128,
        contentType: "image/png",
        filename: "../forged-final.png",
        url: "https://attacker.invalid/forged-final.png",
      };
    }],
    ["forged error candidate linkage", (raw: TimelineWorkflowState) => {
      const partialResult = (raw.nodes["comfyui-execution"].error?.details as {
        partialResult: { finals: Array<Record<string, unknown>> };
      }).partialResult;
      partialResult.finals[0]!.candidateId = "preview-999";
    }],
    ["malformed error without an error object", (raw: TimelineWorkflowState) => {
      const partialResult = (raw.nodes["comfyui-execution"].error?.details as {
        partialResult: { finals: Array<Record<string, unknown>> };
      }).partialResult;
      delete partialResult.finals[0]!.error;
    }],
  ] as const)("fails closed to image_storage_invalid for a %s record", (caseName, mutate) => {
    const raw = caseName.startsWith("forged done")
      ? JSON.parse(JSON.stringify(createPersistedV2GenerationWorkflow(1))) as TimelineWorkflowState
      : createPersistedFinalErrorWorkflow({
          code: "comfyui_execution_failed",
          message: "Maximum call stack size exceeded",
          details: { name: "RangeError" },
        });
    mutate(raw);

    const restored = sanitizeTimelineWorkflowState(raw) as TimelineWorkflowState;
    if (caseName.startsWith("forged done")) {
      expect(restored.nodes["comfyui-execution"]).toMatchObject({
        status: "error",
        error: { code: "image_storage_invalid" },
      });
      return;
    }
    const partialResult = (restored.nodes["comfyui-execution"].error?.details as {
      partialResult?: { finals?: Array<{ error?: { code?: string } }> };
    } | undefined)?.partialResult;
    expect(partialResult?.finals?.[0]?.error).toMatchObject({
      code: "image_storage_invalid",
    });
  });

  it.each([
    ["missing", undefined],
    ["old", `sha256:${"a".repeat(64)}`],
  ])("revokes an incomplete confirmed v2 Run with a %s confirmation fingerprint", (_case, fingerprint) => {
    const raw = JSON.parse(JSON.stringify(createPersistedV2GenerationWorkflow())) as TimelineWorkflowState;
    raw.nodes["result-display"].status = "blocked";
    raw.nodes["result-display"].result = undefined;
    const gate = raw.nodes["generation-gate"].result as Record<string, unknown>;
    if (fingerprint === undefined) delete gate.confirmationFingerprint;
    else gate.confirmationFingerprint = fingerprint;

    const restored = sanitizeTimelineWorkflowState(raw) as TimelineWorkflowState;
    expect(restored.generationConfirmed).toBe(false);
    expect(restored.nodes["generation-gate"]).toMatchObject({
      status: "blocked",
      error: { code: "confirmation_required" },
    });
    for (const nodeId of ["preview-execution", "preview-scoring", "comfyui-execution", "result-display"] as const) {
      expect(restored.nodes[nodeId].status, nodeId).toBe("blocked");
    }
  });

  it("preserves a completed legacy Run only when its generated-image references are safe", () => {
    const base = createTimelineWorkflowState({
      workflowId: "legacy-v1-run",
      sceneRequest: "A legacy run",
    });
    const completed = JSON.parse(JSON.stringify(base)) as TimelineWorkflowState;
    delete (completed.nodes as Partial<typeof completed.nodes>)["preview-execution"];
    delete (completed.nodes as Partial<typeof completed.nodes>)["preview-scoring"];
    completed.generationConfirmed = true;
    completed.nodes["generation-gate"] = {
      nodeId: "generation-gate",
      status: "manual",
      result: { confirmed: true, confirmationRequired: false },
      source: "manual",
      updatedAt: completed.updatedAt,
    };
    completed.nodes["result-display"] = JSON.parse(JSON.stringify(
      createPersistedV2GenerationWorkflow(1).nodes["result-display"],
    )) as TimelineWorkflowState["nodes"]["result-display"];
    const legacySceneInput = completed.nodes["scene-input"].result as {
      settingsSnapshot?: Record<string, unknown>;
    };
    delete legacySceneInput.settingsSnapshot?.visualStyle;
    const legacyDisplay = completed.nodes["result-display"].result as Record<string, unknown>;
    delete legacyDisplay.visualStyle;
    delete legacyDisplay.visualStyleAssessment;
    const restoredCompleted = sanitizeTimelineWorkflowState(completed) as TimelineWorkflowState;
    expect(restoredCompleted.generationConfirmed).toBe(true);
    expect(restoredCompleted.legacyVisualStyleUnassessed).toBe(true);
    expect(restoredCompleted.nodes["result-display"]).toMatchObject({
      status: "done",
      result: {
        completed: true,
        visualStyleAssessment: "style-unassessed",
        storedImage: {
          filename: expect.stringMatching(/^[a-f0-9]{32}\.png$/),
          url: expect.stringMatching(/^\/api\/comfyui\/generated-images\/[a-f0-9]{32}\.png$/),
        },
      },
    });
  });

  it("fails closed instead of reusing downstream artifacts across visual styles", () => {
    const persisted = JSON.parse(JSON.stringify(
      createPersistedV2GenerationWorkflow(1),
    )) as TimelineWorkflowState;
    const sceneInput = persisted.nodes["scene-input"].result as {
      settingsSnapshot: Record<string, unknown>;
    };
    sceneInput.settingsSnapshot.visualStyle = "photoreal";

    const restored = sanitizeTimelineWorkflowState(persisted) as TimelineWorkflowState;

    expect(restored.generationConfirmed).toBe(false);
    expect(restored.nodes["scene-input"]).toMatchObject({
      status: "manual",
      result: {
        settingsSnapshot: { visualStyle: "photoreal" },
      },
    });
    for (const nodeId of [
      "scene-prompt",
      "preview-execution",
      "preview-scoring",
      "comfyui-execution",
      "result-display",
    ] as const) {
      expect(restored.nodes[nodeId].status, nodeId).not.toBe("done");
    }
  });

  it("keeps completed policy-v1 results read-only but revokes an incomplete policy-v1 confirmation", () => {
    const makeV1 = () => {
      const raw = JSON.parse(JSON.stringify(createPersistedV2GenerationWorkflow(1))) as TimelineWorkflowState;
      const gate = raw.nodes["generation-gate"].result as Record<string, unknown>;
      gate.finalPolicyVersion = 1;
      const execution = raw.nodes["comfyui-execution"].result as {
        finalPolicy: { version: number; resizeMode: string };
        finals: Array<{ previewUpscale?: { policyVersion: number }; finalPolicy?: unknown }>;
      };
      execution.finalPolicy = { version: 1, resizeMode: "lanczos3-exact" };
      for (const item of execution.finals) {
        if (item.previewUpscale) item.previewUpscale.policyVersion = 1;
        delete item.finalPolicy;
      }
      return raw;
    };

    const completed = sanitizeTimelineWorkflowState(makeV1()) as TimelineWorkflowState;
    expect(completed.nodes["result-display"].status).toBe("done");

    const incompleteRaw = makeV1();
    incompleteRaw.nodes["result-display"].status = "blocked";
    incompleteRaw.nodes["result-display"].result = undefined;
    const incomplete = sanitizeTimelineWorkflowState(incompleteRaw) as TimelineWorkflowState;
    expect(incomplete.generationConfirmed).toBe(false);
    expect(incomplete.nodes["generation-gate"]).toMatchObject({
      status: "blocked",
      error: { code: "confirmation_required" },
    });
  });

  it.each([
    ["missing image", (result: Record<string, unknown>) => {
      delete result.image;
      delete result.images;
    }],
    ["arbitrary URL", (result: Record<string, unknown>) => {
      (result.images as Array<Record<string, unknown>>)[0]!.url = "https://attacker.invalid/final.png";
    }],
    ["unsafe filename", (result: Record<string, unknown>) => {
      (result.sourceImages as Array<Record<string, unknown>>)[0]!.filename = "../final.png";
    }],
    ["unsafe subfolder", (result: Record<string, unknown>) => {
      (result.sourceImages as Array<Record<string, unknown>>)[0]!.subfolder = "../private";
    }],
    ["unsafe prompt id", (result: Record<string, unknown>) => {
      result.promptId = "../../private/prompt";
    }],
    ["Windows drive-shaped path", (result: Record<string, unknown>) => {
      (result.sourceImages as Array<Record<string, unknown>>)[0]!.filename = "C:/private/final.png";
    }],
  ] as const)("fails closed for a completed legacy Run with %s", (_case, mutate) => {
    const completed = JSON.parse(JSON.stringify(createPersistedV2GenerationWorkflow(1))) as TimelineWorkflowState;
    delete (completed.nodes as Partial<typeof completed.nodes>)["preview-execution"];
    delete (completed.nodes as Partial<typeof completed.nodes>)["preview-scoring"];
    const result = completed.nodes["result-display"].result as Record<string, unknown>;
    mutate(result);

    const restored = sanitizeTimelineWorkflowState(completed) as TimelineWorkflowState;
    expect(restored.generationConfirmed).toBe(false);
    expect(restored.nodes["result-display"].status).not.toBe("done");
    expect(JSON.stringify(restored)).not.toContain("attacker.invalid");
    expect(JSON.stringify(restored)).not.toContain("../");
    expect(JSON.stringify(restored)).not.toContain("C:/private");
  });

  it("requires reconfirmation for an incomplete confirmed legacy Run", () => {
    const incomplete = JSON.parse(JSON.stringify(createPersistedV2GenerationWorkflow(1))) as TimelineWorkflowState;
    delete (incomplete.nodes as Partial<typeof incomplete.nodes>)["preview-execution"];
    delete (incomplete.nodes as Partial<typeof incomplete.nodes>)["preview-scoring"];
    incomplete.nodes["result-display"].status = "blocked";
    incomplete.nodes["result-display"].result = undefined;

    const restoredIncomplete = sanitizeTimelineWorkflowState(incomplete) as TimelineWorkflowState;
    expect(restoredIncomplete.generationConfirmed).toBe(false);
    expect(restoredIncomplete.nodes["generation-gate"]).toMatchObject({
      status: "blocked",
      error: { code: "confirmation_required" },
    });
    expect(restoredIncomplete.nodes["preview-execution"].status).toBe("blocked");
    expect(restoredIncomplete.nodes["preview-scoring"].status).toBe("blocked");
  });

  it("restores interrupted running nodes as visible errors", () => {
    const workflow = markTimelineNodeRunning(
      createTimelineWorkflowState({
        workflowId: "timeline-running",
        sceneRequest: "A running scene",
        now: () => "2026-06-05T00:00:00.000Z",
      }),
      "scene-prompt",
      { now: () => "2026-06-05T00:02:00.000Z" },
    );

    const parsed = sanitizeTimelineWorkflowRecord({
      kind: "sceneforge-timeline-workflow",
      version: 1,
      workflow,
      sceneRequest: "A running scene",
      selectedPromptProfile: "illustrious",
      selectedImageCount: 1,
      selectedNodeId: "scene-prompt",
      outputDisplayModes: {},
      createdAt: "2026-06-05T00:00:00.000Z",
      updatedAt: "2026-06-05T00:02:00.000Z",
    });
    expect(parsed && isSingleImageTimelineWorkflowRecord(parsed)).toBe(true);

    if (!parsed || !isSingleImageTimelineWorkflowRecord(parsed)) {
      throw new Error("Expected a single-image timeline record.");
    }

    expect(parsed?.workflow.nodes["scene-prompt"]).toMatchObject({
      status: "error",
      error: {
        code: "timeline_node_failed",
        message: "This node was interrupted while the workflow was away. Rerun it to continue.",
      },
    });
  });

  it("round-trips story graph records with result references and recoverable shot errors", () => {
    const workflow = startStoryGraphWorkflow({
      rawIntent: "A courier follows a signal through a neon market.",
      targetShotCount: 2,
      now: () => "2026-06-15T00:00:00.000Z",
      settingsSnapshot: {
        promptProfile: "anima",
      },
    });
    const storyWorkflow = {
      ...workflow,
      generationConfirmed: true,
      nodes: {
        ...workflow.nodes,
        "shot-graph-execution": {
          nodeId: "shot-graph-execution",
          status: "running",
          source: "system",
          updatedAt: "2026-06-15T00:02:00.000Z",
          result: {
            storyId: workflow.storyId,
            mode: "final",
            status: "running",
            readyShotIds: [],
            staleShotIds: ["shot-2"],
            errors: [],
            updatedAt: "2026-06-15T00:02:00.000Z",
            shots: [
              {
                shotId: "shot-1",
                sourceShotIds: [],
                status: "running",
                updatedAt: "2026-06-15T00:02:00.000Z",
                queueMetadata: {
                  promptId: "prompt-shot-1",
                  warnings: [],
                  apiKey: "secret-shot-key",
                  cachePath: "C:/Users/Brandon/Workspace/SceneForge/data/civitai-lora-library/cache/model.json",
                  logPath: "C:/Users/Brandon/Workspace/SceneForge/data/logs/llm-chat.jsonl",
                  sqliteFile: "C:/Users/Brandon/Workspace/SceneForge/data/sceneforge.sqlite",
                  downloadedModelPath: "C:/Users/Brandon/Workspace/SceneForge/data/civitai-lora-library/models/downloaded-model.safetensors",
                },
                resultReference: {
                  completed: true,
                  image: {
                    filename: "shot-1.png",
                    nodeId: "9",
                    type: "output",
                    url: "data:image/png;base64,SHOULD_NOT_PERSIST",
                  },
                  promptId: "prompt-shot-1",
                  shotId: "shot-1",
                  storedImage: {
                    byteLength: 12,
                    contentType: "image/png",
                    filename: "shot-1.png",
                    url: "/api/comfyui/generated-images/shot-1.png",
                  },
                  warnings: [],
                },
              },
              {
                shotId: "shot-2",
                sourceShotIds: ["shot-1"],
                status: "stale",
                updatedAt: "2026-06-15T00:02:00.000Z",
              },
              {
                shotId: "shot-queued",
                sourceShotIds: [],
                status: "queued",
                updatedAt: "2026-06-15T00:02:00.000Z",
                queueMetadata: {
                  promptId: "prompt-queued",
                  warnings: [],
                },
              },
            ],
          },
        },
        "story-result-display": {
          nodeId: "story-result-display",
          status: "done",
          source: "system",
          updatedAt: "2026-06-15T00:02:00.000Z",
          result: {
            storyId: workflow.storyId,
            status: "partial",
            nsfwContext: {
              audienceRating: "safe",
              contentWarnings: [],
              enabled: false,
              rationale: "Safe test context.",
            },
            previewReferences: [
              {
                promptId: "preview-prompt",
                shotId: "shot-1",
                image: {
                  filename: "preview-shot-1.png",
                  nodeId: "9",
                  url: "/api/comfyui/generated-images/preview-shot-1.png",
                },
                warnings: [],
              },
            ],
            finalReferences: [
              {
                completed: true,
                promptId: "final-prompt",
                shotId: "shot-1",
                image: {
                  filename: "final-shot-1.png",
                  nodeId: "9",
                  url: "/api/comfyui/generated-images/final-shot-1.png",
                },
                warnings: [],
              },
            ],
            errors: [],
            envLocal: "should-not-persist",
          },
        },
      },
    } satisfies typeof workflow;

    const record = createTimelineWorkflowRecord({
      projectId: "story-workflow-project",
      name: "Story workflow",
      workflow: storyWorkflow,
      sceneRequest: "A courier follows a signal through a neon market.",
      selectedPromptProfile: "anima",
      selectedImageCount: 2,
      selectedNodeId: "shot-graph-execution",
      selectedStoryShotId: "shot-1",
      outputDisplayModes: {
        "shot-graph-execution": "visual",
        "story-result-display": "json",
      },
    });
    const serialized = serializeTimelineWorkflowRecord(record);

    expect(serialized).not.toContain("secret-shot-key");
    expect(serialized).not.toContain("SHOULD_NOT_PERSIST");
    expect(serialized).not.toContain("should-not-persist");
    expect(serialized).not.toContain("sceneforge.sqlite");
    expect(serialized).not.toContain("downloaded-model.safetensors");
    expect(serialized).not.toContain("llm-chat.jsonl");
    expect(serialized).toContain("[redacted]");

    const parsed = parseTimelineWorkflowRecordJson(serialized);
    expect(parsed && isStoryGraphTimelineWorkflowRecord(parsed)).toBe(true);

    if (!parsed || !isStoryGraphTimelineWorkflowRecord(parsed)) {
      throw new Error("Expected a Story Graph timeline record.");
    }

    expect(parsed).toMatchObject({
      kind: "sceneforge-timeline-workflow",
      version: 1,
      definitionVersion: 1,
      projectId: "story-workflow-project",
      name: "Story workflow",
      sceneRequest: "A courier follows a signal through a neon market.",
      selectedPromptProfile: "anima",
      selectedImageCount: 2,
      selectedNodeId: "shot-graph-execution",
      selectedStoryShotId: "shot-1",
      outputDisplayModes: {
        "shot-graph-execution": "visual",
        "story-result-display": "json",
      },
      workflow: {
        workflowMode: "story-graph",
        storyId: workflow.storyId,
      },
    });
    expect(parsed.workflow.nodes["story-input"].result).toMatchObject({
      rawIntent: "A courier follows a signal through a neon market.",
      targetShotCount: 2,
    });
    expect(parsed.workflow.nodes["story-bible"].result).toMatchObject({
      logline: "A courier follows a signal through a neon market.",
    });
    expect((parsed.workflow.nodes["shot-graph-execution"].result as { errors?: unknown[] }).errors).toHaveLength(2);
    expect(parsed.workflow.nodes["shot-graph-execution"]).toMatchObject({
      status: "error",
      error: {
        code: "timeline_node_failed",
      },
      result: {
        status: "error",
        staleShotIds: ["shot-2"],
        shots: [
          {
            shotId: "shot-1",
            status: "error",
            error: {
              code: "shot_execution_failed",
              details: {
                interruptedStatus: "running",
                recoverable: true,
              },
            },
            queueMetadata: {
              apiKey: "[redacted]",
              cachePath: "[redacted]",
              downloadedModelPath: "[redacted]",
              logPath: "[redacted]",
              sqliteFile: "[redacted]",
            },
            resultReference: {
              image: {
                url: "[redacted]",
              },
              storedImage: {
                filename: "shot-1.png",
                url: "/api/comfyui/generated-images/shot-1.png",
              },
            },
          },
          {
            shotId: "shot-2",
            status: "stale",
          },
          {
            shotId: "shot-queued",
            status: "error",
            error: {
              code: "shot_execution_failed",
              details: {
                interruptedStatus: "queued",
                recoverable: true,
              },
            },
          },
        ],
      },
    });
    expect(parsed.workflow.nodes["story-result-display"].result).toMatchObject({
      previewReferences: [
        {
          promptId: "preview-prompt",
          shotId: "shot-1",
        },
      ],
      finalReferences: [
        {
          promptId: "final-prompt",
          shotId: "shot-1",
        },
      ],
      envLocal: "[redacted]",
    });
  });

  it("restores legacy Story input records with disabled detailer defaults", () => {
    const workflow = startStoryGraphWorkflow({
      rawIntent: "A courier follows a signal through a neon market.",
      targetShotCount: 2,
      now: () => "2026-06-15T00:00:00.000Z",
      settingsSnapshot: {
        promptProfile: "illustrious",
      },
    });
    const storyInput = workflow.nodes["story-input"].result as {
      settingsSnapshot?: Record<string, unknown>;
    };
    if (storyInput.settingsSnapshot) {
      delete storyInput.settingsSnapshot.detailers;
    }

    const record = createTimelineWorkflowRecord({
      workflow,
      sceneRequest: "A courier follows a signal through a neon market.",
      selectedPromptProfile: "illustrious",
      selectedImageCount: 2,
      selectedNodeId: "story-input",
      outputDisplayModes: {},
    });

    if (!isStoryGraphTimelineWorkflowRecord(record)) {
      throw new Error("Expected a Story Graph workflow record.");
    }

    expect(record.workflow.nodes["story-input"].result).toMatchObject({
      settingsSnapshot: {
        detailers: {
          faceDetailer: { enabled: false },
          handDetailer: { enabled: false },
        },
      },
    });
  });

  it("round-trips Story style reference metadata without persisting image bytes", () => {
    const workflow = startStoryGraphWorkflow({
      rawIntent: "A courier follows a signal through a neon market.",
      targetShotCount: 2,
      now: () => "2026-06-15T00:00:00.000Z",
      settingsSnapshot: {
        promptProfile: "illustrious",
        styleReference: readyStyleReference,
      },
    });
    const record = createTimelineWorkflowRecord({
      workflow,
      sceneRequest: "A courier follows a signal through a neon market.",
      selectedPromptProfile: "illustrious",
      selectedImageCount: 2,
      selectedNodeId: "story-input",
      outputDisplayModes: {},
    });
    const serialized = serializeTimelineWorkflowRecord(record);
    const parsed = parseTimelineWorkflowRecordJson(serialized);

    expect(serialized).not.toContain("data:image");
    expect(serialized).not.toContain("base64");
    if (!parsed || !isStoryGraphTimelineWorkflowRecord(parsed)) {
      throw new Error("Expected a Story Graph workflow record.");
    }

    expect(parsed.workflow.nodes["story-input"].result).toMatchObject({
      settingsSnapshot: {
        styleReference: {
          status: "ready",
          mode: "ipadapter",
          metadata: {
            filename: "story-style.png",
            storedFilename: "0123456789abcdef0123456789abcdef.png",
          },
          analysis: {
            stylePrompt: "soft watercolor anime rendering, clean pencil linework, pastel highlights",
          },
          ipAdapter: {
            weight: 0.45,
            startPercent: 0,
            endPercent: 1,
          },
        },
      },
    });
  });

  it("sanitizes crafted Story style reference metadata on restored workflow records", () => {
    const workflow = startStoryGraphWorkflow({
      rawIntent: "A courier follows a signal through a neon market.",
      targetShotCount: 2,
      now: () => "2026-06-15T00:00:00.000Z",
      settingsSnapshot: {
        promptProfile: "illustrious",
        styleReference: readyStyleReference,
      },
    });
    const record = createTimelineWorkflowRecord({
      workflow,
      sceneRequest: "A courier follows a signal through a neon market.",
      selectedPromptProfile: "illustrious",
      selectedImageCount: 2,
      selectedNodeId: "story-input",
      outputDisplayModes: {},
    });
    const rawRecord = JSON.parse(JSON.stringify(record)) as {
      workflow: {
        nodes: {
          "story-input": {
            result: {
              settingsSnapshot: {
                styleReference: {
                  metadata: {
                    filename?: string;
                    url?: string;
                  };
                };
              };
            };
          };
        };
      };
    };
    rawRecord.workflow.nodes["story-input"].result.settingsSnapshot.styleReference.metadata = {
      ...rawRecord.workflow.nodes["story-input"].result.settingsSnapshot.styleReference.metadata,
      filename: "C:\\Users\\Brandon\\Workspace\\SceneForge\\data\\style.png",
      url: "data:image/png;base64,SHOULD_NOT_PERSIST",
    };

    const parsed = sanitizeTimelineWorkflowRecord(rawRecord);
    const serialized = JSON.stringify(parsed);

    expect(serialized).not.toContain("data:image");
    expect(serialized).not.toContain("SHOULD_NOT_PERSIST");
    expect(serialized).not.toContain("C:\\Users");
    if (!parsed || !isStoryGraphTimelineWorkflowRecord(parsed)) {
      throw new Error("Expected a Story Graph workflow record.");
    }

    const storyInput = parsed.workflow.nodes["story-input"].result as {
      settingsSnapshot?: {
        styleReference?: {
          metadata?: {
            filename?: string;
            storedFilename?: string;
            url?: string;
          };
        };
      };
    };
    expect(storyInput.settingsSnapshot?.styleReference?.metadata).toMatchObject({
      storedFilename: "0123456789abcdef0123456789abcdef.png",
      url: "/api/comfyui/sequence-references/0123456789abcdef0123456789abcdef.png",
    });
    expect(storyInput.settingsSnapshot?.styleReference?.metadata).not.toHaveProperty("filename");
  });

  it("rejects malformed active workflow records", () => {
    expect(sanitizeTimelineWorkflowRecord({})).toBeNull();
    expect(
      sanitizeTimelineWorkflowRecord({
        kind: "sceneforge-timeline-workflow",
        version: 1,
        workflow: { workflowId: "" },
      }),
    ).toBeNull();
  });

  it("keeps T10 active workflow records and invalid prompt profiles backward compatible", () => {
    const workflow = createTimelineWorkflowState({
      workflowId: "timeline-no-project-metadata",
      sceneRequest: "A backward compatible active draft",
      now: () => "2026-06-05T00:00:00.000Z",
    });
    const workflowWithSettingsProfile = createTimelineWorkflowState({
      workflowId: "timeline-invalid-selected-profile",
      sceneRequest: "A restored scene with old profile metadata",
      promptProfile: "illustrious",
      settingsSnapshot: {
        promptProfile: "anima",
      },
      now: () => "2026-06-05T00:00:00.000Z",
    });

    const parsed = sanitizeTimelineWorkflowRecord({
      kind: "sceneforge-timeline-workflow",
      version: 1,
      workflow,
      sceneRequest: "A backward compatible active draft",
      selectedPromptProfile: "illustrious",
      selectedImageCount: 1,
      selectedNodeId: "scene-input",
      outputDisplayModes: {},
      createdAt: "2026-06-05T00:00:00.000Z",
      updatedAt: "2026-06-05T00:00:00.000Z",
    });
    const record = createTimelineWorkflowRecord({
      workflow: workflowWithSettingsProfile,
      sceneRequest: "A restored scene with old profile metadata",
      selectedPromptProfile: "generic" as never,
      selectedImageCount: 1,
      selectedNodeId: "scene-input",
      outputDisplayModes: {},
    });
    const parsedInvalidProfile = sanitizeTimelineWorkflowRecord({
      kind: "sceneforge-timeline-workflow",
      version: 1,
      workflow: {
        workflowId: "timeline-invalid-old-profile",
        workflowMode: "single-image",
        createdAt: "2026-06-05T00:00:00.000Z",
        updatedAt: "2026-06-05T00:00:00.000Z",
        generationConfirmed: false,
        nodes: {
          "scene-input": {
            nodeId: "scene-input",
            status: "manual",
            result: {
              rawIntent: "A legacy generic profile scene",
              promptProfile: "generic",
              imageCount: 1,
              settingsSnapshot: {
                promptProfile: "generic",
              },
            },
            source: "manual",
            updatedAt: "2026-06-05T00:00:00.000Z",
          },
        },
      },
      sceneRequest: "A legacy generic profile scene",
      selectedPromptProfile: "generic",
      selectedImageCount: 1,
      selectedNodeId: "scene-input",
      outputDisplayModes: {},
      createdAt: "2026-06-05T00:00:00.000Z",
      updatedAt: "2026-06-05T00:00:00.000Z",
    });

    expect(parsed).toMatchObject({
      workflow: {
        workflowId: "timeline-no-project-metadata",
      },
      sceneRequest: "A backward compatible active draft",
    });
    expect(parsed?.projectId).toBeUndefined();
    expect(parsed?.name).toBeUndefined();
    expect(record.selectedPromptProfile).toBe("anima");
    expect(parsedInvalidProfile).not.toBeNull();
    expect(parsedInvalidProfile?.selectedPromptProfile).toBe("illustrious");
  });

  it("restores legacy workflow state without workflow mode as single-image", () => {
    const parsed = sanitizeTimelineWorkflowRecord({
      kind: "sceneforge-timeline-workflow",
      version: 1,
      workflow: {
        workflowId: "timeline-legacy-no-mode",
        createdAt: "2026-06-05T00:00:00.000Z",
        updatedAt: "2026-06-05T00:00:00.000Z",
        generationConfirmed: false,
        nodes: {
          "scene-input": {
            nodeId: "scene-input",
            status: "manual",
            result: {
              rawIntent: "A legacy scene",
              promptProfile: "illustrious",
              imageCount: 1,
            },
            source: "manual",
            updatedAt: "2026-06-05T00:00:00.000Z",
          },
        },
      },
      sceneRequest: "A legacy scene",
      selectedPromptProfile: "illustrious",
      selectedImageCount: 1,
      selectedNodeId: "scene-input",
      outputDisplayModes: {},
      createdAt: "2026-06-05T00:00:00.000Z",
      updatedAt: "2026-06-05T00:00:00.000Z",
    });
    expect(parsed && isSingleImageTimelineWorkflowRecord(parsed)).toBe(true);

    if (!parsed || !isSingleImageTimelineWorkflowRecord(parsed)) {
      throw new Error("Expected a single-image timeline record.");
    }

    expect(parsed?.workflow.workflowMode).toBe("single-image");
    expect(parsed?.workflow.nodes["scene-prompt"].status).toBe("ready");
    expect(parsed?.workflow.nodes["generation-gate"].status).toBe("blocked");
  });
});
