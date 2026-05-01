"use client";

import dynamic from "next/dynamic";
import { BringToFront, Copy, MoveDown, MoveUp, Trash2, ZoomIn, ZoomOut } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";

import { useEditorStore } from "@/features/editor/store/editor-store";
import type { Vector2 } from "@/shared/types";
import { Button } from "@/components/ui/button";

import type { CanvasStageProps } from "./CanvasStage";

const minZoom = 0.5;
const maxZoom = 2;
const zoomStep = 0.1;

const CanvasStage = dynamic<CanvasStageProps>(
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

export function CanvasViewport() {
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
  const hasSelection = selection.kind !== "scene";
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
      className="flex min-h-[560px] flex-1 flex-col rounded-3xl border border-slate-200 bg-slate-100 p-4 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
      onBlur={() => setSpacePressed(false)}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onMouseDown={focusViewport}
      ref={viewportRef}
      tabIndex={0}
    >
      <div className="mb-4 flex flex-col justify-between gap-3 xl:flex-row xl:items-center">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">2D Canvas</p>
          <h2 className="text-lg font-semibold text-slate-950">{project.scene.name}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="rounded-full bg-white px-3 py-1 text-xs text-slate-500">
            {project.scene.canvas.aspectRatio} · {project.scene.canvas.width}x
            {project.scene.canvas.height} · {Math.round(zoom * 100)}%
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              aria-label="缩小画布"
              onClick={() => updateZoom(zoom - zoomStep)}
              size="sm"
              type="button"
              variant="secondary"
            >
              <ZoomOut className="size-4" />
            </Button>
            <Button
              aria-label="放大画布"
              onClick={() => updateZoom(zoom + zoomStep)}
              size="sm"
              type="button"
              variant="secondary"
            >
              <ZoomIn className="size-4" />
            </Button>
            <Button onClick={resetView} size="sm" type="button" variant="secondary">
              <BringToFront className="size-4" />
              重置视图
            </Button>
            <Button
              disabled={!hasSelection}
              onClick={duplicateSelection}
              size="sm"
              type="button"
              variant="secondary"
            >
              <Copy className="size-4" />
              复制
            </Button>
            <Button
              disabled={!hasSelection}
              onClick={deleteSelection}
              size="sm"
              type="button"
              variant="secondary"
            >
              <Trash2 className="size-4" />
              删除
            </Button>
            <Button
              disabled={!canAdjustLayer}
              onClick={sendSelectionBackward}
              size="sm"
              type="button"
              variant="secondary"
            >
              <MoveDown className="size-4" />
              下移一层
            </Button>
            <Button
              disabled={!canAdjustLayer}
              onClick={bringSelectionForward}
              size="sm"
              type="button"
              variant="secondary"
            >
              <MoveUp className="size-4" />
              上移一层
            </Button>
          </div>
        </div>
      </div>
      <CanvasStage
        onPanChange={setPan}
        onZoomChange={updateZoom}
        pan={pan}
        panMode={spacePressed}
        zoom={zoom}
      />
    </section>
  );
}
