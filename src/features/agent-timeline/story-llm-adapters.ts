import { isLlmChatResponse, LiteLlmError, type LlmChatRequest, type LlmChatResponse } from "@/features/llm";
import { formatSelectedCivitaiResourcesForAi } from "@/features/editor/ai-prompt/civitai-ai-context";

import {
  assembleStoryRenderPlan,
  createStoryDefaultGenerationParameters,
  createStoryGenerationRequestPreview,
  createStoryParameterPlan,
  createStoryResourcePlan,
  getStoryRenderPlanEligibleSourceShotIds,
  getStoryRenderPlanShotRequestedSourceShotIds,
  getStoryRenderPlanShotSourceShotIds,
  getStoryInputImg2ImgDenoise,
  getSelectedStoryResourcesForPrompting,
  normalizeStoryAnimaPromptParts,
  normalizeStoryRenderLocationContinuity,
  normalizeStoryRenderReferenceRecipe,
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
import {
  deriveStoryReferenceAssetPlan,
  evaluateStoryReferenceAssetFreezeGate,
} from "./story-reference-assets";
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
import {
  sanitizeStoryStylePaletteSnapshot,
  type StoryStylePaletteLoraSnapshot,
  type StoryStylePaletteSnapshot,
} from "./story-style-palette";
import type {
  CharacterContinuityGraph,
  PlotStateGraph,
  ShotDependencyGraph,
  ShotDependencyGraphEdge,
  StoryAudienceRating,
  StoryBible,
  StoryBibleCharacter,
  StoryBibleLocation,
  StoryBibleProp,
  StoryCharacterId,
  StoryConsistencyCheck,
  StoryConsistencyIssue,
  StoryEntityCardCharacter,
  StoryEntityCardLocation,
  StoryEntityCardOutfit,
  StoryEntityCardProp,
  StoryEntityCards,
  StoryInput,
  StoryReferenceAssetPlan,
  StoryLocationId,
  StoryOutline,
  StoryOutfitId,
  StoryPlanningError,
  StoryPropId,
  StorySafetyPlan,
  StoryShot,
  StoryShotAppearanceState,
  StoryShotId,
  StoryShotInteractionState,
  StoryShotLocationViewState,
  StoryWorkflowNodeId,
} from "./story-types";
import type {
  CommonWorkflowNodeAdapter,
  CommonWorkflowNodeExecutionContext,
} from "./workflow-definition";
import {
  formatPromptProfileLabel,
  normalizePromptProfileId,
  type PromptProfileId,
} from "@/shared/prompt-profile";

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

export type StoryResourceCandidateSet = {
  checkpoints: StoryLocalResource[];
  loras: StoryLocalResource[];
};

export type StoryResourceCandidateLoadRequest = {
  desiredEffect: string;
  promptProfile: PromptProfileId;
  selectedCheckpointId?: string;
  selectedLoraIds?: string[];
};

export type StoryLlmNodeAdapterOptions = {
  completeChat: StoryCompleteChat;
  loadResourceCandidates?: (
    request: StoryResourceCandidateLoadRequest,
    context: StoryNodeExecutionContext,
  ) => Promise<StoryResourceCandidateSet> | StoryResourceCandidateSet;
  now?: () => string;
  resourceCandidates?: StoryResourceCandidateSet;
  samplerOptions?: TimelineSamplerOptions;
};

const maxCharacters = 12;
const maxLocations = 12;
const maxProps = 24;
const maxWarnings = 12;
const storyNsfwModelExcludedNodeIds = new Set<StoryWorkflowNodeId>([
  "shot-dependency-graph",
  "resource-plan",
  "parameter-plan",
]);
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

function displayText(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").trim();
}

function compactText(value: unknown, maxLength = 1200) {
  const text = displayText(value);

  if (maxLength <= 0) {
    return "";
  }

  if (text.length <= maxLength) {
    return text;
  }

  const minSemanticCutoff = Math.floor(maxLength * 0.75);
  const wordBoundary = text.lastIndexOf(" ", maxLength);
  const cutoff = wordBoundary >= minSemanticCutoff ? wordBoundary : maxLength;

  return text.slice(0, cutoff).trim();
}

function normalizeStringList(value: unknown, maxItems = 8) {
  void maxItems;
  if (!Array.isArray(value)) {
    const single = displayText(value);
    return single ? [single] : [];
  }

  return value.map(displayText).filter(Boolean);
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

function uniqueStringList(values: readonly string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }

    seen.add(value);
    result.push(value);
  }

  return result;
}

function createPlanningError({
  characterIds,
  code,
  locationIds,
  message,
  path,
  propIds,
  severity = "warning",
  shotIds,
}: {
  characterIds?: StoryPlanningError["characterIds"];
  code: string;
  locationIds?: StoryPlanningError["locationIds"];
  message: string;
  path?: string;
  propIds?: StoryPlanningError["propIds"];
  severity?: StoryPlanningError["severity"];
  shotIds?: StoryPlanningError["shotIds"];
}): StoryPlanningError {
  return {
    code,
    message,
    severity,
    ...(path ? { path } : {}),
    ...(shotIds?.length ? { shotIds } : {}),
    ...(characterIds?.length ? { characterIds } : {}),
    ...(propIds?.length ? { propIds } : {}),
    ...(locationIds?.length ? { locationIds } : {}),
  };
}

function pushPlanningError(errors: StoryPlanningError[], error: StoryPlanningError) {
  errors.push(error);
}

function filterKnownIds({
  code,
  errors,
  ids,
  knownIds,
  label,
  path,
  shotId,
}: {
  code: string;
  errors: StoryPlanningError[];
  ids: string[];
  knownIds: ReadonlySet<string>;
  label: string;
  path: string;
  shotId?: StoryShotId;
}) {
  const result: string[] = [];

  for (const id of uniqueStringList(ids)) {
    if (knownIds.has(id)) {
      result.push(id);
      continue;
    }

    pushPlanningError(errors, createPlanningError({
      code,
      message: `${label} references unknown id "${id}".`,
      path,
      ...(shotId ? { shotIds: [shotId] } : {}),
    }));
  }

  return result;
}

function normalizeCharacter(value: unknown, index: number): StoryBibleCharacter {
  const raw = isRecord(value) ? value : {};
  const id = normalizeId(raw.id ?? raw.name, `character-${index + 1}`);
  const name = compactText(raw.name, 80) || `Character ${index + 1}`;

  return {
    id,
    name,
    role: compactText(raw.role, 120) || "Supporting story character",
    description: displayText(raw.description ?? raw.summary) || name,
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
    description: displayText(raw.description ?? raw.summary) || name,
    visualAnchors: normalizeStringList(raw.visualAnchors ?? raw.visual_anchors, 8),
  };
}

function normalizeProp(
  value: unknown,
  index: number,
  characterIds: ReadonlySet<StoryCharacterId>,
  planningErrors: StoryPlanningError[],
): StoryBibleProp {
  const raw = isRecord(value) ? value : {};
  const id = normalizeId(raw.id ?? raw.name, `prop-${index + 1}`);
  const name = compactText(raw.name, 80) || `Prop ${index + 1}`;
  const ownerCharacterIds = filterKnownIds({
    code: "story_bible_prop_owner_ref",
    errors: planningErrors,
    ids: normalizeStringList(raw.ownerCharacterIds ?? raw.owner_character_ids, 12),
    knownIds: characterIds,
    label: `Story Bible prop "${id}"`,
    path: `props.${index}.ownerCharacterIds`,
  }) as StoryCharacterId[];

  return {
    id,
    name,
    description: displayText(raw.description ?? raw.summary) || name,
    continuityNotes: normalizeStringList(raw.continuityNotes ?? raw.continuity_notes, 8),
    ...(ownerCharacterIds.length > 0 ? { ownerCharacterIds } : {}),
    visualAnchors: normalizeStringList(raw.visualAnchors ?? raw.visual_anchors, 8),
  };
}

