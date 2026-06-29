import { describe, expect, it } from "vitest";

import {
  completeTimelineNode,
  createTimelineWorkflowState,
  markTimelineNodeRunning,
} from "./state";
import { evaluateStoryReferenceAssetFreezeGate } from "./story-reference-assets";
import {
  createTimelineWorkflowRecord,
  isStoryGraphTimelineWorkflowRecord,
  isSingleImageTimelineWorkflowRecord,
  parseTimelineWorkflowRecordJson,
  sanitizeTimelineWorkflowRecord,
  serializeTimelineWorkflowRecord,
} from "./timeline-workflow-persistence";
import { startStoryGraphWorkflow } from "./story-input";
import type { StoryReferenceAssetPlan } from "./story-types";

function createReferenceEraStoryWorkflow() {
  const workflow = startStoryGraphWorkflow({
    rawIntent: "A courier follows a signal through a neon market.",
    targetShotCount: 2,
    now: () => "2026-06-29T00:00:00.000Z",
    settingsSnapshot: {
      promptProfile: "anima",
    },
  });
  const baseReferencePlan = workflow.nodes["reference-asset-plan"].result as StoryReferenceAssetPlan;
  const referencePlan: StoryReferenceAssetPlan = {
    ...baseReferencePlan,
    assets: baseReferencePlan.assets.map((asset, index) => {
      if (index === 0) {
        return {
          ...asset,
          canonicalPrompt: `${asset.canonicalPrompt}, scarlet scarf`,
          canonicalPromptRevision: 2,
          resolutionState: "approved",
          approval: {
            approvedAssetReferenceId: "generated-face-ref",
            approvedAt: "2026-06-29T00:02:00.000Z",
            approvedBy: "user",
            source: "generated",
          },
          approvedAssetReference: {
            canonicalPromptRevision: 2,
            contentType: "image/png",
            createdAt: "2026-06-29T00:01:30.000Z",
            filename: "face-reference.png",
            id: "generated-face-ref",
            metadata: {
              apiKey: "reference-secret",
              checkpointResourceId: "checkpoint-a",
              dataUrl: "data:image/png;base64,SHOULD_NOT_PERSIST",
              generatedBytes: "SHOULD_NOT_PERSIST_BYTES",
              height: 1024,
              loraResourceIds: ["lora-a"],
              positivePrompt: "clean face reference plate",
              promptId: "prompt-face",
              referenceId: asset.id,
              warnings: ["Anima reference plate generated with fallback sampler."],
              width: 1024,
              workflowProfile: "anima",
            },
            source: "generated",
            url: "/api/comfyui/generated-images/face-reference.png",
          },
          candidateAssetReferences: [
            {
              canonicalPromptRevision: 2,
              contentType: "image/png",
              createdAt: "2026-06-29T00:01:30.000Z",
              filename: "face-reference.png",
              id: "generated-face-ref",
              metadata: {
                checkpointResourceId: "checkpoint-a",
                positivePrompt: "clean face reference plate",
                promptId: "prompt-face",
                referenceId: asset.id,
                warnings: ["Anima reference plate generated with fallback sampler."],
                width: 1024,
                workflowProfile: "anima",
              },
              source: "generated",
              url: "/api/comfyui/generated-images/face-reference.png",
            },
          ],
        };
      }

      if (index === 1) {
        return {
          ...asset,
          resolutionState: "prompt-only",
          promptOnlyFallback: {
            decidedAt: "2026-06-29T00:03:00.000Z",
            decidedBy: "user",
            reason: "Use canonical prompt text for the bust reference in this draft.",
          },
        };
      }

      if (asset.referenceType === "outfit") {
        return {
          ...asset,
          resolutionState: "rejected",
          rejection: {
            rejectedAt: "2026-06-29T00:04:00.000Z",
            rejectedBy: "user",
            reason: "Outfit reference is not needed for this draft.",
          },
        };
      }

      return {
        ...asset,
        resolutionState: "failed",
        failure: {
          code: "comfyui_upstream",
          failedAt: "2026-06-29T00:05:00.000Z",
          message: "ComfyUI was unavailable while generating a location reference.",
          recoverable: true,
          recoverableActions: ["reroll", "upload", "prompt-only"],
        },
      };
    }),
  };
  const renderPlan = workflow.nodes["story-render-plan"].result as {
    shots: Array<Record<string, unknown>>;
    [key: string]: unknown;
  };
  const renderPlanWithReferences = {
    ...renderPlan,
    shots: renderPlan.shots.map((shot, index) => ({
      ...shot,
      locationContinuity: index === 1
        ? {
            mode: "source-image",
            notes: ["Use the opening frame as the executable location source."],
            reason: "Shot 2 continues the same market location from shot 1.",
            sourceShotIds: ["shot-1"],
          }
        : {
            mode: "prompt-only",
            notes: ["Establish the location in prompt text."],
            reason: "Opening shot establishes the setting without source image input.",
            sourceShotIds: [],
          },
      referenceRecipe: {
        summary: "Use resolved character references and prompt-only fallback notes for this shot.",
        referenceIds: referencePlan.assets.map((asset) => asset.id),
        approvedReferenceIds: [referencePlan.assets[0].id],
        promptOnlyReferenceIds: [referencePlan.assets[1].id],
        unresolvedReferenceIds: referencePlan.assets.slice(2).map((asset) => asset.id),
        notes: ["Approved face reference can guide Anima final generation."],
      },
      sourceShotIds: index === 1 ? ["shot-1"] : [],
    })),
  };
  const assetFreezeGate = evaluateStoryReferenceAssetFreezeGate(referencePlan);
  const generationGate = {
    ...(workflow.nodes["generation-gate"].result as Record<string, unknown>),
    assetFreezeGate,
    blockingReason: "Confirm generation to start shot graph execution.",
    executionAvailable: true,
    ready: true,
    requestPreview: (workflow.nodes["generation-gate"].result as { requestPreview: unknown[] }).requestPreview,
  };

  return {
    ...workflow,
    nodes: {
      ...workflow.nodes,
      "reference-asset-plan": {
        ...workflow.nodes["reference-asset-plan"],
        result: referencePlan,
        status: "done" as const,
      },
      "story-render-plan": {
        ...workflow.nodes["story-render-plan"],
        result: renderPlanWithReferences,
        status: "done" as const,
      },
      "generation-gate": {
        ...workflow.nodes["generation-gate"],
        result: generationGate,
        status: "done" as const,
      },
    },
  };
}

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

  it("serializes Story reference asset state without generated bytes or secrets", () => {
    const workflow = startStoryGraphWorkflow({
      rawIntent: "A courier follows a signal through a neon market.",
      targetShotCount: 2,
      now: () => "2026-06-29T00:00:00.000Z",
      settingsSnapshot: {
        promptProfile: "anima",
      },
    });
    const referencePlan = workflow.nodes["reference-asset-plan"].result as {
      assets: Array<Record<string, unknown>>;
    };
    const storyWorkflow = {
      ...workflow,
      nodes: {
        ...workflow.nodes,
        "reference-asset-plan": {
          ...workflow.nodes["reference-asset-plan"],
          result: {
            ...referencePlan,
            assets: referencePlan.assets.map((asset, index) =>
              index === 0
                ? {
                    ...asset,
                    resolutionState: "generated",
                    approval: {
                      approvedAssetReferenceId: "generated-ref",
                      approvedAt: "2026-06-29T00:02:00.000Z",
                      approvedBy: "user",
                      source: "generated",
                    },
                    approvedAssetReference: {
                      id: "generated-ref",
                      source: "generated",
                      filename: "reference.png",
                      url: "/api/comfyui/generated-images/reference.png",
                    },
                    candidateAssetReferences: [
                      {
                        id: "generated-ref",
                        source: "generated",
                        filename: "reference.png",
                        url: "/api/comfyui/generated-images/reference.png",
                        metadata: {
                          apiKey: "reference-secret",
                          checkpointResourceId: ".env.local",
                          dataUrl: "data:image/png;base64,SHOULD_NOT_PERSIST",
                          generatedBytes: "SHOULD_NOT_PERSIST_BYTES",
                          loraResourceIds: [
                            "C:/Users/Brandon/Workspace/SceneForge/data/civitai-lora-library/models/reference-lora.safetensors",
                          ],
                          negativePrompt: "data:image/png;base64,NEGATIVE_PROMPT_BYTES",
                          positivePrompt: "clean reference plate",
                          warnings: [
                            "C:/Users/Brandon/Workspace/SceneForge/data/logs/reference-generation.log",
                          ],
                        },
                      },
                    ],
                    promptOnlyFallback: {
                      decidedAt: "2026-06-29T00:03:00.000Z",
                      decidedBy: "user",
                      reason: "User chose prompt-only fallback after review.",
                    },
                  }
                : asset,
            ),
          },
        },
      },
    } satisfies typeof workflow;
    const record = createTimelineWorkflowRecord({
      workflow: storyWorkflow,
      sceneRequest: "A courier follows a signal through a neon market.",
      selectedPromptProfile: "anima",
      selectedImageCount: 2,
      selectedNodeId: "reference-asset-plan",
    });
    const serialized = serializeTimelineWorkflowRecord(record);

    expect(serialized).not.toContain("reference-secret");
    expect(serialized).not.toContain("SHOULD_NOT_PERSIST");
    expect(serialized).not.toContain("SHOULD_NOT_PERSIST_BYTES");
    expect(serialized).not.toContain("NEGATIVE_PROMPT_BYTES");
    expect(serialized).not.toContain("reference-lora.safetensors");
    expect(serialized).not.toContain("reference-generation.log");
    expect(serialized).not.toContain(".env.local");
    expect(serialized).toContain("clean reference plate");
    expect(serialized).not.toContain("generatedBytes");
    expect(serialized).not.toContain("dataUrl");
  });

  it("redacts unsafe Story Reference metadata, render recipe, continuity, and temp payload fields", () => {
    const workflow = createReferenceEraStoryWorkflow();
    const referencePlan = workflow.nodes["reference-asset-plan"].result as StoryReferenceAssetPlan;
    const renderPlan = workflow.nodes["story-render-plan"].result as {
      shots: Array<Record<string, unknown>>;
      [key: string]: unknown;
    };
    const storyWorkflow = {
      ...workflow,
      nodes: {
        ...workflow.nodes,
        "reference-asset-plan": {
          ...workflow.nodes["reference-asset-plan"],
          result: {
            ...referencePlan,
            assets: referencePlan.assets.map((asset, index) => index === 0
              ? {
                  ...asset,
                  resolutionState: "generated",
                  candidateAssetReferences: [
                    {
                      id: "unsafe-generated-ref",
                      source: "generated",
                      filename: "unsafe-reference.png",
                      url: "/api/comfyui/generated-images/unsafe-reference.png",
                      metadata: {
                        checkpointResourceId: "C:/Users/Brandon/Workspace/SceneForge/data/sceneforge.sqlite",
                        dataUrl: "data:image/png;base64,METADATA_DATA_URL_SHOULD_NOT_PERSIST",
                        generatedBytes: "METADATA_BYTES_SHOULD_NOT_PERSIST",
                        loraResourceIds: [
                          "C:/Users/Brandon/Workspace/SceneForge/data/civitai-lora-library/resource-db.sqlite",
                        ],
                        negativePrompt: "data:image/png;base64,NEGATIVE_PROMPT_SHOULD_NOT_PERSIST",
                        positivePrompt: "safe reference prompt",
                        resourceDatabaseContents: "RESOURCE_DB_CONTENT_SHOULD_NOT_PERSIST",
                        warnings: [
                          "-----BEGIN PRIVATE KEY-----\nprivate-key-content\n-----END PRIVATE KEY-----",
                        ],
                      },
                    },
                    {
                      id: "unsafe-temp-ref",
                      source: "generated",
                      filename: "C:/ComfyUI/temp/ref.png",
                      url: "http://127.0.0.1:8188/view?filename=ref.png&type=temp",
                    },
                  ],
                }
              : asset),
          },
        },
        "story-render-plan": {
          ...workflow.nodes["story-render-plan"],
          result: {
            ...renderPlan,
            shots: renderPlan.shots.map((shot, index) => index === 1
              ? {
                  ...shot,
                  locationContinuity: {
                    mode: "source-image",
                    notes: [
                      ".env.local",
                      "safe continuity note",
                    ],
                    reason: "C:/Users/Brandon/Workspace/SceneForge/data/logs/location-continuity.log",
                    sourceShotIds: ["shot-1"],
                  },
                  referenceRecipe: {
                    approvedReferenceIds: [referencePlan.assets[0].id],
                    notes: [
                      "data:image/png;base64,RECIPE_NOTE_SHOULD_NOT_PERSIST",
                      "C:/Users/Brandon/Workspace/SceneForge/data/civitai-lora-library/resource-db.sqlite",
                    ],
                    promptOnlyReferenceIds: [],
                    referenceIds: referencePlan.assets.map((asset) => asset.id),
                    summary: "C:/Users/Brandon/Workspace/SceneForge/data/cache/story-reference-cache.json",
                    unresolvedReferenceIds: referencePlan.assets.slice(1).map((asset) => asset.id),
                  },
                  resourceDatabaseContents: "SHOT_RESOURCE_DB_CONTENT_SHOULD_NOT_PERSIST",
                  sourceShotIds: ["shot-1"],
                  tempPayloadBase64: "TEMP_PAYLOAD_BASE64_SHOULD_NOT_PERSIST",
                  tempPayloadBytes: "TEMP_PAYLOAD_BYTES_SHOULD_NOT_PERSIST",
                }
              : shot),
          },
          status: "done" as const,
        },
      },
    };
    const serialized = serializeTimelineWorkflowRecord(createTimelineWorkflowRecord({
      workflow: storyWorkflow,
      sceneRequest: "A courier follows a signal through a neon market.",
      selectedPromptProfile: "anima",
      selectedImageCount: 2,
      selectedNodeId: "story-render-plan",
    }));

    expect(serialized).not.toContain("METADATA_DATA_URL_SHOULD_NOT_PERSIST");
    expect(serialized).not.toContain("METADATA_BYTES_SHOULD_NOT_PERSIST");
    expect(serialized).not.toContain("NEGATIVE_PROMPT_SHOULD_NOT_PERSIST");
    expect(serialized).not.toContain("RESOURCE_DB_CONTENT_SHOULD_NOT_PERSIST");
    expect(serialized).not.toContain("SHOT_RESOURCE_DB_CONTENT_SHOULD_NOT_PERSIST");
    expect(serialized).not.toContain("RECIPE_NOTE_SHOULD_NOT_PERSIST");
    expect(serialized).not.toContain("TEMP_PAYLOAD_BASE64_SHOULD_NOT_PERSIST");
    expect(serialized).not.toContain("TEMP_PAYLOAD_BYTES_SHOULD_NOT_PERSIST");
    expect(serialized).not.toContain("private-key-content");
    expect(serialized).not.toContain("resource-db.sqlite");
    expect(serialized).not.toContain("sceneforge.sqlite");
    expect(serialized).not.toContain("story-reference-cache.json");
    expect(serialized).not.toContain("location-continuity.log");
    expect(serialized).not.toContain("127.0.0.1");
    expect(serialized).not.toContain("C:/ComfyUI/temp/ref.png");
    expect(serialized).not.toContain(".env.local");
    expect(serialized).toContain("safe reference prompt");
    expect(serialized).toContain("safe continuity note");

    const parsed = parseTimelineWorkflowRecordJson(serialized);
    expect(parsed && isStoryGraphTimelineWorkflowRecord(parsed)).toBe(true);

    if (!parsed || !isStoryGraphTimelineWorkflowRecord(parsed)) {
      throw new Error("Expected a Story Graph timeline record.");
    }

    const sanitizedReferencePlan = parsed.workflow.nodes["reference-asset-plan"].result as StoryReferenceAssetPlan;
    expect(sanitizedReferencePlan.assets[0].candidateAssetReferences[0]?.metadata).toMatchObject({
      checkpointResourceId: "[redacted]",
      loraResourceIds: ["[redacted]"],
      negativePrompt: "[redacted]",
      positivePrompt: "safe reference prompt",
      warnings: ["[redacted]"],
    });
    expect(sanitizedReferencePlan.assets[0].candidateAssetReferences[1]).toMatchObject({
      filename: "[redacted]",
      url: "[redacted]",
    });

    const sanitizedRenderPlan = parsed.workflow.nodes["story-render-plan"].result as {
      shots: Array<{
        locationContinuity: { notes: string[]; reason: string; sourceShotIds: string[] };
        referenceRecipe: { notes: string[]; summary: string };
        resourceDatabaseContents?: string;
        tempPayloadBase64?: string;
        tempPayloadBytes?: string;
      }>;
    };
    expect(sanitizedRenderPlan.shots[1]).toMatchObject({
      locationContinuity: {
        notes: ["[redacted]", "safe continuity note"],
        reason: "[redacted]",
        sourceShotIds: ["shot-1"],
      },
      referenceRecipe: {
        notes: ["[redacted]"],
        summary: "[redacted]",
      },
      resourceDatabaseContents: "[redacted]",
      tempPayloadBase64: "[redacted]",
      tempPayloadBytes: "[redacted]",
    });
  });

  it("stales approved Story Reference refs restored from unmanaged ComfyUI temp locations", () => {
    const workflow = createReferenceEraStoryWorkflow();
    const referencePlan = workflow.nodes["reference-asset-plan"].result as StoryReferenceAssetPlan;
    const unsafeApprovedReference = {
      canonicalPromptRevision: 2,
      contentType: "image/png",
      createdAt: "2026-06-29T00:01:30.000Z",
      filename: "C:\\ComfyUI\\temp\\face-reference.png",
      id: "generated-face-ref",
      source: "generated" as const,
      url: "http://127.0.0.1:8188/view?filename=face-reference.png&type=temp",
    };
    const parsed = sanitizeTimelineWorkflowRecord({
      kind: "sceneforge-timeline-workflow",
      version: 1,
      workflow: {
        ...workflow,
        generationConfirmed: true,
        nodes: {
          ...workflow.nodes,
          "reference-asset-plan": {
            ...workflow.nodes["reference-asset-plan"],
            result: {
              ...referencePlan,
              assets: referencePlan.assets.map((asset, index) => index === 0
                ? {
                    ...asset,
                    approval: {
                      approvedAssetReferenceId: "generated-face-ref",
                      approvedAt: "2026-06-29T00:02:00.000Z",
                      approvedBy: "user",
                      source: "generated",
                    },
                    approvedAssetReference: unsafeApprovedReference,
                    candidateAssetReferences: [unsafeApprovedReference],
                    canonicalPromptRevision: 2,
                    resolutionState: "approved",
                  }
                : asset),
            },
            status: "done",
          },
        },
      },
      sceneRequest: "A courier follows a signal through a neon market.",
      selectedPromptProfile: "anima",
      selectedImageCount: 2,
      selectedNodeId: "reference-asset-plan",
      outputDisplayModes: {},
      createdAt: "2026-06-29T00:00:00.000Z",
      updatedAt: "2026-06-29T00:08:00.000Z",
    });
    expect(parsed && isStoryGraphTimelineWorkflowRecord(parsed)).toBe(true);

    if (!parsed || !isStoryGraphTimelineWorkflowRecord(parsed)) {
      throw new Error("Expected a Story Graph timeline record.");
    }

    const sanitizedReferencePlan = parsed.workflow.nodes["reference-asset-plan"].result as StoryReferenceAssetPlan;
    expect(JSON.stringify(parsed)).not.toContain("127.0.0.1");
    expect(JSON.stringify(parsed)).not.toContain("C:\\ComfyUI\\temp\\face-reference.png");
    expect(parsed.workflow.generationConfirmed).toBe(false);
    expect(parsed.workflow.nodes["reference-asset-plan"].status).toBe("stale");
    expect(sanitizedReferencePlan.assets[0]).toMatchObject({
      resolutionState: "stale",
      approvedAssetReference: {
        filename: "[redacted]",
        url: "[redacted]",
      },
      candidateAssetReferences: [
        {
          filename: "[redacted]",
          url: "[redacted]",
        },
      ],
    });
    expect(parsed.workflow.nodes["generation-gate"].status).toBe("stale");
    expect(parsed.workflow.nodes["shot-graph-execution"].status).toBe("blocked");
  });

  it("round-trips Story Reference decisions, render recipes, freeze gate, and execution warnings", () => {
    const workflow = createReferenceEraStoryWorkflow();
    const record = createTimelineWorkflowRecord({
      projectId: "story-reference-round-trip",
      name: "Story references",
      workflow,
      sceneRequest: "A courier follows a signal through a neon market.",
      selectedPromptProfile: "anima",
      selectedImageCount: 2,
      selectedNodeId: "generation-gate",
      selectedStoryShotId: "shot-2",
      outputDisplayModes: {
        "reference-asset-plan": "visual",
        "story-render-plan": "json",
      },
    });
    const serialized = serializeTimelineWorkflowRecord(record);

    expect(serialized).toContain("clean face reference plate");
    expect(serialized).toContain("source-image");
    expect(serialized).toContain("assetFreezeGate");
    expect(serialized).not.toContain("reference-secret");
    expect(serialized).not.toContain("SHOULD_NOT_PERSIST");
    expect(serialized).not.toContain("generatedBytes");
    expect(serialized).not.toContain("dataUrl");

    const parsed = parseTimelineWorkflowRecordJson(serialized);
    expect(parsed && isStoryGraphTimelineWorkflowRecord(parsed)).toBe(true);

    if (!parsed || !isStoryGraphTimelineWorkflowRecord(parsed)) {
      throw new Error("Expected a Story Graph timeline record.");
    }

    const referencePlan = parsed.workflow.nodes["reference-asset-plan"].result as StoryReferenceAssetPlan;
    expect(referencePlan.assets.map((asset) => asset.resolutionState)).toEqual([
      "approved",
      "prompt-only",
      "rejected",
      "failed",
    ]);
    expect(referencePlan.assets[0]).toMatchObject({
      canonicalPromptRevision: 2,
      approval: {
        approvedAssetReferenceId: "generated-face-ref",
        approvedBy: "user",
        source: "generated",
      },
      approvedAssetReference: {
        filename: "face-reference.png",
        metadata: {
          checkpointResourceId: "checkpoint-a",
          loraResourceIds: ["lora-a"],
          positivePrompt: "clean face reference plate",
          promptId: "prompt-face",
          warnings: ["Anima reference plate generated with fallback sampler."],
          workflowProfile: "anima",
        },
        url: "/api/comfyui/generated-images/face-reference.png",
      },
    });
    expect(referencePlan.assets[1].promptOnlyFallback).toMatchObject({
      decidedBy: "user",
      reason: "Use canonical prompt text for the bust reference in this draft.",
    });
    expect(referencePlan.assets[2].rejection).toMatchObject({
      rejectedBy: "user",
      reason: "Outfit reference is not needed for this draft.",
    });
    expect(referencePlan.assets[3].failure).toMatchObject({
      code: "comfyui_upstream",
      recoverable: true,
      recoverableActions: ["reroll", "upload", "prompt-only"],
    });

    const renderPlan = parsed.workflow.nodes["story-render-plan"].result as {
      shots: Array<{
        locationContinuity: { mode: string; sourceShotIds: string[] };
        referenceRecipe: {
          approvedReferenceIds: string[];
          promptOnlyReferenceIds: string[];
          unresolvedReferenceIds: string[];
        };
        shotId: string;
        sourceShotIds: string[];
      }>;
    };
    expect(renderPlan.shots[1]).toMatchObject({
      shotId: "shot-2",
      locationContinuity: {
        mode: "source-image",
        sourceShotIds: ["shot-1"],
      },
      sourceShotIds: ["shot-1"],
      referenceRecipe: {
        approvedReferenceIds: [referencePlan.assets[0].id],
        promptOnlyReferenceIds: [referencePlan.assets[1].id],
        unresolvedReferenceIds: [referencePlan.assets[2].id, referencePlan.assets[3].id],
      },
    });

    expect(parsed.workflow.nodes["generation-gate"].result).toMatchObject({
      ready: true,
      executionAvailable: true,
      assetFreezeGate: {
        ready: true,
        requiredReferenceCount: 2,
        resolvedRequiredReferenceCount: 2,
      },
    });
  });

  it("loads pre-reference Story Graph records without inventing reference readiness", () => {
    const workflow = createReferenceEraStoryWorkflow();
    const legacyNodes = { ...workflow.nodes };
    delete (legacyNodes as Partial<typeof workflow.nodes>)["entity-cards"];
    delete (legacyNodes as Partial<typeof workflow.nodes>)["reference-asset-plan"];

    const parsed = sanitizeTimelineWorkflowRecord({
      kind: "sceneforge-timeline-workflow",
      version: 1,
      workflow: {
        ...workflow,
        generationConfirmed: true,
        nodes: {
          ...legacyNodes,
          "generation-gate": {
            ...workflow.nodes["generation-gate"],
            result: {
              ready: true,
              executionAvailable: true,
              confirmationRequired: false,
            },
            status: "done",
          },
        },
      },
      sceneRequest: "A legacy story graph",
      selectedPromptProfile: "anima",
      selectedImageCount: 2,
      selectedNodeId: "generation-gate",
      outputDisplayModes: {},
      createdAt: "2026-06-29T00:00:00.000Z",
      updatedAt: "2026-06-29T00:02:00.000Z",
    });
    expect(parsed && isStoryGraphTimelineWorkflowRecord(parsed)).toBe(true);

    if (!parsed || !isStoryGraphTimelineWorkflowRecord(parsed)) {
      throw new Error("Expected a Story Graph timeline record.");
    }

    expect(parsed.workflow.generationConfirmed).toBe(false);
    expect(parsed.workflow.nodes["reference-asset-plan"].result).toBeUndefined();
    expect(parsed.workflow.nodes["generation-gate"]).toMatchObject({
      status: "stale",
      result: {
        ready: false,
        executionAvailable: false,
        assetFreezeGate: {
          ready: false,
          requiredReferenceCount: 0,
        },
      },
    });
    expect(parsed.workflow.nodes["shot-graph-execution"]).toMatchObject({
      status: "blocked",
      error: {
        code: "confirmation_required",
      },
    });
  });

  it("clears confirmed generation when a restored Story Reference freeze gate is valid but not ready", () => {
    const workflow = startStoryGraphWorkflow({
      rawIntent: "A courier follows a signal through a neon market.",
      targetShotCount: 2,
      now: () => "2026-06-29T00:00:00.000Z",
      settingsSnapshot: {
        promptProfile: "anima",
      },
    });
    const parsed = sanitizeTimelineWorkflowRecord({
      kind: "sceneforge-timeline-workflow",
      version: 1,
      workflow: {
        ...workflow,
        generationConfirmed: true,
        nodes: {
          ...workflow.nodes,
          "generation-gate": {
            ...workflow.nodes["generation-gate"],
            status: "done",
          },
          "shot-graph-execution": {
            ...workflow.nodes["shot-graph-execution"],
            status: "blocked",
          },
        },
      },
      sceneRequest: "A courier follows a signal through a neon market.",
      selectedPromptProfile: "anima",
      selectedImageCount: 2,
      selectedNodeId: "generation-gate",
      outputDisplayModes: {},
      createdAt: "2026-06-29T00:00:00.000Z",
      updatedAt: "2026-06-29T00:02:00.000Z",
    });
    expect(parsed && isStoryGraphTimelineWorkflowRecord(parsed)).toBe(true);

    if (!parsed || !isStoryGraphTimelineWorkflowRecord(parsed)) {
      throw new Error("Expected a Story Graph timeline record.");
    }

    expect(parsed.workflow.generationConfirmed).toBe(false);
    expect(parsed.workflow.nodes["generation-gate"].result).toMatchObject({
      ready: false,
      executionAvailable: false,
      assetFreezeGate: {
        ready: false,
      },
    });
    expect(parsed.workflow.nodes["shot-graph-execution"]).toMatchObject({
      status: "blocked",
      error: {
        code: "confirmation_required",
      },
    });
  });

  it("recovers interrupted reference generation by staling dependent Story nodes", () => {
    const workflow = createReferenceEraStoryWorkflow();
    const parsed = sanitizeTimelineWorkflowRecord({
      kind: "sceneforge-timeline-workflow",
      version: 1,
      workflow: {
        ...workflow,
        generationConfirmed: true,
        nodes: {
          ...workflow.nodes,
          "reference-asset-plan": {
            ...workflow.nodes["reference-asset-plan"],
            status: "running",
            updatedAt: "2026-06-29T00:06:00.000Z",
          },
          "shot-graph-execution": {
            ...workflow.nodes["shot-graph-execution"],
            status: "ready",
          },
        },
      },
      sceneRequest: "A courier follows a signal through a neon market.",
      selectedPromptProfile: "anima",
      selectedImageCount: 2,
      selectedNodeId: "reference-asset-plan",
      outputDisplayModes: {},
      createdAt: "2026-06-29T00:00:00.000Z",
      updatedAt: "2026-06-29T00:06:00.000Z",
    });
    expect(parsed && isStoryGraphTimelineWorkflowRecord(parsed)).toBe(true);

    if (!parsed || !isStoryGraphTimelineWorkflowRecord(parsed)) {
      throw new Error("Expected a Story Graph timeline record.");
    }

    expect(parsed.workflow.generationConfirmed).toBe(false);
    expect(parsed.workflow.nodes["reference-asset-plan"]).toMatchObject({
      status: "error",
      error: {
        code: "timeline_node_failed",
      },
    });
    expect(parsed.workflow.nodes["story-render-plan"].status).toBe("stale");
    expect(parsed.workflow.nodes["story-consistency-check"].status).toBe("stale");
    expect(parsed.workflow.nodes["generation-gate"].status).toBe("stale");
    expect(parsed.workflow.nodes["shot-graph-execution"]).toMatchObject({
      status: "blocked",
      error: {
        code: "confirmation_required",
      },
    });
  });

  it("stales partial reference-era render plans with invalid source-image continuity", () => {
    const workflow = createReferenceEraStoryWorkflow();
    const renderPlan = workflow.nodes["story-render-plan"].result as {
      shots: Array<Record<string, unknown>>;
      [key: string]: unknown;
    };
    const parsed = sanitizeTimelineWorkflowRecord({
      kind: "sceneforge-timeline-workflow",
      version: 1,
      workflow: {
        ...workflow,
        generationConfirmed: true,
        nodes: {
          ...workflow.nodes,
          "story-render-plan": {
            ...workflow.nodes["story-render-plan"],
            result: {
              ...renderPlan,
              shots: renderPlan.shots.map((shot, index) => index === 0
                ? {
                    ...shot,
                    locationContinuity: {
                      mode: "source-image",
                      reason: "Invalid future source should be recovered.",
                      notes: [],
                      sourceShotIds: ["shot-2"],
                    },
                    referenceRecipe: undefined,
                    sourceShotIds: ["shot-2"],
                  }
                : shot),
            },
            status: "done",
          },
        },
      },
      sceneRequest: "A courier follows a signal through a neon market.",
      selectedPromptProfile: "anima",
      selectedImageCount: 2,
      selectedNodeId: "story-render-plan",
      outputDisplayModes: {},
      createdAt: "2026-06-29T00:00:00.000Z",
      updatedAt: "2026-06-29T00:07:00.000Z",
    });
    expect(parsed && isStoryGraphTimelineWorkflowRecord(parsed)).toBe(true);

    if (!parsed || !isStoryGraphTimelineWorkflowRecord(parsed)) {
      throw new Error("Expected a Story Graph timeline record.");
    }

    const recoveredRenderPlan = parsed.workflow.nodes["story-render-plan"].result as {
      shots: Array<{ locationContinuity: { sourceShotIds: string[] }; referenceRecipe: unknown; sourceShotIds: string[] }>;
    };
    expect(parsed.workflow.generationConfirmed).toBe(false);
    expect(parsed.workflow.nodes["story-render-plan"].status).toBe("stale");
    expect(recoveredRenderPlan.shots[0]).toMatchObject({
      locationContinuity: {
        sourceShotIds: [],
      },
      sourceShotIds: [],
    });
    expect(recoveredRenderPlan.shots[0].referenceRecipe).toMatchObject({
      referenceIds: [],
      approvedReferenceIds: [],
      promptOnlyReferenceIds: [],
      unresolvedReferenceIds: [],
    });
    expect(parsed.workflow.nodes["generation-gate"].status).toBe("stale");
    expect(parsed.workflow.nodes["shot-graph-execution"].status).toBe("blocked");
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

  it("keeps T10 active workflow records without project metadata backward compatible", () => {
    const workflow = createTimelineWorkflowState({
      workflowId: "timeline-no-project-metadata",
      sceneRequest: "A backward compatible active draft",
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

    expect(parsed).toMatchObject({
      workflow: {
        workflowId: "timeline-no-project-metadata",
      },
      sceneRequest: "A backward compatible active draft",
    });
    expect(parsed?.projectId).toBeUndefined();
    expect(parsed?.name).toBeUndefined();
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
