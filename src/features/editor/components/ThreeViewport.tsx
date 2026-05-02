"use client";

import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from "react";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { Grid, Html, OrbitControls, PerspectiveCamera, TransformControls } from "@react-three/drei";
import { MathUtils, WebGLRenderer, type Group } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getCharacterMannequinPose } from "@/features/editor/character-mannequin-pose";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { defaultScene } from "@/features/editor/store/defaults";
import { isThreeDViewportPrimitive } from "@/features/editor/scene-viewport-objects";
import type { BodyPartId, CharacterSkeleton, SceneObject, SceneObject3DTransform, Vector3 } from "@/shared/types";
import { characterAppearsInThreeViewport } from "@/shared/utils/character-space";

import type { CanvasCapture } from "./CanvasStage";

const DEG2RAD = Math.PI / 180;

/**
 * drei TransformControls 在拖拽时会关掉默认 OrbitControls；若控件在 dragging 卸载（重叠物体抢点击导致换选、Strict Mode 等），
 * detach() 不会触发 dragging-changed(false)，轨道会一直禁用。卸载时强制恢复。
 */
function TransformControlsWithOrbitRestore(props: ComponentProps<typeof TransformControls>) {
  const defaultControls = useThree((state) => state.controls);

  useEffect(() => {
    return () => {
      const ctrl = defaultControls as { enabled?: boolean } | undefined;
      if (ctrl && typeof ctrl.enabled === "boolean") {
        ctrl.enabled = true;
      }
    };
  }, [defaultControls]);

  return <TransformControls {...props} />;
}

type WebGLStatus = "checking" | "available" | "unavailable";
type TransformMode = "translate" | "rotate" | "scale";

const transformModeOptions: Array<{ mode: TransformMode; label: string }> = [
  { mode: "translate", label: "移动 (1)" },
  { mode: "rotate", label: "旋转 (2)" },
  { mode: "scale", label: "缩放 (3)" },
];

const transformModeShortcuts: Record<string, TransformMode> = {
  Digit1: "translate",
  Digit2: "rotate",
  Digit3: "scale",
  Numpad1: "translate",
  Numpad2: "rotate",
  Numpad3: "scale",
};

function isWebGLContextError(value: unknown) {
  const message =
    value instanceof Error
      ? value.message
      : typeof value === "string"
        ? value
        : value && typeof value === "object" && "message" in value
          ? String(value.message)
          : "";

  return /webgl|webglrenderer|creating webgl context/i.test(message);
}

function isKnownThreeDeprecationWarning(value: unknown) {
  const message =
    value instanceof Error
      ? value.message
      : typeof value === "string"
        ? value
        : value && typeof value === "object" && "message" in value
          ? String(value.message)
          : "";

  return (
    message.includes("THREE.Clock: This module has been deprecated") ||
    message.includes("THREE.WebGLShadowMap: PCFSoftShadowMap has been deprecated")
  );
}

function isEditableShortcutTarget(target: EventTarget | null) {
  const element = target instanceof HTMLElement ? target : null;

  if (!element) {
    return false;
  }

  return Boolean(element.closest("input, textarea, select, [contenteditable='true']"));
}

function canCreateThreeRenderer() {
  if (typeof document === "undefined") {
    return false;
  }

  const canvas = document.createElement("canvas");
  const originalConsoleError = console.error;

  try {
    console.error = (...args: unknown[]) => {
      if (args.some(isWebGLContextError)) {
        return;
      }

      originalConsoleError(...args);
    };

    const renderer = new WebGLRenderer({
      antialias: true,
      canvas,
      failIfMajorPerformanceCaveat: false,
      powerPreference: "high-performance",
    });

    renderer.forceContextLoss();
    renderer.dispose();
    return true;
  } catch (error) {
    if (!isWebGLContextError(error)) {
      console.warn("[SceneForge] [canvas] WebGL renderer preflight failed", { error });
    }

    return false;
  } finally {
    console.error = originalConsoleError;
  }
}

function WebGLFallback({ status }: { status: WebGLStatus }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-slate-950 p-8 text-slate-100">
      <div className="max-w-md rounded-xl border border-white/10 bg-slate-900/90 p-5 shadow-2xl">
        <h3 className="text-sm font-semibold">
          {status === "checking" ? "正在检测 3D 渲染能力..." : "正在切换到轻量 3D 预览..."}
        </h3>
      </div>
    </div>
  );
}

class WebGLCanvasBoundary extends Component<
  { children: ReactNode; onWebGLError: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(error: unknown) {
    return { failed: isWebGLContextError(error) };
  }

  componentDidCatch(error: unknown) {
    if (isWebGLContextError(error)) {
      this.props.onWebGLError();
    }
  }

  render() {
    if (this.state.failed) {
      return <WebGLFallback status="unavailable" />;
    }

    return this.props.children;
  }
}

function objectSelected(selection: ReturnType<typeof useEditorStore.getState>["selection"], id: string) {
  if (selection.kind === "object") {
    return selection.id === id;
  }

  if (selection.kind === "multiple") {
    return selection.objectIds.includes(id);
  }

  return false;
}

function characterSelected(selection: ReturnType<typeof useEditorStore.getState>["selection"], id: string) {
  if (selection.kind === "character") {
    return selection.id === id;
  }

  if (selection.kind === "multiple") {
    return selection.characterIds.includes(id);
  }

  return false;
}

function characterScopeSelected(selection: ReturnType<typeof useEditorStore.getState>["selection"], id: string) {
  return characterSelected(selection, id) || (selection.kind === "bodyPart" && selection.characterId === id);
}

function selectedCharacterBodyPart(
  selection: ReturnType<typeof useEditorStore.getState>["selection"],
  id: string,
) {
  return selection.kind === "bodyPart" && selection.characterId === id ? selection.bodyPartId : undefined;
}

function rotationRadians(transform: SceneObject3DTransform, object: SceneObject) {
  const baseX = object.kind === "plane" ? -90 : 0;
  return [
    (transform.rotation.x + baseX) * DEG2RAD,
    transform.rotation.y * DEG2RAD,
    transform.rotation.z * DEG2RAD,
  ] as const;
}

