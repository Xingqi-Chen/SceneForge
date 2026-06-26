import { describe, expect, it } from "vitest";

import {
  assembleStoryRenderPlan,
  createStoryExecutionRequestBatch,
  createStoryDefaultGenerationParameters,
  createStoryParameterPlan,
  createStoryPreviewParameters,
  createStoryResourcePlan,
  StoryResourcePlanValidationError,
  type StoryGenerationParameters,
  type StoryLocalResource,
  type StoryPreviewExecutionOptions,
} from "./story-planning";
import type { StorySafetyPlan, StoryShot } from "./story-types";

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

describe("story planning", () => {
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
    expect(renderPlan.preview.resultReferences).toHaveLength(1);
    expect(renderPlan.shots[1]).toMatchObject({
      shotId: "shot-2",
      negativePrompt: "gore, severe injury",
      parameters: defaults,
    });
    expect(renderPlan.shots[1]?.positivePrompt).toContain("red signal reflected in puddle");
    expect(renderPlan.shots[1]?.positivePrompt).toContain("lead noticing red signal");
    expect(renderPlan.shots[1]?.positivePrompt).toContain("raincoat visible");
    expect(renderPlan.shots[1]?.negativePrompt).not.toContain("Keep the scene symbolic.");
    expect(renderPlan.shots[1]?.outputAnchors.environment).toContain("red signal reflected in puddle");
    expect(renderPlan.shots[1]?.outputAnchors.clothing).toContain("raincoat visible");
    expect(renderPlan.shots[1]?.outputAnchors.camera).toContain("low close-up");
    expect(renderPlan.shots[1]?.outputAnchors.negative).toEqual(["gore", "severe injury"]);
    expect(renderPlan.shots[1]?.outputAnchors.source).toMatchObject({
      mode: "source-image",
      sourceShotIds: ["shot-1"],
    });
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

  it("normalizes string per-shot parameter overrides and falls back invalid numeric values", () => {
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
      height: 384,
      samplerName: "uni_pc",
      scheduler: "sgm_uniform",
      steps: 12,
      width: 512,
    });
    expect(parameterPlan.perShotOverrides[1]?.parameters).toMatchObject({
      cfg: defaults.cfg,
      denoise: defaults.denoise,
    });
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

  it("infers Story generation dimensions from requested framing instead of fixed 1024x768", () => {
    const portraitDefaults = createStoryDefaultGenerationParameters({
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
    const landscapeDefaults = createStoryDefaultGenerationParameters({
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

    expect(portraitDefaults).toMatchObject({
      width: 832,
      height: 1216,
    });
    expect(landscapeDefaults).toMatchObject({
      width: 1216,
      height: 832,
    });
    expect(explicitDefaults).toMatchObject({
      width: 1536,
      height: 1024,
    });
    expect(portraitDefaults).not.toMatchObject({
      width: 1024,
      height: 768,
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

  it("keeps solo seated adult Story shots portrait-oriented and filters adult NSFW safety boilerplate", () => {
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
      width: 832,
      height: 1216,
    });
    for (const shot of renderPlan.shots) {
      expect(shot.parameters).toMatchObject({
        width: 832,
        height: 1216,
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
    expect(prompts).not.toMatch(/\b(?:sliding off to|torso subtly|bare shoulders with|brings one hand)(?:,|$)/i);
    expect(renderPlan.shots[1]?.positivePrompt).toContain("loosened clothing sliding off shoulders");
    expect(renderPlan.shots[2]?.positivePrompt).toContain("lowered clothing exposing upper body");
    expect(firstAnchors?.camera).toEqual(expect.arrayContaining(["straight-on eye level"]));
    expect(firstAnchors?.lighting).toEqual(expect.arrayContaining(["warm low-key room lighting"]));
    expect(firstAnchors?.subject).toEqual(expect.arrayContaining(["Rupa is only visible character"]));
    expect(finalAnchors?.action).toEqual(expect.arrayContaining([
      "hand-to-chest gesture",
    ]));
  });

  it("reuses the base-model-aware ComfyUI prompt resolver for Story render prompts", () => {
    const renderPlan = assembleStoryRenderPlan({
      parameterPlan: createStoryParameterPlan({ storyId, defaults }),
      resourcePlan: createAnimaResourcePlan(),
      safetyPlan,
      shots,
    });
    const finalBatch = createStoryExecutionRequestBatch({ mode: "final", renderPlan });
    const firstShot = renderPlan.shots[0];
    const firstRequest = finalBatch.requests[0]?.request;

    expect(firstShot.positivePrompt).toContain("masterpiece");
    expect(firstShot.positivePrompt).toContain("score_7");
    expect(firstShot.positivePrompt).not.toContain("score_9");
    expect(firstShot.positivePrompt).not.toContain("score_8");
    expect(firstShot.positivePrompt).toContain("anima_style");
    expect(firstShot.negativePrompt).toContain("worst quality");
    expect(firstShot.negativePrompt).toContain("score_1");
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
    expect(shot?.positivePrompt).not.toContain("score_9");
    expect(shot?.positivePrompt).not.toContain("score_8");
    expect(shot?.negativePrompt).toContain("nsfw");
    expect(shot?.negativePrompt).toContain("sexualized minor");
    expect(shot?.negativePrompt).toContain("revealing clothes");
    expect(shot?.negativePrompt).toContain("fetishized");
    expect(shot?.negativePrompt).not.toContain("childlike face");
    expect(shot?.negativePrompt).not.toContain("non-consensual");
    expect(shot?.negativePrompt).not.toContain("sexual violence");
    expect(shot?.negativePrompt).not.toContain("coercion");
  });

  it("compacts Story shot prompts while preserving Illustrious base-model section order", () => {
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
    const subjectIndex = prompt.indexOf("older teen bike messenger");
    const clothingIndex = prompt.indexOf("red rain jacket");
    const actionIndex = prompt.indexOf("kneeling beside greasy broken chain");
    const environmentIndex = prompt.indexOf("umbrellas and produce stalls");
    const cameraIndex = prompt.indexOf("medium-wide slightly low angle");
    const lightingIndex = prompt.indexOf("overcast rainy daylight");

    expect(prompt.startsWith("masterpiece, best quality, amazing quality, very aesthetic, newest")).toBe(true);
    expect(subjectIndex).toBeGreaterThan(-1);
    expect(clothingIndex).toBeGreaterThan(subjectIndex);
    expect(actionIndex).toBeGreaterThan(clothingIndex);
    expect(environmentIndex).toBeGreaterThan(actionIndex);
    expect(cameraIndex).toBeGreaterThan(environmentIndex);
    expect(lightingIndex).toBeGreaterThan(cameraIndex);
    expect(prompt).not.toContain("extra storefront description");
    expect(renderPlan.shots[0]?.outputAnchors.subject).toContain("older teen bike messenger with freckles");
    expect(renderPlan.shots[0]?.outputAnchors.clothing).toContain("red rain jacket");
    expect(renderPlan.shots[0]?.outputAnchors.action).toContain("kneeling beside greasy broken chain");
    expect(renderPlan.shots[0]?.outputAnchors.environment).toContain("umbrellas and produce stalls");
    expect(renderPlan.shots[0]?.outputAnchors.lighting).toContain("overcast rainy daylight");
    expect(renderPlan.shots[0]?.outputAnchors.source).toMatchObject({
      mode: "none",
      sourceShotIds: [],
    });
  });

  it("prioritizes camera composition and lighting buckets while compacting long Story anchors", () => {
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

    expect(anchors?.camera).toContain("Medium-wide street-level view with centered bridge approach composition");
    expect(anchors?.environment).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining("Medium-wide"),
      ]),
    );
    expect(anchors?.action).toContain("lifting bicycle through narrow alley");
    expect(anchors?.environment).toContain("distant police barricades near bridge route");
    expect(anchors?.lighting).toContain("cool rainy street lighting");
    expect(anchors?.detail).toEqual(expect.arrayContaining(["cinematic illustrated realism", "damp urban textures"]));
    expect(anchors?.clothing).toContain("bright yellow rain jacket");
    expect(JSON.stringify(anchors)).not.toContain("One hand gripping the bike frame as he squeezes past");
    expect(JSON.stringify(anchors)).not.toContain("Keep wardrobe continuity");
  });

  it("removes Story meta instructions while preserving beat actions and final subjects", () => {
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

    expect(prompts).not.toMatch(/Show only|He should|This shot marks|visible human subject/i);
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

  it("cleans Anima Story meta instructions, dangling fragments, and action buckets", () => {
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
    expect(prompt).toContain("locking bicycle then sprinting");
    expect(prompt).toContain("sliding book through return slot");
    expect(prompt).toContain("rainy evening with warm interior contrast");
    expect(prompt).toContain("medium-wide low angle composition");
    expect(prompt).not.toContain("medium-wide low angle,");
    expect(prompt).not.toMatch(/Maintain|Preserve|Use traffic|Show grease|must clearly signal|as only clear visible subject/i);
    expect(prompt).not.toMatch(/\b(?:and distant|far|from)(?:,|$)/i);
    expect(shot?.outputAnchors.action).toEqual(
      expect.arrayContaining([
        "riding shaky bicycle",
        "wheel jammed",
        "locking bicycle then sprinting",
        "sliding book through return slot",
      ]),
    );
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
    const renderPlan = assembleStoryRenderPlan({
      parameterPlan: createStoryParameterPlan({ storyId, defaults }),
      resourcePlan: createAnimaResourcePlan(),
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
    const finalBatch = createStoryExecutionRequestBatch({ mode: "final", renderPlan: editedRenderPlan });
    const firstRequest = finalBatch.requests[0]?.request;

    expect(firstRequest?.positivePrompt).toBe("manual edited anima prompt, anima_style");
    expect(firstRequest?.negativePrompt).toContain("manual edited negative");
    expect(firstRequest?.negativePrompt).toContain("worst quality");
  });

  it("assembles final and preview execution requests without model NSFW resource filtering", () => {
    const renderPlan = assembleStoryRenderPlan({
      parameterPlan: createStoryParameterPlan({ storyId, defaults }),
      previewOptions: {
        enabled: true,
        shotIds: ["shot-2"],
        parameterOverrides: { width: 512, height: 384, steps: 8 },
      },
      resourcePlan: createResourcePlan(),
      safetyPlan,
      shots,
    });
    const finalBatch = createStoryExecutionRequestBatch({ mode: "final", renderPlan });
    const previewBatch = createStoryExecutionRequestBatch({ mode: "preview", renderPlan });

    expect(finalBatch.requests).toHaveLength(2);
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
      },
    });
    expect(JSON.stringify(finalBatch)).not.toContain("modelNsfw");
    expect(JSON.stringify(previewBatch)).not.toContain("aiNsfwLevel");
  });

  it("normalizes Story execution requests against live sampler and scheduler options", () => {
    const renderPlan = assembleStoryRenderPlan({
      parameterPlan: createStoryParameterPlan({ storyId, defaults }),
      resourcePlan: createResourcePlan(),
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
