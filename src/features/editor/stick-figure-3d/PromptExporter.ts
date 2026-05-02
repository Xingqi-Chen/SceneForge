import type { StickFigurePoseV1 } from "@/shared/types/stick-figure-pose";

/** Short natural-language pose summary for AI / prompt preview (English + Chinese fragment). */
export function stickFigurePoseToPromptSnippet(pose: StickFigurePoseV1): string {
  const j = pose.joints;
  const torsoLean =
    j.chest.z - j.pelvis.z > 0.12
      ? "torso leaning forward / 上身前倾"
      : j.chest.z - j.pelvis.z < -0.08
        ? "torso leaning back / 上身后仰"
        : "upright torso / 躯干直立";
  const armSpan = Math.abs(j.leftHand.x - j.rightHand.x);
  const arms =
    armSpan > 1.1
      ? "arms spread wide (T-like) / 双臂平展"
      : armSpan < 0.35 && j.leftHand.y < j.chest.y + 0.15 && j.rightHand.y < j.chest.y + 0.15
        ? "arms low or crossed-ish / 手臂靠身前"
        : "arms mid pose / 手臂自然姿势";
  const sitHint = j.pelvis.y < 0.95 ? "seated or low hip height / 低骨盆（坐姿或蹲低）" : "standing height / 站姿高度";
  const feet = Math.abs(j.leftFoot.x - j.rightFoot.x) < 0.15 ? "feet together-ish / 双脚靠近" : "feet apart / 双脚分开";

  return [
    "3D stick figure pose (approximate):",
    torsoLean,
    arms,
    sitHint,
    feet,
    `head at y≈${j.head.y.toFixed(2)} / 头部高度约 ${j.head.y.toFixed(2)}`,
  ].join(" ");
}
