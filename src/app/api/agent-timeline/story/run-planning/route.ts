import { NextResponse } from "next/server";

import {
  loadStorySamplerOptionsFromComfyUi,
  runStoryPlanning,
  type RunStoryPlanningRequest,
} from "@/features/agent-timeline/story-runner";
import { createTimelineNodeError } from "@/features/agent-timeline/state";
import type {
  StoryResourceCandidateLoadRequest,
  StoryResourceCandidateSet,
} from "@/features/agent-timeline/story-llm-adapters";
import type { StoryLocalResource } from "@/features/agent-timeline/story-planning";
import { TimelineNodeExecutionError } from "@/features/agent-timeline/types";
import {
  getCivitaiModelStorageKind,
  getCivitaiResourceConfiguredDownloadPath,
  makeCivitaiResourceFileNameAliases,
  makeCivitaiResourceTargetFileName,
} from "@/features/civitai-lora-library/resource-files";
import {
  getCivitaiResourceDownloadStatus,
  isCivitaiResourceDownloadReady,
} from "@/features/civitai-lora-library/download";
import type {
  CivitaiPromptReference,
  CivitaiResourceDetail,
} from "@/features/civitai-lora-library";
import { extractCivitaiExampleImageDimensions } from "@/features/civitai-lora-library/image-dimensions";
import type {
  StoryWorkflowState,
} from "@/features/agent-timeline/story-state";
import type {
  StoryWorkflowNodeId,
} from "@/features/agent-timeline/story-types";

export const runtime = "nodejs";
const DESCRIPTION_SNIPPET_MAX_LENGTH = 800;
const PROMPT_REFERENCE_LIMIT = 6;
const PROMPT_REFERENCE_MAX_LENGTH = 1200;

function errorResponse(message: string, status: number, details?: unknown) {
  return NextResponse.json(
    {
      error: {
        message,
        details,
      },
    },
    { status },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeSettingsSnapshot(value: unknown): RunStoryPlanningRequest["settingsSnapshot"] {
  if (!isRecord(value)) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "resourceCandidates"),
  ) as RunStoryPlanningRequest["settingsSnapshot"];
}

function parseRequest(payload: unknown): RunStoryPlanningRequest | null {
  if (!isRecord(payload) || typeof payload.rawIntent !== "string") {
    return null;
  }

  return {
    rawIntent: payload.rawIntent,
    storyId: typeof payload.storyId === "string" ? payload.storyId : undefined,
    targetShotCount: typeof payload.targetShotCount === "number" ? payload.targetShotCount : undefined,
    nsfwEnabled: typeof payload.nsfwEnabled === "boolean" ? payload.nsfwEnabled : undefined,
    settingsSnapshot: sanitizeSettingsSnapshot(payload.settingsSnapshot),
    workflowId: typeof payload.workflowId === "string" ? payload.workflowId : undefined,
  };
}

function wantsStreamingResponse(request: Request) {
  const accept = request.headers.get("accept") ?? "";
  return accept.includes("application/x-ndjson");
}

type RankedCivitaiCandidate = {
  resource: StoryLocalResource;
  importedImageCount: number;
  commonCheckpoints: NonNullable<StoryLocalResource["commonCheckpoints"]>;
  commonLoras: NonNullable<StoryLocalResource["commonLoras"]>;
  score: number;
};

