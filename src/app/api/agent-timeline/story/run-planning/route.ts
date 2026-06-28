import { NextResponse } from "next/server";

import {
  loadStorySamplerOptionsFromComfyUi,
  runStoryPlanning,
  type RunStoryPlanningRequest,
} from "@/features/agent-timeline/story-runner";
import type {
  StoryResourceCandidateLoadRequest,
  StoryResourceCandidateSet,
} from "@/features/agent-timeline/story-llm-adapters";
import type { StoryLocalResource } from "@/features/agent-timeline/story-planning";
import type {
  StoryWorkflowState,
} from "@/features/agent-timeline/story-state";
import type {
  StoryWorkflowNodeId,
} from "@/features/agent-timeline/story-types";

export const runtime = "nodejs";

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

async function loadStoryResourceCandidatesFromCivitai(
  request: StoryResourceCandidateLoadRequest,
): Promise<StoryResourceCandidateSet> {
  const [
    { loadCivitaiRecommendationCandidates },
    { openSceneForgeSqliteDatabase },
  ] = await Promise.all([
    import("@/features/civitai-lora-library/ai-recommendation"),
    import("@/features/persistence/sqlite-storage"),
  ]);
  const db = await openSceneForgeSqliteDatabase(undefined, { allowExtensions: true });

  try {
    const candidates = await loadCivitaiRecommendationCandidates(db, request.desiredEffect, {
      promptProfile: request.promptProfile,
    });

    return {
      checkpoints: candidates.checkpoints.map(toStoryLocalResourceFromRankedCandidate),
      loras: candidates.loras.map(toStoryLocalResourceFromRankedCandidate),
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
