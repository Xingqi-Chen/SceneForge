import type { LlmChatRequest, LlmChatResponse } from "@/features/llm";
import { createDefaultStickFigurePoseV1, defaultCharacter } from "@/features/editor/store/defaults";
import {
  buildStickFigurePoseGenerationMessages,
  parseStickFigurePoseGenerationResponse,
} from "@/features/editor/stick-figure-3d/llm-pose-generation";
import {
  buildAnimaAiResponseInstructions,
  parseAnimaPromptSectionsFromResponse,
  type AnimaPromptSections,
} from "@/features/editor/ai-prompt/anima-prompt";
import {
  buildIllustriousAiResponseInstructions,
  parseIllustriousPromptSectionsFromResponse,
  type IllustriousPromptSections,
} from "@/features/editor/ai-prompt/illustrious-prompt";
import {
  buildCharacterTextPromptTagMessages,
  isCharacterBodyPromptTagCategory,
  parseCharacterImagePromptTagsContent,
  type CharacterImagePromptTagItem,
} from "@/features/prompt-engine/prompt-library/character-image-prompt-tags";
import type { PromptTagCategory, SceneObject3DTransform } from "@/shared/types";
import type { StickFigurePoseV1 } from "@/shared/types/stick-figure-pose";
import { formatPromptProfileLabel, normalizePromptProfileId, type PromptProfileId } from "@/shared/prompt-profile";

import { createLlmTimelineNodeAdapter, type TimelineCompleteChat } from "./llm-adapter";
import { createTimelineNodeError } from "./state";
import {
  TimelineNodeExecutionError,
  type CanvasBindingTimelineResult,
  type CharacterActionTimelineResult,
  type CharacterPromptTag,
  type CharacterTagsTimelineResult,
  type SceneInputTimelineResult,
  type ScenePromptTimelineResult,
  type TimelineNodeAdapters,
  type TimelineNodeExecutionContext,
  type TimelinePromptFragment,
} from "./types";

const defaultCanvasTransform: SceneObject3DTransform = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
};

export type TimelineCanvasBindingInput = {
  primaryCharacter: {
    name: string;
    description: string;
  };
  characterTags: CharacterPromptTag[];
  action: string;
  pose: StickFigurePoseV1;
  transform: SceneObject3DTransform;
  spatialSummary: string;
};

export type TimelineCanvasBinder = (
  input: TimelineCanvasBindingInput,
  context: TimelineNodeExecutionContext,
) => CanvasBindingTimelineResult | Promise<CanvasBindingTimelineResult>;

export type TimelineT5NodeAdapterOptions = {
  completeChat: TimelineCompleteChat;
  bindCanvas?: TimelineCanvasBinder;
  getCurrentPose?: () => StickFigurePoseV1;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compactText(value: unknown, maxLength = 1200) {
  void maxLength;
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").trim();
}

function parseJsonObjectFromText(text: string): unknown | null {
  const trimmed = text.trim();
  const candidates = [
    trimmed,
    ...Array.from(trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi), (match) => match[1]?.trim() ?? ""),
  ];
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");

  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next likely JSON span.
    }
  }

  return null;
}

function malformedResponse(message: string, details?: unknown): never {
  throw new TimelineNodeExecutionError(
    createTimelineNodeError("llm_malformed_response", message, details),
  );
}

function invalidTimelineInput(message: string, details?: unknown): never {
  throw new TimelineNodeExecutionError(
    createTimelineNodeError("timeline_node_failed", message, details),
  );
}

function normalizeStringList(value: unknown, maxItems = 8) {
  void maxItems;
  if (Array.isArray(value)) {
    return value.map((item) => compactText(item, 300)).filter(Boolean);
  }

  const text = compactText(value, 600);
  return text ? [text] : [];
}

