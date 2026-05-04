"use client";

import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import { Quaternion, Raycaster, Vector2 as ThreeVector2, Vector3, type Group } from "three";

import type { BodyPartId, CharacterSkeleton } from "@/shared/types";
import type { StickFigurePolesV1, StickFigurePoseV1, StickFigureVec3 } from "@/shared/types/stick-figure-pose";

import { useEditorStore } from "@/features/editor/store/editor-store";
import { getCharacterStickFigurePose } from "@/features/editor/stick-figure-3d/get-character-stick-pose";
import { stickPoseToTargets, type StickFigureSolveTargets } from "@/features/editor/stick-figure-3d/solveStickFigurePose";
import {
  intersectViewPlaneLocalPoint,
  screenPixelDeltaToCameraDepthLocalDelta,
} from "@/features/editor/stick-figure-3d/view-plane-depth-drag";

export type StickDragControlId =
  | "pelvis"
  | "chest"
  | "head"
  | "leftHand"
  | "rightHand"
  | "leftFoot"
  | "rightFoot"
  | "leftElbowPole"
  | "rightElbowPole"
  | "leftKneePole"
  | "rightKneePole";

type StickPoleControlId = keyof StickFigurePolesV1;

function isPoleControl(control: StickDragControlId): control is StickPoleControlId {
  return control.endsWith("Pole");
}

function controlToBodyPart(control: StickDragControlId): BodyPartId {
  if (control === "pelvis" || control === "chest") {
    return "torso";
  }
  if (control === "head") {
    return "head";
  }
  if (control === "leftHand") {
    return "leftHand";
  }
  if (control === "rightHand") {
    return "rightHand";
  }
  if (control === "leftFoot") {
    return "leftFoot";
  }
  if (control === "rightFoot") {
    return "rightFoot";
  }
  if (control === "leftElbowPole") {
    return "leftForearm";
  }
  if (control === "rightElbowPole") {
    return "rightForearm";
  }
  if (control === "leftKneePole") {
    return "leftShin";
  }
  return "rightShin";
}

type PoseControlsProps = {
  character: CharacterSkeleton;
  pose: StickFigurePoseV1;
  rootGroupRef: RefObject<Group | null>;
  showPoleControls?: boolean;
  setOrbitEnabled?: (enabled: boolean) => void;
  shouldIgnorePointerDown?: (event: ThreeEvent<PointerEvent>) => boolean;
};

type DragMode = "plane" | "depth";

type DragSession = {
  controlId: StickDragControlId;
  mode: DragMode;
  targets: StickFigureSolveTargets;
  poles: StickFigurePolesV1;
  planeAnchor: { x: number; y: number; z: number };
  lastPlanePoint: Vector3 | null;
  lastClient: { x: number; y: number };
  viewportRect: { left: number; top: number; width: number; height: number };
};

const MIN_POLE_HANDLE_DISTANCE = 0.14;
const Y_UP = new Vector3(0, 1, 0);

function poleFallbackJoint(controlId: StickPoleControlId): keyof StickFigurePoseV1["joints"] {
  if (controlId === "leftElbowPole") {
    return "leftElbow";
  }
  if (controlId === "rightElbowPole") {
    return "rightElbow";
  }
  if (controlId === "leftKneePole") {
    return "leftKnee";
  }
  return "rightKnee";
}

function poleHandleOffset(controlId: StickPoleControlId): StickFigureVec3 {
  if (controlId === "leftElbowPole") {
    return { x: -0.28, y: 0, z: 0.16 };
  }
  if (controlId === "rightElbowPole") {
    return { x: 0.28, y: 0, z: 0.16 };
  }
  if (controlId === "leftKneePole") {
    return { x: -0.08, y: 0.04, z: 0.34 };
  }
  return { x: 0.08, y: 0.04, z: 0.34 };
}

