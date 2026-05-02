import { describe, expect, it } from "vitest";

import { getCharacterMannequinPose } from "@/features/editor/character-mannequin-pose";
import { CHARACTER_3D_POSE_PRESETS } from "@/features/editor/character-3d-pose-presets";
import { defaultCharacter } from "@/features/editor/store/defaults";

describe("character 3d pose presets", () => {
  it.each(CHARACTER_3D_POSE_PRESETS.map((preset) => [preset.id, preset] as const))(
    "preset %s yields a finite mannequin pose with ordered bounds",
    (_id, preset) => {
      const character = { ...defaultCharacter, joints3D: preset.buildJoints3D() };
      const pose = getCharacterMannequinPose(character);
      expect(Number.isFinite(pose.bounds.minY)).toBe(true);
      expect(Number.isFinite(pose.bounds.maxY)).toBe(true);
      expect(pose.bounds.maxY).toBeGreaterThan(pose.bounds.minY);
    },
  );
});