function characterRotationRadians(transform: SceneObject3DTransform) {
  return [
    transform.rotation.x * DEG2RAD,
    transform.rotation.y * DEG2RAD,
    transform.rotation.z * DEG2RAD,
  ] as const;
}

function roundTransformNumber(value: number) {
  return Number(value.toFixed(3));
}

function roundVector3(vector: Vector3): Vector3 {
  return {
    x: roundTransformNumber(vector.x),
    y: roundTransformNumber(vector.y),
    z: roundTransformNumber(vector.z),
  };
}

function characterTransform(character: CharacterSkeleton): SceneObject3DTransform {
  return (
    character.transform3D ?? {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    }
  );
}

function transformFromGroup(group: Group, object: SceneObject): SceneObject3DTransform {
  const baseX = object.kind === "plane" ? -90 : 0;

  return {
    position: {
      x: roundTransformNumber(group.position.x),
      y: roundTransformNumber(group.position.y),
      z: roundTransformNumber(group.position.z),
    },
    rotation: {
      x: roundTransformNumber(MathUtils.radToDeg(group.rotation.x) - baseX),
      y: roundTransformNumber(MathUtils.radToDeg(group.rotation.y)),
      z: roundTransformNumber(MathUtils.radToDeg(group.rotation.z)),
    },
    scale: {
      x: roundTransformNumber(Math.max(0.05, group.scale.x)),
      y: roundTransformNumber(Math.max(0.05, group.scale.y)),
      z: roundTransformNumber(Math.max(0.05, group.scale.z)),
    },
  };
}

function characterTransformFromGroup(group: Group): SceneObject3DTransform {
  return {
    position: {
      x: roundTransformNumber(group.position.x),
      y: roundTransformNumber(group.position.y),
      z: roundTransformNumber(group.position.z),
    },
    rotation: {
      x: roundTransformNumber(MathUtils.radToDeg(group.rotation.x)),
      y: roundTransformNumber(MathUtils.radToDeg(group.rotation.y)),
      z: roundTransformNumber(MathUtils.radToDeg(group.rotation.z)),
    },
    scale: {
      x: roundTransformNumber(Math.max(0.05, group.scale.x)),
      y: roundTransformNumber(Math.max(0.05, group.scale.y)),
      z: roundTransformNumber(Math.max(0.05, group.scale.z)),
    },
  };
}

function PrimitiveGeometry({ kind }: { kind: SceneObject["kind"] }) {
  if (kind === "sphere") {
    return <sphereGeometry args={[0.6, 32, 24]} />;
  }

  if (kind === "cylinder") {
    return <cylinderGeometry args={[0.5, 0.5, 1.2, 32]} />;
  }

  if (kind === "plane") {
    return <planeGeometry args={[1.4, 1.4]} />;
  }

  return <boxGeometry args={[1, 1, 1]} />;
}

function SceneObjectMesh({
  groupRef,
  object,
  selected,
  onCloseContextMenu,
  onOpenContextMenu,
}: {
  groupRef?: Ref<Group>;
  object: SceneObject;
  selected: boolean;
  onCloseContextMenu?: () => void;
  onOpenContextMenu?: (clientX: number, clientY: number) => void;
}) {
  const selectObject = useEditorStore((state) => state.selectObject);
  const snapObjectToGround = useEditorStore((state) => state.snapObjectToGround);
  const transform = object.transform3D;

  if (!transform) {
    return null;
  }

  function handleSelect(event: ThreeEvent<MouseEvent>) {
    onCloseContextMenu?.();
    event.stopPropagation();
    selectObject(object.id);
  }

  function handlePointerDown(event: ThreeEvent<PointerEvent>) {
    if (event.button === 2) {
      event.stopPropagation();
      return;
    }

    handleSelect(event as unknown as ThreeEvent<MouseEvent>);
  }

  function handleContextMenu(event: ThreeEvent<MouseEvent>) {
    event.stopPropagation();
    event.nativeEvent.preventDefault();
    selectObject(object.id);
    onOpenContextMenu?.(event.clientX, event.clientY);
  }

  function handleSnapToGround(event: ThreeEvent<MouseEvent>) {
    event.stopPropagation();
    snapObjectToGround(object.id);
  }

  return (
    <group
      onClick={handleSelect}
      onContextMenu={handleContextMenu}
      onDoubleClick={handleSnapToGround}
      onPointerDown={handlePointerDown}
      position={[transform.position.x, transform.position.y, transform.position.z]}
      ref={groupRef}
      rotation={rotationRadians(transform, object)}
      scale={[transform.scale.x, transform.scale.y, transform.scale.z]}
    >
      <mesh>
        <PrimitiveGeometry kind={object.kind} />
        <meshStandardMaterial
          color={object.fill}
          emissive={selected ? "#1d4ed8" : "#000000"}
          emissiveIntensity={selected ? 0.18 : 0}
          roughness={0.58}
        />
      </mesh>
      {selected ? (
        <mesh scale={[1.08, 1.08, 1.08]}>
          <PrimitiveGeometry kind={object.kind} />
          <meshBasicMaterial color="#2563eb" wireframe />
        </mesh>
      ) : null}
      <Html center distanceFactor={9} position={[0, object.kind === "plane" ? 0.05 : 0.9, 0]}>
        <div className="pointer-events-none rounded bg-white/85 px-2 py-0.5 text-[11px] font-semibold text-slate-800 shadow-sm ring-1 ring-slate-200">
          {object.name}
        </div>
      </Html>
    </group>
  );
}

function TransformableSceneObject({
  mode,
  object,
  onCloseContextMenu,
  onOpenContextMenu,
  onTransformEnd,
  selected,
}: {
  mode: TransformMode;
  object: SceneObject;
  onCloseContextMenu?: () => void;
  onOpenContextMenu?: (clientX: number, clientY: number) => void;
  onTransformEnd: (object: SceneObject, group: Group | null) => void;
  selected: boolean;
}) {
  const groupRef = useRef<Group | null>(null);
  const [controlObject, setControlObject] = useState<Group | null>(null);
  const setGroupRef = useCallback((group: Group | null) => {
    groupRef.current = group;
    setControlObject(group);
  }, []);

  if (!selected) {
    return (
      <SceneObjectMesh
        object={object}
        selected={false}
        onCloseContextMenu={onCloseContextMenu}
        onOpenContextMenu={onOpenContextMenu}
      />
    );
  }

  return (
    <>
      <SceneObjectMesh
        groupRef={setGroupRef}
        object={object}
        selected
        onCloseContextMenu={onCloseContextMenu}
        onOpenContextMenu={onOpenContextMenu}
      />
      <TransformControlsWithOrbitRestore
        mode={mode}
        object={controlObject ?? undefined}
        onMouseUp={() => onTransformEnd(object, groupRef.current)}
        size={0.82}
        space="world"
      />
    </>
  );
}