function normalizePromptFragments(value: unknown, maxItems = 5): TimelinePromptFragment[] {
  void maxItems;
  if (typeof value === "string") {
    const prompt = compactText(value, 500);
    return prompt ? [{ label: prompt, prompt }] : [];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item): TimelinePromptFragment | null => {
      if (typeof item === "string") {
        const prompt = compactText(item, 500);
        return prompt ? { label: prompt, prompt } : null;
      }

      if (!isRecord(item)) {
        return null;
      }

      const prompt = compactText(item.prompt ?? item.text, 500);
      if (!prompt) {
        return null;
      }

      const label = compactText(item.label, 80) || prompt;
      return { label, prompt };
    })
    .filter((item): item is TimelinePromptFragment => Boolean(item));
}

function normalizeProfileSections<SectionMap>(
  value: unknown,
  parser: (rawContent: string) => SectionMap | null,
) {
  if (typeof value === "string") {
    return parser(value) ?? undefined;
  }

  if (isRecord(value)) {
    const parsed = parser(JSON.stringify(value));
    return parsed ?? undefined;
  }

  return undefined;
}

export function normalizeScenePromptTimelineResult(
  raw: unknown,
  fallbackPromptProfile?: PromptProfileId,
): ScenePromptTimelineResult {
  const parsed = typeof raw === "string" ? parseJsonObjectFromText(raw) : raw;

  if (!isRecord(parsed)) {
    malformedResponse("Scene prompt response must be a JSON object.", { raw });
  }

  const positivePrompt = compactText(
    parsed.positivePrompt ?? parsed.positive_prompt ?? parsed.prompt,
    2000,
  );

  if (!positivePrompt) {
    malformedResponse("Scene prompt response must include positivePrompt.", { raw });
  }

  const primaryRaw = isRecord(parsed.primaryCharacter)
    ? parsed.primaryCharacter
    : isRecord(parsed.primary_character)
      ? parsed.primary_character
      : {};
  const primaryName = compactText(primaryRaw.name, 80) || "Primary character";
  const primaryIdentity = compactText(
    primaryRaw.identity ?? primaryRaw.description ?? parsed.primaryCharacterDescription,
    800,
  );
  const sceneIntent = compactText(parsed.sceneIntent ?? parsed.scene_intent ?? parsed.globalSceneIntent, 800);
  const styleTone = compactText(parsed.styleTone ?? parsed.style_tone ?? parsed.tone, 400);
  const setting = compactText(parsed.setting ?? parsed.location, 400);
  const promptProfile = normalizePromptProfileId(parsed.promptProfile ?? parsed.prompt_profile ?? fallbackPromptProfile);
  const illustriousSections = normalizeProfileSections<IllustriousPromptSections>(
    parsed.illustriousSections ?? parsed.illustrious_sections ?? parsed.sections,
    parseIllustriousPromptSectionsFromResponse,
  );
  const animaSections = normalizeProfileSections<AnimaPromptSections>(
    parsed.animaSections ?? parsed.anima_sections ?? parsed.sections,
    parseAnimaPromptSectionsFromResponse,
  );

  return {
    promptProfile,
    primaryCharacter: {
      name: primaryName,
      identity: primaryIdentity || positivePrompt,
      publicFacts: normalizeStringList(
        primaryRaw.publicFacts ?? primaryRaw.public_facts ?? parsed.publicCharacterFacts,
        8,
      ),
    },
    sceneIntent: sceneIntent || positivePrompt,
    styleTone: styleTone || normalizePromptFragments(parsed.style, 1)[0]?.prompt || "",
    setting,
    sharedFacts: normalizeStringList(parsed.sharedFacts ?? parsed.shared_facts ?? parsed.commonFacts, 10),
    positivePrompt,
    negativeSuggestions: normalizeStringList(
      parsed.negativeSuggestions ?? parsed.negative_suggestions ?? parsed.negativePrompt,
      10,
    ),
    style: normalizePromptFragments(parsed.style),
    camera: normalizePromptFragments(parsed.camera),
    lighting: normalizePromptFragments(parsed.lighting),
    ...(illustriousSections ? { illustriousSections } : {}),
    ...(animaSections ? { animaSections } : {}),
  };
}

