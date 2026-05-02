import type { CharacterSkeleton } from "@/shared/types";

/**
 * 2D 画布与 3D 视口的人体列表相互隔离：
 * - `characterSpace === "2d"`：仅出现在 2D Konva 舞台
 * - `characterSpace === "3d"`：仅出现在 Three 视口
 * - 未设置（旧项目）：两个视口都显示，保持兼容
 */
export function characterAppearsOn2dCanvas(character: CharacterSkeleton): boolean {
  return character.characterSpace !== "3d";
}

export function characterAppearsInThreeViewport(character: CharacterSkeleton): boolean {
  return character.characterSpace !== "2d";
}
