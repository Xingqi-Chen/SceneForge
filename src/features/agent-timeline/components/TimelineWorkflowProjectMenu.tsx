"use client";

import { useCallback, useEffect, useState, type MouseEvent } from "react";
import { ChevronDown, FolderOpen, RefreshCw, Save, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  deleteTimelineWorkflowRecord,
  listTimelineWorkflowSummaries,
  loadTimelineWorkflowRecord,
  renameTimelineWorkflowRecord,
  saveTimelineWorkflowRecord,
} from "@/features/agent-timeline/timeline-workflow-storage";
import type {
  TimelineWorkflowRecord,
  TimelineWorkflowRecordInput,
  TimelineWorkflowSummary,
} from "@/features/agent-timeline/timeline-workflow-persistence";
import { cn } from "@/shared/utils/cn";

function formatUpdatedAt(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

type TimelineWorkflowProjectMenuProps = {
  currentProjectId: string | null;
  currentProjectName: string;
  disabled?: boolean;
  getCurrentRecordInput: () => TimelineWorkflowRecordInput | null;
  onDeleteCurrentProject: () => void;
  onRecordOpened: (record: TimelineWorkflowRecord) => void;
  onRecordSaved: (record: TimelineWorkflowRecord) => void;
  workflowMode?: TimelineWorkflowSummary["workflowMode"];
};

export function TimelineWorkflowProjectMenu({
  currentProjectId,
  currentProjectName,
  disabled = false,
  getCurrentRecordInput,
  onDeleteCurrentProject,
  onRecordOpened,
  onRecordSaved,
  workflowMode,
}: TimelineWorkflowProjectMenuProps) {
  const [open, setOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState(currentProjectName);
  const [summaries, setSummaries] = useState<TimelineWorkflowSummary[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [renaming, setRenaming] = useState(false);

  const refreshList = useCallback(async () => {
    setListError(null);
    setLoadingList(true);
    try {
      const listed = await listTimelineWorkflowSummaries();
      setSummaries(workflowMode ? listed.filter((summary) => summary.workflowMode === workflowMode) : listed);
    } catch (error) {
      console.warn("[SceneForge] [timeline] failed to list workflow projects", { error });
      setListError(error instanceof Error ? error.message : "Unable to list timeline workflows.");
    } finally {
      setLoadingList(false);
    }
  }, [workflowMode]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handle = window.setTimeout(() => {
      void refreshList();
    }, 0);

    return () => window.clearTimeout(handle);
  }, [open, refreshList]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open]);

  async function handleSave() {
    const input = getCurrentRecordInput();
    if (!input) {
      setActionError("Start a workflow before saving it.");
      return;
    }

    setActionError(null);
    setSaving(true);
    try {
      const saved = await saveTimelineWorkflowRecord({
        id: currentProjectId,
        input,
        name: nameDraft,
      });
      onRecordSaved(saved);
      setNameDraft(saved.name ?? "");
      await refreshList();
    } catch (error) {
      console.warn("[SceneForge] [timeline] failed to save workflow project", { error });
      setActionError(error instanceof Error ? error.message : "Unable to save the timeline workflow.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRename() {
    if (!currentProjectId || !nameDraft.trim()) {
      return;
    }

    setActionError(null);
    setRenaming(true);
    try {
      const renamed = await renameTimelineWorkflowRecord(currentProjectId, nameDraft);
      onRecordSaved(renamed);
      setNameDraft(renamed.name ?? "");
      await refreshList();
    } catch (error) {
      console.warn("[SceneForge] [timeline] failed to rename workflow project", { error });
      setActionError(error instanceof Error ? error.message : "Unable to rename the timeline workflow.");
    } finally {
      setRenaming(false);
    }
  }

  async function handleOpenWorkflow(id: string) {
    if (id === currentProjectId) {
      setOpen(false);
      return;
    }

    setActionError(null);
    setLoadingId(id);
    try {
      const record = await loadTimelineWorkflowRecord(id);
      if (!record) {
        setActionError("Timeline workflow was not found.");
        await refreshList();
        return;
      }

      onRecordOpened(record);
      setOpen(false);
    } catch (error) {
      console.warn("[SceneForge] [timeline] failed to open workflow project", { error, id });
      setActionError(error instanceof Error ? error.message : "Unable to open the timeline workflow.");
    } finally {
      setLoadingId(null);
    }
  }

  async function handleDeleteWorkflow(summary: TimelineWorkflowSummary, event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();

    const label = summary.name.trim() || summary.id;
    const activeSuffix = summary.id === currentProjectId
      ? "\nThe current timeline will remain open as an unnamed autosaved draft."
      : "";
    if (!window.confirm(`Delete timeline workflow "${label}" from local storage?${activeSuffix}`)) {
      return;
    }

    setActionError(null);
    setDeletingId(summary.id);
    try {
      await deleteTimelineWorkflowRecord(summary.id);
      if (summary.id === currentProjectId) {
        onDeleteCurrentProject();
        setNameDraft("");
      }
      await refreshList();
    } catch (error) {
      console.warn("[SceneForge] [timeline] failed to delete workflow project", { error, id: summary.id });
      setActionError(error instanceof Error ? error.message : "Unable to delete the timeline workflow.");
    } finally {
      setDeletingId(null);
    }
  }

  const busy = loadingId !== null || deletingId !== null || saving || renaming;
  const displayName = currentProjectName.trim() || "Unnamed draft";
  const canRename = Boolean(currentProjectId && nameDraft.trim() && nameDraft.trim() !== currentProjectName.trim());

  function handleToggleOpen() {
    setActionError(null);
    if (!open) {
      setNameDraft(currentProjectName);
    }
    setOpen((value) => !value);
  }

  return (
    <div className="relative flex items-center gap-2">
      <Button
        aria-expanded={open}
        aria-haspopup="listbox"
        className="h-9 max-w-[240px] justify-between gap-2 border-slate-200 px-2 font-normal shadow-none"
        disabled={disabled}
        onClick={handleToggleOpen}
        size="sm"
        type="button"
        variant="secondary"
      >
        <FolderOpen className="size-3.5 shrink-0 text-slate-500" />
        <span className="truncate text-left text-xs font-medium text-slate-800">{displayName}</span>
        <ChevronDown className={cn("size-3.5 shrink-0 text-slate-400 transition-transform", open && "rotate-180")} />
      </Button>

      {open ? (
        <>
          <button
            aria-label="Close timeline workflow menu"
            className="fixed inset-0 z-40 cursor-default bg-transparent"
            onClick={() => setOpen(false)}
            type="button"
          />
          <div
            className="absolute left-0 top-full z-50 mt-1 w-[min(calc(100vw-2rem),360px)] rounded-md border border-slate-200 bg-white py-1 shadow-lg"
            role="listbox"
          >
            <div className="border-b border-slate-100 px-3 py-2">
              <label className="text-[11px] font-medium uppercase tracking-wide text-slate-500" htmlFor="timeline-workflow-name">
                Workflow name
              </label>
              <input
                className="mt-1 w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
                id="timeline-workflow-name"
                onChange={(event) => setNameDraft(event.target.value)}
                placeholder="Scene request or timestamp fallback"
                value={nameDraft}
              />
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Button
                  className="h-8 px-2 text-xs shadow-none"
                  disabled={busy}
                  onClick={() => void handleSave()}
                  size="sm"
                  type="button"
                >
                  <Save className="size-3.5" />
                  Save
                </Button>
                <Button
                  className="h-8 px-2 text-xs shadow-none"
                  disabled={busy || !canRename}
                  onClick={() => void handleRename()}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  Rename
                </Button>
              </div>
            </div>

            <div className="max-h-60 overflow-y-auto px-1 py-1">
              <div className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">Saved workflows</div>
              {loadingList ? (
                <div className="px-2 py-2 text-xs text-slate-500">Loading workflows...</div>
              ) : listError ? (
                <div className="px-2 py-2 text-xs text-red-600">{listError}</div>
              ) : summaries.length === 0 ? (
                <div className="px-2 py-2 text-xs text-slate-500">No saved workflows yet.</div>
              ) : (
                summaries.map((summary) => {
                  const active = summary.id === currentProjectId;
                  return (
                    <div
                      className={cn(
                        "flex items-stretch gap-0.5 rounded px-1 py-0.5",
                        active ? "bg-blue-50 text-blue-900" : "text-slate-800",
                      )}
                      key={summary.id}
                    >
                      <button
                        aria-selected={active}
                        className={cn(
                          "flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded px-2 py-2 text-left text-xs transition-colors hover:bg-slate-100 disabled:opacity-50",
                          active && "hover:bg-blue-100",
                        )}
                        disabled={busy}
                        onClick={() => void handleOpenWorkflow(summary.id)}
                        role="option"
                        type="button"
                      >
                        <span className="font-medium">{summary.name.trim() || summary.id}</span>
                        <span className="text-[10px] text-slate-500">{formatUpdatedAt(summary.updatedAt)}</span>
                        {loadingId === summary.id ? <span className="text-[10px] text-blue-600">Opening...</span> : null}
                        {deletingId === summary.id ? <span className="text-[10px] text-slate-500">Deleting...</span> : null}
                      </button>
                      <Button
                        aria-label={`Delete workflow ${summary.name.trim() || summary.id}`}
                        className="h-auto shrink-0 self-stretch px-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        disabled={busy}
                        onClick={(event) => void handleDeleteWorkflow(summary, event)}
                        size="sm"
                        title="Delete workflow"
                        type="button"
                        variant="ghost"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  );
                })
              )}
            </div>

            {actionError ? <div className="border-t border-slate-100 px-3 py-2 text-xs text-red-600">{actionError}</div> : null}

            <div className="border-t border-slate-100 px-2 py-1.5">
              <Button
                className="h-7 w-full justify-center text-xs text-slate-600"
                disabled={loadingList}
                onClick={() => void refreshList()}
                size="sm"
                type="button"
                variant="ghost"
              >
                <RefreshCw className="size-3.5" />
                Refresh list
              </Button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
