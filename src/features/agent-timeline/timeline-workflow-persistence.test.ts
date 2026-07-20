import { describe, expect, it } from "vitest";

import {
  completeTimelineNode,
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
import type { TimelineWorkflowState } from "./types";

const managedPreviewFilename = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png";
const managedFinalFilename = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png";

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
  workflow = completeTimelineNode(workflow, "scene-prompt", { positivePrompt: "persisted scene" }, "ai");
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
  }));
  workflow = completeTimelineNode(workflow, "preview-execution", {
    baseSeed: 100,
    candidateCount,
    finalCount,
    previewHeight: 512,
    previewWidth: 512,
    previewSteps: 10,
    candidates,
    successfulCount: candidateCount,
    warnings: [],
  }, "system");
  workflow = completeTimelineNode(workflow, "preview-scoring", {
    rubricVersion: 1,
    scores,
    selectedCandidateIds: selected.map((candidate) => candidate.candidateId),
    selectionSource: "ai",
  }, "ai");
  workflow = completeTimelineNode(workflow, "comfyui-execution", {
    completed: true,
    finalCount,
    finals,
    request: { checkpointName: "local.safetensors", positivePrompt: "persisted scene" },
    warnings: [],
  }, "system");
  workflow = completeTimelineNode(workflow, "result-display", {
    completed: true,
    image: { ...finals[0]!.sourceImage, url: finals[0]!.storedImage.url },
    images: finals.map((item) => ({ ...item.sourceImage, url: item.storedImage.url })),
    promptId: finals[0]!.promptId,
    sourceImage: finals[0]!.sourceImage,
    sourceImages: finals.map((item) => item.sourceImage),
    storedImage: finals[0]!.storedImage,
    storedImages: finals.map((item) => item.storedImage),
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
        },
      },
    },
  } satisfies TimelineWorkflowState;
}

type MutablePersistedPreviewScore = Record<string, unknown>;

type MutablePersistedPreviewScoring = {
  rubricVersion: unknown;
  scores: MutablePersistedPreviewScore[];
  selectedCandidateIds: unknown[];
  selectionSource: unknown;
};

function getMutablePersistedPreviewScoring(workflow: TimelineWorkflowState) {
  return workflow.nodes["preview-scoring"].result as MutablePersistedPreviewScoring;
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
  },
  dataUrl: "data:image/png;base64,SHOULD_NOT_PERSIST",
} as const;

describe("timeline workflow persistence", () => {
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
    let workflow = createTimelineWorkflowState({
      workflowId: "timeline-v2-previews",
      sceneRequest: "A scored preview run",
      imageCount: 1,
    });
    workflow = completeTimelineNode(workflow, "preview-execution", {
      baseSeed: 5,
      candidateCount: 4,
      finalCount: 1,
      previewHeight: 512,
      previewWidth: 512,
      previewSteps: 10,
      successfulCount: 4,
      candidates: [
        {
          candidateId: "preview-1",
          index: 0,
          seed: 5,
          status: "done",
          promptId: "preview-prompt",
          sourceImage: {
            filename: "preview-output.png",
            nodeId: "9",
            type: "output",
          },
          storedImage: {
            byteLength: 3,
            contentType: "image/png",
            filename: managedPreviewFilename,
            url: `/api/comfyui/generated-images/${managedPreviewFilename}`,
          },
          imageBytes: "data:image/png;base64,SECRET_PREVIEW",
          apiKey: "SECRET_API_KEY",
          downloadedModelPath: "C:\\private\\model.safetensors",
        },
        ...[2, 3, 4].map((number, index) => ({
          candidateId: `preview-${number}`,
          index: index + 1,
          seed: 5 + number - 1,
          status: "done",
          promptId: `preview-prompt-${number}`,
          sourceImage: {
            filename: `preview-output-${number}.png`,
            nodeId: "9",
            type: "output",
          },
          storedImage: managedStoredImage(number.toString(16)),
        })),
      ],
      warnings: [],
    }, "system");
    workflow = completeTimelineNode(workflow, "preview-scoring", {
      rubricVersion: 1,
      scores: [1, 2, 3, 4].map((number) => ({
        candidateId: `preview-${number}`,
        adherence: 91 - number,
        composition: 91 - number,
        anatomy: 91 - number,
        style: 91 - number,
        technical: 91 - number,
        total: 91 - number,
        rank: number,
      })),
      selectedCandidateIds: ["preview-1"],
      selectionSource: "ai",
    }, "ai");
    workflow = completeTimelineNode(workflow, "comfyui-execution", {
      completed: true,
      finalCount: 1,
      finals: [{
        candidateId: "preview-1",
        rank: 1,
        seed: 5,
        status: "done",
        promptId: "final-prompt",
        sourceImage: {
          filename: "final-output.png",
          nodeId: "9",
          type: "output",
        },
        storedImage: {
          byteLength: 4,
          contentType: "image/png",
          filename: managedFinalFilename,
          url: `/api/comfyui/generated-images/${managedFinalFilename}`,
        },
      }],
      request: { positivePrompt: "safe prompt" },
      warnings: [],
      workflow: { secretNode: { class_type: "SaveImage" } },
    }, "system");

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

    expect(restored.definitionVersion).toBe(2);
    expect(restored.workflow.nodes["preview-execution"].result).toMatchObject({
      candidates: expect.arrayContaining([
        expect.objectContaining({ storedImage: expect.objectContaining({ filename: managedPreviewFilename }) }),
      ]),
    });
    expect(restored.workflow.nodes["comfyui-execution"].result).toMatchObject({
      finals: [expect.objectContaining({ candidateId: "preview-1", storedImage: expect.objectContaining({ filename: managedFinalFilename }) })],
    });
    expect(restored.workflow.nodes["comfyui-execution"].result).not.toHaveProperty("workflow");
    expect(serialized).not.toContain("SECRET_PREVIEW");
    expect(serialized).not.toContain("SECRET_API_KEY");
    expect(serialized).not.toContain("C:\\private");
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
      scoring.rubricVersion = 2;
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
    const restoredCompleted = sanitizeTimelineWorkflowState(completed) as TimelineWorkflowState;
    expect(restoredCompleted.generationConfirmed).toBe(true);
    expect(restoredCompleted.nodes["result-display"]).toMatchObject({
      status: "done",
      result: {
        completed: true,
        storedImage: {
          filename: expect.stringMatching(/^[a-f0-9]{32}\.png$/),
          url: expect.stringMatching(/^\/api\/comfyui\/generated-images\/[a-f0-9]{32}\.png$/),
        },
      },
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
