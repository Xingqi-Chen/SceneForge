import {
  createLiteLlmClient,
  type LlmChatMessage,
  type LlmChatRequest,
  type LlmChatResponse,
  type LlmEmbeddingRequest,
  type LlmEmbeddingResponse,
} from "@/features/llm";
import { appendLlmLocalLog, serializeErrorForLlmLog } from "@/features/llm/llm-local-log";
import {
  getCivitaiResourceDetailFromSqlite,
  loadCivitaiLibrarySettingsFromSqlite,
  listCivitaiResourcesFromSqlite,
  type SceneForgeSqliteDatabase,
} from "@/features/persistence/sqlite-storage";
import {
  CIVITAI_SEARCH_INDEX_MISSING_MESSAGE,
  isCivitaiSearchIndexAvailable,
  rankCivitaiResourceIdsBySearchIndex,
  tokenizeCivitaiSearchText,
} from "@/features/persistence/civitai-search-index";
import {
  CIVITAI_EMBEDDING_INDEX_MISSING_MESSAGE,
  assertCivitaiEmbeddingIndexReady,
  isCivitaiEmbeddingIndexBm25ReadinessError,
  rankCivitaiResourceIdsByEmbeddingIndex,
  sanitizeCivitaiEmbeddingTextForUtf8,
} from "@/features/persistence/civitai-embedding-index";
import {
  formatPromptProfileLabel,
  isPromptProfileId,
  type PromptProfileId,
} from "@/shared/prompt-profile";
import { isCivitaiBaseModelCompatibleWithPromptProfile } from "./base-model";
import { extractCivitaiExampleImageDimensions } from "./image-dimensions";

import type {
  CivitaiAiRecommendationResponse,
  CivitaiResourceDetail,
  CivitaiResourceRecommendation,
  SelectedCivitaiResourcePreview,
} from "./types";
import {
  getCivitaiModelStorageKind,
  getCivitaiResourceConfiguredDownloadPath,
  getCivitaiResourceDownloadStatus,
  isCivitaiResourceDownloadReady,
  makeCivitaiResourceFileNameAliases,
  makeCivitaiResourceTargetFileName,
} from "./download";
import { isSameCivitaiBaseModel } from "./base-model";

export const CIVITAI_RECOMMENDATION_CHECKPOINT_LIMIT = 6;
export const CIVITAI_RECOMMENDATION_LORA_LIMIT = 10;
export const CIVITAI_RECOMMENDATION_MAX_LORAS = 3;

const DESCRIPTION_SNIPPET_MAX_LENGTH = 800;
const LLM_TEXT_FIELD_MAX_LENGTH = 320;
const MAX_ERROR_CHARS = 240;
const RECIPROCAL_RANK_FUSION_K = 60;

type CommonPairing = {
  resourceId: string;
  name: string;
  count: number;
};

export type CivitaiRecommendationCandidate = {
  resource: SelectedCivitaiResourcePreview;
  importedImageCount: number;
  commonCheckpoints: CommonPairing[];
  commonLoras: CommonPairing[];
  score: number;
};

type LlmRecommendationCandidate = {
  id: string;
  resourceType: "lora" | "model";
  name: string;
  versionName: string | null;
  baseModel: string | null;
  categories: string[];
  tags: string[];
  trainedWords: string[];
  usageGuide: string | null;
  description: string | null;
  exampleImageDimensions: string[];
  recommendations: Array<{
    condition: string | null;
    baseModel: string | null;
    checkpoint: string | null;
    sampler: string | null;
    loraWeightMin: number | null;
    loraWeightMax: number | null;
    loraWeight: number | null;
    hdRedrawRate: number | null;
    notes: string | null;
  }>;
  observedWeight: {
    average: number | null;
    min: number | null;
    max: number | null;
  };
  importedImageCount: number;
  commonCheckpoints: CommonPairing[];
  commonLoras: CommonPairing[];
  score: number;
};

type ParsedLlmRecommendation = {
  checkpointId: string | null;
  checkpointReason: string;
  loras: Array<{
    id: string;
    suggestedWeight: number | null;
    reason: string;
  }>;
  recommendationReason: string;
  overallEffect: string;
};

export class CivitaiAiRecommendationError extends Error {
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(message: string, statusCode = 500, details?: unknown) {
    super(message);
    this.name = "CivitaiAiRecommendationError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

function createLlmLogRequestId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    const isPercent = trimmed.endsWith("%");
    const parsed = Number(trimmed.replace(/%$/, ""));
    if (!Number.isFinite(parsed)) {
      return null;
    }

    return isPercent ? parsed / 100 : parsed;
  }

