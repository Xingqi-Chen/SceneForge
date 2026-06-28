import { isLlmChatResponse, LiteLlmError, type LlmChatRequest, type LlmChatResponse } from "@/features/llm";
import { formatSelectedCivitaiResourcesForAi } from "@/features/editor/ai-prompt/civitai-ai-context";

import {
  assembleStoryRenderPlan,
  createStoryDefaultGenerationParameters,
  createStoryGenerationRequestPreview,
  createStoryParameterPlan,
  createStoryResourcePlan,
  getStoryInputImg2ImgDenoise,
  getSelectedStoryResourcesForPrompting,
  normalizeStoryAnimaPromptParts,
  type StoryAnimaPromptParts,
  type StoryGenerationParameters,
  type StoryLocalResource,
  type StoryParameterPlan,
  type StoryRenderPromptPlan,
  type StoryRenderPlan,
  type StoryResourcePlan,
} from "./story-planning";
import {
  addStorySourceImageRiskToEdge,
  shouldExecuteStorySourceImageEdge,
} from "./story-source-image-risk";
import { createTimelineNodeError } from "./state";
import type { StoryWorkflowState } from "./story-state";
import { validateShotDependencyGraph } from "./story-workflow";
import {
  TimelineNodeExecutionError,
  type TimelineNodeSource,
} from "./types";
import {
  normalizeTimelineSamplerOptions,
  type TimelineSamplerOptions,
} from "./timeline-sampler-options";
import type {
  CharacterContinuityGraph,
  PlotStateGraph,
  ShotDependencyGraph,
  ShotDependencyGraphEdge,
  StoryAudienceRating,
  StoryBible,
  StoryBibleCharacter,
  StoryBibleLocation,
  StoryConsistencyCheck,
  StoryConsistencyIssue,
  StoryInput,
  StoryOutline,
  StorySafetyPlan,
  StoryShot,
  StoryShotId,
  StoryWorkflowNodeId,
} from "./story-types";
import type {
  CommonWorkflowNodeAdapter,
  CommonWorkflowNodeExecutionContext,
} from "./workflow-definition";

export type StoryCompleteChat = (request: LlmChatRequest) => Promise<LlmChatResponse>;

export type StoryNodeExecutionContext = CommonWorkflowNodeExecutionContext<
  StoryWorkflowNodeId,
  StoryWorkflowState
>;

export type StoryNodeAdapter<T = unknown> = CommonWorkflowNodeAdapter<
  StoryWorkflowNodeId,
  StoryWorkflowState,
  T
>;

export type StoryNodeAdapters = Partial<Record<StoryWorkflowNodeId, StoryNodeAdapter>>;

export type StoryLlmNodeAdapterOptions = {
  completeChat: StoryCompleteChat;
  now?: () => string;
  resourceCandidates?: {
    checkpoints: StoryLocalResource[];
    loras: StoryLocalResource[];
  };
  samplerOptions?: TimelineSamplerOptions;
};

const maxCharacters = 12;
const maxLocations = 12;
const maxWarnings = 12;
const fallbackParameters = {
  width: 1024,
  height: 768,
  steps: 28,
  cfg: 5.5,
  samplerName: "dpmpp_2m",
  scheduler: "karras",
  denoise: 1,
} satisfies StoryGenerationParameters;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compactText(value: unknown, maxLength = 1200) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeStringList(value: unknown, maxItems = 8) {
  if (!Array.isArray(value)) {
    const single = compactText(value, 400);
    return single ? [single] : [];
  }

  return value.map((item) => compactText(item, 400)).filter(Boolean).slice(0, maxItems);
}

function parseJsonObjectFromText(text: string): unknown {
  const trimmed = text.trim();
  const candidates = [
    trimmed,
    ...Array.from(trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi), (match) => match[1]?.trim() ?? ""),
  ];
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  const firstBracket = trimmed.indexOf("[");
  const lastBracket = trimmed.lastIndexOf("]");

  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  if (firstBracket >= 0 && lastBracket > firstBracket) {
    candidates.push(trimmed.slice(firstBracket, lastBracket + 1));
  }

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // Try the next likely JSON span.
    }
  }

  throw malformedResponse("LLM response must be valid JSON.", { content: text });
}

function malformedResponse(message: string, details?: unknown): TimelineNodeExecutionError {
  return new TimelineNodeExecutionError(createTimelineNodeError("llm_malformed_response", message, details));
}

function invalidStoryInput(message: string, details?: unknown): TimelineNodeExecutionError {
  return new TimelineNodeExecutionError(createTimelineNodeError("timeline_node_failed", message, details));
}

function invalidResourceSelection(message: string, details?: unknown): never {
  throw new TimelineNodeExecutionError(createTimelineNodeError("resource_selection_invalid", message, details));
}

function mapLiteLlmError(error: LiteLlmError) {
  const isConfigError =
    error.message.includes("LITELLM") ||
    error.message.includes("model is required") ||
    error.statusCode === 400;

  return createTimelineNodeError(isConfigError ? "llm_config" : "llm_upstream", error.message, {
    statusCode: error.statusCode,
    details: error.details,
  });
}

function normalizeLlmAdapterError(error: unknown) {
  if (error instanceof TimelineNodeExecutionError) {
    return createTimelineNodeError(error.code, error.message, error.details);
  }

  if (error instanceof LiteLlmError) {
    return mapLiteLlmError(error);
  }

  if (error instanceof Error) {
    return createTimelineNodeError("llm_upstream", error.message, {
      name: error.name,
    });
  }

  return createTimelineNodeError("llm_upstream", "Story LLM adapter failed.", {
    error,
  });
}

function getNodeResult<T>(workflow: StoryWorkflowState, nodeId: StoryWorkflowNodeId): T {
  const result = workflow.nodes[nodeId].result;
  if (result === undefined) {
    throw invalidStoryInput(`Story dependency "${nodeId}" has not produced a result.`);
  }

  return result as T;
}

function getStoryInput(workflow: StoryWorkflowState) {
  const input = getNodeResult<StoryInput>(workflow, "story-input");
  if (!input.rawIntent || !input.storyId) {
    throw invalidStoryInput("Story input is missing rawIntent or storyId.", { input });
  }

  return input;
}

function getBible(workflow: StoryWorkflowState) {
  return getNodeResult<StoryBible>(workflow, "story-bible");
}

function getOutline(workflow: StoryWorkflowState) {
  return getNodeResult<StoryOutline>(workflow, "story-outline");
}

function getShots(workflow: StoryWorkflowState) {
  const shots = getNodeResult<StoryShot[]>(workflow, "storyboard-shots");
  if (!Array.isArray(shots) || shots.length === 0) {
    throw invalidStoryInput("Storyboard shots must be a non-empty array.", { shots });
  }

  return shots;
}

function getSafetyPlan(workflow: StoryWorkflowState) {
  return getNodeResult<StorySafetyPlan>(workflow, "story-safety-plan");
}

function getDependencyGraph(workflow: StoryWorkflowState) {
  return getNodeResult<ShotDependencyGraph>(workflow, "shot-dependency-graph");
}

function getResourcePlan(workflow: StoryWorkflowState) {
  return getNodeResult<StoryResourcePlan>(workflow, "resource-plan");
}

function getParameterPlan(workflow: StoryWorkflowState) {
  return getNodeResult<StoryParameterPlan>(workflow, "parameter-plan");
}

function getContinuityGraph(workflow: StoryWorkflowState) {
  return getNodeResult<CharacterContinuityGraph>(workflow, "character-continuity-graph");
}

function getExistingRenderPlan(workflow: StoryWorkflowState) {
  const node = workflow.nodes["story-render-plan"];
  if (node.result === undefined || (node.status !== "done" && node.status !== "manual")) {
    return null;
  }

  return node.result as StoryRenderPlan;
}

export function getStoryRenderPlanFromWorkflow(workflow: StoryWorkflowState, samplerOptions?: TimelineSamplerOptions) {
  return getExistingRenderPlan(workflow) ?? createStoryRenderPlanFromWorkflow(workflow, samplerOptions);
}