export function normalizeStoryBible(raw: unknown, input: StoryInput): StoryBible {
  const parsed = typeof raw === "string" ? parseJsonObjectFromText(raw) : raw;
  if (!isRecord(parsed)) {
    throw malformedResponse("Story bible response must be a JSON object.", { raw });
  }

  const planningErrors: StoryPlanningError[] = [];
  const characters = (Array.isArray(parsed.characters) ? parsed.characters : [])
    .map(normalizeCharacter)
    .slice(0, maxCharacters);
  const locations = (Array.isArray(parsed.locations) ? parsed.locations : [])
    .map(normalizeLocation)
    .slice(0, maxLocations);
  const characterIds = new Set(characters.map((character) => character.id));
  const props = (Array.isArray(parsed.props) ? parsed.props : [])
    .map((prop, index) => normalizeProp(prop, index, characterIds, planningErrors))
    .slice(0, maxProps);

  return {
    storyId: compactText(parsed.storyId, 120) || input.storyId,
    title: compactText(parsed.title, 120) || compactText(input.rawIntent, 80) || "Story Graph",
    logline: displayText(parsed.logline ?? parsed.summary) || input.rawIntent,
    genre: normalizeStringList(parsed.genre, 6),
    themes: normalizeStringList(parsed.themes, 8),
    worldSummary: displayText(parsed.worldSummary ?? parsed.world_summary) || input.rawIntent,
    visualStyle: displayText(parsed.visualStyle ?? parsed.visual_style) || "Cinematic storyboard continuity.",
    characters: characters.length > 0
      ? characters
      : [normalizeCharacter({ id: "main-character", name: "Main character", description: input.rawIntent }, 0)],
    locations: locations.length > 0
      ? locations
      : [normalizeLocation({ id: "primary-location", name: "Primary location", description: input.rawIntent }, 0)],
    props,
    continuityRules: normalizeStringList(parsed.continuityRules ?? parsed.continuity_rules, 12),
    ...(planningErrors.length > 0 ? { planningErrors } : {}),
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
      summary: displayText(rawBeat.summary ?? rawBeat.description) || input.rawIntent,
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
        summary: displayText(beat?.summary) || segment.sourceText,
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

function createDefaultAppearanceState(shot: Pick<StoryShot, "characterIds" | "continuityNotes" | "description" | "id" | "promptIntent">): StoryShotAppearanceState {
  return {
    characterStates: shot.characterIds.map((characterId) => ({
      characterId,
      appearance: shot.promptIntent || shot.description,
      continuityNotes: [...shot.continuityNotes],
      visible: true,
    })),
    notes: [...shot.continuityNotes],
    propIds: [],
  };
}

function createDefaultInteractionState(shot: Pick<StoryShot, "characterIds" | "continuityNotes" | "description" | "id">): StoryShotInteractionState {
  return {
    characterIds: [...shot.characterIds],
    continuityNotes: [...shot.continuityNotes],
    description: shot.description,
    physicalContact: [],
    propIds: [],
  };
}

function createDefaultLocationViewState(shot: Pick<StoryShot, "camera" | "description" | "locationId">): StoryShotLocationViewState {
  return {
    camera: shot.camera,
    viewDescription: shot.description,
    visibleAnchors: [],
    ...(shot.locationId ? { locationId: shot.locationId } : {}),
  };
}

function normalizeShotAppearanceState({
  characterIds,
  planningErrors,
  propIds,
  raw,
  shot,
}: {
  characterIds: ReadonlySet<StoryCharacterId>;
  planningErrors: StoryPlanningError[];
  propIds: ReadonlySet<StoryPropId>;
  raw: unknown;
  shot: StoryShot;
}): StoryShotAppearanceState {
  const fallback = createDefaultAppearanceState(shot);
  if (raw === undefined) {
    pushPlanningError(planningErrors, createPlanningError({
      code: "shot_appearance_state_missing",
      message: `Shot "${shot.id}" is missing appearanceState; local defaults were applied.`,
      path: "appearanceState",
      shotIds: [shot.id],
    }));
    return fallback;
  }

  if (!isRecord(raw)) {
    pushPlanningError(planningErrors, createPlanningError({
      code: "shot_appearance_state_malformed",
      message: `Shot "${shot.id}" appearanceState must be an object; local defaults were applied.`,
      path: "appearanceState",
      shotIds: [shot.id],
    }));
    return fallback;
  }

  const rawCharacterStates = Array.isArray(raw.characterStates)
    ? raw.characterStates
    : Array.isArray(raw.character_states)
      ? raw.character_states
      : [];
  const characterStates = rawCharacterStates
    .map((state, index) => {
      if (!isRecord(state)) {
        pushPlanningError(planningErrors, createPlanningError({
          code: "shot_appearance_character_state_malformed",
          message: `Shot "${shot.id}" appearanceState.characterStates.${index} must be an object.`,
          path: `appearanceState.characterStates.${index}`,
          shotIds: [shot.id],
        }));
        return null;
      }

      const characterId = compactText(state.characterId ?? state.character_id, 80);
      if (!characterIds.has(characterId)) {
        pushPlanningError(planningErrors, createPlanningError({
          characterIds: characterId ? [characterId] : undefined,
          code: "shot_appearance_character_ref",
          message: `Shot "${shot.id}" appearanceState references unknown character "${characterId || "(missing)"}".`,
          path: `appearanceState.characterStates.${index}.characterId`,
          shotIds: [shot.id],
        }));
        return null;
      }

      return {
        characterId,
        appearance: displayText(state.appearance ?? state.description) ||
          shot.promptIntent ||
          shot.description,
        continuityNotes: normalizeStringList(state.continuityNotes ?? state.continuity_notes, 8),
        ...(compactText(state.outfitId ?? state.outfit_id, 80)
          ? { outfitId: compactText(state.outfitId ?? state.outfit_id, 80) }
          : {}),
        visible: state.visible === false ? false : true,
      };
    })
    .filter((state): state is StoryShotAppearanceState["characterStates"][number] => Boolean(state));

  const validPropIds = filterKnownIds({
    code: "shot_appearance_prop_ref",
    errors: planningErrors,
    ids: normalizeStringList(raw.propIds ?? raw.prop_ids, 24),
    knownIds: propIds,
    label: `Shot "${shot.id}" appearanceState`,
    path: "appearanceState.propIds",
    shotId: shot.id,
  }) as StoryPropId[];

  if (characterStates.length === 0 && rawCharacterStates.length > 0) {
    pushPlanningError(planningErrors, createPlanningError({
      code: "shot_appearance_state_empty_after_validation",
      message: `Shot "${shot.id}" appearanceState did not contain any valid character states; local character defaults were applied.`,
      path: "appearanceState.characterStates",
      shotIds: [shot.id],
    }));
  }

  return {
    characterStates: characterStates.length > 0 ? characterStates : fallback.characterStates,
    notes: normalizeStringList(raw.notes ?? raw.continuityNotes ?? raw.continuity_notes, 8),
    propIds: validPropIds,
  };
}

function normalizeShotInteractionState({
  characterIds,
  planningErrors,
  propIds,
  raw,
  shot,
}: {
  characterIds: ReadonlySet<StoryCharacterId>;
  planningErrors: StoryPlanningError[];
  propIds: ReadonlySet<StoryPropId>;
  raw: unknown;
  shot: StoryShot;
}): StoryShotInteractionState {
  const fallback = createDefaultInteractionState(shot);
  if (raw === undefined) {
    pushPlanningError(planningErrors, createPlanningError({
      code: "shot_interaction_state_missing",
      message: `Shot "${shot.id}" is missing interactionState; local defaults were applied.`,
      path: "interactionState",
      shotIds: [shot.id],
    }));
    return fallback;
  }

  if (!isRecord(raw)) {
    pushPlanningError(planningErrors, createPlanningError({
      code: "shot_interaction_state_malformed",
      message: `Shot "${shot.id}" interactionState must be an object; local defaults were applied.`,
      path: "interactionState",
      shotIds: [shot.id],
    }));
    return fallback;
  }

  const validCharacterIds = filterKnownIds({
    code: "shot_interaction_character_ref",
    errors: planningErrors,
    ids: normalizeStringList(raw.characterIds ?? raw.character_ids, 16),
    knownIds: characterIds,
    label: `Shot "${shot.id}" interactionState`,
    path: "interactionState.characterIds",
    shotId: shot.id,
  }) as StoryCharacterId[];
  const validPropIds = filterKnownIds({
    code: "shot_interaction_prop_ref",
    errors: planningErrors,
    ids: normalizeStringList(raw.propIds ?? raw.prop_ids, 24),
    knownIds: propIds,
    label: `Shot "${shot.id}" interactionState`,
    path: "interactionState.propIds",
    shotId: shot.id,
  }) as StoryPropId[];

  return {
    characterIds: validCharacterIds.length > 0 ? validCharacterIds : fallback.characterIds,
    continuityNotes: normalizeStringList(raw.continuityNotes ?? raw.continuity_notes, 8),
    description: displayText(raw.description ?? raw.summary) || fallback.description,
    physicalContact: normalizeStringList(raw.physicalContact ?? raw.physical_contact, 8),
    propIds: validPropIds,
  };
}

function normalizeShotLocationViewState({
  locationIds,
  planningErrors,
  raw,
  shot,
}: {
  locationIds: ReadonlySet<StoryLocationId>;
  planningErrors: StoryPlanningError[];
  raw: unknown;
  shot: StoryShot;
}): StoryShotLocationViewState {
  const fallback = createDefaultLocationViewState(shot);
  if (raw === undefined) {
    pushPlanningError(planningErrors, createPlanningError({
      code: "shot_location_view_state_missing",
      message: `Shot "${shot.id}" is missing locationViewState; local defaults were applied.`,
      path: "locationViewState",
      shotIds: [shot.id],
    }));
    return fallback;
  }

  if (!isRecord(raw)) {
    pushPlanningError(planningErrors, createPlanningError({
      code: "shot_location_view_state_malformed",
      message: `Shot "${shot.id}" locationViewState must be an object; local defaults were applied.`,
      path: "locationViewState",
      shotIds: [shot.id],
    }));
    return fallback;
  }

  const rawLocationId = compactText(raw.locationId ?? raw.location_id, 80);
  const locationId = rawLocationId || shot.locationId;

  if (rawLocationId && !locationIds.has(rawLocationId)) {
    pushPlanningError(planningErrors, createPlanningError({
      code: "shot_location_view_ref",
      locationIds: [rawLocationId],
      message: `Shot "${shot.id}" locationViewState references unknown location "${rawLocationId}".`,
      path: "locationViewState.locationId",
      shotIds: [shot.id],
    }));
  }

  return {
    camera: displayText(raw.camera) || fallback.camera,
    viewDescription: displayText(raw.viewDescription ?? raw.view_description ?? raw.description) ||
      fallback.viewDescription,
    visibleAnchors: normalizeStringList(raw.visibleAnchors ?? raw.visible_anchors, 8),
    ...(locationId && locationIds.has(locationId) ? { locationId } : {}),
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
  const propIds = new Set((bible.props ?? []).map((prop) => prop.id));
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
    const baseShot = {
      id,
      storyId: input.storyId,
      order,
      title: compactText(rawShot.title, 120) || `Shot ${order}`,
      description: displayText(rawShot.description ?? rawShot.summary) || input.rawIntent,
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
      camera: displayText(rawShot.camera) || "Storyboard frame",
      promptIntent: displayText(rawShot.promptIntent ?? rawShot.prompt_intent ?? rawShot.prompt) || input.rawIntent,
      continuityNotes: normalizeStringList(rawShot.continuityNotes ?? rawShot.continuity_notes, 12),
    } satisfies StoryShot;
    const planningErrors: StoryPlanningError[] = [];
    const appearanceState = normalizeShotAppearanceState({
      characterIds,
      planningErrors,
      propIds,
      raw: rawShot.appearanceState ?? rawShot.appearance_state,
      shot: baseShot,
    });
    const interactionState = normalizeShotInteractionState({
      characterIds,
      planningErrors,
      propIds,
      raw: rawShot.interactionState ?? rawShot.interaction_state,
      shot: baseShot,
    });
    const locationViewState = normalizeShotLocationViewState({
      locationIds,
      planningErrors,
      raw: rawShot.locationViewState ?? rawShot.location_view_state,
      shot: baseShot,
    });

    return {
      ...baseShot,
      appearanceState,
      interactionState,
      locationViewState,
      ...(planningErrors.length > 0 ? { planningErrors } : {}),
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
      rationale: displayText(isRecord(parsed.nsfwContext) ? parsed.nsfwContext.rationale : parsed.nsfw_rationale) ||
        input.nsfwContext?.rationale ||
        "",
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
      summary: displayText(rawState.summary ?? rawState.description) || input.rawIntent,
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
          reason: displayText(rawTransition.reason) || "Story progression.",
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
          poseOrAction: displayText(rawAppearance.poseOrAction ?? rawAppearance.pose_or_action),
          expression: displayText(rawAppearance.expression),
          continuityNotes: normalizeStringList(rawAppearance.continuityNotes ?? rawAppearance.continuity_notes, 8),
        };
      })
      .filter((appearance) => shotIds.has(appearance.shotId) && characterIds.has(appearance.characterId)),
  };
}

