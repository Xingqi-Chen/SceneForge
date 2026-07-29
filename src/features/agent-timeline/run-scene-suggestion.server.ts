import { randomUUID } from "node:crypto";

import { createLiteLlmClient, LiteLlmError, type LlmChatRequest } from "@/features/llm";
import {
  appendLlmChatLocalLog,
  serializeErrorForLlmLog,
} from "@/features/llm/llm-local-log";
import { formatPromptProfileLabel, type PromptProfileId } from "@/shared/prompt-profile";
import {
  DEFAULT_RUN_VISUAL_STYLE,
  buildRunVisualStyleLlmInstructions,
  type RunVisualStyle,
} from "./run-visual-style";

import {
  appendRunSceneSuggestionHistory,
  loadRunSceneSuggestionHistory,
  RUN_SCENE_SUGGESTION_HISTORY_VERSION,
  type RunSceneSuggestionHistoryRecord,
} from "./run-scene-suggestion-history.server";
import {
  createRunSceneSuggestionFingerprintKey,
  parseRunSceneSuggestionCandidates,
  rankRunSceneSuggestionCandidates,
  runSceneSuggestionFingerprintFields,
  selectWeightedRunSceneSuggestion,
  type RunSceneSuggestionFingerprint,
} from "./run-scene-suggestion";

const ROUTE = "/api/agent-timeline/run-scene-suggestion";
const REQUESTED_CANDIDATE_COUNT = 6;

export class RunSceneSuggestionError extends Error {
  readonly code: "no_valid_candidates" | "llm_unavailable";
  readonly statusCode: number;