function shouldAllowHighRiskSourceEdges(workflow: StoryWorkflowState) {
  const dependencyNode = workflow.nodes["shot-dependency-graph"];
  return dependencyNode.source === "manual" || dependencyNode.status === "manual";
}

function getRequestedTargetShotCount(input: StoryInput) {
  const parsed = Number(input.targetShotCount);
  if (Number.isFinite(parsed)) {
    return Math.min(24, Math.max(1, Math.round(parsed)));
  }

  return undefined;
}

function getShotCountMode(input: StoryInput) {
  if (input.targetShotCount !== undefined) {
    return "user-requested";
  }

  return input.storySegments && input.storySegments.length > 0
    ? "provided-story-segments"
    : "llm-decides";
}

function getAudienceRating(input: StoryInput): StoryAudienceRating {
  return input.nsfwContext?.audienceRating ?? input.audienceRating ?? "safe";
}

function normalizeId(value: unknown, fallback: string) {
  const text = compactText(value, 80)
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return text || fallback;
}

function normalizeCharacter(value: unknown, index: number): StoryBibleCharacter {
  const raw = isRecord(value) ? value : {};
  const id = normalizeId(raw.id ?? raw.name, `character-${index + 1}`);
  const name = compactText(raw.name, 80) || `Character ${index + 1}`;

  return {
    id,
    name,
    role: compactText(raw.role, 120) || "Supporting story character",
    description: compactText(raw.description ?? raw.summary, 800) || name,
    continuityNotes: normalizeStringList(raw.continuityNotes ?? raw.continuity_notes, 8),
    visualAnchors: normalizeStringList(raw.visualAnchors ?? raw.visual_anchors, 8),
  };
}

function normalizeLocation(value: unknown, index: number): StoryBibleLocation {
  const raw = isRecord(value) ? value : {};
  const id = normalizeId(raw.id ?? raw.name, `location-${index + 1}`);
  const name = compactText(raw.name, 80) || `Location ${index + 1}`;

  return {
    id,
    name,
    description: compactText(raw.description ?? raw.summary, 800) || name,
    visualAnchors: normalizeStringList(raw.visualAnchors ?? raw.visual_anchors, 8),
  };
}

export function normalizeStoryBible(raw: unknown, input: StoryInput): StoryBible {
  const parsed = typeof raw === "string" ? parseJsonObjectFromText(raw) : raw;
  if (!isRecord(parsed)) {
    throw malformedResponse("Story bible response must be a JSON object.", { raw });
  }

  const characters = (Array.isArray(parsed.characters) ? parsed.characters : [])
    .map(normalizeCharacter)
    .slice(0, maxCharacters);
  const locations = (Array.isArray(parsed.locations) ? parsed.locations : [])
    .map(normalizeLocation)
    .slice(0, maxLocations);

  return {
    storyId: compactText(parsed.storyId, 120) || input.storyId,
    title: compactText(parsed.title, 120) || compactText(input.rawIntent, 80) || "Story Graph",
    logline: compactText(parsed.logline ?? parsed.summary, 800) || input.rawIntent,
    genre: normalizeStringList(parsed.genre, 6),
    themes: normalizeStringList(parsed.themes, 8),
    worldSummary: compactText(parsed.worldSummary ?? parsed.world_summary, 1200) || input.rawIntent,
    visualStyle: compactText(parsed.visualStyle ?? parsed.visual_style, 800) || "Cinematic storyboard continuity.",
    characters: characters.length > 0
      ? characters
      : [normalizeCharacter({ id: "main-character", name: "Main character", description: input.rawIntent }, 0)],
    locations: locations.length > 0
      ? locations
      : [normalizeLocation({ id: "primary-location", name: "Primary location", description: input.rawIntent }, 0)],
    continuityRules: normalizeStringList(parsed.continuityRules ?? parsed.continuity_rules, 12),
  };
}

export function normalizeStoryOutline(raw: unknown, input: StoryInput, bible: StoryBible): StoryOutline {
  const parsed = typeof raw === "string" ? parseJsonObjectFromText(raw) : raw;
  const beatsRaw = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.beats)
      ? parsed.beats
      : null;

  if (!beatsRaw) {
    throw malformedResponse("Story outline response must include a beats array.", { raw });
  }

  const characterIds = new Set(bible.characters.map((character) => character.id));
  const fallbackCharacterId = bible.characters[0]?.id;
  let beats = beatsRaw.map((beat, index) => {
    const rawBeat = isRecord(beat) ? beat : {};
    const beatCharacterIds = normalizeStringList(rawBeat.characterIds ?? rawBeat.character_ids, 12)
      .filter((characterId) => characterIds.has(characterId));

    return {
      id: compactText(rawBeat.id, 80) || `beat-${index + 1}`,
      title: compactText(rawBeat.title, 120) || `Beat ${index + 1}`,
      summary: compactText(rawBeat.summary ?? rawBeat.description, 800) || input.rawIntent,
      order: Number.isFinite(Number(rawBeat.order)) ? Number(rawBeat.order) : index + 1,
      characterIds: beatCharacterIds.length > 0
        ? beatCharacterIds
        : fallbackCharacterId ? [fallbackCharacterId] : [],
    };
  });

  if (input.targetShotCount === undefined && input.storySegments && input.storySegments.length > 0) {
    beats = input.storySegments.map((segment, index) => {
      const beat = beats.find((candidate) => candidate.id === segment.id) ?? beats[index];
      return {
        id: segment.id,
        title: segment.title,
        summary: compactText(beat?.summary, 800) || segment.sourceText,
        order: index + 1,
        characterIds: beat?.characterIds.length
          ? beat.characterIds
          : fallbackCharacterId ? [fallbackCharacterId] : [],
      };
    });
  }

  if (beats.length === 0) {
    throw malformedResponse("Story outline must include at least one beat.", { raw });
  }

  return {
    storyId: input.storyId,
    beats,
  };
}

export function normalizeStoryShots(
  raw: unknown,
  input: StoryInput,
  bible: StoryBible,
  outline: StoryOutline,
): StoryShot[] {
  const parsed = typeof raw === "string" ? parseJsonObjectFromText(raw) : raw;
  const shotsRaw = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.shots)
      ? parsed.shots
      : null;

  if (!shotsRaw) {
    throw malformedResponse("Storyboard response must include a shots array.", { raw });
  }

  const characterIds = new Set(bible.characters.map((character) => character.id));
  const locationIds = new Set(bible.locations.map((location) => location.id));
  const beatIds = new Set(outline.beats.map((beat) => beat.id));
  const fallbackCharacterId = bible.characters[0]?.id;
  const fallbackLocationId = bible.locations[0]?.id;
  const ids = new Set<string>();
  const shots = shotsRaw.map((shot, index) => {
    const rawShot = isRecord(shot) ? shot : {};
    const order = Number.isFinite(Number(rawShot.order)) ? Math.max(1, Math.round(Number(rawShot.order))) : index + 1;
    const fallbackBeat = outline.beats.find((beat) => beat.order === order) ?? outline.beats[index];
    const fallbackId = `shot-${order}`;
    let id = normalizeId(rawShot.id, fallbackId);
    if (ids.has(id)) {
      id = `${id}-${index + 1}`;
    }
    ids.add(id);

    const beatId = compactText(rawShot.beatId ?? rawShot.beat_id, 80);
    const locationId = compactText(rawShot.locationId ?? rawShot.location_id, 80);
    const shotCharacterIds = normalizeStringList(rawShot.characterIds ?? rawShot.character_ids, 16)
      .filter((characterId) => characterIds.has(characterId));

    return {
      id,
      storyId: input.storyId,
      order,
      title: compactText(rawShot.title, 120) || `Shot ${order}`,
      description: compactText(rawShot.description ?? rawShot.summary, 1000) || input.rawIntent,
      ...(beatId && beatIds.has(beatId)
        ? { beatId }
        : fallbackBeat ? { beatId: fallbackBeat.id } : {}),
      ...(locationId && locationIds.has(locationId)
        ? { locationId }
        : fallbackLocationId ? { locationId: fallbackLocationId } : {}),
      characterIds: shotCharacterIds.length > 0
        ? shotCharacterIds
        : fallbackBeat?.characterIds.length
          ? [...fallbackBeat.characterIds]
          : fallbackCharacterId ? [fallbackCharacterId] : [],
      sourceShotIds: normalizeStringList(rawShot.sourceShotIds ?? rawShot.source_shot_ids, 12),
      camera: compactText(rawShot.camera, 400) || "Storyboard frame",
      promptIntent: compactText(rawShot.promptIntent ?? rawShot.prompt_intent ?? rawShot.prompt, 1200) || input.rawIntent,
      continuityNotes: normalizeStringList(rawShot.continuityNotes ?? rawShot.continuity_notes, 12),
    };
  });

  if (shots.length === 0) {
    throw malformedResponse("Storyboard response must include at least one shot.", { raw });
  }

  const shotIds = new Set(shots.map((shot) => shot.id));
  const maxShotCount = getRequestedTargetShotCount(input) ?? outline.beats.length;

  return shots
    .sort((left, right) => left.order - right.order)
    .slice(0, maxShotCount)
    .map((shot, index) => ({
      ...shot,
      order: index + 1,
      sourceShotIds: shot.sourceShotIds.filter((sourceShotId) => sourceShotId !== shot.id && shotIds.has(sourceShotId)),
    }));
}

