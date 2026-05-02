import { describe, expect, it } from "vitest";

import {
  buildLimbLengthLockSpheres,
  constrainJointPositionToLimbLengthSpheres,
  isJointEligibleForLimbLengthLock,
} from "./character-limb-length-lock";
import { defaultCharacterMannequinJoints3D } from "./store/defaults";

describe("character-limb-length-lock", () => {
  it("marks limb joints eligible and excludes torso chain", () => {
    expect(isJointEligibleForLimbLengthLock("leftElbow")).toBe(true);
    expect(isJointEligibleForLimbLengthLock("neck")).toBe(false);
    expect(isJointEligibleForLimbLengthLock("hip")).toBe(false);
  });

  it("builds one sphere for wrist drag", () => {
    const joints = { ...defaultCharacterMannequinJoints3D };
    const s = buildLimbLengthLockSpheres(joints, "leftWrist");

    expect(s).not.toBeNull();
    expect(s!.centers.length).toBe(1);
    expect(s!.radii[0]).toBeGreaterThan(0.01);
  });

  it("projects candidate onto sphere preserving distance to anchor", () => {
    const center = { x: 0, y: 0, z: 0 };
    const r = 2;
    const spheres = { centers: [center], radii: [r] };
    const p = { x: 10, y: 0, z: 0 };
    const out = constrainJointPositionToLimbLengthSpheres(p, spheres);
    const d = Math.sqrt((out.x - center.x) ** 2 + (out.y - center.y) ** 2 + (out.z - center.z) ** 2);

    expect(d).toBeCloseTo(r, 5);
  });
});