function toTimelineCharacterPromptTag(item: CharacterImagePromptTagItem): CharacterPromptTag | null {
  const label = compactText(item.tag.label, 80) || compactText(item.tag.prompt, 48);
  const prompt = compactText(item.tag.prompt, 500);

  if (!label || !prompt || !isCharacterBodyPromptTagCategory(item.tag.category)) {
    return null;
  }

  if (item.target.kind === "character") {
    if (item.tag.category !== "character") {
      return null;
    }

    return {
      ...item.tag,
      targetKind: "character",
      label,
      prompt,
      weight: { ...item.tag.weight },
    };
  }

  if (item.target.kind === "bodyPart") {
    return {
      ...item.tag,
      targetKind: "bodyPart",
      bodyPartId: item.target.bodyPartId,
      label,
      prompt,
      weight: { ...item.tag.weight },
    };
  }

  return null;
}

function isPromptWeight(value: unknown): value is CharacterPromptTag["weight"] {
  return (
    isRecord(value) &&
    typeof value.enabled === "boolean" &&
    typeof value.value === "number" &&
    Number.isFinite(value.value)
  );
}

function isTimelineCharacterPromptTag(value: unknown): value is CharacterPromptTag {
  if (!isRecord(value)) {
    return false;
  }

  if (
    typeof value.label !== "string" ||
    typeof value.prompt !== "string" ||
    typeof value.category !== "string" ||
    !isCharacterBodyPromptTagCategory(value.category as PromptTagCategory) ||
    !isPromptWeight(value.weight)
  ) {
    return false;
  }

  if (value.negative !== undefined && typeof value.negative !== "boolean") {
    return false;
  }

  if (value.targetKind === "character") {
    return value.category === "character";
  }

  return value.targetKind === "bodyPart" && typeof value.bodyPartId === "string";
}

function isCharacterTagsTimelineResult(value: unknown): value is CharacterTagsTimelineResult {
  return isRecord(value) && Array.isArray(value.items) && value.items.every(isTimelineCharacterPromptTag);
}

export function normalizeCharacterTagsTimelineResult(raw: unknown): CharacterTagsTimelineResult {
  const content = typeof raw === "string" ? raw : JSON.stringify(raw);
  if (typeof content !== "string") {
    malformedResponse("Character tags response must use the prompt-tag items shape.", { raw });
  }

  const parsed = parseCharacterImagePromptTagsContent(content);

  if (!parsed.ok) {
    malformedResponse("Character tags response must use the prompt-tag items shape.", {
      error: parsed.error,
      raw,
    });
  }

  const items = parsed.items
    .map(toTimelineCharacterPromptTag)
    .filter((item): item is CharacterPromptTag => Boolean(item));

  if (items.length === 0) {
    malformedResponse("Character tags response must include at least one character or body-part item.", {
      raw,
    });
  }

  return { items };
}

function getSceneInput(workflow: TimelineNodeExecutionContext["workflow"]) {
  const result = workflow.nodes["scene-input"].result;

  if (isRecord(result) && typeof result.rawIntent === "string") {
    return {
      ...result,
      promptProfile: normalizePromptProfileId(result.promptProfile),
    } as SceneInputTimelineResult;
  }

  invalidTimelineInput("Scene input result is missing rawIntent.", { result });
}

function getManualTextResult(result: unknown) {
  if (typeof result === "string") {
    return compactText(result, 2000);
  }

  if (isRecord(result) && typeof result.shellContent === "string") {
    return compactText(result.shellContent, 2000);
  }

  return "";
}

