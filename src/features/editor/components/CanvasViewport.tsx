"use client";

import dynamic from "next/dynamic";

import { useEditorStore } from "@/features/editor/store/editor-store";

const CanvasStage = dynamic(
  () => import("./CanvasStage").then((module) => module.CanvasStage),
  {
    loading: () => (
      <div className="flex min-h-[420px] flex-1 items-center justify-center rounded-2xl border border-slate-200 bg-white text-sm text-slate-500">
        正在加载 2D 画布...
      </div>
    ),
    ssr: false,
  },
);

export function CanvasViewport() {
  const project = useEditorStore((state) => state.project);

  return (
    <section className="flex min-h-[560px] flex-1 flex-col rounded-3xl border border-slate-200 bg-slate-100 p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">2D Canvas</p>
          <h2 className="text-lg font-semibold text-slate-950">{project.scene.name}</h2>
        </div>
        <div className="rounded-full bg-white px-3 py-1 text-xs text-slate-500">
          {project.scene.canvas.aspectRatio} · {project.scene.canvas.width}x
          {project.scene.canvas.height}
        </div>
      </div>
      <CanvasStage />
    </section>
  );
}