function parseSelectedResourceId(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function invalidSelectedStoryResource(message: string, details?: unknown): never {
  throw new TimelineNodeExecutionError(createTimelineNodeError("resource_selection_invalid", message, details));
}

function parseSelectedResourceIds(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const ids: string[] = [];

  for (const rawId of value) {
    const id = parseSelectedResourceId(rawId);
    if (!id || seen.has(id)) {
      continue;
    }

    seen.add(id);
    ids.push(id);
  }

  return ids;
}

function sanitizeDescriptionSnippet(description: string | null) {
  const text = description
    ?.replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .trim();

  if (!text) {
    return null;
  }

  return text.length <= DESCRIPTION_SNIPPET_MAX_LENGTH
    ? text
    : `${text.slice(0, DESCRIPTION_SNIPPET_MAX_LENGTH).trimEnd()}...`;
}

function sanitizePromptReferenceText(value: string | null) {
  const text = value?.replace(/\s+/g, " ").trim();

  if (!text) {
    return null;
  }

  return text.length <= PROMPT_REFERENCE_MAX_LENGTH
    ? text
    : `${text.slice(0, PROMPT_REFERENCE_MAX_LENGTH).trimEnd()}...`;
}

function getPromptReferences(resource: CivitaiResourceDetail): CivitaiPromptReference[] {
  const seen = new Set<string>();
  const references: CivitaiPromptReference[] = [];

  for (const usage of resource.usages) {
    const prompt = sanitizePromptReferenceText(usage.importedImage.prompt);
    if (!prompt || seen.has(prompt.toLocaleLowerCase())) {
      continue;
    }

    seen.add(prompt.toLocaleLowerCase());
    references.push({
      cfgScale: usage.importedImage.cfgScale,
      civitaiImagePageUrl: usage.importedImage.civitaiImagePageUrl,
      negativePrompt: sanitizePromptReferenceText(usage.importedImage.negativePrompt),
      prompt,
      sampler: usage.importedImage.sampler,
      seed: usage.importedImage.seed,
      steps: usage.importedImage.steps,
    });

    if (references.length >= PROMPT_REFERENCE_LIMIT) {
      break;
    }
  }

  return references;
}

function toStoryLocalResourceFromCivitaiDetail(resource: CivitaiResourceDetail): StoryLocalResource {
  return {
    id: resource.id,
    name: resource.name,
    versionName: resource.versionName,
    baseModel: resource.baseModel,
    creator: resource.creator,
    trainedWords: resource.trainedWords,
    tags: resource.tags,
    categories: resource.categories,
    usageGuide: resource.usageGuide,
    descriptionSnippet: sanitizeDescriptionSnippet(resource.description),
    averageWeight: resource.averageWeight,
    minWeight: resource.minWeight,
    maxWeight: resource.maxWeight,
    recommendations: resource.recommendations,
    previewImage: resource.previewImage,
    modelFileName: makeCivitaiResourceTargetFileName(resource),
    modelFileNameAliases: makeCivitaiResourceFileNameAliases(resource),
    modelBaseModel: resource.baseModel ?? undefined,
    modelStorageKind: resource.resourceType === "model" ? getCivitaiModelStorageKind(resource) : undefined,
    promptReferences: getPromptReferences(resource),
    exampleImageDimensions: extractCivitaiExampleImageDimensions(resource.officialImagesJson),
    importedImageCount: resource.importedImageCount,
    commonCheckpoints: resource.commonCheckpoints,
    commonLoras: resource.commonLoras,
  };
}

function toStoryLocalResourceFromRankedCandidate(
  candidate: RankedCivitaiCandidate,
  index: number,
): StoryLocalResource {
  const resource = candidate.resource;

  return {
    id: resource.id,
    name: resource.name,
    versionName: resource.versionName,
    baseModel: resource.baseModel,
    creator: resource.creator,
    trainedWords: resource.trainedWords,
    tags: resource.tags,
    categories: resource.categories,
    usageGuide: resource.usageGuide,
    descriptionSnippet: resource.descriptionSnippet,
    averageWeight: resource.averageWeight,
    minWeight: resource.minWeight,
    maxWeight: resource.maxWeight,
    recommendations: resource.recommendations,
    previewImage: resource.previewImage,
    modelFileName: resource.modelFileName,
    modelFileNameAliases: resource.modelFileNameAliases,
    modelBaseModel: resource.baseModel ?? undefined,
    modelStorageKind: resource.modelStorageKind,
    promptReferences: resource.promptReferences,
    exampleImageDimensions: resource.exampleImageDimensions,
    importedImageCount: candidate.importedImageCount,
    commonCheckpoints: candidate.commonCheckpoints,
    commonLoras: candidate.commonLoras,
    recommendationScore: candidate.score,
    recommendationRank: index + 1,
  };
}

function mergeStoryResourceCandidates(
  ranked: StoryLocalResource[],
  explicitResources: StoryLocalResource[],
) {
  const merged = [...ranked];
  const seen = new Set(merged.map((resource) => resource.id));

  for (const resource of explicitResources) {
    if (seen.has(resource.id)) {
      continue;
    }

    seen.add(resource.id);
    merged.push(resource);
  }

  return merged;
}

async function loadStoryResourceCandidatesFromCivitai(
  request: StoryResourceCandidateLoadRequest,
): Promise<StoryResourceCandidateSet> {
  const {
    getCivitaiResourceDetailFromSqlite,
    loadCivitaiLibrarySettingsFromSqlite,
    openSceneForgeSqliteDatabase,
  } = await import("@/features/persistence/sqlite-storage");
  const db = await openSceneForgeSqliteDatabase(undefined, { allowExtensions: true });

  try {
    const selectedCheckpointId = parseSelectedResourceId(request.selectedCheckpointId);
    const selectedLoraIds = parseSelectedResourceIds(request.selectedLoraIds);
    const hasExplicitResources = Boolean(selectedCheckpointId) || selectedLoraIds.length > 0;
    let explicitCheckpoints: StoryLocalResource[] = [];
    let explicitLoras: StoryLocalResource[] = [];

    if (hasExplicitResources) {
      const settings = loadCivitaiLibrarySettingsFromSqlite(db);
      const loadExplicitResource = async (
        id: string,
        expectedType: "model" | "lora",
        label: "checkpoint" | "LoRA",
      ) => {
        const resource = getCivitaiResourceDetailFromSqlite(db, id);

        if (!resource) {
          invalidSelectedStoryResource(`Selected Story ${label} "${id}" was not found in the local Civitai library.`, {
            id,
          });
        }

        if (resource.resourceType !== expectedType) {
          invalidSelectedStoryResource(
            `Selected Story ${label} "${resource.name}" has type "${resource.resourceType}", not "${expectedType}".`,
            {
              expectedType,
              id,
              resourceType: resource.resourceType,
            },
          );
        }

        const status = await getCivitaiResourceDownloadStatus(
          resource,
          getCivitaiResourceConfiguredDownloadPath(resource, settings),
        );
        if (!isCivitaiResourceDownloadReady(status)) {
          invalidSelectedStoryResource(
            `Selected Story ${label} "${resource.name}" is not available to ComfyUI: ${status.message ?? status.status}.`,
            {
              id,
              status,
            },
          );
        }

        return toStoryLocalResourceFromCivitaiDetail(resource);
      };

      explicitCheckpoints = selectedCheckpointId
        ? [await loadExplicitResource(selectedCheckpointId, "model", "checkpoint")]
        : [];
      explicitLoras = await Promise.all(
        selectedLoraIds.map((id) => loadExplicitResource(id, "lora", "LoRA")),
      );
    }

    let candidates: {
      checkpoints: RankedCivitaiCandidate[];
      loras: RankedCivitaiCandidate[];
    };
    try {
      const { loadCivitaiRecommendationCandidates } = await import(
        "@/features/civitai-lora-library/ai-recommendation"
      );
      candidates = await loadCivitaiRecommendationCandidates(db, request.desiredEffect, {
        promptProfile: request.promptProfile,
      });
    } catch (error) {
      if (!hasExplicitResources) {
        throw error;
      }

      candidates = {
        checkpoints: [],
        loras: [],
      };
    }

    return {
      checkpoints: mergeStoryResourceCandidates(
        candidates.checkpoints.map(toStoryLocalResourceFromRankedCandidate),
        explicitCheckpoints,
      ),
      loras: mergeStoryResourceCandidates(
        candidates.loras.map(toStoryLocalResourceFromRankedCandidate),
        explicitLoras,
      ),
    };
  } finally {
    db.close();
  }
}

function createPlanningStream(planningRequest: RunStoryPlanningRequest) {
  const encoder = new TextEncoder();

  function encode(event: unknown) {
    return encoder.encode(`${JSON.stringify(event)}\n`);
  }

  return new ReadableStream({
    async start(controller) {
      try {
        const workflow = await runStoryPlanning(planningRequest, {
          loadResourceCandidates: loadStoryResourceCandidatesFromCivitai,
          loadSamplerOptions: loadStorySamplerOptionsFromComfyUi,
          onWorkflowUpdate: (updatedWorkflow: StoryWorkflowState, nodeId: StoryWorkflowNodeId) => {
            controller.enqueue(encode({
              nodeId,
              type: "workflow",
              workflow: updatedWorkflow,
            }));
          },
        });

        controller.enqueue(encode({
          type: "done",
          workflow,
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected Story Graph planning failure.";
        console.error("[SceneForge] [agent-timeline] Story Graph planning stream failed", { error });
        controller.enqueue(encode({
          error: {
            message,
          },
          type: "error",
        }));
      } finally {
        controller.close();
      }
    },
  });
}

export async function POST(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return errorResponse("Request body must be valid JSON.", 400);
  }

  const planningRequest = parseRequest(payload);
  if (!planningRequest) {
    return errorResponse("Story planning requires rawIntent.", 400);
  }

  if (wantsStreamingResponse(request)) {
    return new Response(createPlanningStream(planningRequest), {
      headers: {
        "cache-control": "no-store",
        "content-type": "application/x-ndjson; charset=utf-8",
      },
    });
  }

  try {
    const workflow = await runStoryPlanning(planningRequest, {
      loadResourceCandidates: loadStoryResourceCandidatesFromCivitai,
      loadSamplerOptions: loadStorySamplerOptionsFromComfyUi,
    });

    return NextResponse.json({
      workflow,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected Story Graph planning failure.";
    console.error("[SceneForge] [agent-timeline] Story Graph planning failed", { error });
    return errorResponse(message, 500);
  }
}