  return null;
}

function normalizeSuggestedWeight(value: unknown): number | null {
  const number = asFiniteNumber(value);
  if (number === null || number < 0 || number > 2) {
    return null;
  }

  return Number(number.toFixed(3));
}

function truncate(value: string | null, max: number) {
  if (!value) {
    return null;
  }

  return value.length <= max ? value : `${value.slice(0, max).trimEnd()}...`;
}

function sanitizeDescriptionSnippet(description: string | null) {
  const text = description
    ?.replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .trim();

  return truncate(text ?? null, DESCRIPTION_SNIPPET_MAX_LENGTH);
}

function normalizeSearchText(value: string | null | undefined) {
  return (value ?? "").toLocaleLowerCase().trim();
}

function collectKeywordSynonyms(text: string) {
  const synonyms: string[] = [];
  const rules: Array<{ tests: string[]; tokens: string[] }> = [
    { tests: ["赛博", "霓虹", "cyber", "neon"], tokens: ["cyberpunk", "neon", "techwear", "futuristic"] },
    { tests: ["写实", "真实", "照片", "电影", "real"], tokens: ["realistic", "photo", "cinematic", "film"] },
    { tests: ["动漫", "二次元", "插画", "anime"], tokens: ["anime", "manga", "illustration", "toon"] },
    { tests: ["服装", "衣服", "穿搭", "outfit"], tokens: ["clothing", "outfit", "fashion", "costume"] },
    { tests: ["姿势", "动作", "pose"], tokens: ["pose", "action", "dynamic"] },
    { tests: ["光", "灯光", "lighting"], tokens: ["lighting", "light", "glow", "shadow"] },
    { tests: ["细节", "质感", "detail"], tokens: ["detail", "texture", "sharp", "highres"] },
    { tests: ["可爱", "cute"], tokens: ["cute", "kawaii", "soft"] },
    { tests: ["暗黑", "恐怖", "horror"], tokens: ["dark", "horror", "gothic"] },
  ];

  for (const rule of rules) {
    if (rule.tests.some((test) => text.includes(test))) {
      synonyms.push(...rule.tokens);
    }
  }

  return synonyms;
}

export function tokenizeCivitaiRecommendationQuery(desiredEffect: string) {
  const normalized = normalizeSearchText(desiredEffect);
  return Array.from(new Set([...tokenizeCivitaiSearchText(normalized), ...collectKeywordSynonyms(normalized)]));
}

function scoreText(text: string | null | undefined, tokens: string[], weight: number) {
  const normalized = normalizeSearchText(text);
  if (!normalized) {
    return 0;
  }

  return tokens.reduce((score, token) => (normalized.includes(token) ? score + weight : score), 0);
}

function scoreStringList(values: string[], tokens: string[], weight: number) {
  return values.reduce((score, value) => score + scoreText(value, tokens, weight), 0);
}

function scoreRecommendation(recommendation: CivitaiResourceRecommendation, tokens: string[]) {
  return (
    scoreText(recommendation.condition, tokens, 1.5) +
    scoreText(recommendation.baseModel, tokens, 2) +
    scoreText(recommendation.checkpoint, tokens, 2) +
    scoreText(recommendation.sampler, tokens, 0.5) +
    scoreText(recommendation.notes, tokens, 1.5)
  );
}

function scoreResource(resource: CivitaiResourceDetail, tokens: string[]) {
  const categories = resource.categories.length > 0 ? resource.categories : resource.category ? [resource.category] : [];
  const textScore =
    scoreText(resource.name, tokens, 8) +
    scoreText(resource.versionName, tokens, 2) +
    scoreText(resource.baseModel, tokens, 3) +
    scoreStringList(resource.trainedWords, tokens, 7) +
    scoreStringList(resource.tags, tokens, 5) +
    scoreStringList(categories, tokens, 4) +
    scoreText(resource.usageGuide, tokens, 3) +
    scoreText(sanitizeDescriptionSnippet(resource.description), tokens, 2) +
    resource.recommendations.reduce((score, recommendation) => score + scoreRecommendation(recommendation, tokens), 0);
  const usageScore = Math.log2(resource.importedImageCount + 1) * 1.25;
  const weightScore =
    resource.averageWeight !== null || resource.minWeight !== null || resource.maxWeight !== null ? 0.75 : 0;
  const recommendationScore = Math.min(resource.recommendations.length, 4) * 0.35;
  const pairingScore =
    Math.min(
      resource.commonCheckpoints.reduce((sum, pairing) => sum + pairing.count, 0) +
        resource.commonLoras.reduce((sum, pairing) => sum + pairing.count, 0),
      12,
    ) * 0.12;

  return textScore + usageScore + weightScore + recommendationScore + pairingScore;
}

