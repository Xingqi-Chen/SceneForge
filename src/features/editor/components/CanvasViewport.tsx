"use client";

import dynamic from "next/dynamic";
import { BringToFront, Copy, MoveDown, MoveUp, Trash2, ZoomIn, ZoomOut, Maximize } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { type EditorSelection, useEditorStore } from "@/features/editor/store/editor-store";
import { isThreeDViewportPrimitive, sceneObjectsVisibleOn2DCanvas } from "@/features/editor/scene-viewport-objects";
import type { Vector2 } from "@/shared/types";
import {
  characterAppearsInThreeViewport,
  characterAppearsOn2dCanvas,
} from "@/shared/utils/character-space";
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

const ThreeViewport = dynamic<{ onCaptureReady?: (capture: CanvasCapture | null) => void }>(
  () => import("./ThreeViewport").then((module) => module.ThreeViewport),
  {
    loading: () => (
      <div className="flex min-h-[420px] flex-1 items-center justify-center bg-slate-950 text-sm text-slate-300">
        正在加载 3D 视口...
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

function isCopyableSelection(selection: EditorSelection) {
  return (
    selection.kind === "object" ||
    selection.kind === "character" ||
    (selection.kind === "multiple" &&
      (selection.objectIds.length > 0 || selection.characterIds.length > 0))
  );
}

function shortcutKey(event: KeyboardEvent<HTMLElement>) {
  return event.key.toLowerCase();
}

type CanvasViewportProps = {
  onCanvasCaptureReady?: (capture: CanvasCapture | null) => void;
};

export function CanvasViewport({ onCanvasCaptureReady }: CanvasViewportProps) {
  const viewportRef = useRef<HTMLElement>(null);
  const copiedSelectionRef = useRef<EditorSelection | null>(null);
  const {
    bringSelectionForward,
    deleteSelection,
    duplicateSelection,
    moveSelectionBy,
    moveSelectionIn3DBy,
    project,
    selectMultiple,
    selectScene,
    selection,
    sendSelectionBackward,
    setSceneMode,
    undo,
  } = useEditorStore();
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Vector2>({ x: 0, y: 0 });
  const [spacePressed, setSpacePressed] = useState(false);
  const canDuplicateOrDelete = isCopyableSelection(selection);
  const is3DMode = project.scene.mode === "3d";
  const canAdjustLayer = selection.kind === "object" && !is3DMode;

  useEffect(() => {
    if (is3DMode) {
      onCanvasCaptureReady?.(null);
    }
  }, [is3DMode, onCanvasCaptureReady]);

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

    const key = shortcutKey(event);
    const commandPressed = event.ctrlKey || event.metaKey;

    if (event.code === "Space") {
      if (!is3DMode) {
        event.preventDefault();
        setSpacePressed(true);
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      selectScene();
      return;
    }

    if (commandPressed && !event.shiftKey && key === "z") {
      event.preventDefault();
      undo();
      return;
    }

    if (commandPressed && key === "a") {
      event.preventDefault();
      const { scene } = project;
      const objectIds =
        scene.mode === "2d"
          ? sceneObjectsVisibleOn2DCanvas(scene.objects).map((object) => object.id)
          : scene.objects.filter(isThreeDViewportPrimitive).map((object) => object.id);
      const characterIds =
        scene.mode === "2d"
          ? scene.characters.filter(characterAppearsOn2dCanvas).map((c) => c.id)
          : scene.characters.filter(characterAppearsInThreeViewport).map((c) => c.id);
      selectMultiple(objectIds, characterIds);
      return;
    }

    if (commandPressed && key === "c") {
      if (isCopyableSelection(selection)) {
        event.preventDefault();
        copiedSelectionRef.current = selection;
      }
      return;
    }

    if (commandPressed && key === "v") {
      if (copiedSelectionRef.current) {
        event.preventDefault();
        duplicateSelection(copiedSelectionRef.current);
      }
      return;
    }

    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      deleteSelection();
      return;
    }

    if (commandPressed && key === "d") {
      event.preventDefault();
      duplicateSelection();
      return;
    }

    if (!is3DMode && commandPressed && (key === "+" || key === "=")) {
      event.preventDefault();
      updateZoom(zoom + zoomStep);
      return;
    }

    if (!is3DMode && commandPressed && key === "-") {
      event.preventDefault();
      updateZoom(zoom - zoomStep);
      return;
    }

    if (!is3DMode && commandPressed && key === "0") {
      event.preventDefault();
      resetView();
      return;
    }

    if (!is3DMode && commandPressed && key === "]") {
      event.preventDefault();
      bringSelectionForward();
      return;
    }

    if (!is3DMode && commandPressed && key === "[") {
      event.preventDefault();
      sendSelectionBackward();
      return;
    }

    const moveDistance = event.shiftKey ? 10 : 1;

    if (is3DMode && (event.key === "PageUp" || event.key === "PageDown")) {
      event.preventDefault();
      moveSelectionIn3DBy({
        x: 0,
        y: event.key === "PageUp" ? moveDistance * 0.1 : -moveDistance * 0.1,
        z: 0,
      });
      return;
    }

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
    if (!is3DMode && event.code === "Space") {
      event.preventDefault();
      setSpacePressed(false);
    }
  }

  return (
    <section
      className="flex h-full flex-1 flex-col outline-none bg-slate-50"
      onBlur={() => {
        if (!is3DMode) {
          setSpacePressed(false);
        }
      }}
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
            <p className="text-[11px] text-slate-500">
              {is3DMode
                ? "3D 模式：1/2/3 切换工具 · 方向键移动 · PageUp/PageDown 升降 · F 聚焦"
                : "Ctrl/Cmd+Z 撤回 · Ctrl/Cmd+A 全选 · Ctrl/Cmd+C/V 复制粘贴 · 方向键移动"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center p-0.5 rounded-lg border border-slate-200 bg-white shadow-sm">
            <button
              onClick={() => {
                setSpacePressed(false);
                setSceneMode("2d");
              }}
              className={`flex h-7 items-center justify-center rounded-md px-3 text-xs font-medium transition-colors ${!is3DMode ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"}`}
            >
              2D
            </button>
            <button
              onClick={() => {
                setSpacePressed(false);
                setSceneMode("3d");
              }}
              className={`flex h-7 items-center justify-center rounded-md px-3 text-xs font-medium transition-colors ${is3DMode ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"}`}
            >
              3D
            </button>
          </div>
          <div className="flex h-8 shrink-0 items-center gap-3 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium shadow-sm">
            <div className="flex shrink-0 items-center gap-1.5 text-slate-600">
              <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
              <span className="whitespace-nowrap">{project.scene.canvas.aspectRatio}</span>
            </div>
            <div className="h-3 w-px shrink-0 bg-slate-200" />
            <div className="shrink-0 whitespace-nowrap text-slate-600">
              {project.scene.canvas.width} × {project.scene.canvas.height}
            </div>
            {!is3DMode ? (
              <>
                <div className="h-3 w-px shrink-0 bg-slate-200" />
                <div className="shrink-0 whitespace-nowrap text-blue-600">{Math.round(zoom * 100)}%</div>
              </>
            ) : (
              <>
                <div className="h-3 w-px shrink-0 bg-slate-200" />
                <div className="shrink-0 whitespace-nowrap text-slate-400">2D 缩放独立</div>
              </>
            )}
          </div>
          {!is3DMode ? (
          <div className="flex h-8 items-center rounded-md border border-slate-200 bg-white p-0.5 shadow-sm">
            <Button
              aria-label="缩小画布"
              onClick={() => updateZoom(zoom - zoomStep)}
              size="sm"
              type="button"
              variant="ghost"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded p-0 text-slate-500 hover:bg-slate-50 hover:text-slate-900"
            >
              <ZoomOut className="size-3.5" />
            </Button>
            <Button
              aria-label="放大画布"
              onClick={() => updateZoom(zoom + zoomStep)}
              size="sm"
              type="button"
              variant="ghost"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded p-0 text-slate-500 hover:bg-slate-50 hover:text-slate-900"
            >
              <ZoomIn className="size-3.5" />
            </Button>
            <div className="mx-1 h-3 w-px shrink-0 bg-slate-200" />
            <Button 
              onClick={resetView} 
              size="sm" 
              type="button" 
              variant="ghost"
              className="flex h-7 shrink-0 items-center justify-center gap-1.5 rounded px-2 text-xs font-medium whitespace-nowrap text-slate-500 hover:bg-slate-50 hover:text-slate-900"
            >
              <Maximize className="size-3.5 shrink-0" />
              重置视图
            </Button>
          </div>
          ) : null}
          <div className="flex h-8 items-center rounded-md border border-slate-200 bg-white p-0.5 shadow-sm">
            <Button
              disabled={!canDuplicateOrDelete}
              onClick={() => duplicateSelection()}
              size="sm"
              type="button"
              variant="ghost"
              className="flex h-7 shrink-0 items-center justify-center gap-1.5 rounded px-2 text-xs font-medium whitespace-nowrap text-slate-500 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-40"
            >
              <Copy className="size-3.5 shrink-0" />
              复制
            </Button>
            <Button
              disabled={!canDuplicateOrDelete}
              onClick={deleteSelection}
              size="sm"
              type="button"
              variant="ghost"
              className="flex h-7 shrink-0 items-center justify-center gap-1.5 rounded px-2 text-xs font-medium whitespace-nowrap text-rose-500 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
            >
              <Trash2 className="size-3.5 shrink-0" />
              删除
            </Button>
            <div className="mx-1 h-3 w-px shrink-0 bg-slate-200" />
            <Button
              disabled={!canAdjustLayer}
              onClick={sendSelectionBackward}
              size="sm"
              type="button"
              variant="ghost"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded p-0 text-slate-500 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-40"
              title="下移一层"
            >
              <MoveDown className="size-3.5 shrink-0" />
            </Button>
            <Button
              disabled={!canAdjustLayer}
              onClick={bringSelectionForward}
              size="sm"
              type="button"
              variant="ghost"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded p-0 text-slate-500 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-40"
              title="上移一层"
            >
              <MoveUp className="size-3.5 shrink-0" />
            </Button>
          </div>
        </div>
      </div>
      <div className="relative flex flex-1 flex-col overflow-hidden bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px]">
        {is3DMode ? (
          <ThreeViewport onCaptureReady={onCanvasCaptureReady} />
        ) : (
          <CanvasStage
            onCaptureReady={onCanvasCaptureReady}
            onPanChange={setPan}
            onZoomChange={updateZoom}
            pan={pan}
            panMode={spacePressed}
            zoom={zoom}
          />
        )}
      </div>
    </section>
  );
}
