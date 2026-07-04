import {
  storyWorkflowNodeIds,
  type StoryWorkflowNodeId,
} from "./story-types";
import { formatPromptProfileLabel, isPromptProfileId } from "@/shared/prompt-profile";

export type StoryNodeSummaryMetric = {
  label: string;
  value: string;
};

export type StoryNodeSummaryRow = Record<string, string>;

export type StoryNodeSummarySection = {
  emptyState?: string;
  fields?: StoryNodeSummaryMetric[];
  notes?: string[];
  rows?: StoryNodeSummaryRow[];
  title: string;
};

export type StoryShotSummaryTone = "neutral" | "ready" | "review" | "warning";

export type StoryShotPromptHealthIssue = {
  detail: string;
  label: string;
  severity: "error" | "warning";
};

export type StoryShotPromptHealth = {
  issues: StoryShotPromptHealthIssue[];
  label: string;
  tone: StoryShotSummaryTone;
};

export type StoryShotAnimaPromptPartGroup = {
  label: string;
  value: string;
};

export type StoryShotPromptSectionGroup = StoryShotAnimaPromptPartGroup;

export type StoryShotSourceRiskSummary = {
  detail: string;
  label: string;
  level: string;
};

export type StoryShotWarningDisplayMode = "all" | "llm-only";

export type StoryShotSummaryCard = {
  animaPromptParts?: StoryShotAnimaPromptPartGroup[];
  dependencies: string;
  imageLabel?: string;
  imageUrl?: string;
  negativePrompt?: string;
  parameters?: string;
  promptHealth: StoryShotPromptHealth;
  promptProfile?: string;
  promptSections?: StoryShotPromptSectionGroup[];
  readinessDetail?: string;
  readinessLabel: string;
  readinessTone: StoryShotSummaryTone;
  removedNegatives: string[];
  resources?: string;
  sceneBeat: string;
  shotId: string;
  shotNumber: string;
  sourceRisks: StoryShotSourceRiskSummary[];
  status?: string;
  title: string;
  visualPrompt?: string;
  warningDisplayMode?: StoryShotWarningDisplayMode;
  warnings?: string[];
};

export type StoryNodeOutputSummary = {
  metrics: StoryNodeSummaryMetric[];
  sections: StoryNodeSummarySection[];
  shotCards?: StoryShotSummaryCard[];
  title: string;
};

const maxPreviewLength = 180;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compactText(value: unknown, maxLength = maxPreviewLength) {
  if (typeof value !== "string") {
    return "";
  }

  const compacted = value.replace(/\s+/g, " ").trim();
  return maxLength > 0 ? compacted : "";
}

function fullText(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function asStringArray(value: unknown, maxItems = 6) {
  void maxItems;
  return Array.isArray(value)
    ? value.map((item) => compactText(item, 80)).filter(Boolean)
    : [];
}

function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatList(value: unknown, empty = "None") {
  const items = asStringArray(value, 5);
  return items.length > 0 ? items.join(", ") : empty;
}

function formatBoolean(value: unknown) {
  return value === true ? "Yes" : value === false ? "No" : "Unknown";
}

function formatNumber(value: unknown, fallback = "Unknown") {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : fallback;
}

function formatParameters(value: unknown) {
  if (!isRecord(value)) {
    return "Unknown";
  }

  const resolution = typeof value.width === "number" && typeof value.height === "number"
    ? `${value.width}x${value.height}`
    : "";
  const sampler = [value.samplerName, value.scheduler].map((item) => compactText(item, 40)).filter(Boolean).join(" / ");
  const steps = formatNumber(value.steps, "");
  const cfg = formatNumber(value.cfg, "");
  const denoise = formatNumber(value.denoise, "");

  return [
    resolution,
    steps ? `${steps} steps` : "",
    cfg ? `CFG ${cfg}` : "",
    sampler,
    denoise ? `denoise ${denoise}` : "",
  ].filter(Boolean).join(", ") || "Unknown";
}

function fullStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => fullText(item)).filter(Boolean)
    : [];
}