type ThreeTuple = [number, number, number];

const mannequinPalette = {
  selectedClothing: "#60a5fa",
  selectedJoint: "#2563eb",
  clothing: "#cbd5e1",
  joint: "#64748b",
  skin: "#f8c8a5",
  shadow: "#475569",
  sole: "#1e293b",
};

function MannequinMaterial({
  color,
  selected,
  roughness = 0.66,
}: {
  color: string;
  selected: boolean;
  roughness?: number;
}) {
  return (
    <meshStandardMaterial
      color={color}
      emissive={selected ? "#1d4ed8" : "#000000"}
      emissiveIntensity={selected ? 0.08 : 0}
      roughness={roughness}
    />
  );
}

function MannequinSegment({
  color,
  height,
  onSelect,
  position,
  radiusBottom,
  radiusTop,
  rotation = [0, 0, 0],
  selected,
}: {
  color: string;
  height: number;
  onSelect?: (event: ThreeEvent<MouseEvent>) => void;
  position: ThreeTuple;
  radiusBottom: number;
  radiusTop: number;
  rotation?: ThreeTuple;
  selected: boolean;
}) {
  return (
    <mesh
      onClick={onSelect}
      onPointerDown={(event) => {
        if (event.button === 0 && onSelect) {
          event.stopPropagation();
        }
      }}
      position={position}
      rotation={rotation}
    >
      <cylinderGeometry args={[radiusTop, radiusBottom, height, 12]} />
      <MannequinMaterial color={color} selected={selected} />
    </mesh>
  );
}

function MannequinJoint({
  color,
  onSelect,
  position,
  radius,
  selected,
}: {
  color: string;
  onSelect?: (event: ThreeEvent<MouseEvent>) => void;
  position: ThreeTuple;
  radius: number;
  selected: boolean;
}) {
  return (
    <mesh
      onClick={onSelect}
      onPointerDown={(event) => {
        if (event.button === 0 && onSelect) {
          event.stopPropagation();
        }
      }}
      position={position}
    >
      <sphereGeometry args={[radius, 16, 12]} />
      <MannequinMaterial color={color} roughness={0.62} selected={selected} />
    </mesh>
  );
}

function MannequinBox({
  args,
  color,
  onSelect,
  position,
  rotation = [0, 0, 0],
  selected,
}: {
  args: ThreeTuple;
  color: string;
  onSelect?: (event: ThreeEvent<MouseEvent>) => void;
  position: ThreeTuple;
  rotation?: ThreeTuple;
  selected: boolean;
}) {
  return (
    <mesh
      onClick={onSelect}
      onPointerDown={(event) => {
        if (event.button === 0 && onSelect) {
          event.stopPropagation();
        }
      }}
      position={position}
      rotation={rotation}
    >
      <boxGeometry args={args} />
      <MannequinMaterial color={color} selected={selected} />
    </mesh>
  );
}

function MannequinSelectionHalo() {
  return (
    <group>
      <mesh position={[0, 1.18, 0]}>
        <boxGeometry args={[1.34, 2.36, 0.72]} />
        <meshBasicMaterial color="#2563eb" transparent opacity={0.42} wireframe />
      </mesh>
      <mesh position={[0, 0.03, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.5, 0.64, 40]} />
        <meshBasicMaterial color="#60a5fa" transparent opacity={0.55} />
      </mesh>
    </group>
  );
}

