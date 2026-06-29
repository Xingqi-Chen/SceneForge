import type {
  StoryEntityCardCharacter,
  StoryEntityCardLocation,
  StoryEntityCardOutfit,
  StoryEntityCardProp,
  StoryEntityCards,
  StoryId,
  StoryReferenceAsset,
  StoryReferenceAssetFreezeBlock,
  StoryReferenceAssetFreezeGate,
  StoryReferenceAssetPlan,
  StoryReferenceAssetType,
  StoryReferenceEntityType,
  StoryReferenceImportance,
  StoryReferenceResolutionState,
  StoryShot,
  StoryShotId,
} from "./story-types";

const requiredBlockingStates = new Set<StoryReferenceResolutionState>([
  "missing",
  "generated",
  "uploaded",
  "failed",
  "rejected",
]);

function compactText(value: string | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function uniqueList(values: readonly string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values.map(compactText).filter(Boolean)) {
    if (seen.has(value)) {
      continue;
    }

    seen.add(value);
    result.push(value);
  }

  return result;
}

function makeReferenceId(type: StoryReferenceAssetType, entityId: string) {
  return `${type}:${entityId}`;
}

function makePrompt(parts: readonly string[]) {
  return uniqueList(parts).join(", ");
}

function isCharacterVisibleInShot(characterId: string, shot: StoryShot) {
  const explicitStates = shot.appearanceState?.characterStates.filter((state) => state.characterId === characterId);
  if (explicitStates && explicitStates.length > 0) {
    return explicitStates.some((state) => state.visible);
  }

  return shot.characterIds.includes(characterId);
}

function getVisibleCharacterShotIds(character: StoryEntityCardCharacter, shots: readonly StoryShot[]) {
  const visibleShotIds = shots.flatMap((shot) => isCharacterVisibleInShot(character.id, shot) ? [shot.id] : []);

  return uniqueList([...character.shotIds, ...visibleShotIds]) as StoryShotId[];
}

function getCharacterShotStateCoverage(character: StoryEntityCardCharacter, shots: readonly StoryShot[]) {
  return shots.filter((shot) => isCharacterVisibleInShot(character.id, shot)).length;
}

function getOutfitShotIds(outfit: StoryEntityCardOutfit, shots: readonly StoryShot[]) {
  const appearanceShotIds = shots.flatMap((shot) => {
    const visibleOutfit = shot.appearanceState?.characterStates.some((state) =>
      state.characterId === outfit.characterId && state.outfitId === outfit.id && state.visible,
    );

    return visibleOutfit ? [shot.id] : [];
  });

  return uniqueList([...outfit.shotIds, ...appearanceShotIds]) as StoryShotId[];
}

function getPropShotIds(prop: StoryEntityCardProp, shots: readonly StoryShot[]) {
  const shotStateIds = shots.flatMap((shot) => {
    const inAppearance = shot.appearanceState?.propIds.includes(prop.id);
    const inInteraction = shot.interactionState?.propIds.includes(prop.id);

    return inAppearance || inInteraction ? [shot.id] : [];
  });

  return uniqueList([...prop.shotIds, ...shotStateIds]) as StoryShotId[];
}

function getLocationShotIds(location: StoryEntityCardLocation, shots: readonly StoryShot[]) {
  const shotStateIds = shots.flatMap((shot) =>
    shot.locationId === location.id || shot.locationViewState?.locationId === location.id ? [shot.id] : [],
  );

  return uniqueList([...location.shotIds, ...shotStateIds]) as StoryShotId[];
}

function cloneAsset(asset: StoryReferenceAsset): StoryReferenceAsset {
  return {
    ...asset,
    approvedAssetReference: asset.approvedAssetReference ? { ...asset.approvedAssetReference } : undefined,
    candidateAssetReferences: asset.candidateAssetReferences.map((reference) => ({ ...reference })),
    promptOnlyFallback: asset.promptOnlyFallback ? { ...asset.promptOnlyFallback } : undefined,
    sourceEntity: { ...asset.sourceEntity },
    sourceShotIds: [...asset.sourceShotIds],
  };
}

