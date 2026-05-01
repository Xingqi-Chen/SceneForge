"use client";

import dynamic from "next/dynamic";
import { BringToFront, Copy, MoveDown, MoveUp, Trash2, ZoomIn, ZoomOut } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";

import { useEditorStore } from "@/features/editor/store/editor-store";
import type { Vector2 } from "@/shared/types";
import { Button } from "@/components/ui/button";

import type { CanvasCapture, CanvasStageProps } from "./CanvasStage";

const minZoom = 0.5;
const maxZoom = 2;
const zoomStep = 0.1;

const CanvasStage = dynamic<CanvasStageProps>(
  () => import("./CanvasStage").then((module) => module.CanvasStage),
  {
    loading: () => (
      <div className="flex min-h-[420px] flex-1 items-center justify-center text-sm text-slate-500">
        正在加载 2D 画布...
      </div>
    ),
    ssr: false,
  },
);

function clampZoom(zoom: number) {
  return Math.min(maxZoom, Math.max(minZoom, Number(zoom.toFixed(2))));
}

function isEditableTarget(target: EventTarget) {
  const element = target instanceof HTMLElement ? target : null;

  if (!element) {
    return false;
  }

  return Boolean(element.closest("input, textarea, select, [contenteditable='true']"));
}

type CanvasViewportProps = {
  onCanvasCaptureReady?: (capture: CanvasCapture | null) => void;
};