export function normalizeStorySafetyPlan(raw: unknown, input: StoryInput, shots: readonly StoryShot[]): StorySafetyPlan {
  const parsed = typeof raw === "string" ? parseJsonObjectFromText(raw) : raw;
  if (!isRecord(parsed)) {
    throw malformedResponse("Story safety response must be a JSON object.", { raw });
  }

  const shotIds = new Set(shots.map((shot) => shot.id));
  const audienceRating = compactText(parsed.audienceRating ?? parsed.audience_rating, 40) as StoryAudienceRating;
  const resolvedRating: StoryAudienceRating = ["safe", "suggestive", "mature", "explicit"].includes(audienceRating)
    ? audienceRating
    : getAudienceRating(input);
  const perShotNotes = (Array.isArray(parsed.perShotNotes) ? parsed.perShotNotes : parsed.per_shot_notes)
    ?? [];

  return {
    storyId: input.storyId,
    audienceRating: resolvedRating,
    contentWarnings: normalizeStringList(parsed.contentWarnings ?? parsed.content_warnings, 12),
    blockedContent: normalizeStringList(parsed.blockedContent ?? parsed.blocked_content, 12),
    perShotNotes: (Array.isArray(perShotNotes) ? perShotNotes : [])
      .map((note) => {
        const rawNote = isRecord(note) ? note : {};
        const shotId = compactText(rawNote.shotId ?? rawNote.shot_id, 80);
        return {
          shotId,
          risks: normalizeStringList(rawNote.risks, 8),
          mitigations: normalizeStringList(rawNote.mitigations, 8),
        };
      })
      .filter((note) => shotIds.has(note.shotId)),
    nsfwContext: {
      enabled: input.nsfwContext?.enabled ?? resolvedRating === "explicit",
      rationale: compactText(
        isRecord(parsed.nsfwContext) ? parsed.nsfwContext.rationale : parsed.nsfw_rationale,
        500,
      ) || input.nsfwContext?.rationale || "",
    },
  };
}

function normalizeDependencyReason(value: unknown): ShotDependencyGraphEdge["reason"] {
  const reason = compactText(value, 40);
  return reason === "img2img-source" ||
    reason === "reference" ||
    reason === "continuity" ||
    reason === "story-order" ||
    reason === "manual"
    ? reason
    : "continuity";
}

export function normalizeShotDependencyGraph(raw: unknown, input: StoryInput, shots: readonly StoryShot[]): ShotDependencyGraph {
  const parsed = typeof raw === "string" ? parseJsonObjectFromText(raw) : raw;
  if (!isRecord(parsed)) {
    throw malformedResponse("Shot dependency response must be a JSON object.", { raw });
  }

  const nodes = (Array.isArray(parsed.nodes) ? parsed.nodes : shots)
    .map((node) => {
      const rawNode = isRecord(node) ? node : {};
      const shotId = compactText(rawNode.shotId ?? rawNode.shot_id ?? rawNode.id, 80);
      return {
        shotId,
        label: compactText(rawNode.label ?? rawNode.title, 120) || shots.find((shot) => shot.id === shotId)?.title,
      };
    })
    .filter((node) => node.shotId);
  const edges = (Array.isArray(parsed.edges) ? parsed.edges : [])
    .map((edge) => {
      const rawEdge = isRecord(edge) ? edge : {};
      const normalizedEdge = {
        fromShotId: compactText(rawEdge.fromShotId ?? rawEdge.from_shot_id ?? rawEdge.from, 80),
        toShotId: compactText(rawEdge.toShotId ?? rawEdge.to_shot_id ?? rawEdge.to, 80),
        reason: normalizeDependencyReason(rawEdge.reason),
      };
      return addStorySourceImageRiskToEdge(normalizedEdge, shots);
    })
    .filter((edge) => edge.fromShotId && edge.toShotId);

  for (const shot of shots) {
    if (!nodes.some((node) => node.shotId === shot.id)) {
      nodes.push({ shotId: shot.id, label: shot.title });
    }
  }

  const graph = {
    storyId: input.storyId,
    nodes,
    edges,
  };
  const issues = validateShotDependencyGraph(graph, shots);
  if (issues.length > 0) {
    throw invalidStoryInput("Shot dependency graph is invalid.", { issues });
  }

  return graph;
}

export function syncStoryShotsWithDependencyGraph(
  shots: readonly StoryShot[],
  graph: ShotDependencyGraph,
  options: { allowHighRiskSourceEdges?: boolean } = {},
): StoryShot[] {
  const dependenciesByShot = new Map<StoryShotId, StoryShotId[]>();
  for (const edge of graph.edges) {
    if (!shouldExecuteStorySourceImageEdge(edge, shots, options)) {
      continue;
    }
    dependenciesByShot.set(edge.toShotId, [...(dependenciesByShot.get(edge.toShotId) ?? []), edge.fromShotId]);
  }

  return shots.map((shot) => ({
    ...shot,
    sourceShotIds: [...new Set(dependenciesByShot.get(shot.id) ?? [])],
  }));
}

export function normalizePlotStateGraph(raw: unknown, input: StoryInput, shots: readonly StoryShot[]): PlotStateGraph {
  const parsed = typeof raw === "string" ? parseJsonObjectFromText(raw) : raw;
  if (!isRecord(parsed)) {
    throw malformedResponse("Plot state graph response must be a JSON object.", { raw });
  }

  const shotIds = new Set(shots.map((shot) => shot.id));
  const statesRaw = Array.isArray(parsed.states) ? parsed.states : [];
  const states = statesRaw.map((state, index) => {
    const rawState = isRecord(state) ? state : {};
    return {
      id: compactText(rawState.id, 80) || `state-${index + 1}`,
      title: compactText(rawState.title, 120) || `State ${index + 1}`,
      summary: compactText(rawState.summary ?? rawState.description, 800) || input.rawIntent,
      shotIds: normalizeStringList(rawState.shotIds ?? rawState.shot_ids, 16).filter((shotId) => shotIds.has(shotId)),
    };
  });
  const stateIds = new Set(states.map((state) => state.id));

  return {
    storyId: input.storyId,
    states,
    transitions: (Array.isArray(parsed.transitions) ? parsed.transitions : [])
      .map((transition) => {
        const rawTransition = isRecord(transition) ? transition : {};
        return {
          fromStateId: compactText(rawTransition.fromStateId ?? rawTransition.from_state_id ?? rawTransition.from, 80),
          toStateId: compactText(rawTransition.toStateId ?? rawTransition.to_state_id ?? rawTransition.to, 80),
          reason: compactText(rawTransition.reason, 300) || "Story progression.",
        };
      })
      .filter((transition) => stateIds.has(transition.fromStateId) && stateIds.has(transition.toStateId)),
  };
}

