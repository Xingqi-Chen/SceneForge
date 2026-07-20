import fs from "node:fs/promises";

import {
  ComfyUiApiError,
  createComfyUiClient,
  extractComfyUiHistoryImages,
  isComfyUiPromptHistoryComplete,
  summarizeComfyUiErrorDetails,
  validateComfyUiRequestAgainstObjectInfo,
  validateComfyUiTextToImageRequest,
  buildComfyUiSequenceCharacterReference,
  type ComfyUiTextToImageRequest,
} from "@/features/comfyui";
import {
  getGeneratedImageContentType,
  getGeneratedImagePath,
  storeGeneratedImage,
} from "@/features/comfyui/generated-image-storage";
import { uploadComfyUiTextToImageSourceImage } from "@/features/comfyui/source-image-upload";
import { uploadSequenceCharacterReferences } from "@/features/comfyui/sequence-reference-upload";
import { ComfyUiSequenceReferenceStorageError } from "@/features/comfyui/sequence-reference-storage";
import { createLiteLlmClient, LiteLlmError } from "@/features/llm";

import { getRunSceneInputSettings } from "./run-input-settings";
import { createTimelineNodeError, normalizeTimelineError } from "./state";
import {
  buildStyleReferenceSequenceCharacter,
  getStyleReferenceCapability,
} from "./style-reference";
import { createTimelineT8NodeAdapters } from "./t8-node-adapters";
import {
  previewScoringRubric,
  TimelineNodeExecutionError,
  type ComfyUiExecutionTimelineResult,
  type PreviewExecutionTimelineResult,
  type PreviewScoringTimelineResult,
  type ResultDisplayTimelineResult,
  type TimelineFinalExecutionRecord,
  type TimelineNodeAdapters,
  type TimelineNodeExecutionContext,
  type TimelinePreviewCandidate,
  type TimelineStoredGeneratedImage,
} from "./types";

const DEFAULT_COMFYUI_BASE_URL = "http://127.0.0.1:8188";
const HISTORY_POLL_INTERVAL_MS = 2_000;
const HISTORY_POLL_TIMEOUT_MS = 60 * 60 * 1_000;

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function makeClient() {
  return createComfyUiClient({
    baseUrl: process.env.COMFYUI_BASE_URL ?? DEFAULT_COMFYUI_BASE_URL,
    apiKey: process.env.COMFYUI_API_KEY || undefined,
  });
}

function readClientId(context: TimelineNodeExecutionContext, suffix: string) {
  return `timeline-${context.workflow.workflowId}-${suffix}`;
}

function toComfyError(error: unknown): TimelineNodeExecutionError {
  if (error instanceof TimelineNodeExecutionError) return error;
  if (error instanceof ComfyUiApiError) {
    const summaries = summarizeComfyUiErrorDetails(error.details);
    return new TimelineNodeExecutionError(createTimelineNodeError(
      "comfyui_upstream",
      summaries.length ? `ComfyUI request failed: ${summaries.join(" | ")}` : error.message,
      { statusCode: error.statusCode },
    ));
  }
  return new TimelineNodeExecutionError(createTimelineNodeError(
    "comfyui_execution_failed",
    "Unexpected ComfyUI execution failure.",
  ));
}

function getValidatedTimelineCheckpoint(context: TimelineNodeExecutionContext) {
  const result = context.workflow.nodes["resource-recommendation"].result;
  if (!isRecord(result) || !isRecord(result.checkpoint) || !isRecord(result.checkpoint.resource)) return null;
  const checkpoint = result.checkpoint.resource;
  return typeof checkpoint.id === "string" && checkpoint.id.trim() &&
    typeof checkpoint.modelFileName === "string" && checkpoint.modelFileName.trim()
    ? { id: checkpoint.id.trim(), modelFileName: checkpoint.modelFileName.trim(),
        ...(typeof checkpoint.baseModel === "string" ? { baseModel: checkpoint.baseModel } : {}) }
    : null;
}

