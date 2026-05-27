export type CivitaiResourceType = "lora" | "model" | "embedding" | "vae" | "other";

export type CivitaiLoraCategory =
  | "character"
  | "style"
  | "clothing"
  | "pose"
  | "scene"
  | "lighting"
  | "detail"
  | "other";

export type CivitaiResolveStatus =
  | "resolved_by_hash"
  | "resolved_by_model_version_id"
  | "resolved_by_name_search"
  | "metadata_only"
  | "unresolved";

export type CivitaiUsageSource = "civitai_image_meta" | "prompt_parse" | "manual";

export type CivitaiEnrichmentStatus = "ai_enriched" | "fallback" | "ai_failed";

export type CivitaiAiNsfwLevel = "sfw" | "suggestive" | "mature" | "explicit" | "unknown";

export type CivitaiLibrarySettings = {
  loraDownloadPath: string;
  checkpointDownloadPath: string;
  controlNetModelPath: string;
};

export type CivitaiResourceDownloadState =
  | "path_missing"
  | "directory_missing"
  | "not_downloaded"
  | "verified"
  | "checksum_mismatch"
  | "unverified";

export type CivitaiResourceDownloadStatus = {
  resourceId: string;
  status: CivitaiResourceDownloadState;
  message: string;
  pathConfigured: boolean;
  directoryExists: boolean;
  targetFileName: string;
  targetPath: string | null;
  fileExists: boolean;
  checksumType: "SHA256" | null;
  expectedSha256: string | null;
  actualSha256: string | null;
  checksumMatches: boolean | null;
  downloadUrl: string | null;
};

export type CivitaiResourceDownloadResult = CivitaiResourceDownloadStatus & {
  action: "download" | "upload";
  skipped: boolean;
  overwritten: boolean;
  bytesWritten: number;
};

export type CivitaiResourceRecommendation = {
  condition: string | null;
  baseModel: string | null;
  checkpoint: string | null;
  sampler: string | null;
  loraWeightMin: number | null;
  loraWeightMax: number | null;
  loraWeight: number | null;
  hdRedrawRate: number | null;
  notes: string | null;
};

export type CivitaiPromptReference = {
  cfgScale: number | null;
  civitaiImagePageUrl: string;
  negativePrompt: string | null;
  prompt: string;
  sampler: string | null;
  seed: string | null;
  steps: number | null;
};

export type ParsedLoraWeight = {
  name: string;
  weight: number | null;
  raw: string;
};

export type NormalizedCivitaiImageResource = {
  type: CivitaiResourceType;
  name: string | null;
  hash: string | null;
  modelVersionId: number | null;
  modelId: number | null;
  weight: number | null;
  raw: unknown;
};

export type NormalizedCivitaiImage = {
  civitaiImageId: number;
  civitaiImagePageUrl: string;
  imageUrl: string | null;
  sourceImageUrl?: string | null;
  width: number | null;
  height: number | null;
  nsfw: boolean | null;
  nsfwLevel: number | null;
  browsingLevel: number | null;
  createdAtOnCivitai: string | null;
  postId: number | null;
  username: string | null;
  baseModel: string | null;
  prompt: string | null;
  negativePrompt: string | null;
  sampler: string | null;
  steps: number | null;
  cfgScale: number | null;
  seed: string | null;
  modelVersionIds: number[];
  resources: NormalizedCivitaiImageResource[];
  rawMetaJson: unknown;
};

export type CivitaiResolvedVersion = {
  resourceType: CivitaiResourceType;
  civitaiModelId: number | null;
  civitaiModelVersionId: number | null;
  name: string | null;
  versionName: string | null;
  hash: string | null;
  baseModel: string | null;
  trainedWords: string[];
  tags: string[];
  description: string | null;
  creator: string | null;
  downloadUrl: string | null;
  filesJson: unknown;
  officialImagesJson: unknown;
  nsfw: boolean | null;
  rawVersionJson: unknown;
};