export function normalizeCharacterContinuityGraph(
  raw: unknown,
  input: StoryInput,
  bible: StoryBible,
  shots: readonly StoryShot[],
): CharacterContinuityGraph {
  const parsed = typeof raw === "string" ? parseJsonObjectFromText(raw) : raw;
  if (!isRecord(parsed)) {
    throw malformedResponse("Character continuity graph response must be a JSON object.", { raw });
  }

  const characterIds = new Set(bible.characters.map((character) => character.id));
  const shotIds = new Set(shots.map((shot) => shot.id));

  return {
    storyId: input.storyId,
    characters: bible.characters.map((character) => ({
      characterId: character.id,
      name: character.name,
      canonicalDescription: character.description,
      visualAnchors: [...character.visualAnchors],
    })),
    appearances: (Array.isArray(parsed.appearances) ? parsed.appearances : [])
      .map((appearance) => {
        const rawAppearance = isRecord(appearance) ? appearance : {};
        return {
          shotId: compactText(rawAppearance.shotId ?? rawAppearance.shot_id, 80),
          characterId: compactText(rawAppearance.characterId ?? rawAppearance.character_id, 80),
          wardrobe: normalizeStringList(rawAppearance.wardrobe, 8),
          poseOrAction: compactText(rawAppearance.poseOrAction ?? rawAppearance.pose_or_action, 400),
          expression: compactText(rawAppearance.expression, 200),
          continuityNotes: normalizeStringList(rawAppearance.continuityNotes ?? rawAppearance.continuity_notes, 8),
        };
      })
      .filter((appearance) => shotIds.has(appearance.shotId) && characterIds.has(appearance.characterId)),
  };
}

function getSettingsResourceCandidates(
  input: StoryInput,
  resourceCandidates?: StoryLlmNodeAdapterOptions["resourceCandidates"],
) {
  const snapshot = isRecord(input.settingsSnapshot) ? input.settingsSnapshot : {};
  const legacyResourceCandidates = isRecord(snapshot.resourceCandidates) ? snapshot.resourceCandidates : {};
  const checkpoints = resourceCandidates?.checkpoints ??
    (Array.isArray(legacyResourceCandidates.checkpoints) ? legacyResourceCandidates.checkpoints : []);
  const loras = resourceCandidates?.loras ??
    (Array.isArray(legacyResourceCandidates.loras) ? legacyResourceCandidates.loras : []);

  return {
    checkpoints: checkpoints.filter(isRecord).map((resource) => resource as StoryLocalResource),
    loras: loras.filter(isRecord).map((resource) => resource as StoryLocalResource),
  };
}

function resolveCandidateByIdOrName(
  value: unknown,
  candidates: StoryLocalResource[],
): StoryLocalResource | null {
  const raw = isRecord(value) ? value : {};
  const aliases = [
    raw.id,
    raw.name,
    raw.modelFileName,
    value,
  ].map((item) => compactText(item, 200).toLocaleLowerCase()).filter(Boolean);

  return candidates.find((candidate) =>
    [candidate.id, candidate.name, candidate.modelFileName]
      .map((item) => compactText(item, 200).toLocaleLowerCase())
      .some((alias) => aliases.includes(alias)),
  ) ?? null;
}

export function normalizeStoryResourcePlan(
  raw: unknown,
  input: StoryInput,
  resourceCandidates?: StoryLlmNodeAdapterOptions["resourceCandidates"],
): StoryResourcePlan {
  const candidates = getSettingsResourceCandidates(input, resourceCandidates);
  if (candidates.checkpoints.length === 0) {
    invalidResourceSelection("Story Graph needs at least one real local checkpoint candidate before generation can run.");
  }

  const parsed = typeof raw === "string" ? parseJsonObjectFromText(raw) : raw;
  if (!isRecord(parsed)) {
    throw malformedResponse("Resource plan response must be a JSON object.", { raw });
  }

  const checkpointRaw = isRecord(parsed.checkpoint) && "resource" in parsed.checkpoint
    ? parsed.checkpoint.resource
    : parsed.checkpoint;
  const selectedCheckpoint = resolveCandidateByIdOrName(checkpointRaw, candidates.checkpoints);
  if (!selectedCheckpoint) {
    invalidResourceSelection("Recommended checkpoint is not in the supplied Story Graph candidate set.", {
      checkpoint: checkpointRaw,
    });
  }

  const selectedLoras = (Array.isArray(parsed.loras) ? parsed.loras : [])
    .map((lora) => {
      const rawLora = isRecord(lora) && "resource" in lora ? lora.resource : lora;
      const candidate = resolveCandidateByIdOrName(rawLora, candidates.loras);
      if (!candidate) {
        invalidResourceSelection("Recommended LoRA is not in the supplied Story Graph candidate set.", {
          lora: rawLora,
        });
      }

      return {
        resource: candidate,
        suggestedWeight: Number.isFinite(Number(isRecord(lora) ? lora.suggestedWeight : undefined))
          ? Number((lora as { suggestedWeight?: unknown }).suggestedWeight)
          : null,
        reason: compactText(isRecord(lora) ? lora.reason : undefined, 300) || "Selected from local Story Graph candidates.",
      };
    })
    .slice(0, 3);

  return createStoryResourcePlan({
    storyId: input.storyId,
    candidates: {
      checkpoints: candidates.checkpoints.map((resource) => ({ resource })),
      loras: candidates.loras.map((resource) => ({ resource })),
    },
    recommendation: {
      checkpoint: {
        resource: selectedCheckpoint,
        reason: compactText(isRecord(parsed.checkpoint) ? parsed.checkpoint.reason : undefined, 300) ||
          "Selected from local Story Graph candidates.",
      },
      loras: selectedLoras,
      recommendationReason: compactText(parsed.recommendationReason ?? parsed.recommendation_reason, 500) ||
        "Selected Story Graph resources from real local candidates.",
      overallEffect: compactText(parsed.overallEffect ?? parsed.overall_effect, 500) ||
        "Storyboard-ready continuity.",
      warnings: normalizeStringList(parsed.warnings, maxWarnings),
    },
  });
}

export function normalizeStoryParameterPlan(
  raw: unknown,
  input: StoryInput,
  shots: readonly StoryShot[],
  samplerOptions?: TimelineSamplerOptions,
  fallbackDefaults: StoryGenerationParameters = fallbackParameters,
): StoryParameterPlan {
  const parsed = typeof raw === "string" ? parseJsonObjectFromText(raw) : raw;
  if (!isRecord(parsed)) {
    throw malformedResponse("Parameter plan response must be a JSON object.", { raw });
  }

  const defaultsRaw = isRecord(parsed.defaults) ? parsed.defaults : parsed;
  const rawWidth = Number(defaultsRaw.width);
  const rawHeight = Number(defaultsRaw.height);
  const legacyFixedDimensions =
    rawWidth === 1024 &&
    rawHeight === 768 &&
    (fallbackDefaults.width !== 1024 || fallbackDefaults.height !== 768);
  const shotIds = new Set(shots.map((shot) => shot.id));
  const perShotOverridesRaw = Array.isArray(parsed.perShotOverrides)
    ? parsed.perShotOverrides
    : Array.isArray(parsed.per_shot_overrides)
      ? parsed.per_shot_overrides
      : [];

  return createStoryParameterPlan({
    storyId: input.storyId,
    defaults: {
      width: legacyFixedDimensions ? fallbackDefaults.width : rawWidth || fallbackDefaults.width,
      height: legacyFixedDimensions ? fallbackDefaults.height : rawHeight || fallbackDefaults.height,
      steps: Number(defaultsRaw.steps) || fallbackDefaults.steps,
      cfg: Number(defaultsRaw.cfg) || fallbackDefaults.cfg,
      samplerName: compactText(defaultsRaw.samplerName ?? defaultsRaw.sampler_name, 80) ||
        fallbackDefaults.samplerName,
      scheduler: compactText(defaultsRaw.scheduler, 80) || fallbackDefaults.scheduler,
      denoise: Number(defaultsRaw.denoise ?? fallbackDefaults.denoise),
      ...(Number.isSafeInteger(Number(defaultsRaw.seed)) ? { seed: Number(defaultsRaw.seed) } : {}),
    },
    perShotOverrides: perShotOverridesRaw
      .filter(isRecord)
      .map((override) => ({
        shotId: compactText(override.shotId ?? override.shot_id, 80),
        parameters: isRecord(override.parameters) ? override.parameters as Partial<StoryGenerationParameters> : {},
        reason: compactText(override.reason, 300),
      }))
      .filter((override) => shotIds.has(override.shotId)),
    warnings: normalizeStringList(parsed.warnings, maxWarnings),
    samplerOptions,
  });
}

