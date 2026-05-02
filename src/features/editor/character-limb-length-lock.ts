import type { JointId, Vector3 } from "@/shared/types";

import { CHARACTER_SKELETON_BODY_PART_SEGMENTS } from "./character-skeleton";

/** 参与「锁死骨长」的关节：四肢端点链，不含颈/脊柱/骨盆。 */
const LIMB_LENGTH_LOCK_JOINT_IDS = new Set<JointId>([
  "leftShoulder",
  "leftElbow",
  "leftWrist",
  "rightShoulder",
  "rightElbow",
  "rightWrist",
  "leftKnee",
  "leftAnkle",
  "rightKnee",
  "rightAnkle",
]);

export function isJointEligibleForLimbLengthLock(jointId: JointId): boolean {
  return LIMB_LENGTH_LOCK_JOINT_IDS.has(jointId);
}

function dist3(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;

  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function cloneV(v: Vector3): Vector3 {
  return { x: v.x, y: v.y, z: v.z };
}

export type LimbLengthLockSpheres = {
  /** 拖拽开始时另一端关节位置（冻结），与 `radii` 一一对应。 */
  centers: Vector3[];
  radii: number[];
};

/**
 * 根据当前 `joints3D` 为被拖拽关节构造球面约束：每段四肢骨在拖拽中保持与对端距离不变。
 * 躯干（`torso`）段不参与。
 */
export function buildLimbLengthLockSpheres(
  joints: Record<JointId, Vector3>,
  draggedJointId: JointId,
): LimbLengthLockSpheres | null {
  if (!isJointEligibleForLimbLengthLock(draggedJointId)) {
    return null;
  }

  const centers: Vector3[] = [];
  const radii: number[] = [];

  for (const [bodyPartId, from, to] of CHARACTER_SKELETON_BODY_PART_SEGMENTS) {
    if (bodyPartId === "torso") {
      continue;
    }

    if (to === draggedJointId) {
      const anchor = cloneV(joints[from]);
      const dragged = joints[draggedJointId];
      centers.push(anchor);
      radii.push(dist3(anchor, dragged));
    } else if (from === draggedJointId) {
      const anchor = cloneV(joints[to]);
      const dragged = joints[draggedJointId];
      centers.push(anchor);
      radii.push(dist3(anchor, dragged));
    }
  }

  return centers.length > 0 ? { centers, radii } : null;
}

function projectToSphere(center: Vector3, radius: number, p: Vector3): Vector3 {
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  const dz = p.z - center.z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);

  if (len < 1e-10) {
    return { x: center.x + radius, y: center.y, z: center.z };
  }

  const s = radius / len;

  return {
    x: center.x + dx * s,
    y: center.y + dy * s,
    z: center.z + dz * s,
  };
}

/**
 * 将候选位置反复投影到多个球面交上（松弛迭代），用于肘/膝等两段骨同时约束。
 */
export function constrainJointPositionToLimbLengthSpheres(
  candidate: Vector3,
  spheres: LimbLengthLockSpheres | null,
): Vector3 {
  if (!spheres || spheres.centers.length === 0) {
    return cloneV(candidate);
  }

  let q = cloneV(candidate);

  for (let iter = 0; iter < 14; iter++) {
    for (let i = 0; i < spheres.centers.length; i++) {
      q = projectToSphere(spheres.centers[i], spheres.radii[i], q);
    }
  }

  return q;
}
