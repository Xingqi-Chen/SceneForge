import {
  assembleStoryRenderPlan,
  createStoryExecutionRequestBatch,
  createStoryDefaultGenerationParameters,
  createStoryGenerationRequestPreview,
  createStoryParameterPlan,
  createStoryResourcePlan,
  getStoryRenderPlanEligibleSourceShotIds,
  getStoryInputImg2ImgDenoise,
  normalizeStoryImg2ImgDenoise,
  type StoryGenerationRequestPreview,
  type StoryLocalResource,
  type StoryParameterPlan,
  type StoryRenderPlan,
  type StoryResourcePlan,
} from "./story-planning";
import {
  createStoryShotExecutionState,
  type StoryShotGraphExecutionState,
  type StoryShotResultReference,
} from "./story-execution";
import {
  deriveStoryReferenceAssetPlan,
  evaluateStoryReferenceAssetFreezeGate,
} from "./story-reference-assets";
import { refreshStoryWorkflowReadiness, type StoryWorkflowState } from "./story-state";
import {
  validateShotDependencyGraph,
} from "./story-workflow";
import type {
  CharacterContinuityGraph,
  PlotStateGraph,
  ShotDependencyGraph,
  StoryAudienceRating,
  StoryBible,
  StoryEntityCards,
  StoryReferenceAssetFreezeGate,
  StoryReferenceAssetPlan,
  StoryConsistencyCheck,
  StoryConsistencyIssue,
  StoryInput,
  StoryNsfwContext,
  StoryOutline,
  StorySafetyPlan,
  StoryShot,
  StoryWorkflowNodeId,
} from "./story-types";
import { createStoryWorkflowState } from "./story-state";
import type { PromptProfileId } from "@/shared/prompt-profile";
import {
  sanitizeStoryStylePaletteSnapshot,
  type StoryStylePaletteLoraSnapshot,
  type StoryStylePaletteSnapshot,
} from "./story-style-palette";

type StoryClock = () => string;

export type StoryGraphStartSettingsSnapshot = {
  capturedAt: string;
  nsfwEnabled: boolean;
  source: "story-form";
  targetShotCount?: number;
  audienceRating: StoryAudienceRating;
  img2imgDenoise: number;
  planningMode: "deterministic-local";
  promptProfile?: PromptProfileId;
  resourceCandidateCounts?: {
    checkpoints: number;
    loras: number;
  };
  resourceCandidates?: {
    checkpoints: StoryLocalResource[];
    loras: StoryLocalResource[];
  };
  stylePalette?: StoryStylePaletteSnapshot;
};

export type StoryGraphStartRequest = {
  rawIntent: string;
  nsfwEnabled?: boolean;
  now?: StoryClock;
  settingsSnapshot?: Partial<StoryGraphStartSettingsSnapshot>;
  storyId?: string;
  targetShotCount?: number;
  workflowId?: string;
};

export type StoryGenerationGatePreview = {
  storyId: string;
  ready: boolean;
  executionAvailable: boolean;
  assetFreezeGate: StoryReferenceAssetFreezeGate;
  blockingReason?: string;
  confirmationRequired: boolean;
  nsfwContext: StoryNsfwContext;
  renderPlanShotCount: number;
  previewEnabled: boolean;
  requestPreview: StoryGenerationRequestPreview[];
};

export type StoryResultDisplayPending = {
  storyId: string;
  status: "pending";
  nsfwContext: StoryNsfwContext;
  previewReferences: [];
  finalReferences: StoryShotResultReference[];
};

export type StoryPlanningArtifacts = {
  input: StoryInput;
  bible: StoryBible;
  outline: StoryOutline;
  shots: StoryShot[];
  safetyPlan: StorySafetyPlan;
  dependencyGraph: ShotDependencyGraph;
  plotStateGraph: PlotStateGraph;
  characterContinuityGraph: CharacterContinuityGraph;
  entityCards: StoryEntityCards;
  referenceAssetPlan: StoryReferenceAssetPlan;
  resourcePlan: StoryResourcePlan;
  parameterPlan: StoryParameterPlan;
  renderPlan: StoryRenderPlan;
  consistencyCheck: StoryConsistencyCheck;
  generationGate: StoryGenerationGatePreview;
  execution: StoryShotGraphExecutionState;
  resultDisplay: StoryResultDisplayPending;
};