function toPreviewResource(resource: CivitaiResourceDetail): SelectedCivitaiResourcePreview {
  const modelFileName = makeCivitaiResourceTargetFileName(resource);

  return {
    id: resource.id,
    resourceType: resource.resourceType === "model" ? "model" : "lora",
    name: resource.name,
    versionName: resource.versionName,
    baseModel: resource.baseModel,
    creator: resource.creator,
    trainedWords: resource.trainedWords,
    tags: resource.tags,
    categories: resource.categories,
    usageGuide: resource.usageGuide,
    descriptionSnippet: sanitizeDescriptionSnippet(resource.description),
    averageWeight: resource.averageWeight,
    minWeight: resource.minWeight,
    maxWeight: resource.maxWeight,
    recommendations: resource.recommendations,
    previewImage: resource.previewImage,
    modelFileName,
    modelFileNameAliases: makeCivitaiResourceFileNameAliases(resource),
    exampleImageDimensions: extractCivitaiExampleImageDimensions(resource.officialImagesJson),
    ...(resource.resourceType === "model" ? { modelStorageKind: getCivitaiModelStorageKind(resource) } : {}),
  };
}

function toCandidate(resource: CivitaiResourceDetail, tokens: string[]): CivitaiRecommendationCandidate {
  return {
    resource: toPreviewResource(resource),
    importedImageCount: resource.importedImageCount,
    commonCheckpoints: resource.commonCheckpoints,
    commonLoras: resource.commonLoras,
    score: scoreResource(resource, tokens),
  };
}

function byRecommendationRank(
  left: CivitaiRecommendationCandidate,
  right: CivitaiRecommendationCandidate,
) {
  if (right.score !== left.score) {
    return right.score - left.score;
  }

  if (right.importedImageCount !== left.importedImageCount) {
    return right.importedImageCount - left.importedImageCount;
  }

  return left.resource.name.localeCompare(right.resource.name);
}

export function rankCivitaiRecommendationCandidates(
  resources: CivitaiResourceDetail[],
  desiredEffect: string,
): CivitaiRecommendationCandidate[] {
  const tokens = tokenizeCivitaiRecommendationQuery(desiredEffect);

  return resources.map((resource) => toCandidate(resource, tokens)).sort(byRecommendationRank);
}

function rankCivitaiRecommendationCandidatesWithFts(
  db: SceneForgeSqliteDatabase,
  resources: CivitaiResourceDetail[],
  resourceType: "model" | "lora",
  desiredEffect: string,
): CivitaiRecommendationCandidate[] {
  const tokens = tokenizeCivitaiRecommendationQuery(desiredEffect);
  const candidates = resources.map((resource) => toCandidate(resource, tokens));
  const candidateById = new Map(candidates.map((candidate) => [candidate.resource.id, candidate]));
  const ftsRanks = rankCivitaiResourceIdsBySearchIndex(db, {
    desiredEffect,
    resourceIds: resources.map((resource) => resource.id),
    resourceType,
  });
  const matched = Array.from(ftsRanks.entries())
    .map(([resourceId, rank]) => {
      const candidate = candidateById.get(resourceId);
      return candidate ? { candidate, rank } : null;
    })
    .filter((entry): entry is { candidate: CivitaiRecommendationCandidate; rank: number } => Boolean(entry))
    .sort((left, right) => {
      if (left.rank !== right.rank) {
        return left.rank - right.rank;
      }

      return byRecommendationRank(left.candidate, right.candidate);
    })
    .map(({ candidate, rank }) => ({
      ...candidate,
      score: Number((-rank).toFixed(4)),
    }));
  const matchedIds = new Set(matched.map((candidate) => candidate.resource.id));
  const unmatched = candidates
    .filter((candidate) => !matchedIds.has(candidate.resource.id))
    .sort(byRecommendationRank);

  return [...matched, ...unmatched];
}