function getShotIdsForCharacter(shots: readonly StoryShot[], characterId: StoryCharacterId) {
  return shots
    .filter((shot) =>
      shot.characterIds.includes(characterId) ||
      (shot.appearanceState?.characterStates ?? []).some((state) => state.characterId === characterId) ||
      (shot.interactionState?.characterIds ?? []).includes(characterId),
    )
    .map((shot) => shot.id);
}

function getShotPropIds(shot: StoryShot) {
  return uniqueStringList([
    ...(shot.appearanceState?.propIds ?? []),
    ...(shot.interactionState?.propIds ?? []),
  ]) as StoryPropId[];
}

function getShotIdsForProp(shots: readonly StoryShot[], propId: StoryPropId) {
  return shots
    .filter((shot) => getShotPropIds(shot).includes(propId))
    .map((shot) => shot.id);
}

function getShotIdsForLocation(shots: readonly StoryShot[], locationId: StoryLocationId) {
  return shots
    .filter((shot) => shot.locationId === locationId || shot.locationViewState?.locationId === locationId)
    .map((shot) => shot.id);
}

function normalizeOutfitId(characterId: StoryCharacterId, wardrobe: readonly string[], index: number) {
  return normalizeId([characterId, ...wardrobe].filter(Boolean).join("-"), `${characterId}-outfit-${index + 1}`);
}

function createFallbackEntityOutfits({
  bible,
  continuityGraph,
}: {
  bible: StoryBible;
  continuityGraph: CharacterContinuityGraph;
}): StoryEntityCardOutfit[] {
  const outfits = new Map<StoryOutfitId, StoryEntityCardOutfit>();
  let index = 0;

  for (const appearance of continuityGraph.appearances) {
    const wardrobe = appearance.wardrobe.length > 0 ? appearance.wardrobe : ["continuity outfit"];
    const id = normalizeOutfitId(appearance.characterId, wardrobe, index);
    const existing = outfits.get(id);

    if (existing) {
      outfits.set(id, {
        ...existing,
        continuityNotes: uniqueStringList([...existing.continuityNotes, ...appearance.continuityNotes]),
        shotIds: uniqueStringList([...existing.shotIds, appearance.shotId]),
      });
      continue;
    }

    index += 1;
    outfits.set(id, {
      id,
      characterId: appearance.characterId,
      name: wardrobe.join(", "),
      description: wardrobe.join(", "),
      continuityNotes: [...appearance.continuityNotes],
      shotIds: [appearance.shotId],
      visualAnchors: wardrobe,
    });
  }

  for (const character of bible.characters) {
    if ([...outfits.values()].some((outfit) => outfit.characterId === character.id)) {
      continue;
    }

    const id = normalizeId(`${character.id}-default-outfit`, `${character.id}-outfit-${index + 1}`);
    outfits.set(id, {
      id,
      characterId: character.id,
      name: `${character.name} default outfit`,
      description: character.description,
      continuityNotes: [...character.continuityNotes],
      shotIds: [],
      visualAnchors: [...character.visualAnchors],
    });
    index += 1;
  }

  return [...outfits.values()];
}

function createFallbackEntityCards({
  bible,
  continuityGraph,
  input,
  planningErrors = [],
  shots,
}: {
  bible: StoryBible;
  continuityGraph: CharacterContinuityGraph;
  input: StoryInput;
  planningErrors?: StoryPlanningError[];
  shots: readonly StoryShot[];
}): StoryEntityCards {
  const outfits = createFallbackEntityOutfits({ bible, continuityGraph });
  const outfitIdsByCharacter = new Map<StoryCharacterId, StoryOutfitId[]>();
  for (const outfit of outfits) {
    outfitIdsByCharacter.set(outfit.characterId, [
      ...(outfitIdsByCharacter.get(outfit.characterId) ?? []),
      outfit.id,
    ]);
  }

  const propIdsByCharacter = new Map<StoryCharacterId, StoryPropId[]>();
  for (const shot of shots) {
    const shotPropIds = getShotPropIds(shot);
    const shotCharacterIds = uniqueStringList([
      ...shot.characterIds,
      ...(shot.appearanceState?.characterStates ?? []).map((state) => state.characterId),
      ...(shot.interactionState?.characterIds ?? []),
    ]) as StoryCharacterId[];

    for (const characterId of shotCharacterIds) {
      propIdsByCharacter.set(characterId, uniqueStringList([
        ...(propIdsByCharacter.get(characterId) ?? []),
        ...shotPropIds,
      ]) as StoryPropId[]);
    }
  }

  return {
    storyId: input.storyId,
    characters: bible.characters.map((character) => ({
      id: character.id,
      name: character.name,
      role: character.role,
      description: character.description,
      continuityNotes: [...character.continuityNotes],
      outfitIds: outfitIdsByCharacter.get(character.id) ?? [],
      propIds: propIdsByCharacter.get(character.id) ?? [],
      shotIds: getShotIdsForCharacter(shots, character.id),
      visualAnchors: [...character.visualAnchors],
    })),
    outfits,
    props: (bible.props ?? []).map((prop) => ({
      id: prop.id,
      name: prop.name,
      description: prop.description,
      continuityNotes: [...prop.continuityNotes],
      ownerCharacterIds: [...(prop.ownerCharacterIds ?? [])],
      shotIds: getShotIdsForProp(shots, prop.id),
      visualAnchors: [...prop.visualAnchors],
    })),
    locations: bible.locations.map((location) => ({
      id: location.id,
      name: location.name,
      description: location.description,
      shotIds: getShotIdsForLocation(shots, location.id),
      viewStates: shots
        .filter((shot) => shot.locationId === location.id || shot.locationViewState?.locationId === location.id)
        .map((shot) => ({
          shotId: shot.id,
          camera: shot.locationViewState?.camera || shot.camera,
          viewDescription: shot.locationViewState?.viewDescription || shot.description,
          visibleAnchors: [...(shot.locationViewState?.visibleAnchors ?? [])],
        })),
      visualAnchors: [...location.visualAnchors],
    })),
    planningErrors: [...planningErrors],
  };
}

function normalizeEntityShotIds(
  rawShotIds: unknown,
  shotIds: ReadonlySet<StoryShotId>,
  fallback: StoryShotId[],
  errors: StoryPlanningError[],
  path: string,
) {
  if (!Array.isArray(rawShotIds)) {
    pushPlanningError(errors, createPlanningError({
      code: "entity_cards_shot_ids_missing",
      message: `${path} is missing shotIds; derived shot ids were used.`,
      path,
    }));
    return fallback;
  }

  return filterKnownIds({
    code: "entity_cards_shot_ref",
    errors,
    ids: normalizeStringList(rawShotIds, 24),
    knownIds: shotIds,
    label: "Entity cards",
    path,
  }) as StoryShotId[];
}