function addVec3(a: StickFigureVec3, b: StickFigureVec3): StickFigureVec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function distanceSq(a: StickFigureVec3, b: StickFigureVec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

function getPosePolePosition(pose: StickFigurePoseV1, controlId: StickPoleControlId): StickFigureVec3 {
  const joint = pose.joints[poleFallbackJoint(controlId)];
  const savedPole = pose.poles?.[controlId];
  if (savedPole && distanceSq(savedPole, joint) >= MIN_POLE_HANDLE_DISTANCE * MIN_POLE_HANDLE_DISTANCE) {
    return savedPole;
  }
  return addVec3(joint, poleHandleOffset(controlId));
}

function getSessionControlPosition(session: DragSession, controlId: StickDragControlId): StickFigureVec3 {
  if (isPoleControl(controlId)) {
    return session.poles[controlId] ?? session.targets.pelvis;
  }
  return session.targets[controlId];
}

function getDragStartPosition(
  pose: StickFigurePoseV1,
  targets: StickFigureSolveTargets,
  poles: StickFigurePolesV1,
  controlId: StickDragControlId,
): StickFigureVec3 {
  if (isPoleControl(controlId)) {
    return poles[controlId] ?? getPosePolePosition(pose, controlId);
  }
  return targets[controlId];
}

function PoleGuide({
  color,
  from,
  to,
}: {
  color: string;
  from: StickFigureVec3;
  to: StickFigureVec3;
}) {
  const { length, position, quaternion } = useMemo(() => {
    const a = new Vector3(from.x, from.y, from.z);
    const b = new Vector3(to.x, to.y, to.z);
    const dir = new Vector3().subVectors(b, a);
    const length = dir.length();
    const position = new Vector3().addVectors(a, b).multiplyScalar(0.5);
    const quaternion = length > 1e-6 ? new Quaternion().setFromUnitVectors(Y_UP, dir.normalize()) : new Quaternion();
    return { length, position, quaternion };
  }, [from.x, from.y, from.z, to.x, to.y, to.z]);

  if (length < 1e-6) {
    return null;
  }

  return (
    <mesh position={position} quaternion={quaternion} raycast={() => undefined}>
      <cylinderGeometry args={[0.0035, 0.0035, length, 6]} />
      <meshBasicMaterial color={color} depthWrite={false} opacity={0.34} transparent />
    </mesh>
  );
}

function PoleHandle({
  color,
  hitRadius,
  onPointerDown,
  position,
}: {
  color: string;
  hitRadius: number;
  onPointerDown: (event: ThreeEvent<PointerEvent>) => void;
  position: StickFigureVec3;
}) {
  const visualRadius = hitRadius * 0.72;

  return (
    <group position={[position.x, position.y, position.z]}>
      <mesh raycast={() => undefined}>
        <sphereGeometry args={[visualRadius * 1.42, 24, 16]} />
        <meshBasicMaterial color={color} depthWrite={false} opacity={0.16} transparent />
      </mesh>
      <mesh raycast={() => undefined}>
        <sphereGeometry args={[visualRadius, 28, 20]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.18}
          metalness={0.05}
          roughness={0.42}
          transparent
          opacity={0.92}
        />
      </mesh>
      <mesh position={[-visualRadius * 0.28, visualRadius * 0.34, visualRadius * 0.45]} raycast={() => undefined}>
        <sphereGeometry args={[visualRadius * 0.18, 12, 8]} />
        <meshBasicMaterial color="#ffffff" depthWrite={false} opacity={0.48} transparent />
      </mesh>
      <mesh onClick={(e) => e.stopPropagation()} onPointerDown={onPointerDown} visible={false}>
        <sphereGeometry args={[hitRadius, 12, 12]} />
        <meshBasicMaterial depthWrite={false} opacity={0} transparent />
      </mesh>
    </group>
  );
}

export function PoseControls({
  character,
  pose,
  rootGroupRef,
  showPoleControls = true,
  setOrbitEnabled,
  shouldIgnorePointerDown,
}: PoseControlsProps) {
  const dragControlRef = useRef<StickDragControlId | null>(null);
  const dragSessionRef = useRef<DragSession | null>(null);
  const listenersRef = useRef<{ move: (ev: PointerEvent) => void; up: (ev: PointerEvent) => void } | null>(null);
  const poseDragUndoActiveRef = useRef(false);
  const rafFlushRef = useRef(0);
  const pendingPointerRef = useRef<{
    clientX: number;
    clientY: number;
    controlId: StickDragControlId;
    shiftKey: boolean;
  } | null>(null);
  const raycasterRef = useRef(new Raycaster());
  const ndcRef = useRef(new ThreeVector2());

  const { camera, gl } = useThree();
  const updateStickFigureTargets = useEditorStore((s) => s.updateCharacterStickFigureTargets);
  const updateStickFigurePoles = useEditorStore((s) => s.updateCharacterStickFigurePoles);
  const selectCharacter = useEditorStore((s) => s.selectCharacter);
  const selectBodyPart = useEditorStore((s) => s.selectBodyPart);

  const applyPointer = useCallback(
    (clientX: number, clientY: number, controlId: StickDragControlId, shiftKey: boolean) => {
      const group = rootGroupRef.current;
      if (!group) {
        return;
      }
      const session = dragSessionRef.current;
      if (!session || session.controlId !== controlId) {
        return;
      }
      const { viewportRect } = session;
      const ndcX = ((clientX - viewportRect.left) / viewportRect.width) * 2 - 1;
      const ndcY = -((clientY - viewportRect.top) / viewportRect.height) * 2 + 1;
      ndcRef.current.set(ndcX, ndcY);
      const raycaster = raycasterRef.current;
      raycaster.setFromCamera(ndcRef.current, camera);

      const nextMode: DragMode = shiftKey ? "depth" : "plane";
      if (session.mode !== nextMode) {
        const anchor = getSessionControlPosition(session, controlId);
        session.mode = nextMode;
        session.planeAnchor = { x: anchor.x, y: anchor.y, z: anchor.z };
        session.lastClient = { x: clientX, y: clientY };
        const seeded = intersectViewPlaneLocalPoint(group, camera, raycaster.ray, session.planeAnchor);
        session.lastPlanePoint = seeded.point;
        return;
      }

      const anchor = getSessionControlPosition(session, controlId);
      let delta: Vector3;

      if (session.mode === "depth") {
        delta = screenPixelDeltaToCameraDepthLocalDelta(
          group,
          camera,
          anchor,
          clientY - session.lastClient.y,
          viewportRect.height,
        );
        session.lastClient = { x: clientX, y: clientY };
      } else {
        const hit = intersectViewPlaneLocalPoint(group, camera, raycaster.ray, session.planeAnchor);
        if (!hit.point) {
          session.lastClient = { x: clientX, y: clientY };
          return;
        }
        if (!session.lastPlanePoint) {
          session.lastPlanePoint = hit.point;
          session.lastClient = { x: clientX, y: clientY };
          return;
        }
        delta = hit.point.clone().sub(session.lastPlanePoint);
        session.lastPlanePoint = hit.point;
        session.lastClient = { x: clientX, y: clientY };
      }

      if (delta.lengthSq() < 1e-18) {
        return;
      }
      const target = {
        ...anchor,
        x: anchor.x + delta.x,
        y: anchor.y + delta.y,
        z: anchor.z + delta.z,
      };
      if (isPoleControl(controlId)) {
        const patch: StickFigurePolesV1 = { [controlId]: target };
        session.poles = {
          ...session.poles,
          [controlId]: target,
        };
        updateStickFigurePoles(character.id, patch);
      } else {
        const patch: Partial<StickFigureSolveTargets> = { [controlId]: target };
        session.targets = {
          ...session.targets,
          [controlId]: target,
        };
        updateStickFigureTargets(character.id, patch);
      }
    },
    [camera, character.id, rootGroupRef, updateStickFigurePoles, updateStickFigureTargets],
  );

  const flushPendingPointer = useCallback(() => {
    const pending = pendingPointerRef.current;
    pendingPointerRef.current = null;
    if (!pending) {
      return;
    }
    applyPointer(pending.clientX, pending.clientY, pending.controlId, pending.shiftKey);
  }, [applyPointer]);

  const endDrag = useCallback(() => {
    if (rafFlushRef.current !== 0) {
      cancelAnimationFrame(rafFlushRef.current);
      rafFlushRef.current = 0;
    }
    flushPendingPointer();

    dragSessionRef.current = null;
    dragControlRef.current = null;
    if (listenersRef.current) {
      window.removeEventListener("pointermove", listenersRef.current.move);
      window.removeEventListener("pointerup", listenersRef.current.up);
      window.removeEventListener("pointercancel", listenersRef.current.up);
      listenersRef.current = null;
    }
    setOrbitEnabled?.(true);

    if (poseDragUndoActiveRef.current) {
      useEditorStore.getState().endStickFigurePoseDrag();
      poseDragUndoActiveRef.current = false;
    }
  }, [flushPendingPointer, setOrbitEnabled]);

  useEffect(() => () => endDrag(), [endDrag]);

  const onControlPointerDown = useCallback(
    (controlId: StickDragControlId, event: ThreeEvent<PointerEvent>) => {
      if (event.button !== 0) {
        return;
      }
      if (shouldIgnorePointerDown?.(event)) {
        return;
      }
      event.stopPropagation();
      selectCharacter(character.id);
      selectBodyPart(character.id, controlToBodyPart(controlId));
      endDrag();
      dragControlRef.current = controlId;
      {
        const group = rootGroupRef.current;
        const ch0 = useEditorStore.getState().project.scene.characters.find((c) => c.id === character.id);
        if (ch0 && group) {
          const currentPose = getCharacterStickFigurePose(ch0);
          const targets = stickPoseToTargets(currentPose);
          const poles: StickFigurePolesV1 = {
            leftElbowPole: getPosePolePosition(currentPose, "leftElbowPole"),
            rightElbowPole: getPosePolePosition(currentPose, "rightElbowPole"),
            leftKneePole: getPosePolePosition(currentPose, "leftKneePole"),
            rightKneePole: getPosePolePosition(currentPose, "rightKneePole"),
          };
          const t = getDragStartPosition(currentPose, targets, poles, controlId);
          const mode: DragMode = event.nativeEvent.shiftKey ? "depth" : "plane";
          const rect = gl.domElement.getBoundingClientRect();
          ndcRef.current.set(
            ((event.nativeEvent.clientX - rect.left) / rect.width) * 2 - 1,
            -((event.nativeEvent.clientY - rect.top) / rect.height) * 2 + 1,
          );
          raycasterRef.current.setFromCamera(ndcRef.current, camera);
          const planeAnchor = { x: t.x, y: t.y, z: t.z };
          const seeded = intersectViewPlaneLocalPoint(group, camera, raycasterRef.current.ray, planeAnchor);
          dragSessionRef.current = {
            controlId,
            mode,
            targets,
            poles,
            planeAnchor,
            lastPlanePoint: seeded.point,
            lastClient: {
              x: event.nativeEvent.clientX,
              y: event.nativeEvent.clientY,
            },
            viewportRect: {
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
            },
          };
        } else {
          dragSessionRef.current = null;
        }
      }
      setOrbitEnabled?.(false);
      useEditorStore.getState().beginStickFigurePoseDrag();
      poseDragUndoActiveRef.current = true;

      const onMove = (ev: PointerEvent) => {
        if (dragControlRef.current !== controlId) {
          return;
        }
        pendingPointerRef.current = {
          clientX: ev.clientX,
          clientY: ev.clientY,
          controlId,
          shiftKey: ev.shiftKey,
        };
        if (rafFlushRef.current === 0) {
          rafFlushRef.current = requestAnimationFrame(() => {
            rafFlushRef.current = 0;
            const pending = pendingPointerRef.current;
            pendingPointerRef.current = null;
            if (!pending) {
              return;
            }
            applyPointer(pending.clientX, pending.clientY, pending.controlId, pending.shiftKey);
          });
        }
      };
      const onUp = () => {
        endDrag();
      };
      listenersRef.current = { move: onMove, up: onUp };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
      const t = event.nativeEvent.target;
      if (t instanceof Element && "setPointerCapture" in t) {
        t.setPointerCapture(event.pointerId);
      }
    },
    [
      applyPointer,
      camera,
      character.id,
      endDrag,
      gl.domElement,
      rootGroupRef,
      selectBodyPart,
      selectCharacter,
      setOrbitEnabled,
      shouldIgnorePointerDown,
    ],
  );

  const j = pose.joints;
  const poles = {
    leftElbowPole: getPosePolePosition(pose, "leftElbowPole"),
    rightElbowPole: getPosePolePosition(pose, "rightElbowPole"),
    leftKneePole: getPosePolePosition(pose, "leftKneePole"),
    rightKneePole: getPosePolePosition(pose, "rightKneePole"),
  };
  const targetControls = [
    ["pelvis", j.pelvis, 0.13, false],
    ["chest", j.chest, 0.12, false],
    ["head", j.head, 0.12, false],
    ["leftHand", j.leftHand, 0.085, false],
    ["rightHand", j.rightHand, 0.085, false],
    ["leftFoot", j.leftFoot, 0.095, false],
    ["rightFoot", j.rightFoot, 0.095, false],
  ] as const;
  const poleControls = [
    ["leftElbowPole", poles.leftElbowPole, 0.075, true],
    ["rightElbowPole", poles.rightElbowPole, 0.075, true],
    ["leftKneePole", poles.leftKneePole, 0.085, true],
    ["rightKneePole", poles.rightKneePole, 0.085, true],
  ] as const;
  const controls = showPoleControls ? [...targetControls, ...poleControls] : targetControls;

  return (
    <>
      {controls.map(([id, pos, hitRadius, visible]) => {
        const color = id.includes("Knee") ? "#f6c445" : "#b9a7ee";
        const joint = isPoleControl(id) ? j[poleFallbackJoint(id)] : null;

        return (
          <group key={id}>
            {visible && joint ? (
              <PoleGuide color={color} from={joint} to={pos} />
            ) : null}
            {visible ? (
              <PoleHandle
                color={color}
                hitRadius={hitRadius}
                onPointerDown={(e) => onControlPointerDown(id, e)}
                position={pos}
              />
            ) : (
              <mesh
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => onControlPointerDown(id, e)}
                position={[pos.x, pos.y, pos.z]}
                visible={false}
              >
                <sphereGeometry args={[hitRadius, 12, 12]} />
                <meshBasicMaterial depthWrite={false} opacity={0} transparent />
              </mesh>
            )}
          </group>
        );
      })}
    </>
  );
}
