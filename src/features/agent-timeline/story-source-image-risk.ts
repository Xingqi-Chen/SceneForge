import type {
  ShotDependencyGraph,
  ShotDependencyGraphEdge,
  StoryShot,
  StoryShotId,
  StorySourceImageEdgeSummary,
  StorySourceImageRiskMetadata,
} from "./story-types";

type SourceImageEdgeExecutionOptions = {
  allowHighRiskSourceEdges?: boolean;
};

const lowRiskSourceImage = {
  factors: [],
  level: "low",
  reason: "Source shot appears compatible with loose img2img continuity.",
} satisfies StorySourceImageRiskMetadata;

function getShotText(shot: StoryShot) {
  return [
    shot.title,
    shot.description,
    shot.camera,
    shot.promptIntent,
    ...shot.characterIds,
    ...shot.continuityNotes,
  ].join(" ").toLocaleLowerCase();
}

function getPoseStates(text: string) {
  const states = new Set<string>();

  if (/\b(?:stands?|standing|upright)\b/.test(text)) {
    states.add("standing");
  }

  if (/\b(?:kneels?|kneeling|on one knee|on both knees)\b/.test(text)) {
    states.add("kneeling");
  }

  if (/\b(?:sits?|sitting|seated|in a chair|on a chair)\b/.test(text)) {
    states.add("sitting");
  }

  if (/\b(?:runs?|running|sprints?|sprinting|dashes?|dashing)\b/.test(text)) {
    states.add("running");
  }

  if (/\b(?:lies?|lying|reclining|prone|supine)\b/.test(text)) {
    states.add("lying");
  }

  return states;
}

function getMajorPoseTransition(sourceText: string, targetText: string) {
  const source = getPoseStates(sourceText);
  const target = getPoseStates(targetText);
  const transitions: string[] = [];

  if (source.has("standing") && target.has("kneeling")) {
    transitions.push("standing to kneeling");
  }

  if (source.has("kneeling") && target.has("standing")) {
    transitions.push("kneeling to standing");
  }

  if (source.has("sitting") && target.has("running")) {
    transitions.push("sitting to running");
  }

  if (source.has("lying") && (target.has("standing") || target.has("running"))) {
    transitions.push("lying to upright action");
  }

  return transitions;
}

function getCameraScale(text: string) {
  if (/\b(?:close[- ]?up|closeup|extreme close|tight close|macro)\b/.test(text)) {
    return "close";
  }

  if (/\b(?:wide|establishing|long shot|full[- ]body|full body|distant|far shot)\b/.test(text)) {
    return "wide";
  }

  if (/\b(?:medium|waist[- ]up|three[- ]quarter)\b/.test(text)) {
    return "medium";
  }

  return "";
}

function getSceneResetReason(source: StoryShot, target: StoryShot, targetText: string) {
  if (source.locationId && target.locationId && source.locationId !== target.locationId) {
    return `scene changes from ${source.locationId} to ${target.locationId}`;
  }

  if (/\b(?:large scene reset|scene reset|hard cut|cutaway|cut to|meanwhile|elsewhere|different location|new location|new scene)\b/.test(targetText)) {
    return "target shot asks for a scene reset or unrelated location cut";
  }

  return "";
}

function getCameraResetReason(sourceText: string, targetText: string) {
  const sourceScale = getCameraScale(sourceText);
  const targetScale = getCameraScale(targetText);

  if (sourceScale === "close" && targetScale === "wide") {
    return "camera changes from close-up to wide framing";
  }

  return "";
}

function getCompositionResetReason(targetText: string) {
  if (/\b(?:large composition reset|composition reset|new composition|reframe completely|completely new framing)\b/.test(targetText)) {
    return "target shot asks for a composition reset";
  }

  return "";
}

export function assessStorySourceImageRisk(
  sourceShot: StoryShot,
  targetShot: StoryShot,
): StorySourceImageRiskMetadata {
  const sourceText = getShotText(sourceShot);
  const targetText = getShotText(targetShot);
  const highRiskFactors = [
    ...getMajorPoseTransition(sourceText, targetText).map((transition) => `major pose/action change: ${transition}`),
    getCameraResetReason(sourceText, targetText),
    getCompositionResetReason(targetText),
    getSceneResetReason(sourceShot, targetShot, targetText),
  ].filter(Boolean);

  if (highRiskFactors.length > 0) {
    return {
      factors: highRiskFactors,
      level: "high",
      reason: `High source-image risk: ${highRiskFactors.join("; ")}.`,
    };
  }

  const sourceScale = getCameraScale(sourceText);
  const targetScale = getCameraScale(targetText);
  const mediumRiskFactors = [
    sourceScale && targetScale && sourceScale !== targetScale
      ? `camera scale changes from ${sourceScale} to ${targetScale}`
      : "",
  ].filter(Boolean);

  if (mediumRiskFactors.length > 0) {
    return {
      factors: mediumRiskFactors,
      level: "medium",
      reason: `Moderate source-image risk: ${mediumRiskFactors.join("; ")}.`,
    };
  }

  return lowRiskSourceImage;
}

