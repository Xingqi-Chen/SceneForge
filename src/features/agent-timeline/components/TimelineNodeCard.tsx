"use client";

import { LockKeyhole, Sparkles } from "lucide-react";

import type { TimelineNodeId, TimelineNodeResult } from "@/features/agent-timeline";
import { cn } from "@/shared/utils/cn";

import { TimelineAiRetry } from "./TimelineAiRetry";
import { TimelineNodeEditor } from "./TimelineNodeEditor";
import { TimelineNodeStatus } from "./TimelineNodeStatus";
import { getTimelineNodeOutputText, timelineNodeContent } from "./timeline-node-content";

type TimelineNodeCardProps = {
  draft: string;
  index: number;
  isEditing: boolean;
  isLast: boolean;
  node: TimelineNodeResult;
  onCancelEdit: () => void;
  onDraftChange: (nodeId: TimelineNodeId, value: string) => void;
  onRequestAi: (nodeId: TimelineNodeId) => void;
  onSaveEdit: (nodeId: TimelineNodeId) => void;
  onStartEdit: (nodeId: TimelineNodeId) => void;
  shellNotice?: string;
};

export function TimelineNodeCard({
  draft,
  index,
  isEditing,
  isLast,
  node,
  onCancelEdit,
  onDraftChange,
  onRequestAi,
  onSaveEdit,
  onStartEdit,
  shellNotice,
}: TimelineNodeCardProps) {
  const content = timelineNodeContent[node.nodeId];
  const output = getTimelineNodeOutputText(node);
  const editable = !content.reserved && node.status !== "running";
  const aiDisabled = content.reserved || node.status === "blocked" || node.status === "running";
  const isGenerationGate = node.nodeId === "generation-gate";

  return (
    <section className="relative grid gap-3 sm:grid-cols-[2.75rem_minmax(0,1fr)]">
      <div className="relative hidden justify-center sm:flex">
        {!isLast ? <span className="absolute top-10 bottom-[-1.5rem] w-px bg-slate-200" /> : null}
        <span className="relative z-10 flex size-9 items-center justify-center rounded-md border border-slate-200 bg-white text-xs font-bold text-slate-500 shadow-sm">
          {index + 1}
        </span>
      </div>

      <article className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
        <header className="flex flex-col gap-3 border-b border-slate-100 bg-white p-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-bold text-slate-900">{content.title}</h2>
              {content.reserved ? (
                <span className="inline-flex h-6 items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Reserved
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">{content.shellState}</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <TimelineNodeStatus status={node.status} />
            <TimelineAiRetry disabled={aiDisabled} label={content.aiLabel} onRequest={() => onRequestAi(node.nodeId)} />
          </div>
        </header>

        <div className="flex flex-col gap-3 p-4">
          {isGenerationGate ? (
            <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
              <LockKeyhole className="mt-0.5 size-4 shrink-0" />
              <p>
                ComfyUI execution requires explicit future confirmation. This shell stops at the gate and never starts
                generation.
              </p>
            </div>
          ) : null}

          {shellNotice ? (
            <div className="flex gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-xs leading-relaxed text-blue-700">
              <Sparkles className="mt-0.5 size-4 shrink-0" />
              <p>{shellNotice}</p>
            </div>
          ) : null}

          <TimelineNodeEditor
            draft={draft}
            editLabel={content.editLabel}
            editable={editable}
            emptyState={content.emptyState}
            error={node.status === "error"}
            isEditing={isEditing}
            onCancel={onCancelEdit}
            onDraftChange={(value) => onDraftChange(node.nodeId, value)}
            onEdit={() => onStartEdit(node.nodeId)}
            onSave={() => onSaveEdit(node.nodeId)}
            output={output}
          />

          <div
            className={cn(
              "flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-[11px] text-slate-400",
              node.status === "stale" && "text-amber-600",
            )}
          >
            <span>Source: {node.source}</span>
            <span>{new Date(node.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          </div>
        </div>
      </article>
    </section>
  );
}
