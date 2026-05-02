import { Euler, Quaternion, Vector3 as ThreeVector3 } from "three";

import type { BodyPartId, CharacterSkeleton, JointId, SceneObject3DTransform, Vector2, Vector3 } from "@/shared/types";

import { CHARACTER_SKELETON_BODY_PART_SEGMENTS } from "./character-skeleton";
import { defaultCharacterMannequinJoints3D } from "./store/defaults";

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
  /** Unity 风格：Hips / Spine / Chest 三段躯干，尺寸随肩宽与关节推导。 */
  torso: {
    pelvis: { position: [number, number, number]; size: [number, number, number] };
    abdomen: { position: [number, number, number]; size: [number, number, number] };
    chest: { position: [number, number, number]; size: [number, number, number] };
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
const jointScaleX = 0.011;
const jointScaleY = (mannequinNeckY - mannequinHipY) / (148 - 24);
const headRadius = 0.185;
const handRadius = 0.095;
const footSize: [number, number, number] = [0.22, 0.11, 0.36];

function getMannequinAuthoringJoints(character: CharacterSkeleton): Record<JointId, Vector3> {
  return character.joints3D ?? defaultCharacterMannequinJoints3D;
}

function to3DJointFromAuthoring(plane: Record<JointId, Vector3>, jointId: JointId): MannequinJointPose {
  const joint = plane[jointId];
  const hip = plane.hip;

  return {
    x: (joint.x - hip.x) * jointScaleX,
    y: mannequinHipY - (joint.y - hip.y) * jointScaleY,
    z: joint.z,
  };
}

/**
 * Inverse of the XY part of `to3DJointFromAuthoring`: maps mannequin root–local X/Y (e.g. ray hit on z=0 plane)
 * back to authoring-plane x/y. Caller merges with existing joint `.z`.
 */
export function mannequinPlaneCoordsFromLocalXY(
  plane: Record<JointId, Vector3>,
  localX: number,
  localY: number,
): Vector2 {
  const hip = plane.hip;

  return {
    x: hip.x + localX / jointScaleX,
    y: hip.y + (mannequinHipY - localY) / jointScaleY,
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
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const height = Math.max(0.05, dist);

  if (dist < 1e-8) {
    return {
      bodyPartId,
      from,
      to,
      height,
      position: [start.x, start.y, start.z],
      rotation: [0, 0, 0],
    };
  }

  const len = dist;
  const dir = new ThreeVector3(dx / len, dy / len, dz / len);
  const quaternion = new Quaternion().setFromUnitVectors(new ThreeVector3(0, 1, 0), dir);
  const euler = new Euler().setFromQuaternion(quaternion, "YXZ");

  return {
    bodyPartId,
    from,
    to,
    height,
    position: [(start.x + end.x) / 2, (start.y + end.y) / 2, (start.z + end.z) / 2],
    rotation: [euler.x, euler.y, euler.z],
  };
}

function getMinY(values: number[]) {
  return Math.min(...values);
}

function getMaxY(values: number[]) {
  return Math.max(...values);
}

export function getCharacterMannequinPose(character: CharacterSkeleton): CharacterMannequinPose {
  const plane = getMannequinAuthoringJoints(character);
  const joints = Object.fromEntries(
    (Object.keys(plane) as JointId[]).map((jointId) => [jointId, to3DJointFromAuthoring(plane, jointId)]),
  ) as Record<JointId, MannequinJointPose>;

  const segments = CHARACTER_SKELETON_BODY_PART_SEGMENTS.map(([bodyPartId, from, to]) =>
    getSegmentPose(joints, bodyPartId, from, to),
  );
  const leftShoulder = joints.leftShoulder;
  const rightShoulder = joints.rightShoulder;
  const neck = joints.neck;
  const spine = joints.spine;
  const hip = joints.hip;
  const shoulderCenter = {
    x: (leftShoulder.x + rightShoulder.x) / 2,
    y: (leftShoulder.y + rightShoulder.y) / 2,
    z: (leftShoulder.z + rightShoulder.z) / 2,
  };
  const shoulderWidth = Math.max(0.48, Math.abs(rightShoulder.x - leftShoulder.x) + 0.18);
  const torsoSpan = Math.max(0.48, shoulderCenter.y - hip.y);
  const pelvisH = Math.min(0.26, Math.max(0.2, torsoSpan * 0.22));
  const pelvisTop = hip.y + pelvisH;
  const spineCeiling = shoulderCenter.y - 0.06;
  const spineSpan = Math.max(0.18, spineCeiling - pelvisTop);
  const split01 = 0.44;
  const abdomenTop = pelvisTop + spineSpan * split01;
  const abdomenCenterYBase = (pelvisTop + abdomenTop) / 2;
  const abdomenCenterY = spine.y * 0.52 + abdomenCenterYBase * 0.48;
  const chestCenterY = (abdomenTop + spineCeiling) / 2;
  const abdomenH = Math.max(0.14, abdomenTop - pelvisTop);
  const chestH = Math.max(0.22, spineCeiling - abdomenTop);
  const chestW = Math.max(0.46, shoulderWidth * 1.02);
  const abdomenW = Math.max(0.42, shoulderWidth * 0.9);
  const pelvisW = Math.max(0.44, shoulderWidth * 0.96);
  /** 与 X 轴混合一致：骨盆跟髋、胸腔跟上肢带；Z 分段避免整块躯干与髋/颈深度错位（沿 Z 移动关节时散架）。 */
  const pelvisZ = hip.z;
  const chestZ = neck.z * 0.45 + shoulderCenter.z * 0.55;
  const abdomenZ = (pelvisZ + chestZ) / 2;
  const chestD = 0.34;
  const abdomenD = 0.33;
  const pelvisD = 0.36;

  /** 每只脚单独跟对应踝关节，避免共用 min(踝 Y) 时在拖动一侧踝时另一只脚与小腿脱节。 */
  const footAnkleDrop = 0.025;

  const pose: CharacterMannequinPose = {
    joints,
    segments,
    head: {
      position: [neck.x, neck.y + 0.22, neck.z + 0.015],
      radius: headRadius,
    },
    torso: {
      pelvis: {
        position: [hip.x, hip.y + pelvisH * 0.5, pelvisZ],
        size: [pelvisW, pelvisH, pelvisD],
      },
      abdomen: {
        position: [
          shoulderCenter.x * 0.3 + hip.x * 0.5 + spine.x * 0.2,
          abdomenCenterY,
          abdomenZ,
        ],
        size: [abdomenW, abdomenH, abdomenD],
      },
      chest: {
        position: [shoulderCenter.x, chestCenterY + 0.02, chestZ],
        size: [chestW, chestH, chestD],
      },
    },
    hands: {
      leftHand: { position: tuple(joints.leftWrist), radius: handRadius },
      rightHand: { position: tuple(joints.rightWrist), radius: handRadius },
    },
    feet: {
      leftFoot: {
        position: [joints.leftAnkle.x, joints.leftAnkle.y - footAnkleDrop, joints.leftAnkle.z + 0.14],
        size: footSize,
      },
      rightFoot: {
        position: [joints.rightAnkle.x, joints.rightAnkle.y - footAnkleDrop, joints.rightAnkle.z + 0.14],
        size: footSize,
      },
    },
    bounds: {
      minY: 0,
      maxY: 0,
    },
  };

  const torsoBoxes = [pose.torso.pelvis, pose.torso.abdomen, pose.torso.chest];
  const bottomCandidates = [
    ...Object.values(joints).map((joint) => joint.y - 0.1),
    pose.head.position[1] - pose.head.radius,
    pose.feet.leftFoot.position[1] - footSize[1] / 2,
    pose.feet.rightFoot.position[1] - footSize[1] / 2,
    ...torsoBoxes.map((box) => box.position[1] - box.size[1] / 2),
  ];
  const topCandidates = [
    ...Object.values(joints).map((joint) => joint.y + 0.1),
    pose.head.position[1] + pose.head.radius,
    pose.feet.leftFoot.position[1] + footSize[1] / 2,
    pose.feet.rightFoot.position[1] + footSize[1] / 2,
    ...torsoBoxes.map((box) => box.position[1] + box.size[1] / 2),
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
