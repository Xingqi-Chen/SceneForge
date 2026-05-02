import type { JointId, Vector3 } from "@/shared/types";

import { defaultCharacterMannequinJoints3D } from "@/features/editor/store/defaults";

export type Character3DPosePresetId =
  | "pose-t-stand"
  | "pose-relaxed"
  | "pose-hands-hips"
  | "pose-arms-up"
  | "pose-running"
  | "pose-sitting"
  | "pose-arms-forward"
  | "pose-wave"
  | "pose-heart-hands"
  | "pose-shy"
  | "pose-battle-ready"
  | "pose-iai-draw"
  | "pose-kneeling"
  | "pose-squat"
  | "pose-jump"
  | "pose-point-up"
  | "pose-cross-arms"
  | "pose-looking-back"
  | "pose-magic-cast"
  | "pose-idol";

export type Character3DPosePreset = {
  id: Character3DPosePresetId;
  /** 简短中文名，用于属性面板按钮。 */
  label: string;
  buildJoints3D: () => Record<JointId, Vector3>;
};

function cloneDefaultJoints3D(): Record<JointId, Vector3> {
  return Object.fromEntries(
    (Object.keys(defaultCharacterMannequinJoints3D) as JointId[]).map((id) => [
      id,
      { ...defaultCharacterMannequinJoints3D[id] },
    ]),
  ) as Record<JointId, Vector3>;
}

function mergeJoints3D(overrides: Partial<Record<JointId, Vector3>>): Record<JointId, Vector3> {
  const base = cloneDefaultJoints3D();

  for (const id of Object.keys(overrides) as JointId[]) {
    const next = overrides[id];
    if (next) {
      base[id] = { ...base[id], ...next };
    }
  }

  if (!Object.prototype.hasOwnProperty.call(overrides, "spine")) {
    const { neck, hip } = base;
    base.spine = {
      x: (neck.x + hip.x) * 0.5,
      y: (neck.y + hip.y) * 0.5,
      z: (neck.z + hip.z) * 0.5,
    };
  }

  return base;
}

/**
 * 内置 3D 低模人体姿态预设。
 *
 * 坐标约定：
 * - x：左右方向，负数为角色左侧，正数为角色右侧。
 * - y：竖直方向，数值越大越靠下。
 * - z：前后深度，正数表示向角色前方。
 *
 * 这些姿势针对“球体关节 + 圆柱骨骼”的低模 mannequin 优化。
 * 设计重点：
 * - 避免手腕穿过身体。
 * - 避免膝盖过度外扩。
 * - 坐姿通过 z 轴表现“大腿向前”，不要只在 x/y 平面里做成蹲姿。
 * - 站姿保持重心稳定，减少夸张八字腿。
 */