export type StoryGraphInputWorkflowStart = {
  input: StoryInput;
  workflow: StoryWorkflowState;
};

const defaultTimestamp = "2026-06-14T00:00:00.000Z";
const maxTargetShotCount = 24;

function defaultNow() {
  return new Date().toISOString();
}

function normalizeTargetShotCount(value: number | undefined) {
  if (!Number.isFinite(value ?? Number.NaN)) {
    return undefined;
  }

  return Math.min(maxTargetShotCount, Math.max(1, Math.round(value as number)));
}

function slugifyIdPart(value: string) {
  const slug = value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);

  return slug || "story";
}

function deriveTitle(rawIntent: string) {
  const sentence = rawIntent.split(/[.!?]/)[0]?.trim() ?? rawIntent.trim();
  return sentence;
}

function createSettingsSnapshot({
  audienceRating,
  nsfwEnabled,
  request,
  targetShotCount,
  timestamp,
}: {
  audienceRating: StoryAudienceRating;
  nsfwEnabled: boolean;
  request: StoryGraphStartRequest;
  targetShotCount?: number;
  timestamp: string;
}): StoryGraphStartSettingsSnapshot {
  const {
    resourceCandidates,
    stylePalette,
    ...settingsSnapshot
  } = request.settingsSnapshot ?? {};
  const sanitizedStylePalette = sanitizeStoryStylePaletteSnapshot(stylePalette);

  return {
    capturedAt: settingsSnapshot.capturedAt ?? timestamp,
    source: "story-form",
    planningMode: "deterministic-local",
    ...settingsSnapshot,
    audienceRating,
    img2imgDenoise: normalizeStoryImg2ImgDenoise(settingsSnapshot.img2imgDenoise),
    nsfwEnabled,
    resourceCandidateCounts: resourceCandidates
      ? {
          checkpoints: resourceCandidates.checkpoints.length,
          loras: resourceCandidates.loras.length,
        }
      : settingsSnapshot.resourceCandidateCounts,
    ...(sanitizedStylePalette ? { stylePalette: sanitizedStylePalette } : {}),
    targetShotCount,
  } as StoryGraphStartSettingsSnapshot;
}

function createNsfwContext({
  audienceRating,
  enabled,
}: {
  audienceRating: StoryAudienceRating;
  enabled: boolean;
}): StoryNsfwContext {
  return {
    audienceRating,
    contentWarnings: [],
    enabled,
    rationale: enabled ? "NSFW is enabled in SceneForge settings." : "NSFW is disabled in SceneForge settings.",
  };
}

export function createStoryInputFromStartRequest(request: StoryGraphStartRequest): StoryInput {
  const rawIntent = request.rawIntent.trim();

  if (!rawIntent) {
    throw new Error("Story request is required.");
  }

  const nsfwEnabled = request.nsfwEnabled ?? request.settingsSnapshot?.nsfwEnabled ?? false;
  const audienceRating: StoryAudienceRating = nsfwEnabled ? "explicit" : "safe";
  const targetShotCount = normalizeTargetShotCount(request.targetShotCount);
  const now = request.now ?? defaultNow;
  const timestamp = now();
  const storyId = request.storyId ?? `story-${slugifyIdPart(rawIntent)}-${timestamp.replace(/[^0-9]/g, "").slice(0, 14)}`;

  return {
    storyId,
    rawIntent,
    title: undefined,
    targetShotCount,
    audienceRating,
    nsfwContext: createNsfwContext({
      audienceRating,
      enabled: nsfwEnabled,
    }),
    settingsSnapshot: createSettingsSnapshot({
      audienceRating,
      nsfwEnabled,
      request,
      targetShotCount,
      timestamp,
    }),
  };
}

