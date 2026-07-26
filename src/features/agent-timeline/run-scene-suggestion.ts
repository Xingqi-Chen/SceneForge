import { isPromptProfileId, type PromptProfileId } from "@/shared/prompt-profile";

export const runSceneSuggestionFingerprintFields = [
  "protagonistType",
  "ageGroup",
  "occupationFamily",
  "settingCategory",
  "era",
  "primaryAction",
  "emotionalTone",
  "dominantPalette",
] as const;

export type RunSceneSuggestionFingerprintField =
  (typeof runSceneSuggestionFingerprintFields)[number];

export type RunSceneSuggestionFingerprint = Record<RunSceneSuggestionFingerprintField, string>;

export type RunSceneSuggestionCandidate = RunSceneSuggestionFingerprint & {
  sceneRequest: string;
  compatiblePromptProfiles: PromptProfileId[];
};

export type RankedRunSceneSuggestionCandidate = {
  candidate: RunSceneSuggestionCandidate;
  originalIndex: number;
  score: number;
};

export type RunSceneSuggestionParseResult = {
  candidates: RunSceneSuggestionCandidate[];
  malformed: boolean;
  rejectedCount: number;
};

const MAX_SCENE_REQUEST_CHARS = 1_200;
const MIN_SCENE_REQUEST_CHARS = 24;
const MAX_FINGERPRINT_CHARS = 64;
const FINGERPRINT_VALUE_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} '&+./_-]*$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalFingerprintValue(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
  return normalized.length > 0 &&
    normalized.length <= MAX_FINGERPRINT_CHARS &&
    FINGERPRINT_VALUE_PATTERN.test(normalized)
    ? normalized
    : null;
}

function sanitizeCompatibleProfiles(
  value: Record<string, unknown>,
  selectedProfile: PromptProfileId,
) {
  const hasProfile = value.promptProfile !== undefined;
  if (hasProfile && (!isPromptProfileId(value.promptProfile) || value.promptProfile !== selectedProfile)) {
    return null;
  }
  const explicitProfiles = Array.isArray(value.compatiblePromptProfiles)
    ? value.compatiblePromptProfiles
    : hasProfile
      ? [value.promptProfile]
      : null;
  if (!explicitProfiles || explicitProfiles.length > 3 ||
      explicitProfiles.length < 1 ||
      explicitProfiles.some((profile) => !isPromptProfileId(profile))) return null;
  const profiles = [...new Set(explicitProfiles as PromptProfileId[])];
  return profiles.includes(selectedProfile) ? profiles : null;
}

export function sanitizeRunSceneSuggestionFingerprint(
  value: unknown,
): RunSceneSuggestionFingerprint | null {
  if (!isRecord(value)) return null;
  const entries = runSceneSuggestionFingerprintFields.map((field) => [
    field,
    canonicalFingerprintValue(value[field]),
  ] as const);
  if (entries.some(([, entry]) => !entry)) return null;
  return Object.fromEntries(entries) as RunSceneSuggestionFingerprint;
}

export function createRunSceneSuggestionFingerprintKey(
  fingerprint: RunSceneSuggestionFingerprint,
) {
  return runSceneSuggestionFingerprintFields
    .map((field) => `${field}:${fingerprint[field]}`)
    .join("|");
}

export function sanitizeRunSceneSuggestionCandidate(
  value: unknown,
  selectedProfile: PromptProfileId,
): RunSceneSuggestionCandidate | null {
  if (!isRecord(value) || typeof value.sceneRequest !== "string") return null;
  const sceneRequest = value.sceneRequest.trim();
  if (sceneRequest.length < MIN_SCENE_REQUEST_CHARS ||
      sceneRequest.length > MAX_SCENE_REQUEST_CHARS ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(sceneRequest)) return null;
  const fingerprint = sanitizeRunSceneSuggestionFingerprint(value);
  const compatiblePromptProfiles = sanitizeCompatibleProfiles(value, selectedProfile);
  return fingerprint && compatiblePromptProfiles
    ? { sceneRequest, compatiblePromptProfiles, ...fingerprint }
    : null;
}