function rankCivitaiRecommendationCandidatesWithEmbeddings(
  db: SceneForgeSqliteDatabase,
  resources: CivitaiResourceDetail[],
  resourceType: "model" | "lora",
  embedding: number[],
): CivitaiRecommendationCandidate[] {
  const tokens = tokenizeCivitaiRecommendationQuery("");
  const candidates = resources.map((resource) => toCandidate(resource, tokens));
  const candidateById = new Map(candidates.map((candidate) => [candidate.resource.id, candidate]));
  const vectorRanks = rankCivitaiResourceIdsByEmbeddingIndex(db, {
    embedding,
    resourceIds: resources.map((resource) => resource.id),
    resourceType,
  });

  return Array.from(vectorRanks.entries())
    .map(([resourceId, distance]) => {
      const candidate = candidateById.get(resourceId);
      return candidate ? { candidate, distance } : null;
    })
    .filter((entry): entry is { candidate: CivitaiRecommendationCandidate; distance: number } => Boolean(entry))
    .sort((left, right) => {
      if (left.distance !== right.distance) {
        return left.distance - right.distance;
      }

      return byRecommendationRank(left.candidate, right.candidate);
    })
    .map(({ candidate, distance }) => ({
      ...candidate,
      score: Number((-distance).toFixed(4)),
    }));
}

export function reciprocalRankFuseCivitaiRecommendationCandidates(
  rankedLists: CivitaiRecommendationCandidate[][],
): CivitaiRecommendationCandidate[] {
  const fused = new Map<string, { candidate: CivitaiRecommendationCandidate; score: number }>();

  for (const list of rankedLists) {
    for (const [index, candidate] of list.entries()) {
      const resourceId = candidate.resource.id;
      const existing = fused.get(resourceId);
      const score = 1 / (RECIPROCAL_RANK_FUSION_K + index + 1);

      fused.set(resourceId, {
        candidate: existing?.candidate ?? candidate,
        score: (existing?.score ?? 0) + score,
      });
    }
  }

  return Array.from(fused.values())
    .map(({ candidate, score }) => ({
      ...candidate,
      score: Number(score.toFixed(6)),
    }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return byRecommendationRank(left, right);
    });
}

function filterCivitaiRecommendationCandidatesForPromptProfile(
  candidates: CivitaiRecommendationCandidate[],
  promptProfile: PromptProfileId,
) {
  return candidates.filter((candidate) =>
    isCivitaiBaseModelCompatibleWithPromptProfile(candidate.resource.baseModel, promptProfile),
  );
}

async function filterDownloadedResourceDetails(
  db: SceneForgeSqliteDatabase,
  resources: CivitaiResourceDetail[],
) {
  const settings = loadCivitaiLibrarySettingsFromSqlite(db);
  const statuses = await Promise.all(
    resources.map(async (resource) => ({
      resource,
      status: await getCivitaiResourceDownloadStatus(
        resource,
        getCivitaiResourceConfiguredDownloadPath(resource, settings),
      ),
    })),
  );

  return statuses.filter(({ status }) => isCivitaiResourceDownloadReady(status)).map(({ resource }) => resource);
}

function loadResourceDetails(db: SceneForgeSqliteDatabase, resourceType: "lora" | "model") {
  return listCivitaiResourcesFromSqlite(db, { resourceType })
    .map((resource) => getCivitaiResourceDetailFromSqlite(db, resource.id))
    .filter((resource): resource is CivitaiResourceDetail => Boolean(resource));
}

