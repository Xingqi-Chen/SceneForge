import { describe, expect, it } from "vitest";

import { STICK_FIGURE_POSE_PRESETS } from "./PosePresets";

describe("PosePresets", () => {
  it.each(STICK_FIGURE_POSE_PRESETS.map((p) => [p.id] as const))("preset %s builds valid stick pose", (id) => {
    const preset = STICK_FIGURE_POSE_PRESETS.find((p) => p.id === id);
    expect(preset).toBeDefined();
    const pose = preset!.buildPose();
    expect(pose.version).toBe(1);
    expect(Number.isFinite(pose.joints.pelvis.y)).toBe(true);
    expect(Number.isFinite(pose.joints.leftHand.x)).toBe(true);
    expect(Number.isFinite(pose.joints.leftFoot.y)).toBe(true);
  });
});
