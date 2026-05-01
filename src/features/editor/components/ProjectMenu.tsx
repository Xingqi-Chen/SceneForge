"use client";

import { useCallback, useEffect, useState, type MouseEvent } from "react";
import { ChevronDown, FolderOpen, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { deleteProject, listProjects, loadProject } from "@/features/persistence";
import { useEditorStore } from "@/features/editor/store/editor-store";
import type { ProjectSummary } from "@/shared/types";

function formatUpdatedAt(iso: string) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      return "";
    }
    return d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
  } catch {
    return "";
  }
}

export function ProjectMenu() {
  const project = useEditorStore((s) => s.project);
  const setProject = useEditorStore((s) => s.setProject);
  const resetProject = useEditorStore((s) => s.resetProject);
  const updateProjectDocument = useEditorStore((s) => s.updateProjectDocument);
  const [open, setOpen] = useState(false);
  const [summaries, setSummaries] = useState<ProjectSummary[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const refreshList = useCallback(async () => {
    setListError(null);
    setLoadingList(true);
    try {
      const list = await listProjects();
      setSummaries(list);
    } catch (error) {
      console.warn("[SceneForge] [editor] failed to list projects", { error });
      setListError(error instanceof Error ? error.message : "无法加载项目列表");
    } finally {
      setLoadingList(false);
    }
  }, []);

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

  async function handlePickProject(id: string) {
    if (id === project.id) {
      setOpen(false);
      return;
    }

    setLoadError(null);
    setLoadingId(id);
    try {
      const loaded = await loadProject(id);
      if (loaded) {
        setProject(loaded);
        setOpen(false);
      } else {
        setLoadError("未找到该项目文件。");
      }
    } catch (error) {
      console.warn("[SceneForge] [editor] failed to load project", { error, id });
      setLoadError(error instanceof Error ? error.message : "打开项目失败");
    } finally {
      setLoadingId(null);
    }
  }

  async function handleDeleteProject(summary: ProjectSummary, event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();

    const label = summary.name.trim() || summary.id;
    const confirmed = window.confirm(`确定从本机删除项目「${label}」？\n此操作不可恢复。`);
    if (!confirmed) {
      return;
    }

    setLoadError(null);
    setDeletingId(summary.id);
    try {
      await deleteProject(summary.id);
      console.info("[SceneForge] [editor] deleted local project", { projectId: summary.id });

      if (summary.id === project.id) {
        resetProject();
      }

      await refreshList();
    } catch (error) {
      console.warn("[SceneForge] [editor] failed to delete project", { error, id: summary.id });
      setLoadError(error instanceof Error ? error.message : "删除项目失败");
    } finally {
      setDeletingId(null);
    }
  }

  const displayName = project.name.trim() || "未命名项目";

  return (
    <div className="relative flex items-center gap-2">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="h-8 max-w-[220px] justify-between gap-2 border-slate-200 px-2 font-normal shadow-none"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <FolderOpen className="size-3.5 shrink-0 text-slate-500" />
        <span className="truncate text-left text-xs font-medium text-slate-800">{displayName}</span>
        <ChevronDown className={`size-3.5 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </Button>

      {open ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default bg-transparent"
            aria-label="关闭项目菜单"
            onClick={() => setOpen(false)}
          />
          <div
            className="absolute left-0 top-full z-50 mt-1 w-[min(100vw-2rem,320px)] rounded-md border border-slate-200 bg-white py-1 shadow-lg"
            role="listbox"
          >
            <div className="border-b border-slate-100 px-3 py-2">
              <label className="text-[11px] font-medium uppercase tracking-wide text-slate-500" htmlFor="project-rename">
                项目名称
              </label>
              <input
                id="project-rename"
                className="mt-1 w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
                value={project.name}
                onChange={(e) => updateProjectDocument({ name: e.target.value })}
                placeholder="未命名项目"
              />
            </div>

            <div className="max-h-56 overflow-y-auto px-1 py-1">
              <div className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">本地项目</div>
              {loadingList ? (
                <div className="px-2 py-2 text-xs text-slate-500">加载列表…</div>
              ) : listError ? (
                <div className="px-2 py-2 text-xs text-red-600">{listError}</div>
              ) : summaries.length === 0 ? (
                <div className="px-2 py-2 text-xs text-slate-500">暂无已保存项目</div>
              ) : (
                summaries.map((summary) => {
                  const active = summary.id === project.id;
                  const busy = loadingId !== null || deletingId !== null;
                  return (
                    <div
                      key={summary.id}
                      className={`flex items-stretch gap-0.5 rounded px-1 py-0.5 ${
                        active ? "bg-blue-50 text-blue-900" : "text-slate-800"
                      }`}
                    >
                      <button
                        type="button"
                        role="option"
                        aria-selected={active}
                        disabled={busy}
                        className={`flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded px-2 py-2 text-left text-xs transition-colors hover:bg-slate-100 disabled:opacity-50 ${
                          active ? "hover:bg-blue-100" : ""
                        }`}
                        onClick={() => void handlePickProject(summary.id)}
                      >
                        <span className="font-medium">{summary.name.trim() || summary.id}</span>
                        <span className="text-[10px] text-slate-500">{formatUpdatedAt(summary.updatedAt)}</span>
                        {loadingId === summary.id ? (
                          <span className="text-[10px] text-blue-600">打开中…</span>
                        ) : null}
                        {deletingId === summary.id ? (
                          <span className="text-[10px] text-slate-500">删除中…</span>
                        ) : null}
                      </button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        title="删除此项目"
                        aria-label={`删除项目 ${summary.name.trim() || summary.id}`}
                        disabled={busy}
                        className="h-auto shrink-0 self-stretch px-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        onClick={(event) => void handleDeleteProject(summary, event)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  );
                })
              )}
            </div>

            {loadError ? <div className="border-t border-slate-100 px-3 py-2 text-xs text-red-600">{loadError}</div> : null}

            <div className="border-t border-slate-100 px-2 py-1.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-full justify-center text-xs text-slate-600"
                onClick={() => void refreshList()}
              >
                刷新列表
              </Button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