export function CanvasViewport({ onCanvasCaptureReady }: CanvasViewportProps) {
  const viewportRef = useRef<HTMLElement>(null);
  const {
    bringSelectionForward,
    deleteSelection,
    duplicateSelection,
    moveSelectionBy,
    project,
    selectScene,
    selection,
    sendSelectionBackward,
  } = useEditorStore();
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Vector2>({ x: 0, y: 0 });
  const [spacePressed, setSpacePressed] = useState(false);
  const canDuplicateOrDelete = selection.kind === "object" || selection.kind === "character";
  const canAdjustLayer = selection.kind === "object";

  function updateZoom(nextZoom: number) {
    setZoom(clampZoom(nextZoom));
  }

  function resetView() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  function focusViewport() {
    viewportRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (isEditableTarget(event.target)) {
      return;
    }

    if (event.code === "Space") {
      event.preventDefault();
      setSpacePressed(true);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      selectScene();
      return;
    }

    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      deleteSelection();
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") {
      event.preventDefault();
      duplicateSelection();
      return;
    }

    const moveDistance = event.shiftKey ? 10 : 1;
    const movement: Record<string, Vector2> = {
      ArrowUp: { x: 0, y: -moveDistance },
      ArrowDown: { x: 0, y: moveDistance },
      ArrowLeft: { x: -moveDistance, y: 0 },
      ArrowRight: { x: moveDistance, y: 0 },
    };
    const delta = movement[event.key];

    if (delta) {
      event.preventDefault();
      moveSelectionBy(delta);
    }
  }

  function handleKeyUp(event: KeyboardEvent<HTMLElement>) {
    if (event.code === "Space") {
      event.preventDefault();
      setSpacePressed(false);
    }
  }

  return (
    <section
      className="flex h-[calc(100vh-48px)] min-h-[640px] flex-1 flex-col rounded-3xl border border-slate-200/60 bg-white/80 p-5 shadow-sm backdrop-blur-xl outline-none transition-all focus-visible:ring-2 focus-visible:ring-blue-400/50 hover:shadow-md lg:sticky lg:top-6"
      onBlur={() => setSpacePressed(false)}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onMouseDown={focusViewport}
      ref={viewportRef}
      tabIndex={0}
    >
      <div className="mb-5 flex flex-col justify-between gap-4 border-b border-slate-100 pb-4 xl:flex-row xl:items-center shrink-0 w-full">
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 shadow-inner">
            <BringToFront className="size-5" />
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-indigo-500/80">2D Canvas</p>
            <h2 className="text-base font-bold text-slate-800 whitespace-nowrap">{project.scene.name}</h2>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <div className="flex items-center gap-2 rounded-xl border border-slate-200/80 bg-slate-50/80 px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm shrink-0 whitespace-nowrap">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-400" />
              {project.scene.canvas.aspectRatio}
            </span>
            <span className="text-slate-300">|</span>
            <span>{project.scene.canvas.width} × {project.scene.canvas.height}</span>
            <span className="text-slate-300">|</span>
            <span className="text-blue-600 w-8 text-right">{Math.round(zoom * 100)}%</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200/80 bg-slate-50/50 p-1 shadow-sm shrink-0">
            <Button
              aria-label="缩小画布"
              onClick={() => updateZoom(zoom - zoomStep)}
              size="sm"
              type="button"
              variant="ghost"
              className="h-8 w-8 rounded-lg p-0 text-slate-500 hover:bg-white hover:text-slate-900 hover:shadow-sm"
            >
              <ZoomOut className="size-4" />
            </Button>
            <Button
              aria-label="放大画布"
              onClick={() => updateZoom(zoom + zoomStep)}
              size="sm"
              type="button"
              variant="ghost"
              className="h-8 w-8 rounded-lg p-0 text-slate-500 hover:bg-white hover:text-slate-900 hover:shadow-sm"
            >
              <ZoomIn className="size-4" />
            </Button>
            <div className="mx-1 h-4 w-px bg-slate-200" />
            <Button 
              onClick={resetView} 
              size="sm" 
              type="button" 
              variant="ghost"
              className="h-8 rounded-lg px-2.5 text-xs text-slate-500 hover:bg-white hover:text-slate-900 hover:shadow-sm"
            >
              <BringToFront className="mr-1.5 size-3.5" />
              重置
            </Button>
            <div className="mx-1 h-4 w-px bg-slate-200" />
            <Button
              disabled={!canDuplicateOrDelete}
              onClick={duplicateSelection}
              size="sm"
              type="button"
              variant="ghost"
              className="h-8 rounded-lg px-2.5 text-xs text-slate-500 hover:bg-white hover:text-slate-900 hover:shadow-sm disabled:opacity-40"
            >
              <Copy className="mr-1.5 size-3.5" />
              复制
            </Button>
            <Button
              disabled={!canDuplicateOrDelete}
              onClick={deleteSelection}
              size="sm"
              type="button"
              variant="ghost"
              className="h-8 rounded-lg px-2.5 text-xs text-rose-500 hover:bg-rose-50 hover:text-rose-600 hover:shadow-sm disabled:opacity-40"
            >
              <Trash2 className="mr-1.5 size-3.5" />
              删除
            </Button>
            <div className="mx-1 h-4 w-px bg-slate-200" />
            <Button
              disabled={!canAdjustLayer}
              onClick={sendSelectionBackward}
              size="sm"
              type="button"
              variant="ghost"
              className="h-8 w-8 rounded-lg p-0 text-slate-500 hover:bg-white hover:text-slate-900 hover:shadow-sm disabled:opacity-40"
              title="下移一层"
            >
              <MoveDown className="size-4" />
            </Button>
            <Button
              disabled={!canAdjustLayer}
              onClick={bringSelectionForward}
              size="sm"
              type="button"
              variant="ghost"
              className="h-8 w-8 rounded-lg p-0 text-slate-500 hover:bg-white hover:text-slate-900 hover:shadow-sm disabled:opacity-40"
              title="上移一层"
            >
              <MoveUp className="size-4" />
            </Button>
          </div>
        </div>
      </div>
      <div className="relative flex flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200/50 bg-slate-100/50 shadow-inner">
        <CanvasStage
          onCaptureReady={onCanvasCaptureReady}
          onPanChange={setPan}
          onZoomChange={updateZoom}
          pan={pan}
          panMode={spacePressed}
          zoom={zoom}
        />
      </div>
    </section>
  );
}
