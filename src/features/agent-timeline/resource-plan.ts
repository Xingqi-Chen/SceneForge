type ResourcePlanNsfwMarkerKey =
  | "nsfw"
  | "nsfwLevel"
  | "aiNsfwLevel"
  | "aiNsfwConfidence"
  | "aiNsfwReason"
  | "modelNsfw";

export type ResourcePlanLocalResource = {
  id: string;
  name: string;
  baseModel?: string | null;
  modelFileName?: string | null;
};

export type ResourcePlanSanitizedResource<TResource extends ResourcePlanLocalResource> = Omit<
  TResource,
  ResourcePlanNsfwMarkerKey
>;

export type ResourcePlanCandidate<TResource extends ResourcePlanLocalResource> = {
  resource: TResource;
};

export type ResourcePlanCandidates<TResource extends ResourcePlanLocalResource> = {
  checkpoints: Array<ResourcePlanCandidate<TResource>>;
  loras: Array<ResourcePlanCandidate<TResource>>;
};

export type ResourcePlanRecommendedCheckpoint<TResource extends ResourcePlanLocalResource> = {
  resource: TResource;
  reason: string;
};

export type ResourcePlanRecommendedLora<TResource extends ResourcePlanLocalResource> = {
  resource: TResource;
  suggestedWeight: number | null;
  reason: string;
};

export type ResourcePlanRecommendation<TResource extends ResourcePlanLocalResource> = {
  checkpoint: ResourcePlanRecommendedCheckpoint<TResource>;
  loras: Array<ResourcePlanRecommendedLora<TResource>>;
  recommendationReason: string;
  overallEffect: string;
  warnings: string[];
};

export type ResourcePlanResult<TResource extends ResourcePlanLocalResource> = {
  checkpoint: ResourcePlanRecommendedCheckpoint<ResourcePlanSanitizedResource<TResource>>;
  loras: Array<ResourcePlanRecommendedLora<ResourcePlanSanitizedResource<TResource>>>;
  recommendationReason: string;
  overallEffect: string;
  warnings: string[];
};

export type ResourcePlanValidationOptions<TResource extends ResourcePlanLocalResource> = {
  areResourcesCompatible?: (
    lora: ResourcePlanSanitizedResource<TResource>,
    checkpoint: ResourcePlanSanitizedResource<TResource>,
  ) => boolean;
  maxLoras?: number;
  onInvalidSelection: (message: string, details?: unknown) => never;
};

const nsfwMarkerKeys = new Set<string>([
  "nsfw",
  "nsfwLevel",
  "aiNsfwLevel",
  "aiNsfwConfidence",
  "aiNsfwReason",
  "modelNsfw",
]);

function sanitizeResourcePlanResource<TResource extends ResourcePlanLocalResource>(
  resource: TResource,
): ResourcePlanSanitizedResource<TResource> {
  return Object.fromEntries(
    Object.entries(resource).filter(([key]) => !nsfwMarkerKeys.has(key)),
  ) as ResourcePlanSanitizedResource<TResource>;
}

function getCandidateMap<TResource extends ResourcePlanLocalResource>(
  candidates: Array<ResourcePlanCandidate<TResource>>,
) {
  return new Map(candidates.map((candidate) => [candidate.resource.id, candidate]));
}

function normalizeResourceMatchValue(value: string | null | undefined) {
  return value?.trim().toLocaleLowerCase() ?? "";
}

function getResourceMatchAliases(resource: ResourcePlanLocalResource) {
  return [
    resource.id,
    resource.name,
    resource.modelFileName,
  ]
    .map(normalizeResourceMatchValue)
    .filter(Boolean);
}

function findUnambiguousLocalCandidate<TResource extends ResourcePlanLocalResource>(
  recommended: ResourcePlanLocalResource,
  candidates: Array<ResourcePlanCandidate<TResource>>,
) {
  const byId = getCandidateMap(candidates).get(recommended.id);
  if (byId) {
    return byId;
  }

  const recommendedAliases = new Set(getResourceMatchAliases(recommended));
  const matches = candidates.filter((candidate) =>
    getResourceMatchAliases(candidate.resource).some((alias) => recommendedAliases.has(alias)),
  );

  return matches.length === 1 ? matches[0] : null;
}

function appendMappedResourceWarning<TResource extends ResourcePlanLocalResource>(
  warnings: string[],
  resourceKind: "checkpoint" | "LoRA",
  recommended: TResource,
  selected: ResourcePlanSanitizedResource<TResource>,
) {
  if (recommended.id === selected.id) {
    return;
  }

  warnings.push(`Mapped recommended ${resourceKind} ${recommended.name} to local candidate ${selected.name}.`);
}

export function validateLocalResourcePlan<TResource extends ResourcePlanLocalResource>({
  candidates,
  options,
  recommendation,
}: {
  candidates: ResourcePlanCandidates<TResource>;
  options: ResourcePlanValidationOptions<TResource>;
  recommendation: ResourcePlanRecommendation<TResource>;
}): ResourcePlanResult<TResource> {
  const checkpointCandidate = findUnambiguousLocalCandidate(
    recommendation.checkpoint.resource,
    candidates.checkpoints,
  );

  if (!checkpointCandidate) {
    return options.onInvalidSelection("Recommended checkpoint is not in the local candidate set.", {
      checkpointId: recommendation.checkpoint.resource.id,
      checkpointName: recommendation.checkpoint.resource.name,
    });
  }

  const checkpoint = sanitizeResourcePlanResource(checkpointCandidate.resource);
  const warnings = [...recommendation.warnings];
  appendMappedResourceWarning(
    warnings,
    "checkpoint",
    recommendation.checkpoint.resource,
    checkpoint,
  );
  const selectedLoras: ResourcePlanResult<TResource>["loras"] = [];
  const seenLoras = new Set<string>();
  const maxLoras = options.maxLoras ?? Number.POSITIVE_INFINITY;

  for (const lora of recommendation.loras) {
    const candidate = findUnambiguousLocalCandidate(lora.resource, candidates.loras);
    if (!candidate) {
      options.onInvalidSelection("Recommended LoRA is not in the local candidate set.", {
        loraId: lora.resource.id,
        loraName: lora.resource.name,
      });
      continue;
    }

    const selected = sanitizeResourcePlanResource(candidate.resource);

    if (seenLoras.has(selected.id)) {
      warnings.push(`Ignored duplicate LoRA ${selected.name}.`);
      continue;
    }

    if (selectedLoras.length >= maxLoras) {
      warnings.push(`Only the first ${maxLoras} LoRAs were kept.`);
      break;
    }

    if (options.areResourcesCompatible && !options.areResourcesCompatible(selected, checkpoint)) {
      warnings.push(`Ignored incompatible LoRA ${selected.name}.`);
      continue;
    }

    appendMappedResourceWarning(warnings, "LoRA", lora.resource, selected);
    seenLoras.add(selected.id);
    selectedLoras.push({
      resource: selected,
      suggestedWeight: lora.suggestedWeight,
      reason: lora.reason,
    });
  }

  return {
    checkpoint: {
      resource: checkpoint,
      reason: recommendation.checkpoint.reason,
    },
    loras: selectedLoras,
    recommendationReason: recommendation.recommendationReason,
    overallEffect: recommendation.overallEffect,
    warnings,
  };
}
