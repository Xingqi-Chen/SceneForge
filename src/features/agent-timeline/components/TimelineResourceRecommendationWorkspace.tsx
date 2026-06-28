"use client";

import { useMemo, useState } from "react";

import type {
  ResourceRecommendationTimelineResult,
  TimelineNodeResult,
} from "@/features/agent-timeline";
import { isSameCivitaiBaseModel } from "@/features/civitai-lora-library/base-model";
import type { SelectedCivitaiResourcePreview } from "@/features/civitai-lora-library/types";

import { Button } from "@/components/ui/button";

type TimelineResourceRecommendationWorkspaceProps = {
  editable: boolean;
  emptyState: string;
  node: TimelineNodeResult;
  onSave: (result: ResourceRecommendationTimelineResult) => void;
};

type LoraDraft = {
  id: string;
  reason: string;
  selected: boolean;
  weight: string;
};

function isResourceRecommendationResult(value: unknown): value is ResourceRecommendationTimelineResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "checkpoint" in value &&
    "loras" in value &&
    "candidates" in value
  );
}

function formatResourceLabel(resource: SelectedCivitaiResourcePreview) {
  return [resource.name, resource.versionName, resource.baseModel].filter(Boolean).join(" / ");
}

function isCompatibleLora(
  lora: SelectedCivitaiResourcePreview,
  checkpoint: SelectedCivitaiResourcePreview | null,
) {
  return !checkpoint?.baseModel || !lora.baseModel || isSameCivitaiBaseModel(lora.baseModel, checkpoint.baseModel);
}

function makeDraft(result: ResourceRecommendationTimelineResult) {
  const selectedLoras = new Map(result.loras.map((lora) => [lora.resource.id, lora]));

  return {
    checkpointId: result.checkpoint.resource.id,
    loras: result.candidates.loras.map((candidate) => {
      const selected = selectedLoras.get(candidate.resource.id);

      return {
        id: candidate.resource.id,
        reason: selected?.reason ?? "",
        selected: Boolean(selected),
        weight: String(selected?.suggestedWeight ?? candidate.resource.averageWeight ?? 0.7),
      };
    }),
  };
}

function parseWeight(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.min(2, Math.max(-2, Number(parsed.toFixed(2))));
}

export function TimelineResourceRecommendationWorkspace({
  editable,
  emptyState,
  node,
  onSave,
}: TimelineResourceRecommendationWorkspaceProps) {
  const result = isResourceRecommendationResult(node.result) ? node.result : null;
  const [draft, setDraft] = useState(() => (result ? makeDraft(result) : null));

  const checkpoint = useMemo(() => {
    if (!result || !draft) {
      return null;
    }

    return result.candidates.checkpoints.find((candidate) => candidate.resource.id === draft.checkpointId)?.resource ?? null;
  }, [draft, result]);

  if (!result || !draft) {
    return (
      <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-500">
        {node.error?.message ?? emptyState}
      </div>
    );
  }

  const selectedLoraCount = draft.loras.filter((lora) => lora.selected).length;
  const canSave = editable && Boolean(checkpoint) && selectedLoraCount <= 3;

  function updateLora(id: string, patch: Partial<LoraDraft>) {
    setDraft((current) =>
      current
        ? {
            ...current,
            loras: current.loras.map((lora) => (lora.id === id ? { ...lora, ...patch } : lora)),
          }
        : current,
    );
  }

  function handleSave() {
    if (!result || !draft || !checkpoint || !canSave) {
      return;
    }

    const loraById = new Map(result.candidates.loras.map((candidate) => [candidate.resource.id, candidate.resource]));
    const loras = draft.loras
      .filter((lora) => lora.selected)
      .flatMap((lora) => {
        const resource = loraById.get(lora.id);
        if (!resource || !isCompatibleLora(resource, checkpoint)) {
          return [];
        }

        return [{
          resource,
          suggestedWeight: parseWeight(lora.weight),
          reason: lora.reason.trim() || "Manual timeline selection.",
        }];
      })
      .slice(0, 3);

    onSave({
      ...result,
      checkpoint: {
        resource: checkpoint,
        reason: result.checkpoint.resource.id === checkpoint.id
          ? result.checkpoint.reason
          : "Manual timeline selection.",
      },
      loras,
      recommendationReason: "Manual local resource selection.",
    });
  }

  return (
    <div className="flex flex-col gap-4" data-testid="timeline-resource-workspace">
      <section className="rounded-md border border-slate-200 bg-slate-50 p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Selected checkpoint</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">{formatResourceLabel(result.checkpoint.resource)}</p>
          </div>
          <select
            className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            disabled={!editable}
            onChange={(event) => setDraft((current) => current ? { ...current, checkpointId: event.target.value } : current)}
            value={draft.checkpointId}
          >
            {result.candidates.checkpoints.map((candidate) => (
              <option key={candidate.resource.id} value={candidate.resource.id}>
                {formatResourceLabel(candidate.resource)}
              </option>
            ))}
          </select>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-slate-600">{result.checkpoint.reason}</p>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Local LoRA candidates</p>
          <span className="text-[11px] text-slate-500">{selectedLoraCount}/3 selected</span>
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          {result.candidates.loras.map((candidate) => {
            const loraDraft = draft.loras.find((item) => item.id === candidate.resource.id);
            const compatible = isCompatibleLora(candidate.resource, checkpoint);
            const selected = Boolean(loraDraft?.selected);

            return (
              <div
                className="rounded-md border border-slate-200 bg-white p-3"
                key={candidate.resource.id}
              >
                <label className="flex items-start gap-2 text-xs font-semibold text-slate-800">
                  <input
                    checked={selected}
                    className="mt-0.5"
                    disabled={!editable || !compatible || (!selected && selectedLoraCount >= 3)}
                    onChange={(event) => updateLora(candidate.resource.id, { selected: event.target.checked })}
                    type="checkbox"
                  />
                  <span className="min-w-0">
                    <span className="block break-words">{candidate.resource.name}</span>
                    <span className="mt-0.5 block text-[11px] font-normal text-slate-500">
                      {candidate.resource.baseModel ?? "Unknown base"} / score {candidate.score.toFixed(1)}
                    </span>
                  </span>
                </label>
                <div className="mt-2 grid grid-cols-[5rem_1fr] gap-2">
                  <input
                    className="h-8 rounded-md border border-slate-200 px-2 text-xs outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                    disabled={!editable || !selected}
                    max={2}
                    min={-2}
                    onChange={(event) => updateLora(candidate.resource.id, { weight: event.target.value })}
                    step={0.05}
                    type="number"
                    value={loraDraft?.weight ?? "0.7"}
                  />
                  <input
                    className="h-8 min-w-0 rounded-md border border-slate-200 px-2 text-xs outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                    disabled={!editable || !selected}
                    onChange={(event) => updateLora(candidate.resource.id, { reason: event.target.value })}
                    placeholder={compatible ? "Reason" : "Incompatible base model"}
                    value={loraDraft?.reason ?? ""}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {result.warnings.length > 0 ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
          {result.warnings.join(" ")}
        </div>
      ) : null}

      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
        {result.recommendationReason}
      </div>

      <div className="flex justify-end">
        <Button className="h-8 px-3 text-xs shadow-none" disabled={!canSave} onClick={handleSave} type="button">
          Save resources
        </Button>
      </div>
    </div>
  );
}