export type CivitaiResourceUpsertInput = {
  resourceType: CivitaiResourceType;
  civitaiModelId: number | null;
  civitaiModelVersionId: number | null;
  name: string;
  versionName: string | null;
  hash: string | null;
  baseModel: string | null;
  trainedWords: string[];
  tags: string[];
  description: string | null;
  creator: string | null;
  downloadUrl: string | null;
  filesJson: unknown;
  officialImagesJson: unknown;
  category: CivitaiLoraCategory | null;
  categories: CivitaiLoraCategory[];
  usageGuide: string | null;
  recommendations: CivitaiResourceRecommendation[];
  enrichmentStatus: CivitaiEnrichmentStatus;
  enrichmentError: string | null;
  nsfw: boolean | null;
  aiNsfwLevel: CivitaiAiNsfwLevel;
  aiNsfwConfidence: number | null;
  aiNsfwReason: string | null;
  rawVersionJson: unknown;
};

export type CivitaiResourceUpsertKey =
  | { kind: "civitaiModelVersionId"; value: number }
  | { kind: "hash"; value: string }
  | { kind: "modelVersionName"; civitaiModelId: number; versionName: string }
  | { kind: "normalizedNameBaseModel"; normalizedName: string; baseModel: string | null };

export type ImportedImageRecord = {
  id: string;
  civitaiImageId: number;
  civitaiImagePageUrl: string;
  imageUrl: string | null;
  sourceImageUrl: string | null;
  width: number | null;
  height: number | null;
  nsfw: boolean | null;
  nsfwLevel: number | null;
  browsingLevel: number | null;
  createdAtOnCivitai: string | null;
  postId: number | null;
  username: string | null;
  baseModel: string | null;
  prompt: string | null;
  negativePrompt: string | null;
  sampler: string | null;
  steps: number | null;
  cfgScale: number | null;
  seed: string | null;
  rawMetaJson: unknown;
  importedByUserId: string | null;
  importedAt: string;
  updatedAt: string;
};

export type CivitaiResourceRecord = {
  id: string;
  resourceType: CivitaiResourceType;
  civitaiModelId: number | null;
  civitaiModelVersionId: number | null;
  name: string;
  versionName: string | null;
  hash: string | null;
  baseModel: string | null;
  trainedWords: string[];
  tags: string[];
  description: string | null;
  creator: string | null;
  downloadUrl: string | null;
  filesJson: unknown;
  officialImagesJson: unknown;
  category: CivitaiLoraCategory | null;
  categories: CivitaiLoraCategory[];
  usageGuide: string | null;
  recommendations: CivitaiResourceRecommendation[];
  enrichmentStatus: CivitaiEnrichmentStatus;
  enrichmentError: string | null;
  nsfw: boolean | null;
  aiNsfwLevel: CivitaiAiNsfwLevel;
  aiNsfwConfidence: number | null;
  aiNsfwReason: string | null;
  rawVersionJson: unknown;
  createdAt: string;
  updatedAt: string;
};

export type ImageResourceUsageRecord = {
  id: string;
  importedImageId: string;
  resourceId: string;
  weight: number | null;
  triggerWordsUsed: string[];
  source: CivitaiUsageSource;
  resolveStatus: CivitaiResolveStatus;
  rawResourceJson: unknown;
  createdAt: string;
};

export type CivitaiResourceListFilters = {
  resourceType?: "lora" | "model";
  category?: CivitaiLoraCategory | "all";
  baseModel?: string;
  nsfw?: "all" | "sfw" | "nsfw";
  importedCount?: "all" | "one" | "multiple";
  query?: string;
};

export type CivitaiResourceListItem = CivitaiResourceRecord & {
  importedImageCount: number;
  averageWeight: number | null;
  minWeight: number | null;
  maxWeight: number | null;
  previewImage: string | null;
};

export type ImportedImageListFilters = {
  baseModel?: string;
  nsfw?: "all" | "sfw" | "nsfw";
  resourceCount?: "all" | "none" | "with";
  query?: string;
};

