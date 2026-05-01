"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { listProjects, loadProject } from "@/features/persistence";
import { useEditorStore } from "@/features/editor/store/editor-store";

import { AssetLibraryPanel } from "./AssetLibraryPanel";
import { CanvasViewport } from "./CanvasViewport";
import { ExportControlsPanel } from "./ExportControlsPanel";
import { ObjectPropertiesPanel } from "./ObjectPropertiesPanel";
import { PromptPreviewPanel } from "./PromptPreviewPanel";
import { PromptTagPickerPanel } from "./PromptTagPickerPanel";

export function EditorShell() {
  const resetProject = useEditorStore((state) => state.resetProject);
  const setProject = useEditorStore((state) => state.setProject);
  const [loadState, setLoadState] = useState<"loading" | "ready">("loading");

  useEffect(() => {
    let active = true;

    async function loadRecentProject() {
      try {
        const [latestProject] = await listProjects();

        if (!latestProject) {
          return;
        }

        const project = await loadProject(latestProject.id);

        if (active && project) {
          setProject(project);
        }
      } catch (error) {
        console.warn("[SceneForge] [persistence] failed to load recent project", { error });
      } finally {
        if (active) {
          setLoadState("ready");
        }
      }
    }

    void loadRecentProject();

    return () => {
      active = false;
    };
  }, [setProject]);

  return (
    <main className="min-h-screen bg-slate-950 p-6 text-slate-950">
      <div className="mx-auto flex max-w-7xl flex-col gap-4">
        <header className="rounded-3xl border border-white/10 bg-white p-6 shadow-sm">
          <p className="text-sm font-medium uppercase tracking-[0.25em] text-slate-500">
            SceneForge MVP
          </p>
          <div className="mt-3 flex flex-col justify-between gap-3 md:flex-row md:items-end">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
                可视化 Prompt 编辑器
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                通过场景对象、人物骨架和局部提示词，把画面语义转换成可复用的结构化 Prompt。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="self-center rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500">
                {loadState === "loading" ? "正在加载本地项目" : "本地项目已就绪"}
              </span>
              <Button onClick={resetProject} type="button">
                新建 2D 场景
              </Button>
            </div>
          </div>
        </header>
        <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)_360px]">
          <aside className="space-y-4">
            <AssetLibraryPanel />
            <PromptTagPickerPanel />
          </aside>
          <CanvasViewport />
          <aside className="space-y-4">
            <ObjectPropertiesPanel />
            <PromptPreviewPanel />
            <ExportControlsPanel />
          </aside>
        </div>
      </div>
    </main>
  );
}