function CharacterMannequinMesh({
  character,
  groupRef,
  onCloseContextMenu,
  onOpenContextMenu,
  selected,
  selectedBodyPartId,
}: {
  character: CharacterSkeleton;
  groupRef?: Ref<Group>;
  onCloseContextMenu?: () => void;
  onOpenContextMenu?: (clientX: number, clientY: number) => void;
  selected: boolean;
  selectedBodyPartId?: BodyPartId;
}) {
  const selectCharacter = useEditorStore((state) => state.selectCharacter);
  const selectBodyPart = useEditorStore((state) => state.selectBodyPart);
  const snapCharacterToGround = useEditorStore((state) => state.snapCharacterToGround);
  const transform = characterTransform(character);
  const pose = getCharacterMannequinPose(character);
  /** 与 2D 一致：仅整人选中时躯干/四肢用「整选」配色；选中某一部位时只突出该部位。 */
  const focusWholeCharacter = selected && selectedBodyPartId === undefined;
  const clothingColor = focusWholeCharacter ? mannequinPalette.selectedClothing : mannequinPalette.clothing;
  const jointColor = focusWholeCharacter ? mannequinPalette.selectedJoint : mannequinPalette.joint;
  const isPartSelected = (bodyPartId: BodyPartId) => selectedBodyPartId === bodyPartId;

  function handleSelect(event: ThreeEvent<MouseEvent>) {
    onCloseContextMenu?.();
    event.stopPropagation();
    selectCharacter(character.id);
  }

  function handleContextMenu(event: ThreeEvent<MouseEvent>) {
    event.stopPropagation();
    event.nativeEvent.preventDefault();
    selectCharacter(character.id);
    onOpenContextMenu?.(event.clientX, event.clientY);
  }

  function handleSnapToGround(event: ThreeEvent<MouseEvent>) {
    event.stopPropagation();
    snapCharacterToGround(character.id);
  }

  function handleBodyPartSelect(bodyPartId: BodyPartId, event: ThreeEvent<MouseEvent>) {
    onCloseContextMenu?.();
    event.stopPropagation();
    selectBodyPart(character.id, bodyPartId);
  }

  return (
    <group
      onClick={handleSelect}
      onContextMenu={handleContextMenu}
      onDoubleClick={handleSnapToGround}
      position={[transform.position.x, transform.position.y, transform.position.z]}
      ref={groupRef}
      rotation={characterRotationRadians(transform)}
      scale={[transform.scale.x, transform.scale.y, transform.scale.z]}
    >
      <MannequinJoint
        color={mannequinPalette.skin}
        onSelect={(event) => handleBodyPartSelect("head", event)}
        position={pose.head.position}
        radius={pose.head.radius}
        selected={isPartSelected("head") || focusWholeCharacter}
      />
      <MannequinSegment
        color={mannequinPalette.skin}
        height={Math.max(0.12, pose.head.position[1] - pose.joints.neck.y - pose.head.radius * 0.55)}
        onSelect={(event) => handleBodyPartSelect("head", event)}
        position={[pose.joints.neck.x, pose.joints.neck.y + 0.08, 0]}
        radiusBottom={0.09}
        radiusTop={0.1}
        selected={isPartSelected("head") || focusWholeCharacter}
      />
      <MannequinBox
        args={pose.torso.size}
        color={isPartSelected("torso") ? mannequinPalette.selectedClothing : clothingColor}
        onSelect={(event) => handleBodyPartSelect("torso", event)}
        position={pose.torso.position}
        selected={isPartSelected("torso") || focusWholeCharacter}
      />
      <MannequinBox
        args={pose.torso.waistSize}
        color={isPartSelected("torso") ? mannequinPalette.selectedJoint : mannequinPalette.shadow}
        onSelect={(event) => handleBodyPartSelect("torso", event)}
        position={pose.torso.waistPosition}
        selected={isPartSelected("torso") || focusWholeCharacter}
      />

      <MannequinJoint color={jointColor} position={[pose.joints.leftShoulder.x, pose.joints.leftShoulder.y, 0]} radius={0.1} selected={focusWholeCharacter} />
      <MannequinJoint color={jointColor} position={[pose.joints.rightShoulder.x, pose.joints.rightShoulder.y, 0]} radius={0.1} selected={focusWholeCharacter} />
      {pose.segments
        .filter((segment) => segment.bodyPartId !== "torso")
        .map((segment) => {
          const segmentSelected = isPartSelected(segment.bodyPartId);

          return (
            <MannequinSegment
              color={segmentSelected ? mannequinPalette.selectedJoint : jointColor}
              height={segment.height}
              key={`${segment.bodyPartId}-${segment.from}-${segment.to}`}
              onSelect={(event) => handleBodyPartSelect(segment.bodyPartId, event)}
              position={segment.position}
              radiusBottom={segment.bodyPartId.endsWith("Shin") || segment.bodyPartId.endsWith("Forearm") ? 0.065 : 0.08}
              radiusTop={segment.bodyPartId.endsWith("Shin") || segment.bodyPartId.endsWith("Forearm") ? 0.075 : 0.095}
              rotation={segment.rotation}
              selected={segmentSelected || focusWholeCharacter}
            />
          );
        })}
      <MannequinJoint color={jointColor} position={[pose.joints.leftElbow.x, pose.joints.leftElbow.y, pose.joints.leftElbow.z]} radius={0.085} selected={focusWholeCharacter} />
      <MannequinJoint color={jointColor} position={[pose.joints.rightElbow.x, pose.joints.rightElbow.y, pose.joints.rightElbow.z]} radius={0.085} selected={focusWholeCharacter} />
      <MannequinJoint color={jointColor} position={[pose.joints.leftKnee.x, pose.joints.leftKnee.y, pose.joints.leftKnee.z]} radius={0.09} selected={focusWholeCharacter} />
      <MannequinJoint color={jointColor} position={[pose.joints.rightKnee.x, pose.joints.rightKnee.y, pose.joints.rightKnee.z]} radius={0.09} selected={focusWholeCharacter} />
      <MannequinJoint
        color={isPartSelected("leftHand") ? mannequinPalette.selectedJoint : mannequinPalette.skin}
        onSelect={(event) => handleBodyPartSelect("leftHand", event)}
        position={pose.hands.leftHand.position}
        radius={pose.hands.leftHand.radius}
        selected={isPartSelected("leftHand") || focusWholeCharacter}
      />
      <MannequinJoint
        color={isPartSelected("rightHand") ? mannequinPalette.selectedJoint : mannequinPalette.skin}
        onSelect={(event) => handleBodyPartSelect("rightHand", event)}
        position={pose.hands.rightHand.position}
        radius={pose.hands.rightHand.radius}
        selected={isPartSelected("rightHand") || focusWholeCharacter}
      />
      <MannequinBox
        args={pose.feet.leftFoot.size}
        color={isPartSelected("leftFoot") ? mannequinPalette.selectedJoint : mannequinPalette.sole}
        onSelect={(event) => handleBodyPartSelect("leftFoot", event)}
        position={pose.feet.leftFoot.position}
        selected={isPartSelected("leftFoot") || focusWholeCharacter}
      />
      <MannequinBox
        args={pose.feet.rightFoot.size}
        color={isPartSelected("rightFoot") ? mannequinPalette.selectedJoint : mannequinPalette.sole}
        onSelect={(event) => handleBodyPartSelect("rightFoot", event)}
        position={pose.feet.rightFoot.position}
        selected={isPartSelected("rightFoot") || focusWholeCharacter}
      />

      {focusWholeCharacter ? <MannequinSelectionHalo /> : null}
      <Html center distanceFactor={9} position={[0, pose.bounds.maxY + 0.28, 0]}>
        <div className="pointer-events-none rounded bg-white/85 px-2 py-0.5 text-[11px] font-semibold text-slate-800 shadow-sm ring-1 ring-slate-200">
          {character.name}
        </div>
      </Html>
    </group>
  );
}

