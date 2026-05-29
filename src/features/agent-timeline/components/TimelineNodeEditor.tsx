"use client";

import { LockKeyhole, PencilLine, Save, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/shared/utils/cn";

type TimelineNodeEditorProps = {
  draft: string;
  editLabel: string;
  editable: boolean;
  emptyState: string;
  error?: boolean;
  isEditing: boolean;
  onCancel: () => void;
  onDraftChange: (value: string) => void;
  onEdit: () => void;
  onSave: () => void;
  output: string;
};

export function TimelineNodeEditor({
  draft,
  editLabel,
  editable,
  emptyState,
  error = false,
  isEditing,
  onCancel,
  onDraftChange,
  onEdit,
  onSave,
  output,
}: TimelineNodeEditorProps) {
  const trimmedDraft = draft.trim();

  if (isEditing) {
    return (
      <div className="flex flex-col gap-3">
        <textarea
          className="min-h-28 w-full resize-y rounded-md border border-slate-200 bg-white p-3 font-mono text-xs leading-relaxed text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          onChange={(event) => onDraftChange(event.target.value)}
          value={draft}
        />
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button className="h-8 px-2.5 text-xs shadow-none" onClick={onCancel} type="button" variant="secondary">
            <X className="size-3.5" />
            Cancel
          </Button>
          <Button className="h-8 px-2.5 text-xs shadow-none" disabled={!trimmedDraft} onClick={onSave} type="button">
            <Save className="size-3.5" />
            Save manual
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        className={cn(
          "min-h-24 rounded-md border p-3 text-xs leading-relaxed",
          error
            ? "border-rose-200 bg-rose-50 text-rose-700"
            : output
              ? "border-slate-200 bg-white text-slate-700"
              : "border-dashed border-slate-200 bg-slate-50 text-slate-500",
        )}
      >
        {output ? <pre className="whitespace-pre-wrap font-mono">{output}</pre> : emptyState}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          className="h-8 px-2.5 text-xs shadow-none"
          disabled={!editable}
          onClick={onEdit}
          title={editable ? editLabel : "This reserved node is locked for a later implementation slice"}
          type="button"
          variant="secondary"
        >
          {editable ? <PencilLine className="size-3.5" /> : <LockKeyhole className="size-3.5" />}
          {editLabel}
        </Button>
      </div>
    </div>
  );
}