function createBible(input: StoryInput): StoryBible {
  const title = deriveTitle(input.rawIntent);

  return {
    storyId: input.storyId,
    title,
    logline: input.rawIntent,
    genre: ["visual story", input.audienceRating === "safe" ? "general audience" : `${input.audienceRating ?? "safe"} audience`],
    themes: ["continuity", "storyboard clarity"],
    worldSummary: input.rawIntent,
    visualStyle: "Cinematic storyboard frames with consistent character and location anchors.",
    characters: [
      {
        id: "main-character",
        name: "Main character",
        role: "Lead",
        description: "Primary subject inferred from the story request.",
        continuityNotes: ["Keep silhouette, wardrobe, and expression readable across shots."],
        visualAnchors: ["consistent outfit", "clear facial direction", "stable color palette"],
      },
    ],
    locations: [
      {
        id: "primary-location",
        name: "Primary location",
        description: input.rawIntent,
        visualAnchors: ["establishing environment", "recurring background details"],
      },
    ],
    props: [],
    continuityRules: [
      "Preserve the main character identity across all shots.",
      "Carry important props and environmental details forward when referenced.",
      "Use source-shot dependencies only when a later shot must receive an earlier generated image during execution.",
    ],
  };
}

function getPlanningShotCount(input: StoryInput) {
  return input.targetShotCount ?? input.storySegments?.length ?? 1;
}

function createOutline(input: StoryInput): StoryOutline {
  const shotCount = getPlanningShotCount(input);
  const segments = input.targetShotCount === undefined ? input.storySegments ?? [] : input.storySegments ?? [];

  return {
    storyId: input.storyId,
    beats: Array.from({ length: shotCount }, (_, index) => {
      const segment = segments[index];

      return {
        id: segment?.id ?? `beat-${index + 1}`,
        title: segment?.title ?? (index === 0 ? "Opening image" : index === shotCount - 1 ? "Closing image" : `Story beat ${index + 1}`),
        summary: segment?.sourceText ?? (index === 0
          ? `Establish the story request: ${input.rawIntent}`
          : index === shotCount - 1
            ? "Resolve the visual moment while preserving continuity."
            : "Advance the action and keep visual continuity clear."),
        order: index + 1,
        characterIds: ["main-character"],
      };
    }),
  };
}

function createShots(input: StoryInput, outline: StoryOutline): StoryShot[] {
  const shotCount = input.targetShotCount ?? outline.beats.length;

  return Array.from({ length: shotCount }, (_, index) => {
    const beat = outline.beats[index] ?? outline.beats[outline.beats.length - 1];
    const order = index + 1;

    return {
      id: `shot-${order}`,
      storyId: input.storyId,
      order,
      title: beat?.title ?? `Shot ${order}`,
      description: beat?.summary ?? input.rawIntent,
      beatId: beat?.id,
      locationId: "primary-location",
      characterIds: ["main-character"],
      sourceShotIds: [],
      camera: order === 1 ? "Wide establishing frame" : order === shotCount ? "Resolved closing frame" : "Medium continuity frame",
      promptIntent: `${beat?.summary ?? input.rawIntent}, storyboard shot ${order} of ${shotCount}`,
      continuityNotes: [
        ...(input.storyContext ? [input.storyContext] : []),
        "Keep main character identity consistent.",
        order > 1 ? `Preserve visual anchors from shot ${order - 1}.` : "Establish reusable visual anchors.",
      ],
      appearanceState: {
        characterStates: [
          {
            characterId: "main-character",
            appearance: "Primary subject inferred from the story request in a consistent outfit.",
            continuityNotes: ["Keep the main character silhouette and outfit stable."],
            outfitId: "main-character-default-outfit",
            visible: true,
          },
        ],
        notes: ["Local planning default; LLM planning should refine visible appearance state."],
        propIds: [],
      },
      interactionState: {
        characterIds: ["main-character"],
        continuityNotes: ["Local planning default; LLM planning should refine interaction state."],
        description: beat?.summary ?? input.rawIntent,
        physicalContact: [],
        propIds: [],
      },
      locationViewState: {
        camera: order === 1 ? "Wide establishing frame" : order === shotCount ? "Resolved closing frame" : "Medium continuity frame",
        locationId: "primary-location",
        viewDescription: beat?.summary ?? input.rawIntent,
        visibleAnchors: ["establishing environment", "recurring background details"],
      },
    };
  });
}

