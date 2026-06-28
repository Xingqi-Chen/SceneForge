import { describe, expect, it } from "vitest";

import {
  createStoryPromptHealth,
  createStoryNodeOutputSummary,
} from "./story-node-output-summary";
import {
  startStoryGraphWorkflow,
} from "./story-input";
import {
  storyWorkflowNodeIds,
} from "./story-types";

const resourceCandidates = {
  checkpoints: [
    {
      id: "checkpoint-local",
      name: "Local Checkpoint",
      baseModel: "Illustrious",
      modelFileName: "local.safetensors",
    },
  ],
  loras: [
    {
      id: "lora-local",
      name: "Local LoRA",
      baseModel: "Illustrious",
      modelFileName: "local-lora.safetensors",
      trainedWords: ["neon market"],
    },
  ],
};

describe("story node output summaries", () => {
  it("creates stable compact summaries for every Story workflow node", () => {
    const workflow = startStoryGraphWorkflow({
      rawIntent: "A two-shot courier story through a neon market.",
      targetShotCount: 2,
      storyId: "story-summary",
      workflowId: "workflow-summary",
      now: () => "2026-06-14T00:00:00.000Z",
      settingsSnapshot: {
        promptProfile: "illustrious",
        resourceCandidates,
      },
    });

    for (const nodeId of storyWorkflowNodeIds) {
      const summary = createStoryNodeOutputSummary(nodeId, workflow.nodes[nodeId].result);

      expect(summary.title).toBeTruthy();
      expect(summary.metrics.length + summary.sections.length).toBeGreaterThan(0);
    }

    expect(createStoryNodeOutputSummary("story-input", workflow.nodes["story-input"].result)).toMatchObject({
      metrics: expect.arrayContaining([
        { label: "Resources", value: "1 checkpoints, 1 LoRAs" },
      ]),
    });
    const dependencySummary = createStoryNodeOutputSummary(
      "shot-dependency-graph",
      workflow.nodes["shot-dependency-graph"].result,
    );
    expect(dependencySummary.sections[0]?.emptyState).toBe("No source-image dependencies.");
    expect(JSON.stringify(createStoryNodeOutputSummary("story-render-plan", workflow.nodes["story-render-plan"].result)))
      .toContain("Local Checkpoint");
    expect(createStoryNodeOutputSummary("generation-gate", workflow.nodes["generation-gate"].result).shotCards?.length)
      .toBeGreaterThan(0);
  });

  it("keeps long summary text readable without ellipsis truncation", () => {
    const tailMarker = "tail marker visible without opening edit artifact";
    const longIntent = [
      ...Array.from({ length: 40 }, (_, index) =>
        `Detailed story request segment ${index + 1} with character continuity, setting, camera, and lighting notes.`,
      ),
      tailMarker,
    ].join(" ");
    const summary = createStoryNodeOutputSummary("story-input", {
      audienceRating: "safe",
      rawIntent: longIntent,
      settingsSnapshot: {
        promptProfile: "anima",
        resourceCandidates,
      },
      storyId: "story-long-text",
      targetShotCount: 3,
    });
    const request = summary.sections
      .find((section) => section.title === "Story request")
      ?.fields
      ?.find((field) => field.label === "Request")
      ?.value;

    expect(request).toContain(tailMarker);
    expect(request).not.toContain("...");
  });

  it("labels planning-only dependency risk decisions separately from injected source images", () => {
    const summary = createStoryNodeOutputSummary("shot-dependency-graph", {
      storyId: "story-dependencies",
      nodes: [
        { shotId: "shot-1", label: "Opening" },
        { shotId: "shot-2", label: "Continuation" },
        { shotId: "shot-3", label: "Img2img carry-over" },
      ],
      edges: [
        {
          fromShotId: "shot-1",
          toShotId: "shot-2",
          reason: "continuity",
          sourceImageRisk: {
            factors: [],
            level: "low",
            reason: "Source shot appears compatible with loose img2img continuity.",
          },
        },
        {
          fromShotId: "shot-2",
          toShotId: "shot-3",
          reason: "img2img-source",
          sourceImageRisk: {
            factors: [],
            level: "low",
            reason: "Source shot appears compatible with loose img2img continuity.",
          },
        },
      ],
    });
    const riskRows = summary.sections.find((section) => section.title === "Source-image risk decisions")?.rows;

    expect(summary.metrics).toEqual(expect.arrayContaining([
      { label: "Injected source edges", value: "1" },
      { label: "Risk checks", value: "2" },
    ]));
    expect(riskRows?.[0]).toMatchObject({
      "edge reason": "continuity",
      mode: "Prompt-only continuity",
      "source image injected": "No",
      risk: "low",
    });
    expect(riskRows?.[1]).toMatchObject({
      "edge reason": "img2img-source",
      mode: "Source image injected",
      "source image injected": "Yes",
      risk: "low",
    });
  });

  it("formats render-plan Visual output as shot cards with prompt diagnostics and LLM warnings", () => {
    const longPositivePrompt = [
      "masterpiece",
      "best quality",
      "score_7",
      "safe",
      "1girl",
      "college-age art student with chin-length black bob and teal cardigan",
      "handmade book swap flyer mounted inside a magnetic clip frame",
      "one borrowed paperback on the small exchange shelf",
      "warm corridor light",
      "resident reader paused beside the notice board",
      "final prompt tail marker for inspection",
    ].join(", ");
    const summary = createStoryNodeOutputSummary("story-render-plan", {
      storyId: "story-summary",
      img2imgDenoise: 0.95,
      nsfwContext: { enabled: false },
      warnings: [
        "Using 1024x1536 because selected resource examples favor portrait composition.",
        "Keep continuity on Mara's mint cardigan and sketchbook.",
        'Shot "shot-1" uses high-risk source image "shot-0": High source-image risk: major pose/action change.',
        'Shot "shot-1" removed negative addition "borrowed paperback" because it conflicts with positive prompt anchor "one borrowed paperback on the small exchange shelf".',
      ],
      shots: [
        {
          shotId: "shot-1",
          order: 1,
          title: "Book Swap Begins",
          positivePrompt: longPositivePrompt,
          negativePrompt: "worst quality, bad anatomy, score_1, score_2, score_3, bad_hands, borrowed paperback, cropped flyer tail marker",
          sourceShotIds: ["shot-0"],
          sourceImageEdges: [
            {
              riskLevel: "high",
              riskReason: "High source-image risk: major pose/action change.",
              sourceChain: ["shot-0", "shot-1"],
              sourceShotId: "shot-0",
              targetShotId: "shot-1",
            },
          ],
          parameters: {
            width: 1024,
            height: 1024,
            steps: 36,
            cfg: 4.5,
            samplerName: "er_sde",
            scheduler: "simple",
            denoise: 1,
          },
          resourceRefs: {
            checkpointResourceId: "checkpoint-local",
            loraResourceIds: [],
          },
          outputAnchors: {},
          animaPromptParts: {
            subjectTags: ["1girl", "solo"],
            characterTags: ["college-age art student with chin-length black bob and teal cardigan"],
            seriesTags: ["library_story"],
            artistTags: ["@clean_linework"],
            propTags: ["handmade book swap flyer mounted inside a magnetic clip frame"],
            actionTags: ["resident reader paused beside the notice board"],
            settingTags: ["small exchange shelf in an apartment corridor"],
            cameraTags: ["eye-level medium shot"],
            lightingTags: ["warm corridor light"],
            singleFrameCaption: "A resident reader pauses beside the notice board.",
            negativeAdditions: ["cropped flyer tail marker"],
          },
        },
      ],
    });
    const card = summary.shotCards?.[0];

    expect(card).toMatchObject({
      dependencies: "source-image from shot-0",
      negativePrompt: expect.stringContaining("cropped flyer tail marker"),
      readinessLabel: "Warning",
      resources: "Resource plan",
      sceneBeat: expect.stringContaining("resident reader paused beside the notice board"),
      shotId: "shot-1",
      shotNumber: "1",
      title: "Book Swap Begins",
      visualPrompt: longPositivePrompt,
      warningDisplayMode: "llm-only",
      warnings: [
        'Shot "shot-1" removed negative addition "borrowed paperback" because it conflicts with positive prompt anchor "one borrowed paperback on the small exchange shelf".',
      ],
    });
    expect(card?.animaPromptParts).toEqual(expect.arrayContaining([
      { label: "Subject", value: "1girl, solo" },
      { label: "Series", value: "library_story" },
      { label: "Artist", value: "@clean_linework" },
      { label: "Caption", value: "A resident reader pauses beside the notice board." },
      { label: "Negative additions", value: "cropped flyer tail marker" },
    ]));
    expect(card?.visualPrompt).toContain("final prompt tail marker for inspection");
    expect(card?.visualPrompt).not.toContain("...");
    expect(card?.negativeConflicts).toEqual(expect.arrayContaining([
      '"borrowed paperback" conflicts with positive prompt anchor "one borrowed paperback on the small exchange shelf".',
    ]));
    expect(card?.removedNegatives).toEqual([
      'Removed "borrowed paperback" because it conflicts with "one borrowed paperback on the small exchange shelf".',
    ]);
    expect(card?.promptHealth).toMatchObject({
      label: "Warnings",
      tone: "warning",
      issues: expect.arrayContaining([
        expect.objectContaining({ label: "Negative conflict" }),
        expect.objectContaining({ label: "Removed negative conflict" }),
        expect.objectContaining({ label: "High source-image risk" }),
      ]),
    });
    expect(JSON.stringify(summary)).toContain("Negative conflict");
    expect(summary.metrics).toEqual(expect.arrayContaining([
      { label: "Warnings", value: "2" },
      { label: "Decision notes", value: "1" },
    ]));
    expect(summary.sections.find((section) => section.title === "Plan warnings")?.notes).toEqual([
      "Keep continuity on Mara's mint cardigan and sketchbook.",
      'Shot "shot-1" removed negative addition "borrowed paperback" because it conflicts with positive prompt anchor "one borrowed paperback on the small exchange shelf".',
    ]);
    expect(summary.sections.find((section) => section.title === "Decision notes")?.notes).toEqual([
      "Using 1024x1536 because selected resource examples favor portrait composition.",
    ]);
    expect(summary.sections.find((section) => section.title === "System diagnostics")?.notes).toEqual([
      'Shot "shot-1" uses high-risk source image "shot-0": High source-image risk: major pose/action change.',
    ]);
    expect(summary.sections.some((section) => section.title === "Final prompts")).toBe(false);
    expect(summary.sections.some((section) => section.title === "Prompt sections")).toBe(false);
  });

  it("flags prompt health edge cases for short prompts, missing details, conflicts, debug fragments, and source risk", () => {
    const health = createStoryPromptHealth({
      positivePrompt: 'girl, badge, shot-2, {"promptId":"debug"}, <lora:test:1>',
      negativePrompt: "badge",
      animaPromptParts: {},
      sourceImageEdges: [
        {
          riskLevel: "high",
          riskReason: "High source-image risk: close-up to wide framing.",
          sourceChain: ["shot-1", "shot-2"],
          sourceShotId: "shot-1",
          targetShotId: "shot-2",
        },
      ],
    });
    const labels = health.issues.map((issue) => issue.label);

    expect(health.tone).toBe("warning");
    expect(labels).toEqual(expect.arrayContaining([
      "Too short",
      "Missing identity",
      "Missing action",
      "Missing setting",
      "Missing camera",
      "Missing lighting",
      "Hardcoded LoRA tag",
      "Debug field fragment",
      "Shot id fragment",
      "JSON fragment",
      "Negative conflict",
      "High source-image risk",
    ]));
  });

  it("summarizes source-image risk metadata at the generation gate", () => {
    const summary = createStoryNodeOutputSummary("generation-gate", {
      storyId: "story-summary",
      ready: true,
      executionAvailable: true,
      confirmationRequired: true,
      nsfwContext: { enabled: false },
      renderPlanShotCount: 2,
      previewEnabled: false,
      requestPreview: [
        {
          shotId: "shot-1",
          title: "Standing",
          sourceMode: "none",
          sourceShotIds: [],
          sourceImageEdges: [],
          positivePromptPreview: "standing courier",
          positivePromptLength: 16,
          negativePromptPreview: "standing courier, bad_hands",
          negativePromptLength: 0,
          parameters: { width: 1024, height: 1024, steps: 28, cfg: 5.5, samplerName: "euler", scheduler: "normal", denoise: 1 },
        },
        {
          shotId: "shot-2",
          title: "Kneeling",
          sourceMode: "source-image",
          sourceShotIds: ["shot-1"],
          sourceImageEdges: [
            {
              executable: true,
              riskFactors: ["major pose/action change: standing to kneeling"],
              riskLevel: "high",
              riskReason: "High source-image risk: major pose/action change: standing to kneeling.",
              sourceChain: ["shot-1", "shot-2"],
              sourceShotId: "shot-1",
              targetShotId: "shot-2",
            },
          ],
          positivePromptPreview: "score_7, kneeling courier",
          positivePromptLength: 16,
          negativePromptPreview: "score_1, kneeling courier, bad_hands",
          negativePromptLength: 0,
          parameters: { width: 1024, height: 1024, steps: 28, cfg: 5.5, samplerName: "euler", scheduler: "normal", denoise: 0.9 },
        },
      ],
    });
    const sourceRisk = summary.sections.find((section) => section.title === "Source-image risk");

    expect(summary.metrics).toEqual(expect.arrayContaining([{ label: "Source risks", value: "1" }]));
    expect(summary.shotCards?.[1]).toMatchObject({
      dependencies: "source-image from shot-1",
      promptHealth: {
        label: "Warnings",
        tone: "warning",
        issues: expect.arrayContaining([
          expect.objectContaining({ label: "Negative conflict" }),
          expect.objectContaining({ label: "High source-image risk" }),
        ]),
      },
      readinessLabel: "Warning",
      sourceRisks: [
        expect.objectContaining({
          detail: expect.stringContaining("standing to kneeling"),
          level: "high",
        }),
      ],
      warningDisplayMode: "llm-only",
    });
    expect(summary.shotCards?.[1]?.negativeConflicts).toEqual(expect.arrayContaining([
      expect.stringContaining("kneeling courier"),
    ]));
    expect(sourceRisk?.rows?.[0]).toMatchObject({
      source: "shot-1",
      target: "shot-2",
      risk: "high",
      reason: expect.stringContaining("standing to kneeling"),
      chain: "shot-1, shot-2",
    });
  });

  it("omits ComfyUI node ids and temporary URLs from visual execution summaries", () => {
    const rawImage = {
      filename: "temp-preview.png",
      nodeId: "debug-node-9",
      subfolder: "debug",
      type: "temp",
      url: "http://127.0.0.1:8188/view?filename=temp-preview.png&type=temp&subfolder=debug",
    };
    const execution = {
      errors: [],
      mode: "final",
      readyShotIds: [],
      shots: [
        {
          queueMetadata: {
            nodeIds: { sampler: "debug-node-9" },
            outputNodeId: "debug-node-9",
            promptId: "prompt-shot-1",
            warnings: [],
          },
          resultReference: {
            completed: true,
            image: rawImage,
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
          shotId: "shot-1",
          sourceShotIds: [],
          status: "done",
        },
      ],
      staleShotIds: [],
      status: "done",
      storyId: "story-summary",
    };
    const resultDisplay = {
      errors: [],
      finalReferences: [
        {
          completed: true,
          image: rawImage,
          promptId: "prompt-shot-1",
          shotId: "shot-1",
          warnings: [],
        },
        {
          completed: true,
          image: rawImage,
          promptId: "prompt-shot-2",
          shotId: "shot-2",
          storedImage: {
            byteLength: 12,
            contentType: "image/png",
            filename: "shot-2.png",
            url: "/api/comfyui/generated-images/shot-2.png",
          },
          warnings: [],
        },
      ],
      previewReferences: [],
      status: "complete",
      storyId: "story-summary",
    };
    const rawJson = JSON.stringify({ execution, resultDisplay });
    const visualJson = JSON.stringify([
      createStoryNodeOutputSummary("shot-graph-execution", execution),
      createStoryNodeOutputSummary("story-result-display", resultDisplay),
    ]);

    expect(rawJson).toContain("debug-node-9");
    expect(rawJson).toContain("127.0.0.1:8188");
    expect(visualJson).not.toContain("debug-node-9");
    expect(visualJson).not.toContain("127.0.0.1:8188");
    expect(visualJson).not.toContain("prompt-shot-1");
    expect(visualJson).not.toContain("type=temp");
    expect(visualJson).toContain("temp-preview.png");
    expect(visualJson).toContain("/api/comfyui/generated-images/shot-2.png");
  });
});
