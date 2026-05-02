import type { CharacterSkeleton } from "@/shared/types";

import { createDefaultStickFigurePoseV1 } from "@/features/editor/store/defaults";

export function getCharacterStickFigurePose(character: CharacterSkeleton) {
  return character.stickFigurePose3D ?? createDefaultStickFigurePoseV1();
}
