"use client";

import { Copy, Download, Save, Upload } from "lucide-react";
import { useRef, useState, type ChangeEvent } from "react";

import { Button } from "@/components/ui/button";
import { useEditorStore } from "@/features/editor/store/editor-store";
import {
  applyPromptBindingsToScene,
  importCanvasBundleFromJson,
  importPromptLibraryBundleFromJson,
  saveProject,
  savePromptLibrary,
  serializeCanvasExport,
  serializePromptLibraryExport,
} from "@/features/persistence";
import { generatePrompt } from "@/features/prompt-engine";

type ExportStatus =
  | "idle"
  | "copied"
  | "saved"
  | "error"
  | "canvasExported"
  | "canvasImported"
  | "libraryExported"
  | "libraryImported";

function downloadText(filename: string, contents: string, mimeType: string) {
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function safeExportBasename(name: string) {
  const trimmed = name.trim() || "sceneforge-project";
  return trimmed.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "_").slice(0, 120);
}

export function ExportControlsPanel() {
  const project = useEditorStore((state) => state.project);
  const aiGeneratedPrompt = useEditorStore((state) => state.aiGeneratedPrompt);
  const updateProjectSettings = useEditorStore((state) => state.updateProjectSettings);
  const updateScene = useEditorStore((state) => state.updateScene);
  const selectScene = useEditorStore((state) => state.selectScene);
  const canvasImportInputRef = useRef<HTMLInputElement>(null);
  const libraryImportInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<ExportStatus>("idle");
  const [statusDetail, setStatusDetail] = useState("");

  async function handleCopyPrompt() {
    try {
      setStatusDetail("");
      const { prompt: enginePrompt } = generatePrompt(project);
      const textToCopy = aiGeneratedPrompt.trim() || enginePrompt;
      await navigator.clipboard.writeText(textToCopy);
      setStatus("copied");
    } catch (error) {
      console.error("[SceneForge] [export] failed to copy prompt", { error });
      setStatusDetail(error instanceof Error ? error.message : "");
      setStatus("error");
    }
  }

  function handleExportCanvasJson() {
    setStatusDetail("");
    const base = safeExportBasename(project.name);
    downloadText(
      `${base}-canvas.json`,
      serializeCanvasExport(project),
      "application/json;charset=utf-8",
    );
    setStatus("canvasExported");
  }

  function handleExportPromptLibraryJson() {
    setStatusDetail("");
    const base = safeExportBasename(project.name);
    downloadText(
      `${base}-prompt-library.json`,
      serializePromptLibraryExport(project),
      "application/json;charset=utf-8",
    );
    setStatus("libraryExported");
  }

  function handlePickImportCanvasFile() {
    setStatusDetail("");
    canvasImportInputRef.current?.click();
  }

  function handlePickImportLibraryFile() {
    setStatusDetail("");
    libraryImportInputRef.current?.click();
  }

  async function persistAfterImport(kind: "canvas" | "library") {
    try {
      if (kind === "canvas") {
        const nextProject = useEditorStore.getState().project;
        await saveProject(nextProject);
        console.info("[SceneForge] [persistence] imported canvas saved", { projectId: nextProject.id });
      } else {
        const { settings } = useEditorStore.getState().project;
        await savePromptLibrary({
          promptLibraryTags: settings.promptLibraryTags ?? [],
          deletedBuiltInPromptLibraryTagIds: settings.deletedBuiltInPromptLibraryTagIds ?? [],
        });
        console.info("[SceneForge] [persistence] imported prompt library saved to shared file");
      }
      setStatusDetail("");
    } catch (persistError) {
      console.warn("[SceneForge] [persistence] import applied but persist failed", { persistError });
      setStatusDetail(
        kind === "canvas"
          ? "内容已加载，但写入本地项目目录失败，可稍后点击「保存本地」重试。（需本机运行 Next 服务。）"
          : "词库已加载，但写入共享词库文件失败，可稍后重试导入或检查本机 Next 服务。",
      );
    }
  }

  async function handleCanvasImportFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    try {
      setStatusDetail("");
      const text = await file.text();
      const scene = applyPromptBindingsToScene(
        importCanvasBundleFromJson(text),
        useEditorStore.getState().promptBindings,
      );
      updateScene(scene);
      selectScene();
      setStatus("canvasImported");
      await persistAfterImport("canvas");
    } catch (error) {
      console.error("[SceneForge] [export] failed to import canvas", error);
      setStatusDetail(error instanceof Error ? error.message : "导入失败");
      setStatus("error");
    }
  }

  async function handleLibraryImportFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    try {
      setStatusDetail("");
      const text = await file.text();
      const library = importPromptLibraryBundleFromJson(text);
      updateProjectSettings(library);
      setStatus("libraryImported");
      await persistAfterImport("library");
    } catch (error) {
      console.error("[SceneForge] [export] failed to import prompt library", error);
      setStatusDetail(error instanceof Error ? error.message : "导入失败");
      setStatus("error");
    }
  }

  async function handleSaveProject() {
    try {
      setStatusDetail("");
      await saveProject(project);
      console.info("[SceneForge] [persistence] project saved", { projectId: project.id });
      setStatus("saved");
    } catch (error) {
      console.error("[SceneForge] [persistence] failed to save project", error);
      setStatusDetail(error instanceof Error ? error.message : "");
      setStatus("error");
    }
  }

  const statusLabel =
    status === "copied"
      ? "已复制"
      : status === "saved"
        ? "已保存"
        : status === "canvasExported"
          ? "已导出画布 JSON"
          : status === "canvasImported"
            ? "已导入画布"
            : status === "libraryExported"
              ? "已导出词库 JSON"
              : status === "libraryImported"
                ? "已导入词库"
                : status === "error"
                  ? "操作失败"
                  : "";

  return (
    <section className="flex flex-col">
      <input
        accept="application/json,.json"
        className="sr-only"
        onChange={(event) => void handleCanvasImportFileChange(event)}
        ref={canvasImportInputRef}
        type="file"
      />
      <input
        accept="application/json,.json"
        className="sr-only"
        onChange={(event) => void handleLibraryImportFileChange(event)}
        ref={libraryImportInputRef}
        type="file"
      />
      <div className="mb-4 flex items-center justify-between gap-3 border-b border-slate-100 pb-3 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="rounded-md bg-emerald-50 p-1.5 text-emerald-600">
            <Download className="size-4" />
          </div>
          <h2 className="text-[15px] font-semibold text-slate-800">导出与保存</h2>
        </div>
        {status !== "idle" ? (
          <span className="flex max-w-[55%] flex-col items-end gap-0.5 text-right">
            <span className="flex items-center gap-1.5 rounded-full bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-500 shadow-sm border border-slate-100">
              <span
                className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${status === "error" ? "bg-rose-500" : "bg-emerald-500"}`}
              />
              {statusLabel}
            </span>
            {statusDetail ? (
              <span
                className={`text-[10px] leading-tight ${status === "error" ? "text-rose-600" : "text-amber-700"}`}
              >
                {statusDetail}
              </span>
            ) : null}
          </span>
        ) : null}
      </div>
      <div className="grid gap-3">
        <Button
          onClick={handleCopyPrompt}
          size="sm"
          title="复制当前用于生成的正面提示词（优先 AI 编辑区，否则为引擎拼接）。"
          type="button"
          className="h-10 w-full rounded-md bg-slate-900 text-white transition-all hover:bg-slate-800"
        >
          <Copy className="mr-2 size-4" />
          复制 Prompt
        </Button>

        <div className="space-y-1.5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">画布内容</p>
          <p className="text-[11px] leading-snug text-slate-500">
            「项目名-canvas.json」含画布尺寸、场景/物体/人物及其上的 Prompt
            标签；导入会替换当前画布，不改动项目设置、词库与共享绑定关系。亦支持旧版完整项目 JSON：只读取其中的场景字段。
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Button
              onClick={handleExportCanvasJson}
              size="sm"
              title="下载画布专用 JSON（场景结构，不含词库与项目设置）。"
              type="button"
              variant="secondary"
              className="h-auto min-h-10 flex-col gap-0.5 rounded-md border-slate-200 bg-slate-50 py-2 text-slate-700 transition-all hover:bg-slate-100"
            >
              <span className="flex items-center text-sm font-medium">
                <Download className="mr-2 size-4 shrink-0 text-slate-400" />
                导出画布 JSON
              </span>
              <span className="w-full text-center text-[10px] font-normal leading-tight text-slate-500">
                …-canvas.json
              </span>
            </Button>
            <Button
              onClick={handlePickImportCanvasFile}
              size="sm"
              title="选择本应用导出的画布 JSON；导入后替换当前场景。"
              type="button"
              variant="secondary"
              className="h-auto min-h-10 flex-col gap-0.5 rounded-md border-slate-200 bg-slate-50 py-2 text-slate-700 transition-all hover:bg-slate-100"
            >
              <span className="flex items-center text-sm font-medium">
                <Upload className="mr-2 size-4 shrink-0 text-slate-400" />
                导入画布 JSON
              </span>
              <span className="w-full text-center text-[10px] font-normal leading-tight text-slate-500">
                从文件恢复
              </span>
            </Button>
          </div>
        </div>

        <div className="space-y-1.5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Prompt 词库</p>
          <p className="text-[11px] leading-snug text-slate-500">
            「项目名-prompt-library.json」含自定义词库条目与已隐藏的内置词条；导入会写入本机**共享词库文件**（所有项目共用，与当前打开的项目文件无关）。亦支持旧版完整项目
            JSON：只读取其中的词库字段。
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Button
              onClick={handleExportPromptLibraryJson}
              size="sm"
              title="下载词库专用 JSON（自定义词条与隐藏内置 id）。"
              type="button"
              variant="secondary"
              className="h-auto min-h-10 flex-col gap-0.5 rounded-md border-slate-200 bg-slate-50 py-2 text-slate-700 transition-all hover:bg-slate-100"
            >
              <span className="flex items-center text-sm font-medium">
                <Download className="mr-2 size-4 shrink-0 text-slate-400" />
                导出词库 JSON
              </span>
              <span className="w-full text-center text-[10px] font-normal leading-tight text-slate-500">
                …-prompt-library.json
              </span>
            </Button>
            <Button
              onClick={handlePickImportLibraryFile}
              size="sm"
              title="选择本应用导出的词库 JSON；导入后覆盖当前词库。"
              type="button"
              variant="secondary"
              className="h-auto min-h-10 flex-col gap-0.5 rounded-md border-slate-200 bg-slate-50 py-2 text-slate-700 transition-all hover:bg-slate-100"
            >
              <span className="flex items-center text-sm font-medium">
                <Upload className="mr-2 size-4 shrink-0 text-slate-400" />
                导入词库 JSON
              </span>
              <span className="w-full text-center text-[10px] font-normal leading-tight text-slate-500">
                从文件恢复
              </span>
            </Button>
          </div>
        </div>

        <div className="space-y-1.5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">本地项目库</p>
          <p className="text-[11px] leading-snug text-slate-500">
            将当前项目（画布、场景、人物、已应用到元素的标签与项目设置）写入本机目录（默认仓库内
            data/projects，可用环境变量 SCENEFORGE_PROJECTS_DIR）。不会写入共享提示词库；词库单独保存在
            data/prompt-library.json（可用 SCENEFORGE_PROMPT_LIBRARY_FILE 覆盖路径），词库绑定关系单独保存在
            data/prompt-bindings.json（可用 SCENEFORGE_PROMPT_BINDINGS_FILE 覆盖路径）。保存时会规范化并去掉场景内重复
            id，并移除内容完全相同的其它项目记录。
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Button
              onClick={handleSaveProject}
              size="sm"
              title="写入本机浏览器内的项目库；先规范化并去重 id，再在同一事务内写入当前项目，最后移除内容指纹相同的其它项目。"
              type="button"
              variant="secondary"
              className="col-span-2 h-auto min-h-10 flex-col gap-0.5 rounded-md border-slate-200 bg-slate-50 py-2 text-slate-700 transition-all hover:bg-slate-100"
            >
              <span className="flex items-center text-sm font-medium">
                <Save className="mr-2 size-4 shrink-0 text-slate-400" />
                保存本地
              </span>
              <span className="w-full text-center text-[10px] font-normal leading-tight text-slate-500">
                浏览器内项目库
              </span>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
