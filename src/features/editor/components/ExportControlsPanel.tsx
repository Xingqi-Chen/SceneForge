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
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-950">导出</h2>
        {status !== "idle" ? (
          <span className="text-xs text-slate-500">
            {status === "copied" ? "已复制" : status === "saved" ? "已保存" : "操作失败"}
          </span>
        ) : null}
      </div>
      <div className="grid gap-2">
        <Button onClick={handleCopyPrompt} size="sm" type="button">
          <Copy className="size-4" />
          复制 Prompt
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={handleExportJson} size="sm" type="button" variant="secondary">
            <Download className="size-4" />
            导出 JSON
          </Button>
          <Button onClick={handleSaveProject} size="sm" type="button" variant="secondary">
            <Save className="size-4" />
            保存本地
          </Button>
        </div>
      </div>
    </section>
  );
}
