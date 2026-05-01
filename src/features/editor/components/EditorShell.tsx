"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

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
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);

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
    <main className="min-h-screen bg-slate-50 p-4 md:p-6 text-slate-950 font-sans selection:bg-blue-100 selection:text-blue-900">
      <div className="mx-auto flex w-full max-w-[1920px] flex-col gap-6">
        <header className="relative overflow-hidden rounded-3xl border border-slate-200/60 bg-white/80 p-6 shadow-sm backdrop-blur-xl">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-50/50 via-transparent to-purple-50/50 pointer-events-none" />
          <div className="relative z-10">
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-blue-600/80 mb-1">
              SceneForge MVP
            </p>
            <div className="mt-2 flex flex-col justify-between gap-4 md:flex-row md:items-end">
              <div>
                <h1 className="text-3xl font-bold tracking-tight text-slate-900">
                  可视化 Prompt 编辑器
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-500">
                  通过场景对象、人物骨架和局部提示词，把画面语义转换成可复用的结构化 Prompt。
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="self-center rounded-full border border-slate-200 bg-slate-50/50 px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm">
                  <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  {loadState === "loading" ? "正在加载本地项目..." : "本地项目已就绪"}
                </span>
                <Button onClick={resetProject} type="button" className="shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5">
                  新建 2D 场景
                </Button>
              </div>
            </div>
          </div>
        </header>
        <div className="flex flex-col lg:flex-row items-start relative w-full">
          <div
            className={`transition-all duration-300 ease-in-out shrink-0 flex flex-col ${
              leftPanelOpen
                ? "w-full lg:w-[300px] opacity-100 lg:mr-6 mb-6 lg:mb-0"
                : "w-0 opacity-0 overflow-hidden m-0"
            }`}
          >
            <aside className="w-full lg:w-[300px] flex flex-col lg:sticky lg:top-6 bg-white/80 backdrop-blur-xl rounded-3xl border border-slate-200/60 shadow-sm">
              <div className="flex flex-col h-[calc(100vh-48px)] min-h-[640px] overflow-hidden">
                <div className="flex-1 overflow-y-auto custom-scrollbar p-5 flex flex-col gap-6">
                  <AssetLibraryPanel />
                  <div className="h-px w-full bg-slate-100 shrink-0" />
                  <PromptTagPickerPanel />
                </div>
              </div>
            </aside>
          </div>

          <div className="flex-1 min-w-0 w-full transition-all duration-300 ease-in-out relative flex flex-col">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setLeftPanelOpen(!leftPanelOpen)}
              className={`absolute top-1/2 -translate-y-1/2 z-20 hidden lg:flex h-10 w-10 items-center justify-center rounded-full border border-slate-200/80 bg-white/90 backdrop-blur-md p-0 text-slate-500 shadow-md transition-all hover:scale-110 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600 focus-visible:ring-4 focus-visible:ring-blue-400/20 -left-5`}
              title={leftPanelOpen ? "收起左侧面板" : "展开左侧面板"}
            >
              {leftPanelOpen ? <ChevronLeft className="size-5" /> : <ChevronRight className="size-5" />}
            </Button>

            <CanvasViewport />

            <Button
              variant="secondary"
              size="sm"
              onClick={() => setRightPanelOpen(!rightPanelOpen)}
              className={`absolute top-1/2 -translate-y-1/2 z-20 hidden lg:flex h-10 w-10 items-center justify-center rounded-full border border-slate-200/80 bg-white/90 backdrop-blur-md p-0 text-slate-500 shadow-md transition-all hover:scale-110 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600 focus-visible:ring-4 focus-visible:ring-blue-400/20 -right-5`}
              title={rightPanelOpen ? "收起右侧面板" : "展开右侧面板"}
            >
              {rightPanelOpen ? <ChevronRight className="size-5" /> : <ChevronLeft className="size-5" />}
            </Button>
          </div>

          <div
            className={`transition-all duration-300 ease-in-out shrink-0 flex flex-col ${
              rightPanelOpen
                ? "w-full lg:w-[380px] opacity-100 lg:ml-6 mt-6 lg:mt-0"
                : "w-0 opacity-0 overflow-hidden m-0"
            }`}
          >
            <aside className="w-full lg:w-[380px] flex flex-col lg:sticky lg:top-6 bg-white/80 backdrop-blur-xl rounded-3xl border border-slate-200/60 shadow-sm">
              <div className="flex flex-col h-[calc(100vh-48px)] min-h-[640px] overflow-hidden">
                <div className="flex-1 overflow-y-auto custom-scrollbar p-5 flex flex-col gap-6">
                  <ObjectPropertiesPanel />
                  <div className="h-px w-full bg-slate-100 shrink-0" />
                  <PromptPreviewPanel />
                  <div className="h-px w-full bg-slate-100 shrink-0" />
                  <ExportControlsPanel />
                </div>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </main>
  );
}
