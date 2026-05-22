import { NextResponse } from "next/server";

import type {
  CivitaiResourceDetail,
  SelectedCivitaiResourcePreview,
  SelectedCivitaiResourcesPreview,
} from "@/features/civitai-lora-library";
import {
  getCivitaiResourceDetailFromSqlite,
  openSceneForgeSqliteDatabase,
} from "@/features/persistence/sqlite-storage";

export const runtime = "nodejs";
const DESCRIPTION_SNIPPET_MAX_LENGTH = 800;

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

function parseIdList(value: string | null) {
  if (!value) {
    return [];
  }

  const seen = new Set<string>();
  const ids: string[] = [];

  for (const rawId of value.split(",")) {
    const id = rawId.trim();
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

  if (text.length <= DESCRIPTION_SNIPPET_MAX_LENGTH) {
    return text;
  }

  return `${text.slice(0, DESCRIPTION_SNIPPET_MAX_LENGTH).trimEnd()}...`;
}

function toPreviewResource(resource: CivitaiResourceDetail): SelectedCivitaiResourcePreview {
  return {
    id: resource.id,
    resourceType: resource.resourceType === "model" ? "model" : "lora",
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
  };
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const checkpointId = params.get("checkpointId")?.trim() || "";
  const loraIds = parseIdList(params.get("loraIds"));
  const db = await openSceneForgeSqliteDatabase();

  try {
    let checkpoint: SelectedCivitaiResourcePreview | null = null;
    if (checkpointId) {
      const resource = getCivitaiResourceDetailFromSqlite(db, checkpointId);
      if (resource?.resourceType === "model") {
        checkpoint = toPreviewResource(resource);
      }
    }

    const loras = loraIds
      .map((id) => getCivitaiResourceDetailFromSqlite(db, id))
      .filter((resource): resource is CivitaiResourceDetail => resource?.resourceType === "lora")
      .map(toPreviewResource);

    const payload: SelectedCivitaiResourcesPreview = { checkpoint, loras };
    return NextResponse.json(payload);
  } catch (error) {
    console.error("[SceneForge] [civitai-lora-library] failed to read selected resources", { error });
    return errorResponse("无法读取已选 Civitai 资源。", 500, error);
  } finally {
    db.close();
  }
}
