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
  serializeTimelineWorkflowRecord,
} from "./timeline-workflow-persistence";
import { startStoryGraphWorkflow } from "./story-input";

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
      imageCount: 1,
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