function hasStoryAnimaPromptPartsContent(parts: StoryAnimaPromptParts) {
  return Boolean(
    parts.singleFrameCaption ||
    parts.subjectTags.length > 0 ||
    parts.characterTags.length > 0 ||
    parts.seriesTags.length > 0 ||
    parts.artistTags.length > 0 ||
    parts.outfitTags.length > 0 ||
    parts.propTags.length > 0 ||
    parts.actionTags.length > 0 ||
    parts.settingTags.length > 0 ||
    parts.cameraTags.length > 0 ||
    parts.lightingTags.length > 0 ||
    parts.styleTags.length > 0,
  );
}

function createFallbackStoryRenderPromptParts(shot: StoryShot) {
  return normalizeStoryAnimaPromptParts({
    subjectTags: [],
    characterTags: shot.characterIds,
    actionTags: [shot.promptIntent],
    settingTags: shot.continuityNotes,
    cameraTags: [shot.camera],
    singleFrameCaption: shot.description,
    negativeAdditions: [],
  });
}

export function normalizeStoryRenderPromptPlan(
  raw: unknown,
  input: StoryInput,
  shots: readonly StoryShot[],
): StoryRenderPromptPlan {
  const parsed = typeof raw === "string" ? parseJsonObjectFromText(raw) : raw;
  if (!isRecord(parsed)) {
    throw malformedResponse("Render prompt plan response must be a JSON object.", { raw });
  }

  const shotIds = new Set(shots.map((shot) => shot.id));
  const rawShots = Array.isArray(parsed.shots) ? parsed.shots : [];

  return {
    storyId: input.storyId,
    shots: rawShots
      .map((shot, index) => {
        const rawShot = isRecord(shot) ? shot : {};
        const shotId = compactText(rawShot.shotId ?? rawShot.shot_id ?? rawShot.id, 80) || shots[index]?.id || "";
        const sourceShot = shots.find((candidate) => candidate.id === shotId) ?? shots[index];
        const rawAnimaPromptParts = rawShot.animaPromptParts ?? rawShot.anima_prompt_parts;
        let animaPromptParts = normalizeStoryAnimaPromptParts(rawAnimaPromptParts);
        const warnings = normalizeStringList(rawShot.warnings, maxWarnings);

        if (sourceShot && !hasStoryAnimaPromptPartsContent(animaPromptParts)) {
          animaPromptParts = createFallbackStoryRenderPromptParts(sourceShot);
          warnings.push("LLM returned empty animaPromptParts; used storyboard prompt fallback.");
        }

        return {
          shotId,
          animaPromptParts,
          rationale: compactText(rawShot.rationale ?? rawShot.reason, 400) || undefined,
          warnings,
        };
      })
      .filter((shot) => shotIds.has(shot.shotId)),
    warnings: normalizeStringList(parsed.warnings, maxWarnings),
  };
}

export function isStoryResourcePlanExecutable(resourcePlan: StoryResourcePlan): boolean {
  const fileName = resourcePlan.checkpoint.resource.modelFileName ?? resourcePlan.checkpoint.resource.name;
  return Boolean(fileName) && fileName !== "story-planning-fallback.safetensors";
}

export function createStoryRenderPlanFromWorkflow(
  workflow: StoryWorkflowState,
  samplerOptions?: TimelineSamplerOptions,
): StoryRenderPlan {
  const shots = syncStoryShotsWithDependencyGraph(getShots(workflow), getDependencyGraph(workflow), {
    allowHighRiskSourceEdges: shouldAllowHighRiskSourceEdges(workflow),
  });

  return assembleStoryRenderPlan({
    img2imgDenoise: getStoryInputImg2ImgDenoise(getStoryInput(workflow)),
    parameterPlan: getParameterPlan(workflow),
    resourcePlan: getResourcePlan(workflow),
    samplerOptions,
    safetyPlan: getSafetyPlan(workflow),
    shots,
  });
}

export function createStoryConsistencyCheckFromWorkflow(
  workflow: StoryWorkflowState,
  now: () => string,
  extraWarnings: string[] = [],
  samplerOptions?: TimelineSamplerOptions,
): StoryConsistencyCheck {
  const input = getStoryInput(workflow);
  const rawShots = getShots(workflow);
  const graph = getDependencyGraph(workflow);
  const shots = syncStoryShotsWithDependencyGraph(rawShots, graph, {
    allowHighRiskSourceEdges: shouldAllowHighRiskSourceEdges(workflow),
  });
  const safetyPlan = getSafetyPlan(workflow);
  const resourcePlan = getResourcePlan(workflow);
  const renderPlan = getStoryRenderPlanFromWorkflow(workflow, samplerOptions);
  const shotIds = new Set(shots.map((shot) => shot.id));
  const issues: StoryConsistencyIssue[] = validateShotDependencyGraph(graph, shots).map((issue) => ({
    code: issue.nodeId ? `node-${issue.nodeId}` : "shot-dependency",
    message: issue.message,
    severity: "error",
    shotIds: issue.shotId ? [issue.shotId] : [],
  }));

  for (const note of safetyPlan.perShotNotes) {
    if (!shotIds.has(note.shotId)) {
      issues.push({
        code: "safety-shot-ref",
        message: `Safety plan references unknown shot "${note.shotId}".`,
        severity: "error",
        shotIds: [note.shotId],
      });
    }
  }

  for (const shot of renderPlan.shots) {
    const sourceShotIds = shots.find((candidate) => candidate.id === shot.shotId)?.sourceShotIds ?? [];
    if (!shotIds.has(shot.shotId)) {
      issues.push({
        code: "render-shot-ref",
        message: `Render plan references unknown shot "${shot.shotId}".`,
        severity: "error",
        shotIds: [shot.shotId],
      });
    }

    if (sourceShotIds.join("|") !== shot.sourceShotIds.join("|")) {
      issues.push({
        code: "render-source-sync",
        message: `Render plan source shots for "${shot.shotId}" do not match the dependency graph.`,
        severity: "error",
        shotIds: [shot.shotId],
      });
    }
  }

  if (!isStoryResourcePlanExecutable(resourcePlan)) {
    issues.push({
      code: "resource-plan-not-executable",
      message: "Story resource plan does not contain an executable local checkpoint.",
      severity: "error",
      shotIds: [],
    });
  }

  return {
    storyId: input.storyId,
    passed: issues.length === 0,
    checkedAt: now(),
    issues,
    warnings: [...extraWarnings, ...renderPlan.warnings],
  };
}

export function createStoryGenerationGateFromWorkflow(
  workflow: StoryWorkflowState,
  samplerOptions?: TimelineSamplerOptions,
) {
  const consistency = getNodeResult<StoryConsistencyCheck>(workflow, "story-consistency-check");
  const renderPlan = getStoryRenderPlanFromWorkflow(workflow, samplerOptions);
  const resourcePlan = getResourcePlan(workflow);
  const executable = isStoryResourcePlanExecutable(resourcePlan);
  const ready = consistency.passed && executable;

  return {
    storyId: renderPlan.storyId,
    ready,
    executionAvailable: ready,
    blockingReason: ready
      ? "Confirm generation to start shot graph execution."
      : consistency.issues.find((issue) => issue.severity === "error")?.message ||
        "Story Graph planning must pass consistency checks before generation.",
    confirmationRequired: true,
    nsfwContext: renderPlan.nsfwContext,
    renderPlanShotCount: renderPlan.shots.length,
    previewEnabled: renderPlan.preview.options.enabled,
    requestPreview: renderPlan.shots.map((shot) => createStoryGenerationRequestPreview(shot, renderPlan.img2imgDenoise)),
  };
}

