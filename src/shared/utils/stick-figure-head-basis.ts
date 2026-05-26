import { Euler, Vector3 as ThreeVector3 } from "three";

import type { Vector3 } from "@/shared/types";
import type { StickFigurePoseV1, StickFigureVec3 } from "@/shared/types/stick-figure-pose";

const DEG2RAD = Math.PI / 180;
const HEAD_BASIS_EPSILON = 0.0001;
const DEFAULT_HEAD_ROTATION: Vector3 = { x: 0, y: 0, z: 0 };

export type StickFigureHeadOffset = {
  x: number;
  y: number;
  z?: number;
};

export type StickFigureHeadBasis = {
  forward: ThreeVector3;
  head: ThreeVector3;
  neck: ThreeVector3;
  right: ThreeVector3;
  scale: number;
  up: ThreeVector3;
};

function degreeToRadians(value: number) {
  return value * DEG2RAD;
}

function toThreeVec3(value: StickFigureVec3) {
  return new ThreeVector3(value.x, value.y, value.z);
}

function normalizedOrFallback(value: ThreeVector3, fallback: ThreeVector3) {
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y) || !Number.isFinite(value.z)) {
    return fallback.clone().normalize();
  }

  if (value.lengthSq() < HEAD_BASIS_EPSILON) {
    return fallback.clone().normalize();
  }

  return value.clone().normalize();
}

export function resolveStickFigureHeadBasis(pose: StickFigurePoseV1): StickFigureHeadBasis {
  const joints = pose.joints;
  const leftShoulder = toThreeVec3(joints.leftShoulder);
  const rightShoulder = toThreeVec3(joints.rightShoulder);
  const chest = toThreeVec3(joints.chest);
  const head = toThreeVec3(joints.head);
  const shoulderMidpoint = leftShoulder.clone().add(rightShoulder).multiplyScalar(0.5);
  const neck = leftShoulder.distanceToSquared(rightShoulder) > HEAD_BASIS_EPSILON
    ? shoulderMidpoint
    : chest;
  const up = normalizedOrFallback(head.clone().sub(neck), new ThreeVector3(0, 1, 0));
  const rightRaw = rightShoulder.clone().sub(leftShoulder);
  const rightWithoutUp = rightRaw.clone().sub(up.clone().multiplyScalar(rightRaw.dot(up)));
  const initialRight = normalizedOrFallback(rightWithoutUp, new ThreeVector3(1, 0, 0));
  const forward = normalizedOrFallback(new ThreeVector3().crossVectors(initialRight, up), new ThreeVector3(0, 0, 1));
  const right = normalizedOrFallback(new ThreeVector3().crossVectors(up, forward), initialRight);
  const headToNeck = Math.max(0.08, head.distanceTo(neck));
  const scale = Math.max(0.045, Math.min(0.18, headToNeck * 0.44));

  return {
    forward,
    head,
    neck,
    right,
    scale,
    up,
  };
}

export function rotateStickFigureHeadOffset(
  offset: StickFigureHeadOffset,
  rotation: Vector3 | undefined,
) {
  const safeRotation = rotation ?? DEFAULT_HEAD_ROTATION;
  const euler = new Euler(
    degreeToRadians(safeRotation.x),
    degreeToRadians(safeRotation.y),
    degreeToRadians(safeRotation.z),
    "XYZ",
  );

  return new ThreeVector3(offset.x, offset.y, offset.z ?? 0).applyEuler(euler);
}

export function resolveStickFigureHeadPoint(
  basis: StickFigureHeadBasis,
  offset: StickFigureHeadOffset,
  rotation: Vector3 | undefined,
) {
  const rotated = rotateStickFigureHeadOffset(offset, rotation);

  return basis.head.clone()
    .addScaledVector(basis.right, rotated.x * basis.scale)
    .addScaledVector(basis.up, rotated.y * basis.scale)
    .addScaledVector(basis.forward, rotated.z * basis.scale);
}
