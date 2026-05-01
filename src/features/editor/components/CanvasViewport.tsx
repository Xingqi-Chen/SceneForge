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
      className="flex h-full flex-1 flex-col outline-none bg-slate-50"
      onBlur={() => setSpacePressed(false)}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onMouseDown={focusViewport}
      ref={viewportRef}
      tabIndex={0}
    >
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2 shrink-0 z-10">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-indigo-50 text-indigo-600">
            <BringToFront className="size-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-800 whitespace-nowrap">{project.scene.name}</h2>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-400" />
              {project.scene.canvas.aspectRatio}
            </span>
            <span className="text-slate-300">|</span>
            <span>{project.scene.canvas.width} × {project.scene.canvas.height}</span>
            <span className="text-slate-300">|</span>
            <span className="text-blue-600 w-8 text-right">{Math.round(zoom * 100)}%</span>
          </div>
          <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-white p-0.5 shadow-sm">
            <Button
              aria-label="缩小画布"
              onClick={() => updateZoom(zoom - zoomStep)}
              size="sm"
              type="button"
              variant="ghost"
              className="h-7 w-7 rounded p-0 text-slate-500 hover:bg-slate-50 hover:text-slate-900"
            >
              <ZoomOut className="size-3.5" />
            </Button>
            <Button
              aria-label="放大画布"
              onClick={() => updateZoom(zoom + zoomStep)}
              size="sm"
              type="button"
              variant="ghost"
              className="h-7 w-7 rounded p-0 text-slate-500 hover:bg-slate-50 hover:text-slate-900"
            >
              <ZoomIn className="size-3.5" />
            </Button>
            <div className="mx-0.5 h-3 w-px bg-slate-200" />
            <Button 
              onClick={resetView} 
              size="sm" 
              type="button" 
              variant="ghost"
              className="h-7 rounded px-2 text-xs text-slate-500 hover:bg-slate-50 hover:text-slate-900"
            >
              <BringToFront className="mr-1 size-3" />
              重置
            </Button>
            <div className="mx-0.5 h-3 w-px bg-slate-200" />
            <Button
              disabled={!canDuplicateOrDelete}
              onClick={duplicateSelection}
              size="sm"
              type="button"
              variant="ghost"
              className="h-7 rounded px-2 text-xs text-slate-500 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-40"
            >
              <Copy className="mr-1 size-3" />
              复制
            </Button>
            <Button
              disabled={!canDuplicateOrDelete}
              onClick={deleteSelection}
              size="sm"
              type="button"
              variant="ghost"
              className="h-7 rounded px-2 text-xs text-rose-500 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
            >
              <Trash2 className="mr-1 size-3" />
              删除
            </Button>
            <div className="mx-0.5 h-3 w-px bg-slate-200" />
            <Button
              disabled={!canAdjustLayer}
              onClick={sendSelectionBackward}
              size="sm"
              type="button"
              variant="ghost"
              className="h-7 w-7 rounded p-0 text-slate-500 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-40"
              title="下移一层"
            >
              <MoveDown className="size-3.5" />
            </Button>
            <Button
              disabled={!canAdjustLayer}
              onClick={bringSelectionForward}
              size="sm"
              type="button"
              variant="ghost"
              className="h-7 w-7 rounded p-0 text-slate-500 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-40"
              title="上移一层"
            >
              <MoveUp className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>
      <div className="relative flex flex-1 flex-col overflow-hidden bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px]">
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