function createSafetyPlan(input: StoryInput, shots: readonly StoryShot[]): StorySafetyPlan {
  const nsfwContext = input.nsfwContext ?? createNsfwContext({
    audienceRating: input.audienceRating ?? "safe",
    enabled: false,
  });

  return {
    storyId: input.storyId,
    audienceRating: nsfwContext.audienceRating,
    contentWarnings: [...nsfwContext.contentWarnings],
    blockedContent: nsfwContext.enabled ? ["non-consensual sexual content", "sexualized minors"] : [],
    perShotNotes: shots.map((shot) => ({
      shotId: shot.id,
      risks: nsfwContext.contentWarnings,
      mitigations: nsfwContext.enabled
        ? ["Keep execution aligned to the user-provided adult context and configured safety boundaries."]
        : ["Keep the shot within the selected audience rating."],
    })),
    nsfwContext: {
      enabled: nsfwContext.enabled,
      rationale: nsfwContext.rationale,
    },
  };
}

function createDependencyGraph(input: StoryInput, shots: readonly StoryShot[]): ShotDependencyGraph {
  return {
    storyId: input.storyId,
    nodes: shots.map((shot) => ({ shotId: shot.id, label: shot.title })),
    edges: shots.slice(1).map((shot, index) => ({
      fromShotId: shots[index]?.id ?? shots[0].id,
      toShotId: shot.id,
      reason: "story-order",
    })),
  };
}

function createPlotStateGraph(input: StoryInput, outline: StoryOutline, shots: readonly StoryShot[]): PlotStateGraph {
  return {
    storyId: input.storyId,
    states: outline.beats.map((beat) => ({
      id: `state-${beat.order}`,
      title: beat.title,
      summary: beat.summary,
      shotIds: shots.filter((shot) => shot.beatId === beat.id).map((shot) => shot.id),
    })),
    transitions: outline.beats.slice(1).map((beat, index) => ({
      fromStateId: `state-${index + 1}`,
      toStateId: `state-${beat.order}`,
      reason: "Sequential story beat progression.",
    })),
  };
}

function createCharacterContinuityGraph(input: StoryInput, bible: StoryBible, shots: readonly StoryShot[]): CharacterContinuityGraph {
  const character = bible.characters[0];

  return {
    storyId: input.storyId,
    characters: bible.characters.map((item) => ({
      characterId: item.id,
      name: item.name,
      canonicalDescription: item.description,
      visualAnchors: [...item.visualAnchors],
    })),
    appearances: shots.map((shot) => ({
      shotId: shot.id,
      characterId: character.id,
      wardrobe: ["consistent outfit"],
      poseOrAction: shot.description,
      expression: shot.order === 1 ? "establishing expression" : "continuity expression",
      continuityNotes: [...shot.continuityNotes],
    })),
  };
}