export type ImportedImageListItem = ImportedImageRecord & {
  resourceCount: number;
  loraCount: number;
  checkpointCount: number;
};

export type ImportedImageDetail = ImportedImageListItem & {
  usages: Array<ImageResourceUsageRecord & { resource: CivitaiResourceRecord }>;
};

export type CivitaiResourceDetail = CivitaiResourceListItem & {
  usages: Array<ImageResourceUsageRecord & { importedImage: ImportedImageRecord }>;
  commonCheckpoints: Array<{ resourceId: string; name: string; count: number }>;
  commonLoras: Array<{ resourceId: string; name: string; count: number }>;
};

export type SelectedCivitaiResourcePreview = {
  id: string;
  resourceType: "lora" | "model";
  name: string;
  versionName: string | null;
  baseModel: string | null;
  creator: string | null;
  trainedWords: string[];
  tags: string[];
  categories: CivitaiLoraCategory[];
  usageGuide: string | null;
  descriptionSnippet: string | null;
  averageWeight: number | null;
  minWeight: number | null;
  maxWeight: number | null;
  recommendations: CivitaiResourceRecommendation[];
  previewImage: string | null;
  modelFileName: string;
  promptReferences?: CivitaiPromptReference[];
};

export type SelectedCivitaiResourcesPreview = {
  checkpoint: SelectedCivitaiResourcePreview | null;
  loras: SelectedCivitaiResourcePreview[];
};

export type CivitaiAiRecommendedCheckpoint = {
  resource: SelectedCivitaiResourcePreview;
  reason: string;
};

export type CivitaiAiRecommendedLora = {
  resource: SelectedCivitaiResourcePreview;
  suggestedWeight: number | null;
  reason: string;
};

export type CivitaiAiRecommendationResponse = {
  checkpoint: CivitaiAiRecommendedCheckpoint;
  loras: CivitaiAiRecommendedLora[];
  recommendationReason: string;
  overallEffect: string;
  warnings: string[];
};

export type CivitaiImportResourceResult = {
  resource: CivitaiResourceRecord;
  usage: ImageResourceUsageRecord;
  isNewResource: boolean;
};

export type CivitaiImportResult = {
  importedImage: ImportedImageRecord;
  resources: CivitaiImportResourceResult[];
  message: string;
};

export type CivitaiParseResourcePreview = {
  resourceType: CivitaiResourceType;
  name: string;
  modelVersionId: number | null;
  versionName: string | null;
  hash: string | null;
  baseModel: string | null;
  trainedWords: string[];
  tags: string[];
  category: CivitaiLoraCategory | null;
  categories: CivitaiLoraCategory[];
  usageGuide: string | null;
  recommendations: CivitaiResourceRecommendation[];
  importResourceKey: string;
  officialImageUrls: string[];
  officialImageExistingUrls: string[];
  officialImageResourceKey: string;
  officialImagesSelectable: boolean;
  enrichmentStatus: CivitaiEnrichmentStatus;
  enrichmentError: string | null;
  nsfw: boolean | null;
  aiNsfwLevel: CivitaiAiNsfwLevel;
  aiNsfwConfidence: number | null;
  aiNsfwReason: string | null;
  weight: number | null;
  triggerWordsUsed: string[];
  resolveStatus: CivitaiResolveStatus;
  existingResourceId: string | null;
  rawResourceJson: unknown;
};

export type CivitaiParseIgnoredResource = {
  resourceType: CivitaiResourceType;
  name: string;
  modelVersionId: number | null;
  versionName: string | null;
  weight: number | null;
  resolveStatus: CivitaiResolveStatus;
  reason: string;
};

export type CivitaiParsePreview = {
  image: NormalizedCivitaiImage;
  resources: CivitaiParseResourcePreview[];
  ignoredResources: CivitaiParseIgnoredResource[];
  message: string;
};