function mergeDerivedEntityCards<T extends { id: string }>({
  code,
  derived,
  errors,
  label,
  normalized,
  path,
}: {
  code: string;
  derived: T[];
  errors: StoryPlanningError[];
  label: string;
  normalized: T[];
  path: string;
}): T[] {
  if (normalized.length === 0) {
    for (const card of derived) {
      pushPlanningError(errors, createPlanningError({
        code,
        message: `Entity cards response omitted ${label} "${card.id}"; derived ${label} card was used.`,
        path,
      }));
    }
    return derived;
  }

  const normalizedById = new Map(normalized.map((card) => [card.id, card]));
  const merged = derived.map((card) => {
    const normalizedCard = normalizedById.get(card.id);
    if (normalizedCard) {
      return normalizedCard;
    }

    pushPlanningError(errors, createPlanningError({
      code,
      message: `Entity cards response omitted ${label} "${card.id}"; derived ${label} card was used.`,
      path,
    }));
    return card;
  });

  for (const card of normalized) {
    if (!derived.some((derivedCard) => derivedCard.id === card.id)) {
      merged.push(card);
    }
  }

  return merged;
}

function normalizeEntityCharacterCards({
  derived,
  errors,
  raw,
  outfitIds,
  propIds,
  shotIds,
}: {
  derived: StoryEntityCards;
  errors: StoryPlanningError[];
  raw: unknown;
  outfitIds: ReadonlySet<StoryOutfitId>;
  propIds: ReadonlySet<StoryPropId>;
  shotIds: ReadonlySet<StoryShotId>;
}): StoryEntityCardCharacter[] {
  const rawCards = Array.isArray(raw) ? raw : null;
  if (!rawCards) {
    pushPlanningError(errors, createPlanningError({
      code: "entity_cards_characters_missing",
      message: "Entity cards response is missing characters; derived character cards were used.",
      path: "characters",
    }));
    return derived.characters;
  }

  const derivedById = new Map(derived.characters.map((character) => [character.id, character]));
  const normalized = rawCards.flatMap((card, index) => {
    const rawCard = isRecord(card) ? card : {};
    const id = compactText(rawCard.id ?? rawCard.characterId ?? rawCard.character_id, 80);
    const fallback = derivedById.get(id);

    if (!fallback) {
      pushPlanningError(errors, createPlanningError({
        characterIds: id ? [id] : undefined,
        code: "entity_cards_character_ref",
        message: `Entity character card "${id || "(missing)"}" does not match Story Bible characters.`,
        path: `characters.${index}.id`,
      }));
      return [];
    }
    const rawOutfitIds = rawCard.outfitIds ?? rawCard.outfit_ids;
    const rawPropIds = rawCard.propIds ?? rawCard.prop_ids;

    return [{
      id: fallback.id,
      name: compactText(rawCard.name, 80) || fallback.name,
      role: compactText(rawCard.role, 120) || fallback.role,
      description: displayText(rawCard.description ?? rawCard.summary) || fallback.description,
      continuityNotes: normalizeStringList(rawCard.continuityNotes ?? rawCard.continuity_notes, 12),
      outfitIds: rawOutfitIds === undefined
        ? fallback.outfitIds
        : filterKnownIds({
            code: "entity_cards_character_outfit_ref",
            errors,
            ids: normalizeStringList(rawOutfitIds, 24),
            knownIds: outfitIds,
            label: `Entity character card "${fallback.id}"`,
            path: `characters.${index}.outfitIds`,
          }) as StoryOutfitId[],
      propIds: rawPropIds === undefined
        ? fallback.propIds
        : filterKnownIds({
            code: "entity_cards_character_prop_ref",
            errors,
            ids: normalizeStringList(rawPropIds, 24),
            knownIds: propIds,
            label: `Entity character card "${fallback.id}"`,
            path: `characters.${index}.propIds`,
          }) as StoryPropId[],
      shotIds: normalizeEntityShotIds(rawCard.shotIds ?? rawCard.shot_ids, shotIds, fallback.shotIds, errors, `characters.${index}.shotIds`),
      visualAnchors: normalizeStringList(rawCard.visualAnchors ?? rawCard.visual_anchors, 12),
    }];
  });

  return mergeDerivedEntityCards({
    code: "entity_cards_character_missing",
    derived: derived.characters,
    errors,
    label: "character",
    normalized,
    path: "characters",
  });
}

function normalizeEntityOutfitCards({
  characterIds,
  derived,
  errors,
  raw,
  shotIds,
}: {
  characterIds: ReadonlySet<StoryCharacterId>;
  derived: StoryEntityCards;
  errors: StoryPlanningError[];
  raw: unknown;
  shotIds: ReadonlySet<StoryShotId>;
}): StoryEntityCardOutfit[] {
  const rawCards = Array.isArray(raw) ? raw : null;
  if (!rawCards) {
    pushPlanningError(errors, createPlanningError({
      code: "entity_cards_outfits_missing",
      message: "Entity cards response is missing outfits; derived outfit cards were used.",
      path: "outfits",
    }));
    return derived.outfits;
  }

  const normalized = rawCards.flatMap((card, index) => {
    const rawCard = isRecord(card) ? card : {};
    const characterId = compactText(rawCard.characterId ?? rawCard.character_id, 80);

    if (!characterIds.has(characterId)) {
      pushPlanningError(errors, createPlanningError({
        characterIds: characterId ? [characterId] : undefined,
        code: "entity_cards_outfit_character_ref",
        message: `Entity outfit card references unknown character "${characterId || "(missing)"}".`,
        path: `outfits.${index}.characterId`,
      }));
      return [];
    }

    const id = normalizeId(rawCard.id ?? rawCard.name, `${characterId}-outfit-${index + 1}`);
    return [{
      id,
      characterId,
      name: compactText(rawCard.name, 100) || `Outfit ${index + 1}`,
      description: displayText(rawCard.description ?? rawCard.summary) || compactText(rawCard.name, 100) || `Outfit ${index + 1}`,
      continuityNotes: normalizeStringList(rawCard.continuityNotes ?? rawCard.continuity_notes, 12),
      shotIds: normalizeEntityShotIds(rawCard.shotIds ?? rawCard.shot_ids, shotIds, [], errors, `outfits.${index}.shotIds`),
      ...(rawCard.storyCritical === true || rawCard.story_critical === true || rawCard.critical === true
        ? { storyCritical: true }
        : {}),
      visualAnchors: normalizeStringList(rawCard.visualAnchors ?? rawCard.visual_anchors, 12),
    }];
  });

  return mergeDerivedEntityCards({
    code: "entity_cards_outfit_missing",
    derived: derived.outfits,
    errors,
    label: "outfit",
    normalized,
    path: "outfits",
  });
}

function normalizeEntityPropCards({
  characterIds,
  derived,
  errors,
  raw,
  shotIds,
}: {
  characterIds: ReadonlySet<StoryCharacterId>;
  derived: StoryEntityCards;
  errors: StoryPlanningError[];
  raw: unknown;
  shotIds: ReadonlySet<StoryShotId>;
}): StoryEntityCardProp[] {
  const rawCards = Array.isArray(raw) ? raw : null;
  if (!rawCards) {
    pushPlanningError(errors, createPlanningError({
      code: "entity_cards_props_missing",
      message: "Entity cards response is missing props; derived prop cards were used.",
      path: "props",
    }));
    return derived.props;
  }

  const derivedById = new Map(derived.props.map((prop) => [prop.id, prop]));
  const normalized = rawCards.flatMap((card, index) => {
    const rawCard = isRecord(card) ? card : {};
    const id = compactText(rawCard.id ?? rawCard.propId ?? rawCard.prop_id, 80);
    const fallback = derivedById.get(id);

    if (!fallback) {
      pushPlanningError(errors, createPlanningError({
        code: "entity_cards_prop_ref",
        message: `Entity prop card "${id || "(missing)"}" does not match Story Bible props.`,
        path: `props.${index}.id`,
        propIds: id ? [id] : undefined,
      }));
      return [];
    }
    const rawOwnerCharacterIds = rawCard.ownerCharacterIds ?? rawCard.owner_character_ids;

    return [{
      id: fallback.id,
      name: compactText(rawCard.name, 100) || fallback.name,
      description: displayText(rawCard.description ?? rawCard.summary) || fallback.description,
      continuityNotes: normalizeStringList(rawCard.continuityNotes ?? rawCard.continuity_notes, 12),
      ownerCharacterIds: rawOwnerCharacterIds === undefined
        ? fallback.ownerCharacterIds
        : filterKnownIds({
            code: "entity_cards_prop_owner_ref",
            errors,
            ids: normalizeStringList(rawOwnerCharacterIds, 12),
            knownIds: characterIds,
            label: `Entity prop card "${fallback.id}"`,
            path: `props.${index}.ownerCharacterIds`,
          }) as StoryCharacterId[],
      shotIds: normalizeEntityShotIds(rawCard.shotIds ?? rawCard.shot_ids, shotIds, fallback.shotIds, errors, `props.${index}.shotIds`),
      visualAnchors: normalizeStringList(rawCard.visualAnchors ?? rawCard.visual_anchors, 12),
    }];
  });

  return mergeDerivedEntityCards({
    code: "entity_cards_prop_missing",
    derived: derived.props,
    errors,
    label: "prop",
    normalized,
    path: "props",
  });
}