function TransformableCharacterMannequin({
  character,
  mode,
  onCloseContextMenu,
  onOpenContextMenu,
  onTransformEnd,
  selected,
  selectedBodyPartId,
  transformGizmoEnabled,
}: {
  character: CharacterSkeleton;
  mode: TransformMode;
  onCloseContextMenu?: () => void;
  onOpenContextMenu?: (clientX: number, clientY: number) => void;
  onTransformEnd: (character: CharacterSkeleton, group: Group | null) => void;
  selected: boolean;
  selectedBodyPartId?: BodyPartId;
  transformGizmoEnabled: boolean;
}) {
  const groupRef = useRef<Group | null>(null);
  const [controlObject, setControlObject] = useState<Group | null>(null);
  const setGroupRef = useCallback((group: Group | null) => {
    groupRef.current = group;
    setControlObject(group);
  }, []);

  if (!selected) {
    return (
      <CharacterMannequinMesh
        character={character}
        selectedBodyPartId={selectedBodyPartId}
        selected={false}
        onCloseContextMenu={onCloseContextMenu}
        onOpenContextMenu={onOpenContextMenu}
      />
    );
  }

  return (
    <>
      <CharacterMannequinMesh
        character={character}
        groupRef={setGroupRef}
        selectedBodyPartId={selectedBodyPartId}
        selected
        onCloseContextMenu={onCloseContextMenu}
        onOpenContextMenu={onOpenContextMenu}
      />
      <TransformControlsWithOrbitRestore
        enabled={transformGizmoEnabled}
        mode={mode}
        object={controlObject ?? undefined}
        onMouseUp={() => onTransformEnd(character, groupRef.current)}
        size={0.82}
        space="world"
      />
    </>
  );
}

function getCssPrimitiveClass(object: SceneObject, selected: boolean) {
  const base =
    "absolute flex items-center justify-center border text-[11px] font-semibold text-white shadow-xl transition-all";
  const selectedClass = selected
    ? "border-blue-300 ring-4 ring-blue-400/40"
    : "border-white/25 ring-1 ring-black/20";

  if (object.kind === "sphere") {
    return `${base} ${selectedClass} rounded-full`;
  }

  if (object.kind === "cylinder") {
    return `${base} ${selectedClass} rounded-[999px]`;
  }

  if (object.kind === "plane") {
    return `${base} ${selectedClass} rounded-md opacity-90`;
  }

  return `${base} ${selectedClass} rounded-lg`;
}

function getCssPrimitiveStyle(object: SceneObject): CSSProperties {
  const transform = object.transform3D;

  if (!transform) {
    return {};
  }

  const width = Math.max(42, 64 * transform.scale.x);
  const height =
    object.kind === "plane"
      ? Math.max(24, 42 * transform.scale.z)
      : Math.max(42, 64 * transform.scale.y);
  const left = 50 + transform.position.x * 8;
  const top = 54 + transform.position.z * 7 - transform.position.y * 6;

  return {
    background: object.fill,
    height,
    left: `${left}%`,
    top: `${top}%`,
    transform: [
      "translate(-50%, -50%)",
      "rotateX(58deg)",
      "rotateZ(-35deg)",
      `rotateY(${transform.rotation.y}deg)`,
      `rotateZ(${transform.rotation.z}deg)`,
    ].join(" "),
    width,
  };
}

function getCssCharacterStyle(character: CharacterSkeleton): CSSProperties {
  const transform = characterTransform(character);
  const width = Math.max(44, 58 * transform.scale.x);
  const height = Math.max(96, 136 * transform.scale.y);
  const left = 50 + transform.position.x * 8;
  const top = 54 + transform.position.z * 7 - transform.position.y * 6;

  return {
    height,
    left: `${left}%`,
    top: `${top}%`,
    transform: [
      "translate(-50%, -50%)",
      "rotateX(58deg)",
      "rotateZ(-35deg)",
      `rotateY(${transform.rotation.y}deg)`,
      `rotateZ(${transform.rotation.z}deg)`,
    ].join(" "),
    width,
  };
}

