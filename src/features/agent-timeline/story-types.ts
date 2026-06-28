export const storyWorkflowNodeIds = [
  "story-input",
  "story-bible",
  "story-outline",
  "storyboard-shots",
  "story-safety-plan",
  "shot-dependency-graph",
  "plot-state-graph",
  "character-continuity-graph",
  "resource-plan",
  "parameter-plan",
  "story-render-plan",
  "story-consistency-check",
  "generation-gate",
  "shot-graph-execution",
  "story-result-display",
] as const;

export type StoryWorkflowNodeId = (typeof storyWorkflowNodeIds)[number];

export const executableStoryWorkflowNodeIds = storyWorkflowNodeIds;

export type StoryWorkflowExecutableNodeId = (typeof executableStoryWorkflowNodeIds)[number];

export const reservedStoryWorkflowNodeIds = [] as const satisfies readonly StoryWorkflowNodeId[];

export type StoryId = string;

export type StoryShotId = string;

export type StoryCharacterId = string;

export type StoryLocationId = string;

export type PlotStateId = string;

export type StoryAudienceRating = "safe" | "suggestive" | "mature" | "explicit";

export type StorySegmentKind = "opening-image" | "beat" | "final-image";

export type StorySegment = {
  id: string;
  title: string;
  sourceText: string;
  order: number;
  kind: StorySegmentKind;
};

export type StoryInput = {
  storyId: StoryId;
  rawIntent: string;
  title?: string;
  targetShotCount?: number;
  storyContext?: string;
  storySegments?: StorySegment[];
  audienceRating?: StoryAudienceRating;
  nsfwContext?: StoryNsfwContext;
  settingsSnapshot?: unknown;
};

export type StoryBibleCharacter = {
  id: StoryCharacterId;
  name: string;
  role: string;
  description: string;
  continuityNotes: string[];
  visualAnchors: string[];
};

export type StoryBibleLocation = {
  id: StoryLocationId;
  name: string;
  description: string;
  visualAnchors: string[];
};

export type StoryBible = {
  storyId: StoryId;
  title: string;
  logline: string;
  genre: string[];
  themes: string[];
  worldSummary: string;
  visualStyle: string;
  characters: StoryBibleCharacter[];
  locations: StoryBibleLocation[];
  continuityRules: string[];
};

export type StoryOutlineBeat = {
  id: string;
  title: string;
  summary: string;
  order: number;
  characterIds: StoryCharacterId[];
};

export type StoryOutline = {
  storyId: StoryId;
  beats: StoryOutlineBeat[];
};

export type StoryShot = {
  id: StoryShotId;
  storyId: StoryId;
  order: number;
  title: string;
  description: string;
  beatId?: string;
  locationId?: StoryLocationId;
  characterIds: StoryCharacterId[];
  sourceShotIds: StoryShotId[];
  camera: string;
  promptIntent: string;
  continuityNotes: string[];
};

export type StorySafetyPlan = {
  storyId: StoryId;
  audienceRating: StoryAudienceRating;
  contentWarnings: string[];
  blockedContent: string[];
  perShotNotes: Array<{
    shotId: StoryShotId;
    risks: string[];
    mitigations: string[];
  }>;
  nsfwContext?: {
    enabled: boolean;
    rationale: string;
  };
};

export type ShotDependencyGraphNode = {
  shotId: StoryShotId;
  label?: string;
};

export type StorySourceImageRiskLevel = "low" | "medium" | "high";

export type StorySourceImageRiskMetadata = {
  level: StorySourceImageRiskLevel;
  reason: string;
  factors: string[];
};

export type StorySourceImageEdgeSummary = {
  executable: boolean;
  riskFactors: string[];
  riskLevel: StorySourceImageRiskLevel;
  riskReason: string;
  sourceChain: StoryShotId[];
  sourceShotId: StoryShotId;
  targetShotId: StoryShotId;
};

export type ShotDependencyGraphEdge = {
  fromShotId: StoryShotId;
  toShotId: StoryShotId;
  reason: "img2img-source" | "reference" | "continuity" | "story-order" | "manual";
  sourceImageRisk?: StorySourceImageRiskMetadata;
};

export type ShotDependencyGraph = {
  storyId: StoryId;
  nodes: ShotDependencyGraphNode[];
  edges: ShotDependencyGraphEdge[];
};

export type PlotStateGraphNode = {
  id: PlotStateId;
  title: string;
  summary: string;
  shotIds: StoryShotId[];
};

export type PlotStateGraphEdge = {
  fromStateId: PlotStateId;
  toStateId: PlotStateId;
  reason: string;
};

export type PlotStateGraph = {
  storyId: StoryId;
  states: PlotStateGraphNode[];
  transitions: PlotStateGraphEdge[];
};

export type CharacterContinuityAppearance = {
  shotId: StoryShotId;
  characterId: StoryCharacterId;
  wardrobe: string[];
  poseOrAction: string;
  expression: string;
  continuityNotes: string[];
};

export type CharacterContinuityGraph = {
  storyId: StoryId;
  characters: Array<{
    characterId: StoryCharacterId;
    name: string;
    canonicalDescription: string;
    visualAnchors: string[];
  }>;
  appearances: CharacterContinuityAppearance[];
};

export type StoryConsistencyIssueSeverity = "info" | "warning" | "error";

export type StoryConsistencyIssue = {
  code: string;
  message: string;
  severity: StoryConsistencyIssueSeverity;
  shotIds: StoryShotId[];
  characterIds?: StoryCharacterId[];
};

export type StoryConsistencyCheck = {
  storyId: StoryId;
  passed: boolean;
  checkedAt: string;
  issues: StoryConsistencyIssue[];
  warnings: string[];
};

export type StoryNsfwContext = {
  enabled: boolean;
  audienceRating: StoryAudienceRating;
  contentWarnings: string[];
  rationale: string;
};