function normalizeEntityLocationCards({
  derived,
  errors,
  raw,
  shotIds,
}: {
  derived: StoryEntityCards;
  errors: StoryPlanningError[];
  raw: unknown;
  shotIds: ReadonlySet<StoryShotId>;
}): StoryEntityCardLocation[] {
  const rawCards = Array.isArray(raw) ? raw : null;
  if (!rawCards) {
    pushPlanningError(errors, createPlanningError({
      code: "entity_cards_locations_missing",
      message: "Entity cards response is missing locations; derived location cards were used.",
      path: "locations",
    }));
    return derived.locations;
  }

  const derivedById = new Map(derived.locations.map((location) => [location.id, location]));
  const normalized = rawCards.flatMap((card, index) => {
    const rawCard = isRecord(card) ? card : {};
    const id = compactText(rawCard.id ?? rawCard.locationId ?? rawCard.location_id, 80);
    const fallback = derivedById.get(id);
    const rawViewStates = Array.isArray(rawCard.viewStates)
      ? rawCard.viewStates
      : Array.isArray(rawCard.view_states)
        ? rawCard.view_states
        : null;

    if (!fallback) {
      pushPlanningError(errors, createPlanningError({
        code: "entity_cards_location_ref",
        locationIds: id ? [id] : undefined,
        message: `Entity location card "${id || "(missing)"}" does not match Story Bible locations.`,
        path: `locations.${index}.id`,
      }));
      return [];
    }

    return [{
      id: fallback.id,
      name: compactText(rawCard.name, 100) || fallback.name,
      description: displayText(rawCard.description ?? rawCard.summary) || fallback.description,
      shotIds: normalizeEntityShotIds(rawCard.shotIds ?? rawCard.shot_ids, shotIds, fallback.shotIds, errors, `locations.${index}.shotIds`),
      viewStates: rawViewStates
        ? rawViewStates
          .filter(isRecord)
          .map((viewState, viewIndex) => {
            const shotId = compactText(viewState.shotId ?? viewState.shot_id, 80);
            if (!shotIds.has(shotId)) {
              pushPlanningError(errors, createPlanningError({
                code: "entity_cards_location_view_shot_ref",
                message: `Entity location view state references unknown shot "${shotId || "(missing)"}".`,
                path: `locations.${index}.viewStates.${viewIndex}.shotId`,
                shotIds: shotId ? [shotId] : undefined,
              }));
              return null;
            }

            return {
              shotId,
              camera: displayText(viewState.camera) || fallback.viewStates.find((state) => state.shotId === shotId)?.camera || "",
              viewDescription: displayText(viewState.viewDescription ?? viewState.view_description ?? viewState.description) ||
                fallback.viewStates.find((state) => state.shotId === shotId)?.viewDescription ||
                fallback.description,
              visibleAnchors: normalizeStringList(viewState.visibleAnchors ?? viewState.visible_anchors, 12),
            };
          })
          .filter((viewState): viewState is StoryEntityCardLocation["viewStates"][number] => Boolean(viewState))
        : fallback.viewStates,
      visualAnchors: normalizeStringList(rawCard.visualAnchors ?? rawCard.visual_anchors, 12),
    }];
  });

  return mergeDerivedEntityCards({
    code: "entity_cards_location_missing",
    derived: derived.locations,
    errors,
    label: "location",
    normalized,
    path: "locations",
  });
}

export function normalizeStoryEntityCards({
  bible,
  continuityGraph,
  input,
  raw,
  shots,
}: {
  bible: StoryBible;
  continuityGraph: CharacterContinuityGraph;
  input: StoryInput;
  raw: unknown;
  shots: readonly StoryShot[];
}): StoryEntityCards {
  const parsed = typeof raw === "string" ? parseJsonObjectFromText(raw) : raw;
  if (!isRecord(parsed)) {
    throw malformedResponse("Entity-card response must be a JSON object.", { raw });
  }

  const errors: StoryPlanningError[] = [];
  const derived = createFallbackEntityCards({
    bible,
    continuityGraph,
    input,
    planningErrors: [
      ...(bible.planningErrors ?? []),
      ...shots.flatMap((shot) => shot.planningErrors ?? []),
    ],
    shots,
  });
  const shotIds = new Set(shots.map((shot) => shot.id));
  const characterIds = new Set(bible.characters.map((character) => character.id));
  const props = bible.props ?? [];
  const propIds = new Set(props.map((prop) => prop.id));
  const outfits = normalizeEntityOutfitCards({
    characterIds,
    derived,
    errors,
    raw: parsed.outfits,
    shotIds,
  });
  const outfitIds = new Set(outfits.map((outfit) => outfit.id));

  return {
    storyId: input.storyId,
    characters: normalizeEntityCharacterCards({
      derived,
      errors,
      outfitIds,
      propIds,
      raw: parsed.characters,
      shotIds,
    }),
    outfits,
    props: normalizeEntityPropCards({
      characterIds,
      derived,
      errors,
      raw: parsed.props,
      shotIds,
    }),
    locations: normalizeEntityLocationCards({
      derived,
      errors,
      raw: parsed.locations,
      shotIds,
    }),
    planningErrors: [...derived.planningErrors, ...errors, ...normalizeStringList(parsed.planningErrors ?? parsed.planning_errors, maxWarnings).map((message, index) =>
      createPlanningError({
        code: `entity_cards_llm_warning_${index + 1}`,
        message,
        path: "planningErrors",
      }),
    )],
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

function getStoryPromptProfile(input: StoryInput): PromptProfileId {
  const snapshot = isRecord(input.settingsSnapshot) ? input.settingsSnapshot : {};

  return normalizePromptProfileId(snapshot.promptProfile);
}

function buildStoryResourceDesiredEffect({
  bible,
  input,
  shots,
}: {
  bible: StoryBible;
  input: StoryInput;
  shots: readonly StoryShot[];
}) {
  const promptProfile = getStoryPromptProfile(input);
  const characterText = bible.characters
    .map((character) =>
      [
        character.name,
        character.role,
        character.description,
        ...character.visualAnchors,
      ].filter(Boolean).join(", "),
    )
    .join("\n");
  const locationText = bible.locations
    .map((location) =>
      [
        location.name,
        location.description,
        ...location.visualAnchors,
      ].filter(Boolean).join(", "),
    )
    .join("\n");
  const propText = (bible.props ?? [])
    .map((prop) =>
      [
        prop.name,
        prop.description,
        ...prop.visualAnchors,
      ].filter(Boolean).join(", "),
    )
    .join("\n");
  const shotText = shots
    .map((shot) =>
      [
        `Shot ${shot.order}: ${shot.title}`,
        shot.description,
        shot.promptIntent,
        shot.camera ? `Camera: ${shot.camera}` : "",
        shot.continuityNotes.length > 0 ? `Continuity: ${shot.continuityNotes.join(", ")}` : "",
      ].filter(Boolean).join(". "),
    )
    .join("\n");

  return compactText([
    `Prompt profile: ${formatPromptProfileLabel(promptProfile)} (${promptProfile})`,
    input.rawIntent,
    input.storyContext,
    bible.logline,
    bible.visualStyle,
    bible.worldSummary,
    bible.genre.length > 0 ? `Genre: ${bible.genre.join(", ")}` : "",
    bible.themes.length > 0 ? `Themes: ${bible.themes.join(", ")}` : "",
    characterText ? `Characters:\n${characterText}` : "",
    locationText ? `Locations:\n${locationText}` : "",
    propText ? `Props:\n${propText}` : "",
    shotText ? `Storyboard shots:\n${shotText}` : "",
  ].filter(Boolean).join("\n"), 6000);
}

async function resolveStoryResourceCandidates({
  context,
  input,
  loadResourceCandidates,
  resourceCandidates,
}: {
  context: StoryNodeExecutionContext;
  input: StoryInput;
  loadResourceCandidates?: StoryLlmNodeAdapterOptions["loadResourceCandidates"];
  resourceCandidates?: StoryLlmNodeAdapterOptions["resourceCandidates"];
}): Promise<{
  candidates: StoryResourceCandidateSet;
  desiredEffect: string;
  promptProfile: PromptProfileId;
}> {
  const promptProfile = getStoryPromptProfile(input);
  const stylePalette = getStoryStylePalette(input);
  const desiredEffect = buildStoryResourceDesiredEffect({
    bible: getBible(context.workflow),
    input,
    shots: getShots(context.workflow),
  });

  if (resourceCandidates) {
    return {
      candidates: getSettingsResourceCandidates(input, resourceCandidates),
      desiredEffect,
      promptProfile,
    };
  }

  if (loadResourceCandidates) {
    const loaded = await loadResourceCandidates({
      desiredEffect,
      promptProfile,
      selectedCheckpointId: stylePalette?.checkpointId,
      selectedLoraIds: getEnabledStoryStyleLoras(stylePalette).map((lora) => lora.id),
    }, context);

    return {
      candidates: {
        checkpoints: loaded.checkpoints.filter(isRecord).map((resource) => resource as StoryLocalResource),
        loras: loaded.loras.filter(isRecord).map((resource) => resource as StoryLocalResource),
      },
      desiredEffect,
      promptProfile,
    };
  }

  return {
    candidates: getSettingsResourceCandidates(input),
    desiredEffect,
    promptProfile,
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
        reason: displayText(isRecord(lora) ? lora.reason : undefined) || "Selected from local Story Graph candidates.",
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
        reason: displayText(isRecord(parsed.checkpoint) ? parsed.checkpoint.reason : undefined) ||
          "Selected from local Story Graph candidates.",
      },
      loras: selectedLoras,
      recommendationReason: displayText(parsed.recommendationReason ?? parsed.recommendation_reason) ||
        "Selected Story Graph resources from real local candidates.",
      overallEffect: displayText(parsed.overallEffect ?? parsed.overall_effect) ||
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
        reason: displayText(override.reason),
      }))
      .filter((override) => shotIds.has(override.shotId)),
    warnings: normalizeStringList(parsed.warnings, maxWarnings),
    samplerOptions,
  });
}