function Css3DViewport({
  characters,
  objects,
  selection,
  selectScene,
}: {
  characters: CharacterSkeleton[];
  objects: SceneObject[];
  selection: ReturnType<typeof useEditorStore.getState>["selection"];
  selectScene: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const selectObject = useEditorStore((state) => state.selectObject);
  const selectCharacter = useEditorStore((state) => state.selectCharacter);
  const snapObjectToGround = useEditorStore((state) => state.snapObjectToGround);
  const snapCharacterToGround = useEditorStore((state) => state.snapCharacterToGround);
  const deleteSelection = useEditorStore((state) => state.deleteSelection);
  const [objectContextMenu, setObjectContextMenu] = useState<{ x: number; y: number } | null>(null);

  function openObjectContextMenu(clientX: number, clientY: number) {
    const rect = containerRef.current?.getBoundingClientRect();

    if (!rect) {
      return;
    }

    setObjectContextMenu({ x: clientX - rect.left, y: clientY - rect.top });
  }

  function closeObjectContextMenu() {
    setObjectContextMenu(null);
  }

  useEffect(() => {
    if (!objectContextMenu) {
      return undefined;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeObjectContextMenu();
      }
    }

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [objectContextMenu]);

  function handleBackdropMouseDown() {
    closeObjectContextMenu();
    selectScene();
  }

  return (
    <div
      className="relative h-full w-full overflow-hidden bg-slate-950"
      onMouseDown={(event) => {
        if (objectContextMenu) {
          closeObjectContextMenu();
        }

        if (event.button !== 2) {
          selectScene();
        }
      }}
      ref={containerRef}
      role="presentation"
    >
      <div className="absolute left-1/2 top-5 z-20 -translate-x-1/2 rounded-full border border-amber-300/30 bg-amber-950/70 px-4 py-2 text-xs font-medium text-amber-100 shadow-lg">
        WebGL 不可用，正在显示轻量 3D 预览；对象仍可选择并在右侧编辑位置、旋转和缩放。
      </div>
      <div className="absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.16)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.16)_1px,transparent_1px)] [background-size:48px_48px]" />
      <div className="absolute left-1/2 top-1/2 h-[64%] w-[72%] -translate-x-1/2 -translate-y-1/2 rotate-x-[58deg] rotate-z-[-35deg] rounded-2xl border border-slate-500/30 bg-slate-800/25 shadow-2xl" />
      {objects.length === 0 && characters.length === 0 ? (
        <div className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-white/10 bg-slate-900/85 px-4 py-3 text-sm text-slate-200">
          从左侧添加「3D 人体」或 3D 基础体
        </div>
      ) : null}
      {objects.map((object) => {
        const selected = objectSelected(selection, object.id);

        return (
          <button
            aria-label={`选择 ${object.name}`}
            className={getCssPrimitiveClass(object, selected)}
            key={object.id}
            onDoubleClick={(event) => {
              event.stopPropagation();
              snapObjectToGround(object.id);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              selectObject(object.id);
              openObjectContextMenu(event.clientX, event.clientY);
            }}
            onMouseDown={(event) => {
              event.stopPropagation();
              closeObjectContextMenu();
              selectObject(object.id);
            }}
            style={getCssPrimitiveStyle(object)}
            type="button"
          >
            <span className="max-w-[92px] truncate drop-shadow">{object.name}</span>
          </button>
        );
      })}
      {characters.map((character) => {
        const selected = characterScopeSelected(selection, character.id);

        return (
          <button
            aria-label={`选择 ${character.name}`}
            className={[
              "absolute flex items-center justify-center rounded-full border text-[11px] font-semibold text-white shadow-xl transition-all",
              selected
                ? "border-blue-300 bg-blue-500 ring-4 ring-blue-400/40"
                : "border-white/25 bg-slate-500 ring-1 ring-black/20",
            ].join(" ")}
            key={character.id}
            onDoubleClick={(event) => {
              event.stopPropagation();
              snapCharacterToGround(character.id);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              selectCharacter(character.id);
              openObjectContextMenu(event.clientX, event.clientY);
            }}
            onMouseDown={(event) => {
              event.stopPropagation();
              closeObjectContextMenu();
              selectCharacter(character.id);
            }}
            style={getCssCharacterStyle(character)}
            type="button"
          >
            <span className="max-w-[92px] truncate drop-shadow">{character.name}</span>
          </button>
        );
      })}
      {objectContextMenu ? (
        <>
          <button
            aria-label="关闭菜单"
            className="absolute inset-0 z-[90] cursor-default bg-transparent"
            onContextMenu={(event) => {
              event.preventDefault();
              closeObjectContextMenu();
            }}
            onMouseDown={(event) => {
              event.preventDefault();
              handleBackdropMouseDown();
            }}
            type="button"
          />
          <div
            className="absolute z-[100] min-w-[132px] overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-lg"
            style={{ left: objectContextMenu.x, top: objectContextMenu.y }}
          >
            <button
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50"
              onClick={() => {
                deleteSelection();
                closeObjectContextMenu();
              }}
              type="button"
            >
              <Trash2 className="size-4 shrink-0" />
              删除
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function CaptureBridge({
  onCaptureReady,
}: {
  onCaptureReady?: (capture: CanvasCapture | null) => void;
}) {
  const gl = useThree((state) => state.gl);

  useEffect(() => {
    if (!onCaptureReady) {
      return;
    }

    onCaptureReady(() => {
      try {
        return gl.domElement.toDataURL("image/png");
      } catch (error) {
        console.warn("[SceneForge] [canvas] Failed to capture 3D viewport", { error });
        return null;
      }
    });

    return () => onCaptureReady(null);
  }, [gl, onCaptureReady]);

  return null;
}

function resetThreeCameraFromStore() {
  const store = useEditorStore.getState();

  store.updateScene({
    three: {
      ...store.project.scene.three,
      camera: {
        fov: defaultScene.three.camera.fov,
        position: { ...defaultScene.three.camera.position },
        target: { ...defaultScene.three.camera.target },
      },
    },
  });
}

function focusThreeSelectionFromStore() {
  const store = useEditorStore.getState();
  const { selection } = store;
  const objects = store.project.scene.objects.filter(isThreeDViewportPrimitive);
  const characters = store.project.scene.characters.filter(characterAppearsInThreeViewport);
  const three = store.project.scene.three;

  let focusPoint: Vector3 | null = null;

  if (selection.kind === "object") {
    focusPoint =
      objects.find((object) => object.id === selection.id)?.transform3D?.position ?? null;
  } else if (selection.kind === "character" || selection.kind === "bodyPart") {
    const characterId = selection.kind === "character" ? selection.id : selection.characterId;
    const character = characters.find((character) => character.id === characterId);
    focusPoint = character ? characterTransform(character).position : null;
  } else if (selection.kind === "multiple") {
    const selectedObjects = objects.filter((object) => selection.objectIds.includes(object.id));
    const selectedCharacters = characters.filter((character) => selection.characterIds.includes(character.id));
    const selectedTransforms = [
      ...selectedObjects.map((object) => object.transform3D?.position).filter((point): point is Vector3 => Boolean(point)),
      ...selectedCharacters.map((character) => characterTransform(character).position),
    ];

    if (selectedTransforms.length > 0) {
      const total = selectedTransforms.reduce(
        (point, object) => ({
          x: point.x + object.x,
          y: point.y + object.y,
          z: point.z + object.z,
        }),
        { x: 0, y: 0, z: 0 },
      );

      focusPoint = {
        x: total.x / selectedTransforms.length,
        y: total.y / selectedTransforms.length,
        z: total.z / selectedTransforms.length,
      };
    }
  }

  if (!focusPoint) {
    return;
  }

  const currentOffset = {
    x: three.camera.position.x - three.camera.target.x,
    y: three.camera.position.y - three.camera.target.y,
    z: three.camera.position.z - three.camera.target.z,
  };

  store.updateScene({
    three: {
      ...three,
      camera: {
        ...three.camera,
        position: roundVector3({
          x: focusPoint.x + currentOffset.x,
          y: focusPoint.y + currentOffset.y,
          z: focusPoint.z + currentOffset.z,
        }),
        target: roundVector3(focusPoint),
      },
    },
  });
}

type ThreeViewportProps = {
  onCaptureReady?: (capture: CanvasCapture | null) => void;
};

function ThreeViewportWeb({
  onCaptureReady,
  onWebGLError,
}: ThreeViewportProps & { onWebGLError: () => void }) {
  const { project, selectScene, selection, setCharacter3DTransform, setObject3DTransform, updateScene } =
    useEditorStore();
  const deleteSelection = useEditorStore((state) => state.deleteSelection);
  const { three } = project.scene;
  const objects = project.scene.objects.filter(isThreeDViewportPrimitive);
  const characters = useMemo(
    () => project.scene.characters.filter(characterAppearsInThreeViewport),
    [project.scene.characters],
  );
  const orbitControlsRef = useRef<OrbitControlsImpl | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [transformMode, setTransformMode] = useState<TransformMode>("translate");
  const [mannequinGizmoEnabled, setMannequinGizmoEnabled] = useState(false);
  const [objectContextMenu, setObjectContextMenu] = useState<{ x: number; y: number } | null>(null);

  const selectionSyncKey =
    selection.kind === "character"
      ? `character:${selection.id}`
      : selection.kind === "bodyPart"
        ? `bodyPart:${selection.characterId}:${selection.bodyPartId}`
        : selection.kind === "multiple"
          ? `multiple:${[...selection.characterIds].sort().join(",")}|${[...selection.objectIds].sort().join(",")}`
          : selection.kind === "object"
            ? `object:${selection.id}`
            : selection.kind;

  const showMannequinGizmoToggle =
    characters.length > 0 &&
    (selection.kind === "character" ||
      selection.kind === "bodyPart" ||
      (selection.kind === "multiple" && selection.characterIds.length > 0));

  /* eslint-disable react-hooks/set-state-in-effect -- default 人体 Gizmo from selection (see selectionSyncKey); intentional UI sync */
  useEffect(() => {
    const inCharacterScope =
      selection.kind === "character" ||
      selection.kind === "bodyPart" ||
      (selection.kind === "multiple" && selection.characterIds.length > 0);

    if (!inCharacterScope) {
      setMannequinGizmoEnabled(false);
      return;
    }

    if (selection.kind === "bodyPart") {
      setMannequinGizmoEnabled(false);
      return;
    }

    if (selection.kind === "character") {
      setMannequinGizmoEnabled(true);
      return;
    }

    if (selection.kind === "multiple") {
      const onlyOneCharacter =
        selection.characterIds.length === 1 && selection.objectIds.length === 0;
      setMannequinGizmoEnabled(onlyOneCharacter);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `selectionSyncKey` encodes `selection`; avoids re-running on unrelated store updates
  }, [selectionSyncKey]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const resetCamera = useCallback(() => {
    resetThreeCameraFromStore();
  }, []);

  const focusSelection = useCallback(() => {
    focusThreeSelectionFromStore();
  }, []);

  const closeObjectContextMenu = useCallback(() => {
    setObjectContextMenu(null);
  }, []);

  const openObjectContextMenu = useCallback((clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();

    if (!rect) {
      return;
    }

    setObjectContextMenu({ x: clientX - rect.left, y: clientY - rect.top });
  }, []);

  const handleCanvasPointerMissed = useCallback(() => {
    closeObjectContextMenu();
    selectScene();
  }, [closeObjectContextMenu, selectScene]);

  useEffect(() => {
    if (!objectContextMenu) {
      return undefined;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeObjectContextMenu();
      }
    }

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [objectContextMenu, closeObjectContextMenu]);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (isEditableShortcutTarget(event.target) || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }

      const shortcutMode = transformModeShortcuts[event.code];

      if (shortcutMode) {
        event.preventDefault();
        setTransformMode(shortcutMode);
        return;
      }

      if (event.code === "Home") {
        event.preventDefault();
        resetCamera();
        return;
      }

      if (event.code === "KeyF") {
        event.preventDefault();
        focusSelection();
      }
    }

    window.addEventListener("keydown", handleShortcut);

    return () => window.removeEventListener("keydown", handleShortcut);
  }, [resetCamera, focusSelection]);

  function persistOrbitCamera() {
    const controls = orbitControlsRef.current;

    if (!controls) {
      return;
    }

    updateScene({
      three: {
        ...three,
        camera: {
          ...three.camera,
          position: roundVector3(controls.object.position),
          target: roundVector3(controls.target),
        },
      },
    });
  }

  function handleTransformEnd(object: SceneObject, group: Group | null) {
    if (!group) {
      return;
    }

    const raw = transformFromGroup(group, object);
    setObject3DTransform(object.id, raw);
  }

  function handleCharacterTransformEnd(character: CharacterSkeleton, group: Group | null) {
    if (!group) {
      return;
    }

    setCharacter3DTransform(character.id, characterTransformFromGroup(group));
  }

  return (
    <div className="relative h-full w-full bg-slate-950" ref={containerRef}>
      {objects.length === 0 && characters.length === 0 ? (
        <div className="pointer-events-none absolute left-1/2 top-6 z-10 -translate-x-1/2 rounded-full border border-white/10 bg-slate-900/80 px-4 py-2 text-xs text-slate-200 shadow-lg">
          从左侧添加「3D 人体」或 3D 基础体
        </div>
      ) : null}
      <div className="absolute left-4 top-4 z-10 flex items-center gap-2 rounded-xl border border-white/10 bg-slate-900/85 p-1.5 shadow-xl backdrop-blur">
        {transformModeOptions.map((option) => (
          <Button
            className="h-7 rounded-lg px-2.5 text-xs"
            key={option.mode}
            onClick={() => setTransformMode(option.mode)}
            size="sm"
            type="button"
            variant={transformMode === option.mode ? "primary" : "ghost"}
          >
            {option.label}
          </Button>
        ))}
        <div className="mx-1 h-4 w-px bg-white/10" />
        {showMannequinGizmoToggle ? (
          <Button
            className="h-7 rounded-lg px-2.5 text-xs"
            onClick={() => setMannequinGizmoEnabled((value) => !value)}
            size="sm"
            type="button"
            variant={mannequinGizmoEnabled ? "primary" : "ghost"}
          >
            人体 Gizmo
          </Button>
        ) : null}
        {showMannequinGizmoToggle ? <div className="mx-1 h-4 w-px bg-white/10" /> : null}
        <Button
          className="h-7 rounded-lg px-2.5 text-xs text-slate-200 hover:bg-white/10"
          onClick={resetCamera}
          size="sm"
          type="button"
          variant="ghost"
        >
          重置相机
        </Button>
      </div>
      <div className="pointer-events-none absolute bottom-4 left-4 z-10 rounded-lg border border-white/10 bg-slate-900/75 px-3 py-2 text-[11px] leading-relaxed text-slate-300 shadow-lg">
        1/2/3 切换 gizmo；方向键移动，PageUp/PageDown 升降；F 聚焦选中，Home 重置相机。
        <br />
        选中整个人物时可直接拖动 Gizmo 移动/旋转；点选肢体后请打开「人体 Gizmo」再拖动整体。
        <br />
        拖动空白处旋转视角并保存；当前工具：
        {transformModeOptions.find((option) => option.mode === transformMode)?.label}
      </div>
      <WebGLCanvasBoundary onWebGLError={onWebGLError}>
        <Canvas gl={{ preserveDrawingBuffer: true }} onPointerMissed={handleCanvasPointerMissed}>
          <CaptureBridge onCaptureReady={onCaptureReady} />
          <PerspectiveCamera
            fov={three.camera.fov}
            makeDefault
            onUpdate={(camera) =>
              camera.lookAt(three.camera.target.x, three.camera.target.y, three.camera.target.z)
            }
            position={[three.camera.position.x, three.camera.position.y, three.camera.position.z]}
          />
          <color args={["#0f172a"]} attach="background" />
          <ambientLight intensity={three.lighting.ambientIntensity} />
          <directionalLight
            intensity={three.lighting.directionalIntensity}
            position={[
              three.lighting.directionalPosition.x,
              three.lighting.directionalPosition.y,
              three.lighting.directionalPosition.z,
            ]}
          />
          <Grid
            args={[three.grid.size, three.grid.size]}
            cellColor="#475569"
            cellSize={1}
            fadeDistance={18}
            fadeStrength={1}
            sectionColor="#94a3b8"
            sectionSize={three.grid.divisions / 4}
          />
          <axesHelper args={[2]} position={[0, 0.02, 0]} />
          {objects.map((object) => (
            <TransformableSceneObject
              key={object.id}
              mode={transformMode}
              object={object}
              onCloseContextMenu={closeObjectContextMenu}
              onOpenContextMenu={openObjectContextMenu}
              onTransformEnd={handleTransformEnd}
              selected={objectSelected(selection, object.id)}
            />
          ))}
          {characters.map((character) => (
            <TransformableCharacterMannequin
              key={character.id}
              character={character}
              mode={transformMode}
              onCloseContextMenu={closeObjectContextMenu}
              onOpenContextMenu={openObjectContextMenu}
              onTransformEnd={handleCharacterTransformEnd}
              selected={characterScopeSelected(selection, character.id)}
              selectedBodyPartId={selectedCharacterBodyPart(selection, character.id)}
              transformGizmoEnabled={mannequinGizmoEnabled}
            />
          ))}
          <OrbitControls
            enableDamping
            makeDefault
            onEnd={persistOrbitCamera}
            ref={orbitControlsRef}
            target={[three.camera.target.x, three.camera.target.y, three.camera.target.z]}
          />
        </Canvas>
      </WebGLCanvasBoundary>
      {objectContextMenu ? (
        <>
          <button
            aria-label="关闭菜单"
            className="absolute inset-0 z-[90] cursor-default bg-transparent"
            onContextMenu={(event) => {
              event.preventDefault();
              closeObjectContextMenu();
            }}
            onMouseDown={(event) => {
              event.preventDefault();
              closeObjectContextMenu();
              selectScene();
            }}
            type="button"
          />
          <div
            className="absolute z-[100] min-w-[132px] overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-lg"
            style={{ left: objectContextMenu.x, top: objectContextMenu.y }}
          >
            <button
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50"
              onClick={() => {
                deleteSelection();
                closeObjectContextMenu();
              }}
              type="button"
            >
              <Trash2 className="size-4 shrink-0" />
              删除
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

export function ThreeViewport({ onCaptureReady }: ThreeViewportProps) {
  const { project, selectScene, selection } = useEditorStore();
  const objects = project.scene.objects.filter(isThreeDViewportPrimitive);
  const characters = useMemo(
    () => project.scene.characters.filter(characterAppearsInThreeViewport),
    [project.scene.characters],
  );
  const [webGLStatus, setWebGLStatus] = useState<WebGLStatus>("checking");

  useEffect(() => {
    function markUnavailable() {
      setWebGLStatus("unavailable");
    }

    function handleRejection(event: PromiseRejectionEvent) {
      if (isWebGLContextError(event.reason)) {
        event.preventDefault();
        markUnavailable();
      }
    }

    function handleError(event: ErrorEvent) {
      if (isWebGLContextError(event.error) || isWebGLContextError(event.message)) {
        event.preventDefault();
        markUnavailable();
      }
    }

    const detectionId = window.setTimeout(() => {
      setWebGLStatus(canCreateThreeRenderer() ? "available" : "unavailable");
    }, 0);
    const originalConsoleWarn = console.warn;
    const originalConsoleError = console.error;

    console.warn = (...args: unknown[]) => {
      if (args.some(isKnownThreeDeprecationWarning)) {
        return;
      }

      originalConsoleWarn(...args);
    };

    console.error = (...args: unknown[]) => {
      if (args.some(isKnownThreeDeprecationWarning)) {
        return;
      }

      originalConsoleError(...args);
    };

    window.addEventListener("unhandledrejection", handleRejection);
    window.addEventListener("error", handleError);

    return () => {
      window.clearTimeout(detectionId);
      console.warn = originalConsoleWarn;
      console.error = originalConsoleError;
      window.removeEventListener("unhandledrejection", handleRejection);
      window.removeEventListener("error", handleError);
    };
  }, []);

  useEffect(() => {
    if (webGLStatus !== "unavailable") {
      return undefined;
    }

    function handleShortcut(event: KeyboardEvent) {
      if (isEditableShortcutTarget(event.target) || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }

      if (event.code === "Home") {
        event.preventDefault();
        resetThreeCameraFromStore();
        return;
      }

      if (event.code === "KeyF") {
        event.preventDefault();
        focusThreeSelectionFromStore();
      }
    }

    window.addEventListener("keydown", handleShortcut);

    return () => window.removeEventListener("keydown", handleShortcut);
  }, [webGLStatus]);

  if (webGLStatus === "checking") {
    return <WebGLFallback status={webGLStatus} />;
  }

  if (webGLStatus === "unavailable") {
    return (
      <Css3DViewport
        characters={characters}
        objects={objects}
        selectScene={selectScene}
        selection={selection}
      />
    );
  }

  return (
    <ThreeViewportWeb
      onCaptureReady={onCaptureReady}
      onWebGLError={() => setWebGLStatus("unavailable")}
    />
  );
}