  constructor(
    code: RunSceneSuggestionError["code"],
    message: string,
    statusCode = 502,
  ) {
    super(message);
    this.name = "RunSceneSuggestionError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export type RunSceneSuggestionResult = {
  sceneRequest: string;
  warning?: string;
};

function buildCandidateContract(promptProfile: PromptProfileId, nsfw: boolean) {
  return {
    sceneRequest: nsfw
      ? "one complete generation-ready English scene request depicting exactly one protagonist as the sole person and visual subject"
      : "one complete generation-ready English scene request depicting exactly one female protagonist as the sole person and visual subject",
    compatiblePromptProfiles: [promptProfile],
    protagonistType: nsfw
      ? "bounded category for exactly one sole protagonist"
      : "bounded category for exactly one sole female protagonist",
    ageGroup: nsfw
      ? "unambiguous numeric age declaration of 21 years or older"
      : "bounded category",
    occupationFamily: "bounded category",
    settingCategory: "bounded category",
    era: "bounded category",
    primaryAction: "bounded category",
    emotionalTone: "bounded category",
    dominantPalette: "bounded category",
  };
}

export function buildEmptyRunSceneSuggestionRequest({
  nsfw,
  promptProfile,
  recentConceptsToAvoid,
  repairReason,
  visualStyle,
}: {
  nsfw: boolean;
  promptProfile: PromptProfileId;
  recentConceptsToAvoid: readonly RunSceneSuggestionFingerprint[];
  repairReason?: string;
  visualStyle?: RunVisualStyle;
}): LlmChatRequest {
  const profileLabel = formatPromptProfileLabel(promptProfile);
  const resolvedVisualStyle = visualStyle ?? DEFAULT_RUN_VISUAL_STYLE;
  return {
    purpose: "stable-diffusion-prompt-generation",
    nsfw,
    messages: [
      {
        role: "system",
        content: [
          "You are SceneForge's empty-input Run scene suggestion agent.",
          `Return exactly ${REQUESTED_CANDIDATE_COUNT} diverse candidates as valid JSON only. No markdown, comments, reasoning, or prose outside JSON.`,
          "Every candidate must be a complete, generation-ready single-image concept with one clear protagonist, visible action, supporting setting, visual mood, and palette.",
          "Every candidate must depict exactly one person as the sole visual subject. Never include a multi-person scene, another person, a couple, group, crowd, or any person in the background.",
          ...(nsfw
            ? [
                "All six candidates must lean clearly adult and NSFW, with varied mature intensity across sensual, nude, and erotic concepts.",
                "Every depicted person must be explicitly 21 years old or older. Each ageGroup must be an unambiguous numeric 21+ declaration; vague labels such as adult or young adult are invalid.",
                "Never include minors, ambiguous-age or youth-coded subjects or settings, coercion, exploitation, non-consensual sexual content, or unlawful sexual content.",
              ]
            : [
                "The sole protagonist in every candidate must be female.",
                "Use diverse safe settings across the six candidates. A campus is one optional possibility, not a requirement or default.",
              ]),
          "Write every sceneRequest yourself as the complete authoritative semantic request. Do not return fragments and do not derive it mechanically from category labels.",
          `Every candidate must be compatible with ${profileLabel} (${promptProfile}) and must include compatiblePromptProfiles containing "${promptProfile}".`,
          buildRunVisualStyleLlmInstructions(resolvedVisualStyle, promptProfile),
          "Categorical fingerprint values must be concise English labels of at most 64 characters.",
          "Diversify protagonist type, age group, occupation family, setting, era, action, tone, and palette within this batch and against recentConceptsToAvoid.",
          "Do not include file paths, model/checkpoint/LoRA names, render parameters, implementation details, or additional fields.",
          ...(repairReason
            ? [
                "This is the single permitted schema-repair attempt. Return a fresh complete six-candidate object.",
                `Safe validation issue: ${repairReason}`,
              ]
            : []),
          `Required shape: ${JSON.stringify({ candidates: [buildCandidateContract(promptProfile, nsfw)] })}`,
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify({
          action: repairReason ? "repair-empty-suggestion-candidates" : "suggest-empty-scene",
          candidateCount: REQUESTED_CANDIDATE_COUNT,
          promptProfile,
          ...(visualStyle ? { visualStyle } : {}),
          recentConceptsToAvoid: recentConceptsToAvoid.slice(-20),
        }),
      },
    ],
    temperature: 0.9,
    maxTokens: 2_400,
  };
}

function resolveModel(nsfw: boolean) {
  return nsfw
    ? process.env.LITELLM_NSFW_MODEL || process.env.LITELLM_DEFAULT_MODEL
    : process.env.LITELLM_DEFAULT_MODEL;
}

async function requestCandidates(
  request: LlmChatRequest,
  attempt: "initial" | "repair",
) {
  const requestId = randomUUID();
  const resolvedRequest = { ...request, model: resolveModel(request.nsfw === true) };
  await appendLlmChatLocalLog({
    category: "chat",
    phase: "request",
    request: resolvedRequest,
    requestId,
    route: ROUTE,
    context: { attempt },
  });
  try {
    const client = createLiteLlmClient({
      baseUrl: process.env.LITELLM_BASE_URL ?? "",
      apiKey: process.env.LITELLM_API_KEY,
      defaultModel: process.env.LITELLM_DEFAULT_MODEL,
    });
    const response = await client.completeChat(resolvedRequest);
    await appendLlmChatLocalLog({
      category: "chat",
      completion: response,
      phase: "response",
      requestId,
      route: ROUTE,
      context: { attempt },
    });
    return response;
  } catch (error) {
    await appendLlmChatLocalLog({
      category: "chat",
      phase: "error",
      error,
      requestId,
      route: ROUTE,
      context: { attempt },
      ...(error instanceof LiteLlmError
        ? { statusCode: error.statusCode, details: error.details }
        : {}),
    });
    console.error("[SceneForge] [timeline] empty Run suggestion LLM request failed", {
      attempt,
      error: serializeErrorForLlmLog(error),
    });
    throw new RunSceneSuggestionError(
      "llm_unavailable",
      "Empty Run suggestion is temporarily unavailable.",
      error instanceof LiteLlmError ? error.statusCode ?? 502 : 502,
    );
  }
}

function repairReason(malformed: boolean, validCount: number, rejectedCount: number) {
  if (malformed) {
    return `The response was not one JSON object containing exactly six candidates; ${validCount} valid candidates were recovered.`;
  }
  return `Only ${validCount} valid unique profile-compatible candidates remained after validation; ${rejectedCount} were rejected.`;
}

export async function createEmptyRunSceneSuggestion({
  nsfw,
  promptProfile,
  random = Math.random,
  now = () => new Date(),
  visualStyle = DEFAULT_RUN_VISUAL_STYLE,
}: {
  nsfw: boolean;
  promptProfile: PromptProfileId;
  random?: () => number;
  now?: () => Date;
  visualStyle?: RunVisualStyle;
}): Promise<RunSceneSuggestionResult> {
  const history = await loadRunSceneSuggestionHistory();
  const recentConceptsToAvoid = history.slice(-20).map((record) => record.fingerprint);
  const initial = await requestCandidates(buildEmptyRunSceneSuggestionRequest({
    nsfw,
    promptProfile,
    recentConceptsToAvoid,
    visualStyle,
  }), "initial");
  let parsed = parseRunSceneSuggestionCandidates(initial.content, promptProfile, nsfw);
  if (parsed.malformed || parsed.candidates.length < 3) {
    const repair = await requestCandidates(buildEmptyRunSceneSuggestionRequest({
      nsfw,
      promptProfile,
      recentConceptsToAvoid,
      repairReason: repairReason(parsed.malformed, parsed.candidates.length, parsed.rejectedCount),
      visualStyle,
    }), "repair");
    parsed = parseRunSceneSuggestionCandidates(repair.content, promptProfile, nsfw);
  }
  if (parsed.candidates.length === 0) {
    throw new RunSceneSuggestionError(
      "no_valid_candidates",
      "AI did not return a valid profile-compatible scene suggestion. The Composer was not changed; retry Suggest.",
    );
  }

  const ranked = rankRunSceneSuggestionCandidates(parsed.candidates, recentConceptsToAvoid);
  const selected = selectWeightedRunSceneSuggestion(ranked, random);
  if (!selected) {
    throw new RunSceneSuggestionError(
      "no_valid_candidates",
      "AI did not return a selectable scene suggestion. The Composer was not changed; retry Suggest.",
    );
  }
  const selectedKey = createRunSceneSuggestionFingerprintKey(selected.candidate);
  const timestamp = now().toISOString();
  const additions: RunSceneSuggestionHistoryRecord[] = ranked.map(({ candidate }) => ({
    schemaVersion: RUN_SCENE_SUGGESTION_HISTORY_VERSION,
    timestamp,
    disposition: createRunSceneSuggestionFingerprintKey(candidate) === selectedKey
      ? "selected"
      : "not-selected",
    fingerprint: Object.fromEntries(
      runSceneSuggestionFingerprintFields.map((field) => [field, candidate[field]]),
    ) as RunSceneSuggestionFingerprint,
  }));

  let warning: string | undefined;
  try {
    await appendRunSceneSuggestionHistory(additions);
  } catch (error) {
    warning = "Suggestion created, but local diversity history could not be saved.";
    console.warn("[SceneForge] [timeline] empty Run suggestion history write failed", {
      error: serializeErrorForLlmLog(error),
    });
  }
  return {
    sceneRequest: selected.candidate.sceneRequest.trim(),
    ...(warning ? { warning } : {}),
  };
}
