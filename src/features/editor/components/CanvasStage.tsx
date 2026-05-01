"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type Ref,
  type WheelEvent as ReactWheelEvent,
} from "react";
import type { KonvaEventObject } from "konva/lib/Node";
import type { Group as KonvaGroup } from "konva/lib/Group";
import type { Stage as KonvaStage } from "konva/lib/Stage";
import type { Transformer as KonvaTransformer } from "konva/lib/shapes/Transformer";
import { Circle, Ellipse, Group, Layer, Line, Rect, Stage, Text, Transformer } from "react-konva";

import { useEditorStore } from "@/features/editor/store/editor-store";
import { defaultLineEndpoints, defaultPolygonPoints } from "@/features/editor/preset-scene-objects";
import type { BodyPartId, CharacterSkeleton, JointId, SceneObject, Vector2 } from "@/shared/types";

export type CanvasCapture = () => string | null;

export type CanvasStageProps = {
  zoom: number;
  pan: Vector2;
  panMode: boolean;
  onPanChange: (pan: Vector2) => void;
  onZoomChange: (zoom: number) => void;
  onCaptureReady?: (capture: CanvasCapture | null) => void;
};

type CanvasContextMenu = {
  x: number;
  y: number;
  target: "object" | "character";
};

const skeletonBodyPartSegments: Array<[BodyPartId, JointId, JointId]> = [
  ["torso", "neck", "leftShoulder"],
  ["torso", "neck", "rightShoulder"],
  ["torso", "neck", "hip"],
  ["leftUpperArm", "leftShoulder", "leftElbow"],
  ["leftForearm", "leftElbow", "leftWrist"],
  ["rightUpperArm", "rightShoulder", "rightElbow"],
  ["rightForearm", "rightElbow", "rightWrist"],
  ["leftThigh", "hip", "leftKnee"],
  ["leftShin", "leftKnee", "leftAnkle"],
  ["rightThigh", "hip", "rightKnee"],
  ["rightShin", "rightKnee", "rightAnkle"],
];

const jointBodyPartMap: Partial<Record<JointId, BodyPartId>> = {
  neck: "head",
  leftWrist: "leftHand",
  rightWrist: "rightHand",
  leftAnkle: "leftFoot",
  rightAnkle: "rightFoot",
};

