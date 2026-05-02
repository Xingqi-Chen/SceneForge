import { Vector3 } from "three";

import type { StickFigurePoseV1, StickFigureVec3 } from "@/shared/types/stick-figure-pose";

import { solveTwoBoneIk } from "./IKSolver";
import { STICK_BONE_LENGTHS, cloneVec3, emptyStickJoints } from "./SkeletonModel";

const EPS = 1e-6;

function toV3(p: StickFigureVec3): Vector3 {
  return new Vector3(p.x, p.y, p.z);
}

function fromV3(v: Vector3): StickFigureVec3 {
  return { x: v.x, y: v.y, z: v.z };
}

function clampToward(from: StickFigureVec3, toward: StickFigureVec3, maxLen: number): StickFigureVec3 {
  const d = new Vector3().subVectors(toV3(toward), toV3(from));
  const len = d.length();
  if (len < EPS) {
    return { ...from, y: from.y + maxLen };
  }
  if (len <= maxLen) {
    return { ...toward };
  }
  d.multiplyScalar(maxLen / len);
  return fromV3(toV3(from).clone().add(d));
}

type Basis = { up: Vector3; right: Vector3; forward: Vector3 };

function torsoBasis(pelvis: StickFigureVec3, chest: StickFigureVec3): Basis {
  const up = new Vector3().subVectors(toV3(chest), toV3(pelvis));
  if (up.lengthSq() < EPS * EPS) {
    up.set(0, 1, 0);
  } else {
    up.normalize();
  }
  const aux = new Vector3(0, 0, 1);
  if (Math.abs(up.dot(aux)) > 0.95) {
    aux.set(1, 0, 0);
  }
  const right = new Vector3().crossVectors(up, aux).normalize();
  const forward = new Vector3().crossVectors(right, up).normalize();
  return { up, right, forward };
}

function offsetChest(
  chest: StickFigureVec3,
  basis: Basis,
  lateral: number,
  alongUp: number,
): StickFigureVec3 {
  const c = toV3(chest);
  c.addScaledVector(basis.right, lateral);
  c.addScaledVector(basis.up, alongUp);
  return fromV3(c);
}

export type StickFigureSolveTargets = {
  pelvis: StickFigureVec3;
  chest: StickFigureVec3;
  head: StickFigureVec3;
  leftHand: StickFigureVec3;
  rightHand: StickFigureVec3;
  leftFoot: StickFigureVec3;
  rightFoot: StickFigureVec3;
};

function guessMidOnChain(
  root: StickFigureVec3,
  target: StickFigureVec3,
  len0: number,
): StickFigureVec3 {
  const dir = new Vector3().subVectors(toV3(target), toV3(root));
  const d = dir.length();
  if (d < EPS) {
    return fromV3(toV3(root).clone().add(new Vector3(0, len0 * 0.5, 0)));
  }
  dir.multiplyScalar(Math.min(len0, d * 0.45) / d);
  return fromV3(toV3(root).clone().add(dir));
}

/**
 * Full-body solve: torso FK with length clamps, analytic two-bone IK arms and legs.
 * `previous` supplies warm starts for elbow/knee when dragging.
 */