export const CHARACTER_3D_POSE_PRESETS: Character3DPosePreset[] = [
  {
    id: "pose-t-stand",
    label: "T 型站姿",
    /** 标准 T-pose：躯干竖直、肩膀平、双臂水平展开、双腿自然分开。 */
    buildJoints3D: () =>
      mergeJoints3D({
        hip: { x: 0, y: 148, z: 0 },
        spine: { x: 0, y: 86, z: 0 },
        neck: { x: 0, y: 24, z: 0 },

        leftShoulder: { x: -38, y: 46, z: 0 },
        rightShoulder: { x: 38, y: 46, z: 0 },

        leftElbow: { x: -82, y: 48, z: 0 },
        rightElbow: { x: 82, y: 48, z: 0 },
        leftWrist: { x: -125, y: 50, z: 0 },
        rightWrist: { x: 125, y: 50, z: 0 },

        leftKnee: { x: -22, y: 230, z: 0 },
        rightKnee: { x: 22, y: 230, z: 0 },
        leftAnkle: { x: -24, y: 310, z: 0.02 },
        rightAnkle: { x: 24, y: 310, z: 0.02 },
      }),
  },
  {
    id: "pose-relaxed",
    label: "自然站立",
    /** 自然 A-pose：手臂轻微下垂、身体放松、腿部轻微分开。 */
    buildJoints3D: () =>
      mergeJoints3D({
        hip: { x: 0, y: 148, z: 0 },
        spine: { x: 0, y: 86, z: 0.01 },
        neck: { x: 0, y: 24, z: 0.01 },

        leftShoulder: { x: -36, y: 48, z: 0 },
        rightShoulder: { x: 36, y: 48, z: 0 },

        leftElbow: { x: -56, y: 112, z: 0.02 },
        rightElbow: { x: 56, y: 112, z: 0.02 },
        leftWrist: { x: -52, y: 178, z: 0.08 },
        rightWrist: { x: 52, y: 178, z: 0.08 },

        leftKnee: { x: -20, y: 230, z: 0 },
        rightKnee: { x: 20, y: 230, z: 0 },
        leftAnkle: { x: -26, y: 310, z: 0.04 },
        rightAnkle: { x: 26, y: 310, z: 0.04 },
      }),
  },
  {
    id: "pose-hands-hips",
    label: "双手叉腰",
    /** 双手叉腰：肘部外展，手腕落在髋部两侧，胸部略微挺起。 */
    buildJoints3D: () =>
      mergeJoints3D({
        hip: { x: 0, y: 148, z: 0 },
        spine: { x: 0, y: 84, z: -0.02 },
        neck: { x: 0, y: 22, z: -0.02 },

        leftShoulder: { x: -38, y: 46, z: -0.01 },
        rightShoulder: { x: 38, y: 46, z: -0.01 },

        leftElbow: { x: -82, y: 102, z: -0.04 },
        rightElbow: { x: 82, y: 102, z: -0.04 },

        leftWrist: { x: -34, y: 144, z: 0.08 },
        rightWrist: { x: 34, y: 144, z: 0.08 },

        leftKnee: { x: -22, y: 230, z: 0 },
        rightKnee: { x: 22, y: 230, z: 0 },
        leftAnkle: { x: -28, y: 310, z: 0.04 },
        rightAnkle: { x: 28, y: 310, z: 0.04 },
      }),
  },
  {
    id: "pose-arms-up",
    label: "双臂上举",
    /** 双臂上举：肩膀上提，手臂向上伸展，肘部保留轻微弯曲，避免木偶感。 */
    buildJoints3D: () =>
      mergeJoints3D({
        hip: { x: 0, y: 148, z: 0 },
        spine: { x: 0, y: 84, z: 0 },
        neck: { x: 0, y: 22, z: 0 },

        leftShoulder: { x: -36, y: 44, z: 0 },
        rightShoulder: { x: 36, y: 44, z: 0 },

        leftElbow: { x: -48, y: 4, z: 0.02 },
        rightElbow: { x: 48, y: 4, z: 0.02 },

        leftWrist: { x: -42, y: -38, z: 0.06 },
        rightWrist: { x: 42, y: -38, z: 0.06 },

        leftKnee: { x: -20, y: 230, z: 0 },
        rightKnee: { x: 20, y: 230, z: 0 },
        leftAnkle: { x: -24, y: 310, z: 0.04 },
        rightAnkle: { x: 24, y: 310, z: 0.04 },
      }),
  },
  {
    id: "pose-running",
    label: "奔跑",
    /** 奔跑：躯干前倾，右腿前摆，左腿后蹬，双臂与腿部形成反向摆动。 */
    buildJoints3D: () =>
      mergeJoints3D({
        hip: { x: 2, y: 148, z: 0.04 },
        spine: { x: 8, y: 88, z: 0.1 },
        neck: { x: 12, y: 26, z: 0.14 },

        leftShoulder: { x: -30, y: 46, z: 0.08 },
        rightShoulder: { x: 44, y: 48, z: 0.08 },

        // 左臂前摆，靠近胸前
        leftElbow: { x: -48, y: 86, z: 0.24 },
        leftWrist: { x: -28, y: 122, z: 0.34 },

        // 右臂后摆
        rightElbow: { x: 66, y: 104, z: -0.08 },
        rightWrist: { x: 76, y: 158, z: -0.1 },

        // 左腿作为后蹬腿：向后、向下伸展
        leftKnee: { x: -30, y: 228, z: -0.12 },
        leftAnkle: { x: -46, y: 306, z: -0.2 },

        // 右腿作为前摆腿：膝盖抬起并向前
        rightKnee: { x: 42, y: 194, z: 0.36 },
        rightAnkle: { x: 54, y: 260, z: 0.46 },
      }),
  },
  {
    id: "pose-sitting",
    label: "坐姿",
    /** 正坐：髋部下沉，大腿向前，小腿向下，双脚平放，双手自然放在大腿附近。 */
    buildJoints3D: () =>
      mergeJoints3D({
        hip: { x: 0, y: 176, z: 0.02 },
        spine: { x: 0, y: 118, z: 0.04 },
        neck: { x: 0, y: 58, z: 0.06 },

        leftShoulder: { x: -34, y: 82, z: 0.04 },
        rightShoulder: { x: 34, y: 82, z: 0.04 },

        leftElbow: { x: -42, y: 128, z: 0.12 },
        rightElbow: { x: 42, y: 128, z: 0.12 },

        leftWrist: { x: -36, y: 164, z: 0.28 },
        rightWrist: { x: 36, y: 164, z: 0.28 },

        // 关键：坐姿不是蹲姿，膝盖需要明显向前
        leftKnee: { x: -34, y: 198, z: 0.42 },
        rightKnee: { x: 34, y: 198, z: 0.42 },

        // 小腿向下，脚踝比膝盖略低，z 保持接近，形成坐姿腿部结构
        leftAnkle: { x: -32, y: 286, z: 0.46 },
        rightAnkle: { x: 32, y: 286, z: 0.46 },
      }),
  },
  {
    id: "pose-arms-forward",
    label: "双臂前伸",
    /** 双臂前伸：肩膀微微前送，肘部轻微弯曲，手腕向前，适合够取/推门/僵尸步。 */
    buildJoints3D: () =>
      mergeJoints3D({
        hip: { x: 0, y: 148, z: 0 },
        spine: { x: 0, y: 86, z: 0.08 },
        neck: { x: 0, y: 24, z: 0.08 },

        leftShoulder: { x: -34, y: 48, z: 0.1 },
        rightShoulder: { x: 34, y: 48, z: 0.1 },

        leftElbow: { x: -30, y: 92, z: 0.34 },
        rightElbow: { x: 30, y: 92, z: 0.34 },

        leftWrist: { x: -24, y: 132, z: 0.62 },
        rightWrist: { x: 24, y: 132, z: 0.62 },

        leftKnee: { x: -22, y: 230, z: 0 },
        rightKnee: { x: 22, y: 230, z: 0 },
        leftAnkle: { x: -26, y: 310, z: 0.04 },
        rightAnkle: { x: 26, y: 310, z: 0.04 },
      }),
  },
  {
    id: "pose-wave",
    label: "挥手",
    /** 二次元常见打招呼：一只手举起挥手，另一只手自然下垂。 */
    buildJoints3D: () =>
      mergeJoints3D({
        hip: { x: 0, y: 148, z: 0 },
        spine: { x: -2, y: 86, z: 0.01 },
        neck: { x: -4, y: 24, z: 0.02 },

        leftShoulder: { x: -36, y: 48, z: 0 },
        rightShoulder: { x: 36, y: 48, z: 0 },

        // 左手自然下垂
        leftElbow: { x: -56, y: 116, z: 0.02 },
        leftWrist: { x: -52, y: 180, z: 0.08 },

        // 右手抬起挥手
        rightElbow: { x: 68, y: 28, z: 0.08 },
        rightWrist: { x: 82, y: -18, z: 0.12 },

        leftKnee: { x: -20, y: 230, z: 0 },
        rightKnee: { x: 22, y: 230, z: 0.02 },
        leftAnkle: { x: -26, y: 310, z: 0.04 },
        rightAnkle: { x: 28, y: 310, z: 0.06 },
      }),
  },
  {
    id: "pose-heart-hands",
    label: "双手比心",
    /** 双手在胸前靠拢，适合可爱/偶像风姿势。 */
    buildJoints3D: () =>
      mergeJoints3D({
        hip: { x: 0, y: 148, z: 0 },
        spine: { x: 0, y: 84, z: 0.02 },
        neck: { x: 0, y: 24, z: 0.03 },

        leftShoulder: { x: -36, y: 48, z: 0.02 },
        rightShoulder: { x: 36, y: 48, z: 0.02 },

        leftElbow: { x: -54, y: 96, z: 0.18 },
        rightElbow: { x: 54, y: 96, z: 0.18 },

        // 双手靠近胸前
        leftWrist: { x: -12, y: 104, z: 0.34 },
        rightWrist: { x: 12, y: 104, z: 0.34 },

        leftKnee: { x: -18, y: 230, z: 0 },
        rightKnee: { x: 24, y: 228, z: 0.02 },
        leftAnkle: { x: -28, y: 310, z: 0.04 },
        rightAnkle: { x: 26, y: 310, z: 0.06 },
      }),
  },
  {
    id: "pose-shy",
    label: "害羞内扣",
    /** 害羞站姿：身体微缩，双手靠胸前，膝盖内扣。 */
    buildJoints3D: () =>
      mergeJoints3D({
        hip: { x: 0, y: 150, z: 0.02 },
        spine: { x: 0, y: 90, z: 0.04 },
        neck: { x: -2, y: 30, z: 0.06 },

        leftShoulder: { x: -30, y: 54, z: 0.04 },
        rightShoulder: { x: 30, y: 54, z: 0.04 },

        leftElbow: { x: -38, y: 102, z: 0.14 },
        rightElbow: { x: 38, y: 102, z: 0.14 },

        leftWrist: { x: -14, y: 132, z: 0.26 },
        rightWrist: { x: 14, y: 132, z: 0.26 },

        // 膝盖轻微内扣
        leftKnee: { x: -10, y: 230, z: 0.02 },
        rightKnee: { x: 10, y: 230, z: 0.02 },
        leftAnkle: { x: -30, y: 310, z: 0.06 },
        rightAnkle: { x: 30, y: 310, z: 0.06 },
      }),
  },
  {
    id: "pose-battle-ready",
    label: "战斗架势",
    /** 热血战斗站姿：重心降低，一手前伸防御，一手后收蓄力。 */
    buildJoints3D: () =>
      mergeJoints3D({
        hip: { x: 0, y: 160, z: 0.04 },
        spine: { x: 8, y: 96, z: 0.1 },
        neck: { x: 12, y: 34, z: 0.12 },

        leftShoulder: { x: -28, y: 56, z: 0.08 },
        rightShoulder: { x: 48, y: 58, z: 0.06 },

        // 左手前伸
        leftElbow: { x: -36, y: 104, z: 0.32 },
        leftWrist: { x: -30, y: 138, z: 0.58 },

        // 右手后收
        rightElbow: { x: 72, y: 112, z: -0.08 },
        rightWrist: { x: 56, y: 148, z: -0.14 },

        // 前后弓步
        leftKnee: { x: -42, y: 222, z: 0.34 },
        leftAnkle: { x: -52, y: 302, z: 0.44 },

        rightKnee: { x: 36, y: 236, z: -0.16 },
        rightAnkle: { x: 52, y: 312, z: -0.24 },
      }),
  },
  {
    id: "pose-iai-draw",
    label: "居合拔刀",
    /** 居合准备：身体压低，一手在刀柄位置，一手向侧后蓄势。 */
    buildJoints3D: () =>
      mergeJoints3D({
        hip: { x: 0, y: 166, z: 0.04 },
        spine: { x: 10, y: 106, z: 0.08 },
        neck: { x: 18, y: 48, z: 0.12 },

        leftShoulder: { x: -24, y: 72, z: 0.04 },
        rightShoulder: { x: 54, y: 76, z: 0.04 },

        // 左手压在腰间，模拟按住刀鞘
        leftElbow: { x: -48, y: 124, z: 0.06 },
        leftWrist: { x: -30, y: 156, z: 0.16 },

        // 右手向侧后拉，模拟拔刀前动作
        rightElbow: { x: 82, y: 120, z: -0.04 },
        rightWrist: { x: 112, y: 142, z: -0.08 },

        // 低身弓步
        leftKnee: { x: -48, y: 224, z: 0.3 },
        leftAnkle: { x: -58, y: 304, z: 0.38 },

        rightKnee: { x: 36, y: 238, z: -0.14 },
        rightAnkle: { x: 62, y: 312, z: -0.2 },
      }),
  },
  {
    id: "pose-kneeling",
    label: "单膝跪地",
    /** 单膝跪地：一条腿支撑，另一条腿跪下，适合剧情/宣誓/受伤姿势。 */
    buildJoints3D: () =>
      mergeJoints3D({
        hip: { x: 0, y: 176, z: 0.04 },
        spine: { x: 0, y: 108, z: 0.04 },
        neck: { x: 0, y: 46, z: 0.06 },

        leftShoulder: { x: -34, y: 72, z: 0.04 },
        rightShoulder: { x: 34, y: 72, z: 0.04 },

        leftElbow: { x: -44, y: 128, z: 0.18 },
        rightElbow: { x: 44, y: 128, z: 0.18 },
        leftWrist: { x: -36, y: 164, z: 0.28 },
        rightWrist: { x: 36, y: 164, z: 0.28 },

        // 左腿前方支撑
        leftKnee: { x: -34, y: 220, z: 0.42 },
        leftAnkle: { x: -38, y: 302, z: 0.46 },

        // 右腿跪地向后
        rightKnee: { x: 34, y: 294, z: -0.08 },
        rightAnkle: { x: 58, y: 312, z: -0.34 },
      }),
  },
  {
    id: "pose-squat",
    label: "蹲姿",
    /** 蹲下观察/休息姿势：髋部下沉，膝盖弯曲，手部靠近膝盖。 */
    buildJoints3D: () =>
      mergeJoints3D({
        hip: { x: 0, y: 202, z: 0.08 },
        spine: { x: 0, y: 142, z: 0.12 },
        neck: { x: 0, y: 82, z: 0.16 },

        leftShoulder: { x: -34, y: 106, z: 0.1 },
        rightShoulder: { x: 34, y: 106, z: 0.1 },

        leftElbow: { x: -44, y: 158, z: 0.24 },
        rightElbow: { x: 44, y: 158, z: 0.24 },
        leftWrist: { x: -42, y: 202, z: 0.34 },
        rightWrist: { x: 42, y: 202, z: 0.34 },

        leftKnee: { x: -48, y: 236, z: 0.28 },
        rightKnee: { x: 48, y: 236, z: 0.28 },
        leftAnkle: { x: -36, y: 310, z: 0.12 },
        rightAnkle: { x: 36, y: 310, z: 0.12 },
      }),
  },
  {
    id: "pose-jump",
    label: "跳跃",
    /** 动漫跳跃姿势：身体上提，一腿后弯，一腿前摆，双臂张开。 */
    buildJoints3D: () =>
      mergeJoints3D({
        hip: { x: 0, y: 118, z: 0.04 },
        spine: { x: 0, y: 64, z: 0.04 },
        neck: { x: 0, y: 10, z: 0.04 },

        leftShoulder: { x: -38, y: 34, z: 0.02 },
        rightShoulder: { x: 38, y: 34, z: 0.02 },

        leftElbow: { x: -78, y: 16, z: 0.06 },
        rightElbow: { x: 78, y: 16, z: 0.06 },
        leftWrist: { x: -104, y: 0, z: 0.1 },
        rightWrist: { x: 104, y: 0, z: 0.1 },

        // 左腿前摆
        leftKnee: { x: -34, y: 170, z: 0.34 },
        leftAnkle: { x: -46, y: 234, z: 0.42 },

        // 右腿后弯
        rightKnee: { x: 38, y: 182, z: -0.2 },
        rightAnkle: { x: 62, y: 144, z: -0.34 },
      }),
  },
  {
    id: "pose-point-up",
    label: "单手指天",
    /** 热血主角式单手指天：一手高举，另一手叉腰。 */
    buildJoints3D: () =>
      mergeJoints3D({
        hip: { x: 0, y: 148, z: 0 },
        spine: { x: 2, y: 84, z: -0.01 },
        neck: { x: 4, y: 22, z: -0.01 },

        leftShoulder: { x: -36, y: 46, z: 0 },
        rightShoulder: { x: 38, y: 44, z: 0 },

        // 左手叉腰
        leftElbow: { x: -76, y: 104, z: -0.04 },
        leftWrist: { x: -34, y: 146, z: 0.08 },

        // 右手向上指
        rightElbow: { x: 52, y: 0, z: 0.02 },
        rightWrist: { x: 58, y: -48, z: 0.04 },

        leftKnee: { x: -22, y: 230, z: 0 },
        rightKnee: { x: 24, y: 230, z: 0.02 },
        leftAnkle: { x: -30, y: 310, z: 0.04 },
        rightAnkle: { x: 26, y: 310, z: 0.06 },
      }),
  },
  {
    id: "pose-cross-arms",
    label: "双手抱胸",
    /** 冷酷/自信站姿：双臂交叉在胸前。 */
    buildJoints3D: () =>
      mergeJoints3D({
        hip: { x: 0, y: 148, z: 0 },
        spine: { x: 0, y: 84, z: -0.02 },
        neck: { x: 0, y: 22, z: -0.02 },

        leftShoulder: { x: -38, y: 48, z: 0 },
        rightShoulder: { x: 38, y: 48, z: 0 },

        leftElbow: { x: -52, y: 96, z: 0.16 },
        rightElbow: { x: 52, y: 96, z: 0.16 },

        // 手腕交叉到身体另一侧
        leftWrist: { x: 24, y: 104, z: 0.28 },
        rightWrist: { x: -24, y: 104, z: 0.28 },

        leftKnee: { x: -22, y: 230, z: 0 },
        rightKnee: { x: 22, y: 230, z: 0 },
        leftAnkle: { x: -28, y: 310, z: 0.04 },
        rightAnkle: { x: 28, y: 310, z: 0.04 },
      }),
  },
  {
    id: "pose-looking-back",
    label: "回头站姿",
    /** 回头感站姿：身体侧重心，肩髋略错位，用于背影/回眸构图。 */
    buildJoints3D: () =>
      mergeJoints3D({
        hip: { x: 4, y: 148, z: -0.02 },
        spine: { x: -2, y: 86, z: 0.04 },
        neck: { x: -10, y: 24, z: 0.08 },

        leftShoulder: { x: -42, y: 48, z: 0.08 },
        rightShoulder: { x: 30, y: 48, z: -0.04 },

        leftElbow: { x: -58, y: 114, z: 0.12 },
        leftWrist: { x: -44, y: 178, z: 0.18 },

        rightElbow: { x: 48, y: 118, z: -0.08 },
        rightWrist: { x: 46, y: 180, z: -0.08 },

        // 重心偏右，左腿稍微后收
        leftKnee: { x: -18, y: 232, z: -0.06 },
        leftAnkle: { x: -18, y: 310, z: -0.08 },
        rightKnee: { x: 26, y: 228, z: 0.06 },
        rightAnkle: { x: 34, y: 310, z: 0.08 },
      }),
  },
  {
    id: "pose-magic-cast",
    label: "魔法施法",
    /** 魔法少女/法师施法：一手前伸，一手侧后展开，身体略后仰。 */
    buildJoints3D: () =>
      mergeJoints3D({
        hip: { x: 0, y: 148, z: 0.02 },
        spine: { x: -4, y: 84, z: -0.02 },
        neck: { x: -6, y: 22, z: -0.02 },

        leftShoulder: { x: -38, y: 48, z: 0.02 },
        rightShoulder: { x: 38, y: 48, z: 0.02 },

        // 左手前伸释放魔法
        leftElbow: { x: -44, y: 78, z: 0.3 },
        leftWrist: { x: -40, y: 96, z: 0.62 },

        // 右手向侧后展开
        rightElbow: { x: 82, y: 76, z: -0.04 },
        rightWrist: { x: 112, y: 104, z: -0.08 },

        leftKnee: { x: -24, y: 228, z: 0.08 },
        rightKnee: { x: 26, y: 232, z: -0.04 },
        leftAnkle: { x: -34, y: 310, z: 0.12 },
        rightAnkle: { x: 30, y: 310, z: -0.02 },
      }),
  },
  {
    id: "pose-idol",
    label: "偶像站姿",
    /** 偶像拍照姿势：一手靠脸，一手外展，单腿轻微内扣。 */
    buildJoints3D: () =>
      mergeJoints3D({
        hip: { x: -2, y: 148, z: 0 },
        spine: { x: 0, y: 84, z: 0.02 },
        neck: { x: 4, y: 22, z: 0.04 },

        leftShoulder: { x: -36, y: 48, z: 0.02 },
        rightShoulder: { x: 38, y: 48, z: 0.02 },

        // 左手外展
        leftElbow: { x: -72, y: 82, z: 0.04 },
        leftWrist: { x: -94, y: 126, z: 0.1 },

        // 右手靠脸
        rightElbow: { x: 58, y: 74, z: 0.16 },
        rightWrist: { x: 34, y: 38, z: 0.24 },

        // 单腿内扣，可爱站姿
        leftKnee: { x: -24, y: 230, z: 0.02 },
        leftAnkle: { x: -30, y: 310, z: 0.04 },
        rightKnee: { x: 10, y: 230, z: 0.04 },
        rightAnkle: { x: 24, y: 310, z: 0.08 },
      }),
    }
];

const CHARACTER_3D_POSE_PRESET_BY_ID = new Map<string, Character3DPosePreset>(
  CHARACTER_3D_POSE_PRESETS.map((preset) => [preset.id, preset]),
);

export function getCharacter3DPosePresetById(
  id: string,
): Character3DPosePreset | undefined {
  return CHARACTER_3D_POSE_PRESET_BY_ID.get(id);
}