function splitPromptParts(value: unknown) {
  return fullText(value)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function promptWordCount(value: string) {
  return value.split(/\s+/).filter(Boolean).length;
}

function getAnimaPromptPartValues(animaPromptParts: unknown, keys: string[]) {
  if (!isRecord(animaPromptParts)) {
    return [];
  }

  return keys.flatMap((key) => fullStringArray(animaPromptParts[key]));
}

function hasAnimaPromptPartOrPattern({
  animaPromptParts,
  keys,
  pattern,
  prompt,
}: {
  animaPromptParts: unknown;
  keys: string[];
  pattern: RegExp;
  prompt: string;
}) {
  return getAnimaPromptPartValues(animaPromptParts, keys).length > 0 || pattern.test(prompt);
}

function getMissingPromptInfoIssues(positivePrompt: string, animaPromptParts: unknown): StoryShotPromptHealthIssue[] {
  const checks = [
    {
      detail: "Add a clear character, subject, or object identity.",
      keys: ["subjectTags", "characterTags", "outfitTags", "propTags"],
      label: "Missing identity",
      pattern: /\b(?:adult|artist|boy|character|child|courier|detective|girl|man|person|people|protagonist|student|woman)\b.{0,80}\b(?:coat|dress|glasses|hair|jacket|shirt|uniform|wearing|with)\b/i,
    },
    {
      detail: "Add a visible action, pose, or interaction.",
      keys: ["actionTags"],
      label: "Missing action",
      pattern: /\b(?:carrying|crouching|facing|holding|kneeling|leaning|looking|opening|pointing|reaching|running|sitting|standing|walking)\b/i,
    },
    {
      detail: "Add a concrete location or environmental setting.",
      keys: ["settingTags"],
      label: "Missing setting",
      pattern: /\b(?:alley|apartment|beach|bedroom|cafe|city|classroom|corridor|forest|garden|hallway|interior|kitchen|library|market|park|room|station|street|studio)\b/i,
    },
    {
      detail: "Add framing, camera scale, angle, or composition guidance.",
      keys: ["cameraTags"],
      label: "Missing camera",
      pattern: /\b(?:camera|close[- ]?up|composition|eye[- ]level|framing|medium shot|over[- ]the[- ]shoulder|perspective|portrait|wide shot)\b/i,
    },
    {
      detail: "Add lighting, time of day, or visible atmosphere.",
      keys: ["lightingTags"],
      label: "Missing lighting",
      pattern: /\b(?:backlight|blue hour|candlelight|daylight|glow|golden hour|lamp|light|lighting|moonlight|neon|shadow|sunlight|window light)\b/i,
    },
  ];

  return checks
    .filter((check) =>
      !hasAnimaPromptPartOrPattern({
        animaPromptParts,
        keys: check.keys,
        pattern: check.pattern,
        prompt: positivePrompt,
      }),
    )
    .map((check) => ({
      detail: check.detail,
      label: check.label,
      severity: "warning" as const,
    }));
}

function getTooShortPromptIssue(positivePrompt: string): StoryShotPromptHealthIssue | null {
  const parts = splitPromptParts(positivePrompt);

  if (!positivePrompt) {
    return {
      detail: "The positive prompt is empty.",
      label: "Missing prompt",
      severity: "error",
    };
  }

  if (
    parts.length > 0 &&
    (parts.length < 6 || (positivePrompt.length < 90 && parts.every((part) => promptWordCount(part) <= 3)))
  ) {
    return {
      detail: "Prompt reads like a short tag list; add identity, action, setting, camera, and lighting clauses.",
      label: "Too short",
      severity: "warning",
    };
  }

  return null;
}

function getHardcodedPromptIssues(positivePrompt: string): StoryShotPromptHealthIssue[] {
  const checks = [
    {
      detail: "Prompt contains an inline LoRA tag; Story prompts should read as visual text.",
      label: "Hardcoded LoRA tag",
      pattern: /<lora:[^>]+>/i,
    },
    {
      detail: "Prompt contains a URL or generated-image route.",
      label: "Debug URL fragment",
      pattern: /\bhttps?:\/\/|\/api\/comfyui\/|view\?filename=/i,
    },
    {
      detail: "Prompt contains workflow or queue field names.",
      label: "Debug field fragment",
      pattern: /\b(?:nodeId|outputNodeId|promptId|queueMetadata|workflow)\b/i,
    },
    {
      detail: "Prompt appears to include an internal shot id.",
      label: "Shot id fragment",
      pattern: /\bshot[-_]\d+\b/i,
    },
    {
      detail: "Prompt appears to include serialized JSON instead of visual prose.",
      label: "JSON fragment",
      pattern: /[{][^{}]*["']?[a-z][a-z0-9_ -]*["']?\s*:/i,
    },
  ];

  return checks
    .filter((check) => check.pattern.test(positivePrompt))
    .map((check) => ({
      detail: check.detail,
      label: check.label,
      severity: "warning" as const,
    }));
}

function getRemovedNegativeSummaries(warnings: string[]) {
  return warnings.flatMap((warning) => {
    const match = warning.match(/removed negative addition "([^"]+)" because it conflicts with positive prompt anchor "([^"]+)"/i);
    const removed = match?.[1];
    const anchor = match?.[2];

    return removed && anchor
      ? [`Removed "${removed}" because it conflicts with "${anchor}".`]
      : [];
  });
}

function getWarningsForShot(shotId: string, shotWarnings: unknown, globalWarnings: unknown) {
  return [
    ...fullStringArray(shotWarnings),
    ...fullStringArray(globalWarnings).filter((warning) => !shotId || warning.includes(`"${shotId}"`) || warning.includes(shotId)),
  ];
}

function isRenderPlanDecisionNote(warning: string) {
  return [
    /^Using \d+x\d+\b/i,
    /^Kept the default\b/i,
    /^No per-shot overrides\b/i,
    /^The selected .*?\b(?:so|because)\b/i,
    /^Avoid .*? unless\b/i,
    /^.*? may be tempting\b/i,
  ].some((pattern) => pattern.test(warning));
}

function isRenderPlanSystemDiagnostic(warning: string) {
  return /^Shot "[^"]+" uses high-risk source image\b/i.test(warning)
    || /^Shot "[^"]+" did not receive LLM (?:Anima prompt parts|prompt sections)\b/i.test(warning);
}

function getRenderPlanWarningSections(warnings: unknown): {
  decisionNotes: string[];
  systemDiagnostics: string[];
  warningNotes: string[];
} {
  const warningNotes: string[] = [];
  const decisionNotes: string[] = [];
  const systemDiagnostics: string[] = [];

  for (const warning of fullStringArray(warnings)) {
    if (isRenderPlanSystemDiagnostic(warning)) {
      systemDiagnostics.push(warning);
    } else if (isRenderPlanDecisionNote(warning)) {
      decisionNotes.push(warning);
    } else {
      warningNotes.push(warning);
    }
  }

  return {
    decisionNotes,
    systemDiagnostics,
    warningNotes,
  };
}

function getSourceRiskSummaries(value: unknown): StoryShotSourceRiskSummary[] {
  return asRecordArray(value)
    .map((edge) => {
      const level = compactText(edge.riskLevel, 40) || compactText(isRecord(edge.sourceImageRisk) ? edge.sourceImageRisk.level : undefined, 40) || "unknown";
      const reason = compactText(edge.riskReason, 220) || compactText(isRecord(edge.sourceImageRisk) ? edge.sourceImageRisk.reason : undefined, 220) || "No risk reason.";
      const source = compactText(edge.sourceShotId, 80) || compactText(edge.fromShotId, 80);
      const target = compactText(edge.targetShotId, 80) || compactText(edge.toShotId, 80);
      const chain = formatList(edge.sourceChain, "");

      return {
        detail: [reason, chain ? `Chain: ${chain}` : ""].filter(Boolean).join(" "),
        label: [source && target ? `${source} -> ${target}` : "Source edge", level].filter(Boolean).join(" / "),
        level,
      };
    });
}

export function createStoryPromptHealth({
  animaPromptParts,
  positivePrompt,
  promptWarnings = [],
  sourceImageEdges = [],
}: {
  animaPromptParts?: unknown;
  positivePrompt?: unknown;
  promptWarnings?: string[];
  sourceImageEdges?: unknown;
}): StoryShotPromptHealth {
  const positive = fullText(positivePrompt);
  const sourceRiskIssues = getSourceRiskSummaries(sourceImageEdges)
    .filter((risk) => risk.level === "high")
    .map((risk) => ({
      detail: risk.detail,
      label: "High source-image risk",
      severity: "warning" as const,
    }));
  const removedNegativeIssues = getRemovedNegativeSummaries(promptWarnings).map((detail) => ({
    detail,
    label: "Removed negative conflict",
    severity: "warning" as const,
  }));
  const issues = [
    getTooShortPromptIssue(positive),
    ...getMissingPromptInfoIssues(positive, animaPromptParts),
    ...getHardcodedPromptIssues(positive),
    ...removedNegativeIssues,
    ...sourceRiskIssues,
  ].filter((issue): issue is StoryShotPromptHealthIssue => Boolean(issue));
  const tone: StoryShotSummaryTone = issues.some((issue) => issue.severity === "error")
    ? "review"
    : issues.length > 0
      ? "warning"
      : "ready";

  return {
    issues,
    label: tone === "ready" ? "Healthy" : tone === "review" ? "Needs review" : "Warnings",
    tone,
  };
}

function getReadinessFromHealth(
  health: StoryShotPromptHealth,
  override?: {
    detail?: string;
    label?: string;
    tone?: StoryShotSummaryTone;
  },
) {
  if (override?.label) {
    return {
      detail: override.detail,
      label: override.label,
      tone: override.tone ?? "neutral",
    };
  }

  if (health.tone === "ready") {
    return {
      detail: "Prompt has enough visible detail for generation review.",
      label: "Ready",
      tone: "ready" as const,
    };
  }

  return {
    detail: health.issues.map((issue) => issue.label).join(", "),
    label: health.tone === "review" ? "Needs review" : "Warning",
    tone: health.tone,
  };
}

function getReadinessFromLlmWarnings(warnings: string[]) {
  return warnings.length > 0
    ? {
        detail: "Review LLM render-plan warnings before generation.",
        label: "Warning",
        tone: "warning" as const,
      }
    : {
        detail: undefined,
        label: "Ready",
        tone: "ready" as const,
      };
}

function getPromptShotReadiness({
  health,
  warningDisplayMode,
  warnings,
}: {
  health: StoryShotPromptHealth;
  warningDisplayMode: StoryShotWarningDisplayMode;
  warnings: string[];
}) {
  if (health.tone !== "ready") {
    return getReadinessFromHealth(health);
  }

  return warningDisplayMode === "llm-only"
    ? getReadinessFromLlmWarnings(warnings)
    : getReadinessFromHealth(health);
}

function getStoryId(result: unknown) {
  return isRecord(result) && typeof result.storyId === "string" ? result.storyId : "";
}

function getPromptProfile(settingsSnapshot: unknown) {
  return isRecord(settingsSnapshot) && typeof settingsSnapshot.promptProfile === "string"
    ? settingsSnapshot.promptProfile
    : "default";
}

function getResourceCandidateCounts(settingsSnapshot: unknown) {
  if (!isRecord(settingsSnapshot)) {
    return { checkpoints: 0, loras: 0 };
  }

  if (isRecord(settingsSnapshot.resourceCandidateCounts)) {
    return {
      checkpoints: Number(settingsSnapshot.resourceCandidateCounts.checkpoints) || 0,
      loras: Number(settingsSnapshot.resourceCandidateCounts.loras) || 0,
    };
  }

  if (isRecord(settingsSnapshot.resourceCandidates)) {
    return {
      checkpoints: Array.isArray(settingsSnapshot.resourceCandidates.checkpoints)
        ? settingsSnapshot.resourceCandidates.checkpoints.length
        : 0,
      loras: Array.isArray(settingsSnapshot.resourceCandidates.loras)
        ? settingsSnapshot.resourceCandidates.loras.length
        : 0,
    };
  }

  return { checkpoints: 0, loras: 0 };
}

function summarizeStoryInput(result: unknown): StoryNodeOutputSummary {
  const input = isRecord(result) ? result : {};
  const settingsSnapshot = input.settingsSnapshot;
  const counts = getResourceCandidateCounts(settingsSnapshot);

  return {
    title: "Story input summary",
    metrics: [
      { label: "Shots", value: formatNumber(input.targetShotCount, "AI decides") },
      { label: "Rating", value: compactText(input.audienceRating, 40) || "safe" },
      { label: "Profile", value: getPromptProfile(settingsSnapshot) },
      { label: "Resources", value: `${counts.checkpoints} checkpoints, ${counts.loras} LoRAs` },
    ],
    sections: [
      {
        title: "Story request",
        fields: [
          { label: "Story ID", value: getStoryId(input) || "Pending" },
          { label: "Request", value: compactText(input.rawIntent, 420) || "No story request." },
        ],
      },
      {
        title: "Context",
        fields: [
          { label: "NSFW enabled", value: formatBoolean(isRecord(input.nsfwContext) ? input.nsfwContext.enabled : undefined) },
          { label: "Segments", value: countLabel(Array.isArray(input.storySegments) ? input.storySegments.length : 0, "segment") },
        ],
      },
    ],
  };
}

function summarizeStoryBible(result: unknown): StoryNodeOutputSummary {
  const bible = isRecord(result) ? result : {};
  const characters = asRecordArray(bible.characters);
  const locations = asRecordArray(bible.locations);

  return {
    title: "Story bible summary",
    metrics: [
      { label: "Characters", value: String(characters.length) },
      { label: "Locations", value: String(locations.length) },
      { label: "Genres", value: formatList(bible.genre) },
    ],
    sections: [
      {
        title: "Premise",
        fields: [
          { label: "Title", value: compactText(bible.title, 120) || "Untitled" },
          { label: "Logline", value: compactText(bible.logline, 320) || "No logline." },
          { label: "Visual style", value: compactText(bible.visualStyle, 240) || "No visual style." },
        ],
      },
      {
        title: "Characters",
        emptyState: "No characters.",
        rows: characters.map((character) => ({
          name: compactText(character.name, 80) || compactText(character.id, 80),
          role: compactText(character.role, 80),
          anchors: formatList(character.visualAnchors),
        })),
      },
      {
        title: "Locations",
        emptyState: "No locations.",
        rows: locations.map((location) => ({
          name: compactText(location.name, 80) || compactText(location.id, 80),
          description: compactText(location.description, 140),
          anchors: formatList(location.visualAnchors),
        })),
      },
    ],
  };
}

function summarizeStoryOutline(result: unknown): StoryNodeOutputSummary {
  const outline = isRecord(result) ? result : {};
  const beats = asRecordArray(outline.beats);

  return {
    title: "Story outline summary",
    metrics: [{ label: "Beats", value: String(beats.length) }],
    sections: [
      {
        title: "Beats",
        emptyState: "No beats.",
        rows: beats.map((beat) => ({
          order: formatNumber(beat.order, ""),
          title: compactText(beat.title, 100),
          summary: compactText(beat.summary, 180),
        })),
      },
    ],
  };
}

function summarizeStoryboardShots(result: unknown): StoryNodeOutputSummary {
  const shots = asRecordArray(result);

  return {
    title: "Storyboard shots summary",
    metrics: [{ label: "Shots", value: String(shots.length) }],
    sections: [
      {
        title: "Shots",
        emptyState: "No storyboard shots.",
        rows: shots.map((shot) => ({
          order: formatNumber(shot.order, ""),
          title: compactText(shot.title, 100) || compactText(shot.id, 80),
          camera: compactText(shot.camera, 100),
          intent: compactText(shot.promptIntent, 180),
          sources: formatList(shot.sourceShotIds),
        })),
      },
    ],
  };
}

function summarizeStorySafety(result: unknown): StoryNodeOutputSummary {
  const safety = isRecord(result) ? result : {};
  const notes = asRecordArray(safety.perShotNotes);

  return {
    title: "Story safety summary",
    metrics: [
      { label: "Rating", value: compactText(safety.audienceRating, 40) || "safe" },
      { label: "Warnings", value: String(asStringArray(safety.contentWarnings, 20).length) },
      { label: "Blocked", value: String(asStringArray(safety.blockedContent, 20).length) },
    ],
    sections: [
      {
        title: "Story risks",
        fields: [
          { label: "Content warnings", value: formatList(safety.contentWarnings) },
          { label: "Blocked content", value: formatList(safety.blockedContent) },
          { label: "NSFW rationale", value: compactText(isRecord(safety.nsfwContext) ? safety.nsfwContext.rationale : undefined, 180) || "None" },
        ],
      },
      {
        title: "Per-shot risk counts",
        emptyState: "No per-shot risks.",
        rows: notes.map((note) => ({
          shot: compactText(note.shotId, 80),
          risks: String(asStringArray(note.risks, 20).length),
          mitigations: String(asStringArray(note.mitigations, 20).length),
        })),
      },
    ],
  };
}

function summarizeShotDependencyGraph(result: unknown): StoryNodeOutputSummary {
  const graph = isRecord(result) ? result : {};
  const nodes = asRecordArray(graph.nodes);
  const edges = asRecordArray(graph.edges);
  const sourceEdges = edges.filter((edge) => edge.reason === "img2img-source");
  const riskEdges = edges.filter((edge) => isRecord(edge.sourceImageRisk));

  return {
    title: "Shot dependency summary",
    metrics: [
      { label: "Shots", value: String(nodes.length) },
      { label: "Injected source edges", value: String(sourceEdges.length) },
      { label: "Risk checks", value: String(riskEdges.length) },
    ],
    sections: [
      {
        title: "Img2img source edges",
        emptyState: "No source-image dependencies.",
        rows: sourceEdges.map((edge) => ({
          from: compactText(edge.fromShotId, 80),
          to: compactText(edge.toShotId, 80),
          reason: "img2img-source",
          risk: compactText(isRecord(edge.sourceImageRisk) ? edge.sourceImageRisk.level : undefined, 40) || "unknown",
        })),
      },
      {
        title: "Source-image risk decisions",
        emptyState: "No source-image risk decisions.",
        rows: riskEdges.map((edge) => {
          const risk = isRecord(edge.sourceImageRisk) ? edge.sourceImageRisk : {};
          const executable = edge.reason === "img2img-source";
          return {
            from: compactText(edge.fromShotId, 80),
            to: compactText(edge.toShotId, 80),
            "edge reason": compactText(edge.reason, 80) || "unknown",
            "source image injected": executable ? "Yes" : "No",
            mode: executable ? "Source image injected" : "Prompt-only continuity",
            risk: compactText(risk.level, 40) || "unknown",
            "risk reason": compactText(risk.reason, 180) || "No risk reason.",
          };
        }),
      },
    ],
  };
}

function summarizePlotStateGraph(result: unknown): StoryNodeOutputSummary {
  const graph = isRecord(result) ? result : {};
  const states = asRecordArray(graph.states);
  const transitions = asRecordArray(graph.transitions);

  return {
    title: "Plot state summary",
    metrics: [
      { label: "States", value: String(states.length) },
      { label: "Transitions", value: String(transitions.length) },
    ],
    sections: [
      {
        title: "States",
        emptyState: "No plot states.",
        rows: states.map((state) => ({
          state: compactText(state.title, 100) || compactText(state.id, 80),
          shots: formatList(state.shotIds),
          summary: compactText(state.summary, 180),
        })),
      },
    ],
  };
}

function summarizeCharacterContinuity(result: unknown): StoryNodeOutputSummary {
  const graph = isRecord(result) ? result : {};
  const characters = asRecordArray(graph.characters);
  const appearances = asRecordArray(graph.appearances);

  return {
    title: "Character continuity summary",
    metrics: [
      { label: "Characters", value: String(characters.length) },
      { label: "Appearances", value: String(appearances.length) },
    ],
    sections: [
      {
        title: "Canonical characters",
        emptyState: "No character continuity records.",
        rows: characters.map((character) => ({
          character: compactText(character.name, 80) || compactText(character.characterId, 80),
          anchors: formatList(character.visualAnchors),
          description: compactText(character.canonicalDescription, 180),
        })),
      },
      {
        title: "Appearances",
        emptyState: "No shot appearances.",
        rows: appearances.map((appearance) => ({
          shot: compactText(appearance.shotId, 80),
          character: compactText(appearance.characterId, 80),
          action: compactText(appearance.poseOrAction, 120),
          expression: compactText(appearance.expression, 80),
        })),
      },
    ],
  };
}

function summarizeResourcePlan(result: unknown): StoryNodeOutputSummary {
  const plan = isRecord(result) ? result : {};
  const checkpoint = isRecord(plan.checkpoint) ? plan.checkpoint : {};
  const checkpointResource = isRecord(checkpoint.resource) ? checkpoint.resource : {};
  const loras = asRecordArray(plan.loras);

  return {
    title: "Resource plan summary",
    metrics: [
      { label: "Checkpoint", value: compactText(checkpointResource.name, 80) || "None" },
      { label: "LoRAs", value: String(loras.length) },
    ],
    sections: [
      {
        title: "Checkpoint",
        fields: [
          { label: "Name", value: compactText(checkpointResource.name, 120) || "None" },
          { label: "File", value: compactText(checkpointResource.modelFileName, 120) || "Unknown" },
          { label: "Reason", value: compactText(checkpoint.reason, 220) || "No reason." },
        ],
      },
      {
        title: "LoRAs",
        emptyState: "No LoRAs selected.",
        rows: loras.map((lora) => {
          const resource = isRecord(lora.resource) ? lora.resource : {};
          return {
            name: compactText(resource.name, 100),
            weight: lora.suggestedWeight === null || lora.suggestedWeight === undefined
              ? "default"
              : formatNumber(lora.suggestedWeight),
            reason: compactText(lora.reason, 160),
          };
        }),
      },
    ],
  };
}

function summarizeParameterPlan(result: unknown): StoryNodeOutputSummary {
  const plan = isRecord(result) ? result : {};
  const overrides = asRecordArray(plan.perShotOverrides);

  return {
    title: "Parameter plan summary",
    metrics: [
      { label: "Defaults", value: formatParameters(plan.defaults) },
      { label: "Overrides", value: String(overrides.length) },
    ],
    sections: [
      {
        title: "Defaults",
        fields: [{ label: "Parameters", value: formatParameters(plan.defaults) }],
      },
      {
        title: "Per-shot overrides",
        emptyState: "No per-shot overrides.",
        rows: overrides.map((override) => ({
          shot: compactText(override.shotId, 80),
          parameters: formatParameters(override.parameters),
          reason: compactText(override.reason, 160) || "No reason.",
        })),
      },
    ],
  };
}

function getRenderResourceNames(plan: Record<string, unknown>, shot: Record<string, unknown>) {
  if (isRecord(plan.resourceRefs)) {
    const checkpoint = isRecord(plan.resourceRefs.checkpoint) ? compactText(plan.resourceRefs.checkpoint.name, 80) : "";
    const loras = asRecordArray(plan.resourceRefs.loras).map((lora) => compactText(lora.name, 80)).filter(Boolean);
    return [checkpoint, ...loras].filter(Boolean).join(", ") || "Resource plan";
  }

  if (isRecord(shot.resources)) {
    const checkpoint = isRecord(shot.resources.checkpoint) && isRecord(shot.resources.checkpoint.resource)
      ? compactText(shot.resources.checkpoint.resource.name, 80)
      : "";
    const loras = asRecordArray(shot.resources.loras).map((lora) =>
      isRecord(lora.resource) ? compactText(lora.resource.name, 80) : "",
    ).filter(Boolean);
    return [checkpoint, ...loras].filter(Boolean).join(", ") || "Legacy resources";
  }

  return "Resource plan";
}

function getShotNumber(shot: Record<string, unknown>, index: number) {
  return typeof shot.order === "number" && Number.isFinite(shot.order)
    ? String(shot.order)
    : String(index + 1);
}

function getShotTitle(shot: Record<string, unknown>) {
  return compactText(shot.title, 120) || compactText(shot.shotId, 80) || "Untitled shot";
}

function getShotDependencies(sourceShotIds: unknown, sourceMode?: unknown) {
  const sources = fullStringArray(sourceShotIds);

  if (sources.length > 0) {
    return `${compactText(sourceMode, 40) || "source-image"} from ${sources.join(", ")}`;
  }

  return compactText(sourceMode, 40) === "source-image" ? "Source image pending" : "Text-to-image";
}

const storyAnimaPromptPartGroupSpecs = [
  { key: "subjectTags", label: "Subject" },
  { key: "characterTags", label: "Character" },
  { key: "seriesTags", label: "Series" },
  { key: "artistTags", label: "Artist" },
  { key: "outfitTags", label: "Outfit" },
  { key: "propTags", label: "Props" },
  { key: "actionTags", label: "Action" },
  { key: "settingTags", label: "Setting" },
  { key: "cameraTags", label: "Camera" },
  { key: "lightingTags", label: "Lighting" },
  { key: "styleTags", label: "Style" },
  { key: "singleFrameCaption", label: "Caption" },
  { key: "negativeAdditions", label: "Negative additions" },
] as const;

const storyIllustriousSectionGroupSpecs = [
  { key: "quality", label: "Quality" },
  { key: "aestheticVersion", label: "Aesthetic" },
  { key: "rating", label: "Rating" },
  { key: "artistStyle", label: "Artist style" },
  { key: "subjectIdentity", label: "Subject" },
  { key: "appearancePhysicalTraits", label: "Appearance" },
  { key: "clothingAccessories", label: "Clothing" },
  { key: "poseActionExpression", label: "Action" },
  { key: "backgroundEnvironmentObjects", label: "Environment" },
  { key: "spatialComposition", label: "Composition" },
  { key: "cameraFraming", label: "Camera" },
  { key: "lightingFocus", label: "Lighting" },
  { key: "detailResolution", label: "Detail" },
] as const;

function formatAnimaPromptPartGroups(animaPromptParts: unknown): StoryShotAnimaPromptPartGroup[] {
  if (!isRecord(animaPromptParts)) {
    return [];
  }

  return storyAnimaPromptPartGroupSpecs
    .map((spec) => {
      const rawValue = animaPromptParts[spec.key];
      const value = Array.isArray(rawValue)
        ? fullStringArray(rawValue).join(", ")
        : fullText(rawValue);

      return {
        label: spec.label,
        value,
      };
    })
    .filter((group) => group.value);
}

function formatIllustriousSectionGroups(illustriousSections: unknown): StoryShotPromptSectionGroup[] {
  if (!isRecord(illustriousSections)) {
    return [];
  }

  return storyIllustriousSectionGroupSpecs
    .map((spec) => {
      const rawValue = illustriousSections[spec.key];
      const value = Array.isArray(rawValue)
        ? fullStringArray(rawValue).join(", ")
        : fullText(rawValue);

      return {
        label: spec.label,
        value,
      };
    })
    .filter((group) => group.value);
}

function formatPromptSectionGroups({
  animaPromptParts,
  illustriousSections,
}: {
  animaPromptParts?: unknown;
  illustriousSections?: unknown;
}) {
  const animaGroups = formatAnimaPromptPartGroups(animaPromptParts);
  return animaGroups.length > 0 ? animaGroups : formatIllustriousSectionGroups(illustriousSections);
}

function getIllustriousSectionValues(illustriousSections: unknown, keys: string[]) {
  if (!isRecord(illustriousSections)) {
    return [];
  }

  return keys.flatMap((key) => {
    const value = illustriousSections[key];
    return Array.isArray(value) ? fullStringArray(value) : splitPromptParts(value);
  });
}

function formatPromptProfile(value: unknown) {
  return isPromptProfileId(value) ? formatPromptProfileLabel(value) : "";
}

function getShotSceneBeat(shot: Record<string, unknown>, animaPromptParts?: unknown, illustriousSections?: unknown) {
  const action = getAnimaPromptPartValues(animaPromptParts, ["actionTags"])[0];
  const environment = getAnimaPromptPartValues(animaPromptParts, ["settingTags"])[0];
  const caption = isRecord(animaPromptParts) ? fullText(animaPromptParts.singleFrameCaption) : "";
  const illustriousAction = getIllustriousSectionValues(illustriousSections, ["poseActionExpression"])[0];
  const illustriousEnvironment = getIllustriousSectionValues(
    illustriousSections,
    ["backgroundEnvironmentObjects"],
  )[0];
  const title = getShotTitle(shot);

  return [title, action || illustriousAction, environment || illustriousEnvironment, caption].filter(Boolean).join(" / ");
}

function createPromptShotCard({
  animaPromptParts,
  globalWarnings,
  index,
  illustriousSections,
  negativePrompt,
  parameters,
  positivePrompt,
  promptProfile,
  resources,
  sceneBeat,
  shot,
  sourceImageEdges,
  sourceMode,
  warningDisplayMode = "all",
}: {
  animaPromptParts?: unknown;
  globalWarnings?: unknown;
  index: number;
  illustriousSections?: unknown;
  negativePrompt: unknown;
  parameters?: unknown;
  positivePrompt: unknown;
  promptProfile?: unknown;
  resources?: string;
  sceneBeat?: string;
  shot: Record<string, unknown>;
  sourceImageEdges?: unknown;
  sourceMode?: unknown;
  warningDisplayMode?: StoryShotWarningDisplayMode;
}): StoryShotSummaryCard {
  const shotId = compactText(shot.shotId, 80) || compactText(shot.id, 80) || `shot-${index + 1}`;
  const promptWarnings = getWarningsForShot(shotId, shot.promptWarnings, globalWarnings);
  const promptHealth = createStoryPromptHealth({
    animaPromptParts,
    positivePrompt,
    promptWarnings,
    sourceImageEdges,
  });
  const readiness = getPromptShotReadiness({
    health: promptHealth,
    warningDisplayMode,
    warnings: promptWarnings,
  });
  const removedNegatives = getRemovedNegativeSummaries(promptWarnings);

  return {
    animaPromptParts: formatAnimaPromptPartGroups(animaPromptParts),
    dependencies: getShotDependencies(shot.sourceShotIds, sourceMode),
    negativePrompt: fullText(negativePrompt),
    parameters: parameters ? formatParameters(parameters) : undefined,
    promptHealth,
    promptProfile: formatPromptProfile(promptProfile),
    promptSections: formatPromptSectionGroups({ animaPromptParts, illustriousSections }),
    readinessDetail: readiness.detail,
    readinessLabel: readiness.label,
    readinessTone: readiness.tone,
    removedNegatives,
    resources,
    sceneBeat: sceneBeat || getShotSceneBeat(shot, animaPromptParts, illustriousSections),
    shotId,
    shotNumber: getShotNumber(shot, index),
    sourceRisks: getSourceRiskSummaries(sourceImageEdges),
    title: getShotTitle(shot),
    visualPrompt: fullText(positivePrompt),
    warningDisplayMode,
    warnings: promptWarnings,
  };
}

function summarizeRenderPlan(result: unknown): StoryNodeOutputSummary {
  const plan = isRecord(result) ? result : {};
  const shots = asRecordArray(plan.shots);
  const {
    decisionNotes,
    systemDiagnostics,
    warningNotes,
  } = getRenderPlanWarningSections(plan.warnings);
  const supplementalSections: StoryNodeSummarySection[] = [
    ...(decisionNotes.length > 0
      ? [{
          title: "Decision notes",
          notes: decisionNotes,
        }]
      : []),
    ...(systemDiagnostics.length > 0
      ? [{
          title: "System diagnostics",
          notes: systemDiagnostics,
        }]
      : []),
  ];

  return {
    title: "Story render plan summary",
    metrics: [
      { label: "Shots", value: String(shots.length) },
      { label: "Profile", value: formatPromptProfile(plan.promptProfile) || "Unknown" },
      { label: "NSFW", value: formatBoolean(isRecord(plan.nsfwContext) ? plan.nsfwContext.enabled : undefined) },
      { label: "Warnings", value: String(warningNotes.length) },
      { label: "Decision notes", value: String(decisionNotes.length) },
    ],
    shotCards: shots.map((shot, index) =>
      createPromptShotCard({
        globalWarnings: warningNotes,
        index,
        animaPromptParts: shot.animaPromptParts,
        illustriousSections: shot.illustriousSections,
        negativePrompt: shot.negativePrompt,
        parameters: shot.parameters,
        positivePrompt: shot.positivePrompt,
        promptProfile: shot.promptProfile ?? plan.promptProfile,
        resources: getRenderResourceNames(plan, shot),
        shot,
        sourceImageEdges: shot.sourceImageEdges,
        sourceMode: asStringArray(shot.sourceShotIds).length > 0 ? "source-image" : "none",
        warningDisplayMode: "llm-only",
      }),
    ),
    sections: [
      {
        title: "Plan warnings",
        emptyState: "No render-plan warnings.",
        notes: warningNotes,
      },
      ...supplementalSections,
    ],
  };
}

function summarizeConsistency(result: unknown): StoryNodeOutputSummary {
  const check = isRecord(result) ? result : {};
  const issues = asRecordArray(check.issues);
  const warnings = asStringArray(check.warnings, 20);

  return {
    title: "Consistency check summary",
    metrics: [
      { label: "Passed", value: formatBoolean(check.passed) },
      { label: "Issues", value: String(issues.length) },
      { label: "Warnings", value: String(warnings.length) },
    ],
    sections: [
      {
        title: "Issues",
        emptyState: "No issues.",
        rows: issues.map((issue) => ({
          severity: compactText(issue.severity, 40),
          code: compactText(issue.code, 80),
          message: compactText(issue.message, 220),
          shots: formatList(issue.shotIds),
        })),
      },
      {
        title: "Warnings",
        emptyState: "No warnings.",
        notes: warnings,
      },
    ],
  };
}

function getStoredImageUrl(reference: Record<string, unknown>) {
  const storedImage = isRecord(reference.storedImage) ? reference.storedImage : {};
  const storedImages = asRecordArray(reference.storedImages);
  const firstStoredImage = storedImages[0] ?? {};

  return compactText(storedImage.url, 220) || compactText(firstStoredImage.url, 220);
}

function getResultImageLabel(reference: Record<string, unknown>) {
  const storedImage = isRecord(reference.storedImage) ? reference.storedImage : {};
  const storedImages = asRecordArray(reference.storedImages);
  const firstStoredImage = storedImages[0] ?? {};
  const image = isRecord(reference.image) ? reference.image : {};

  return compactText(storedImage.filename, 120) ||
    compactText(firstStoredImage.filename, 120) ||
    compactText(image.filename, 120) ||
    "No stored image";
}

function getReadinessForExecutionStatus(status: string, errorMessage = "") {
  if (status === "done") {
    return {
      detail: "Shot has a completed result reference.",
      label: "Generated",
      tone: "ready" as const,
    };
  }

  if (status === "ready" || status === "queued" || status === "running") {
    return {
      detail: "Shot is still in the execution path.",
      label: "In progress",
      tone: "neutral" as const,
    };
  }

  return {
    detail: errorMessage || "Shot needs regeneration or upstream review.",
    label: "Needs review",
    tone: "review" as const,
  };
}

function summarizeGenerationGate(result: unknown): StoryNodeOutputSummary {
  const gate = isRecord(result) ? result : {};
  const previews = asRecordArray(gate.requestPreview);
  const sourceEdges = previews.flatMap((preview) => asRecordArray(preview.sourceImageEdges));
  const gateReady = gate.ready === true;
  const gateBlockingReason = compactText(gate.blockingReason, 220);

  return {
    title: "Generation gate summary",
    metrics: [
      { label: "Ready", value: gateReady ? "Ready" : "Warning" },
      { label: "Shots", value: formatNumber(gate.renderPlanShotCount, String(previews.length)) },
      { label: "Profile", value: formatPromptProfile(gate.promptProfile) || "Unknown" },
      { label: "Confirmation", value: gate.confirmationRequired === true ? "Required" : "Not required" },
      { label: "Source risks", value: String(sourceEdges.length) },
    ],
    shotCards: previews.map((preview, index) => {
      const baseCard = createPromptShotCard({
        animaPromptParts: preview.animaPromptParts,
        illustriousSections: preview.illustriousSections,
        index,
        negativePrompt: preview.negativePromptPreview,
        parameters: preview.parameters,
        positivePrompt: preview.positivePromptPreview ?? preview.positivePrompt,
        promptProfile: preview.promptProfile ?? gate.promptProfile,
        sceneBeat: compactText(preview.title, 120) || compactText(preview.shotId, 80),
        shot: {
          ...preview,
          order: index + 1,
        },
        sourceImageEdges: preview.sourceImageEdges,
        sourceMode: preview.sourceMode,
        warningDisplayMode: "llm-only",
      });
      const readiness = gateReady
        ? baseCard.readinessTone === "ready"
          ? {
              detail: "Gate preview is ready for explicit generation confirmation.",
              label: "Ready",
              tone: "ready",
            } as const
          : {
              detail: baseCard.readinessDetail,
              label: baseCard.readinessLabel,
              tone: baseCard.readinessTone,
            }
        : {
            detail: gateBlockingReason || "Review gate state before generation.",
            label: "Needs review",
            tone: "review",
          } as const;

      return {
        ...baseCard,
        readinessDetail: readiness.detail,
        readinessLabel: readiness.label,
        readinessTone: readiness.tone,
      };
    }),
    sections: [
      {
        title: "Gate state",
        fields: [
          { label: "Execution available", value: formatBoolean(gate.executionAvailable) },
          { label: "Preview enabled", value: formatBoolean(gate.previewEnabled) },
          { label: "Blocking reason", value: gateBlockingReason || "None" },
        ],
      },
      {
        title: "Source-image risk",
        emptyState: "No source-image edges.",
        rows: sourceEdges.map((edge) => ({
          source: compactText(edge.sourceShotId, 80),
          target: compactText(edge.targetShotId, 80),
          risk: compactText(edge.riskLevel, 40) || "unknown",
          reason: compactText(edge.riskReason, 180) || "No risk reason.",
          chain: formatList(edge.sourceChain),
        })),
      },
    ],
  };
}

function summarizeExecution(result: unknown): StoryNodeOutputSummary {
  const execution = isRecord(result) ? result : {};
  const shots = asRecordArray(execution.shots);

  return {
    title: "Shot graph execution summary",
    metrics: [
      { label: "Status", value: compactText(execution.status, 40) || "Unknown" },
      { label: "Ready", value: String(asStringArray(execution.readyShotIds, 30).length) },
      { label: "Errors", value: String(asRecordArray(execution.errors).length) },
    ],
    shotCards: shots.map((shot, index) => {
      const resultReference = isRecord(shot.resultReference) ? shot.resultReference : {};
      const error = isRecord(shot.error) ? shot.error : {};
      const status = compactText(shot.status, 40) || "unknown";
      const readiness = getReadinessForExecutionStatus(status, compactText(error.message, 220));

      return {
        dependencies: getShotDependencies(shot.sourceShotIds),
        imageLabel: getResultImageLabel(resultReference),
        imageUrl: getStoredImageUrl(resultReference),
        promptHealth: {
          issues: [],
          label: "Execution status",
          tone: status === "done" ? "ready" : readiness.tone,
        },
        readinessDetail: readiness.detail,
        readinessLabel: readiness.label,
        readinessTone: readiness.tone,
        removedNegatives: [],
        sceneBeat: compactText(shot.shotId, 80) || `shot-${index + 1}`,
        shotId: compactText(shot.shotId, 80) || `shot-${index + 1}`,
        shotNumber: String(index + 1),
        sourceRisks: [],
        status,
        title: compactText(shot.shotId, 80) || `Shot ${index + 1}`,
      } satisfies StoryShotSummaryCard;
    }),
    sections: [
      {
        title: "Shots",
        emptyState: "No execution records.",
        rows: shots.map((shot) => {
          const error = isRecord(shot.error) ? shot.error : {};
          return {
            shot: compactText(shot.shotId, 80),
            status: compactText(shot.status, 40),
            source: formatList(shot.sourceShotIds),
            error: compactText(error.message, 180),
          };
        }),
      },
    ],
  };
}

function formatResultImageLocation(reference: Record<string, unknown>) {
  const storedUrl = getStoredImageUrl(reference);
  const imageLabel = getResultImageLabel(reference);

  return storedUrl || imageLabel || "Pending";
}

function summarizeResultDisplay(result: unknown): StoryNodeOutputSummary {
  const display = isRecord(result) ? result : {};
  const finalReferences = asRecordArray(display.finalReferences);
  const previewReferences = asRecordArray(display.previewReferences);
  const references = [
    ...finalReferences.map((reference) => ({ reference, type: "Final" })),
    ...previewReferences.map((reference) => ({ reference, type: "Preview" })),
  ];

  return {
    title: "Story result summary",
    metrics: [
      { label: "Status", value: compactText(display.status, 40) || "Pending" },
      { label: "Final images", value: String(finalReferences.length) },
      { label: "Preview images", value: String(previewReferences.length) },
    ],
    shotCards: references.map(({ reference, type }, index) => {
      const completed = reference.completed === true || Boolean(getStoredImageUrl(reference));
      const readinessTone: StoryShotSummaryTone = completed ? "ready" : "neutral";
      const shotId = compactText(reference.shotId, 80) || `${type.toLocaleLowerCase()}-${index + 1}`;

      return {
        dependencies: type === "Preview" ? "Preview reference" : "Final render reference",
        imageLabel: getResultImageLabel(reference),
        imageUrl: getStoredImageUrl(reference),
        promptHealth: {
          issues: [],
          label: type,
          tone: readinessTone,
        },
        readinessDetail: completed ? "Stored image reference is available." : "Waiting for a stored image reference.",
        readinessLabel: completed ? "Stored result" : "Pending",
        readinessTone,
        removedNegatives: [],
        sceneBeat: `${type} result for ${shotId}`,
        shotId,
        shotNumber: String(index + 1),
        sourceRisks: [],
        status: completed ? "complete" : "pending",
        title: `${type} ${shotId}`,
      } satisfies StoryShotSummaryCard;
    }),
    sections: [
      {
        title: "Final references",
        emptyState: "No final image references.",
        rows: finalReferences.map((reference) => {
          return {
            shot: compactText(reference.shotId, 80),
            status: reference.completed === true ? "complete" : "pending",
            image: formatResultImageLocation(reference),
          };
        }),
      },
    ],
  };
}

export function createStoryNodeOutputSummary(
  nodeId: StoryWorkflowNodeId,
  result: unknown,
): StoryNodeOutputSummary {
  switch (nodeId) {
    case "story-input":
      return summarizeStoryInput(result);
    case "story-bible":
      return summarizeStoryBible(result);
    case "story-outline":
      return summarizeStoryOutline(result);
    case "storyboard-shots":
      return summarizeStoryboardShots(result);
    case "story-safety-plan":
      return summarizeStorySafety(result);
    case "shot-dependency-graph":
      return summarizeShotDependencyGraph(result);
    case "plot-state-graph":
      return summarizePlotStateGraph(result);
    case "character-continuity-graph":
      return summarizeCharacterContinuity(result);
    case "resource-plan":
      return summarizeResourcePlan(result);
    case "parameter-plan":
      return summarizeParameterPlan(result);
    case "story-render-plan":
      return summarizeRenderPlan(result);
    case "story-consistency-check":
      return summarizeConsistency(result);
    case "generation-gate":
      return summarizeGenerationGate(result);
    case "shot-graph-execution":
      return summarizeExecution(result);
    case "story-result-display":
      return summarizeResultDisplay(result);
    default:
      return {
        title: "Story node summary",
        metrics: [],
        sections: [],
      };
  }
}

export function createAllStoryNodeOutputSummaries(
  results: Partial<Record<StoryWorkflowNodeId, unknown>> = {},
) {
  return Object.fromEntries(
    storyWorkflowNodeIds.map((nodeId) => [nodeId, createStoryNodeOutputSummary(nodeId, results[nodeId])]),
  ) as Record<StoryWorkflowNodeId, StoryNodeOutputSummary>;
}
