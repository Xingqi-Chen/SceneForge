"use client";

import { Palette } from "lucide-react";

import { useEditorStore } from "@/features/editor/store/editor-store";
import { generatePrompt } from "@/features/prompt-engine";

export function PromptPreviewPanel() {
  const project = useEditorStore((state) => state.project);
  const generatedPrompt = generatePrompt(project);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Palette className="size-4 text-slate-500" />
        <h2 className="text-sm font-semibold text-slate-950">Prompt 预览</h2>
      </div>
      <div className="space-y-3">
        <div>
          <p className="mb-1 text-xs font-medium text-slate-500">Prompt</p>
          <p className="rounded-xl bg-slate-50 p-3 text-sm leading-6 text-slate-700">
            {generatedPrompt.prompt}
          </p>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-slate-500">Negative Prompt</p>
          <p className="rounded-xl bg-slate-50 p-3 text-sm leading-6 text-slate-700">
            {generatedPrompt.negativePrompt || "未设置负面提示词"}
          </p>
        </div>
      </div>
    </section>
  );
}
