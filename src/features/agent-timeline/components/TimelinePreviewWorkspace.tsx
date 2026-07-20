"use client";

import Image from "next/image";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import type {
  PreviewExecutionTimelineResult,
  PreviewScoringTimelineResult,
} from "@/features/agent-timeline/types";
import { cn } from "@/shared/utils/cn";

export function TimelinePreviewWorkspace({
  disabled,
  onRegenerate,
  previews,
  scoring,
}: {
  disabled?: boolean;
  onRegenerate?: (selectedCandidateIds: string[]) => void;
  previews: PreviewExecutionTimelineResult | null;
  scoring: PreviewScoringTimelineResult | null;
}) {
  const requiredCount = previews?.finalCount ?? 1;
  const [selection, setSelection] = useState<string[]>(scoring?.selectedCandidateIds ?? []);
  const scoreById = useMemo(
    () => new Map(scoring?.scores.map((score) => [score.candidateId, score]) ?? []),
    [scoring],
  );

  if (!previews) {
    return <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">Preview candidates are not available yet.</div>;
  }

  function toggle(candidateId: string) {
    setSelection((current) => current.includes(candidateId)
      ? current.filter((id) => id !== candidateId)
      : current.length < requiredCount ? [...current, candidateId] : current);
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
        <span>{previews.successfulCount}/{previews.candidateCount} previews · choose exactly {requiredCount}</span>
        {scoring && onRegenerate ? (
          <Button
            className="h-8 px-3 text-xs shadow-none"
            disabled={disabled || selection.length !== requiredCount ||
              selection.every((id, index) => id === scoring.selectedCandidateIds[index])}
            onClick={() => onRegenerate(selection)}
            type="button"
          >
            Regenerate selected finals
          </Button>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {previews.candidates.map((candidate) => {
          const score = scoreById.get(candidate.candidateId);
          const selected = selection.includes(candidate.candidateId);
          return (
            <button
              className={cn(
                "overflow-hidden rounded-md border bg-white text-left transition",
                selected ? "border-blue-500 ring-2 ring-blue-100" : "border-slate-200",
                candidate.status !== "done" && "cursor-not-allowed opacity-60",
              )}
              disabled={disabled || candidate.status !== "done" || !scoring}
              key={candidate.candidateId}
              onClick={() => toggle(candidate.candidateId)}
              type="button"
            >
              {candidate.storedImage ? (
                <Image
                  alt={`Preview ${candidate.index + 1}`}
                  className="aspect-square w-full object-cover"
                  height={512}
                  src={candidate.storedImage.url}
                  unoptimized
                  width={512}
                />
              ) : <div className="flex aspect-square items-center justify-center bg-slate-100 p-4 text-xs text-slate-500">{candidate.error?.message ?? "Preview failed"}</div>}
              <div className="grid gap-2 p-3 text-[11px] text-slate-600">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900">{candidate.candidateId}</span>
                  <span>{score ? `#${score.rank} · ${score.total.toFixed(2)}` : `seed ${candidate.seed}`}</span>
                </div>
                {score ? (
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                    <span>Adherence {score.adherence}</span><span>Composition {score.composition}</span>
                    <span>Anatomy {score.anatomy}</span><span>Style {score.style}</span>
                    <span>Technical {score.technical}</span><span>{selected ? "Selected" : "Not selected"}</span>
                  </div>
                ) : null}
                {score?.rationale ? <p className="leading-relaxed text-slate-500">{score.rationale}</p> : null}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