export async function loadCivitaiRecommendationCandidates(
  db: SceneForgeSqliteDatabase,
  desiredEffect: string,
  options: {
    createEmbedding?: (request: LlmEmbeddingRequest) => Promise<LlmEmbeddingResponse>;
    promptProfile?: PromptProfileId;
  } = {},
) {
  if (!isCivitaiSearchIndexAvailable(db)) {
    throw new CivitaiAiRecommendationError(CIVITAI_SEARCH_INDEX_MISSING_MESSAGE, 409);
  }

  const embeddingModel = process.env.LITELLM_CIVITAI_EMBEDDING_MODEL;
  if (!embeddingModel?.trim()) {
    throw new CivitaiAiRecommendationError(
      CIVITAI_EMBEDDING_INDEX_MISSING_MESSAGE,
      409,
      "LITELLM_CIVITAI_EMBEDDING_MODEL is not set in the Next.js server process.",
    );
  }

  try {
    assertCivitaiEmbeddingIndexReady(db, embeddingModel);
  } catch (error) {
    if (isCivitaiEmbeddingIndexBm25ReadinessError(error)) {
      throw new CivitaiAiRecommendationError(error.message, 409, summarizeError(error));
    }

    throw new CivitaiAiRecommendationError(CIVITAI_EMBEDDING_INDEX_MISSING_MESSAGE, 409, summarizeError(error));
  }

  const createEmbedding = options.createEmbedding ?? createCivitaiEmbedding;
  let embedding: number[] | undefined;
  try {
    embedding = (await createEmbedding({
      input: sanitizeCivitaiEmbeddingTextForUtf8(desiredEffect),
      model: embeddingModel,
    })).embeddings[0];
  } catch (error) {
    throw new CivitaiAiRecommendationError(CIVITAI_EMBEDDING_INDEX_MISSING_MESSAGE, 409, summarizeError(error));
  }

  if (!embedding) {
    throw new CivitaiAiRecommendationError(CIVITAI_EMBEDDING_INDEX_MISSING_MESSAGE, 409);
  }

  const promptProfile = isPromptProfileId(options.promptProfile) ? options.promptProfile : null;
  const [downloadedCheckpoints, downloadedLoras] = await Promise.all([
    filterDownloadedResourceDetails(db, loadResourceDetails(db, "model")),
    filterDownloadedResourceDetails(db, loadResourceDetails(db, "lora")),
  ]);
  let rankedCheckpoints: CivitaiRecommendationCandidate[];
  let rankedLoras: CivitaiRecommendationCandidate[];
  try {
    rankedCheckpoints = reciprocalRankFuseCivitaiRecommendationCandidates([
      rankCivitaiRecommendationCandidatesWithFts(db, downloadedCheckpoints, "model", desiredEffect),
      rankCivitaiRecommendationCandidatesWithEmbeddings(db, downloadedCheckpoints, "model", embedding),
    ]);
    rankedLoras = reciprocalRankFuseCivitaiRecommendationCandidates([
      rankCivitaiRecommendationCandidatesWithFts(db, downloadedLoras, "lora", desiredEffect),
      rankCivitaiRecommendationCandidatesWithEmbeddings(db, downloadedLoras, "lora", embedding),
    ]);
  } catch (error) {
    throw new CivitaiAiRecommendationError(CIVITAI_EMBEDDING_INDEX_MISSING_MESSAGE, 409, summarizeError(error));
  }

  return {
    checkpoints: (promptProfile
      ? filterCivitaiRecommendationCandidatesForPromptProfile(rankedCheckpoints, promptProfile)
      : rankedCheckpoints
    ).slice(0, CIVITAI_RECOMMENDATION_CHECKPOINT_LIMIT),
    loras: (promptProfile
      ? filterCivitaiRecommendationCandidatesForPromptProfile(rankedLoras, promptProfile)
      : rankedLoras
    ).slice(0, CIVITAI_RECOMMENDATION_LORA_LIMIT),
  };
}

async function createCivitaiEmbedding(request: LlmEmbeddingRequest): Promise<LlmEmbeddingResponse> {
  const client = createLiteLlmClient({
    baseUrl: process.env.LITELLM_BASE_URL ?? "",
    apiKey: process.env.LITELLM_API_KEY,
    defaultModel: process.env.LITELLM_CIVITAI_EMBEDDING_MODEL,
  });

  return client.createEmbedding(request);
}

function normalizeRecommendationForLlm(recommendation: CivitaiResourceRecommendation) {
  return {
    condition: recommendation.condition,
    baseModel: recommendation.baseModel,
    checkpoint: recommendation.checkpoint,
    sampler: recommendation.sampler,
    loraWeightMin: recommendation.loraWeightMin,
    loraWeightMax: recommendation.loraWeightMax,
    loraWeight: recommendation.loraWeight,
    hdRedrawRate: recommendation.hdRedrawRate,
    notes: truncate(recommendation.notes, 160),
  };
}

export function toLlmCivitaiRecommendationCandidate(
  candidate: CivitaiRecommendationCandidate,
): LlmRecommendationCandidate {
  const { resource } = candidate;

  return {
    id: resource.id,
    resourceType: resource.resourceType,
    name: resource.name,
    versionName: resource.versionName,
    baseModel: resource.baseModel,
    categories: resource.categories.slice(0, 6),
    tags: resource.tags.slice(0, 8),
    trainedWords: resource.trainedWords.slice(0, 8),
    usageGuide: truncate(resource.usageGuide, LLM_TEXT_FIELD_MAX_LENGTH),
    description: truncate(resource.descriptionSnippet, LLM_TEXT_FIELD_MAX_LENGTH),
    exampleImageDimensions: resource.exampleImageDimensions?.slice(0, 6) ?? [],
    recommendations: resource.recommendations.slice(0, 3).map(normalizeRecommendationForLlm),
    observedWeight: {
      average: resource.averageWeight,
      min: resource.minWeight,
      max: resource.maxWeight,
    },
    importedImageCount: candidate.importedImageCount,
    commonCheckpoints: candidate.commonCheckpoints.slice(0, 6),
    commonLoras: candidate.commonLoras.slice(0, 6),
    score: Number(candidate.score.toFixed(2)),
  };
}