function createEntityCards(
  input: StoryInput,
  bible: StoryBible,
  shots: readonly StoryShot[],
  characterContinuityGraph: CharacterContinuityGraph,
): StoryEntityCards {
  const outfits = characterContinuityGraph.characters.map((character) => ({
    id: `${character.characterId}-default-outfit`,
    characterId: character.characterId,
    name: `${character.name} default outfit`,
    description: character.canonicalDescription,
    continuityNotes: ["Local planning default; LLM planning should refine outfit cards."],
    shotIds: shots
      .filter((shot) => shot.characterIds.includes(character.characterId))
      .map((shot) => shot.id),
    visualAnchors: [...character.visualAnchors],
  }));

  return {
    storyId: input.storyId,
    characters: bible.characters.map((character) => ({
      id: character.id,
      name: character.name,
      role: character.role,
      description: character.description,
      continuityNotes: [...character.continuityNotes],
      outfitIds: outfits.filter((outfit) => outfit.characterId === character.id).map((outfit) => outfit.id),
      propIds: [],
      shotIds: shots.filter((shot) => shot.characterIds.includes(character.id)).map((shot) => shot.id),
      visualAnchors: [...character.visualAnchors],
    })),
    outfits,
    props: bible.props.map((prop) => ({
      id: prop.id,
      name: prop.name,
      description: prop.description,
      continuityNotes: [...prop.continuityNotes],
      ownerCharacterIds: [...(prop.ownerCharacterIds ?? [])],
      shotIds: shots
        .filter((shot) =>
          (shot.appearanceState?.propIds ?? []).includes(prop.id) ||
          (shot.interactionState?.propIds ?? []).includes(prop.id),
        )
        .map((shot) => shot.id),
      visualAnchors: [...prop.visualAnchors],
    })),
    locations: bible.locations.map((location) => ({
      id: location.id,
      name: location.name,
      description: location.description,
      shotIds: shots
        .filter((shot) => shot.locationId === location.id || shot.locationViewState?.locationId === location.id)
        .map((shot) => shot.id),
      viewStates: shots
        .filter((shot) => shot.locationId === location.id || shot.locationViewState?.locationId === location.id)
        .map((shot) => ({
          shotId: shot.id,
          camera: shot.locationViewState?.camera ?? shot.camera,
          viewDescription: shot.locationViewState?.viewDescription ?? shot.description,
          visibleAnchors: [...(shot.locationViewState?.visibleAnchors ?? [])],
        })),
      visualAnchors: [...location.visualAnchors],
    })),
    planningErrors: [],
  };
}

function getStartResourceCandidates(
  input: StoryInput,
  resourceCandidates?: StoryGraphStartSettingsSnapshot["resourceCandidates"],
) {
  const snapshot = input.settingsSnapshot as StoryGraphStartSettingsSnapshot | undefined;
  const checkpoints = resourceCandidates?.checkpoints ?? snapshot?.resourceCandidates?.checkpoints ?? [];
  const loras = resourceCandidates?.loras ?? snapshot?.resourceCandidates?.loras ?? [];

  if (checkpoints.length > 0) {
    return {
      checkpoints,
      loras,
      usedFallback: false,
    };
  }

  return {
    checkpoints: [
      {
        id: "story-planning-fallback-checkpoint",
        name: "Story planning fallback checkpoint",
        baseModel: "Illustrious",
        modelFileName: "story-planning-fallback.safetensors",
      },
    ] satisfies StoryLocalResource[],
    loras: [] satisfies StoryLocalResource[],
    usedFallback: true,
  };
}

function getInputStylePalette(input: StoryInput): StoryStylePaletteSnapshot | undefined {
  const snapshot = input.settingsSnapshot as StoryGraphStartSettingsSnapshot | undefined;
  return sanitizeStoryStylePaletteSnapshot(snapshot?.stylePalette);
}

function findStartResourceById(candidates: StoryLocalResource[], id: string) {
  return candidates.find((candidate) => candidate.id === id) ?? null;
}

function getStartResourceBaseModel(resource: StoryLocalResource) {
  return (resource.modelBaseModel ?? resource.baseModel ?? "").trim().toLocaleLowerCase();
}

function areStartResourcesCompatible(lora: StoryLocalResource, checkpoint: StoryLocalResource) {
  const checkpointBaseModel = getStartResourceBaseModel(checkpoint);
  const loraBaseModel = getStartResourceBaseModel(lora);

  return !checkpointBaseModel || !loraBaseModel || checkpointBaseModel === loraBaseModel;
}

function getStyleLoraSuggestedWeight(
  loraSnapshot: StoryStylePaletteLoraSnapshot,
  resource: StoryLocalResource,
) {
  if (Number.isFinite(loraSnapshot.strengthModel)) {
    return Number(loraSnapshot.strengthModel);
  }

  return resource.averageWeight ?? null;
}

