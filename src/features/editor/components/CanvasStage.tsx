"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { KonvaEventObject } from "konva/lib/Node";
import { Circle, Ellipse, Group, Layer, Line, Rect, Stage, Text } from "react-konva";

import { useEditorStore } from "@/features/editor/store/editor-store";
import type { CharacterSkeleton, SceneObject } from "@/shared/types";

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

function SceneObjectNode({ object, selected }: { object: SceneObject; selected: boolean }) {
  const selectObject = useEditorStore((state) => state.selectObject);
  const updateObject = useEditorStore((state) => state.updateObject);
  const stroke = selected ? "#0f172a" : "#cbd5e1";

  function handleSelect(event: KonvaEventObject<MouseEvent | TouchEvent>) {
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

  return (
    <Group
      draggable
      id={object.id}
      onClick={handleSelect}
      onDragEnd={handleDragEnd}
      onTap={handleSelect}
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
  selected,
}: {
  character: CharacterSkeleton;
  selected: boolean;
}) {
  const selectCharacter = useEditorStore((state) => state.selectCharacter);
  const stroke = selected ? "#0f172a" : "#334155";

  function handleSelect(event: KonvaEventObject<MouseEvent | TouchEvent>) {
    event.cancelBubble = true;
    selectCharacter(character.id);
  }

  return (
    <Group
      id={character.id}
      onClick={handleSelect}
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
          fill={selected ? "#0f172a" : "#ffffff"}
          key={joint}
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

export function CanvasStage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const { project, selection, selectScene } = useEditorStore();
  const { canvas, objects, characters } = project.scene;
  const scale = containerWidth > 0 ? Math.min((containerWidth - 32) / canvas.width, 1) : 0.6;
  const stageWidth = canvas.width * scale;
  const stageHeight = canvas.height * scale;
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

  function handleStagePointer(event: KonvaEventObject<MouseEvent | TouchEvent>) {
    if (event.target === event.target.getStage()) {
      selectScene();
    }
  }

  function handleCanvasPointer() {
    selectScene();
  }

  return (
    <div
      className="flex flex-1 items-center justify-center overflow-auto rounded-2xl border border-slate-200 bg-white p-4"
      ref={containerRef}
    >
      <Stage
        height={stageHeight}
        onMouseDown={handleStagePointer}
        onTouchStart={handleStagePointer}
        scaleX={scale}
        scaleY={scale}
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
          {sortedObjects.map((object) => (
            <SceneObjectNode
              key={object.id}
              object={object}
              selected={selection.kind === "object" && selection.id === object.id}
            />
          ))}
          {characters.map((character) => (
            <CharacterNode
              character={character}
              key={character.id}
              selected={selection.kind === "character" && selection.id === character.id}
            />
          ))}
        </Layer>
      </Stage>
    </div>
  );
}
