import { describe, expect, it } from "vitest";

import { STICK_BONE_LENGTHS } from "./SkeletonModel";
import { mergeTargets, solveStickFigurePose, stickPoseToTargets } from "./solveStickFigurePose";

describe("solveStickFigurePose", () => {
  it("keeps leg bone lengths when foot target is unreachable", () => {
    const base = {
      pelvis: { x: 0, y: 1.05, z: 0 },
      chest: { x: 0, y: 1.45, z: 0 },
      head: { x: 0, y: 1.72, z: 0 },
      leftHand: { x: -0.55, y: 1.5, z: 0 },
      rightHand: { x: 0.55, y: 1.5, z: 0 },
      leftFoot: { x: -0.15, y: 0.02, z: 0 },
      rightFoot: { x: 0.15, y: 0.02, z: 0 },
    };
    const farFoot = mergeTargets(base, {
      leftFoot: { x: -0.15, y: -2, z: 0 },
    });
    const pose = solveStickFigurePose(farFoot, null, undefined);
    const thigh = STICK_BONE_LENGTHS.thigh;
    const shin = STICK_BONE_LENGTHS.shin;
    const d0 = dist(pose.joints.leftHip, pose.joints.leftKnee);
    const d1 = dist(pose.joints.leftKnee, pose.joints.leftFoot);
    expect(Math.abs(d0 - thigh)).toBeLessThan(0.04);
    expect(Math.abs(d1 - shin)).toBeLessThan(0.04);
  });

  it("round-trips targets through stickPoseToTargets", () => {
    const targets = {
      pelvis: { x: 0, y: 1.05, z: 0 },
      chest: { x: 0, y: 1.45, z: 0 },
      head: { x: 0, y: 1.7, z: 0 },
      leftHand: { x: -0.5, y: 1.48, z: 0.02 },
      rightHand: { x: 0.5, y: 1.48, z: 0.02 },
      leftFoot: { x: -0.12, y: 0.04, z: 0.05 },
      rightFoot: { x: 0.12, y: 0.04, z: 0.05 },
    };
    const pose = solveStickFigurePose(targets, null, undefined);
    const again = stickPoseToTargets(pose);
    expect(again.pelvis.x).toBeCloseTo(pose.joints.pelvis.x, 4);
    expect(again.leftHand.x).toBeCloseTo(pose.joints.leftHand.x, 4);
  });

  it("keeps shoulders and hips on the local left-right axis for upright torsos", () => {
    const pose = solveStickFigurePose(
      {
        pelvis: { x: 0, y: 1.05, z: 0 },
        chest: { x: 0, y: 1.45, z: 0 },
        head: { x: 0, y: 1.7, z: 0 },
        leftHand: { x: -0.5, y: 1.48, z: 0 },
        rightHand: { x: 0.5, y: 1.48, z: 0 },
        leftFoot: { x: -0.12, y: 0.04, z: 0 },
        rightFoot: { x: 0.12, y: 0.04, z: 0 },
      },
      null,
      undefined,
    );

    expect(pose.joints.leftShoulder.x).toBeLessThan(pose.joints.chest.x);
    expect(pose.joints.rightShoulder.x).toBeGreaterThan(pose.joints.chest.x);
    expect(Math.abs(pose.joints.leftShoulder.z - pose.joints.rightShoulder.z)).toBeLessThan(1e-6);
    expect(pose.joints.leftHip.x).toBeLessThan(pose.joints.pelvis.x);
    expect(pose.joints.rightHip.x).toBeGreaterThan(pose.joints.pelvis.x);
  });

  it("uses pole controls as continuous bend directions", () => {
    const targets = {
      pelvis: { x: 0, y: 1.05, z: 0 },
      chest: { x: 0, y: 1.45, z: 0 },
      head: { x: 0, y: 1.7, z: 0 },
      leftHand: { x: -0.5, y: 1.48, z: 0 },
      rightHand: { x: 0.5, y: 1.48, z: 0 },
      leftFoot: { x: -0.12, y: 0.45, z: 0 },
      rightFoot: { x: 0.12, y: 0.04, z: 0 },
    };

    const forward = solveStickFigurePose(targets, null, {
      leftKneePole: { x: -0.12, y: 0.6, z: 1 },
    });
    const backward = solveStickFigurePose(targets, forward, {
      leftKneePole: { x: -0.12, y: 0.6, z: -1 },
    });

    expect(forward.joints.leftKnee.z).toBeGreaterThan(0.1);
    expect(backward.joints.leftKnee.z).toBeLessThan(-0.1);
  });
});

function dist(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
