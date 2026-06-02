import { NextResponse } from "next/server";

import { enrichCivitaiResource } from "@/features/civitai-lora-library/enrichment";
import { normalizeCivitaiModelVersionResponse } from "@/features/civitai-lora-library/normalize";
import type {
  CivitaiEnrichmentStatus,
  CivitaiResourceDetail,
  CivitaiResourceRecommendation,
  CivitaiResourceUpsertInput,
} from "@/features/civitai-lora-library/types";
import {
  getCivitaiResourceDetailFromSqlite,
  openSceneForgeSqliteDatabase,
  upsertCivitaiResourceToSqlite,
} from "@/features/persistence/sqlite-storage";

export const runtime = "nodejs";

type ReanalysisProposal = {
  enrichmentError: string | null;
  enrichmentStatus: CivitaiEnrichmentStatus;
  recommendations: CivitaiResourceRecommendation[];
  resourceId: string;
  resourceName: string;
  usageGuide: string | null;
};

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

function asNullableText(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error("usageGuide must be a string or null.");
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asNullableNumber(value: unknown, field: string): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${field} must be a finite number or null.`);
  }

  return value;
}

function asEnrichmentStatus(value: unknown): CivitaiEnrichmentStatus {
  if (value === "ai_enriched" || value === "ai_failed" || value === "fallback") {
    return value;
  }

  return "ai_enriched";
}

function sanitizeRecommendation(value: unknown): CivitaiResourceRecommendation {
  if (!isRecord(value)) {
    throw new Error("Each recommendation must be an object.");
  }

  return {
    condition: asNullableText(value.condition),
    baseModel: asNullableText(value.baseModel),
    checkpoint: asNullableText(value.checkpoint),
    sampler: asNullableText(value.sampler),
    loraWeightMin: asNullableNumber(value.loraWeightMin, "loraWeightMin"),
    loraWeightMax: asNullableNumber(value.loraWeightMax, "loraWeightMax"),
    loraWeight: asNullableNumber(value.loraWeight, "loraWeight"),
    hdRedrawRate: asNullableNumber(value.hdRedrawRate, "hdRedrawRate"),
    notes: asNullableText(value.notes),
  };
}

function sanitizeRecommendations(value: unknown): CivitaiResourceRecommendation[] {
  if (!Array.isArray(value)) {
    throw new Error("recommendations must be an array.");
  }

  return value.map(sanitizeRecommendation);
}

function toUpsertInput(resource: CivitaiResourceDetail): CivitaiResourceUpsertInput {
  return {
    resourceType: resource.resourceType,
    civitaiModelId: resource.civitaiModelId,
    civitaiModelVersionId: resource.civitaiModelVersionId,
    name: resource.name,
    versionName: resource.versionName,
    hash: resource.hash,
    baseModel: resource.baseModel,
    trainedWords: resource.trainedWords,
    tags: resource.tags,
    description: resource.description,
    creator: resource.creator,
    downloadUrl: resource.downloadUrl,
    filesJson: resource.filesJson,
    officialImagesJson: resource.officialImagesJson,
    category: resource.category,
    categories: resource.categories,
    usageGuide: resource.usageGuide,
    recommendations: resource.recommendations,
    enrichmentStatus: resource.enrichmentStatus,
    enrichmentError: resource.enrichmentError,
    nsfw: resource.nsfw,
    aiNsfwLevel: resource.aiNsfwLevel,
    aiNsfwConfidence: resource.aiNsfwConfidence,
    aiNsfwReason: resource.aiNsfwReason,
    rawVersionJson: resource.rawVersionJson,
  };
}

function toProposal(resource: CivitaiResourceDetail, proposal: {
  enrichmentError: string | null;
  enrichmentStatus: CivitaiEnrichmentStatus;
  recommendations: CivitaiResourceRecommendation[];
  usageGuide: string | null;
}): ReanalysisProposal {
  return {
    resourceId: resource.id,
    resourceName: resource.name,
    usageGuide: proposal.usageGuide,
    recommendations: proposal.recommendations,
    enrichmentStatus: proposal.enrichmentStatus,
    enrichmentError: proposal.enrichmentError,
  };
}

function assertSupportedResource(resource: CivitaiResourceDetail) {
  if (resource.resourceType !== "lora" && resource.resourceType !== "model") {
    throw new Error("Only LoRA and checkpoint resources can be reanalyzed.");
  }
}

async function loadModelPageDescription(resource: CivitaiResourceDetail): Promise<string | null> {
  if (resource.civitaiModelId === null) {
    return null;
  }

  const headers = {
    accept: "application/json",
    ...(process.env.CIVITAI_API_KEY ? { authorization: `Bearer ${process.env.CIVITAI_API_KEY}` } : {}),
  };
  const response = await fetch(`https://civitai.com/api/v1/models/${encodeURIComponent(String(resource.civitaiModelId))}`, {
    headers,
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error("Unable to read Civitai model page description.");
  }
  const normalized = normalizeCivitaiModelVersionResponse(payload, {
    preferredModelVersionId: resource.civitaiModelVersionId ?? undefined,
  });

  return normalized.description ?? null;
}