function SceneObjectNode({
  object,
  onContextMenu,
  panMode,
  selected,
  transformRef,
}: {
  object: SceneObject;
  onContextMenu: (event: KonvaEventObject<MouseEvent>) => void;
  panMode: boolean;
  selected: boolean;
  transformRef?: Ref<KonvaGroup>;
}) {
  const selectObject = useEditorStore((state) => state.selectObject);
  const updateObject = useEditorStore((state) => state.updateObject);
  const stroke = selected ? "#0f172a" : "#cbd5e1";

  function handleSelect(event: KonvaEventObject<MouseEvent | TouchEvent>) {
    if (panMode) {
      return;
    }

    event.cancelBubble = true;
    selectObject(object.id);
  }

  function handleDragEnd(event: KonvaEventObject<DragEvent>) {
    updateObject(object.id, {
      position: {
        x: Math.round(event.target.x()),
        y: Math.round(event.target.y()),
      },
    });
  }

  function handleTransformEnd(event: KonvaEventObject<Event>) {
    const node = event.target;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();

    node.scaleX(1);
    node.scaleY(1);

    const nextWidth = Math.max(16, Math.round(object.size.width * scaleX));
    const nextHeight = Math.max(16, Math.round(object.size.height * scaleY));

    const base = {
      position: {
        x: Math.round(node.x()),
        y: Math.round(node.y()),
      },
      rotation: Math.round(node.rotation()),
      size: {
        width: nextWidth,
        height: nextHeight,
      },
    };

    if (object.kind === "line") {
      const le = object.lineEndpoints ?? defaultLineEndpoints(object.size.width, object.size.height);
      updateObject(object.id, {
        ...base,
        lineEndpoints: {
          x1: Math.round(le.x1 * scaleX),
          y1: Math.round(le.y1 * scaleY),
          x2: Math.round(le.x2 * scaleX),
          y2: Math.round(le.y2 * scaleY),
        },
      });
      return;
    }

    if (object.kind === "polygon") {
      const pts = object.polygonPoints ?? defaultPolygonPoints(object.size.width, object.size.height);
      updateObject(object.id, {
        ...base,
        polygonPoints: pts.map((point) => ({
          x: Math.round(point.x * scaleX),
          y: Math.round(point.y * scaleY),
        })),
      });
      return;
    }

    updateObject(object.id, base);
  }

  const w = object.size.width;
  const h = object.size.height;
  const lineEndpoints = object.lineEndpoints ?? defaultLineEndpoints(w, h);
  const polygonPoints = object.polygonPoints ?? defaultPolygonPoints(w, h);
  const polygonFlat = polygonPoints.flatMap((point) => [point.x, point.y]);

  return (
    <Group
      draggable={!panMode}
      id={object.id}
      onClick={handleSelect}
      onContextMenu={onContextMenu}
      onDragEnd={handleDragEnd}
      onTap={handleSelect}
      onTransformEnd={handleTransformEnd}
      ref={transformRef}
      rotation={object.rotation}
      x={object.position.x}
      y={object.position.y}
    >
      {object.kind === "circle" ? (
        <Circle
          fill={object.fill}
          radius={Math.min(object.size.width, object.size.height) / 2}
          stroke={stroke}
          strokeWidth={selected ? 5 : 3}
          x={object.size.width / 2}
          y={object.size.height / 2}
        />
      ) : object.kind === "ellipse" ? (
        <Ellipse
          fill={object.fill}
          radiusX={object.size.width / 2}
          radiusY={object.size.height / 2}
          stroke={stroke}
          strokeWidth={selected ? 5 : 3}
          x={object.size.width / 2}
          y={object.size.height / 2}
        />
      ) : object.kind === "line" ? (
        <>
          <Rect fill="rgba(248,250,252,0.01)" height={h} onClick={handleSelect} onTap={handleSelect} width={w} />
          <Line
            lineCap="round"
            listening={false}
            points={[lineEndpoints.x1, lineEndpoints.y1, lineEndpoints.x2, lineEndpoints.y2]}
            stroke={object.fill}
            strokeWidth={selected ? 7 : 5}
          />
        </>
      ) : object.kind === "polygon" ? (
        <Line
          closed
          fill={object.fill}
          lineJoin="round"
          onClick={handleSelect}
          onTap={handleSelect}
          points={polygonFlat}
          stroke={stroke}
          strokeWidth={selected ? 4 : 2}
        />
      ) : object.kind === "image-placeholder" ? (
        <>
          <Rect
            cornerRadius={12}
            dash={[10, 6]}
            fill="#f8fafc"
            height={h}
            onClick={handleSelect}
            onTap={handleSelect}
            stroke={stroke}
            strokeWidth={selected ? 4 : 2}
            width={w}
          />
          <Text
            align="center"
            fill="#64748b"
            fontSize={18}
            fontStyle="bold"
            height={h}
            listening={false}
            text={object.imageLabel ?? "Image"}
            verticalAlign="middle"
            width={w}
          />
        </>
      ) : object.kind === "preset" ? (
        <>
          <Rect
            cornerRadius={14}
            dash={[8, 5]}
            fill={object.fill}
            height={h}
            onClick={handleSelect}
            onTap={handleSelect}
            opacity={0.92}
            stroke={stroke}
            strokeWidth={selected ? 4 : 2}
            width={w}
          />
          <Text
            align="center"
            fill="#0f172a"
            fontSize={20}
            fontStyle="bold"
            height={h}
            listening={false}
            text={object.name}
            verticalAlign="middle"
            width={w}
          />
        </>
      ) : (
        <Rect
          cornerRadius={16}
          fill={object.fill}
          height={object.size.height}
          stroke={stroke}
          strokeWidth={selected ? 5 : 3}
          width={object.size.width}
        />
      )}
      {object.kind !== "preset" && object.kind !== "image-placeholder" ? (
        <Text
          align="center"
          fill="#0f172a"
          fontSize={22}
          fontStyle="bold"
          height={object.size.height}
          listening={false}
          text={object.name}
          verticalAlign="middle"
          width={object.size.width}
        />
      ) : null}
    </Group>
  );
}