function getStoryStylePalette(input: StoryInput): StoryStylePaletteSnapshot | undefined {
  const settingsSnapshot = input.settingsSnapshot;

  if (!isRecord(settingsSnapshot)) {
    return undefined;
  }

  return sanitizeStoryStylePaletteSnapshot(settingsSnapshot.stylePalette);
}

function getEnabledStoryStyleLoras(stylePalette: StoryStylePaletteSnapshot | undefined) {
  return stylePalette?.loras.filter((lora) => lora.enabled) ?? [];
}

function getStoryResourceBaseModel(resource: StoryLocalResource) {
  return compactText(resource.modelBaseModel ?? resource.baseModel, 120).toLocaleLowerCase();
}

function isStoryStyleLoraCompatibleWithCheckpoint(
  lora: StoryLocalResource,
  checkpoint: StoryLocalResource,
) {
  const checkpointBaseModel = getStoryResourceBaseModel(checkpoint);
  const loraBaseModel = getStoryResourceBaseModel(lora);

  return !checkpointBaseModel || !loraBaseModel || checkpointBaseModel === loraBaseModel;
}

function findStoryResourceById(candidates: StoryLocalResource[], id: string) {
  return candidates.find((candidate) => candidate.id === id) ?? null;
}

function getManualLoraSuggestedWeight(
  loraSnapshot: StoryStylePaletteLoraSnapshot,
  resource: StoryLocalResource,
) {
  if (Number.isFinite(loraSnapshot.strengthModel)) {
    return Number(loraSnapshot.strengthModel);
  }

  if (resource.averageWeight !== null && resource.averageWeight !== undefined) {
    return resource.averageWeight;
  }

  return null;
}

function applyStoryStyleLoraWeights(
  resource: StoryLocalResource,
  loraSnapshot: StoryStylePaletteLoraSnapshot,
): StoryLocalResource {
  return {
    ...resource,
    ...(loraSnapshot.strengthModel !== undefined ? { storyInputStrengthModel: loraSnapshot.strengthModel } : {}),
    ...(loraSnapshot.strengthClip !== undefined ? { storyInputStrengthClip: loraSnapshot.strengthClip } : {}),
  };
}

function createManualStoryResourcePlanFromStylePalette({
  candidates,
  input,
  stylePalette,
}: {
  candidates: StoryResourceCandidateSet;
  input: StoryInput;
  stylePalette: StoryStylePaletteSnapshot | undefined;
}): StoryResourcePlan | null {
  if (!stylePalette?.checkpointId) {
    return null;
  }

  const checkpoint = findStoryResourceById(candidates.checkpoints, stylePalette.checkpointId);
  if (!checkpoint) {
    invalidResourceSelection("Selected Story checkpoint is missing, unavailable, or not a local checkpoint.", {
      checkpointId: stylePalette.checkpointId,
    });
  }

  const enabledStyleLoras = getEnabledStoryStyleLoras(stylePalette);
  const weightedLoraById = new Map(
    enabledStyleLoras.map((loraSnapshot) => [loraSnapshot.id, loraSnapshot]),
  );
  const candidateLoras = candidates.loras.map((resource) => {
    const snapshot = weightedLoraById.get(resource.id);

    return snapshot ? applyStoryStyleLoraWeights(resource, snapshot) : resource;
  });
  const selectedLoras = enabledStyleLoras.map((loraSnapshot) => {
    const lora = findStoryResourceById(candidates.loras, loraSnapshot.id);
    if (!lora) {
      invalidResourceSelection("Selected Story LoRA is missing, unavailable, or not a local LoRA.", {
        loraId: loraSnapshot.id,
        checkpointId: checkpoint.id,
      });
    }

    if (!isStoryStyleLoraCompatibleWithCheckpoint(lora, checkpoint)) {
      invalidResourceSelection("Selected Story LoRA is incompatible with the selected checkpoint base model.", {
        loraId: lora.id,
        loraBaseModel: lora.modelBaseModel ?? lora.baseModel ?? null,
        checkpointId: checkpoint.id,
        checkpointBaseModel: checkpoint.modelBaseModel ?? checkpoint.baseModel ?? null,
      });
    }
    const weightedLora = applyStoryStyleLoraWeights(lora, loraSnapshot);

    return {
      resource: weightedLora,
      suggestedWeight: getManualLoraSuggestedWeight(loraSnapshot, weightedLora),
      reason: loraSnapshot.strengthModel !== undefined
        ? "Selected from Story input style resources with the saved model weight."
        : "Selected from Story input style resources.",
    };
  });

  return createStoryResourcePlan({
    storyId: input.storyId,
    candidates: {
      checkpoints: candidates.checkpoints.map((resource) => ({ resource })),
      loras: candidateLoras.map((resource) => ({ resource })),
    },
    recommendation: {
      checkpoint: {
        resource: checkpoint,
        reason: "Selected from Story input style resources.",
      },
      loras: selectedLoras,
      recommendationReason: "Use the checkpoint and enabled LoRAs saved in the Story input style palette.",
      overallEffect: "User-selected Story input style resources.",
      warnings: [],
    },
  });
}