function applyStyleLoraWeights(
  resource: StoryLocalResource,
  loraSnapshot: StoryStylePaletteLoraSnapshot,
): StoryLocalResource {
  return {
    ...resource,
    ...(loraSnapshot.strengthModel !== undefined ? { storyInputStrengthModel: loraSnapshot.strengthModel } : {}),
    ...(loraSnapshot.strengthClip !== undefined ? { storyInputStrengthClip: loraSnapshot.strengthClip } : {}),
  };
}

function createResourcePlan(
  input: StoryInput,
  resourceCandidates?: StoryGraphStartSettingsSnapshot["resourceCandidates"],
): StoryResourcePlan {
  const candidates = getStartResourceCandidates(input, resourceCandidates);
  const stylePalette = getInputStylePalette(input);
  const enabledStyleLoras = stylePalette?.loras.filter((lora) => lora.enabled) ?? [];
  const enabledStyleLoraById = new Map(enabledStyleLoras.map((lora) => [lora.id, lora]));
  const candidateLoras = stylePalette?.checkpointId
    ? candidates.loras.map((resource) => {
        const loraSnapshot = enabledStyleLoraById.get(resource.id);
        return loraSnapshot ? applyStyleLoraWeights(resource, loraSnapshot) : resource;
      })
    : candidates.loras;
  const checkpoint = stylePalette?.checkpointId
    ? findStartResourceById(candidates.checkpoints, stylePalette.checkpointId)
    : candidates.checkpoints[0];

  if (!checkpoint) {
    throw new Error(`Selected Story checkpoint "${stylePalette?.checkpointId ?? ""}" is not in the supplied local candidates.`);
  }

  const loras = stylePalette?.checkpointId
    ? enabledStyleLoras.map((loraSnapshot) => {
        const resource = findStartResourceById(candidates.loras, loraSnapshot.id);
        if (!resource) {
          throw new Error(`Selected Story LoRA "${loraSnapshot.id}" is not in the supplied local candidates.`);
        }

        if (!areStartResourcesCompatible(resource, checkpoint)) {
          throw new Error(`Selected Story LoRA "${resource.name}" is incompatible with checkpoint "${checkpoint.name}".`);
        }
        const weightedResource = applyStyleLoraWeights(resource, loraSnapshot);

        return {
          resource: weightedResource,
          suggestedWeight: getStyleLoraSuggestedWeight(loraSnapshot, weightedResource),
          reason: "Selected from Story input style resources.",
        };
      })
    : candidates.loras.slice(0, 2).map((resource) => ({
        resource,
        suggestedWeight: 0.6,
        reason: "Selected from the supplied local Story Graph settings snapshot.",
      }));

  return createStoryResourcePlan({
    storyId: input.storyId,
    candidates: {
      checkpoints: candidates.checkpoints.map((resource) => ({ resource })),
      loras: candidateLoras.map((resource) => ({ resource })),
    },
    recommendation: {
      checkpoint: {
        resource: checkpoint,
        reason: stylePalette?.checkpointId
          ? "Selected from Story input style resources."
          : candidates.usedFallback
          ? "Planning fallback keeps the story render preview inspectable until local resource selection is connected."
          : "Selected from the supplied local Story Graph settings snapshot.",
      },
      loras,
      recommendationReason: stylePalette?.checkpointId
        ? "Use the checkpoint and enabled LoRAs saved in the Story input style palette."
        : candidates.usedFallback
        ? "No local resource snapshot was supplied to /story, so a planning-only fallback candidate was validated."
        : "Use validated local candidates from the Story Graph settings snapshot.",
      overallEffect: stylePalette?.checkpointId
        ? "User-selected Story input style resources."
        : "Storyboard-ready visual continuity across planned shots.",
      warnings: candidates.usedFallback && !stylePalette?.checkpointId
        ? ["Resource plan is a planning fallback and must be replaced by real local resources before execution."]
        : [],
    },
  });
}