function CharacterNode({
  character,
  onContextMenu,
  panMode,
  selected,
  selectedBodyPartId,
  transformRef,
}: {
  character: CharacterSkeleton;
  onContextMenu: (event: KonvaEventObject<MouseEvent>) => void;
  panMode: boolean;
  selected: boolean;
  selectedBodyPartId?: BodyPartId;
  transformRef?: Ref<KonvaGroup>;
}) {
  const selectCharacter = useEditorStore((state) => state.selectCharacter);
  const selectBodyPart = useEditorStore((state) => state.selectBodyPart);
  const updateCharacter = useEditorStore((state) => state.updateCharacter);
  const updateCharacterJoint = useEditorStore((state) => state.updateCharacterJoint);
  const stroke = selected ? "#0f172a" : "#334155";

  function handleSelect(event: KonvaEventObject<MouseEvent | TouchEvent>) {
    if (panMode) {
      return;
    }

    event.cancelBubble = true;
    selectCharacter(character.id);
  }

  function handleBodyPartSelect(
    bodyPartId: BodyPartId,
    event: KonvaEventObject<MouseEvent | TouchEvent>,
  ) {
    if (panMode) {
      return;
    }

    event.cancelBubble = true;
    selectBodyPart(character.id, bodyPartId);
  }

  function handleJointSelect(jointId: JointId, event: KonvaEventObject<MouseEvent | TouchEvent>) {
    const bodyPartId = jointBodyPartMap[jointId];

    if (!bodyPartId) {
      handleSelect(event);
      return;
    }

    handleBodyPartSelect(bodyPartId, event);
  }

  function handleDragEnd(event: KonvaEventObject<DragEvent>) {
    if (event.target !== event.currentTarget) {
      return;
    }

    updateCharacter(character.id, {
      position: {
        x: Math.round(event.target.x()),
        y: Math.round(event.target.y()),
      },
    });
  }

  function handleTransformEnd(event: KonvaEventObject<Event>) {
    const node = event.target;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();

    updateCharacter(character.id, {
      position: {
        x: Math.round(node.x()),
        y: Math.round(node.y()),
      },
      scaleX,
      scaleY,
    });
  }

  function handleJointDrag(jointId: JointId, event: KonvaEventObject<DragEvent>) {
    if (panMode) {
      return;
    }

    event.cancelBubble = true;
    selectCharacter(character.id);
    
    updateCharacterJoint(character.id, jointId, {
      x: Math.round(event.target.x()),
      y: Math.round(event.target.y()),
    });
  }

  const maxY = Math.max(...Object.values(character.joints).map((j) => j.y));
  const labelY = maxY + 40;

  return (
    <Group
      draggable={!panMode}
      id={character.id}
      onClick={handleSelect}
      onContextMenu={onContextMenu}
      onDragEnd={handleDragEnd}
      onTap={handleSelect}
      onTransformEnd={handleTransformEnd}
      ref={transformRef}
      x={character.position.x}
      y={character.position.y}
      scaleX={character.scaleX ?? 1}
      scaleY={character.scaleY ?? 1}
    >
      {skeletonBodyPartSegments.map(([bodyPartId, from, to]) => {
        const selectedPart = selectedBodyPartId === bodyPartId;

        return (
          <Line
            key={`${bodyPartId}-${from}-${to}`}
            lineCap="round"
            onClick={(event) => handleBodyPartSelect(bodyPartId, event)}
            onTap={(event) => handleBodyPartSelect(bodyPartId, event)}
            points={[
              character.joints[from].x,
              character.joints[from].y,
              character.joints[to].x,
              character.joints[to].y,
            ]}
            stroke={selectedPart ? "#2563eb" : stroke}
            strokeWidth={selectedPart ? 11 : selected ? 9 : 7}
            strokeScaleEnabled={false}
          />
        );
      })}
      <Circle
        fill="#ffffff"
        radius={30}
        onClick={(event) => handleBodyPartSelect("head", event)}
        onTap={(event) => handleBodyPartSelect("head", event)}
        stroke={selectedBodyPartId === "head" ? "#2563eb" : stroke}
        strokeWidth={selectedBodyPartId === "head" ? 7 : selected ? 6 : 4}
        strokeScaleEnabled={false}
        x={character.joints.neck.x}
        y={character.joints.neck.y - 34}
      />
      {Object.entries(character.joints).map(([joint, position]) => {
        const jointId = joint as JointId;
        const selectedPart = selectedBodyPartId === jointBodyPartMap[jointId];

        return (
          <Circle
            draggable={!panMode}
            fill={selectedPart ? "#2563eb" : selected ? "#0f172a" : "#ffffff"}
            key={joint}
            onClick={(event) => handleJointSelect(jointId, event)}
            onDragEnd={(event) => handleJointDrag(jointId, event)}
            onDragMove={(event) => handleJointDrag(jointId, event)}
            onTap={(event) => handleJointSelect(jointId, event)}
            radius={selectedPart ? 8 : 7}
            stroke={selectedPart ? "#2563eb" : stroke}
            strokeWidth={3}
            strokeScaleEnabled={false}
            x={position.x}
            y={position.y}
          />
        );
      })}
      <Rect
        cornerRadius={15}
        fill="#0f172a"
        height={30}
        offsetX={60}
        width={120}
        x={0}
        y={labelY}
      />
      <Text
        align="center"
        fill="#ffffff"
        fontSize={18}
        height={30}
        offsetX={60}
        text={character.name}
        verticalAlign="middle"
        width={120}
        x={0}
        y={labelY}
      />
    </Group>
  );
}