function createReferenceAsset({
  canonicalPrompt,
  entity,
  importance,
  rationale,
  referenceType,
  shotIds,
  storyId,
}: {
  canonicalPrompt: string;
  entity: {
    id: string;
    name: string;
    type: StoryReferenceEntityType;
  };
  importance: StoryReferenceImportance;
  rationale: string;
  referenceType: StoryReferenceAssetType;
  shotIds: StoryShotId[];
  storyId: StoryId;
}): StoryReferenceAsset {
  return {
    id: makeReferenceId(referenceType, entity.id),
    storyId,
    referenceType,
    importance,
    resolutionState: "missing",
    canonicalPrompt,
    rationale,
    sourceEntity: entity,
    sourceShotIds: uniqueList(shotIds) as StoryShotId[],
    candidateAssetReferences: [],
  };
}

function createCharacterReferenceAssets({
  character,
  shots,
  storyId,
}: {
  character: StoryEntityCardCharacter;
  shots: readonly StoryShot[];
  storyId: StoryId;
}) {
  const shotIds = getVisibleCharacterShotIds(character, shots);
  const basePromptParts = [
    character.name,
    character.role,
    character.description,
    ...character.visualAnchors,
  ];

  return [
    createReferenceAsset({
      canonicalPrompt: makePrompt([
        "clean face reference plate",
        "front-facing headshot",
        ...basePromptParts,
      ]),
      entity: {
        id: character.id,
        name: character.name,
        type: "character",
      },
      importance: "required",
      rationale: "Main character face identity is required before final story generation.",
      referenceType: "character-face",
      shotIds,
      storyId,
    }),
    createReferenceAsset({
      canonicalPrompt: makePrompt([
        "clean bust reference plate",
        "head and shoulders",
        ...basePromptParts,
      ]),
      entity: {
        id: character.id,
        name: character.name,
        type: "character",
      },
      importance: "required",
      rationale: "Main character bust identity is required before final story generation.",
      referenceType: "character-bust",
      shotIds,
      storyId,
    }),
  ];
}

function createOutfitReferenceAsset({
  outfit,
  shots,
  storyId,
}: {
  outfit: StoryEntityCardOutfit;
  shots: readonly StoryShot[];
  storyId: StoryId;
}) {
  const shotIds = getOutfitShotIds(outfit, shots);
  const importance: StoryReferenceImportance = outfit.storyCritical === true ? "required" : "recommended";

  return createReferenceAsset({
    canonicalPrompt: makePrompt([
      "clean outfit reference plate",
      outfit.name,
      outfit.description,
      ...outfit.visualAnchors,
      ...outfit.continuityNotes,
    ]),
    entity: {
      id: outfit.id,
      name: outfit.name,
      type: "outfit",
    },
    importance,
    rationale: importance === "required"
      ? "Outfit is marked story-critical and blocks final story generation until resolved."
      : "High-frequency outfit continuity is recommended for story reference review.",
    referenceType: "outfit",
    shotIds,
    storyId,
  });
}

function createPropReferenceAsset({
  prop,
  shots,
  storyId,
}: {
  prop: StoryEntityCardProp;
  shots: readonly StoryShot[];
  storyId: StoryId;
}) {
  return createReferenceAsset({
    canonicalPrompt: makePrompt([
      "clean prop reference plate",
      prop.name,
      prop.description,
      ...prop.visualAnchors,
      ...prop.continuityNotes,
    ]),
    entity: {
      id: prop.id,
      name: prop.name,
      type: "prop",
    },
    importance: "optional",
    rationale: "Prop references are optional visual anchors and do not block final story generation by default.",
    referenceType: "prop",
    shotIds: getPropShotIds(prop, shots),
    storyId,
  });
}

function createLocationReferenceAsset({
  location,
  shots,
  storyId,
}: {
  location: StoryEntityCardLocation;
  shots: readonly StoryShot[];
  storyId: StoryId;
}) {
  const viewPrompts = location.viewStates.flatMap((view) => [
    view.viewDescription,
    view.camera,
    ...view.visibleAnchors,
  ]);

  return createReferenceAsset({
    canonicalPrompt: makePrompt([
      "clean location reference plate",
      location.name,
      location.description,
      ...location.visualAnchors,
      ...viewPrompts,
    ]),
    entity: {
      id: location.id,
      name: location.name,
      type: "location",
    },
    importance: "optional",
    rationale: "Location references are optional visual anchors and do not block final story generation by default.",
    referenceType: "location",
    shotIds: getLocationShotIds(location, shots),
    storyId,
  });
}