export function buildCivitaiCombinationRecommendationMessages({
  checkpointCandidates,
  desiredEffect,
  loraCandidates,
  maxLoras,
  promptProfile,
}: {
  checkpointCandidates: CivitaiRecommendationCandidate[];
  desiredEffect: string;
  loraCandidates: CivitaiRecommendationCandidate[];
  maxLoras: number;
  promptProfile?: PromptProfileId;
}): LlmChatMessage[] {
  const resolvedProfile = isPromptProfileId(promptProfile) ? promptProfile : null;
  const profileInstructions = resolvedProfile
    ? [
        `The selected prompt/base-model profile is ${formatPromptProfileLabel(resolvedProfile)} (${resolvedProfile}).`,
        "Candidates have already been narrowed to the selected prompt/base-model profile; do not recommend resources outside that candidate set.",
      ]
    : [
        "No prompt/base-model profile was provided; choose from all local candidates and rely on compatibility metadata.",
      ];

  return [
    {
      role: "system",
      content: [
        "You recommend Stable Diffusion Civitai checkpoint + LoRA combinations from downloaded local files.",
        "Use ONLY candidate ids provided by the user message. Never invent ids, names, trigger words, or unavailable resources.",
        "Every candidate has already been checked as downloaded locally; do not mention or recommend resources outside this downloaded set.",
        `Select exactly one checkpoint id and 0-${maxLoras} LoRA ids. Prefer fewer LoRAs when the effect can be achieved cleanly.`,
        "Use candidate metadata, observed weights, Civitai recommendations, and common pairings to choose a compatible combination.",
        ...profileInstructions,
        "Only pair LoRAs with the same baseModel as the selected checkpoint; Anima checkpoints may only use Anima LoRAs.",
        "Return JSON ONLY. No markdown fences, no commentary.",
        "Write checkpointReason, LoRA reasons, recommendationReason, and overallEffect in Simplified Chinese.",
        "suggestedWeight must be a number between 0 and 2, or null when uncertain.",
        "overallEffect must describe the expected visual style/effect of the checkpoint + LoRA combination, including style, texture, lighting, detail level, color mood, realism/anime tendency, and tradeoffs.",
        "Expected shape:",
        '{"checkpointId":"checkpoint-candidate-id","checkpointReason":"...","loras":[{"id":"lora-candidate-id","suggestedWeight":0.7,"reason":"..."}],"recommendationReason":"...","overallEffect":"..."}',
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify({
        desiredEffect,
        maxLoras,
        ...(resolvedProfile ? { promptProfile: resolvedProfile } : {}),
        checkpointCandidates: checkpointCandidates.map(toLlmCivitaiRecommendationCandidate),
        loraCandidates: loraCandidates.map(toLlmCivitaiRecommendationCandidate),
      }),
    },
  ];
}

function extractJsonPayload(text: string) {
  const trimmed = text.trim();

  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    // Continue to fenced / object extraction.
  }

  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/m.exec(trimmed);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
}

function parseLoraRecommendation(value: unknown) {
  if (typeof value === "string") {
    const id = value.trim();
    return id ? { id, suggestedWeight: null, reason: "" } : null;
  }

  if (!isRecord(value)) {
    return null;
  }

  const id = asTrimmedString(value.id) ?? asTrimmedString(value.loraId);
  if (!id) {
    return null;
  }

  return {
    id,
    suggestedWeight: normalizeSuggestedWeight(value.suggestedWeight ?? value.weight),
    reason: asTrimmedString(value.reason) ?? "",
  };
}