async function applyTimelineStyleReference(
  client: ReturnType<typeof makeClient>,
  request: ComfyUiTextToImageRequest,
  context: TimelineNodeExecutionContext,
) {
  const sceneInput = context.workflow.nodes["scene-input"].result;
  const settings = getRunSceneInputSettings(isRecord(sceneInput) ? sceneInput : {});
  const checkpoint = getValidatedTimelineCheckpoint(context);
  if (!checkpoint || getStyleReferenceCapability({ baseModel: checkpoint.baseModel }).mode !== "ipadapter") return request;
  const character = buildStyleReferenceSequenceCharacter(settings.styleReference, {
    id: "run-style-reference",
    name: "Run style reference",
  });
  if (!character) return request;

  try {
    const [uploaded] = await uploadSequenceCharacterReferences(
      client,
      `run-${context.workflow.workflowId}`,
      [character],
    );
    if (!uploaded) throw new Error("Missing uploaded style reference.");
    const reference = buildComfyUiSequenceCharacterReference(
      uploaded,
      uploaded.references.map((item) => ({ id: item.id, imageName: item.imageName, weight: item.weight })),
    );
    return { ...request, characterReferences: [...(request.characterReferences ?? []), reference] };
  } catch (error) {
    const message = error instanceof ComfyUiSequenceReferenceStorageError && error.statusCode === 404
      ? "Stored Run style reference was not found. Retry analysis, replace it, or disable IPAdapter."
      : "Run style reference could not be prepared. Retry analysis, replace it, or disable IPAdapter.";
    throw new TimelineNodeExecutionError(createTimelineNodeError("comfyui_request_invalid", message));
  }
}

async function waitForStoredImage(
  client: ReturnType<typeof makeClient>,
  promptId: string,
): Promise<{ sourceImage: NonNullable<TimelinePreviewCandidate["sourceImage"]>; storedImage: TimelineStoredGeneratedImage }> {
  const deadline = Date.now() + HISTORY_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const raw = await client.getHistory(promptId);
    const image = extractComfyUiHistoryImages(raw, promptId)[0];
    if (image) {
      const response = await fetch(client.buildViewUrl(image), {
        cache: "no-store",
        headers: {
          accept: "image/*",
          ...(process.env.COMFYUI_API_KEY ? { authorization: `Bearer ${process.env.COMFYUI_API_KEY}` } : {}),
        },
      });
      if (!response.ok) {
        throw new TimelineNodeExecutionError(createTimelineNodeError(
          "image_storage_failed",
          "ComfyUI image request failed.",
          { statusCode: response.status },
        ));
      }
      return {
        sourceImage: image,
        storedImage: await storeGeneratedImage(
          new Uint8Array(await response.arrayBuffer()),
          response.headers.get("content-type"),
        ),
      };
    }
    if (isComfyUiPromptHistoryComplete(raw, promptId)) {
      throw new TimelineNodeExecutionError(createTimelineNodeError(
        "comfyui_execution_failed",
        "ComfyUI completed without a returned image.",
        { promptId },
      ));
    }
    await delay(HISTORY_POLL_INTERVAL_MS);
  }
  throw new TimelineNodeExecutionError(createTimelineNodeError(
    "comfyui_execution_failed",
    "Timed out waiting for ComfyUI image output.",
    { promptId },
  ));
}

async function queueAndStore(
  client: ReturnType<typeof makeClient>,
  objectInfo: unknown,
  request: ComfyUiTextToImageRequest,
  context: TimelineNodeExecutionContext,
  suffix: string,
) {
  const validation = validateComfyUiTextToImageRequest(request);
  if (!validation.ok) {
    throw new TimelineNodeExecutionError(createTimelineNodeError(
      "comfyui_request_invalid",
      validation.message,
      validation.details,
    ));
  }
  try {
    const uploaded = await uploadComfyUiTextToImageSourceImage(client, validation.request);
    const styled = await applyTimelineStyleReference(client, uploaded, context);
    const styledValidation = validateComfyUiTextToImageRequest(styled);
    if (!styledValidation.ok) {
      throw new TimelineNodeExecutionError(createTimelineNodeError(
        "comfyui_request_invalid",
        styledValidation.message,
        styledValidation.details,
      ));
    }
    const objectValidation = validateComfyUiRequestAgainstObjectInfo(styledValidation.request, objectInfo);
    if (objectValidation.errors.length) {
      throw new TimelineNodeExecutionError(createTimelineNodeError(
        "comfyui_object_info_mismatch",
        ["ComfyUI request does not match current model/node options.", ...objectValidation.errors].join(" "),
        { errors: objectValidation.errors, warnings: objectValidation.warnings },
      ));
    }
    const queued = await client.generateImage(objectValidation.request, { clientId: readClientId(context, suffix) });
    const image = await waitForStoredImage(client, queued.promptId);
    return { ...image, promptId: queued.promptId, warnings: objectValidation.warnings };
  } catch (error) {
    throw toComfyError(error);
  }
}

