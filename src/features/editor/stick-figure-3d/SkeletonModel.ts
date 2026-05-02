import type { StickFigureJointId, StickFigureVec3 } from "@/shared/types/stick-figure-pose";

/** Fixed bone lengths (meters). Never mutated at runtime. */
export const STICK_BONE_LENGTHS = {
  spinePelvisToChest: 0.42,
  neckChestToHead: 0.26,
  upperArm: 0.28,
  forearm: 0.26,
  thigh: 0.44,
  shin: 0.4,
  /** Lateral offset chest → shoulder along character right axis. */
  shoulderLateral: 0.19,
  /** Slight vertical offset shoulder from chest along torso up. */
  shoulderAlongUp: 0.06,
  /** Pelvis → hip along lateral axis. */
  hipLateral: 0.1,
  hipAlongUp: 0.02,
} as const;

export const STICK_JOINT_IDS: readonly StickFigureJointId[] = [
  "pelvis",
  "chest",
  "head",
  "leftShoulder",
  "leftElbow",
  "leftHand",
  "rightShoulder",
  "rightElbow",
  "rightHand",
  "leftHip",
  "leftKnee",
  "leftFoot",
  "rightHip",
  "rightKnee",
  "rightFoot",
] as const;

export function maxReach(len0: number, len1: number): number {
  return len0 + len1;
}

export function cloneVec3(v: StickFigureVec3): StickFigureVec3 {
  return { x: v.x, y: v.y, z: v.z };
}

export function emptyStickJoints(): Record<StickFigureJointId, StickFigureVec3> {
  const z = { x: 0, y: 0, z: 0 };
  return Object.fromEntries(STICK_JOINT_IDS.map((id) => [id, { ...z }])) as Record<
    StickFigureJointId,
    StickFigureVec3
  >;
}