export function parseCivitaiCombinationRecommendationContent(content: string): ParsedLlmRecommendation {
  const jsonText = extractJsonPayload(content);
  const parsed = JSON.parse(jsonText) as unknown;

  if (!isRecord(parsed)) {
    throw new Error("LLM recommendation JSON must be an object.");
  }

  const checkpointId =
    asTrimmedString(parsed.checkpointId) ??
    (isRecord(parsed.checkpoint) ? asTrimmedString(parsed.checkpoint.id) : null);
  const checkpointReason =
    asTrimmedString(parsed.checkpointReason) ??
    (isRecord(parsed.checkpoint) ? asTrimmedString(parsed.checkpoint.reason) : null) ??
    "";
  const loraValues = Array.isArray(parsed.loras)
    ? parsed.loras
    : Array.isArray(parsed.loraIds)
      ? parsed.loraIds
      : [];

  return {
    checkpointId,
    checkpointReason,
    loras: loraValues.map(parseLoraRecommendation).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)),
    recommendationReason: asTrimmedString(parsed.recommendationReason) ?? "",
    overallEffect: asTrimmedString(parsed.overallEffect) ?? "",
  };
}

function getCandidateMap(candidates: CivitaiRecommendationCandidate[]) {
  return new Map(candidates.map((candidate) => [candidate.resource.id, candidate]));
}

function summarizeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const details = isRecord(error) && "details" in error ? error.details : undefined;
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : undefined;
  const summary = [
    message,
    cause ? `Cause: ${cause}` : null,
    details === undefined ? null : `Details: ${JSON.stringify(details)}`,
  ].filter(Boolean).join(" ");

  return summary.length > MAX_ERROR_CHARS ? `${summary.slice(0, MAX_ERROR_CHARS)}...` : summary;
}

export function validateCivitaiCombinationRecommendation({
  checkpointCandidates,
  loraCandidates,
  maxLoras,
  parsed,
  warnings = [],
}: {
  checkpointCandidates: CivitaiRecommendationCandidate[];
  loraCandidates: CivitaiRecommendationCandidate[];
  maxLoras: number;
  parsed: ParsedLlmRecommendation;
  warnings?: string[];
}): CivitaiAiRecommendationResponse {
  const checkpointMap = getCandidateMap(checkpointCandidates);
  const loraMap = getCandidateMap(loraCandidates);
  const checkpointCandidate = parsed.checkpointId ? checkpointMap.get(parsed.checkpointId) : undefined;

  if (!checkpointCandidate) {
    throw new CivitaiAiRecommendationError("AI 没有返回有效的 checkpoint 候选。", 502, {
      checkpointId: parsed.checkpointId,
    });
  }

  const selectedLoras: CivitaiAiRecommendationResponse["loras"] = [];
  const seenLoras = new Set<string>();

  for (const lora of parsed.loras) {
    const candidate = loraMap.get(lora.id);
    if (!candidate) {
      warnings.push(`AI 返回的 LoRA ${lora.id} 不在候选列表中，已忽略。`);
      continue;
    }

    if (seenLoras.has(lora.id)) {
      warnings.push(`AI 重复返回了 LoRA ${candidate.resource.name}，已保留第一次推荐。`);
      continue;
    }

    if (selectedLoras.length >= maxLoras) {
      warnings.push(`AI 返回的 LoRA 超过 ${maxLoras} 个，已只保留前 ${maxLoras} 个。`);
      break;
    }

    if (
      checkpointCandidate.resource.baseModel &&
      !isSameCivitaiBaseModel(candidate.resource.baseModel, checkpointCandidate.resource.baseModel)
    ) {
      warnings.push(
        `AI returned incompatible LoRA ${candidate.resource.name} for checkpoint baseModel ${checkpointCandidate.resource.baseModel}; ignored.`,
      );
      continue;
    }

    seenLoras.add(lora.id);
    selectedLoras.push({
      resource: candidate.resource,
      suggestedWeight: lora.suggestedWeight,
      reason: lora.reason || "AI 推荐该 LoRA 与目标效果匹配。",
    });
  }

  if (selectedLoras.length === 0 && loraCandidates.length > 0) {
    warnings.push("AI 没有返回有效 LoRA，本次仅自动选择 checkpoint。");
  }

  return {
    checkpoint: {
      resource: checkpointCandidate.resource,
      reason: parsed.checkpointReason || "AI 推荐该 checkpoint 作为组合基底。",
    },
    loras: selectedLoras,
    recommendationReason: parsed.recommendationReason || "AI 已根据本地收藏库候选、历史权重与常见搭配生成组合。",
    overallEffect: parsed.overallEffect || "该组合会以所选 checkpoint 的基础画风为主，并由 LoRA 补强目标效果。",
    warnings,
  };
}

