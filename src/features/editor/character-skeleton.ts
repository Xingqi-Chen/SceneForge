import type { BodyPartId, JointId } from "@/shared/types";

export const CHARACTER_SKELETON_BODY_PART_SEGMENTS = [
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
] as const satisfies ReadonlyArray<readonly [BodyPartId, JointId, JointId]>;

export const CHARACTER_JOINT_BODY_PART_MAP: Partial<Record<JointId, BodyPartId>> = {
  neck: "head",
  leftWrist: "leftHand",
  rightWrist: "rightHand",
  leftAnkle: "leftFoot",
  rightAnkle: "rightFoot",
};
