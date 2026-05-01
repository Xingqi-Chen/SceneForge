"use client";

import { Palette } from "lucide-react";

import { useEditorStore } from "@/features/editor/store/editor-store";
import { generatePrompt } from "@/features/prompt-engine";

export function PromptPreviewPanel() {
  const project = useEditorStore((state) => state.project);
  const generatedPrompt = generatePrompt(project);

  return (
    <section className="flex flex-col">
      <div className="mb-4 flex items-center gap-2.5 border-b border-slate-100 pb-3 shrink-0">
        <div className="rounded-lg bg-purple-50 p-1.5 text-purple-600">
          <Palette className="size-4" />
        </div>
        <h2 className="text-[15px] font-semibold text-slate-800">Prompt 预览</h2>
      </div>
      <div className="space-y-4">
        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">Prompt</p>
          <div className="relative rounded-2xl border border-slate-200/80 bg-slate-50/50 p-4 shadow-inner">
            <p className="text-sm leading-relaxed text-slate-700 break-words">
              {generatedPrompt.prompt || <span className="text-slate-400 italic">暂无提示词...</span>}
            </p>
          </div>
        </div>
        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">Negative Prompt</p>
          <div className="relative rounded-2xl border border-rose-100/80 bg-rose-50/30 p-4 shadow-inner">
            <p className="text-sm leading-relaxed text-slate-700 break-words">
              {generatedPrompt.negativePrompt || <span className="text-slate-400 italic">未设置负面提示词</span>}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