async function executePreviews(
  requests: Parameters<NonNullable<Parameters<typeof createTimelineT8NodeAdapters>[0]["executePreviews"]>>[0],
  context: TimelineNodeExecutionContext,
): Promise<PreviewExecutionTimelineResult> {
  const client = makeClient();
  let objectInfo: unknown;
  try {
    objectInfo = await client.getObjectInfo();
  } catch (error) {
    throw toComfyError(error);
  }
  const candidates: TimelinePreviewCandidate[] = [];
  const warnings: string[] = [];
  for (const item of requests) {
    try {
      const result = await queueAndStore(client, objectInfo, item.request, context, item.candidateId);
      warnings.push(...result.warnings);
      candidates.push({
        candidateId: item.candidateId,
        index: item.index,
        seed: item.seed,
        status: "done",
        promptId: result.promptId,
        sourceImage: result.sourceImage,
        storedImage: result.storedImage,
      });
    } catch (error) {
      candidates.push({
        candidateId: item.candidateId,
        index: item.index,
        seed: item.seed,
        status: "error",
        error: normalizeTimelineError(error, "comfyui_execution_failed"),
      });
    }
  }
  const successfulCount = candidates.filter((candidate) => candidate.status === "done").length;
  const first = requests[0];
  const partialResult: PreviewExecutionTimelineResult = {
    baseSeed: first?.seed ?? 0,
    candidateCount: requests.length,
    finalCount: Math.min(4, Math.max(1, requests.length / 2)),
    previewHeight: first?.request.height ?? 512,
    previewWidth: first?.request.width ?? 512,
    previewSteps: first?.request.steps ?? 10,
    candidates,
    successfulCount,
    warnings: [...new Set(warnings)],
  };
  const sceneInput = context.workflow.nodes["scene-input"].result;
  const finalCount = isRecord(sceneInput) && typeof sceneInput.imageCount === "number" ? sceneInput.imageCount : 1;
  partialResult.finalCount = Math.min(4, Math.max(1, Math.round(finalCount)));
  if (successfulCount < partialResult.finalCount) {
    throw new TimelineNodeExecutionError(createTimelineNodeError(
      "comfyui_execution_failed",
      `Only ${successfulCount} previews succeeded; ${partialResult.finalCount} are required. Retry preview generation.`,
      { partialResult, recoverable: true },
    ));
  }
  return partialResult;
}

async function storedImageDataUrl(stored: TimelineStoredGeneratedImage) {
  const filePath = getGeneratedImagePath(stored.filename);
  if (!filePath) {
    throw new TimelineNodeExecutionError(createTimelineNodeError("image_storage_invalid", "Stored preview reference is invalid."));
  }
  try {
    const bytes = await fs.readFile(/*turbopackIgnore: true*/ filePath);
    return `data:${getGeneratedImageContentType(stored.filename)};base64,${bytes.toString("base64")}`;
  } catch {
    throw new TimelineNodeExecutionError(createTimelineNodeError(
      "image_storage_failed",
      "Stored preview image could not be read. Retry preview generation.",
    ));
  }
}

function parseJsonObject(content: string): Record<string, unknown> {
  const trimmed = content.trim();
  const candidate = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
    : trimmed;
  const parsed = JSON.parse(candidate) as unknown;
  if (!isRecord(parsed)) throw new Error("Scoring response must be a JSON object.");
  return parsed;
}