function getMainCharacter(entityCards: StoryEntityCards, shots: readonly StoryShot[]) {
  return [...entityCards.characters].sort((left, right) =>
    getCharacterShotStateCoverage(right, shots) - getCharacterShotStateCoverage(left, shots) ||
    right.shotIds.length - left.shotIds.length ||
    left.name.localeCompare(right.name),
  )[0];
}

export function deriveStoryReferenceAssetPlan({
  entityCards,
  shots,
  storyId = entityCards.storyId,
}: {
  entityCards: StoryEntityCards;
  shots: readonly StoryShot[];
  storyId?: StoryId;
}): StoryReferenceAssetPlan {
  const mainCharacter = getMainCharacter(entityCards, shots);
  const assets = [
    ...(mainCharacter ? createCharacterReferenceAssets({ character: mainCharacter, shots, storyId }) : []),
    ...entityCards.outfits.map((outfit) => createOutfitReferenceAsset({ outfit, shots, storyId })),
    ...entityCards.props.map((prop) => createPropReferenceAsset({ prop, shots, storyId })),
    ...entityCards.locations.map((location) => createLocationReferenceAsset({ location, shots, storyId })),
  ];
  const notes = [
    mainCharacter
      ? `Main character "${mainCharacter.name}" face and bust references are required by default.`
      : "No main character was available for required identity reference planning.",
    "Generated and uploaded reference states still require later approval before satisfying required references.",
    "Prompt-only fallback is never inferred; it must be stored as an explicit user decision.",
  ];

  return {
    storyId,
    assets: assets.map(cloneAsset),
    planningNotes: notes,
  };
}

function hasExplicitPromptOnlyDecision(asset: StoryReferenceAsset) {
  return asset.resolutionState === "prompt-only" &&
    asset.promptOnlyFallback?.decidedBy === "user" &&
    compactText(asset.promptOnlyFallback.reason).length > 0;
}

function getRequiredReferenceBlock(asset: StoryReferenceAsset): StoryReferenceAssetFreezeBlock | null {
  if (asset.importance !== "required") {
    return null;
  }

  if (asset.resolutionState === "approved") {
    return null;
  }

  if (hasExplicitPromptOnlyDecision(asset)) {
    return null;
  }

  const reason = asset.resolutionState === "prompt-only"
    ? "Required reference is prompt-only without an explicit user fallback decision."
    : asset.resolutionState === "generated"
      ? "Required reference has a generated candidate but still needs approval."
      : asset.resolutionState === "uploaded"
        ? "Required reference has an uploaded candidate but still needs approval."
        : asset.resolutionState === "failed"
          ? "Required reference generation failed and needs approval, upload, reroll, or explicit prompt-only fallback."
          : asset.resolutionState === "rejected"
            ? "Required reference was rejected and needs approval, upload, reroll, or explicit prompt-only fallback."
            : requiredBlockingStates.has(asset.resolutionState)
              ? "Required reference is unresolved."
              : "Required reference is unresolved.";

  return {
    entityId: asset.sourceEntity.id,
    entityName: asset.sourceEntity.name,
    entityType: asset.sourceEntity.type,
    importance: asset.importance,
    reason,
    referenceId: asset.id,
    referenceType: asset.referenceType,
    resolutionState: asset.resolutionState,
  };
}

export function evaluateStoryReferenceAssetFreezeGate(
  plan: StoryReferenceAssetPlan,
): StoryReferenceAssetFreezeGate {
  const requiredAssets = plan.assets.filter((asset) => asset.importance === "required");
  const blockingReferences = requiredAssets
    .map(getRequiredReferenceBlock)
    .filter((block): block is StoryReferenceAssetFreezeBlock => Boolean(block));

  return {
    blockingReferences,
    ready: blockingReferences.length === 0,
    requiredReferenceCount: requiredAssets.length,
    resolvedRequiredReferenceCount: requiredAssets.length - blockingReferences.length,
  };
}
