"use client";

import Image from "next/image";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import type {
  PreviewExecutionTimelineResult,
  PreviewScoringTimelineResult,
} from "@/features/agent-timeline/types";
import { createTimelinePreviewSelectionFallbackMetadata } from "@/features/agent-timeline/types";
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
  const legacyRubric = scoring?.rubricVersion === 1;
  const fallbackMetadata = scoring?.rubricVersion === 2
    ? createTimelinePreviewSelectionFallbackMetadata(scoring.scores, scoring.selectedCandidateIds)
    : null;
  const pendingSelectionFallbackIds = scoring?.rubricVersion === 2
    ? createTimelinePreviewSelectionFallbackMetadata(scoring.scores, selection).fallbackCandidateIds
    : [];

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
              legacyRubric ||
              selection.every((id, index) => id === scoring.selectedCandidateIds[index])}
            onClick={() => onRegenerate(selection)}
            type="button"
          >
            Regenerate selected finals
          </Button>
        ) : null}
      </div>
      {fallbackMetadata?.selectionWarning ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
          {fallbackMetadata.selectionWarning}
        </div>
      ) : null}
      {pendingSelectionFallbackIds.length > 0 &&
          !pendingSelectionFallbackIds.every((candidateId) => fallbackMetadata?.fallbackCandidateIds.includes(candidateId)) ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
          This manual selection includes {pendingSelectionFallbackIds.length} candidate{pendingSelectionFallbackIds.length === 1 ? "" : "s"} with
          blocking-defect annotations. Final generation is allowed, but review the visible defects before continuing.
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {previews.candidates.map((candidate) => {
          const score = scoreById.get(candidate.candidateId);
          const selected = selection.includes(candidate.candidateId);
          const eligible = score && "eligible" in score ? score.eligible : false;
          const criticalDefects = score && "criticalDefects" in score ? score.criticalDefects : [];
          return (
            <button
              className={cn(
                "overflow-hidden rounded-md border bg-white text-left transition",
                selected ? "border-blue-500 ring-2 ring-blue-100" : "border-slate-200",
                candidate.status !== "done" && "cursor-not-allowed opacity-60",
                candidate.status === "done" && score && !eligible && "border-amber-300",
              )}
              disabled={disabled || candidate.status !== "done" || !score || legacyRubric}
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
                    <span>Technical {score.technical}</span>
                    <span>{legacyRubric
                      ? "Legacy rubric · eligibility not assessed"
                      : eligible
                        ? criticalDefects.length > 0 ? "Eligible · non-blocking annotations" : "Eligible"
                        : "Ineligible · fallback allowed"}</span>
                  </div>
                ) : null}
                {criticalDefects.length > 0 ? (
                  <ul className="grid gap-1 text-amber-700">
                    {criticalDefects.map((defect) => (
                      <li key={defect.category}>{defect.description}</li>
                    ))}
                  </ul>
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