function validateScores(
  content: string,
  candidates: TimelinePreviewCandidate[],
  finalCount: number,
): PreviewScoringTimelineResult {
  const parsed = parseJsonObject(content);
  if (!Array.isArray(parsed.candidates)) throw new Error("Scoring response must include candidates.");
  const expectedIds = candidates.map((candidate) => candidate.candidateId);
  const expected = new Set(expectedIds);
  const seen = new Set<string>();
  const fieldNames = ["adherence", "composition", "anatomy", "style", "technical"] as const;
  const scores = parsed.candidates.map((entry) => {
    if (!isRecord(entry) || typeof entry.candidateId !== "string" || !expected.has(entry.candidateId) || seen.has(entry.candidateId)) {
      throw new Error("Scoring candidate ids must exactly match the preview candidates without duplicates.");
    }
    seen.add(entry.candidateId);
    const values = Object.fromEntries(fieldNames.map((field) => {
      const value = entry[field];
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
        throw new Error(`Score ${field} for ${entry.candidateId} must be finite and between 0 and 100.`);
      }
      return [field, value];
    })) as Record<(typeof fieldNames)[number], number>;
    const rawTotal =
      values.adherence * previewScoringRubric.adherence +
      values.composition * previewScoringRubric.composition +
      values.anatomy * previewScoringRubric.anatomy +
      values.style * previewScoringRubric.style +
      values.technical * previewScoringRubric.technical;
    return {
      candidateId: entry.candidateId,
      ...values,
      rawTotal,
      total: Number(rawTotal.toFixed(2)),
      ...(typeof entry.rationale === "string" ? { rationale: entry.rationale.slice(0, 500) } : {}),
    };
  });
  if (seen.size !== expected.size) throw new Error("Scoring response omitted one or more preview candidates.");
  const indexById = new Map(expectedIds.map((id, index) => [id, index]));
  scores.sort((a, b) => b.rawTotal - a.rawTotal || b.composition - a.composition ||
    (indexById.get(a.candidateId) ?? 0) - (indexById.get(b.candidateId) ?? 0));
  const ranked = scores.map((score, index) => ({
    candidateId: score.candidateId,
    adherence: score.adherence,
    composition: score.composition,
    anatomy: score.anatomy,
    style: score.style,
    technical: score.technical,
    total: score.total,
    ...(score.rationale ? { rationale: score.rationale } : {}),
    rank: index + 1,
  }));
  return {
    rubricVersion: 1,
    scores: ranked,
    selectedCandidateIds: ranked.slice(0, finalCount).map((score) => score.candidateId),
    selectionSource: "ai",
  };
}

async function scorePreviews(
  previews: PreviewExecutionTimelineResult,
  context: TimelineNodeExecutionContext,
): Promise<PreviewScoringTimelineResult> {
  const candidates = previews.candidates.filter((candidate) => candidate.status === "done" && candidate.storedImage);
  const sceneInput = context.workflow.nodes["scene-input"].result;
  const nsfw = isRecord(sceneInput) && sceneInput.nsfw === true;
  const model = nsfw
    ? process.env.LITELLM_NSFW_MODEL
    : process.env.LITELLM_VISION_MODEL || process.env.LITELLM_DEFAULT_MODEL;
  if (!model) {
    throw new TimelineNodeExecutionError(createTimelineNodeError(
      "llm_config",
      nsfw
        ? "LITELLM_NSFW_MODEL must be configured with multimodal support to score NSFW previews."
        : "LITELLM_VISION_MODEL or LITELLM_DEFAULT_MODEL is required to score previews.",
    ));
  }
  const content: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail: "low" } }> = [{
    type: "text",
    text: [
      "Score every labeled candidate and return JSON only: {\"candidates\":[{\"candidateId\":string,\"adherence\":number,\"composition\":number,\"anatomy\":number,\"style\":number,\"technical\":number,\"rationale\":string}]}",
      "Each score must be 0-100. Judge prompt/scene adherence, composition/spatial layout/pose clarity, anatomy/structural integrity, style/identity consistency, and technical quality/artifact freedom.",
      `Scene prompt: ${isRecord(context.workflow.nodes["parameter-recommendation"].result) && isRecord(context.workflow.nodes["parameter-recommendation"].result.requestPreview) ? String(context.workflow.nodes["parameter-recommendation"].result.requestPreview.positivePrompt ?? "") : ""}`,
    ].join("\n"),
  }];
  for (const candidate of candidates) {
    content.push({ type: "text", text: `Candidate ID: ${candidate.candidateId}` });
    content.push({ type: "image_url", image_url: { url: await storedImageDataUrl(candidate.storedImage!), detail: "low" } });
  }
  const request = {
    model,
    purpose: "single-image-preview-scoring" as const,
    nsfw,
    messages: [{ role: "user" as const, content }],
    temperature: 0,
    maxTokens: 2_000,
  };
  const client = createLiteLlmClient({
    baseUrl: process.env.LITELLM_BASE_URL ?? "",
    apiKey: process.env.LITELLM_API_KEY,
    defaultModel: model,
  });
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const completion = await client.completeChat(request);
      return validateScores(completion.content, candidates, previews.finalCount);
    } catch (error) {
      lastError = error;
    }
  }
  throw new TimelineNodeExecutionError(createTimelineNodeError(
    lastError instanceof LiteLlmError ? "llm_upstream" : "llm_malformed_response",
    "Preview scoring failed twice. The previews were retained; retry scoring to continue.",
    { recoverable: true },
  ));
}

