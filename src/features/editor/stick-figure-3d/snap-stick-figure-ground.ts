import type { SceneObject3DTransform, Vector3 } from "@/shared/types";
import type { StickFigurePoseV1 } from "@/shared/types/stick-figure-pose";

/** Lowest Y used for grounding the character root (root-local stick space). */
export function stickFigureBoundsMinY(pose: StickFigurePoseV1): number {
  const j = pose.joints;
  const footPad = 0.06;
  const ys = [
    j.leftFoot.y - footPad,
    j.rightFoot.y - footPad,
    j.pelvis.y - 0.14,
    j.head.y - 0.16,
  ];
  return Math.min(...ys);
}

export function stickFigureBoundsMaxY(pose: StickFigurePoseV1): number {
  const j = pose.joints;
  const ys = [
    j.head.y + 0.14,
    j.chest.y + 0.1,
    j.leftHand.y + 0.06,
    j.rightHand.y + 0.06,
  ];
  return Math.max(...ys);
}

export function stickFigureVerticalBounds(pose: StickFigurePoseV1): { minY: number; maxY: number } {
  return { minY: stickFigureBoundsMinY(pose), maxY: stickFigureBoundsMaxY(pose) };
}

export function snapCharacterTransformToStickFigureGround(
  pose: StickFigurePoseV1,
  transform: SceneObject3DTransform,
): SceneObject3DTransform {
  const scaledMinY = stickFigureBoundsMinY(pose) * transform.scale.y;
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

export function vec3FromStick(v: { x: number; y: number; z: number }): Vector3 {
  return { x: v.x, y: v.y, z: v.z };
}
