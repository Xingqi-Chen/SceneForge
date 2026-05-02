"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import { Raycaster, Vector2 as ThreeVector2, Vector3, type Group } from "three";

import type { BodyPartId, CharacterSkeleton } from "@/shared/types";
import type { StickFigurePoseV1 } from "@/shared/types/stick-figure-pose";

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
  | "rightFoot";

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
  return "rightFoot";
}

type PoseControlsProps = {
  character: CharacterSkeleton;
  pose: StickFigurePoseV1;
  rootGroupRef: RefObject<Group | null>;
  setOrbitEnabled?: (enabled: boolean) => void;
  shouldIgnorePointerDown?: (event: ThreeEvent<PointerEvent>) => boolean;
};

type DragMode = "plane" | "depth";

type DragSession = {
  controlId: StickDragControlId;
  mode: DragMode;
  targets: StickFigureSolveTargets;
  planeAnchor: { x: number; y: number; z: number };
  lastPlanePoint: Vector3 | null;
  lastClient: { x: number; y: number };
  viewportRect: { left: number; top: number; width: number; height: number };
};

export function PoseControls({
  character,
  pose,
  rootGroupRef,
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
        const anchor = session.targets[controlId];
        session.mode = nextMode;
        session.planeAnchor = { x: anchor.x, y: anchor.y, z: anchor.z };
        session.lastClient = { x: clientX, y: clientY };
        const seeded = intersectViewPlaneLocalPoint(group, camera, raycaster.ray, session.planeAnchor);
        session.lastPlanePoint = seeded.point;
        return;
      }

      const anchor = session.targets[controlId];
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
      const patch: Partial<StickFigureSolveTargets> = { [controlId]: target };
      session.targets = {
        ...session.targets,
        [controlId]: target,
      };
      updateStickFigureTargets(character.id, patch);
    },
    [camera, character.id, rootGroupRef, updateStickFigureTargets],
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
          const targets = stickPoseToTargets(getCharacterStickFigurePose(ch0));
          const t = targets[controlId];
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
  const controls = [
    ["pelvis", j.pelvis, 0.13],
    ["chest", j.chest, 0.12],
    ["head", j.head, 0.12],
    ["leftHand", j.leftHand, 0.085],
    ["rightHand", j.rightHand, 0.085],
    ["leftFoot", j.leftFoot, 0.095],
    ["rightFoot", j.rightFoot, 0.095],
  ] as const;

  return (
    <>
      {controls.map(([id, pos, hitRadius]) => (
        <mesh
          key={id}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => onControlPointerDown(id, e)}
          position={[pos.x, pos.y, pos.z]}
          visible={false}
        >
          <sphereGeometry args={[hitRadius, 12, 12]} />
          <meshBasicMaterial depthWrite={false} opacity={0} transparent />
        </mesh>
      ))}
    </>
  );
}