export function solveStickFigurePose(
  targets: StickFigureSolveTargets,
  previous?: StickFigurePoseV1 | null,
  poles?: StickFigurePoseV1["poles"],
): StickFigurePoseV1 {
  const { spinePelvisToChest, neckChestToHead, upperArm, forearm, thigh, shin, shoulderLateral, shoulderAlongUp, hipLateral, hipAlongUp } =
    STICK_BONE_LENGTHS;

  const pelvis = cloneVec3(targets.pelvis);
  const chest = clampToward(pelvis, targets.chest, spinePelvisToChest);
  const head = clampToward(chest, targets.head, neckChestToHead);

  const basis = torsoBasis(pelvis, chest);

  const leftShoulder = offsetChest(chest, basis, -shoulderLateral, shoulderAlongUp);
  const rightShoulder = offsetChest(chest, basis, shoulderLateral, shoulderAlongUp);

  const leftHip = fromV3(
    toV3(pelvis).clone().addScaledVector(basis.right, -hipLateral).addScaledVector(basis.up, hipAlongUp),
  );
  const rightHip = fromV3(
    toV3(pelvis).clone().addScaledVector(basis.right, hipLateral).addScaledVector(basis.up, hipAlongUp),
  );

  const prev = previous?.joints;

  const leftElbow0 = prev?.leftElbow ?? guessMidOnChain(leftShoulder, targets.leftHand, upperArm);
  const leftHand0 = prev?.leftHand ?? targets.leftHand;
  const leftArm = solveTwoBoneIk(
    leftShoulder,
    leftElbow0,
    leftHand0,
    targets.leftHand,
    upperArm,
    forearm,
    poles?.leftElbowPole,
  );

  const rightElbow0 = prev?.rightElbow ?? guessMidOnChain(rightShoulder, targets.rightHand, upperArm);
  const rightHand0 = prev?.rightHand ?? targets.rightHand;
  const rightArm = solveTwoBoneIk(
    rightShoulder,
    rightElbow0,
    rightHand0,
    targets.rightHand,
    upperArm,
    forearm,
    poles?.rightElbowPole,
  );

  const leftKnee0 = prev?.leftKnee ?? guessMidOnChain(leftHip, targets.leftFoot, thigh);
  const leftFoot0 = prev?.leftFoot ?? targets.leftFoot;
  const leftLeg = solveTwoBoneIk(leftHip, leftKnee0, leftFoot0, targets.leftFoot, thigh, shin, poles?.leftKneePole);

  const rightKnee0 = prev?.rightKnee ?? guessMidOnChain(rightHip, targets.rightFoot, thigh);
  const rightFoot0 = prev?.rightFoot ?? targets.rightFoot;
  const rightLeg = solveTwoBoneIk(
    rightHip,
    rightKnee0,
    rightFoot0,
    targets.rightFoot,
    thigh,
    shin,
    poles?.rightKneePole,
  );

  const joints = emptyStickJoints();
  joints.pelvis = pelvis;
  joints.chest = chest;
  joints.head = head;
  joints.leftShoulder = leftArm.root;
  joints.leftElbow = leftArm.mid;
  joints.leftHand = leftArm.end;
  joints.rightShoulder = rightArm.root;
  joints.rightElbow = rightArm.mid;
  joints.rightHand = rightArm.end;
  joints.leftHip = leftLeg.root;
  joints.leftKnee = leftLeg.mid;
  joints.leftFoot = leftLeg.end;
  joints.rightHip = rightLeg.root;
  joints.rightKnee = rightLeg.mid;
  joints.rightFoot = rightLeg.end;

  return {
    version: 1,
    joints,
    ...(poles ? { poles: { ...poles } } : {}),
  };
}

/** Derive IK targets from an existing solved pose (for dragging from current configuration). */
export function stickPoseToTargets(pose: StickFigurePoseV1): StickFigureSolveTargets {
  const { joints } = pose;
  return {
    pelvis: cloneVec3(joints.pelvis),
    chest: cloneVec3(joints.chest),
    head: cloneVec3(joints.head),
    leftHand: cloneVec3(joints.leftHand),
    rightHand: cloneVec3(joints.rightHand),
    leftFoot: cloneVec3(joints.leftFoot),
    rightFoot: cloneVec3(joints.rightFoot),
  };
}

export function mergeTargets(
  base: StickFigureSolveTargets,
  patch: Partial<StickFigureSolveTargets>,
): StickFigureSolveTargets {
  return {
    pelvis: patch.pelvis ? cloneVec3(patch.pelvis) : cloneVec3(base.pelvis),
    chest: patch.chest ? cloneVec3(patch.chest) : cloneVec3(base.chest),
    head: patch.head ? cloneVec3(patch.head) : cloneVec3(base.head),
    leftHand: patch.leftHand ? cloneVec3(patch.leftHand) : cloneVec3(base.leftHand),
    rightHand: patch.rightHand ? cloneVec3(patch.rightHand) : cloneVec3(base.rightHand),
    leftFoot: patch.leftFoot ? cloneVec3(patch.leftFoot) : cloneVec3(base.leftFoot),
    rightFoot: patch.rightFoot ? cloneVec3(patch.rightFoot) : cloneVec3(base.rightFoot),
  };
}