function likelyJsonValues(content: string) {
  const trimmed = content.trim();
  const values = [trimmed];
  values.push(...Array.from(
    trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi),
    (match) => match[1]?.trim() ?? "",
  ));
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) values.push(trimmed.slice(firstBrace, lastBrace + 1));
  return [...new Set(values.filter(Boolean))];
}

export function parseRunSceneSuggestionCandidates(
  content: string,
  selectedProfile: PromptProfileId,
): RunSceneSuggestionParseResult {
  let rawCandidates: unknown[] | null = null;
  for (const value of likelyJsonValues(content)) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (isRecord(parsed) && Array.isArray(parsed.candidates)) {
        rawCandidates = parsed.candidates;
        break;
      }
    } catch {
      // Try the next bounded JSON representation.
    }
  }
  if (!rawCandidates) return { candidates: [], malformed: true, rejectedCount: 0 };

  const candidates: RunSceneSuggestionCandidate[] = [];
  const seenScenes = new Set<string>();
  const seenFingerprints = new Set<string>();
  let rejectedCount = Math.max(0, rawCandidates.length - 6);
  for (const raw of rawCandidates.slice(0, 6)) {
    const candidate = sanitizeRunSceneSuggestionCandidate(raw, selectedProfile);
    if (!candidate) {
      rejectedCount += 1;
      continue;
    }
    const sceneKey = candidate.sceneRequest.toLocaleLowerCase().replace(/\s+/g, " ");
    const fingerprintKey = createRunSceneSuggestionFingerprintKey(candidate);
    if (seenScenes.has(sceneKey) || seenFingerprints.has(fingerprintKey)) {
      rejectedCount += 1;
      continue;
    }
    seenScenes.add(sceneKey);
    seenFingerprints.add(fingerprintKey);
    candidates.push(candidate);
  }
  return {
    candidates,
    malformed: rawCandidates.length !== 6,
    rejectedCount,
  };
}

function fingerprintNovelty(
  left: RunSceneSuggestionFingerprint,
  right: RunSceneSuggestionFingerprint,
) {
  const differences = runSceneSuggestionFingerprintFields.reduce(
    (count, field) => count + (left[field] === right[field] ? 0 : 1),
    0,
  );
  return differences / runSceneSuggestionFingerprintFields.length;
}

function average(values: number[], emptyValue: number) {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : emptyValue;
}

export function rankRunSceneSuggestionCandidates(
  candidates: readonly RunSceneSuggestionCandidate[],
  recentFingerprints: readonly RunSceneSuggestionFingerprint[],
): RankedRunSceneSuggestionCandidate[] {
  return candidates
    .map((candidate, originalIndex) => {
      const recentNoveltyValues = recentFingerprints
        .slice(-20)
        .map((recent) => fingerprintNovelty(candidate, recent));
      const recentNovelty = recentNoveltyValues.length > 0
        ? Math.min(...recentNoveltyValues)
        : 1;
      const batchDiversity = average(
        candidates.flatMap((other, index) =>
          index === originalIndex ? [] : [fingerprintNovelty(candidate, other)]),
        1,
      );
      const completeness = Math.min(candidate.sceneRequest.length, 360) / 360;
      return {
        candidate,
        originalIndex,
        score: recentNovelty * 0.5 + batchDiversity * 0.3 + completeness * 0.2,
      };
    })
    .sort((left, right) =>
      right.score - left.score ||
      createRunSceneSuggestionFingerprintKey(left.candidate)
        .localeCompare(createRunSceneSuggestionFingerprintKey(right.candidate)) ||
      left.originalIndex - right.originalIndex);
}

export function selectWeightedRunSceneSuggestion(
  ranked: readonly RankedRunSceneSuggestionCandidate[],
  random: () => number = Math.random,
) {
  const choices = ranked.slice(0, 3);
  if (choices.length === 0) return null;
  if (choices.length === 1) return choices[0]!;
  const weights = choices.length === 2 ? [0.625, 0.375] : [0.5, 0.3, 0.2];
  const value = Math.min(Math.max(random(), 0), 0.999999999999);
  let cumulative = 0;
  for (let index = 0; index < choices.length; index += 1) {
    cumulative += weights[index]!;
    if (value < cumulative) return choices[index]!;
  }
  return choices[choices.length - 1]!;
}