function createParameterPlan(input: StoryInput, resourcePlan: StoryResourcePlan, shots: readonly StoryShot[]): StoryParameterPlan {
  const stylePalette = getInputStylePalette(input);
  if (stylePalette?.parameters) {
    return createStoryParameterPlan({
      storyId: input.storyId,
      defaults: stylePalette.parameters,
      warnings: ["Using generation parameters saved in the Story input style palette."],
    });
  }

  return createStoryParameterPlan({
    storyId: input.storyId,
    defaults: createStoryDefaultGenerationParameters({ input, resourcePlan, shots }),
    warnings: ["Parameters are planning defaults and remain editable before execution starts."],
  });
}

function createConsistencyCheck({
  dependencyGraph,
  input,
  shots,
  timestamp,
}: {
  dependencyGraph: ShotDependencyGraph;
  input: StoryInput;
  shots: readonly StoryShot[];
  timestamp: string;
}): StoryConsistencyCheck {
  const dependencyIssues = validateShotDependencyGraph(dependencyGraph, shots);
  const issues: StoryConsistencyIssue[] = dependencyIssues.map((issue) => ({
    code: issue.nodeId ? `node-${issue.nodeId}` : "shot-dependency",
    message: issue.message,
    severity: "error",
    shotIds: issue.shotId ? [issue.shotId] : [],
  }));

  return {
    storyId: input.storyId,
    passed: issues.length === 0,
    checkedAt: timestamp,
    issues,
    warnings: shots.length !== (input.targetShotCount ?? shots.length)
      ? ["Planned shot count differs from the requested target."]
      : [],
  };
}

function createGenerationGate(
  renderPlan: StoryRenderPlan,
  referenceAssetPlan: StoryReferenceAssetPlan,
): StoryGenerationGatePreview {
  const assetFreezeGate = evaluateStoryReferenceAssetFreezeGate(referenceAssetPlan);
  const ready = assetFreezeGate.ready;

  return {
    storyId: renderPlan.storyId,
    ready,
    executionAvailable: ready,
    assetFreezeGate,
    blockingReason: ready
      ? "Confirm generation to start shot graph execution."
      : assetFreezeGate.blockingReferences[0]?.reason ?? "Resolve required Story reference assets before generation.",
    confirmationRequired: true,
    nsfwContext: renderPlan.nsfwContext,
    renderPlanShotCount: renderPlan.shots.length,
    previewEnabled: renderPlan.preview.options.enabled,
    requestPreview: renderPlan.shots.map((shot) =>
      createStoryGenerationRequestPreview(shot, renderPlan.img2imgDenoise, {
        eligibleSourceShotIds: getStoryRenderPlanEligibleSourceShotIds(renderPlan.shots, shot.shotId),
      })),
  };
}

export function createStoryPlanningArtifacts(
  input: StoryInput,
  timestamp = defaultTimestamp,
  resourceCandidates?: StoryGraphStartSettingsSnapshot["resourceCandidates"],
): StoryPlanningArtifacts {
  const bible = createBible(input);
  const outline = createOutline(input);
  const shots = createShots(input, outline);
  const safetyPlan = createSafetyPlan(input, shots);
  const dependencyGraph = createDependencyGraph(input, shots);
  const plotStateGraph = createPlotStateGraph(input, outline, shots);
  const characterContinuityGraph = createCharacterContinuityGraph(input, bible, shots);
  const entityCards = createEntityCards(input, bible, shots, characterContinuityGraph);
  const referenceAssetPlan = deriveStoryReferenceAssetPlan({
    entityCards,
    shots,
    storyId: input.storyId,
  });
  const resourcePlan = createResourcePlan(input, resourceCandidates);
  const parameterPlan = createParameterPlan(input, resourcePlan, shots);
  const renderPlan = assembleStoryRenderPlan({
    img2imgDenoise: getStoryInputImg2ImgDenoise(input),
    parameterPlan,
    referenceAssetPlan,
    resourcePlan,
    safetyPlan,
    shots,
  });
  const executionBatch = createStoryExecutionRequestBatch({
    mode: "final",
    renderPlan,
    resourcePlan,
  });
  const consistencyCheck = createConsistencyCheck({
    dependencyGraph,
    input,
    shots,
    timestamp,
  });
  const generationGate = createGenerationGate(renderPlan, referenceAssetPlan);

  return {
    input,
    bible,
    outline,
    shots,
    safetyPlan,
    dependencyGraph,
    plotStateGraph,
    characterContinuityGraph,
    entityCards,
    referenceAssetPlan,
    resourcePlan,
    parameterPlan,
    renderPlan,
    consistencyCheck,
    generationGate,
    execution: createStoryShotExecutionState({
      batch: executionBatch,
      now: () => timestamp,
    }),
    resultDisplay: {
      storyId: input.storyId,
      status: "pending",
      nsfwContext: renderPlan.nsfwContext,
      previewReferences: [],
      finalReferences: [],
    },
  };
}