export function CanvasStage({
  zoom,
  pan,
  panMode,
  onPanChange,
  onZoomChange,
  onCaptureReady,
}: CanvasStageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<KonvaStage>(null);
  const selectedObjectRef = useRef<KonvaGroup>(null);
  const selectedCharacterRef = useRef<KonvaGroup>(null);
  const transformerRef = useRef<KonvaTransformer>(null);
  const lastPanPoint = useRef<Vector2 | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [contextMenu, setContextMenu] = useState<CanvasContextMenu | null>(null);
  const [panning, setPanning] = useState(false);
  const {
    bringSelectionForward,
    deleteSelection,
    project,
    selectCharacter,
    selectObject,
    selection,
    selectScene,
    sendSelectionBackward,
  } = useEditorStore();
  const { canvas, objects, characters } = project.scene;
  const baseScale =
    containerSize.width > 0 && containerSize.height > 0
      ? Math.min(
          (containerSize.width - 32) / canvas.width,
          (containerSize.height - 32) / canvas.height,
          1,
        )
      : 0.6;
  const stageScale = baseScale * zoom;
  const stageWidth = canvas.width * stageScale;
  const stageHeight = canvas.height * stageScale;
  const sortedObjects = useMemo(
    () => [...objects].sort((left, right) => left.layer - right.layer),
    [objects],
  );
  const captureCanvas = useCallback<CanvasCapture>(() => {
    return stageRef.current?.toDataURL({ mimeType: "image/png", pixelRatio: 1 }) ?? null;
  }, []);

  useEffect(() => {
    onCaptureReady?.(captureCanvas);

    return () => {
      onCaptureReady?.(null);
    };
  }, [captureCanvas, onCaptureReady]);

  useEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    const observer = new ResizeObserver(([entry]) => {
      setContainerSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });

    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const transformer = transformerRef.current;

    if (!transformer) {
      return;
    }

    if (selection.kind === "object" && selectedObjectRef.current) {
      transformer.nodes([selectedObjectRef.current]);
      transformer.getLayer()?.batchDraw();
      return;
    }

    if ((selection.kind === "character" || selection.kind === "bodyPart") && selectedCharacterRef.current) {
      transformer.nodes([selectedCharacterRef.current]);
      transformer.getLayer()?.batchDraw();
      return;
    }

    transformer.nodes([]);
    transformer.getLayer()?.batchDraw();
  }, [selection, sortedObjects, characters]);

  function handleStagePointer(event: KonvaEventObject<MouseEvent | TouchEvent>) {
    if (panMode) {
      return;
    }

    setContextMenu(null);

    if (event.target === event.target.getStage()) {
      selectScene();
    }
  }

  function handleCanvasPointer() {
    if (panMode) {
      return;
    }

    setContextMenu(null);
    selectScene();
  }

  function openContextMenu(
    target: CanvasContextMenu["target"],
    event: KonvaEventObject<MouseEvent>,
  ) {
    if (panMode) {
      return;
    }

    event.evt.preventDefault();
    event.cancelBubble = true;

    const containerBounds = containerRef.current?.getBoundingClientRect();

    setContextMenu({
      target,
      x: event.evt.clientX - (containerBounds?.left ?? 0),
      y: event.evt.clientY - (containerBounds?.top ?? 0),
    });
  }

  function handleObjectContextMenu(objectId: string, event: KonvaEventObject<MouseEvent>) {
    selectObject(objectId);
    openContextMenu("object", event);
  }

  function handleCharacterContextMenu(characterId: string, event: KonvaEventObject<MouseEvent>) {
    selectCharacter(characterId);
    openContextMenu("character", event);
  }

  function runContextMenuAction(action: () => void) {
    action();
    setContextMenu(null);
  }

  function handleWheel(event: ReactWheelEvent<HTMLDivElement>) {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      onZoomChange(zoom + (event.deltaY > 0 ? -0.1 : 0.1));
    }
  }

  function startPan(event: ReactMouseEvent<HTMLDivElement>) {
    if (!panMode && event.button !== 1) {
      return;
    }

    event.preventDefault();
    setPanning(true);
    lastPanPoint.current = { x: event.clientX, y: event.clientY };
  }

  function updatePan(event: ReactMouseEvent<HTMLDivElement>) {
    if (!panning || !lastPanPoint.current) {
      return;
    }

    const nextPoint = { x: event.clientX, y: event.clientY };
    const delta = {
      x: nextPoint.x - lastPanPoint.current.x,
      y: nextPoint.y - lastPanPoint.current.y,
    };

    lastPanPoint.current = nextPoint;
    onPanChange({
      x: pan.x + delta.x,
      y: pan.y + delta.y,
    });
  }

  function stopPan() {
    setPanning(false);
    lastPanPoint.current = null;
  }

  return (
    <div
      className={`relative flex flex-1 items-center justify-center overflow-hidden w-full h-full p-4 ${
        panMode || panning ? "cursor-grab" : "cursor-default"
      }`}
      onContextMenu={(event) => event.preventDefault()}
      onMouseDown={startPan}
      onMouseLeave={stopPan}
      onMouseMove={updatePan}
      onMouseUp={stopPan}
      onWheel={handleWheel}
      ref={containerRef}
    >
      <div
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px)`,
          transformOrigin: "center center",
        }}
      >
        <Stage
          height={stageHeight}
          onMouseDown={handleStagePointer}
          onTouchStart={handleStagePointer}
          ref={stageRef}
          scaleX={stageScale}
          scaleY={stageScale}
          width={stageWidth}
        >
          <Layer>
            <Rect
              fill={canvas.background}
              height={canvas.height}
              onClick={handleCanvasPointer}
              onTap={handleCanvasPointer}
              width={canvas.width}
            />
            <Rect
              cornerRadius={40}
              fillLinearGradientColorStops={[0, "#eff6ff", 0.55, "#ffffff", 1, "#fffbeb"]}
              fillLinearGradientEndPoint={{ x: canvas.width, y: canvas.height }}
              fillLinearGradientStartPoint={{ x: 0, y: 0 }}
              height={canvas.height - 64}
              listening={false}
              width={canvas.width - 64}
              x={32}
              y={32}
            />
            {sortedObjects.map((object) => {
              const selected = selection.kind === "object" && selection.id === object.id;

              return (
                <SceneObjectNode
                  key={object.id}
                  object={object}
                  onContextMenu={(event) => handleObjectContextMenu(object.id, event)}
                  panMode={panMode}
                  selected={selected}
                  transformRef={selected ? selectedObjectRef : undefined}
                />
              );
            })}
            {characters.map((character) => {
              const selected =
                (selection.kind === "character" && selection.id === character.id) ||
                (selection.kind === "bodyPart" && selection.characterId === character.id);

              return (
                <CharacterNode
                  character={character}
                  key={character.id}
                  onContextMenu={(event) => handleCharacterContextMenu(character.id, event)}
                  panMode={panMode}
                  selected={selected}
                  selectedBodyPartId={
                    selection.kind === "bodyPart" && selection.characterId === character.id
                      ? selection.bodyPartId
                      : undefined
                  }
                  transformRef={selected ? selectedCharacterRef : undefined}
                />
              );
            })}
            <Transformer
              boundBoxFunc={(oldBox, newBox) =>
                newBox.width < 16 || newBox.height < 16 ? oldBox : newBox
              }
              flipEnabled={false}
              ref={transformerRef}
              rotateEnabled={selection.kind === "object"}
            />
          </Layer>
        </Stage>
      </div>
      {contextMenu ? (
        <div
          className="absolute z-10 min-w-36 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-sm shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className="block w-full px-3 py-2 text-left text-slate-700 hover:bg-slate-50"
            disabled={contextMenu.target !== "object"}
            onClick={() => runContextMenuAction(sendSelectionBackward)}
            type="button"
          >
            下移一层
          </button>
          <button
            className="block w-full px-3 py-2 text-left text-slate-700 hover:bg-slate-50"
            disabled={contextMenu.target !== "object"}
            onClick={() => runContextMenuAction(bringSelectionForward)}
            type="button"
          >
            上移一层
          </button>
          <button
            className="block w-full px-3 py-2 text-left text-red-600 hover:bg-red-50"
            onClick={() => runContextMenuAction(deleteSelection)}
            type="button"
          >
            删除
          </button>
        </div>
      ) : null}
    </div>
  );
}