async function executeFinals(
  requests: Array<{ candidateId: string; rank: number; request: ComfyUiTextToImageRequest; seed: number; storedPreview: TimelineStoredGeneratedImage }>,
  context: TimelineNodeExecutionContext,
  previous?: ComfyUiExecutionTimelineResult,
): Promise<ComfyUiExecutionTimelineResult> {
  const client = makeClient();
  let objectInfo: unknown;
  try {
    objectInfo = await client.getObjectInfo();
  } catch (error) {
    throw toComfyError(error);
  }
  const previousDone = new Map((previous?.finals ?? [])
    .filter((item) => item.status === "done" && requests.some((request) => request.candidateId === item.candidateId))
    .map((item) => [item.candidateId, item]));
  const finals: TimelineFinalExecutionRecord[] = [];
  const warnings: string[] = [...(previous?.warnings ?? [])];
  for (const item of requests) {
    const preserved = previousDone.get(item.candidateId);
    if (preserved) {
      finals.push({ ...preserved, rank: item.rank });
      continue;
    }
    try {
      const request = { ...item.request, sourceImageDataUrl: await storedImageDataUrl(item.storedPreview) };
      const result = await queueAndStore(client, objectInfo, request, context, `final-${item.candidateId}`);
      warnings.push(...result.warnings);
      finals.push({
        candidateId: item.candidateId,
        seed: item.seed,
        rank: item.rank,
        status: "done",
        promptId: result.promptId,
        sourceImage: result.sourceImage,
        storedImage: result.storedImage,
      });
    } catch (error) {
      finals.push({
        candidateId: item.candidateId,
        seed: item.seed,
        rank: item.rank,
        status: "error",
        error: normalizeTimelineError(error, "comfyui_execution_failed"),
      });
    }
  }
  finals.sort((a, b) => a.rank - b.rank);
  const firstRequest = requests[0]?.request;
  const partialResult: ComfyUiExecutionTimelineResult = {
    completed: finals.every((item) => item.status === "done") && finals.length === requests.length,
    finalCount: requests.length,
    finals,
    request: { ...firstRequest!, sourceImageDataUrl: undefined, imageName: undefined },
    warnings: [...new Set(warnings)],
  };
  if (!partialResult.completed) {
    throw new TimelineNodeExecutionError(createTimelineNodeError(
      "comfyui_execution_failed",
      `${finals.filter((item) => item.status === "done").length} of ${requests.length} final images completed. Retry to render only missing selections.`,
      { partialResult, recoverable: true },
    ));
  }
  return partialResult;
}

function loadResultDisplay(execution: ComfyUiExecutionTimelineResult): ResultDisplayTimelineResult {
  const completed = execution.finals.filter((item) => item.status === "done" && item.sourceImage && item.storedImage && item.promptId);
  if (!execution.completed || completed.length !== execution.finalCount) {
    throw new TimelineNodeExecutionError(createTimelineNodeError("comfyui_execution_failed", "All selected finals must complete before result display."));
  }
  const first = completed[0]!;
  return {
    completed: true,
    image: { ...first.sourceImage!, url: first.storedImage!.url },
    images: completed.map((item) => ({ ...item.sourceImage!, url: item.storedImage!.url })),
    promptId: first.promptId!,
    sourceImage: first.sourceImage!,
    sourceImages: completed.map((item) => item.sourceImage!),
    storedImage: first.storedImage!,
    storedImages: completed.map((item) => item.storedImage!),
    warnings: execution.warnings,
    finalLinks: completed.map((item) => ({
      candidateId: item.candidateId,
      promptId: item.promptId!,
      rank: item.rank,
      seed: item.seed,
    })),
  };
}

export function createTimelineT8ServerNodeAdapters(): TimelineNodeAdapters {
  return createTimelineT8NodeAdapters({
    executePreviews,
    scorePreviews,
    executeFinals,
    loadResultDisplay,
  });
}
