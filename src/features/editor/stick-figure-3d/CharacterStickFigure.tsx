"use client";

import { useCallback, useEffect, useRef, type Ref } from "react";
import { Html } from "@react-three/drei";
import { type ThreeEvent } from "@react-three/fiber";
import { BackSide, type Group } from "three";

import type { BodyPartId, CharacterSkeleton, SceneObject3DTransform } from "@/shared/types";

import { useEditorStore } from "@/features/editor/store/editor-store";
import { getCharacterStickFigurePose } from "@/features/editor/stick-figure-3d/get-character-stick-pose";
import { PoseControls } from "@/features/editor/stick-figure-3d/PoseControls";
import { stickFigureVerticalBounds } from "@/features/editor/stick-figure-3d/snap-stick-figure-ground";
import { StickmanRenderer } from "@/features/editor/stick-figure-3d/StickmanRenderer";

const DEG2RAD = Math.PI / 180;
const HEAD_ROTATE_DRAG_SENS = 0.32;

function clampHeadRotationEulerDeg(value: number, axis: "x" | "y" | "z"): number {
  const lim = axis === "y" ? 120 : 90;
  return Math.min(lim, Math.max(-lim, value));
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (!ref) {
    return;
  }
  if (typeof ref === "function") {
    ref(value);
  } else {
    ref.current = value;
  }
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

function characterRotationRadians(transform: SceneObject3DTransform): [number, number, number] {
  return [transform.rotation.x * DEG2RAD, transform.rotation.y * DEG2RAD, transform.rotation.z * DEG2RAD];
}

function StickSelectionHalo({ maxY, minY }: { maxY: number; minY: number }) {
  const pad = 0.14;
  const height = Math.max(0.85, maxY - minY + pad * 2);
  const midY = (minY + maxY) / 2;
  const ringY = minY + 0.035;

  return (
    <group>
      <mesh position={[0, midY, 0]}>
        <cylinderGeometry args={[0.44, 0.58, height, 36, 1, true]} />
        <meshBasicMaterial
          color="#38bdf8"
          depthWrite={false}
          opacity={0.09}
          side={BackSide}
          transparent
        />
      </mesh>
      <mesh position={[0, ringY, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.48, 0.62, 40]} />
        <meshBasicMaterial color="#7dd3fc" depthWrite={false} opacity={0.42} transparent />
      </mesh>
    </group>
  );
}

export function CharacterStickFigure({
  character,
  groupRef,
  onCloseContextMenu,
  onOpenContextMenu,
  selected,
  selectedBodyPartId,
  shouldIgnoreSelectionPointerEvent,
  shouldIgnorePoseControlPointerDown,
  setOrbitEnabled,
}: {
  character: CharacterSkeleton;
  groupRef?: Ref<Group>;
  onCloseContextMenu?: () => void;
  onOpenContextMenu?: (clientX: number, clientY: number) => void;
  selected: boolean;
  selectedBodyPartId?: BodyPartId;
  shouldIgnoreSelectionPointerEvent?: (event: ThreeEvent<MouseEvent>) => boolean;
  shouldIgnorePoseControlPointerDown?: (event: ThreeEvent<PointerEvent>) => boolean;
  setOrbitEnabled?: (enabled: boolean) => void;
}) {
  const rootGroupRef = useRef<Group | null>(null);
  const assignRootRef = useCallback(
    (node: Group | null) => {
      rootGroupRef.current = node;
      assignRef(groupRef, node);
    },
    [groupRef],
  );

  const selectCharacter = useEditorStore((s) => s.selectCharacter);
  const selectBodyPart = useEditorStore((s) => s.selectBodyPart);
  const snapCharacterToGround = useEditorStore((s) => s.snapCharacterToGround);

  const headAltRotateListenersRef = useRef<{ move: (ev: PointerEvent) => void; up: (ev: PointerEvent) => void } | null>(
    null,
  );
  const headAltRotateLastRef = useRef<{ x: number; y: number } | null>(null);

  const endHeadAltRotateDrag = useCallback(() => {
    headAltRotateLastRef.current = null;
    if (headAltRotateListenersRef.current) {
      window.removeEventListener("pointermove", headAltRotateListenersRef.current.move);
      window.removeEventListener("pointerup", headAltRotateListenersRef.current.up);
      window.removeEventListener("pointercancel", headAltRotateListenersRef.current.up);
      headAltRotateListenersRef.current = null;
    }
    setOrbitEnabled?.(true);
  }, [setOrbitEnabled]);

  useEffect(() => {
    return () => {
      if (headAltRotateListenersRef.current) {
        window.removeEventListener("pointermove", headAltRotateListenersRef.current.move);
        window.removeEventListener("pointerup", headAltRotateListenersRef.current.up);
        window.removeEventListener("pointercancel", headAltRotateListenersRef.current.up);
        headAltRotateListenersRef.current = null;
      }
    };
  }, []);

  const pose = getCharacterStickFigurePose(character);
  const bounds = stickFigureVerticalBounds(pose);
  const transform = characterTransform(character);
  const focusWholeCharacter = selected && selectedBodyPartId === undefined;
  const clothingColor = focusWholeCharacter ? "#1e3a5f" : "#334155";
  const jointColor = focusWholeCharacter ? "#38bdf8" : "#64748b";
  const headColor = "#fca5a5";

  const headAltRotatePointerDownFilter = useCallback(
    (event: ThreeEvent<PointerEvent>): boolean => {
      if (event.button !== 0 || !event.altKey) {
        return false;
      }
      onCloseContextMenu?.();
      event.stopPropagation();
      endHeadAltRotateDrag();
      selectCharacter(character.id);
      selectBodyPart(character.id, "head");
      headAltRotateLastRef.current = { x: event.clientX, y: event.clientY };
      setOrbitEnabled?.(false);
      const onMove = (ev: PointerEvent) => {
        const last = headAltRotateLastRef.current;
        if (!last) {
          return;
        }
        const dx = ev.clientX - last.x;
        const dy = ev.clientY - last.y;
        headAltRotateLastRef.current = { x: ev.clientX, y: ev.clientY };
        const store = useEditorStore.getState();
        const ch = store.project.scene.characters.find((c) => c.id === character.id);
        if (!ch) {
          return;
        }
        const cur = ch.headRotation3D ?? { x: 0, y: 0, z: 0 };
        store.updateCharacter(character.id, {
          headRotation3D: {
            x: clampHeadRotationEulerDeg(cur.x - dy * HEAD_ROTATE_DRAG_SENS, "x"),
            y: clampHeadRotationEulerDeg(cur.y + dx * HEAD_ROTATE_DRAG_SENS, "y"),
            z: cur.z,
          },
        });
      };
      const onUp = () => {
        endHeadAltRotateDrag();
      };
      headAltRotateListenersRef.current = { move: onMove, up: onUp };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
      const captureTarget = event.nativeEvent.target;
      if (captureTarget instanceof Element && "setPointerCapture" in captureTarget) {
        captureTarget.setPointerCapture(event.pointerId);
      }
      return true;
    },
    [character.id, endHeadAltRotateDrag, onCloseContextMenu, selectBodyPart, selectCharacter, setOrbitEnabled],
  );

  function handleSelect(event: ThreeEvent<MouseEvent>) {
    if (shouldIgnoreSelectionPointerEvent?.(event)) {
      event.stopPropagation();
      return;
    }

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

  const headRotDeg = character.headRotation3D ?? { x: 0, y: 0, z: 0 };
  const headRotRad: [number, number, number] = [
    headRotDeg.x * DEG2RAD,
    headRotDeg.y * DEG2RAD,
    headRotDeg.z * DEG2RAD,
  ];

  const pivot = pose.joints.chest;
  const headLocal: [number, number, number] = [
    pose.joints.head.x - pivot.x,
    pose.joints.head.y - pivot.y,
    pose.joints.head.z - pivot.z,
  ];

  function handleSelectBodyPart(id: BodyPartId, event: ThreeEvent<MouseEvent>) {
    if (shouldIgnoreSelectionPointerEvent?.(event)) {
      event.stopPropagation();
      return;
    }

    onCloseContextMenu?.();
    selectCharacter(character.id);
    selectBodyPart(character.id, id);
  }

  return (
    <group
      onClick={handleSelect}
      onContextMenu={handleContextMenu}
      onDoubleClick={handleSnapToGround}
      position={[transform.position.x, transform.position.y, transform.position.z]}
      ref={assignRootRef}
      rotation={characterRotationRadians(transform)}
      scale={[transform.scale.x, transform.scale.y, transform.scale.z]}
    >
      <StickmanRenderer
        focusWholeCharacter={focusWholeCharacter}
        headColor={headColor}
        jointColor={jointColor}
        limbColor={jointColor}
        onSelectBodyPart={handleSelectBodyPart}
        pose={pose}
        selectedBodyPartId={selectedBodyPartId}
        torsoColor={clothingColor}
      />
      <group position={[pivot.x, pivot.y, pivot.z]} rotation={headRotRad}>
        <mesh
          onPointerDown={(e) => {
            if (headAltRotatePointerDownFilter(e)) {
              e.stopPropagation();
            }
          }}
          position={headLocal}
        >
          <sphereGeometry args={[0.11, 16, 16]} />
          <meshBasicMaterial opacity={0} transparent />
        </mesh>
      </group>
      <PoseControls
        character={character}
        pose={pose}
        rootGroupRef={rootGroupRef}
        setOrbitEnabled={setOrbitEnabled}
        shouldIgnorePointerDown={shouldIgnorePoseControlPointerDown}
      />
      {focusWholeCharacter ? <StickSelectionHalo maxY={bounds.maxY} minY={bounds.minY} /> : null}
      {focusWholeCharacter ? (
        <Html center distanceFactor={14} position={[0, bounds.maxY + 0.22, 0]} zIndexRange={[40, 0]}>
          <div className="pointer-events-none max-w-[min(7rem,28vw)] truncate rounded-md bg-slate-950/78 px-1.5 py-px text-[9px] font-medium leading-tight text-slate-100 shadow-sm ring-1 ring-white/12">
            {character.name}
          </div>
        </Html>
      ) : null}
    </group>
  );
}
