import { describe, expect, it } from "vitest";

import { defaultCharacter, defaultCharacterMannequinJointPlane } from "./store/defaults";
import {
  getCharacterMannequinPose,
  mannequinPlaneCoordsFromLocalXY,
  snapCharacterTransformToMannequinGround,
} from "./character-mannequin-pose";
import type { JointId } from "@/shared/types";

describe("character mannequin pose", () => {
  it("projects default mannequin joint plane into segments", () => {
    const pose = getCharacterMannequinPose(defaultCharacter);
    const leftUpperArm = pose.segments.find((segment) => segment.bodyPartId === "leftUpperArm");

    expect(pose.joints.hip).toEqual({ x: 0, y: 1.07, z: 0 });
    expect(pose.joints.neck.y).toBeCloseTo(1.82, 3);
    expect(leftUpperArm?.height).toBeGreaterThan(0.4);
    expect(leftUpperArm?.position[0]).toBeLessThan(-0.5);
    expect(pose.bounds.minY).toBeGreaterThanOrEqual(0);
  });

  it("does not use 2D joints for 3D mannequin when joints3D is unset", () => {
    const raised2DOnly = {
      ...defaultCharacter,
      joints: {
        ...defaultCharacter.joints,
        leftElbow: { x: -96, y: 48 },
      },
    };

    const defaultPose = getCharacterMannequinPose(defaultCharacter);
    const poseAfter2DEdit = getCharacterMannequinPose(raised2DOnly);

    expect(poseAfter2DEdit).toEqual(defaultPose);
  });

  it("round-trips authoring plane coords through local XY (joints3D)", () => {
    const plane = { ...defaultCharacterMannequinJointPlane };
    const character = { ...defaultCharacter, joints3D: plane };
    const pose = getCharacterMannequinPose(character);

    for (const jointId of Object.keys(plane) as JointId[]) {
      const local = pose.joints[jointId];
      const back = mannequinPlaneCoordsFromLocalXY(plane, local.x, local.y);

      expect(back.x).toBeCloseTo(plane[jointId].x, 5);
      expect(back.y).toBeCloseTo(plane[jointId].y, 5);
    }
  });

  it("uses joints3D for mannequin when set", () => {
    const with3D = {
      ...defaultCharacter,
      joints: {
        ...defaultCharacter.joints,
        leftElbow: { x: -96, y: 48 },
      },
      joints3D: {
        ...defaultCharacterMannequinJointPlane,
        leftElbow: { x: -96, y: 48, z: 0 },
      },
    };

    const defaultPose = getCharacterMannequinPose(defaultCharacter);
    const raisedPose = getCharacterMannequinPose(with3D);
    const defaultUpperArm = defaultPose.segments.find((segment) => segment.bodyPartId === "leftUpperArm");
    const raisedUpperArm = raisedPose.segments.find((segment) => segment.bodyPartId === "leftUpperArm");

    expect(raisedUpperArm?.height).toBeGreaterThan(defaultUpperArm?.height ?? 0);
    expect(raisedUpperArm?.rotation).not.toEqual(defaultUpperArm?.rotation);
  });

  it("anchors torso boxes along Z from hips through chest when neck depth differs from hip", () => {
    const character = {
      ...defaultCharacter,
      joints3D: {
        ...defaultCharacterMannequinJointPlane,
        hip: { ...defaultCharacterMannequinJointPlane.hip, z: 0 },
        neck: { ...defaultCharacterMannequinJointPlane.neck, z: 0.35 },
      },
    };
    const pose = getCharacterMannequinPose(character);

    expect(pose.torso.pelvis.position[2]).toBeCloseTo(0, 5);
    expect(pose.torso.chest.position[2]).toBeGreaterThan(0.1);
    expect(pose.torso.abdomen.position[2]).toBeCloseTo(
      (pose.torso.pelvis.position[2] + pose.torso.chest.position[2]) / 2,
      5,
    );
  });

  it("snaps scaled mannequin feet to the ground using joints3D", () => {
    const crouched = {
      ...defaultCharacter,
      joints3D: {
        ...defaultCharacterMannequinJointPlane,
        leftAnkle: { x: -32, y: 360, z: 0.04 },
        rightAnkle: { x: 32, y: 360, z: 0.04 },
      },
    };
    const transform = {
      position: { x: 1, y: 2, z: -1 },
      rotation: { x: 0, y: 15, z: 0 },
      scale: { x: 1, y: 2, z: 1 },
    };

    const snapped = snapCharacterTransformToMannequinGround(crouched, transform);

    expect(snapped.position.x).toBe(1);
    expect(snapped.position.z).toBe(-1);
    expect(snapped.position.y).toBeGreaterThan(0);
    expect(snapped.rotation).toEqual(transform.rotation);
    expect(snapped.scale).toEqual(transform.scale);
  });
});
