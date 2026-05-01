"use client";

import {
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
import type { Transformer as KonvaTransformer } from "konva/lib/shapes/Transformer";
import { Circle, Ellipse, Group, Layer, Line, Rect, Stage, Text, Transformer } from "react-konva";

import { useEditorStore } from "@/features/editor/store/editor-store";
import type { CharacterSkeleton, JointId, SceneObject, Vector2 } from "@/shared/types";

export type CanvasStageProps = {
  zoom: number;
  pan: Vector2;
  panMode: boolean;
  onPanChange: (pan: Vector2) => void;
  onZoomChange: (zoom: number) => void;
};

const skeletonBones: Array<[keyof CharacterSkeleton["joints"], keyof CharacterSkeleton["joints"]]> =
  [
    ["neck", "leftShoulder"],
    ["neck", "rightShoulder"],
    ["leftShoulder", "leftElbow"],
    ["leftElbow", "leftWrist"],
    ["rightShoulder", "rightElbow"],
    ["rightElbow", "rightWrist"],
    ["neck", "hip"],
    ["hip", "leftKnee"],
    ["leftKnee", "leftAnkle"],
    ["hip", "rightKnee"],
    ["rightKnee", "rightAnkle"],
  ];

function SceneObjectNode({
  object,
  panMode,
  selected,
  transformRef,
}: {
  object: SceneObject;
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

    updateObject(object.id, {
      position: {
        x: Math.round(node.x()),
        y: Math.round(node.y()),
      },
      rotation: Math.round(node.rotation()),
      size: {
        width: Math.max(16, Math.round(object.size.width * scaleX)),
        height: Math.max(16, Math.round(object.size.height * scaleY)),
      },
    });
  }

  return (
    <Group
      draggable={!panMode}
      id={object.id}
      onClick={handleSelect}
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
    </Group>
  );
}

function CharacterNode({
  character,
  panMode,
  selected,
}: {
  character: CharacterSkeleton;
  panMode: boolean;
  selected: boolean;
}) {
  const selectCharacter = useEditorStore((state) => state.selectCharacter);
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

  return (
    <Group
      draggable={!panMode}
      id={character.id}
      onClick={handleSelect}
      onDragEnd={handleDragEnd}
      onTap={handleSelect}
      x={character.position.x}
      y={character.position.y}
    >
      {skeletonBones.map(([from, to]) => (
        <Line
          key={`${from}-${to}`}
          lineCap="round"
          points={[
            character.joints[from].x,
            character.joints[from].y,
            character.joints[to].x,
            character.joints[to].y,
          ]}
          stroke={stroke}
          strokeWidth={selected ? 9 : 7}
        />
      ))}
      <Circle
        fill="#ffffff"
        radius={30}
        stroke={stroke}
        strokeWidth={selected ? 6 : 4}
        x={character.joints.neck.x}
        y={character.joints.neck.y - 34}
      />
      {Object.entries(character.joints).map(([joint, position]) => (
        <Circle
          draggable={!panMode}
          fill={selected ? "#0f172a" : "#ffffff"}
          key={joint}
          onClick={handleSelect}
          onDragEnd={(event) => handleJointDrag(joint as JointId, event)}
          onDragMove={(event) => handleJointDrag(joint as JointId, event)}
          onTap={handleSelect}
          radius={7}
          stroke={stroke}
          strokeWidth={3}
          x={position.x}
          y={position.y}
        />
      ))}
      <Rect
        cornerRadius={15}
        fill="#0f172a"
        height={30}
        offsetX={60}
        width={120}
        x={0}
        y={340}
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
        y={340}
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
}: CanvasStageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedObjectRef = useRef<KonvaGroup>(null);
  const transformerRef = useRef<KonvaTransformer>(null);
  const lastPanPoint = useRef<Vector2 | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [panning, setPanning] = useState(false);
  const { project, selection, selectScene } = useEditorStore();
  const { canvas, objects, characters } = project.scene;
  const baseScale = containerWidth > 0 ? Math.min((containerWidth - 32) / canvas.width, 1) : 0.6;
  const stageScale = baseScale * zoom;
  const stageWidth = canvas.width * stageScale;
  const stageHeight = canvas.height * stageScale;
  const sortedObjects = useMemo(
    () => [...objects].sort((left, right) => left.layer - right.layer),
    [objects],
  );

  useEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    const observer = new ResizeObserver(([entry]) => {
      setContainerWidth(entry.contentRect.width);
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

    transformer.nodes([]);
    transformer.getLayer()?.batchDraw();
  }, [selection, sortedObjects]);

  function handleStagePointer(event: KonvaEventObject<MouseEvent | TouchEvent>) {
    if (panMode) {
      return;
    }

    if (event.target === event.target.getStage()) {
      selectScene();
    }
  }

  function handleCanvasPointer() {
    if (panMode) {
      return;
    }

    selectScene();
  }

  function handleWheel(event: ReactWheelEvent<HTMLDivElement>) {
    event.preventDefault();
    onZoomChange(zoom + (event.deltaY > 0 ? -0.1 : 0.1));
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
      className={`flex flex-1 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 ${
        panMode || panning ? "cursor-grab" : "cursor-default"
      }`}
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
                  panMode={panMode}
                  selected={selected}
                  transformRef={selected ? selectedObjectRef : undefined}
                />
              );
            })}
            {characters.map((character) => (
              <CharacterNode
                character={character}
                key={character.id}
                panMode={panMode}
                selected={selection.kind === "character" && selection.id === character.id}
              />
            ))}
            <Transformer
              boundBoxFunc={(oldBox, newBox) =>
                newBox.width < 16 || newBox.height < 16 ? oldBox : newBox
              }
              flipEnabled={false}
              ref={transformerRef}
              rotateEnabled
            />
          </Layer>
        </Stage>
      </div>
    </div>
  );
}