function createManualStoryParameterPlanFromStylePalette({
  input,
  samplerOptions,
  stylePalette,
}: {
  input: StoryInput;
  samplerOptions?: TimelineSamplerOptions;
  stylePalette: StoryStylePaletteSnapshot | undefined;
}): StoryParameterPlan | null {
  if (!stylePalette?.parameters) {
    return null;
  }

  return createStoryParameterPlan({
    storyId: input.storyId,
    defaults: stylePalette.parameters,
    samplerOptions,
    warnings: ["Using generation parameters saved in the Story input style palette."],
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
        const rawLocationContinuity = rawShot.locationContinuity ?? rawShot.location_continuity;
        const rawReferenceRecipe = rawShot.referenceRecipe ?? rawShot.reference_recipe;
        const sourceShotIndex = sourceShot ? shots.findIndex((candidate) => candidate.id === sourceShot.id) : index;
        const locationContinuity = rawLocationContinuity === undefined
          ? undefined
          : normalizeStoryRenderLocationContinuity(rawLocationContinuity, {
              eligibleSourceShotIds: new Set(shots.slice(0, Math.max(0, sourceShotIndex)).map((candidate) => candidate.id)),
              fallbackSourceShotIds: sourceShot?.sourceShotIds ?? [],
              knownShotIds: shotIds,
              targetShotId: shotId,
              warnings,
            });
        const referenceRecipe = rawReferenceRecipe === undefined
          ? undefined
          : normalizeStoryRenderReferenceRecipe(rawReferenceRecipe);

        if (sourceShot && !hasStoryAnimaPromptPartsContent(animaPromptParts)) {
          animaPromptParts = createFallbackStoryRenderPromptParts(sourceShot);
          warnings.push("LLM returned empty animaPromptParts; used storyboard prompt fallback.");
        }

        return {
          shotId,
          animaPromptParts,
          ...(locationContinuity ? { locationContinuity } : {}),
          ...(referenceRecipe ? { referenceRecipe } : {}),
          rationale: displayText(rawShot.rationale ?? rawShot.reason) || undefined,
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

function getOptionalStoryReferenceAssetPlanForRender(workflow: StoryWorkflowState): StoryReferenceAssetPlan | undefined {
  const result = workflow.nodes["reference-asset-plan"]?.result;
  if (result !== undefined) {
    return result as StoryReferenceAssetPlan;
  }

  const entityCards = getOptionalEntityCards(workflow);
  return entityCards
    ? deriveStoryReferenceAssetPlan({
        entityCards,
        shots: getShots(workflow),
        storyId: getStoryInput(workflow).storyId,
      })
    : undefined;
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
    referenceAssetPlan: getOptionalStoryReferenceAssetPlanForRender(workflow),
    resourcePlan: getResourcePlan(workflow),
    samplerOptions,
    safetyPlan: getSafetyPlan(workflow),
    shots,
  });
}

function getOptionalEntityCards(workflow: StoryWorkflowState): StoryEntityCards | null {
  const result = workflow.nodes["entity-cards"]?.result;
  return isRecord(result) &&
    Array.isArray(result.characters) &&
    Array.isArray(result.outfits) &&
    Array.isArray(result.props) &&
    Array.isArray(result.locations)
    ? result as StoryEntityCards
    : null;
}

export function getStoryReferenceAssetPlanFromWorkflow(workflow: StoryWorkflowState): StoryReferenceAssetPlan {
  const result = workflow.nodes["reference-asset-plan"]?.result;
  if (result !== undefined) {
    return result as StoryReferenceAssetPlan;
  }

  const entityCards = getOptionalEntityCards(workflow);
  if (!entityCards) {
    return getNodeResult<StoryReferenceAssetPlan>(workflow, "reference-asset-plan");
  }

  return deriveStoryReferenceAssetPlan({
    entityCards,
    shots: getShots(workflow),
    storyId: getStoryInput(workflow).storyId,
  });
}

function getPlanningErrorIssues({
  bible,
  entityCards,
  shots,
}: {
  bible: StoryBible;
  entityCards: StoryEntityCards | null;
  shots: readonly StoryShot[];
}): StoryConsistencyIssue[] {
  const planningErrors = [
    ...(bible.planningErrors ?? []),
    ...shots.flatMap((shot) => shot.planningErrors ?? []),
    ...(entityCards?.planningErrors ?? []),
  ];
  const seen = new Set<string>();

  return planningErrors
    .filter((error) => {
      const key = JSON.stringify([error.code, error.message, error.path, error.shotIds ?? []]);
      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    })
    .map((error) => ({
      code: error.code,
      message: error.message,
      severity: error.severity,
      shotIds: error.shotIds ?? [],
      ...(error.characterIds ? { characterIds: error.characterIds } : {}),
    }));
}

export function createStoryConsistencyCheckFromWorkflow(
  workflow: StoryWorkflowState,
  now: () => string,
  extraWarnings: string[] = [],
  samplerOptions?: TimelineSamplerOptions,
): StoryConsistencyCheck {
  const input = getStoryInput(workflow);
  const bible = getBible(workflow);
  const rawShots = getShots(workflow);
  const graph = getDependencyGraph(workflow);
  const shots = syncStoryShotsWithDependencyGraph(rawShots, graph, {
    allowHighRiskSourceEdges: shouldAllowHighRiskSourceEdges(workflow),
  });
  const safetyPlan = getSafetyPlan(workflow);
  const entityCards = getOptionalEntityCards(workflow);
  const resourcePlan = getResourcePlan(workflow);
  const renderPlan = getStoryRenderPlanFromWorkflow(workflow, samplerOptions);
  const shotIds = new Set(shots.map((shot) => shot.id));
  const issues: StoryConsistencyIssue[] = validateShotDependencyGraph(graph, shots).map((issue) => ({
    code: issue.nodeId ? `node-${issue.nodeId}` : "shot-dependency",
    message: issue.message,
    severity: "error",
    shotIds: issue.shotId ? [issue.shotId] : [],
  }));
  issues.push(...getPlanningErrorIssues({ bible, entityCards, shots }));

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
    const eligibleSourceShotIds = getStoryRenderPlanEligibleSourceShotIds(renderPlan.shots, shot.shotId);
    const requestedSourceShotIds = getStoryRenderPlanShotRequestedSourceShotIds(shot);
    const executableSourceShotIds = getStoryRenderPlanShotSourceShotIds(shot, eligibleSourceShotIds);
    if (!shotIds.has(shot.shotId)) {
      issues.push({
        code: "render-shot-ref",
        message: `Render plan references unknown shot "${shot.shotId}".`,
        severity: "error",
        shotIds: [shot.shotId],
      });
    }

    for (const sourceShotId of requestedSourceShotIds) {
      if (!shotIds.has(sourceShotId)) {
        issues.push({
          code: "render-source-ref",
          message: `Render plan source-image continuity for "${shot.shotId}" references unknown source shot "${sourceShotId}".`,
          severity: "error",
          shotIds: [shot.shotId],
        });
      } else if (sourceShotId === shot.shotId) {
        issues.push({
          code: "render-source-self",
          message: `Render plan source-image continuity for "${shot.shotId}" cannot reference the target shot itself.`,
          severity: "error",
          shotIds: [shot.shotId],
        });
      } else if (!eligibleSourceShotIds.has(sourceShotId)) {
        issues.push({
          code: "render-source-order",
          message: `Render plan source-image continuity for "${shot.shotId}" must reference an earlier render-plan shot, not "${sourceShotId}".`,
          severity: "error",
          shotIds: [shot.shotId],
        });
      }
    }

    if (shot.locationContinuity?.mode === "source-image" && executableSourceShotIds.length === 0) {
      issues.push({
        code: "render-source-empty",
        message: `Render plan source-image continuity for "${shot.shotId}" does not include a source shot.`,
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
    passed: !issues.some((issue) => issue.severity === "error"),
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
  const referenceAssetPlan = getStoryReferenceAssetPlanFromWorkflow(workflow);
  const assetFreezeGate = evaluateStoryReferenceAssetFreezeGate(referenceAssetPlan);
  const executable = isStoryResourcePlanExecutable(resourcePlan);
  const ready = consistency.passed && executable && assetFreezeGate.ready;

  return {
    storyId: renderPlan.storyId,
    ready,
    executionAvailable: ready,
    assetFreezeGate,
    blockingReason: ready
      ? "Confirm generation to start shot graph execution."
      : assetFreezeGate.blockingReferences[0]?.reason ||
        (!executable ? "Story resource plan does not contain an executable local checkpoint." : undefined) ||
        consistency.issues.find((issue) => issue.severity === "error")?.message ||
        "Resolve required Story reference assets before generation.",
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

function getConfiguredStoryNsfwModel() {
  return process.env.LITELLM_NSFW_MODEL?.trim() || undefined;
}

function applyStoryNsfwModelOverride(
  request: LlmChatRequest,
  nodeId: StoryWorkflowNodeId,
): LlmChatRequest {
  const nsfwModel = getConfiguredStoryNsfwModel();

  if (request.nsfw !== true || !nsfwModel || storyNsfwModelExcludedNodeIds.has(nodeId)) {
    return request;
  }

  return {
    ...request,
    model: nsfwModel,
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
      const response = await completeChat(applyStoryNsfwModelOverride(buildRequest(context), context.nodeId));

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

function buildResourceCandidatePayload(candidates: StoryResourceCandidateSet) {
  const serializeCandidate = (resource: StoryLocalResource, index: number) => ({
    id: resource.id,
    recommendationRank: resource.recommendationRank ?? index + 1,
    recommendationScore: resource.recommendationScore,
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
    importedImageCount: resource.importedImageCount,
    commonCheckpoints: resource.commonCheckpoints,
    commonLoras: resource.commonLoras,
  });

  return {
    checkpoints: candidates.checkpoints.map(serializeCandidate),
    loras: candidates.loras.map(serializeCandidate),
  };
}

export function createStoryLlmNodeAdapters({
  completeChat,
  loadResourceCandidates,
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
          'Create a typed StoryBible with concrete visual anchors. Treat storySegments as the visual sequence and storyContext as global continuity, not as an extra shot. Create characters only for people or creatures explicitly present in the user story or storySegments; do not invent visible supporting people from implied locations or occupations. Character descriptions must include visible role/age range, silhouette, clothing, key prop, and emotional baseline when inferable. Create props only for recurring or continuity-critical visible objects explicitly present in the story. Location descriptions must include visible set pieces, materials, color accents, and recurring background anchors. visualStyle must describe renderable camera/lighting/color style, not abstract theme. Required shape: {"title":"","logline":"","genre":[""],"themes":[""],"worldSummary":"","visualStyle":"","characters":[{"id":"","name":"","role":"","description":"","continuityNotes":[""],"visualAnchors":[""]}],"locations":[{"id":"","name":"","description":"","visualAnchors":[""]}],"props":[{"id":"","name":"","description":"","ownerCharacterIds":[""],"continuityNotes":[""],"visualAnchors":[""]}],"continuityRules":[""]}.',
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
          'Create typed storyboard shots with stable ids, order, camera, promptIntent, continuityNotes, characterIds, locationId, sourceShotIds, appearanceState, interactionState, and locationViewState. Use only supplied Story Bible character, prop, and location ids. Create exactly one storyboard shot per supplied outline beat unless input.targetShotCount is set and a target-count adjustment is necessary. If input.targetShotCount is unset, follow the StoryOutline beat count chosen by the LLM; local code has not parsed labels, counted events, or estimated a target. Preserve explicit rawIntent labels such as "Beat 1:" or "Final image:" through shot titles and shot content when they map to outline beats. Do not add filler shots or a separate context/setup shot. Each promptIntent must be an image-generation-ready visual brief with short comma-separated tag phrases: visible character identities/appearance, the same wardrobe and key prop continuity, one clear action, location/obstacle, composition, lighting, and visible emotional state. Visible subjects must match current segment explicitly named characters: do not invent extra visible people from a location or job role, and do not remove explicitly requested people. Partial/background interactions are acceptable when the segment explicitly requests them. Do not use abstract summaries, meta planning instructions, dangling clauses, or purely atmospheric prose. sourceShotIds must be empty unless this shot truly needs a previous generated image as an img2img/reference source; ordinary story order and continuity do not need sourceShotIds. Keep sourceShotIds empty for high-risk source-image transitions such as standing to kneeling, sitting to running, close-up to wide shot, major composition reset, camera reset, or large scene reset. Required shape: {"shots":[{"id":"shot-1","order":1,"title":"","description":"","beatId":"","locationId":"","characterIds":[""],"sourceShotIds":[""],"camera":"","promptIntent":"","continuityNotes":[""],"appearanceState":{"characterStates":[{"characterId":"","outfitId":"","appearance":"","visible":true,"continuityNotes":[""]}],"propIds":[""],"notes":[""]},"interactionState":{"characterIds":[""],"propIds":[""],"description":"","physicalContact":[""],"continuityNotes":[""]},"locationViewState":{"locationId":"","viewDescription":"","visibleAnchors":[""],"camera":""}}]}.',
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
  const entityCards = createLlmStoryNodeAdapter<StoryEntityCards>({
    buildRequest: (context) => {
      const input = getStoryInput(context.workflow);
      return makeJsonRequest({
        input,
        instruction:
          'Create typed Story entity cards derived only from the supplied Story Bible, storyboard shots, and CharacterContinuityGraph. Use Story Bible character, prop, and location ids exactly. Outfits may define stable outfit ids tied to one character. Set outfit storyCritical true only when the supplied story data explicitly makes that wardrobe story-critical, plot-essential, or a required continuity marker; omit or false otherwise. Do not plan reference assets, freeze gates, uploads, image generation, IPAdapter, ControlNet, masks, or execution behavior. Missing or uncertain details should stay in planningErrors, not invented ids. Required shape: {"characters":[{"id":"","name":"","role":"","description":"","visualAnchors":[""],"continuityNotes":[""],"shotIds":[""],"outfitIds":[""],"propIds":[""]}],"outfits":[{"id":"","characterId":"","name":"","description":"","storyCritical":false,"visualAnchors":[""],"continuityNotes":[""],"shotIds":[""]}],"props":[{"id":"","name":"","description":"","visualAnchors":[""],"continuityNotes":[""],"ownerCharacterIds":[""],"shotIds":[""]}],"locations":[{"id":"","name":"","description":"","visualAnchors":[""],"shotIds":[""],"viewStates":[{"shotId":"","viewDescription":"","visibleAnchors":[""],"camera":""}]}],"planningErrors":[""]}.',
        payload: {
          input,
          bible: getBible(context.workflow),
          characterContinuityGraph: getContinuityGraph(context.workflow),
          shots: getShots(context.workflow),
        },
        maxTokens: 1800,
      });
    },
    parseResponse: (response, context) => normalizeStoryEntityCards({
      bible: getBible(context.workflow),
      continuityGraph: getContinuityGraph(context.workflow),
      input: getStoryInput(context.workflow),
      raw: response.content,
      shots: getShots(context.workflow),
    }),
  })(completeChat);
  const referenceAssetPlan: StoryNodeAdapter<StoryReferenceAssetPlan> = (context) => ({
    value: deriveStoryReferenceAssetPlan({
      entityCards: getNodeResult<StoryEntityCards>(context.workflow, "entity-cards"),
      shots: getShots(context.workflow),
      storyId: getStoryInput(context.workflow).storyId,
    }),
    source: "system",
  });
  const resourcePlan: StoryNodeAdapter<StoryResourcePlan> = async (context) => {
    try {
      const input = getStoryInput(context.workflow);
      const {
        candidates,
        desiredEffect,
        promptProfile,
      } = await resolveStoryResourceCandidates({
        context,
        input,
        loadResourceCandidates,
        resourceCandidates,
      });

      if (candidates.checkpoints.length === 0) {
        invalidResourceSelection(
          `No ranked local ${formatPromptProfileLabel(promptProfile)} checkpoint candidates are available. Import or configure matching Civitai checkpoints first.`,
        );
      }

      const manualResourcePlan = createManualStoryResourcePlanFromStylePalette({
        candidates,
        input,
        stylePalette: getStoryStylePalette(input),
      });
      if (manualResourcePlan) {
        return {
          value: manualResourcePlan,
          source: "manual",
        };
      }

      const response = await completeChat(makeJsonRequest({
        input,
        instruction:
          'Choose resources only from the supplied checkpoint and LoRA candidate ids. Do not invent ids. Candidates are ordered by BM25/embedding recommendation rank when recommendationRank and recommendationScore are present; treat higher-ranked candidates as stronger evidence, but still use metadata and story context to choose the best compatible combination. Use checkpoint and LoRA names, descriptions, tags, categories, trainedWords, usageGuide, observed weight ranges, common pairings, and parameter recommendations to choose LoRA suggestedWeight values and explain tradeoffs. Do not apply generic local caps by style, lighting, or resource type; if metadata conflicts, choose a finite sane weight from the selected resource evidence and explain it in reason or warnings. Required shape: {"checkpoint":{"resource":{"id":""},"reason":""},"loras":[{"resource":{"id":""},"suggestedWeight":0.7,"reason":""}],"recommendationReason":"","overallEffect":"","warnings":[""]}.',
        payload: {
          input,
          desiredEffect,
          promptProfile,
          safetyPlan: getSafetyPlan(context.workflow),
          shots: getShots(context.workflow),
          candidates: buildResourceCandidatePayload(candidates),
        },
        maxTokens: 900,
      }));

      if (!isLlmChatResponse(response) || response.content.trim().length === 0) {
        throw malformedResponse("LLM response did not include usable text content.", { response });
      }

      return {
        value: normalizeStoryResourcePlan(response.content, input, candidates),
        source: "ai",
      };
    } catch (error) {
      throw new TimelineNodeExecutionError(normalizeLlmAdapterError(error));
    }
  };
  const aiParameterPlan = createLlmStoryNodeAdapter<StoryParameterPlan>({
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
  const parameterPlan: StoryNodeAdapter<StoryParameterPlan> = async (context) => {
    const input = getStoryInput(context.workflow);
    const manualParameterPlan = createManualStoryParameterPlanFromStylePalette({
      input,
      samplerOptions,
      stylePalette: getStoryStylePalette(input),
    });

    if (manualParameterPlan) {
      return {
        value: manualParameterPlan,
        source: "manual",
      };
    }

    return aiParameterPlan(context);
  };
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
          "Use supplied entityCards as structured continuity context for characters, outfits, props, and locations; do not invent new entity ids or plan reference assets.",
          "Use supplied referenceAssetPlan only to describe per-shot reference-use intent in referenceRecipe. Do not add reference relationships to the dependency graph and do not request final reference injection.",
          'Each shot must include referenceRecipe with a concise summary plus referenceIds, approvedReferenceIds, promptOnlyReferenceIds, unresolvedReferenceIds, and notes explaining how planned references should guide prompt review.',
          'Each shot must include locationContinuity.mode as exactly "prompt-only", "source-image", or "inpaint-preferred". Use "source-image" only when this render plan should pass listed sourceShotIds into img2img execution. Use "prompt-only" when location continuity should stay in prompt text. Use "inpaint-preferred" only as advisory future intent; v1 will not create masks, repair, inpaint, or fallback image-edit requests.',
          "Choose location continuity from structured shot/source/dependency fields, not from prompt wording. Do not rely on words inside final prompt text to trigger source images.",
          "For prompt-only and inpaint-preferred continuity, locationContinuity.sourceShotIds must be empty. For source-image continuity, sourceShotIds must list valid earlier shot ids.",
          "For multi-character shots, each visible person must get a distinct clause with hairstyle, clothing, pose/action, spatial position, and adult or college-age presentation when applicable; do not collapse them into \"two young women\" or another generic group tag.",
          "For subjectTags use conservative tags like \"1girl\", \"solo\", \"2people\", or \"3people\"; only use \"3girls\" when every visible person is clearly a girl/woman.",
          "Use seriesTags only for known source/copyright tags when there is a real selected source; leave seriesTags empty for original stories. Use artistTags only for known artist tags and prefix each item with @; leave artistTags empty when no artist tag is selected.",
          "For selected style LoRAs, translate their usage guide into short visual style terms only, such as \"teal theme\", \"orange theme\", \"dusk glow\", or \"soft rim light\".",
          "Negative additions must be visual quality/exclusion terms only, must not replace safety negatives, and must not negate positive key characters, actions, props, clothing, or environments; for example, do not add \"sketch page\" or \"drawings\" when the shot requires a sketchbook or visible sketch pages.",
          'Required shape: {"shots":[{"shotId":"","animaPromptParts":{"subjectTags":[""],"characterTags":[""],"seriesTags":[""],"artistTags":[""],"outfitTags":[""],"propTags":[""],"actionTags":[""],"settingTags":[""],"cameraTags":[""],"lightingTags":[""],"styleTags":[""],"singleFrameCaption":"","negativeAdditions":[""]},"referenceRecipe":{"summary":"","referenceIds":[""],"approvedReferenceIds":[""],"promptOnlyReferenceIds":[""],"unresolvedReferenceIds":[""],"notes":[""]},"locationContinuity":{"mode":"prompt-only|source-image|inpaint-preferred","sourceShotIds":[""],"reason":"","notes":[""]},"rationale":"","warnings":[""]}],"warnings":[""]}.',
        ].join(" "),
        payload: {
          input,
          bible: getBible(context.workflow),
          characterContinuityGraph: getContinuityGraph(context.workflow),
          dependencyGraph: getDependencyGraph(context.workflow),
          entityCards: getOptionalEntityCards(context.workflow),
          parameterPlan: getParameterPlan(context.workflow),
          referenceAssetPlan: getOptionalStoryReferenceAssetPlanForRender(context.workflow),
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
        referenceAssetPlan: getOptionalStoryReferenceAssetPlanForRender(context.workflow),
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
    "entity-cards": entityCards,
    "reference-asset-plan": referenceAssetPlan,
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
