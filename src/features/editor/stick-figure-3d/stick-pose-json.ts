import { createDefaultStickFigurePoseV1 } from "@/features/editor/store/defaults";
import { getCharacterStickFigurePose } from "@/features/editor/stick-figure-3d/get-character-stick-pose";
import { sanitizeStickFigurePoseV1 } from "@/features/editor/stick-figure-3d/stick-figure-pose-io";
import type { CharacterSkeleton } from "@/shared/types";
import type { StickFigurePoseV1 } from "@/shared/types/stick-figure-pose";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function exportStickPoseJsonString(character: CharacterSkeleton): string {
  const pose = getCharacterStickFigurePose(character);
  return JSON.stringify(
    {
      version: "sceneforge-stick-pose-v1",
      stickFigurePose3D: pose,
    },
    null,
    2,
  );
}

export function importStickPoseFromJsonString(json: string): StickFigurePoseV1 | null {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!isRecord(parsed)) {
      return null;
    }
    const rawPose = parsed.stickFigurePose3D ?? parsed.stickFigurePose;
    if (!rawPose) {
      return null;
    }
    return sanitizeStickFigurePoseV1(rawPose, createDefaultStickFigurePoseV1());
  } catch {
    console.warn("[SceneForge] [editor] invalid stick pose JSON");
    return null;
  }
}