export function getStorySourceImageRiskForEdge(
  edge: Pick<ShotDependencyGraphEdge, "fromShotId" | "toShotId">,
  shots: readonly StoryShot[],
) {
  const sourceShot = shots.find((shot) => shot.id === edge.fromShotId);
  const targetShot = shots.find((shot) => shot.id === edge.toShotId);

  return sourceShot && targetShot ? assessStorySourceImageRisk(sourceShot, targetShot) : lowRiskSourceImage;
}

export function shouldExecuteStorySourceImageEdge(
  edge: ShotDependencyGraphEdge,
  shots: readonly StoryShot[],
  options: SourceImageEdgeExecutionOptions = {},
) {
  if (edge.reason !== "img2img-source") {
    return false;
  }

  const risk = edge.sourceImageRisk ?? getStorySourceImageRiskForEdge(edge, shots);

  return risk.level !== "high" || options.allowHighRiskSourceEdges === true;
}

export function addStorySourceImageRiskToEdge(
  edge: ShotDependencyGraphEdge,
  shots: readonly StoryShot[],
): ShotDependencyGraphEdge {
  const sourceImageRisk = edge.sourceImageRisk ?? getStorySourceImageRiskForEdge(edge, shots);
  const reason = edge.reason === "img2img-source" && sourceImageRisk.level === "high"
    ? "continuity"
    : edge.reason;

  return {
    ...edge,
    reason,
    sourceImageRisk,
  };
}

function collectSourceChain(
  shotId: StoryShotId,
  dependenciesByShot: Map<StoryShotId, StoryShotId[]>,
  seen = new Set<StoryShotId>(),
): StoryShotId[] {
  if (seen.has(shotId)) {
    return [shotId];
  }

  seen.add(shotId);
  const sources = dependenciesByShot.get(shotId) ?? [];

  if (sources.length === 0) {
    return [shotId];
  }

  return [
    ...sources.flatMap((sourceShotId) => collectSourceChain(sourceShotId, dependenciesByShot, new Set(seen))),
    shotId,
  ];
}

function uniqueShotIds(values: StoryShotId[]) {
  return [...new Set(values)];
}

export function createStorySourceImageEdgeSummaries(
  shots: readonly StoryShot[],
): StorySourceImageEdgeSummary[] {
  const dependenciesByShot = new Map<StoryShotId, StoryShotId[]>();

  for (const shot of shots) {
    if (shot.sourceShotIds.length > 0) {
      dependenciesByShot.set(shot.id, [...shot.sourceShotIds]);
    }
  }

  return shots.flatMap((targetShot) =>
    targetShot.sourceShotIds.map((sourceShotId) => {
      const sourceShot = shots.find((candidate) => candidate.id === sourceShotId);
      const risk = sourceShot ? assessStorySourceImageRisk(sourceShot, targetShot) : lowRiskSourceImage;

      return {
        executable: true,
        riskFactors: [...risk.factors],
        riskLevel: risk.level,
        riskReason: risk.reason,
        sourceChain: uniqueShotIds([
          ...collectSourceChain(sourceShotId, dependenciesByShot),
          targetShot.id,
        ]),
        sourceShotId,
        targetShotId: targetShot.id,
      };
    }),
  );
}

export function createStoryDependencySourceImageRiskSummaries(
  graph: ShotDependencyGraph,
  shots: readonly StoryShot[],
): StorySourceImageEdgeSummary[] {
  return graph.edges.map((edge) => {
    const risk = edge.sourceImageRisk ?? getStorySourceImageRiskForEdge(edge, shots);

    return {
      executable: shouldExecuteStorySourceImageEdge(edge, shots, { allowHighRiskSourceEdges: true }),
      riskFactors: [...risk.factors],
      riskLevel: risk.level,
      riskReason: risk.reason,
      sourceChain: [edge.fromShotId, edge.toShotId],
      sourceShotId: edge.fromShotId,
      targetShotId: edge.toShotId,
    };
  });
}
