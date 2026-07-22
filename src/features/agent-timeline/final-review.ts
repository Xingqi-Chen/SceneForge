import {
  previewScoringRubric,
  timelineFinalReviewOperations,
  timelineFinalReviewScopes,
  timelineFinalReviewSeverities,
  type ComfyUiExecutionTimelineResult,
  type FinalReviewTimelineResult,
  type TimelineFinalReviewFinding,
  type TimelineFinalReviewPair,
  type TimelineFinalReviewScores,
  type TimelineWorkflowState,
} from "./types";

const scoreFields = ["adherence", "composition", "anatomy", "style", "technical"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class FinalReviewValidationError extends Error {
  readonly reasonCode: string;

  constructor(reasonCode: string, message: string) {
    super(message);
    this.name = "FinalReviewValidationError";
    this.reasonCode = reasonCode;
  }
}

function invalid(reasonCode: string, message: string): never {
  throw new FinalReviewValidationError(reasonCode, message);
}

function extractSingleJsonObject(content: string) {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  const objects: string[] = [];
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        objects.push(content.slice(start, index + 1));
        start = -1;
      }
    }
  }
  if (depth !== 0 || inString || objects.length !== 1) {
    invalid("json_object", "Final review must contain exactly one complete JSON object.");
  }
  return objects[0]!;
}

function normalizeEnum<T extends string>(value: unknown, allowed: readonly T[]) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLocaleLowerCase().replace(/[\s_]+/g, "-");
  return allowed.includes(normalized as T) ? normalized as T : null;
}

function normalizeBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string" && /^(true|false)$/i.test(value.trim())) return value.trim().toLowerCase() === "true";
  return null;
}

function normalizeScores(value: unknown): TimelineFinalReviewScores {
  if (!isRecord(value)) invalid("scores_missing", "Every variant must include all five scores.");
  const scores = Object.fromEntries(scoreFields.map((field) => {
    const raw = value[field];
    const score = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw.trim()) : Number.NaN;
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      invalid("score_range", `Final review score ${field} must be finite and between 0 and 100.`);
    }
    return [field, score];
  })) as Record<(typeof scoreFields)[number], number>;
  const total = scores.adherence * previewScoringRubric.adherence +
    scores.composition * previewScoringRubric.composition +
    scores.anatomy * previewScoringRubric.anatomy +
    scores.style * previewScoringRubric.style +
    scores.technical * previewScoringRubric.technical;
  return { ...scores, total: Number(total.toFixed(2)) };
}

function normalizeFindings(value: unknown): TimelineFinalReviewFinding[] {
  if (!Array.isArray(value) || value.length !== timelineFinalReviewOperations.length) {
    invalid("finding_coverage", "Every pair must include exactly one pose, contact, object-count, and composition-consistency finding.");
  }
  const seen = new Set<string>();
  const findings = value.map((entry) => {
    if (!isRecord(entry)) invalid("finding_shape", "Final review findings must be objects.");
    const operation = normalizeEnum(entry.operation, timelineFinalReviewOperations);
    const severity = normalizeEnum(entry.severity, timelineFinalReviewSeverities);
    const scope = normalizeEnum(entry.scope, timelineFinalReviewScopes);
    const introducedByFinal = normalizeBoolean(entry.introducedByFinal);
    if (!operation || !severity || !scope || introducedByFinal === null || seen.has(operation)) {
      invalid("finding_contract", "Final review findings must use unique supported operation, severity, scope, and boolean introducedByFinal values.");
    }
    if (severity === "none" && introducedByFinal) {
      invalid("finding_semantics", "A finding with severity none cannot be introduced by Final.");
    }
    seen.add(operation);
    return {
      operation,
      severity,
      scope,
      introducedByFinal,
      description: typeof entry.description === "string" && entry.description.trim()
        ? entry.description.trim().slice(0, 500)
        : severity === "none" ? "No material inconsistency detected." : "Material inconsistency detected.",
    };
  });
  if (seen.size !== timelineFinalReviewOperations.length) invalid("finding_coverage", "Final review finding coverage is incomplete.");
  return findings;
}

