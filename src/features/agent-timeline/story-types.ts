export const storyWorkflowNodeIds = [
  "story-input",
  "story-bible",
  "story-outline",
  "storyboard-shots",
  "story-safety-plan",
  "shot-dependency-graph",
  "plot-state-graph",
  "character-continuity-graph",
  "entity-cards",
  "reference-asset-plan",
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

export type StoryPropId = string;

export type StoryOutfitId = string;

export type PlotStateId = string;

export type StoryPlanningErrorSeverity = "warning" | "error";

export type StoryPlanningError = {
  code: string;
  message: string;
  severity: StoryPlanningErrorSeverity;
  path?: string;
  shotIds?: StoryShotId[];
  characterIds?: StoryCharacterId[];
  propIds?: StoryPropId[];
  locationIds?: StoryLocationId[];
};

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

export type StoryBibleProp = {
  id: StoryPropId;
  name: string;
  description: string;
  continuityNotes: string[];
  ownerCharacterIds?: StoryCharacterId[];
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
  props: StoryBibleProp[];
  continuityRules: string[];
  planningErrors?: StoryPlanningError[];
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
  appearanceState?: StoryShotAppearanceState;
  interactionState?: StoryShotInteractionState;
  locationViewState?: StoryShotLocationViewState;
  planningErrors?: StoryPlanningError[];
};

export type StoryShotAppearanceState = {
  characterStates: Array<{
    characterId: StoryCharacterId;
    appearance: string;
    continuityNotes: string[];
    outfitId?: StoryOutfitId;
    visible: boolean;
  }>;
  notes: string[];
  propIds: StoryPropId[];
};

export type StoryShotInteractionState = {
  characterIds: StoryCharacterId[];
  continuityNotes: string[];
  description: string;
  physicalContact: string[];
  propIds: StoryPropId[];
};

export type StoryShotLocationViewState = {
  camera: string;
  viewDescription: string;
  visibleAnchors: string[];
  locationId?: StoryLocationId;
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

export type StoryEntityCardCharacter = {
  id: StoryCharacterId;
  name: string;
  role: string;
  description: string;
  continuityNotes: string[];
  outfitIds: StoryOutfitId[];
  propIds: StoryPropId[];
  shotIds: StoryShotId[];
  visualAnchors: string[];
};

export type StoryEntityCardOutfit = {
  id: StoryOutfitId;
  characterId: StoryCharacterId;
  name: string;
  description: string;
  continuityNotes: string[];
  shotIds: StoryShotId[];
  storyCritical?: boolean;
  visualAnchors: string[];
};

export type StoryEntityCardProp = {
  id: StoryPropId;
  name: string;
  description: string;
  continuityNotes: string[];
  ownerCharacterIds: StoryCharacterId[];
  shotIds: StoryShotId[];
  visualAnchors: string[];
};

export type StoryEntityCardLocation = {
  id: StoryLocationId;
  name: string;
  description: string;
  shotIds: StoryShotId[];
  viewStates: Array<{
    shotId: StoryShotId;
    camera: string;
    viewDescription: string;
    visibleAnchors: string[];
  }>;
  visualAnchors: string[];
};

export type StoryEntityCards = {
  storyId: StoryId;
  characters: StoryEntityCardCharacter[];
  outfits: StoryEntityCardOutfit[];
  props: StoryEntityCardProp[];
  locations: StoryEntityCardLocation[];
  planningErrors: StoryPlanningError[];
};

export const storyReferenceImportanceValues = [
  "required",
  "recommended",
  "optional",
] as const;

export type StoryReferenceImportance = (typeof storyReferenceImportanceValues)[number];

export const storyReferenceResolutionStateValues = [
  "missing",
  "generated",
  "uploaded",
  "approved",
  "failed",
  "stale",
  "rejected",
  "prompt-only",
] as const;

export type StoryReferenceResolutionState = (typeof storyReferenceResolutionStateValues)[number];

export type StoryReferenceAssetType =
  | "character-face"
  | "character-bust"
  | "outfit"
  | "prop"
  | "location";

export type StoryReferenceEntityType = "character" | "outfit" | "prop" | "location";

export type StoryReferenceAssetReference = {
  byteLength?: number;
  canonicalPromptRevision?: number;
  contentType?: string;
  createdAt?: string;
  filename?: string;
  id?: string;
  metadata?: {
    checkpointResourceId?: string;
    height?: number;
    loraResourceIds?: string[];
    negativePrompt?: string;
    positivePrompt?: string;
    promptId?: string;
    referenceId?: string;
    warnings?: string[];
    width?: number;
    workflowProfile?: string;
  };
  source: "generated" | "uploaded";
  url?: string;
};

export type StoryReferenceApprovalDecision = {
  approvedAssetReferenceId?: string;
  approvedAt?: string;
  approvedBy: "user";
  source: "generated" | "uploaded";
};

export type StoryReferenceGenerationFailureAction = "reroll" | "upload" | "prompt-only";

export type StoryReferenceGenerationFailureSummary = {
  code?: string;
  failedAt?: string;
  message: string;
  recoverable: true;
  recoverableActions: StoryReferenceGenerationFailureAction[];
};

export type StoryReferencePromptOnlyFallbackDecision = {
  decidedAt?: string;
  decidedBy: "user";
  reason: string;
};

export type StoryReferenceRejectionDecision = {
  reason?: string;
  rejectedAt?: string;
  rejectedBy: "user";
};

export type StoryReferenceAsset = {
  id: string;
  storyId: StoryId;
  referenceType: StoryReferenceAssetType;
  importance: StoryReferenceImportance;
  resolutionState: StoryReferenceResolutionState;
  canonicalPromptRevision?: number;
  canonicalPrompt: string;
  rationale: string;
  sourceEntity: {
    id: string;
    name: string;
    type: StoryReferenceEntityType;
  };
  sourceShotIds: StoryShotId[];
  approval?: StoryReferenceApprovalDecision;
  approvedAssetReference?: StoryReferenceAssetReference;
  candidateAssetReferences: StoryReferenceAssetReference[];
  failure?: StoryReferenceGenerationFailureSummary;
  promptOnlyFallback?: StoryReferencePromptOnlyFallbackDecision;
  rejection?: StoryReferenceRejectionDecision;
};

export type StoryReferenceAssetPlan = {
  storyId: StoryId;
  assets: StoryReferenceAsset[];
  planningNotes: string[];
};

export type StoryReferenceAssetFreezeBlock = {
  entityId: string;
  entityName: string;
  entityType: StoryReferenceEntityType;
  importance: StoryReferenceImportance;
  reason: string;
  referenceId: string;
  referenceType: StoryReferenceAssetType;
  resolutionState: StoryReferenceResolutionState;
};

export type StoryReferenceAssetFreezeGate = {
  blockingReferences: StoryReferenceAssetFreezeBlock[];
  ready: boolean;
  requiredReferenceCount: number;
  resolvedRequiredReferenceCount: number;
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