export function createStoryGraphInputWorkflow(request: StoryGraphStartRequest): StoryGraphInputWorkflowStart {
  const now = request.now ?? defaultNow;
  const timestamp = now();
  const input = createStoryInputFromStartRequest({
    ...request,
    now: () => timestamp,
  });
  const workflow = createStoryWorkflowState({
    now: () => timestamp,
    storyId: input.storyId,
    workflowId: request.workflowId,
  });

  return {
    input,
    workflow: refreshStoryWorkflowReadiness({
      ...workflow,
      nodes: {
        ...workflow.nodes,
        "story-input": {
          nodeId: "story-input",
          result: input,
          source: "manual",
          status: "manual",
          updatedAt: timestamp,
        },
      },
      updatedAt: timestamp,
    }),
  };
}

const artifactNodeMap = {
  "story-input": "input",
  "story-bible": "bible",
  "story-outline": "outline",
  "storyboard-shots": "shots",
  "story-safety-plan": "safetyPlan",
  "shot-dependency-graph": "dependencyGraph",
  "plot-state-graph": "plotStateGraph",
  "character-continuity-graph": "characterContinuityGraph",
  "entity-cards": "entityCards",
  "reference-asset-plan": "referenceAssetPlan",
  "resource-plan": "resourcePlan",
  "parameter-plan": "parameterPlan",
  "story-render-plan": "renderPlan",
  "story-consistency-check": "consistencyCheck",
  "generation-gate": "generationGate",
  "shot-graph-execution": "execution",
  "story-result-display": "resultDisplay",
} as const satisfies Record<StoryWorkflowNodeId, keyof StoryPlanningArtifacts>;

export function startStoryGraphWorkflow(request: StoryGraphStartRequest): StoryWorkflowState {
  const { input, workflow } = createStoryGraphInputWorkflow(request);
  const timestamp = input.settingsSnapshot && typeof input.settingsSnapshot === "object" && "capturedAt" in input.settingsSnapshot
    ? String((input.settingsSnapshot as { capturedAt: string }).capturedAt)
    : defaultNow();
  const artifacts = createStoryPlanningArtifacts(
    input,
    timestamp,
    request.settingsSnapshot?.resourceCandidates,
  );
  const nodes = { ...workflow.nodes };

  for (const [nodeId, artifactKey] of Object.entries(artifactNodeMap) as Array<[StoryWorkflowNodeId, keyof StoryPlanningArtifacts]>) {
    nodes[nodeId] = {
      nodeId,
      result: artifacts[artifactKey],
      source: nodeId === "story-input" ? "manual" : "system",
      status: nodeId === "shot-graph-execution" || nodeId === "story-result-display"
        ? "blocked"
        : nodeId === "story-input"
          ? "manual"
          : "done",
      updatedAt: timestamp,
      error: nodeId === "shot-graph-execution"
        ? {
            code: "confirmation_required",
            message: "Confirm generation before starting Story Graph shot execution.",
          }
        : undefined,
    };
  }

  return refreshStoryWorkflowReadiness({
    ...workflow,
    nodes,
    updatedAt: timestamp,
    generationConfirmed: false,
  });
}
