import type { BodyPartId, CharacterSkeleton, JointId, SceneObject3DTransform, Vector2, Vector3 } from "@/shared/types";

import { CHARACTER_SKELETON_BODY_PART_SEGMENTS } from "./character-skeleton";
import { defaultCharacterMannequinJointPlane } from "./store/defaults";

export type MannequinJointPose = Vector3;

export type MannequinSegmentPose = {
  bodyPartId: BodyPartId;
  from: JointId;
  to: JointId;
  height: number;
  position: [number, number, number];
  rotation: [number, number, number];
};

export type CharacterMannequinPose = {
  joints: Record<JointId, MannequinJointPose>;
  segments: MannequinSegmentPose[];
  head: {
    position: [number, number, number];
    radius: number;
  };
  torso: {
    position: [number, number, number];
    size: [number, number, number];
    waistPosition: [number, number, number];
    waistSize: [number, number, number];
  };
  hands: Record<"leftHand" | "rightHand", { position: [number, number, number]; radius: number }>;
  feet: Record<"leftFoot" | "rightFoot", { position: [number, number, number]; size: [number, number, number] }>;
  bounds: {
    minY: number;
    maxY: number;
  };
};

const mannequinHipY = 1.07;
const mannequinNeckY = 1.82;
const mannequinDepth = 0.02;
const jointScaleX = 0.011;
const jointScaleY = (mannequinNeckY - mannequinHipY) / (148 - 24);
const headRadius = 0.25;
const handRadius = 0.095;
const footSize: [number, number, number] = [0.22, 0.11, 0.36];

function getMannequinAuthoringPlane(character: CharacterSkeleton): Record<JointId, Vector2> {
  return character.joints3D ?? defaultCharacterMannequinJointPlane;
}

function to3DJointFromPlane(plane: Record<JointId, Vector2>, jointId: JointId): MannequinJointPose {
  const joint = plane[jointId];
  const hip = plane.hip;

  return {
    x: (joint.x - hip.x) * jointScaleX,
    y: mannequinHipY - (joint.y - hip.y) * jointScaleY,
    z: jointId.endsWith("Wrist") || jointId.endsWith("Ankle") ? mannequinDepth * 2 : 0,
  };
}

function tuple(point: Vector3): [number, number, number] {
  return [point.x, point.y, point.z];
}

function getSegmentPose(
  joints: Record<JointId, MannequinJointPose>,
  bodyPartId: BodyPartId,
  from: JointId,
  to: JointId,
): MannequinSegmentPose {
  const start = joints[from];
  const end = joints[to];
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dz = end.z - start.z;
  const height = Math.max(0.05, Math.sqrt(dx * dx + dy * dy + dz * dz));

  return {
    bodyPartId,
    from,
    to,
    height,
    position: [(start.x + end.x) / 2, (start.y + end.y) / 2, (start.z + end.z) / 2],
    rotation: [0, 0, Math.atan2(-dx, dy)],
  };
}

function getMinY(values: number[]) {
  return Math.min(...values);
}

function getMaxY(values: number[]) {
  return Math.max(...values);
}

export function getCharacterMannequinPose(character: CharacterSkeleton): CharacterMannequinPose {
  const plane = getMannequinAuthoringPlane(character);
  const joints = Object.fromEntries(
    (Object.keys(plane) as JointId[]).map((jointId) => [jointId, to3DJointFromPlane(plane, jointId)]),
  ) as Record<JointId, MannequinJointPose>;

  const segments = CHARACTER_SKELETON_BODY_PART_SEGMENTS.map(([bodyPartId, from, to]) =>
    getSegmentPose(joints, bodyPartId, from, to),
  );
  const leftShoulder = joints.leftShoulder;
  const rightShoulder = joints.rightShoulder;
  const neck = joints.neck;
  const hip = joints.hip;
  const shoulderCenter = {
    x: (leftShoulder.x + rightShoulder.x) / 2,
    y: (leftShoulder.y + rightShoulder.y) / 2,
    z: 0,
  };
  const shoulderWidth = Math.max(0.48, Math.abs(rightShoulder.x - leftShoulder.x) + 0.18);
  const torsoHeight = Math.max(0.48, Math.abs(shoulderCenter.y - hip.y) + 0.22);
  const torsoCenterY = (shoulderCenter.y + hip.y) / 2;
  const footY = Math.min(joints.leftAnkle.y, joints.rightAnkle.y) - 0.025;

  const pose: CharacterMannequinPose = {
    joints,
    segments,
    head: {
      position: [neck.x, neck.y + 0.3, 0.02],
      radius: headRadius,
    },
    torso: {
      position: [shoulderCenter.x, torsoCenterY + 0.04, 0],
      size: [shoulderWidth, torsoHeight, 0.32],
      waistPosition: [hip.x, hip.y + 0.03, 0],
      waistSize: [Math.max(0.44, shoulderWidth * 0.82), 0.24, 0.34],
    },
    hands: {
      leftHand: { position: tuple(joints.leftWrist), radius: handRadius },
      rightHand: { position: tuple(joints.rightWrist), radius: handRadius },
    },
    feet: {
      leftFoot: {
        position: [joints.leftAnkle.x, footY, 0.14],
        size: footSize,
      },
      rightFoot: {
        position: [joints.rightAnkle.x, footY, 0.14],
        size: footSize,
      },
    },
    bounds: {
      minY: 0,
      maxY: 0,
    },
  };

  const bottomCandidates = [
    ...Object.values(joints).map((joint) => joint.y - 0.1),
    pose.head.position[1] - pose.head.radius,
    pose.feet.leftFoot.position[1] - footSize[1] / 2,
    pose.feet.rightFoot.position[1] - footSize[1] / 2,
  ];
  const topCandidates = [
    ...Object.values(joints).map((joint) => joint.y + 0.1),
    pose.head.position[1] + pose.head.radius,
    pose.feet.leftFoot.position[1] + footSize[1] / 2,
    pose.feet.rightFoot.position[1] + footSize[1] / 2,
  ];

  return {
    ...pose,
    bounds: {
      minY: getMinY(bottomCandidates),
      maxY: getMaxY(topCandidates),
    },
  };
}

export function snapCharacterTransformToMannequinGround(
  character: CharacterSkeleton,
  transform: SceneObject3DTransform,
): SceneObject3DTransform {
  const pose = getCharacterMannequinPose(character);
  const scaledMinY = pose.bounds.minY * transform.scale.y;
  const snappedY = Math.abs(scaledMinY) < 0.01 ? 0 : Number((-scaledMinY).toFixed(3));

  return {
    position: {
      ...transform.position,
      y: snappedY,
    },
    rotation: { ...transform.rotation },
    scale: { ...transform.scale },
  };
}
