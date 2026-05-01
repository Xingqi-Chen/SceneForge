"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  applyPromptBindingsToProject,
  listProjects,
  loadProject,
  loadPromptBindings,
  loadPromptLibrary,
  mergePromptLibraryIntoProject,
} from "@/features/persistence";
import { useEditorStore } from "@/features/editor/store/editor-store";

import { ProjectMenu } from "./ProjectMenu";
import { AssetLibraryPanel } from "./AssetLibraryPanel";
import { CanvasViewport } from "./CanvasViewport";
import { ExportControlsPanel } from "./ExportControlsPanel";
import { ObjectPropertiesPanel } from "./ObjectPropertiesPanel";
import { PromptPreviewPanel } from "./PromptPreviewPanel";
import { PromptTagPickerPanel } from "./PromptTagPickerPanel";
import type { CanvasCapture } from "./CanvasStage";

export function EditorShell() {
  const canvasCaptureRef = useRef<CanvasCapture | null>(null);
  const resetProject = useEditorStore((state) => state.resetProject);
  const setProject = useEditorStore((state) => state.setProject);
  const [loadState, setLoadState] = useState<"loading" | "ready">("loading");
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);

  const registerCanvasCapture = useCallback((capture: CanvasCapture | null) => {
    canvasCaptureRef.current = capture;
  }, []);

  const captureCanvas = useCallback(() => canvasCaptureRef.current?.() ?? null, []);

  useEffect(() => {
    let active = true;

    async function loadRecentProject() {
      try {
        const [latestProject] = await listProjects();

        if (latestProject) {
          const loaded = await loadProject(latestProject.id);

          if (active && loaded) {
            setProject(loaded);
          }
        } else {
          const [lib, bindings] = await Promise.all([loadPromptLibrary(), loadPromptBindings()]);
          if (active) {
            setProject(
              applyPromptBindingsToProject(
                mergePromptLibraryIntoProject(useEditorStore.getState().project, lib),
                bindings,
              ),
            );
          }
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
    <main className="h-screen w-screen overflow-hidden flex flex-col bg-slate-50 text-slate-950 font-sans selection:bg-blue-100 selection:text-blue-900">
      <header className="relative z-50 flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <h1 className="shrink-0 text-sm font-bold tracking-tight text-slate-900">
            SceneForge | 提示词工作台
          </h1>
          <ProjectMenu />
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">
            <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            {loadState === "loading" ? "加载中..." : "已就绪"}
          </span>
          <Button onClick={resetProject} type="button" size="sm" className="h-8 shadow-none">
            新建场景
          </Button>
        </div>
      </header>

      <div className="relative z-0 flex min-h-0 flex-1 overflow-hidden">
        <div
          className={`transition-all duration-300 ease-in-out shrink-0 flex flex-col border-r border-slate-200 bg-white ${
            leftPanelOpen ? "w-[300px]" : "w-0 overflow-hidden border-r-0"
          }`}
        >
          <div className="flex-1 overflow-y-auto custom-scrollbar p-4 flex flex-col gap-6">
            <AssetLibraryPanel />
            <div className="h-px w-full bg-slate-100 shrink-0" />
            <PromptTagPickerPanel />
          </div>
        </div>

        <div className="flex-1 min-w-0 relative flex flex-col bg-slate-50">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setLeftPanelOpen(!leftPanelOpen)}
            className={`absolute top-1/2 -translate-y-1/2 z-20 hidden lg:flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white p-0 text-slate-500 shadow-sm transition-all hover:text-blue-600 -left-4`}
            title={leftPanelOpen ? "收起左侧面板" : "展开左侧面板"}
          >
            {leftPanelOpen ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
          </Button>

          <CanvasViewport onCanvasCaptureReady={registerCanvasCapture} />

          <Button
            variant="secondary"
            size="sm"
            onClick={() => setRightPanelOpen(!rightPanelOpen)}
            className={`absolute top-1/2 -translate-y-1/2 z-20 hidden lg:flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white p-0 text-slate-500 shadow-sm transition-all hover:text-blue-600 -right-4`}
            title={rightPanelOpen ? "收起右侧面板" : "展开右侧面板"}
          >
            {rightPanelOpen ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
          </Button>
        </div>

        <div
          className={`transition-all duration-300 ease-in-out shrink-0 flex flex-col border-l border-slate-200 bg-white ${
            rightPanelOpen ? "w-[380px]" : "w-0 overflow-hidden border-l-0"
          }`}
        >
          <div className="flex-1 overflow-y-auto custom-scrollbar p-4 flex flex-col gap-6">
            <ObjectPropertiesPanel />
            <div className="h-px w-full bg-slate-100 shrink-0" />
            <PromptPreviewPanel onCaptureCanvas={captureCanvas} />
            <div className="h-px w-full bg-slate-100 shrink-0" />
            <ExportControlsPanel />
          </div>
        </div>
      </div>
    </main>
  );
}