async function toReanalysisInput(resource: CivitaiResourceDetail): Promise<CivitaiResourceUpsertInput> {
  const modelPageDescription = await loadModelPageDescription(resource);

  return {
    ...toUpsertInput(resource),
    description: modelPageDescription ?? resource.description,
  };
}

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const db = await openSceneForgeSqliteDatabase();

  try {
    const resource = getCivitaiResourceDetailFromSqlite(db, id);
    if (!resource) {
      return errorResponse("Civitai resource was not found.", 404);
    }

    assertSupportedResource(resource);

    const enrichment = await enrichCivitaiResource(await toReanalysisInput(resource));

    return NextResponse.json(
      toProposal(resource, {
        usageGuide: enrichment.usageGuide,
        recommendations: enrichment.recommendations,
        enrichmentStatus: enrichment.status,
        enrichmentError: enrichment.error,
      }),
    );
  } catch (error) {
    console.error("[SceneForge] [civitai-lora-library] failed to reanalyze resource", { error });
    return errorResponse(error instanceof Error ? error.message : "Unable to reanalyze Civitai resource.", 500, error);
  } finally {
    db.close();
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const db = await openSceneForgeSqliteDatabase();

  try {
    const resource = getCivitaiResourceDetailFromSqlite(db, id);
    if (!resource) {
      return errorResponse("Civitai resource was not found.", 404);
    }

    assertSupportedResource(resource);

    const payload: unknown = await request.json().catch(() => null);
    if (!isRecord(payload) || payload.confirm !== true) {
      return errorResponse("Reanalysis overwrite must be explicitly confirmed.", 400);
    }

    const usageGuide = asNullableText(payload.usageGuide);
    const recommendations = sanitizeRecommendations(payload.recommendations);
    const enrichmentStatus = asEnrichmentStatus(payload.enrichmentStatus);
    const enrichmentError = asNullableText(payload.enrichmentError);
    const updated = upsertCivitaiResourceToSqlite(db, {
      ...toUpsertInput(resource),
      usageGuide,
      recommendations,
      enrichmentStatus,
      enrichmentError,
    }).resource;

    return NextResponse.json({
      proposal: toProposal(resource, {
        usageGuide,
        recommendations,
        enrichmentStatus,
        enrichmentError,
      }),
      resource: getCivitaiResourceDetailFromSqlite(db, updated.id),
    });
  } catch (error) {
    console.error("[SceneForge] [civitai-lora-library] failed to apply resource reanalysis", { error });
    return errorResponse(error instanceof Error ? error.message : "Unable to apply Civitai resource reanalysis.", 500, error);
  } finally {
    db.close();
  }
}
