"use client";

import { Bot, LockKeyhole, Sparkles } from "lucide-react";

import type {
  TimelineNodeId,
  TimelineNodeResult,
  TimelineNodeStatus as TimelineNodeStatusValue,
} from "@/features/agent-timeline";
import { cn } from "@/shared/utils/cn";

import { TimelineAiRetry } from "./TimelineAiRetry";
import { TimelineNodeEditor } from "./TimelineNodeEditor";
import { TimelineNodeStatus } from "./TimelineNodeStatus";
import { getTimelineNodeOutputText, timelineNodeContent } from "./timeline-node-content";

type TimelineNodeCardProps = {
  draft: string;
  index: number;
  isEditing: boolean;
  node: TimelineNodeResult;
  onCancelEdit: () => void;
  onDraftChange: (nodeId: TimelineNodeId, value: string) => void;
  onRequestAi: (nodeId: TimelineNodeId) => void;
  onSaveEdit: (nodeId: TimelineNodeId) => void;
  onStartEdit: (nodeId: TimelineNodeId) => void;
  shellNotice?: string;
};

const cardAccentClassName: Record<TimelineNodeStatusValue, string> = {
  blocked: "border-l-slate-300",
  ready: "border-l-blue-400",
  running: "border-l-indigo-400",
  done: "border-l-emerald-400",
  stale: "border-l-amber-400",
  error: "border-l-rose-400",
  manual: "border-l-violet-400",
};

const railClassName: Record<TimelineNodeStatusValue, string> = {
  blocked: "border-slate-200 bg-white text-slate-500",
  ready: "border-blue-200 bg-blue-50 text-blue-700",
  running: "border-indigo-200 bg-indigo-50 text-indigo-700",
  done: "border-emerald-200 bg-emerald-50 text-emerald-700",
  stale: "border-amber-200 bg-amber-50 text-amber-700",
  error: "border-rose-200 bg-rose-50 text-rose-700",
  manual: "border-violet-200 bg-violet-50 text-violet-700",
};

export function TimelineNodeCard({
  draft,
  index,
  isEditing,
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
  const TitleIcon = content.reserved ? LockKeyhole : Bot;

  return (
    <section className="relative flex gap-3 sm:gap-4">
      <div className="relative z-10 flex w-10 shrink-0 justify-center sm:w-12">
        <span
          className={cn(
            "flex size-10 items-center justify-center rounded-md border text-xs font-bold shadow-sm ring-4 ring-slate-100",
            railClassName[node.status],
          )}
        >
          {index + 1}
        </span>
      </div>

      <article
        className={cn(
          "min-w-0 flex-1 overflow-hidden rounded-md border border-l-4 border-slate-200 bg-white shadow-md shadow-slate-200/70 ring-1 ring-slate-100",
          cardAccentClassName[node.status],
        )}
      >
        <header className="flex flex-col gap-3 border-b border-slate-100 bg-white p-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-md border",
                content.reserved
                  ? "border-slate-200 bg-slate-50 text-slate-500"
                  : "border-blue-100 bg-blue-50 text-blue-700",
              )}
            >
              <TitleIcon className="size-4" />
            </div>
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
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <TimelineNodeStatus status={node.status} />
            <TimelineAiRetry disabled={aiDisabled} label={content.aiLabel} onRequest={() => onRequestAi(node.nodeId)} />
          </div>
        </header>

        <div className="flex flex-col gap-3 p-4">
          {isGenerationGate ? (
            <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800 shadow-sm shadow-amber-100/70">
              <LockKeyhole className="mt-0.5 size-4 shrink-0" />
              <p>
                ComfyUI execution requires explicit future confirmation. This shell stops at the gate and never starts
                generation.
              </p>
            </div>
          ) : null}

          {shellNotice ? (
            <div className="flex gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-xs leading-relaxed text-blue-700 shadow-sm shadow-blue-100/70">
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
              "flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-[11px] text-slate-500",
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
