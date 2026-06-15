import {
  assembleStoryRenderPlan,
  createStoryExecutionRequestBatch,
  createStoryParameterPlan,
  createStoryResourcePlan,
  type StoryGenerationParameters,
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

type StoryClock = () => string;

export type StoryGraphStartSettingsSnapshot = {
  capturedAt: string;
  nsfwEnabled: boolean;
  source: "story-form";
  targetShotCount?: number;
  audienceRating: StoryAudienceRating;
  planningMode: "deterministic-local";
  promptProfile?: PromptProfileId;
  resourceCandidates?: {
    checkpoints: StoryLocalResource[];
    loras: StoryLocalResource[];
  };
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
  blockingReason?: string;
  confirmationRequired: boolean;
  nsfwContext: StoryNsfwContext;
  renderPlanShotCount: number;
  previewEnabled: boolean;
  requestPreview: Array<{
    shotId: string;
    title: string;
    sourceShotIds: string[];
    positivePrompt: string;
    negativePrompt: string;
    parameters: StoryGenerationParameters;
  }>;
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
  return sentence.length > 64 ? `${sentence.slice(0, 61).trim()}...` : sentence;
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
  return {
    capturedAt: request.settingsSnapshot?.capturedAt ?? timestamp,
    source: "story-form",
    planningMode: "deterministic-local",
    resourceCandidates: request.settingsSnapshot?.resourceCandidates,
    ...request.settingsSnapshot,
    audienceRating,
    nsfwEnabled,
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
    continuityRules: [
      "Preserve the main character identity across all shots.",
      "Carry important props and environmental details forward when referenced.",
      "Use source-shot dependencies only as planning metadata until execution is implemented.",
    ],
  };
}

function getPlanningShotCount(input: StoryInput) {
  return input.targetShotCount ?? 3;
}

function createOutline(input: StoryInput): StoryOutline {
  const shotCount = getPlanningShotCount(input);

  return {
    storyId: input.storyId,
    beats: Array.from({ length: shotCount }, (_, index) => ({
      id: `beat-${index + 1}`,
      title: index === 0 ? "Opening image" : index === shotCount - 1 ? "Closing image" : `Story beat ${index + 1}`,
      summary: index === 0
        ? `Establish the story request: ${input.rawIntent}`
        : index === shotCount - 1
          ? "Resolve the visual moment while preserving continuity."
          : "Advance the action and keep visual continuity clear.",
      order: index + 1,
      characterIds: ["main-character"],
    })),
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
      promptIntent: `${input.rawIntent}, storyboard shot ${order} of ${shotCount}`,
      continuityNotes: [
        "Keep main character identity consistent.",
        order > 1 ? `Preserve visual anchors from shot ${order - 1}.` : "Establish reusable visual anchors.",
      ],
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

function getStartResourceCandidates(input: StoryInput) {
  const snapshot = input.settingsSnapshot as StoryGraphStartSettingsSnapshot | undefined;
  const checkpoints = snapshot?.resourceCandidates?.checkpoints ?? [];
  const loras = snapshot?.resourceCandidates?.loras ?? [];

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

function createResourcePlan(input: StoryInput): StoryResourcePlan {
  const candidates = getStartResourceCandidates(input);
  const checkpoint = candidates.checkpoints[0];

  return createStoryResourcePlan({
    storyId: input.storyId,
    candidates: {
      checkpoints: candidates.checkpoints.map((resource) => ({ resource })),
      loras: candidates.loras.map((resource) => ({ resource })),
    },
    recommendation: {
      checkpoint: {
        resource: checkpoint,
        reason: candidates.usedFallback
          ? "Planning fallback keeps the story render preview inspectable until local resource selection is connected."
          : "Selected from the supplied local Story Graph settings snapshot.",
      },
      loras: candidates.loras.slice(0, 2).map((resource) => ({
        resource,
        suggestedWeight: 0.6,
        reason: "Selected from the supplied local Story Graph settings snapshot.",
      })),
      recommendationReason: candidates.usedFallback
        ? "No local resource snapshot was supplied to /story, so a planning-only fallback candidate was validated."
        : "Use validated local candidates from the Story Graph settings snapshot.",
      overallEffect: "Storyboard-ready visual continuity across planned shots.",
      warnings: candidates.usedFallback
        ? ["Resource plan is a planning fallback and must be replaced by real local resources before execution."]
        : [],
    },
  });
}

function createParameterPlan(input: StoryInput): StoryParameterPlan {
  return createStoryParameterPlan({
    storyId: input.storyId,
    defaults: {
      width: 1024,
      height: 768,
      steps: 28,
      cfg: 5.5,
      samplerName: "dpmpp_2m",
      scheduler: "karras",
      denoise: 1,
    },
    warnings: ["Parameters are planning defaults and remain editable before execution is implemented."],
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

function createGenerationGate(renderPlan: StoryRenderPlan): StoryGenerationGatePreview {
  return {
    storyId: renderPlan.storyId,
    ready: true,
    executionAvailable: true,
    blockingReason: "Confirm generation to start shot graph execution.",
    confirmationRequired: true,
    nsfwContext: renderPlan.nsfwContext,
    renderPlanShotCount: renderPlan.shots.length,
    previewEnabled: renderPlan.preview.options.enabled,
    requestPreview: renderPlan.shots.map((shot) => ({
      shotId: shot.shotId,
      title: shot.title,
      sourceShotIds: [...shot.sourceShotIds],
      positivePrompt: shot.positivePrompt,
      negativePrompt: shot.negativePrompt,
      parameters: { ...shot.parameters },
    })),
  };
}

export function createStoryPlanningArtifacts(input: StoryInput, timestamp = defaultTimestamp): StoryPlanningArtifacts {
  const bible = createBible(input);
  const outline = createOutline(input);
  const shots = createShots(input, outline);
  const safetyPlan = createSafetyPlan(input, shots);
  const dependencyGraph = createDependencyGraph(input, shots);
  const plotStateGraph = createPlotStateGraph(input, outline, shots);
  const characterContinuityGraph = createCharacterContinuityGraph(input, bible, shots);
  const resourcePlan = createResourcePlan(input);
  const parameterPlan = createParameterPlan(input);
  const renderPlan = assembleStoryRenderPlan({
    parameterPlan,
    resourcePlan,
    safetyPlan,
    shots,
  });
  const executionBatch = createStoryExecutionRequestBatch({
    mode: "final",
    renderPlan,
  });
  const consistencyCheck = createConsistencyCheck({
    dependencyGraph,
    input,
    shots,
    timestamp,
  });
  const generationGate = createGenerationGate(renderPlan);

  return {
    input,
    bible,
    outline,
    shots,
    safetyPlan,
    dependencyGraph,
    plotStateGraph,
    characterContinuityGraph,
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
  const artifacts = createStoryPlanningArtifacts(input, timestamp);
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