function getScenePromptResult(workflow: TimelineNodeExecutionContext["workflow"]): ScenePromptTimelineResult {
  const result = workflow.nodes["scene-prompt"].result;
  const manualText = getManualTextResult(result);
  const promptProfile = getSceneInput(workflow).promptProfile;

  if (manualText) {
    return {
      promptProfile,
      primaryCharacter: {
        name: "Primary character",
        identity: manualText,
        publicFacts: [],
      },
      sceneIntent: manualText,
      styleTone: "",
      setting: "",
      sharedFacts: [],
      positivePrompt: manualText,
      negativeSuggestions: [],
      style: [],
      camera: [],
      lighting: [],
    };
  }

  try {
    return normalizeScenePromptTimelineResult(result, promptProfile);
  } catch (error) {
    if (error instanceof TimelineNodeExecutionError) {
      invalidTimelineInput("Scene prompt dependency is not usable for downstream execution.", {
        error: error.message,
      });
    }

    throw error;
  }
}

function getCharacterTagsResult(workflow: TimelineNodeExecutionContext["workflow"]): CharacterTagsTimelineResult {
  const result = workflow.nodes["character-tags"].result;
  const manualText = getManualTextResult(result);

  if (manualText) {
    return {
      items: [
        {
          targetKind: "character",
          label: "Manual character note",
          prompt: manualText,
          category: "character",
          subcategory: "character-subject",
          negative: false,
          weight: { enabled: false, value: 1 },
        },
      ],
    };
  }

  if (isCharacterTagsTimelineResult(result)) {
    return result;
  }

  try {
    return normalizeCharacterTagsTimelineResult(result);
  } catch (error) {
    if (error instanceof TimelineNodeExecutionError) {
      invalidTimelineInput("Character tag dependency is not usable for downstream execution.", {
        error: error.message,
      });
    }

    throw error;
  }
}

function getCharacterActionResult(workflow: TimelineNodeExecutionContext["workflow"]): CharacterActionTimelineResult {
  const result = workflow.nodes["character-action"].result;
  const manualText = getManualTextResult(result);

  if (manualText) {
    return {
      action: manualText,
      pose: createDefaultStickFigurePoseV1(),
      poseSummary: manualText,
    };
  }

  if (
    isRecord(result) &&
    typeof result.action === "string" &&
    isRecord(result.pose) &&
    typeof result.poseSummary === "string"
  ) {
    return result as CharacterActionTimelineResult;
  }

  invalidTimelineInput("Character action dependency is not usable for canvas binding.", { result });
}

function buildScenePromptRequest(context: TimelineNodeExecutionContext): LlmChatRequest {
  const sceneInput = getSceneInput(context.workflow);
  const profileInstructions = buildPromptProfileSceneInstructions(sceneInput.promptProfile);

  return {
    purpose: "stable-diffusion-prompt-generation",
    messages: [
      {
        role: "system",
        content: [
          "You are SceneForge's scene prompt agent.",
          "Return only valid JSON. No markdown, comments, or prose.",
          "Create the canonical shared scene context for later character tags, action planning, and layout planning.",
          "Include primary character identity, common/public character facts, global scene intent, style/tone, setting, and other shared facts.",
          "All generated natural-language fields must be English, including positivePrompt, negativeSuggestions, labels, prompts, character identity, scene intent, style, camera, and lighting.",
          "Do not choose checkpoints, LoRAs, render parameters, file paths, or external resources.",
          `Selected prompt profile: ${formatPromptProfileLabel(sceneInput.promptProfile)} (${sceneInput.promptProfile}).`,
          profileInstructions,
          'Required shape: {"promptProfile":"illustrious|anima|generic","primaryCharacter":{"name":"...","identity":"...","publicFacts":["..."]},"sceneIntent":"...","styleTone":"...","setting":"...","sharedFacts":["..."],"positivePrompt":"...","negativeSuggestions":["..."],"style":[{"label":"...","prompt":"..."}],"camera":[{"label":"...","prompt":"..."}],"lighting":[{"label":"...","prompt":"..."}],"illustriousSections"?:{},"animaSections"?:{}}',
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            sceneRequest: sceneInput.rawIntent,
            promptProfile: sceneInput.promptProfile,
            notes: [
              "Keep this single-image only.",
              "Keep the schema narrow and suitable for a fixed editable table.",
            ],
          },
          null,
          2,
        ),
      },
    ],
    temperature: 0.35,
    maxTokens: 900,
  };
}

