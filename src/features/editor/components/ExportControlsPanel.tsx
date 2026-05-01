"use client";

import { Copy, Download, Save } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { saveProject, serializeProject } from "@/features/persistence";
import { generatePrompt } from "@/features/prompt-engine";

type ExportStatus = "idle" | "copied" | "saved" | "error";

function downloadText(filename: string, contents: string) {
  const blob = new Blob([contents], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function ExportControlsPanel() {
  const project = useEditorStore((state) => state.project);
  const [status, setStatus] = useState<ExportStatus>("idle");

  async function handleCopyPrompt() {
    try {
      const { prompt } = generatePrompt(project);
      await navigator.clipboard.writeText(prompt);
      setStatus("copied");
    } catch (error) {
      console.error("[SceneForge] [export] failed to copy prompt", { error });
      setStatus("error");
    }
  }

  function handleExportJson() {
    downloadText(`${project.name || "sceneforge-project"}.json`, serializeProject(project));
  }

  async function handleSaveProject() {
    try {
      await saveProject(project);
      console.info("[SceneForge] [persistence] project saved", { projectId: project.id });
      setStatus("saved");
    } catch (error) {
      console.error("[SceneForge] [persistence] failed to save project", { error });
      setStatus("error");
    }
  }

  return (
    <section className="flex flex-col">
      <div className="mb-4 flex items-center justify-between gap-3 border-b border-slate-100 pb-3 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="rounded-lg bg-emerald-50 p-1.5 text-emerald-600">
            <Download className="size-4" />
          </div>
          <h2 className="text-[15px] font-semibold text-slate-800">导出</h2>
        </div>
        {status !== "idle" ? (
          <span className="flex items-center gap-1.5 rounded-full bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-500 shadow-sm border border-slate-100">
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${status === "error" ? "bg-rose-500" : "bg-emerald-500"}`} />
            {status === "copied" ? "已复制" : status === "saved" ? "已保存" : "操作失败"}
          </span>
        ) : null}
      </div>
      <div className="grid gap-3">
        <Button 
          onClick={handleCopyPrompt} 
          size="sm" 
          type="button"
          className="h-10 w-full bg-slate-900 text-white shadow-sm transition-all hover:bg-slate-800 hover:shadow-md hover:-translate-y-0.5"
        >
          <Copy className="mr-2 size-4" />
          复制 Prompt
        </Button>
        <div className="grid grid-cols-2 gap-3">
          <Button 
            onClick={handleExportJson} 
            size="sm" 
            type="button" 
            variant="secondary"
            className="h-10 border-slate-200/80 bg-slate-50/50 text-slate-700 shadow-sm transition-all hover:bg-white hover:shadow hover:-translate-y-0.5"
          >
            <Download className="mr-2 size-4 text-slate-400" />
            导出 JSON
          </Button>
          <Button 
            onClick={handleSaveProject} 
            size="sm" 
            type="button" 
            variant="secondary"
            className="h-10 border-slate-200/80 bg-slate-50/50 text-slate-700 shadow-sm transition-all hover:bg-white hover:shadow hover:-translate-y-0.5"
          >
            <Save className="mr-2 size-4 text-slate-400" />
            保存本地
          </Button>
        </div>
      </div>
    </section>
  );
}
