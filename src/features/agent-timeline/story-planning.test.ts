import { describe, expect, it } from "vitest";

import {
  assembleStoryRenderPlan,
  compileStoryAnimaPrompt,
  createStoryExecutionRequestBatch,
  createStoryDefaultGenerationParameters,
  createStoryGenerationRequestPreview,
  createStoryParameterPlan,
  createStoryPreviewParameters,
  createStoryResourcePlan,
  getStoryRenderPlanEligibleSourceShotIds,
  normalizeStoryAnimaPromptParts,
  StoryResourcePlanValidationError,
  type StoryGenerationParameters,
  type StoryLocalResource,
  type StoryParameterPlan,
  type StoryPreviewExecutionOptions,
} from "./story-planning";
import type { StoryReferenceAsset, StoryReferenceAssetPlan, StorySafetyPlan, StoryShot } from "./story-types";

const storyId = "story-1";

const shots = [
  {
    id: "shot-1",
    storyId,
    order: 1,
    title: "Arrival",
    description: "The lead enters the station.",
    characterIds: ["lead"],
    sourceShotIds: [],
    camera: "wide shot",
    promptIntent: "rainy station arrival",
    continuityNotes: [],
  },
  {
    id: "shot-2",
    storyId,
    order: 2,
    title: "Signal",
    description: "The lead notices a red signal.",
    characterIds: ["lead"],
    sourceShotIds: ["shot-1"],
    camera: "low close-up",
    promptIntent: "red signal reflected in a puddle",
    continuityNotes: ["Keep the raincoat visible."],
  },
] satisfies StoryShot[];

const safetyPlan = {
  storyId,
  audienceRating: "explicit",
  contentWarnings: ["adult-only tone"],
  blockedContent: ["graphic harm"],
  perShotNotes: [
    {
      shotId: "shot-2",
      risks: ["Could become graphic."],
      mitigations: ["Keep the scene symbolic."],
    },
  ],
  nsfwContext: {
    enabled: true,
    rationale: "User enabled mature story execution context.",
  },
} satisfies StorySafetyPlan;

const referenceAssetPlan = {
  storyId,
  planningNotes: ["Reference plan for render recipe tests."],
  assets: [
    {
      id: "character-face:lead",
      storyId,
      referenceType: "character-face",
      importance: "required",
      resolutionState: "approved",
      canonicalPrompt: "Lead face reference.",
      rationale: "Keep the lead identity stable.",
      sourceEntity: {
        id: "lead",
        name: "Lead",
        type: "character",
      },
      sourceShotIds: ["shot-1", "shot-2"],
      approvedAssetReference: {
        id: "approved-face",
        source: "uploaded",
        url: "/references/lead.png",
      },
      approval: {
        approvedAssetReferenceId: "approved-face",
        approvedBy: "user",
        source: "uploaded",
      },
      candidateAssetReferences: [],
    },
    {
      id: "location:station",
      storyId,
      referenceType: "location",
      importance: "optional",
      resolutionState: "prompt-only",
      canonicalPrompt: "Rainy station reference.",
      rationale: "Keep station anchors prompt-only.",
      sourceEntity: {
        id: "station",
        name: "Station",
        type: "location",
      },
      sourceShotIds: ["shot-1", "shot-2"],
      candidateAssetReferences: [],
      promptOnlyFallback: {
        decidedBy: "user",
        reason: "Use prompt-only location continuity.",
      },
    },
    {
      id: "prop:signal-card",
      storyId,
      referenceType: "prop",
      importance: "recommended",
      resolutionState: "stale",
      canonicalPrompt: "Red signal card.",
      rationale: "Prompt edit made the old prop candidate stale.",
      sourceEntity: {
        id: "signal-card",
        name: "Signal card",
        type: "prop",
      },
      sourceShotIds: ["shot-2"],
      candidateAssetReferences: [],
    },
  ],
} satisfies StoryReferenceAssetPlan;

const defaults = {
  width: 1024,
  height: 768,
  steps: 28,
  cfg: 5.5,
  samplerName: "dpmpp_2m",
  scheduler: "karras",
  denoise: 1,
} satisfies StoryGenerationParameters;

function checkpointResource(): StoryLocalResource {
  return {
    id: "checkpoint-local",
    name: "Local Checkpoint",
    baseModel: "Illustrious",
    modelFileName: "local.safetensors",
    nsfw: true,
    nsfwLevel: 5,
    modelNsfw: true,
  };
}

function loraResource(): StoryLocalResource {
  return {
    id: "lora-local",
    name: "Local LoRA",
    baseModel: "Illustrious",
    modelFileName: "local-lora.safetensors",
    trainedWords: ["wet platform"],
    nsfw: true,
    aiNsfwLevel: "explicit",
  };
}

function createResourcePlan() {
  const checkpoint = checkpointResource();
  const lora = loraResource();

  return createStoryResourcePlan({
    storyId,
    candidates: {
      checkpoints: [{ resource: checkpoint }],
      loras: [{ resource: lora }],
    },
    recommendation: {
      checkpoint: {
        resource: {
          ...checkpoint,
          nsfw: false,
          nsfwLevel: 0,
          modelNsfw: false,
        },
        reason: "Local match.",
      },
      loras: [
        {
          resource: {
            ...lora,
            nsfw: false,
            aiNsfwLevel: "safe",
          },
          suggestedWeight: 0.6,
          reason: "Local LoRA match.",
        },
      ],
      recommendationReason: "Use local story resources.",
      overallEffect: "Rainy cinematic panels.",
      warnings: [],
    },
  });
}

function createAnimaResourcePlan() {
  const checkpoint: StoryLocalResource = {
    id: "checkpoint-anima",
    name: "Anima Checkpoint",
    baseModel: "Anima",
    modelBaseModel: "Anima",
    modelFileName: "anima.safetensors",
    modelFileNameAliases: ["pencil-xl-diffusion.safetensors"],
    modelStorageKind: "diffusion",
    workflowProfile: "anima",
    clipName: "qwen_3_06b_base.safetensors",
    clipDevice: "default",
    vaeName: "qwen_image_vae.safetensors",
    unetWeightDtype: "default",
  };
  const lora: StoryLocalResource = {
    id: "lora-anima",
    name: "Anima LoRA",
    baseModel: "Anima",
    modelFileName: "anima-lora.safetensors",
    trainedWords: ["anima_style"],
  };

  return createStoryResourcePlan({
    storyId,
    candidates: {
      checkpoints: [{ resource: checkpoint }],
      loras: [{ resource: lora }],
    },
    recommendation: {
      checkpoint: {
        resource: checkpoint,
        reason: "Local Anima checkpoint.",
      },
      loras: [
        {
          resource: lora,
          suggestedWeight: 0.62,
          reason: "Local Anima LoRA.",
        },
      ],
      recommendationReason: "Use local Anima resources.",
      overallEffect: "Anima storyboard panels.",
      warnings: [],
    },
  });
}

function storyReferenceAsset(
  overrides: Partial<StoryReferenceAsset> & Pick<StoryReferenceAsset, "id" | "referenceType" | "sourceEntity">,
): StoryReferenceAsset {
  const resolutionState = overrides.resolutionState ?? "approved";
  const filename = overrides.approvedAssetReference?.filename ?? `${overrides.id.replace(/[^a-z0-9]+/gi, "-")}.png`;

  return {
    storyId,
    importance: "recommended",
    resolutionState,
    canonicalPromptRevision: 0,
    canonicalPrompt: `${overrides.sourceEntity.name} ${overrides.referenceType} reference`,
    rationale: "Test reference.",
    sourceShotIds: ["shot-1", "shot-2"],
    candidateAssetReferences: [],
    ...(resolutionState === "approved"
      ? {
          approval: {
            approvedAssetReferenceId: `asset-${overrides.id}`,
            approvedAt: "2026-06-29T00:00:00.000Z",
            approvedBy: "user" as const,
            source: "uploaded" as const,
          },
          approvedAssetReference: {
            canonicalPromptRevision: 0,
            filename,
            id: `asset-${overrides.id}`,
            source: "uploaded" as const,
            url: `/api/comfyui/sequence-references/${filename}`,
          },
        }
      : {}),
    ...overrides,
  };
}

function createApprovedStoryReferenceAssetPlan(): StoryReferenceAssetPlan {
  return {
    storyId,
    planningNotes: [],
    assets: [
      storyReferenceAsset({
        id: "character-face:lead",
        referenceType: "character-face",
        importance: "required",
        sourceEntity: {
          id: "lead",
          name: "Lead",
          type: "character",
        },
      }),
      storyReferenceAsset({
        id: "character-bust:lead",
        referenceType: "character-bust",
        importance: "required",
        sourceEntity: {
          id: "lead",
          name: "Lead",
          type: "character",
        },
        sourceShotIds: ["shot-1"],
      }),
      storyReferenceAsset({
        id: "outfit:raincoat",
        referenceType: "outfit",
        sourceEntity: {
          id: "raincoat",
          name: "Raincoat",
          type: "outfit",
        },
        sourceShotIds: ["shot-2"],
      }),
      storyReferenceAsset({
        id: "prop:signal-card",
        referenceType: "prop",
        sourceEntity: {
          id: "signal-card",
          name: "Signal Card",
          type: "prop",
        },
      }),
      storyReferenceAsset({
        id: "location:station",
        referenceType: "location",
        sourceEntity: {
          id: "station",
          name: "Station",
          type: "location",
        },
      }),
      storyReferenceAsset({
        id: "character-face:unapproved",
        referenceType: "character-face",
        resolutionState: "generated",
        sourceEntity: {
          id: "unapproved",
          name: "Unapproved",
          type: "character",
        },
        approvedAssetReference: undefined,
        approval: undefined,
      }),
      storyReferenceAsset({
        id: "character-face:old-revision",
        referenceType: "character-face",
        canonicalPromptRevision: 1,
        sourceEntity: {
          id: "old-revision",
          name: "Old Revision",
          type: "character",
        },
        approvedAssetReference: {
          filename: "old-revision.png",
          id: "asset-character-face-old-revision",
          source: "uploaded",
          url: "/api/comfyui/sequence-references/old-revision.png",
        },
      }),
      storyReferenceAsset({
        id: "outfit:prompt-only",
        referenceType: "outfit",
        resolutionState: "prompt-only",
        sourceEntity: {
          id: "prompt-only",
          name: "Prompt-only Coat",
          type: "outfit",
        },
        approvedAssetReference: undefined,
        approval: undefined,
      }),
    ],
  };
}

function animaParts(overrides: Partial<ReturnType<typeof normalizeStoryAnimaPromptParts>>) {
  return normalizeStoryAnimaPromptParts(overrides);
}