function buildPromptProfileSceneInstructions(promptProfile: PromptProfileId) {
  if (promptProfile === "illustrious") {
    return [
      buildIllustriousAiResponseInstructions(),
      "For this scene context response, set promptProfile to illustrious and include illustriousSections.",
      "Make positivePrompt a concise comma-separated booru tag summary, not a prose paragraph.",
      "Map visible subject, appearance, outfit, action, setting, spatial composition, camera, lighting, and detail into the closest illustriousSections keys.",
    ].join("\n");
  }

  if (promptProfile === "anima") {
    return [
      buildAnimaAiResponseInstructions(),
      "For this scene context response, set promptProfile to anima and include animaSections.",
      "Make positivePrompt detailed comma-separated anime image clauses, not Illustrious booru-only tags.",
      "Describe visible character identity, action, expression, environment, camera, and lighting as concise anime clauses.",
    ].join("\n");
  }

  return [
    "Use generic Stable Diffusion prompt behavior.",
    "For this scene context response, set promptProfile to generic.",
    "Make positivePrompt a concise comma-separated visual prompt without Illustrious quality/aesthetic defaults or Anima score defaults.",
  ].join("\n");
}

function buildCharacterTagSourceText(scenePrompt: ScenePromptTimelineResult) {
  return [
    `Already-selected primary character: ${scenePrompt.primaryCharacter.name}`,
    `Primary character identity: ${scenePrompt.primaryCharacter.identity}`,
    scenePrompt.primaryCharacter.publicFacts.length > 0
      ? `Public character facts: ${scenePrompt.primaryCharacter.publicFacts.join(", ")}`
      : "",
    `Scene intent: ${scenePrompt.sceneIntent}`,
    `Scene prompt: ${scenePrompt.positivePrompt}`,
    scenePrompt.sharedFacts.length > 0 ? `Shared scene facts: ${scenePrompt.sharedFacts.join(", ")}` : "",
    "Do not rename, reselect, or redefine the primary character. Return only prompt-tag items for this character and their visible body parts.",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildCharacterTagsRequest(context: TimelineNodeExecutionContext): LlmChatRequest {
  const scenePrompt = getScenePromptResult(context.workflow);

  return {
    purpose: "prompt-tag-reverse",
    messages: buildCharacterTextPromptTagMessages({
      bodyParts: defaultCharacter.bodyParts,
      characterTarget: {
        label: scenePrompt.primaryCharacter.name,
        promptCategoryBindings: defaultCharacter.promptCategoryBindings,
      },
      userPrompt: buildCharacterTagSourceText(scenePrompt),
    }),
    temperature: 0.25,
    maxTokens: 1000,
  };
}

function buildActionDescription(context: TimelineNodeExecutionContext) {
  const scenePrompt = getScenePromptResult(context.workflow);

  return [
    `Scene intent: ${scenePrompt.sceneIntent}`,
    `Scene prompt: ${scenePrompt.positivePrompt}`,
    `Primary character: ${scenePrompt.primaryCharacter.name} - ${scenePrompt.primaryCharacter.identity}`,
    scenePrompt.primaryCharacter.publicFacts.length > 0
      ? `Public character facts: ${scenePrompt.primaryCharacter.publicFacts.join(", ")}`
      : "",
    scenePrompt.sharedFacts.length > 0 ? `Shared scene facts: ${scenePrompt.sharedFacts.join(", ")}` : "",
    "Infer the primary character's physical action and a plausible editable 3D stick-figure pose.",
    "Return the characterDescription/action summary in English.",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildCharacterActionRequest(
  context: TimelineNodeExecutionContext,
  currentPose: StickFigurePoseV1,
): LlmChatRequest {
  return {
    purpose: "stick-figure-pose-generation",
    messages: buildStickFigurePoseGenerationMessages(buildActionDescription(context), currentPose),
    temperature: 0.25,
    maxTokens: 900,
  };
}

function parseCharacterActionResponse(
  response: LlmChatResponse,
  currentPose: StickFigurePoseV1,
  context: TimelineNodeExecutionContext,
): CharacterActionTimelineResult {
  const parsed = parseStickFigurePoseGenerationResponse(response.content, currentPose);

  if (!parsed) {
    malformedResponse("Character action response must include usable stick-figure pose JSON.", {
      content: response.content,
    });
  }

  const scenePrompt = getScenePromptResult(context.workflow);
  const action = parsed.characterDescription
    ? compactText(parsed.characterDescription, 500)
    : `${scenePrompt.primaryCharacter.name}: ${scenePrompt.sceneIntent}`;

  return {
    action,
    pose: parsed.pose,
    poseSummary: action,
  };
}

function buildSpatialSummary(
  scenePrompt: ScenePromptTimelineResult,
  primaryCharacter: TimelineCanvasBindingInput["primaryCharacter"],
  action: CharacterActionTimelineResult,
) {
  return compactText(
    `${primaryCharacter.name} is bound as the primary editable 3D character at center stage, ${action.action}. Scene context: ${scenePrompt.positivePrompt}`,
    600,
  );
}

function createCanvasBindingInput(context: TimelineNodeExecutionContext): TimelineCanvasBindingInput {
  const scenePrompt = getScenePromptResult(context.workflow);
  const characterTags = getCharacterTagsResult(context.workflow);
  const action = getCharacterActionResult(context.workflow);
  const primaryCharacter = {
    name: scenePrompt.primaryCharacter.name,
    description: scenePrompt.primaryCharacter.identity,
  };

  return {
    primaryCharacter,
    characterTags: characterTags.items,
    action: action.action,
    pose: action.pose,
    transform: defaultCanvasTransform,
    spatialSummary: buildSpatialSummary(scenePrompt, primaryCharacter, action),
  };
}

function createTemporaryCanvasBindingResult(
  input: TimelineCanvasBindingInput,
): CanvasBindingTimelineResult {
  return {
    primaryCharacter: {
      id: "timeline-primary-character",
      name: input.primaryCharacter.name,
      description: input.primaryCharacter.description,
    },
    characterTags: input.characterTags,
    action: input.action,
    transform: input.transform,
    pose: input.pose,
    spatialSummary: input.spatialSummary,
  };
}

export function createTimelineT5NodeAdapters({
  bindCanvas,
  completeChat,
  getCurrentPose = createDefaultStickFigurePoseV1,
}: TimelineT5NodeAdapterOptions): TimelineNodeAdapters {
  return {
    "scene-prompt": createLlmTimelineNodeAdapter({
      completeChat,
      buildRequest: buildScenePromptRequest,
      parseResponse: (response, context) =>
        normalizeScenePromptTimelineResult(response.content, getSceneInput(context.workflow).promptProfile),
    }),
    "character-tags": createLlmTimelineNodeAdapter({
      completeChat,
      buildRequest: buildCharacterTagsRequest,
      parseResponse: (response) => normalizeCharacterTagsTimelineResult(response.content),
    }),
    "character-action": createLlmTimelineNodeAdapter({
      completeChat,
      buildRequest: (context) => buildCharacterActionRequest(context, getCurrentPose()),
      parseResponse: (response, context) =>
        parseCharacterActionResponse(response, getCurrentPose(), context),
    }),
    "canvas-binding": async (context) => {
      const input = createCanvasBindingInput(context);
      return {
        value: bindCanvas ? await bindCanvas(input, context) : createTemporaryCanvasBindingResult(input),
        source: "system",
      };
    },
  };
}