async function completeRecommendationChat(chatRequest: LlmChatRequest): Promise<LlmChatResponse> {
  const requestId = createLlmLogRequestId();

  await appendLlmLocalLog({
    requestId,
    timestamp: new Date().toISOString(),
    phase: "request",
    route: "civitai-lora-library/ai-recommendation",
    payload: {
      purpose: chatRequest.purpose,
      nsfw: chatRequest.nsfw,
      model: chatRequest.model,
      temperature: chatRequest.temperature,
      maxTokens: chatRequest.maxTokens,
      messages: chatRequest.messages,
    },
  });

  try {
    const client = createLiteLlmClient({
      baseUrl: process.env.LITELLM_BASE_URL ?? "",
      apiKey: process.env.LITELLM_API_KEY,
      defaultModel: chatRequest.nsfw === true && process.env.LITELLM_NSFW_MODEL
        ? process.env.LITELLM_NSFW_MODEL
        : process.env.LITELLM_CIVITAI_RECOMMENDATION_MODEL || process.env.LITELLM_DEFAULT_MODEL,
    });
    const completion = await client.completeChat(chatRequest);

    await appendLlmLocalLog({
      requestId,
      timestamp: new Date().toISOString(),
      phase: "response",
      route: "civitai-lora-library/ai-recommendation",
      payload: { completion },
    });

    return completion;
  } catch (error) {
    await appendLlmLocalLog({
      requestId,
      timestamp: new Date().toISOString(),
      phase: "error",
      route: "civitai-lora-library/ai-recommendation",
      payload: {
        error: serializeErrorForLlmLog(error),
      },
    });

    throw error;
  }
}

function normalizeMaxLoras(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return CIVITAI_RECOMMENDATION_MAX_LORAS;
  }

  return Math.max(1, Math.min(CIVITAI_RECOMMENDATION_MAX_LORAS, Math.floor(value)));
}

export async function recommendCivitaiResourceCombination({
  completeChat = completeRecommendationChat,
  createEmbedding = createCivitaiEmbedding,
  db,
  desiredEffect,
  maxLoras: rawMaxLoras,
  nsfw = false,
  promptProfile: rawPromptProfile,
}: {
  completeChat?: (request: LlmChatRequest) => Promise<LlmChatResponse>;
  createEmbedding?: (request: LlmEmbeddingRequest) => Promise<LlmEmbeddingResponse>;
  db: SceneForgeSqliteDatabase;
  desiredEffect: string;
  maxLoras?: number;
  nsfw?: boolean;
  promptProfile?: PromptProfileId;
}): Promise<CivitaiAiRecommendationResponse> {
  const trimmedEffect = sanitizeCivitaiEmbeddingTextForUtf8(desiredEffect).trim();
  if (!trimmedEffect) {
    throw new CivitaiAiRecommendationError("请先输入想要的画面效果。", 400);
  }

  const maxLoras = normalizeMaxLoras(rawMaxLoras);
  const promptProfile = isPromptProfileId(rawPromptProfile) ? rawPromptProfile : undefined;
  const { checkpoints, loras } = await loadCivitaiRecommendationCandidates(db, trimmedEffect, {
    createEmbedding,
    promptProfile,
  });
  const warnings: string[] = [];

  if (checkpoints.length === 0) {
    throw new CivitaiAiRecommendationError("本地收藏库中还没有 checkpoint，无法生成组合推荐。", 400);
  }

  if (loras.length === 0) {
    warnings.push("本地收藏库中还没有 LoRA，AI 只能推荐 checkpoint。");
  }

  const chatRequest: LlmChatRequest = {
    purpose: "civitai-combination-recommendation",
    nsfw,
    model: nsfw && process.env.LITELLM_NSFW_MODEL
      ? process.env.LITELLM_NSFW_MODEL
      : process.env.LITELLM_CIVITAI_RECOMMENDATION_MODEL || process.env.LITELLM_DEFAULT_MODEL,
    messages: buildCivitaiCombinationRecommendationMessages({
      checkpointCandidates: checkpoints,
      desiredEffect: trimmedEffect,
      loraCandidates: loras,
      maxLoras,
      promptProfile,
    }),
    temperature: 0.2,
    maxTokens: 1000,
  };

  try {
    const completion = await completeChat(chatRequest);
    const parsed = parseCivitaiCombinationRecommendationContent(completion.content);

    return validateCivitaiCombinationRecommendation({
      checkpointCandidates: checkpoints,
      loraCandidates: loras,
      maxLoras,
      parsed,
      warnings,
    });
  } catch (error) {
    if (error instanceof CivitaiAiRecommendationError) {
      throw error;
    }

    throw new CivitaiAiRecommendationError("AI 推荐失败，请稍后重试。", 500, summarizeError(error));
  }
}