function makeJsonRequest({
  input,
  instruction,
  payload,
  temperature = 0.25,
  maxTokens = 1200,
}: {
  input: StoryInput;
  instruction: string;
  payload: unknown;
  temperature?: number;
  maxTokens?: number;
}): LlmChatRequest {
  return {
    purpose: "comic-sequence-storyboard",
    nsfw: input.nsfwContext?.enabled ?? false,
    messages: [
      {
        role: "system",
        content: [
          "You are SceneForge's Story Graph planning agent.",
          "Return only valid JSON. No markdown, comments, or prose.",
          "All natural-language fields must be English.",
          "Do not write ComfyUI requests, file paths, or model names unless the requested schema explicitly asks for candidate ids.",
          instruction,
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify(payload, null, 2),
      },
    ],
    temperature,
    maxTokens,
  };
}

function createLlmStoryNodeAdapter<T>({
  buildRequest,
  parseResponse,
}: {
  buildRequest: (context: StoryNodeExecutionContext) => LlmChatRequest;
  parseResponse: (response: LlmChatResponse, context: StoryNodeExecutionContext) => T;
}): (completeChat: StoryCompleteChat) => StoryNodeAdapter<T> {
  return (completeChat) => async (context) => {
    try {
      const response = await completeChat(buildRequest(context));

      if (!isLlmChatResponse(response) || response.content.trim().length === 0) {
        throw malformedResponse("LLM response did not include usable text content.", { response });
      }

      return {
        value: parseResponse(response, context),
        source: "ai" satisfies TimelineNodeSource,
      };
    } catch (error) {
      throw new TimelineNodeExecutionError(normalizeLlmAdapterError(error));
    }
  };
}

function buildResourceCandidatePayload(
  input: StoryInput,
  resourceCandidates?: StoryLlmNodeAdapterOptions["resourceCandidates"],
) {
  const candidates = getSettingsResourceCandidates(input, resourceCandidates);
  const serializeCandidate = (resource: StoryLocalResource) => ({
    id: resource.id,
    name: resource.name,
    versionName: resource.versionName,
    baseModel: resource.baseModel,
    modelBaseModel: resource.modelBaseModel,
    modelFileName: resource.modelFileName,
    trainedWords: resource.trainedWords,
    tags: resource.tags,
    categories: resource.categories,
    usageGuide: resource.usageGuide,
    descriptionSnippet: resource.descriptionSnippet,
    averageWeight: resource.averageWeight,
    minWeight: resource.minWeight,
    maxWeight: resource.maxWeight,
    recommendations: resource.recommendations,
    exampleImageDimensions: resource.exampleImageDimensions,
  });

  return {
    checkpoints: candidates.checkpoints.map(serializeCandidate),
    loras: candidates.loras.map(serializeCandidate),
  };
}

export function createStoryLlmNodeAdapters({
  completeChat,
  now = () => new Date().toISOString(),
  resourceCandidates,
  samplerOptions: rawSamplerOptions,
}: StoryLlmNodeAdapterOptions): StoryNodeAdapters {
  const samplerOptions = normalizeTimelineSamplerOptions(rawSamplerOptions);
  const storyBible = createLlmStoryNodeAdapter<StoryBible>({
    buildRequest: (context) => {
      const input = getStoryInput(context.workflow);
      return makeJsonRequest({
        input,
        instruction:
          'Create a typed StoryBible with concrete visual anchors. Treat storySegments as the visual sequence and storyContext as global continuity, not as an extra shot. Create characters only for people or creatures explicitly present in the user story or storySegments; do not invent visible supporting people from implied locations or occupations. Character descriptions must include visible role/age range, silhouette, clothing, key prop, and emotional baseline when inferable. Location descriptions must include visible set pieces, materials, color accents, and recurring background anchors. visualStyle must describe renderable camera/lighting/color style, not abstract theme. Required shape: {"title":"","logline":"","genre":[""],"themes":[""],"worldSummary":"","visualStyle":"","characters":[{"id":"","name":"","role":"","description":"","continuityNotes":[""],"visualAnchors":[""]}],"locations":[{"id":"","name":"","description":"","visualAnchors":[""]}],"continuityRules":[""]}.',
        payload: {
          input,
          storyContext: input.storyContext ?? "",
          storySegments: input.storySegments ?? [],
        },
      });
    },
    parseResponse: (response, context) => normalizeStoryBible(response.content, getStoryInput(context.workflow)),
  })(completeChat);
  const storyOutline = createLlmStoryNodeAdapter<StoryOutline>({
    buildRequest: (context) => {
      const input = getStoryInput(context.workflow);
      return makeJsonRequest({
        input,
        instruction:
          'Create a typed StoryOutline. If input.targetShotCount is set, use exactly that count when practical. If input.targetShotCount is unset, you must decide the beat count from rawIntent yourself; local code has not parsed labels, counted events, or estimated a target. Read explicit user labels such as "Beat 1:", "Beat 2:", "Opening image:", and "Final image:" whether they appear inline or on separate lines, and preserve those labeled visual moments as separate beats unless the user explicitly asks to combine them. Do not pad to three shots. Use only as many beats as the story needs. If storySegments are supplied as structured input, use one beat per storySegment in order and do not create a beat for storyContext. Required shape: {"beats":[{"id":"","title":"","summary":"","order":1,"characterIds":[""]}]}.',
        payload: {
          input,
          targetShotCount: getRequestedTargetShotCount(input),
          shotCountMode: getShotCountMode(input),
          storyContext: input.storyContext ?? "",
          storySegments: input.storySegments ?? [],
          bible: getBible(context.workflow),
        },
      });
    },
    parseResponse: (response, context) => normalizeStoryOutline(
      response.content,
      getStoryInput(context.workflow),
      getBible(context.workflow),
    ),
  })(completeChat);
  const storyboardShots = createLlmStoryNodeAdapter<StoryShot[]>({
    buildRequest: (context) => {
      const input = getStoryInput(context.workflow);
      return makeJsonRequest({
        input,
        instruction:
          'Create typed storyboard shots with stable ids, order, camera, promptIntent, continuityNotes, characterIds, locationId, and sourceShotIds. Create exactly one storyboard shot per supplied outline beat unless input.targetShotCount is set and a target-count adjustment is necessary. If input.targetShotCount is unset, follow the StoryOutline beat count chosen by the LLM; local code has not parsed labels, counted events, or estimated a target. Preserve explicit rawIntent labels such as "Beat 1:" or "Final image:" through shot titles and shot content when they map to outline beats. Do not add filler shots or a separate context/setup shot. Each promptIntent must be an image-generation-ready visual brief with short comma-separated tag phrases: visible character identities/appearance, the same wardrobe and key prop continuity, one clear action, location/obstacle, composition, lighting, and visible emotional state. Visible subjects must match current segment explicitly named characters: do not invent extra visible people from a location or job role, and do not remove explicitly requested people. Partial/background interactions are acceptable when the segment explicitly requests them. Do not use abstract summaries, meta planning instructions, dangling clauses, or purely atmospheric prose. sourceShotIds must be empty unless this shot truly needs a previous generated image as an img2img/reference source; ordinary story order and continuity do not need sourceShotIds. Keep sourceShotIds empty for high-risk source-image transitions such as standing to kneeling, sitting to running, close-up to wide shot, major composition reset, camera reset, or large scene reset. Required shape: {"shots":[{"id":"shot-1","order":1,"title":"","description":"","beatId":"","locationId":"","characterIds":[""],"sourceShotIds":[""],"camera":"","promptIntent":"","continuityNotes":[""]}]}.',
        payload: {
          input,
          targetShotCount: getRequestedTargetShotCount(input),
          shotCountMode: getShotCountMode(input),
          storyContext: input.storyContext ?? "",
          storySegments: input.storySegments ?? [],
          bible: getBible(context.workflow),
          outline: getOutline(context.workflow),
        },
        maxTokens: 1800,
      });
    },
    parseResponse: (response, context) => normalizeStoryShots(
      response.content,
      getStoryInput(context.workflow),
      getBible(context.workflow),
      getOutline(context.workflow),
    ),
  })(completeChat);
  const safetyPlan = createLlmStoryNodeAdapter<StorySafetyPlan>({
    buildRequest: (context) => {
      const input = getStoryInput(context.workflow);
      return makeJsonRequest({
        input,
        instruction:
          'Create a StorySafetyPlan that preserves the configured NSFW context and safety constraints. Never permit sexualized minors, non-consensual sexual content, or graphic sexual violence. Required shape: {"audienceRating":"safe|suggestive|mature|explicit","contentWarnings":[""],"blockedContent":[""],"perShotNotes":[{"shotId":"","risks":[""],"mitigations":[""]}],"nsfwContext":{"enabled":false,"rationale":""}}.',
        payload: {
          input,
          shots: getShots(context.workflow),
        },
      });
    },
    parseResponse: (response, context) => normalizeStorySafetyPlan(
      response.content,
      getStoryInput(context.workflow),
      getShots(context.workflow),
    ),
  })(completeChat);
  const dependencyGraph = createLlmStoryNodeAdapter<ShotDependencyGraph>({
    buildRequest: (context) => {
      const input = getStoryInput(context.workflow);
      return makeJsonRequest({
        input,
        instruction:
          'Create a shot dependency graph using only supplied shot ids. Use reason "img2img-source" only when the later shot should receive the earlier generated image during ComfyUI execution, typically the same location, similar composition, continuous action, or a deliberate visual carry-over where image inheritance is desired. Never use img2img-source for high-risk source-image transitions such as standing to kneeling, sitting to running, close-up to wide shot, major composition reset, camera reset, large scene reset, cross-scene continuity, or cross-location cuts; use prompt-only continuity, reason "continuity", reason "story-order", reason "reference", or omit the edge instead. Existing execution only injects source images for img2img-source edges, so planning-only reasons must remain non-executable. Required shape: {"nodes":[{"shotId":"","label":""}],"edges":[{"fromShotId":"","toShotId":"","reason":"img2img-source|reference|continuity|story-order|manual"}]}.',
        payload: {
          input,
          shots: getShots(context.workflow),
        },
      });
    },
    parseResponse: (response, context) => normalizeShotDependencyGraph(
      response.content,
      getStoryInput(context.workflow),
      getShots(context.workflow),
    ),
  })(completeChat);
  const plotGraph = createLlmStoryNodeAdapter<PlotStateGraph>({
    buildRequest: (context) => {
      const input = getStoryInput(context.workflow);
      return makeJsonRequest({
        input,
        instruction:
          'Create a typed PlotStateGraph. Use only supplied shot ids. Required shape: {"states":[{"id":"","title":"","summary":"","shotIds":[""]}],"transitions":[{"fromStateId":"","toStateId":"","reason":""}]}.',
        payload: {
          input,
          outline: getOutline(context.workflow),
          shots: getShots(context.workflow),
        },
      });
    },
    parseResponse: (response, context) => normalizePlotStateGraph(
      response.content,
      getStoryInput(context.workflow),
      getShots(context.workflow),
    ),
  })(completeChat);
  const continuityGraph = createLlmStoryNodeAdapter<CharacterContinuityGraph>({
    buildRequest: (context) => {
      const input = getStoryInput(context.workflow);
      return makeJsonRequest({
        input,
        instruction:
          'Create a typed CharacterContinuityGraph. Use only supplied shot and character ids. Required shape: {"appearances":[{"shotId":"","characterId":"","wardrobe":[""],"poseOrAction":"","expression":"","continuityNotes":[""]}]}.',
        payload: {
          input,
          bible: getBible(context.workflow),
          shots: getShots(context.workflow),
        },
        maxTokens: 1600,
      });
    },
    parseResponse: (response, context) => normalizeCharacterContinuityGraph(
      response.content,
      getStoryInput(context.workflow),
      getBible(context.workflow),
      getShots(context.workflow),
    ),
  })(completeChat);
  const resourcePlan = createLlmStoryNodeAdapter<StoryResourcePlan>({
    buildRequest: (context) => {
      const input = getStoryInput(context.workflow);
      return makeJsonRequest({
        input,
        instruction:
          'Choose resources only from the supplied checkpoint and LoRA candidate ids. Do not invent ids. Use checkpoint and LoRA names, descriptions, tags, categories, trainedWords, usageGuide, observed weight ranges, and parameter recommendations to choose LoRA suggestedWeight values and explain tradeoffs. Do not apply generic local caps by style, lighting, or resource type; if metadata conflicts, choose a finite sane weight from the selected resource evidence and explain it in reason or warnings. Required shape: {"checkpoint":{"resource":{"id":""},"reason":""},"loras":[{"resource":{"id":""},"suggestedWeight":0.7,"reason":""}],"recommendationReason":"","overallEffect":"","warnings":[""]}.',
        payload: {
          input,
          safetyPlan: getSafetyPlan(context.workflow),
          shots: getShots(context.workflow),
          candidates: buildResourceCandidatePayload(input, resourceCandidates),
        },
        maxTokens: 900,
      });
    },
    parseResponse: (response, context) => normalizeStoryResourcePlan(
      response.content,
      getStoryInput(context.workflow),
      resourceCandidates,
    ),
  })(completeChat);
  const parameterPlan = createLlmStoryNodeAdapter<StoryParameterPlan>({
    buildRequest: (context) => {
      const input = getStoryInput(context.workflow);
      const resourcePlan = getResourcePlan(context.workflow);
      const parameterDefaults = createStoryDefaultGenerationParameters({
        input,
        resourcePlan,
        samplerOptions,
        shots: getShots(context.workflow),
      });
      const selectedResourceParameterContext = formatSelectedCivitaiResourcesForAi(
        getSelectedStoryResourcesForPrompting(resourcePlan),
      );

      return makeJsonRequest({
        input,
        instruction:
          `Create a typed StoryParameterPlan with one story-level generation resolution. Width and height must be positive story-level image dimensions. Every shot in the Story must use the same width and height, so put resolution only in defaults and never include width or height in perShotOverrides. Use supplied selectedResourceParameterContext plus resourcePlan as model-specific context: checkpoint description, usage guide, base model, selected LoRA descriptions, trained words, observed weights, recommendations, exampleImageDimensions, and storyboard composition needs jointly determine the single best story-level width, height, sampler, scheduler, steps, CFG, and denoise. You are responsible for choosing Anima and other model-family resolution from that resource context and the storyboard composition needs; local code will not infer resolution from scene keywords. Treat checkpoint exampleImageDimensions and explicit resource resolution guidance as stronger evidence than modelDefaultParameters when choosing width and height; preserve the dominant compatible model aspect ratio unless the user explicitly requested another aspect. Use supplied modelDefaultParameters only as the safe fallback when selected resources provide no stronger resolution or aspect evidence. Preserve supplied modelDefaultParameters for steps, cfg, samplerName, scheduler, and denoise unless a shot has a strong visual reason to override; do not lower steps/cfg/denoise just for speed. Put a brief resolution rationale in warnings when selected resource context changes width or height. samplerName must be one of availableSamplers and scheduler must be one of availableSchedulers. Per-shot parameter overrides may include only steps, cfg, samplerName, scheduler, denoise, or seed. Required shape: {"defaults":{"width":${parameterDefaults.width},"height":${parameterDefaults.height},"steps":${parameterDefaults.steps},"cfg":${parameterDefaults.cfg},"samplerName":"${parameterDefaults.samplerName}","scheduler":"${parameterDefaults.scheduler}","denoise":${parameterDefaults.denoise}},"perShotOverrides":[{"shotId":"","parameters":{},"reason":""}],"warnings":[""]}.`,
        payload: {
          availableSamplers: samplerOptions.samplers,
          availableSchedulers: samplerOptions.schedulers,
          input,
          modelDefaultParameters: parameterDefaults,
          resourcePlan,
          selectedResources: getSelectedStoryResourcesForPrompting(resourcePlan),
          selectedResourceParameterContext,
          shots: getShots(context.workflow),
        },
      });
    },
    parseResponse: (response, context) => normalizeStoryParameterPlan(
      response.content,
      getStoryInput(context.workflow),
      getShots(context.workflow),
      samplerOptions,
      createStoryDefaultGenerationParameters({
        input: getStoryInput(context.workflow),
        resourcePlan: getResourcePlan(context.workflow),
        samplerOptions,
        shots: getShots(context.workflow),
      }),
    ),
  })(completeChat);
  const renderPlan = createLlmStoryNodeAdapter<StoryRenderPlan>({
    buildRequest: (context) => {
      const input = getStoryInput(context.workflow);
      const resourcePlan = getResourcePlan(context.workflow);
      const shots = syncStoryShotsWithDependencyGraph(getShots(context.workflow), getDependencyGraph(context.workflow), {
        allowHighRiskSourceEdges: shouldAllowHighRiskSourceEdges(context.workflow),
      });
      const selectedResourcePromptContext = formatSelectedCivitaiResourcesForAi(
        getSelectedStoryResourcesForPrompting(resourcePlan),
      );

      return makeJsonRequest({
        input,
        instruction: [
          "Create a structured StoryRenderPromptPlan containing Anima prompt parts for each shot.",
          "Do not output a raw final prompt string, positivePrompt, negativePrompt, promptSections, or coarse sections; local code will compile animaPromptParts into final positivePrompt and negativePrompt strings.",
          "Each shot must include animaPromptParts with arrays for subjectTags, characterTags, seriesTags, artistTags, outfitTags, propTags, actionTags, settingTags, cameraTags, lightingTags, styleTags, negativeAdditions, plus singleFrameCaption.",
          "Tag arrays must contain only essential visible details. Each array item must be one atomic visual tag or concise visual clause. Prefer 3-8 tags per category; do not pad categories; do not repeat concepts.",
          "Follow Anima tag order semantics: the recommended quality/safety prefix is added locally, then subjectTags, characterTags, seriesTags, artistTags, then general visual tags.",
          "singleFrameCaption must be one complete English sentence describing only the current visible instant as a drawable single frame.",
          "Avoid repeating the same visible object, character description, action, setting, camera, lighting, or style phrase across tag arrays and singleFrameCaption; if a detail is already explicit in a tag, the caption should summarize the instant without restating the same wording.",
          "Compress multi-event beats into one frozen tableau. Do not write after, then, before, realizing, deciding, discovering, about to, in the middle of, as, while, or unresolved states using or.",
          "Action tags must be static visible poses, gestures, expressions, or object-contact states, not continuous motion or transition phrases. Avoid video-like wording such as stepping, walking, passing, glancing, moving, turning, entering, leaving, approaching, or reaching; prefer static wording such as standing beside the bulletin board, relaxed shoulders, easy smile, portfolio held against chest, tape on finger, students visible in hallway.",
          "singleFrameCaption must also describe a static held instant; do not use subordinate motion clauses like as students pass, while walking, or after finishing. Background people should be described as visible figures or paused observers, not passing or moving.",
          "Use only visible image content: subject count, adult/age context, visible people, hair, face, wardrobe, key props, concrete action or pose, setting, spatial position, framing, camera, lighting, color theme, and art style.",
          "Do not include story intent, emotional arc, rationale, symbolic meaning, viewer instruction, prose transitions, or words like should, must, important, clearly, feels, as if, payoff, problem-solving moment, visual priority, or focal character inside animaPromptParts.",
          "Do not include <lora:...> syntax, model names, checkpoint names, file names, sampler, scheduler, CFG, steps, seed, denoise, width, height, safety rating tags, quality tags, score tags, safe tag, or final prompt prefixes inside animaPromptParts.",
          "Translate structural ids such as character ids and location ids into natural visible descriptions; never emit ids like teen-resident or location-library as prompt text.",
          "Do not use original-story character names as prompt tags; describe their visible age category, hairstyle, wardrobe, props, and action instead. Only keep a name when it is an actual Civitai trained word or known source character tag.",
          "Preserve explicit current-shot subjects, adult/age context, wardrobe, key props, action or pose, setting, composition, camera, lighting, and continuity anchors as short visual clauses.",
          "For multi-character shots, each visible person must get a distinct clause with hairstyle, clothing, pose/action, spatial position, and adult or college-age presentation when applicable; do not collapse them into \"two young women\" or another generic group tag.",
          "For subjectTags use conservative tags like \"1girl\", \"solo\", \"2people\", or \"3people\"; only use \"3girls\" when every visible person is clearly a girl/woman.",
          "Use seriesTags only for known source/copyright tags when there is a real selected source; leave seriesTags empty for original stories. Use artistTags only for known artist tags and prefix each item with @; leave artistTags empty when no artist tag is selected.",
          "For selected style LoRAs, translate their usage guide into short visual style terms only, such as \"teal theme\", \"orange theme\", \"dusk glow\", or \"soft rim light\".",
          "Negative additions must be visual quality/exclusion terms only, must not replace safety negatives, and must not negate positive key characters, actions, props, clothing, or environments; for example, do not add \"sketch page\" or \"drawings\" when the shot requires a sketchbook or visible sketch pages.",
          'Required shape: {"shots":[{"shotId":"","animaPromptParts":{"subjectTags":[""],"characterTags":[""],"seriesTags":[""],"artistTags":[""],"outfitTags":[""],"propTags":[""],"actionTags":[""],"settingTags":[""],"cameraTags":[""],"lightingTags":[""],"styleTags":[""],"singleFrameCaption":"","negativeAdditions":[""]},"rationale":"","warnings":[""]}],"warnings":[""]}.',
        ].join(" "),
        payload: {
          input,
          bible: getBible(context.workflow),
          characterContinuityGraph: getContinuityGraph(context.workflow),
          dependencyGraph: getDependencyGraph(context.workflow),
          parameterPlan: getParameterPlan(context.workflow),
          resourcePlan,
          safetyPlan: getSafetyPlan(context.workflow),
          selectedResources: getSelectedStoryResourcesForPrompting(resourcePlan),
          selectedResourcePromptContext,
          shots,
        },
        maxTokens: Math.min(3600, 900 + shots.length * 520),
      });
    },
    parseResponse: (response, context) => {
      const input = getStoryInput(context.workflow);
      const shots = syncStoryShotsWithDependencyGraph(getShots(context.workflow), getDependencyGraph(context.workflow), {
        allowHighRiskSourceEdges: shouldAllowHighRiskSourceEdges(context.workflow),
      });
      const renderPromptPlan = normalizeStoryRenderPromptPlan(response.content, input, shots);

      return assembleStoryRenderPlan({
        img2imgDenoise: getStoryInputImg2ImgDenoise(input),
        parameterPlan: getParameterPlan(context.workflow),
        renderPromptPlan,
        resourcePlan: getResourcePlan(context.workflow),
        samplerOptions,
        safetyPlan: getSafetyPlan(context.workflow),
        shots,
      });
    },
  })(completeChat);

  return {
    "story-bible": storyBible,
    "story-outline": storyOutline,
    "storyboard-shots": storyboardShots,
    "story-safety-plan": safetyPlan,
    "shot-dependency-graph": dependencyGraph,
    "plot-state-graph": plotGraph,
    "character-continuity-graph": continuityGraph,
    "resource-plan": resourcePlan,
    "parameter-plan": parameterPlan,
    "story-render-plan": renderPlan,
    "story-consistency-check": (context) => ({
      value: createStoryConsistencyCheckFromWorkflow(context.workflow, now, [], samplerOptions),
      source: "system",
    }),
    "generation-gate": (context) => ({
      value: createStoryGenerationGateFromWorkflow(context.workflow, samplerOptions),
      source: "system",
    }),
  };
}