export function getCompletedFinalReviewPairs(execution: ComfyUiExecutionTimelineResult): TimelineFinalReviewPair[] {
  const completed = execution.finals.filter((item) => item.status === "done" && item.storedImage && item.previewUpscale);
  if (!execution.completed || completed.length !== execution.finalCount || completed.length < 1 || completed.length > 4) {
    invalid("pair_source", "Final review requires one to four complete managed Preview/Final pairs.");
  }
  return completed.sort((left, right) => left.rank - right.rank).map((item) => ({
    candidateId: item.candidateId,
    rank: item.rank,
    seed: item.seed,
    variants: { final: item.storedImage!, previewUpscale: item.previewUpscale!.storedImage },
    recommendedVariant: null,
    defaultVariant: "final",
  }));
}

export function parseFinalReviewResponse(
  content: string,
  sourcePairs: TimelineFinalReviewPair[],
): FinalReviewTimelineResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractSingleJsonObject(content));
  } catch (error) {
    if (error instanceof FinalReviewValidationError) throw error;
    invalid("json_parse", "Final review contained invalid JSON.");
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.pairs) || parsed.pairs.length !== sourcePairs.length) {
    invalid("pair_coverage", "Final review must cover every managed pair exactly once.");
  }
  const sourceById = new Map(sourcePairs.map((pair) => [pair.candidateId, pair]));
  const seen = new Set<string>();
  const pairs = parsed.pairs.map((entry) => {
    if (!isRecord(entry) || typeof entry.candidateId !== "string" || seen.has(entry.candidateId)) {
      invalid("pair_identity", "Final review pair ids must be unique valid candidate ids.");
    }
    const source = sourceById.get(entry.candidateId);
    if (!source) invalid("pair_identity", "Final review referenced an unknown candidate pair.");
    seen.add(entry.candidateId);
    if (!isRecord(entry.scores)) invalid("scores_missing", "Every pair must include Preview and Final scores.");
    const findings = normalizeFindings(entry.findings);
    const recommendedVariant = findings.some((finding) =>
      finding.introducedByFinal && (finding.severity === "major" || finding.severity === "blocking"))
      ? "preview-upscale" as const
      : "final" as const;
    return {
      ...source,
      scores: {
        previewUpscale: normalizeScores(entry.scores.previewUpscale),
        final: normalizeScores(entry.scores.final),
      },
      findings,
      ...(typeof entry.rationale === "string" && entry.rationale.trim()
        ? { rationale: entry.rationale.trim().slice(0, 1_000) }
        : {}),
      recommendedVariant,
      defaultVariant: recommendedVariant,
    };
  });
  if (seen.size !== sourcePairs.length) invalid("pair_coverage", "Final review omitted one or more managed pairs.");
  pairs.sort((left, right) => left.rank - right.rank);
  return { reviewVersion: 1, status: "reviewed", pairs };
}

export function createFailedFinalReviewResult(
  execution: ComfyUiExecutionTimelineResult,
  error: FinalReviewTimelineResult["error"],
): FinalReviewTimelineResult {
  return { reviewVersion: 1, status: "failed", pairs: getCompletedFinalReviewPairs(execution), error };
}

export function getFinalReviewResult(workflow: TimelineWorkflowState) {
  const value = workflow.nodes["final-review"].result;
  return isRecord(value) && value.reviewVersion === 1 && Array.isArray(value.pairs)
    ? value as FinalReviewTimelineResult
    : null;
}

export function selectFinalReviewVariant(
  workflow: TimelineWorkflowState,
  candidateId: string,
  variant: "final" | "preview-upscale",
  updatedAt = new Date().toISOString(),
) {
  const review = getFinalReviewResult(workflow);
  if (!review || !review.pairs.some((pair) => pair.candidateId === candidateId)) return workflow;
  return {
    ...workflow,
    updatedAt,
    nodes: {
      ...workflow.nodes,
      "final-review": {
        ...workflow.nodes["final-review"],
        updatedAt,
        result: {
          ...review,
          pairs: review.pairs.map((pair) => pair.candidateId === candidateId
            ? { ...pair, userSelectedVariant: variant }
            : pair),
        },
      },
    },
  };
}