describe("story planning", () => {
  it("normalizes Story Anima prompt parts without semantic cleanup or caps", () => {
    const longTag = "long visible tag with many words that must stay intact because the LLM owns prompt specificity";
    const parts = normalizeStoryAnimaPromptParts({
      subjectTags: [" 1girl ", "", "solo", "solo"],
      characterTags: [longTag],
      actionTags: ["holding a red signal card"],
      settingTags: "not an array",
      singleFrameCaption: " The courier holds a red signal card in the rain. ",
      negativeAdditions: ["cropped signal", "cropped signal"],
    });

    expect(parts).toMatchObject({
      subjectTags: ["1girl", "solo"],
      characterTags: [longTag],
      seriesTags: [],
      artistTags: [],
      actionTags: ["holding a red signal card"],
      settingTags: [],
      singleFrameCaption: "The courier holds a red signal card in the rain.",
      negativeAdditions: ["cropped signal"],
    });
  });

  it("compiles Story Anima prompt parts in fixed order with the full caption", () => {
    const prompt = compileStoryAnimaPrompt({
      subjectTags: ["1girl", "solo"],
      characterTags: ["adult courier with cropped black hair"],
      seriesTags: ["original"],
      artistTags: ["@storyboarder"],
      outfitTags: ["yellow reflective jacket"],
      propTags: ["red signal card"],
      actionTags: ["studying the reflection"],
      settingTags: ["wet neon market aisle"],
      cameraTags: ["close view"],
      lightingTags: ["rainy neon light"],
      styleTags: ["teal theme"],
      singleFrameCaption: "The courier studies the red signal card reflected in a puddle.",
      negativeAdditions: ["cropped signal"],
    });

    expect(prompt).toBe([
      "masterpiece",
      "best quality",
      "score_7",
      "safe",
      "1girl",
      "solo",
      "adult courier with cropped black hair",
      "original",
      "@storyboarder",
      "yellow reflective jacket",
      "red signal card",
      "studying the reflection",
      "wet neon market aisle",
      "close view",
      "rainy neon light",
      "teal theme",
      "The courier studies the red signal card reflected in a puddle.",
    ].join(", "));
    expect(prompt).not.toContain("cropped signal");
  });

  it("does not semantically rewrite overlapping Story Anima prompt parts", () => {
    const prompt = compileStoryAnimaPrompt({
      subjectTags: ["1girl", "solo"],
      characterTags: ["adult courier with cropped black hair"],
      seriesTags: [],
      artistTags: [],
      outfitTags: [],
      propTags: ["red signal card"],
      actionTags: ["studying the red signal card"],
      settingTags: ["wet neon market aisle"],
      cameraTags: [],
      lightingTags: [],
      styleTags: [],
      singleFrameCaption: "The adult courier with cropped black hair studies the red signal card in a wet neon market aisle.",
      negativeAdditions: [],
    });

    expect(prompt).toContain("The adult courier with cropped black hair studies the red signal card in a wet neon market aisle.");
    expect(prompt).toContain("adult courier with cropped black hair");
    expect(prompt).toContain("studying the red signal card");
    expect(prompt).toContain("wet neon market aisle");
  });

  it("selects only validated local resources and strips model NSFW markers", () => {
    const resourcePlan = createResourcePlan();

    expect(resourcePlan.checkpoint.resource).toEqual({
      id: "checkpoint-local",
      name: "Local Checkpoint",
      baseModel: "Illustrious",
      modelFileName: "local.safetensors",
    });
    expect(resourcePlan.loras[0]?.resource).toEqual({
      id: "lora-local",
      name: "Local LoRA",
      baseModel: "Illustrious",
      modelFileName: "local-lora.safetensors",
      trainedWords: ["wet platform"],
    });
    expect(JSON.stringify(resourcePlan)).not.toContain("nsfw");
    expect(JSON.stringify(resourcePlan)).not.toContain("Nsfw");
  });

  it("rejects recommended resources that are not validated local candidates", () => {
    const checkpoint = checkpointResource();
    const lora = loraResource();

    expect(() =>
      createStoryResourcePlan({
        storyId,
        candidates: {
          checkpoints: [{ resource: checkpoint }],
          loras: [{ resource: lora }],
        },
        recommendation: {
          checkpoint: {
            resource: {
              id: "remote-checkpoint",
              name: "Remote Checkpoint",
              modelFileName: "remote.safetensors",
              nsfw: true,
              nsfwLevel: 5,
            },
            reason: "Invented remote resource must not be accepted.",
          },
          loras: [],
          recommendationReason: "Do not use resources outside local candidates.",
          overallEffect: "Remote model should be rejected even with matching NSFW metadata.",
          warnings: [],
        },
      }),
    ).toThrow(StoryResourcePlanValidationError);
  });

  it("keeps preview execution parameters separate from the formal parameter plan", () => {
    const parameterPlan = createStoryParameterPlan({
      storyId,
      defaults,
      perShotOverrides: [
        {
          shotId: "shot-2",
          parameters: { cfg: 6 },
        },
      ],
    });
    const before = JSON.stringify(parameterPlan);
    const previewOptions = {
      enabled: true,
      shotIds: ["shot-2"],
      parameterOverrides: {
        width: 512,
        height: 384,
        steps: 10,
      },
    } satisfies StoryPreviewExecutionOptions;

    expect(createStoryPreviewParameters(parameterPlan, previewOptions, "shot-2")).toMatchObject({
      width: 512,
      height: 384,
      steps: 10,
      cfg: 6,
    });
    expect(JSON.stringify(parameterPlan)).toBe(before);
  });

  it("assembles render plans with NSFW context and preview references outside formal parameters", () => {
    const resourcePlan = createResourcePlan();
    const parameterPlan = createStoryParameterPlan({ storyId, defaults });
    const renderPlan = assembleStoryRenderPlan({
      parameterPlan,
      previewOptions: {
        enabled: true,
        shotIds: ["shot-2"],
        parameterOverrides: { steps: 8 },
      },
      previewResultReferences: [
        {
          shotId: "shot-2",
          promptId: "preview-1",
          createdAt: "2026-06-14T00:00:00.000Z",
          parameters: { ...defaults, steps: 8 },
        },
      ],
      resourcePlan,
      safetyPlan,
      shots,
    });

    expect(renderPlan.nsfwContext).toEqual({
      audienceRating: "explicit",
      contentWarnings: ["adult-only tone"],
      enabled: true,
      rationale: "User enabled mature story execution context.",
    });
    expect(renderPlan.resourceRefs).toMatchObject({
      sourceNodeId: "resource-plan",
      checkpoint: {
        resourceId: "checkpoint-local",
        name: "Local Checkpoint",
      },
      loras: [
        {
          resourceId: "lora-local",
          name: "Local LoRA",
          suggestedWeight: 0.6,
        },
      ],
    });
    expect(renderPlan.shots[0]?.resourceRefs).toEqual({
      checkpointResourceId: "checkpoint-local",
      loraResourceIds: ["lora-local"],
    });
    expect(renderPlan.preview.resultReferences).toHaveLength(1);
    expect(renderPlan.shots[1]).toMatchObject({
      shotId: "shot-2",
      negativePrompt: "gore, severe injury",
      parameters: defaults,
    });
    expect(renderPlan.shots[1]?.positivePrompt).toContain("red signal reflected in a puddle");
    expect(renderPlan.shots[1]?.positivePrompt).toContain("The lead notices a red signal.");
    expect(renderPlan.shots[1]?.positivePrompt).toContain("Keep the raincoat visible.");
    expect(renderPlan.shots[1]?.negativePrompt).not.toContain("Keep the scene symbolic.");
    expect(JSON.stringify(renderPlan.shots[1]?.outputAnchors)).toContain("red signal reflected in a puddle");
    expect(renderPlan.shots[1]?.outputAnchors.clothing).toEqual(expect.arrayContaining([
      expect.stringContaining("raincoat visible"),
    ]));
    expect(renderPlan.shots[1]?.outputAnchors.camera).toContain("low close-up");
    expect(renderPlan.shots[1]?.outputAnchors.negative).toEqual(["gore", "severe injury"]);
    expect(renderPlan.shots[1]?.outputAnchors.source).toMatchObject({
      mode: "source-image",
      sourceShotIds: ["shot-1"],
    });
    expect(renderPlan.shots[1]).not.toHaveProperty("resources");
    expect(JSON.stringify(renderPlan.shots)).not.toContain("\"resources\"");
    expect(JSON.stringify(renderPlan.shots)).not.toContain("\"checkpoint\"");
    expect(JSON.stringify(renderPlan.shots)).not.toContain("\"loras\"");
  });

  it("adds reference recipes and structured source-image location continuity to render plans and requests", () => {
    const resourcePlan = createResourcePlan();
    const parameterPlan = createStoryParameterPlan({ storyId, defaults });
    const renderPlan = assembleStoryRenderPlan({
      img2imgDenoise: 0.82,
      parameterPlan,
      referenceAssetPlan,
      renderPromptPlan: {
        storyId,
        warnings: [],
        shots: [
          {
            shotId: "shot-2",
            animaPromptParts: animaParts({
              subjectTags: ["1girl", "solo"],
              characterTags: ["adult lead in raincoat"],
              settingTags: ["rainy station signal platform"],
              cameraTags: ["low close-up"],
              lightingTags: ["red signal glow"],
              singleFrameCaption: "The lead studies a red signal reflected in the station puddle.",
            }),
            locationContinuity: {
              mode: "source-image",
              sourceShotIds: ["shot-1"],
              reason: "Use shot-1 as the loose station img2img source.",
              notes: ["Keep the rainy station platform layout."],
            },
            referenceRecipe: {
              summary: "Use approved lead identity and prompt-only station references as review anchors.",
              referenceIds: ["character-face:lead", "location:station", "prop:signal-card"],
              approvedReferenceIds: ["character-face:lead"],
              promptOnlyReferenceIds: ["location:station"],
              unresolvedReferenceIds: ["prop:signal-card"],
              notes: ["Do not inject final references in T29."],
            },
          },
        ],
      },
      resourcePlan,
      safetyPlan,
      shots,
    });
    const shot = renderPlan.shots[1];
    const preview = shot ? createStoryExecutionRequestBatch({ mode: "final", renderPlan, resourcePlan }).requests[1] : null;
    const requestPreview = shot ? createStoryGenerationRequestPreview(shot, renderPlan.img2imgDenoise) : null;

    expect(shot?.locationContinuity).toEqual({
      mode: "source-image",
      sourceShotIds: ["shot-1"],
      reason: "Use shot-1 as the loose station img2img source.",
      notes: ["Keep the rainy station platform layout."],
    });
    expect(shot?.outputAnchors.source).toMatchObject({
      mode: "source-image",
      sourceShotIds: ["shot-1"],
    });
    expect(shot?.referenceRecipe).toMatchObject({
      summary: "Use approved lead identity and prompt-only station references as review anchors.",
      referenceIds: ["character-face:lead", "location:station", "prop:signal-card"],
      approvedReferenceIds: ["character-face:lead"],
      promptOnlyReferenceIds: ["location:station"],
      unresolvedReferenceIds: ["prop:signal-card"],
    });
    expect(requestPreview).toMatchObject({
      sourceMode: "source-image",
      sourceShotIds: ["shot-1"],
    });
    expect(preview?.sourceShotIds).toEqual(["shot-1"]);
    expect(preview?.request.denoise).toBe(0.82);
  });

  it("rejects self and future source-image continuity sources before execution planning", () => {
    const resourcePlan = createResourcePlan();
    const parameterPlan = createStoryParameterPlan({ storyId, defaults });
    const futureSourceShots = [
      shots[0],
      {
        ...shots[1],
        sourceShotIds: [],
      },
      {
        ...shots[1],
        id: "shot-3",
        order: 3,
        title: "Future station view",
        sourceShotIds: [],
      },
    ] satisfies StoryShot[];
    const renderPlan = assembleStoryRenderPlan({
      parameterPlan,
      renderPromptPlan: {
        storyId,
        warnings: [],
        shots: [
          {
            shotId: "shot-2",
            animaPromptParts: animaParts({
              subjectTags: ["1girl"],
              settingTags: ["rainy station platform"],
              cameraTags: ["medium view"],
              lightingTags: ["red signal light"],
              singleFrameCaption: "The lead waits on the station platform.",
            }),
            locationContinuity: {
              mode: "source-image",
              sourceShotIds: ["shot-2", "shot-3"],
              reason: "The LLM incorrectly referenced the target and a future shot.",
            },
          },
        ],
      },
      resourcePlan,
      safetyPlan,
      shots: futureSourceShots,
    });
    const shot = renderPlan.shots.find((candidate) => candidate.shotId === "shot-2");
    const batch = createStoryExecutionRequestBatch({ mode: "final", renderPlan, resourcePlan });

    expect(shot?.locationContinuity.mode).toBe("prompt-only");
    expect(shot?.locationContinuity.sourceShotIds).toEqual([]);
    expect(shot?.sourceShotIds).toEqual([]);
    expect(shot?.sourceImageEdges).toEqual([]);
    expect(shot?.promptWarnings).toEqual(expect.arrayContaining([
      "locationContinuity requested source-image but did not provide a valid source shot; using prompt-only continuity.",
    ]));
    expect(batch.requests.find((request) => request.shotId === "shot-2")?.sourceShotIds).toEqual([]);
  });

  it("keeps prompt-only and inpaint-preferred continuity non-executing even when shot sources exist", () => {
    const resourcePlan = createResourcePlan();
    const parameterPlan = createStoryParameterPlan({ storyId, defaults });
    const continuityShots = [
      shots[0],
      {
        ...shots[1],
        sourceShotIds: ["shot-1"],
      },
      {
        ...shots[1],
        id: "shot-3",
        order: 3,
        title: "Repair Preferred",
        sourceShotIds: ["shot-2"],
      },
    ] satisfies StoryShot[];
    const renderPlan = assembleStoryRenderPlan({
      parameterPlan,
      referenceAssetPlan,
      renderPromptPlan: {
        storyId,
        warnings: [],
        shots: [
          {
            shotId: "shot-2",
            animaPromptParts: animaParts({
              subjectTags: ["1girl"],
              settingTags: ["same rainy station platform, source image from shot-1 mentioned only as text"],
              cameraTags: ["close-up"],
              lightingTags: ["red signal light"],
              singleFrameCaption: "The lead stays on the same station platform.",
            }),
            locationContinuity: {
              mode: "prompt-only",
              sourceShotIds: ["shot-1"],
              reason: "The layout can be described in text.",
              notes: ["Do not inherit an image."],
            },
          },
          {
            shotId: "shot-3",
            animaPromptParts: animaParts({
              subjectTags: ["1girl"],
              settingTags: ["same station platform with altered poster"],
              cameraTags: ["medium view"],
              lightingTags: ["rainy red signal light"],
              singleFrameCaption: "The lead studies a changed poster on the same station platform.",
            }),
            locationContinuity: {
              mode: "inpaint-preferred",
              sourceShotIds: ["shot-2"],
              reason: "A future inpaint pass would best update only the poster.",
              notes: ["Advisory only in v1."],
            },
          },
        ],
      },
      resourcePlan,
      safetyPlan,
      shots: continuityShots,
    });
    const batch = createStoryExecutionRequestBatch({ mode: "final", renderPlan, resourcePlan });
    const promptOnlyShot = renderPlan.shots.find((shot) => shot.shotId === "shot-2");
    const inpaintShot = renderPlan.shots.find((shot) => shot.shotId === "shot-3");
    const inpaintRequest = batch.requests.find((request) => request.shotId === "shot-3")?.request as Record<string, unknown> | undefined;

    expect(promptOnlyShot?.locationContinuity.mode).toBe("prompt-only");
    expect(promptOnlyShot?.sourceShotIds).toEqual([]);
    expect(promptOnlyShot?.sourceImageEdges).toEqual([]);
    expect(inpaintShot?.locationContinuity.mode).toBe("inpaint-preferred");
    expect(inpaintShot?.sourceShotIds).toEqual([]);
    expect(inpaintShot?.sourceImageEdges).toEqual([]);
    expect(batch.requests.find((request) => request.shotId === "shot-2")?.sourceShotIds).toEqual([]);
    expect(batch.requests.find((request) => request.shotId === "shot-3")?.sourceShotIds).toEqual([]);
    expect(batch.requests.find((request) => request.shotId === "shot-2")?.request.denoise).toBe(defaults.denoise);
    expect(batch.requests.find((request) => request.shotId === "shot-3")?.request.denoise).toBe(defaults.denoise);
    expect(inpaintRequest).not.toHaveProperty("sourceImage");
    expect(inpaintRequest).not.toHaveProperty("sourceImages");
    expect(inpaintRequest).not.toHaveProperty("maskImage");
    expect(inpaintRequest).not.toHaveProperty("inpaintMask");
    expect(inpaintRequest).not.toHaveProperty("repair");
  });

  it("keeps stale reference prompt edits visible in reference recipes without creating source inputs", () => {
    const resourcePlan = createResourcePlan();
    const parameterPlan = createStoryParameterPlan({ storyId, defaults });
    const renderPlan = assembleStoryRenderPlan({
      parameterPlan,
      referenceAssetPlan,
      resourcePlan,
      safetyPlan,
      shots: shots.map((shot) => ({ ...shot, sourceShotIds: [] })),
    });
    const staleShot = renderPlan.shots.find((shot) => shot.shotId === "shot-2");
    const batch = createStoryExecutionRequestBatch({ mode: "final", renderPlan, resourcePlan });

    expect(staleShot?.referenceRecipe).toMatchObject({
      referenceIds: ["character-face:lead", "location:station", "prop:signal-card"],
      approvedReferenceIds: ["character-face:lead"],
      promptOnlyReferenceIds: ["location:station"],
      unresolvedReferenceIds: ["prop:signal-card"],
    });
    expect(staleShot?.referenceRecipe.notes).toEqual(expect.arrayContaining([
      expect.stringContaining("prop:signal-card is stale"),
    ]));
    expect(staleShot?.locationContinuity.mode).toBe("prompt-only");
    expect(batch.requests.find((request) => request.shotId === "shot-2")?.sourceShotIds).toEqual([]);
  });

  it("normalizes Story parameter plans against live sampler and scheduler options", () => {
    const parameterPlan = createStoryParameterPlan({
      storyId,
      defaults: {
        ...defaults,
        samplerName: "dpmpp_2m",
        scheduler: "karras",
      },
      samplerOptions: {
        samplers: ["uni_pc"],
        schedulers: ["sgm_uniform"],
      },
    });

    expect(parameterPlan.defaults).toMatchObject({
      samplerName: "uni_pc",
      scheduler: "sgm_uniform",
    });
  });

  it("normalizes string per-shot parameter overrides while keeping resolution story-level", () => {
    const parameterPlan = createStoryParameterPlan({
      storyId,
      defaults,
      perShotOverrides: [
        {
          shotId: "shot-2",
          parameters: {
            cfg: "6.25",
            denoise: "0.7",
            height: "386",
            samplerName: "invented_sampler",
            scheduler: "invented_scheduler",
            steps: "12",
            width: "513",
          } as unknown as Partial<StoryGenerationParameters>,
        },
        {
          shotId: "shot-1",
          parameters: {
            cfg: "not-a-number",
            denoise: "also-bad",
          } as unknown as Partial<StoryGenerationParameters>,
        },
      ],
      samplerOptions: {
        samplers: ["uni_pc"],
        schedulers: ["sgm_uniform"],
      },
    });

    expect(parameterPlan.perShotOverrides[0]?.parameters).toMatchObject({
      cfg: 6.25,
      denoise: 0.7,
      samplerName: "uni_pc",
      scheduler: "sgm_uniform",
      steps: 12,
    });
    expect(parameterPlan.perShotOverrides[0]?.parameters).not.toHaveProperty("width");
    expect(parameterPlan.perShotOverrides[0]?.parameters).not.toHaveProperty("height");
    expect(parameterPlan.perShotOverrides[1]?.parameters).toMatchObject({
      cfg: defaults.cfg,
      denoise: defaults.denoise,
    });
  });

  it("keeps every Story shot on the same resolution even when old per-shot overrides include dimensions", () => {
    const resourcePlan = createResourcePlan();
    const parameterPlan = {
      defaults,
      perShotOverrides: [
        {
          shotId: "shot-2",
          parameters: {
            height: 512,
            steps: 12,
            width: 512,
          },
          reason: "Legacy per-shot dimension override.",
        },
      ],
      storyId,
      warnings: [],
    } satisfies StoryParameterPlan;
    const renderPlan = assembleStoryRenderPlan({
      parameterPlan,
      resourcePlan,
      safetyPlan,
      shots,
    });
    const finalBatch = createStoryExecutionRequestBatch({ mode: "final", renderPlan, resourcePlan });

    expect(renderPlan.shots.map((shot) => `${shot.parameters.width}x${shot.parameters.height}`)).toEqual([
      "1024x768",
      "1024x768",
    ]);
    expect(renderPlan.shots[1]?.parameters.steps).toBe(12);
    expect(finalBatch.requests.map((request) => `${request.request.width}x${request.request.height}`)).toEqual([
      "1024x768",
      "1024x768",
    ]);
  });

  it("uses model-family sampler defaults for Anima Story resources", () => {
    const defaultsForAnima = createStoryDefaultGenerationParameters({
      resourcePlan: createAnimaResourcePlan(),
      samplerOptions: {
        samplers: ["er_sde", "euler", "dpmpp_2m"],
        schedulers: ["simple", "normal", "karras"],
      },
    });

    expect(defaultsForAnima).toMatchObject({
      steps: 36,
      cfg: 4.5,
      samplerName: "er_sde",
      scheduler: "simple",
    });
  });

  it("uses explicit Story dimensions or neutral defaults instead of content-keyword aspect heuristics", () => {
    const neutralPortraitWordsDefaults = createStoryDefaultGenerationParameters({
      input: {
        storyId,
        rawIntent: "A vertical full body portrait sequence of a courier.",
      },
      resourcePlan: createAnimaResourcePlan(),
      shots: [
        {
          id: "portrait-shot",
          storyId,
          order: 1,
          title: "Portrait",
          description: "Full body portrait of the courier.",
          characterIds: ["courier"],
          sourceShotIds: [],
          camera: "vertical portrait frame",
          promptIntent: "courier standing in rain",
          continuityNotes: [],
        },
      ],
    });
    const neutralLandscapeWordsDefaults = createStoryDefaultGenerationParameters({
      input: {
        storyId,
        rawIntent: "A wide cinematic market chase.",
      },
      resourcePlan: createResourcePlan(),
      shots: [
        {
          id: "wide-shot",
          storyId,
          order: 1,
          title: "Wide chase",
          description: "Wide market chase.",
          characterIds: ["courier"],
          sourceShotIds: [],
          camera: "wide establishing frame",
          promptIntent: "market chase",
          continuityNotes: [],
        },
      ],
    });
    const explicitDefaults = createStoryDefaultGenerationParameters({
      input: {
        storyId,
        rawIntent: "Render this story at 1536x1024.",
      },
      resourcePlan: createResourcePlan(),
    });

    expect(neutralPortraitWordsDefaults).toMatchObject({
      width: 1024,
      height: 1024,
    });
    expect(neutralLandscapeWordsDefaults).toMatchObject({
      width: 1024,
      height: 1024,
    });
    expect(explicitDefaults).toMatchObject({
      width: 1536,
      height: 1024,
    });
    expect(neutralPortraitWordsDefaults).not.toMatchObject({
      width: 1024,
      height: 768,
    });
  });

  it("does not choose Anima Story dimensions from local scene keywords", () => {
    const animaKeywordDefaults = createStoryDefaultGenerationParameters({
      input: {
        storyId,
        rawIntent: "Solo character on a sidewalk, then in a narrow hallway.",
      },
      resourcePlan: createAnimaResourcePlan(),
      shots: [
        {
          id: "keyword-shot",
          storyId,
          order: 1,
          title: "Keyword shot",
          description: "Solo courier waits on a sidewalk outside a hallway.",
          characterIds: ["courier"],
          sourceShotIds: [],
          camera: "medium solo frame",
          promptIntent: "sidewalk hallway solo courier",
          continuityNotes: [],
        },
      ],
    });

    expect(animaKeywordDefaults).toMatchObject({
      width: 1024,
      height: 1024,
    });
  });

  it("uses selected checkpoint and LoRA metadata when choosing Story generation dimensions", () => {
    const checkpoint: StoryLocalResource = {
      ...checkpointResource(),
      usageGuide: "Designed for portrait story panels when paired with compatible LoRAs.",
    };
    const lora: StoryLocalResource = {
      ...loraResource(),
      recommendations: [
        {
          condition: "Story panels",
          baseModel: "Illustrious",
          checkpoint: "Local Checkpoint",
          sampler: null,
          loraWeightMin: null,
          loraWeightMax: null,
          loraWeight: 0.7,
          hdRedrawRate: null,
          notes: "Use 768x1152 for this checkpoint and LoRA combination.",
        },
      ],
    };
    const resourcePlan = createStoryResourcePlan({
      storyId,
      candidates: {
        checkpoints: [{ resource: checkpoint }],
        loras: [{ resource: lora }],
      },
      recommendation: {
        checkpoint: {
          resource: checkpoint,
          reason: "Local checkpoint.",
        },
        loras: [
          {
            resource: lora,
            suggestedWeight: 0.7,
            reason: "Local LoRA.",
          },
        ],
        recommendationReason: "Use local resources.",
        overallEffect: "Portrait-friendly story panels.",
        warnings: [],
      },
    });

    const defaultsFromResources = createStoryDefaultGenerationParameters({
      input: {
        storyId,
        rawIntent: "A courier follows a signal through the station.",
      },
      resourcePlan,
      shots,
    });

    expect(defaultsFromResources).toMatchObject({
      width: 768,
      height: 1152,
    });
  });

  it("keeps solo seated adult Story shots on uniform neutral resolution and filters adult NSFW safety boilerplate", () => {
    const rupaShots: StoryShot[] = [
      {
        id: "shot-1",
        storyId,
        order: 1,
        title: "Quiet Seated Poise",
        description:
          "Rupa is a young adult woman seated on the same chair with legs crossed in warm low-key room lighting.",
        characterIds: ["rupa"],
        sourceShotIds: [],
        camera: "straight-on eye level, centered medium-full composition, medium full shot",
        promptIntent:
          "young adult woman with slender silhouette and relaxed shoulders, Rupa is only visible character, simple soft-fabric indoor clothing fully on",
        continuityNotes: [],
      },
      {
        id: "shot-2",
        storyId,
        order: 2,
        title: "Beginning to Undress",
        description:
          "Rupa starts slipping her clothing down to reveal her shoulders while seated on the same chair with legs still crossed.",
        characterIds: ["rupa"],
        sourceShotIds: [],
        camera: "intimate three-quarter medium composition, medium shot",
        promptIntent:
          "young adult woman with slender silhouette and calm face, same soft indoor clothing partly loosened and sliding off to reveal shoulders",
        continuityNotes: [],
      },
      {
        id: "shot-3",
        storyId,
        order: 3,
        title: "Further Unveiling",
        description:
          "Rupa continues to remove clothing with one deliberate motion, same indoor clothing lowered further with upper body more exposed.",
        characterIds: ["rupa"],
        sourceShotIds: [],
        camera: "private room and chair in close intimate framing",
        promptIntent:
          "young adult woman with slender silhouette and soft features, seated on same chair with legs crossed and torso subtly turned",
        continuityNotes: ["warm light remains unchanged"],
      },
      {
        id: "shot-4",
        storyId,
        order: 4,
        title: "Private Self-Touch",
        description:
          "Rupa touches her chest with one hand in a slow personal gesture while seated on the same chair with legs crossed.",
        characterIds: ["rupa"],
        sourceShotIds: [],
        camera: "intimate frontal medium-close composition, medium close shot",
        promptIntent:
          "young adult woman with slender silhouette and bare shoulders, hand-to-chest gesture is key new action in this final shot",
        continuityNotes: ["same seated position and lowered clothing state established in shot"],
      },
    ];
    const adultSafetyPlan: StorySafetyPlan = {
      storyId,
      audienceRating: "explicit",
      contentWarnings: ["nudity", "sexualized self-touch", "intimate adult content"],
      blockedContent: [
        "sexualized minor",
        "fetishized",
        "voyeurism",
        "non-consensual",
        "sexual violence",
        "coercion",
        "age-gap romantic framing",
        "childlike face",
        "aged-up minor",
        "explicit depiction of genitals or nipples",
      ],
      perShotNotes: [],
      nsfwContext: {
        enabled: true,
        rationale:
          "NSFW is enabled, but explicit adult intimacy must still exclude minors, non-consensual content, and graphic sexual violence.",
      },
    };
    const parameterDefaults = createStoryDefaultGenerationParameters({
      input: {
        storyId,
        rawIntent: "A young woman named Rupa sits on a chair in a private warm room.",
        audienceRating: "explicit",
        nsfwContext: {
          audienceRating: adultSafetyPlan.audienceRating,
          contentWarnings: adultSafetyPlan.contentWarnings,
          enabled: true,
          rationale:
            "NSFW is enabled, but explicit adult intimacy must still exclude minors, non-consensual content, and graphic sexual violence.",
        },
      },
      resourcePlan: createAnimaResourcePlan(),
      shots: rupaShots,
    });
    const renderPlan = assembleStoryRenderPlan({
      parameterPlan: createStoryParameterPlan({ storyId, defaults: parameterDefaults }),
      resourcePlan: createAnimaResourcePlan(),
      safetyPlan: adultSafetyPlan,
      shots: rupaShots,
    });
    const prompts = renderPlan.shots.map((shot) => shot.positivePrompt).join("\n");
    const firstAnchors = renderPlan.shots[0]?.outputAnchors;
    const finalAnchors = renderPlan.shots[3]?.outputAnchors;

    expect(parameterDefaults).toMatchObject({
      width: 1024,
      height: 1024,
    });
    for (const shot of renderPlan.shots) {
      expect(shot.parameters).toMatchObject({
        width: 1024,
        height: 1024,
      });
      expect(shot.negativePrompt).toContain("sexualized minor");
      expect(shot.negativePrompt).toContain("age-gap romantic framing");
      expect(shot.negativePrompt).toContain("childlike face");
      expect(shot.negativePrompt).toContain("aged-up minor");
      expect(shot.negativePrompt).not.toContain("non-consensual");
      expect(shot.negativePrompt).not.toContain("sexual violence");
      expect(shot.negativePrompt).not.toContain("coercion");
      expect(shot.negativePrompt).not.toContain("explicit depiction of genitals or nipples");
    }
    expect(prompts).toContain("same soft indoor clothing partly loosened and sliding off to reveal shoulders");
    expect(renderPlan.shots[2]?.positivePrompt).toContain("same indoor clothing lowered further");
    expect(firstAnchors?.camera).toEqual(expect.arrayContaining([expect.stringContaining("straight-on eye level")]));
    expect(firstAnchors?.lighting).toEqual(expect.arrayContaining([expect.stringContaining("warm low-key room lighting")]));
    expect(finalAnchors?.action).toEqual(expect.arrayContaining([
      expect.stringContaining("touches her chest with one hand"),
    ]));
  });

  it("assembles Story Anima prompts while preserving ComfyUI Anima resource settings", () => {
    const resourcePlan = createAnimaResourcePlan();
    const renderPlan = assembleStoryRenderPlan({
      parameterPlan: createStoryParameterPlan({ storyId, defaults }),
      resourcePlan,
      safetyPlan,
      shots,
    });
    const finalBatch = createStoryExecutionRequestBatch({ mode: "final", renderPlan, resourcePlan });
    const firstShot = renderPlan.shots[0];
    const firstRequest = finalBatch.requests[0]?.request;

    expect(firstShot.positivePrompt).toContain("masterpiece");
    expect(firstShot.positivePrompt).toContain("score_7");
    expect(firstShot.positivePrompt).toContain("safe");
    expect(firstShot.positivePrompt).not.toContain("score_9");
    expect(firstShot.positivePrompt).not.toContain("score_8");
    expect(firstShot.positivePrompt).not.toContain("year 2025");
    expect(firstShot.positivePrompt).not.toContain("anima_style");
    expect(firstShot.negativePrompt).toContain("gore");
    expect(firstShot.negativePrompt).toContain("severe injury");
    expect(firstRequest).toMatchObject({
      checkpointName: "anima.safetensors",
      checkpointNameAliases: ["pencil-xl-diffusion.safetensors"],
      workflowProfile: "anima",
      modelBaseModel: "Anima",
      modelStorageKind: "diffusion",
      clipName: "qwen_3_06b_base.safetensors",
      clipDevice: "default",
      vaeName: "qwen_image_vae.safetensors",
      unetWeightDtype: "default",
      positivePrompt: firstShot.positivePrompt,
      negativePrompt: firstShot.negativePrompt,
      loras: [
        {
          loraName: "anima-lora.safetensors",
          strengthModel: 0.62,
          strengthClip: 0.62,
        },
      ],
    });
  });

  it("preserves Story input LoRA weights and fixed seed in ComfyUI execution requests", () => {
    const checkpoint = checkpointResource();
    const lora = {
      ...loraResource(),
      storyInputStrengthModel: 0.84,
      storyInputStrengthClip: 0.41,
    };
    const resourcePlan = createStoryResourcePlan({
      storyId,
      candidates: {
        checkpoints: [{ resource: checkpoint }],
        loras: [{ resource: lora }],
      },
      recommendation: {
        checkpoint: { resource: checkpoint, reason: "Manual checkpoint." },
        loras: [{ resource: lora, suggestedWeight: 0.84, reason: "Manual LoRA weight." }],
        recommendationReason: "Use Story input style resources.",
        overallEffect: "Manual style resources.",
        warnings: [],
      },
    });
    const parameterPlan = createStoryParameterPlan({
      storyId,
      defaults: {
        ...defaults,
        seed: 12345,
      },
    });
    const renderPlan = assembleStoryRenderPlan({
      parameterPlan,
      resourcePlan,
      safetyPlan,
      shots,
    });
    const finalBatch = createStoryExecutionRequestBatch({ mode: "final", renderPlan, resourcePlan });

    expect(finalBatch.requests[0]?.request).toMatchObject({
      seed: 12345,
      loras: [
        {
          loraName: "local-lora.safetensors",
          strengthModel: 0.84,
          strengthClip: 0.41,
        },
      ],
    });
  });

  it("uses Story-only Anima model-card prefix and safe minor negatives", () => {
    const renderPlan = assembleStoryRenderPlan({
      parameterPlan: createStoryParameterPlan({ storyId, defaults }),
      resourcePlan: createAnimaResourcePlan(),
      safetyPlan: {
        storyId,
        audienceRating: "safe",
        contentWarnings: [],
        blockedContent: ["sexualized depiction of teenage girl"],
        perShotNotes: [],
        nsfwContext: {
          enabled: false,
          rationale: "NSFW disabled.",
        },
      },
      shots: [
        {
          id: "shot-safe-minor",
          storyId,
          order: 1,
          title: "Maya Waits",
          description: "Maya is a teenage girl waiting at a rainy bus stop.",
          characterIds: ["maya"],
          sourceShotIds: [],
          camera: "medium-wide low angle composition",
          promptIntent: "Maya teenage girl, yellow rain jacket, holding a bus ticket, rainy evening",
          continuityNotes: [],
        },
      ],
    });
    const shot = renderPlan.shots[0];

    expect(shot?.positivePrompt.startsWith("masterpiece, best quality, score_7, safe, 1girl, solo")).toBe(true);
    expect(shot?.negativePrompt).toContain("nsfw");
    expect(shot?.negativePrompt).toContain("sexualized minor");
    expect(shot?.negativePrompt).toContain("revealing clothes");
    expect(shot?.negativePrompt).toContain("fetishized");
    expect(shot?.negativePrompt).not.toContain("childlike face");
    expect(shot?.negativePrompt).not.toContain("non-consensual");
    expect(shot?.negativePrompt).not.toContain("sexual violence");
    expect(shot?.negativePrompt).not.toContain("coercion");
  });

  it("uses LLM-authored Anima prompt parts without adding negative additions to the positive prompt", () => {
    const renderPlan = assembleStoryRenderPlan({
      parameterPlan: createStoryParameterPlan({ storyId, defaults }),
      renderPromptPlan: {
        storyId,
        warnings: ["LLM prompt draft used naturalized character descriptions."],
        shots: [
          {
            shotId: "shot-poster",
            animaPromptParts: animaParts({
              subjectTags: ["3people"],
              characterTags: [
                "young woman with round glasses and cream cardigan",
                "two apartment residents reading the poster",
              ],
              propTags: ["hand-drawn book swap poster", "orange sketchbook"],
              actionTags: ["young woman points to the handwritten swap note"],
              settingTags: ["shared apartment hallway notice board", "poster centered and readable"],
              cameraTags: ["eye-level medium shot"],
              lightingTags: ["warm hallway light"],
              styleTags: ["gentle painterly texture"],
              singleFrameCaption: "A young woman points at a readable book swap poster while two residents study it.",
              negativeAdditions: ["cropped poster", "<lora:bad:1>"],
            }),
            rationale: "Keep the final poster action explicit.",
            warnings: ["Poster readability is critical."],
          },
        ],
      },
      resourcePlan: createAnimaResourcePlan(),
      safetyPlan: {
        storyId,
        audienceRating: "safe",
        contentWarnings: [],
        blockedContent: [],
        perShotNotes: [],
        nsfwContext: {
          enabled: false,
          rationale: "Safe story.",
        },
      },
      shots: [
        {
          id: "shot-poster",
          storyId,
          order: 1,
          title: "Poster",
          description: "Maya shares a book swap poster with two residents.",
          characterIds: ["maya", "elderly-neighbor", "teen-resident"],
          sourceShotIds: [],
          camera: "medium shot",
          promptIntent: "book swap poster, residents reading, Maya points",
          continuityNotes: ["Keep Maya's cream cardigan and round glasses."],
        },
      ],
    });
    const shot = renderPlan.shots[0];

    expect(shot?.positivePrompt).toContain("3people");
    expect(shot?.positivePrompt).toContain("young woman with round glasses and cream cardigan");
    expect(shot?.positivePrompt).toContain("two apartment residents reading the poster");
    expect(shot?.positivePrompt).toContain("hand-drawn book swap poster");
    expect(shot?.positivePrompt).toContain("poster centered and readable");
    expect(shot?.positivePrompt).toContain("A young woman points at a readable book swap poster");
    expect(shot?.positivePrompt).not.toContain("cropped poster");
    expect(shot?.positivePrompt).not.toContain("<lora:bad:1>");
    expect(shot?.positivePrompt).not.toContain("teen-resident");
    expect(shot?.negativePrompt).toContain("cropped poster");
    expect(shot?.negativePrompt).not.toContain("<lora:");
    expect(shot?.animaPromptParts.characterTags).toEqual(expect.arrayContaining([
      "young woman with round glasses and cream cardigan",
    ]));
    expect(shot?.promptRationale).toBe("Keep the final poster action explicit.");
    expect(renderPlan.warnings).toContain("LLM prompt draft used naturalized character descriptions.");
  });

  it("preserves distinct adult multi-character Anima visual clauses", () => {
    const renderPlan = assembleStoryRenderPlan({
      parameterPlan: createStoryParameterPlan({ storyId, defaults }),
      renderPromptPlan: {
        storyId,
        warnings: [],
        shots: [
          {
            shotId: "shot-campus",
            animaPromptParts: animaParts({
              subjectTags: ["2people"],
              characterTags: [
                "Lena, college-age woman with curly auburn hair and cropped denim jacket",
                "Priya, college-age woman with short silver hair and long green coat",
              ],
              propTags: ["shared orange sketchbook open between them"],
              actionTags: [
                "Lena stands left pointing at a sketch page",
                "Priya kneels right holding a pencil case",
              ],
              settingTags: ["university art studio with paint-splattered tables"],
              cameraTags: ["two-person medium shot with sketchbook centered", "eye-level camera"],
              lightingTags: ["soft window light"],
              singleFrameCaption: "Two college-age women compare a shared orange sketchbook in an art studio.",
            }),
          },
        ],
      },
      resourcePlan: createAnimaResourcePlan(),
      safetyPlan: {
        storyId,
        audienceRating: "safe",
        contentWarnings: [],
        blockedContent: [],
        perShotNotes: [],
        nsfwContext: {
          enabled: false,
          rationale: "Safe college-age story.",
        },
      },
      shots: [
        {
          id: "shot-campus",
          storyId,
          order: 1,
          title: "Campus Sketchbook",
          description: "Two college-age women compare a sketchbook in an art studio.",
          characterIds: ["lena", "priya"],
          sourceShotIds: [],
          camera: "eye-level camera",
          promptIntent:
            "college-age women, orange sketchbook, university art studio, distinct poses",
          continuityNotes: [],
        },
      ],
    });
    const prompt = renderPlan.shots[0]?.positivePrompt ?? "";

    expect(prompt.startsWith("masterpiece, best quality, score_7, safe, 2people")).toBe(true);
    expect(prompt).toContain("college-age woman with curly auburn hair and cropped denim jacket");
    expect(prompt).toContain("college-age woman with short silver hair and long green coat");
    expect(prompt).toContain("shared orange sketchbook open between them");
    expect(prompt).toContain("stands left pointing at a sketch page");
    expect(prompt).toContain("kneels right holding a pencil case");
    expect(prompt).toContain("university art studio with paint-splattered tables");
    expect(prompt).not.toContain("two young women");
    expect(prompt).not.toContain("lena");
    expect(prompt).not.toContain("priya");
  });

  it("merges negative additions into the negative prompt without adding them to the positive prompt", () => {
    const renderPlan = assembleStoryRenderPlan({
      parameterPlan: createStoryParameterPlan({ storyId, defaults }),
      renderPromptPlan: {
        storyId,
        warnings: [],
        shots: [
          {
            shotId: "shot-sketchbook",
            animaPromptParts: animaParts({
              subjectTags: ["1girl", "solo"],
              characterTags: ["college-age young woman with round glasses and cream cardigan"],
              propTags: ["orange sketchbook", "loose sketch pages", "sunflower keychain"],
              actionTags: ["kneeling to gather sketch pages"],
              settingTags: ["library hallway with fallen books"],
              cameraTags: ["eye-level camera"],
              lightingTags: ["soft window lighting"],
              singleFrameCaption: "A college-age woman kneels to gather sketch pages in a library hallway.",
              negativeAdditions: ["sketch page", "drawings", "cropped poster", "bad hands"],
            }),
          },
        ],
      },
      resourcePlan: createAnimaResourcePlan(),
      safetyPlan: {
        storyId,
        audienceRating: "safe",
        contentWarnings: [],
        blockedContent: [],
        perShotNotes: [],
        nsfwContext: {
          enabled: false,
          rationale: "Safe story.",
        },
      },
      shots: [
        {
          id: "shot-sketchbook",
          storyId,
          order: 1,
          title: "Sketchbook Rescue",
          description: "A college-age young woman gathers loose sketch pages in a library hallway.",
          characterIds: ["mira"],
          sourceShotIds: [],
          camera: "eye-level camera",
          promptIntent: "orange sketchbook, loose sketch pages, kneeling to gather sketch pages",
          continuityNotes: ["Keep the sunflower keychain readable."],
        },
      ],
    });
    const shot = renderPlan.shots[0];

    expect(shot?.positivePrompt).toContain("orange sketchbook");
    expect(shot?.positivePrompt).toContain("loose sketch pages");
    expect(shot?.positivePrompt).toContain("kneeling to gather sketch pages");
    expect(shot?.positivePrompt).toContain("A college-age woman kneels to gather sketch pages in a library hallway.");
    expect(shot?.positivePrompt).not.toContain("cropped poster");
    expect(shot?.negativePrompt).toContain("sketch page");
    expect(shot?.negativePrompt).toContain("drawings");
    expect(shot?.negativePrompt).toContain("cropped poster");
    expect(shot?.negativePrompt).toContain("bad hands");
    expect(renderPlan.warnings).toEqual([]);
    expect(shot?.promptWarnings).toBeUndefined();
  });

  it("preserves LLM-authored Anima parts without word truncation or semantic rewriting", () => {
    const renderPlan = assembleStoryRenderPlan({
      parameterPlan: createStoryParameterPlan({ storyId, defaults }),
      renderPromptPlan: {
        storyId,
        warnings: [],
        shots: [
          {
            shotId: "shot-hallway",
            animaPromptParts: animaParts({
              subjectTags: ["1girl", "solo"],
              characterTags: [
                "college-age young woman with chin-length black bob",
              ],
              outfitTags: ["white sneakers"],
              propTags: [
                "handmade book swap flyer",
                "single paperback book",
                "magnetic clip frame",
              ],
              actionTags: [
                "stepping back beside newly mounted flyer with deliberate hand pose and readable face direction",
              ],
              settingTags: [
                "shared apartment hallway notice board",
              ],
              cameraTags: [
                "flyer centered on cork board",
              ],
              lightingTags: [
                "soft corridor light",
              ],
              styleTags: [
                "teal theme",
                "gentle anime illustration",
              ],
              singleFrameCaption: "The college-age woman steps back from the newly mounted flyer in the shared hallway.",
            }),
          },
        ],
      },
      resourcePlan: createAnimaResourcePlan(),
      safetyPlan,
      shots: [
        {
          id: "shot-hallway",
          storyId,
          order: 1,
          title: "Hallway Swap",
          description: "Maya pins a book swap flyer in the shared hallway.",
          characterIds: ["maya"],
          sourceShotIds: [],
          camera: "medium shot",
          promptIntent: "book swap flyer, hallway notice board",
          continuityNotes: [],
        },
      ],
    });
    const prompt = renderPlan.shots[0]?.positivePrompt ?? "";

    expect(prompt).toContain("college-age young woman with chin-length black bob");
    expect(prompt).toContain("white sneakers");
    expect(prompt).toContain("handmade book swap flyer");
    expect(prompt).toContain("magnetic clip frame");
    expect(prompt).toContain("stepping back beside newly mounted flyer with deliberate hand pose and readable face direction");
    expect(prompt).not.toContain("maya");
    expect(prompt).toContain("shared apartment hallway notice board");
    expect(prompt).toContain("soft corridor light");
    expect(prompt).toContain("teal theme");
    expect(prompt).toContain("The college-age woman steps back from the newly mounted flyer in the shared hallway.");
  });

  it("falls back to local Story Anima parts when an LLM draft omits a shot", () => {
    const renderPlan = assembleStoryRenderPlan({
      parameterPlan: createStoryParameterPlan({ storyId, defaults }),
      renderPromptPlan: {
        storyId,
        warnings: [],
        shots: [
          {
            shotId: "shot-1",
            animaPromptParts: animaParts({
              characterTags: ["lead in raincoat"],
              actionTags: ["entering rainy station"],
              singleFrameCaption: "The lead enters the rainy station.",
            }),
          },
        ],
      },
      resourcePlan: createAnimaResourcePlan(),
      safetyPlan,
      shots,
    });

    expect(renderPlan.shots[0]?.positivePrompt).toContain("lead in raincoat");
    expect(renderPlan.shots[1]?.positivePrompt).toContain("red signal reflected in a puddle");
    expect(renderPlan.warnings).toContain('Shot "shot-2" did not receive LLM Anima prompt parts; using local prompt fallback.');
  });

  it("preserves required current-shot anchors in final Anima render prompts", () => {
    const renderPlan = assembleStoryRenderPlan({
      parameterPlan: createStoryParameterPlan({ storyId, defaults }),
      resourcePlan: createAnimaResourcePlan(),
      safetyPlan: {
        storyId,
        audienceRating: "safe",
        contentWarnings: [],
        blockedContent: [],
        perShotNotes: [],
        nsfwContext: {
          enabled: false,
          rationale: "Safe story.",
        },
      },
      shots: [
        {
          id: "shot-required-anchors",
          storyId,
          order: 1,
          title: "Sketchbook Rescue",
          description:
            "Mira is a young woman with round glasses kneeling beside fallen books blocking the library hallway.",
          characterIds: ["mira"],
          sourceShotIds: [],
          camera: "eye-level three-quarter frame with soft window lighting",
          promptIntent:
            "cream cardigan, orange sketchbook, sunflower keychain, kneeling to gather loose pages, fallen books blocking library hallway, extra shelf detail, extra wall poster detail",
          continuityNotes: [
            "Keep the round glasses visible.",
            "Keep the cream cardigan, orange sketchbook, and sunflower keychain readable.",
          ],
        },
      ],
    });
    const prompt = renderPlan.shots[0]?.positivePrompt ?? "";
    expect(prompt.startsWith("masterpiece, best quality, score_7, safe, 1girl, solo")).toBe(true);
    expect(prompt).toContain("round glasses");
    expect(prompt).toContain("cream cardigan");
    expect(prompt).toContain("orange sketchbook");
    expect(prompt).toContain("sunflower keychain");
    expect(prompt).toContain("kneeling to gather loose pages");
    expect(prompt).toContain("fallen books blocking library hallway");
    expect(prompt).toContain("eye-level three-quarter frame");
    expect(prompt).toContain("soft window lighting");
  });

  it("builds local fallback Anima parts from Story shot fields without profile-specific compacting", () => {
    const renderPlan = assembleStoryRenderPlan({
      parameterPlan: createStoryParameterPlan({ storyId, defaults }),
      resourcePlan: createResourcePlan(),
      safetyPlan,
      shots: [
        {
          id: "shot-order",
          storyId,
          order: 1,
          title: "Order",
          description: "The older teen bike messenger kneels beside a bicycle at a rain-slick market crosswalk.",
          characterIds: ["lead"],
          sourceShotIds: [],
          camera: "medium-wide slightly low angle",
          promptIntent:
            "red rain jacket, older teen bike messenger with freckles, kneeling beside a greasy broken chain, umbrellas and produce stalls, centered composition, overcast rainy daylight, loose background detail, extra crowd description, extra storefront description",
          continuityNotes: [
            "Keep the envelope visible in the clear handlebar pouch.",
            "Keep the shaved sides haircut readable.",
          ],
        },
      ],
    });
    const prompt = renderPlan.shots[0]?.positivePrompt ?? "";
    expect(prompt.startsWith("masterpiece, best quality, score_7, safe")).toBe(true);
    expect(prompt).toContain("lead");
    expect(prompt).toContain("red rain jacket");
    expect(prompt).toContain("older teen bike messenger with freckles");
    expect(prompt).toContain("kneeling beside a greasy broken chain");
    expect(prompt).toContain("umbrellas and produce stalls");
    expect(prompt).toContain("medium-wide slightly low angle");
    expect(prompt).toContain("extra storefront description");
    expect(renderPlan.shots[0]?.animaPromptParts.actionTags).toEqual([
      "red rain jacket, older teen bike messenger with freckles, kneeling beside a greasy broken chain, umbrellas and produce stalls, centered composition, overcast rainy daylight, loose background detail, extra crowd description, extra storefront description",
    ]);
    expect(renderPlan.shots[0]?.outputAnchors.source).toMatchObject({
      mode: "prompt-only",
      sourceShotIds: [],
    });
  });

  it("keeps camera, lighting, and source metadata available in local fallback render plans", () => {
    const renderPlan = assembleStoryRenderPlan({
      parameterPlan: createStoryParameterPlan({ storyId, defaults }),
      resourcePlan: createResourcePlan(),
      safetyPlan,
      shots: [
        {
          id: "shot-anchor",
          storyId,
          order: 1,
          title: "Anchor",
          description:
            "One hand gripping the bike frame as he squeezes past market crates, lifting the bicycle through a narrow alley.",
          characterIds: ["lead"],
          sourceShotIds: [],
          camera: "Medium-wide street-level view with centered bridge approach composition.",
          promptIntent:
            "same bright yellow rain jacket, distant police barricades along the bridge route, cinematic illustrated realism, damp urban textures, cool rainy street lighting",
          continuityNotes: [
            "Keep wardrobe continuity: the same bright yellow rain jacket visible in every frame.",
          ],
        },
      ],
    });
    const anchors = renderPlan.shots[0]?.outputAnchors;

    expect(renderPlan.shots[0]?.positivePrompt).toContain("Medium-wide street-level view with centered bridge approach composition.");
    expect(renderPlan.shots[0]?.positivePrompt).toContain("distant police barricades along the bridge route");
    expect(renderPlan.shots[0]?.positivePrompt).toContain("same bright yellow rain jacket");
    expect(anchors?.lighting).toContain("cool rainy street lighting");
    expect(anchors?.detail).toEqual(expect.arrayContaining(["cinematic illustrated realism", "damp urban textures"]));
    expect(anchors?.source).toMatchObject({
      mode: "prompt-only",
      sourceShotIds: [],
    });
  });

  it("preserves raw Story shot intent across local fallback render prompts", () => {
    const renderPlan = assembleStoryRenderPlan({
      parameterPlan: createStoryParameterPlan({ storyId, defaults }),
      resourcePlan: createResourcePlan(),
      safetyPlan,
      shots: [
        {
          id: "beat-2",
          storyId,
          order: 1,
          title: "Beat 2",
          description: "The courier catches the falling bakery box in the wet market alley.",
          characterIds: ["courier"],
          sourceShotIds: [],
          camera: "medium action frame",
          promptIntent:
            "Show only the courier as visible human subject, He should be catching falling bakery box, snapped backpack strap, wet market alley",
          continuityNotes: ["yellow rain jacket"],
        },
        {
          id: "beat-3",
          storyId,
          order: 2,
          title: "Beat 3",
          description:
            "The courier abandons the bicycle, tucks the box under his rain jacket, runs through a blocked crosswalk, and reaches the apartment stairwell.",
          characterIds: ["courier"],
          sourceShotIds: [],
          camera: "street-level chase frame",
          promptIntent:
            "abandoning bicycle, box tucked under rain jacket, running through blocked crosswalk, apartment stairwell, yellow rain jacket",
          continuityNotes: [],
        },
        {
          id: "beat-4",
          storyId,
          order: 3,
          title: "Beat 4",
          description: "The courier smooths the crushed box corner and knocks at the apartment door.",
          characterIds: ["courier"],
          sourceShotIds: [],
          camera: "quiet doorway close-up",
          promptIntent:
            "This shot marks the pause before delivery, smoothing crushed box corner, knocking at apartment door, forced calm expression, yellow rain jacket",
          continuityNotes: [],
        },
        {
          id: "final-image",
          storyId,
          order: 4,
          title: "Final image",
          description: "The courier holds the battered cake box beside a little girl in a party hat and her relieved father.",
          characterIds: ["courier", "girl", "father"],
          sourceShotIds: [],
          camera: "warm apartment doorway group frame",
          promptIntent:
            "courier holding battered cake box, little girl in party hat, relieved father, yellow rain jacket",
          continuityNotes: [],
        },
      ],
    });
    const prompts = renderPlan.shots.map((shot) => shot.positivePrompt).join("\n");

    expect(prompts).toMatch(/Show only|He should|This shot marks|visible human subject/i);
    expect(renderPlan.shots[0]?.positivePrompt).toContain("catching falling bakery box");
    expect(renderPlan.shots[0]?.positivePrompt).toContain("snapped backpack strap");
    expect(renderPlan.shots[0]?.positivePrompt).toContain("wet market alley");
    expect(renderPlan.shots[1]?.positivePrompt).toContain("abandoning bicycle");
    expect(renderPlan.shots[1]?.positivePrompt).toContain("box tucked under rain jacket");
    expect(renderPlan.shots[1]?.positivePrompt).toContain("running through blocked crosswalk");
    expect(renderPlan.shots[1]?.positivePrompt).toContain("apartment stairwell");
    expect(renderPlan.shots[2]?.positivePrompt).toContain("smoothing crushed box corner");
    expect(renderPlan.shots[2]?.positivePrompt).toContain("knocking at apartment door");
    expect(renderPlan.shots[2]?.positivePrompt).toContain("forced calm expression");
    expect(renderPlan.shots[3]?.positivePrompt).toContain("courier holding battered cake box");
    expect(renderPlan.shots[3]?.positivePrompt).toContain("little girl in party hat");
    expect(renderPlan.shots[3]?.positivePrompt).toContain("relieved father");
    for (const shot of renderPlan.shots) {
      expect(shot.positivePrompt).toContain("yellow rain jacket");
    }
  });

  it("keeps verbose fallback Story intent available in Anima prompt parts", () => {
    const renderPlan = assembleStoryRenderPlan({
      parameterPlan: createStoryParameterPlan({ storyId, defaults }),
      resourcePlan: createAnimaResourcePlan(),
      safetyPlan: {
        ...safetyPlan,
        audienceRating: "safe",
        nsfwContext: {
          enabled: false,
          rationale: "Safe story.",
        },
      },
      shots: [
        {
          id: "shot-hygiene",
          storyId,
          order: 1,
          title: "Return Slot",
          description:
            "Maya rides a shaky bicycle, the wheel jammed, then locks the bicycle and sprints to slide a book through the return slot.",
          characterIds: ["maya"],
          sourceShotIds: [],
          camera: "medium-wide low angle composition, medium-wide low angle",
          promptIntent:
            "Maintain Maya as only clear visible subject, Preserve yellow rain jacket, Use traffic lights to show urgency, Show grease on hands, must clearly signal late library return, rainy evening with warm interior contrast, and distant",
          continuityNotes: [
            "riding shaky bicycle",
            "wheel jammed",
            "locking bicycle then sprinting",
            "sliding book through return slot",
            "from",
          ],
        },
      ],
    });
    const shot = renderPlan.shots[0];
    const prompt = shot?.positivePrompt ?? "";

    expect(prompt).toContain("riding shaky bicycle");
    expect(prompt).toContain("wheel jammed");
    expect(prompt).toContain("then locks the bicycle and sprints");
    expect(prompt).toContain("sliding book through return slot");
    expect(prompt).toContain("rainy evening with warm interior contrast");
    expect(prompt).toContain("medium-wide low angle composition");
    expect(prompt).toMatch(/Maintain|Preserve|Use traffic|Show grease|must clearly signal|as only clear visible subject/i);
    expect(shot?.animaPromptParts.actionTags).toEqual([
      "Maintain Maya as only clear visible subject, Preserve yellow rain jacket, Use traffic lights to show urgency, Show grease on hands, must clearly signal late library return, rainy evening with warm interior contrast, and distant",
    ]);
    expect(shot?.animaPromptParts.settingTags).toEqual(expect.arrayContaining([
      expect.stringContaining("riding shaky bicycle"),
    ]));
    expect(shot?.outputAnchors.lighting).toContain("rainy evening with warm interior contrast");
  });

  it("normalizes verbose Story safety blocks into compact negative prompt tags", () => {
    const renderPlan = assembleStoryRenderPlan({
      parameterPlan: createStoryParameterPlan({ storyId, defaults }),
      resourcePlan: createResourcePlan(),
      safetyPlan: {
        ...safetyPlan,
        blockedContent: [
          "Any sexualization of characters under 16 or teen-coded characters",
          "Nudity, fetish framing, or voyeuristic emphasis",
          "Non-consensual sexual content of any kind",
          "Graphic bodily injury, gore, or severe accident aftermath",
          "Criminal misconduct shown as aspirational behavior",
          "Demeaning/stereotyped depiction of a protected group",
          "Aging up or ambiguously portraying Maya as adult to bypass safeguards",
        ],
      },
      shots,
    });
    const negativePrompt = renderPlan.shots[0]?.negativePrompt ?? "";

    expect(negativePrompt).toContain("sexualized minor");
    expect(negativePrompt).toContain("childlike face");
    expect(negativePrompt).toContain("nude");
    expect(negativePrompt).toContain("fetish");
    expect(negativePrompt).not.toContain("non-consensual");
    expect(negativePrompt).toContain("gore");
    expect(negativePrompt).toContain("severe injury");
    expect(negativePrompt).toContain("crime");
    expect(negativePrompt).toContain("stereotype");
    expect(negativePrompt).toContain("aged-up minor");
    expect(negativePrompt).not.toContain("Any sexualization");
    expect(negativePrompt).not.toContain("under 16");
    expect(negativePrompt).not.toContain("Non-consensual sexual content of any kind");
    expect(negativePrompt).not.toContain("Aging up or ambiguously portraying Maya as adult to bypass safeguards");
  });

  it("canonicalizes minor and age-gap safety sentences into ordered negative tags", () => {
    const renderPlan = assembleStoryRenderPlan({
      parameterPlan: createStoryParameterPlan({ storyId, defaults }),
      resourcePlan: createResourcePlan(),
      safetyPlan: {
        ...safetyPlan,
        blockedContent: [
          "sexualized depiction of teenage courier",
          "romantic or sexual framing between teenage courier and child recipient",
          "sexualized depiction of little girl",
          "nude",
          "non-consensual sexual content",
          "sexual violence and coercion",
          "gore or severe injury",
          "childlike face",
        ],
      },
      shots,
    });

    expect(renderPlan.shots[0]?.negativePrompt).toBe("sexualized minor, age-gap romantic framing, nude, gore, severe injury, childlike face");
    expect(renderPlan.shots[0]?.negativePrompt).not.toContain("teenage courier");
    expect(renderPlan.shots[0]?.negativePrompt).not.toContain("little girl");
    expect(renderPlan.shots[0]?.negativePrompt).not.toContain("romantic or sexual framing");
  });

  it("preserves manually edited Story render prompts when creating execution requests", () => {
    const resourcePlan = createAnimaResourcePlan();
    const renderPlan = assembleStoryRenderPlan({
      parameterPlan: createStoryParameterPlan({ storyId, defaults }),
      resourcePlan,
      safetyPlan,
      shots,
    });
    const editedRenderPlan = {
      ...renderPlan,
      shots: renderPlan.shots.map((shot, index) =>
        index === 0
          ? {
              ...shot,
              positivePrompt: "manual edited anima prompt, anima_style",
              negativePrompt: "manual edited negative",
            }
          : shot,
      ),
    };
    const finalBatch = createStoryExecutionRequestBatch({ mode: "final", renderPlan: editedRenderPlan, resourcePlan });
    const firstRequest = finalBatch.requests[0]?.request;

    expect(firstRequest?.positivePrompt).toBe("manual edited anima prompt, anima_style");
    expect(firstRequest?.negativePrompt).toContain("manual edited negative");
    expect(firstRequest?.negativePrompt).toContain("worst quality");
  });

  it("injects only approved character and outfit references into final Anima execution requests", () => {
    const resourcePlan = createAnimaResourcePlan();
    const referenceAssetPlan = createApprovedStoryReferenceAssetPlan();
    const renderPlan = assembleStoryRenderPlan({
      parameterPlan: createStoryParameterPlan({ storyId, defaults }),
      referenceAssetPlan,
      resourcePlan,
      safetyPlan,
      shots,
    });
    const finalBatch = createStoryExecutionRequestBatch({
      mode: "final",
      referenceAssetPlan,
      renderPlan,
      resourcePlan,
    });
    const previewBatch = createStoryExecutionRequestBatch({
      mode: "preview",
      referenceAssetPlan,
      renderPlan,
      resourcePlan,
    });

    expect(finalBatch.requests.find((request) => request.shotId === "shot-1")?.request.characterReferences).toEqual([
      expect.objectContaining({
        id: "story-reference:character-face:lead",
        images: [{ id: "story-reference:character-face:lead:approved", imageName: "character-face-lead.png" }],
        mode: "face",
        name: "Lead character-face reference",
      }),
      expect.objectContaining({
        id: "story-reference:character-bust:lead",
        images: [{ id: "story-reference:character-bust:lead:approved", imageName: "character-bust-lead.png" }],
        mode: "ipadapter",
        name: "Lead character-bust reference",
      }),
    ]);
    expect(finalBatch.requests.find((request) => request.shotId === "shot-2")?.request.characterReferences).toEqual([
      expect.objectContaining({
        id: "story-reference:character-face:lead",
      }),
      expect.objectContaining({
        id: "story-reference:outfit:raincoat",
        images: [{ id: "story-reference:outfit:raincoat:approved", imageName: "outfit-raincoat.png" }],
        mode: "ipadapter",
        name: "Raincoat outfit reference",
      }),
    ]);
    expect(JSON.stringify(finalBatch.requests)).not.toContain("prop:signal-card");
    expect(JSON.stringify(finalBatch.requests)).not.toContain("location:station");
    expect(JSON.stringify(finalBatch.requests)).not.toContain("character-face:unapproved");
    expect(JSON.stringify(finalBatch.requests)).not.toContain("character-face:old-revision");
    expect(JSON.stringify(finalBatch.requests)).not.toContain("outfit:prompt-only");
    expect(previewBatch.requests[0]?.request.characterReferences).toBeUndefined();
  });

  it("does not inject Anima character references into non-Anima execution requests", () => {
    const resourcePlan = createResourcePlan();
    const referenceAssetPlan = createApprovedStoryReferenceAssetPlan();
    const renderPlan = assembleStoryRenderPlan({
      parameterPlan: createStoryParameterPlan({ storyId, defaults }),
      referenceAssetPlan,
      resourcePlan,
      safetyPlan,
      shots,
    });
    const finalBatch = createStoryExecutionRequestBatch({
      mode: "final",
      referenceAssetPlan,
      renderPlan,
      resourcePlan,
    });

    expect(finalBatch.requests[0]?.request.characterReferences).toBeUndefined();
    expect(finalBatch.requests[1]?.request.characterReferences).toBeUndefined();
  });

  it("keeps source-image continuity separate from approved Story character reference injection", () => {
    const resourcePlan = createAnimaResourcePlan();
    const referenceAssetPlan = createApprovedStoryReferenceAssetPlan();
    const renderPlan = assembleStoryRenderPlan({
      img2imgDenoise: 0.73,
      parameterPlan: createStoryParameterPlan({ storyId, defaults }),
      referenceAssetPlan,
      resourcePlan,
      safetyPlan,
      shots,
    });
    const finalBatch = createStoryExecutionRequestBatch({
      mode: "final",
      referenceAssetPlan,
      renderPlan,
      resourcePlan,
    });
    const shotTwo = finalBatch.requests.find((request) => request.shotId === "shot-2");

    expect(shotTwo?.sourceShotIds).toEqual(["shot-1"]);
    expect(shotTwo?.request.denoise).toBe(0.73);
    expect(shotTwo?.request.imageName).toBeUndefined();
    expect(shotTwo?.request.characterReferences?.map((reference) => reference.id)).toEqual([
      "story-reference:character-face:lead",
      "story-reference:outfit:raincoat",
    ]);
    expect(JSON.stringify(shotTwo?.request.characterReferences)).not.toContain("source-shot");
  });

  it("filters invalid stored source-image continuity at the execution boundary", () => {
    const resourcePlan = createResourcePlan();
    const futureSourceShots = [
      shots[0],
      {
        ...shots[1],
        sourceShotIds: [],
      },
      {
        ...shots[1],
        id: "shot-3",
        order: 3,
        title: "Future station view",
        sourceShotIds: [],
      },
    ] satisfies StoryShot[];
    const renderPlan = assembleStoryRenderPlan({
      img2imgDenoise: 0.62,
      parameterPlan: createStoryParameterPlan({ storyId, defaults }),
      resourcePlan,
      safetyPlan,
      shots: futureSourceShots,
    });
    const storedRenderPlan = {
      ...renderPlan,
      shots: renderPlan.shots.map((shot) =>
        shot.shotId === "shot-2"
          ? {
              ...shot,
              locationContinuity: {
                mode: "source-image" as const,
                sourceShotIds: ["shot-1", "shot-2", "shot-3"],
                reason: "Tampered stored plan points at a valid earlier shot, self, and a future shot.",
                notes: [],
              },
              sourceShotIds: ["shot-1", "shot-2", "shot-3"],
            }
          : shot,
      ),
    };
    const storedShot = storedRenderPlan.shots.find((shot) => shot.shotId === "shot-2");
    const finalBatch = createStoryExecutionRequestBatch({ mode: "final", renderPlan: storedRenderPlan, resourcePlan });
    const requestPreview = storedShot
      ? createStoryGenerationRequestPreview(storedShot, storedRenderPlan.img2imgDenoise, {
          eligibleSourceShotIds: getStoryRenderPlanEligibleSourceShotIds(storedRenderPlan.shots, storedShot.shotId),
        })
      : null;

    expect(storedShot?.locationContinuity).toMatchObject({
      mode: "source-image",
      sourceShotIds: ["shot-1", "shot-2", "shot-3"],
    });
    expect(finalBatch.requests.find((request) => request.shotId === "shot-2")?.sourceShotIds).toEqual(["shot-1"]);
    expect(finalBatch.requests.find((request) => request.shotId === "shot-2")?.request.denoise).toBe(0.62);
    expect(requestPreview?.sourceShotIds).toEqual(["shot-1"]);
    expect(requestPreview?.locationContinuity.sourceShotIds).toEqual(["shot-1"]);
    expect(requestPreview?.parameters.denoise).toBe(0.62);
  });

  it("tolerates legacy render plans that still carry per-shot resource objects", () => {
    const resourcePlan = createResourcePlan();
    const renderPlan = assembleStoryRenderPlan({
      parameterPlan: createStoryParameterPlan({ storyId, defaults }),
      resourcePlan,
      safetyPlan,
      shots,
    });
    const legacyRenderPlan = {
      ...renderPlan,
      shots: renderPlan.shots.map((shot) => ({
        ...shot,
        resources: {
          checkpoint: resourcePlan.checkpoint,
          loras: resourcePlan.loras,
        },
      })),
    } satisfies typeof renderPlan;
    const legacyBatch = createStoryExecutionRequestBatch({ mode: "final", renderPlan: legacyRenderPlan });

    expect(legacyBatch.requests[0]?.request).toMatchObject({
      checkpointName: "local.safetensors",
      loras: [{ loraName: "local-lora.safetensors", strengthModel: 0.6 }],
    });
  });

  it("requires the authoritative resource plan for compact render plans", () => {
    const resourcePlan = createResourcePlan();
    const renderPlan = assembleStoryRenderPlan({
      parameterPlan: createStoryParameterPlan({ storyId, defaults }),
      resourcePlan,
      safetyPlan,
      shots,
    });

    expect(() => createStoryExecutionRequestBatch({ mode: "final", renderPlan })).toThrow(
      StoryResourcePlanValidationError,
    );
  });

  it("assembles final and preview execution requests without model NSFW resource filtering", () => {
    const resourcePlan = createResourcePlan();
    const renderPlan = assembleStoryRenderPlan({
      img2imgDenoise: 0.72,
      parameterPlan: createStoryParameterPlan({ storyId, defaults }),
      previewOptions: {
        enabled: true,
        shotIds: ["shot-2"],
        parameterOverrides: { width: 512, height: 384, steps: 8 },
      },
      resourcePlan,
      safetyPlan,
      shots,
    });
    const finalBatch = createStoryExecutionRequestBatch({ mode: "final", renderPlan, resourcePlan });
    const previewBatch = createStoryExecutionRequestBatch({ mode: "preview", renderPlan, resourcePlan });

    expect(finalBatch.requests).toHaveLength(2);
    expect(renderPlan.img2imgDenoise).toBe(0.72);
    expect(finalBatch.requests[0]?.request.denoise).toBe(1);
    expect(finalBatch.requests[1]?.request.denoise).toBe(0.72);
    expect(previewBatch.requests).toHaveLength(1);
    expect(previewBatch.requests[0]).toMatchObject({
      shotId: "shot-2",
      nsfwContext: renderPlan.nsfwContext,
      request: {
        checkpointName: "local.safetensors",
        loras: [{ loraName: "local-lora.safetensors", strengthModel: 0.6 }],
        preview: true,
        width: 512,
        height: 384,
        steps: 8,
        denoise: 0.72,
      },
    });
    expect(JSON.stringify(finalBatch)).not.toContain("modelNsfw");
    expect(JSON.stringify(previewBatch)).not.toContain("aiNsfwLevel");
  });

  it("normalizes Story execution requests against live sampler and scheduler options", () => {
    const resourcePlan = createResourcePlan();
    const renderPlan = assembleStoryRenderPlan({
      parameterPlan: createStoryParameterPlan({ storyId, defaults }),
      resourcePlan,
      safetyPlan,
      shots,
    });
    const editedRenderPlan = {
      ...renderPlan,
      shots: renderPlan.shots.map((shot) => ({
        ...shot,
        parameters: {
          ...shot.parameters,
          samplerName: "invented_sampler",
          scheduler: "invented_scheduler",
        },
      })),
    };
    const finalBatch = createStoryExecutionRequestBatch({
      mode: "final",
      renderPlan: editedRenderPlan,
      resourcePlan,
      samplerOptions: {
        samplers: ["uni_pc"],
        schedulers: ["sgm_uniform"],
      },
    });

    expect(finalBatch.requests[0]?.request).toMatchObject({
      samplerName: "uni_pc",
      scheduler: "sgm_uniform",
    });
  });
});
