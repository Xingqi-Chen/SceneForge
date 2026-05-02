import type { StickFigurePoseV1, StickFigurePolesV1 } from "@/shared/types/stick-figure-pose";

import { createDefaultStickFigurePoseV1 } from "@/features/editor/store/defaults";

import {
  mergeTargets,
  solveStickFigurePose,
  stickPoseToTargets,
  type StickFigureSolveTargets,
} from "./solveStickFigurePose";

export type StickFigurePosePresetId =
  | "stick-pose-t"
  | "stick-pose-relaxed"
  | "stick-pose-sitting"
  | "stick-pose-prone"
  | "stick-pose-running"
  | "stick-pose-waving"
  | "stick-pose-crossed-arms"
  | "stick-pose-lean-wall";

export type StickFigurePosePreset = {
  id: StickFigurePosePresetId;
  label: string;
  buildPose: () => StickFigurePoseV1;
};

const UPRIGHT_DEFAULT = stickPoseToTargets(createDefaultStickFigurePoseV1());

function buildPose(targets: StickFigureSolveTargets, poles?: StickFigurePolesV1): StickFigurePoseV1 {
  if (!poles || Object.keys(poles).length === 0) {
    return solveStickFigurePose(targets, null, undefined);
  }

  const warm = solveStickFigurePose(targets, null, undefined);
  return solveStickFigurePose(targets, warm, poles);
}

const T_POSE_POLES = {
  leftElbowPole: { x: -0.72, y: 1.38, z: 0.02 },
  rightElbowPole: { x: 0.72, y: 1.38, z: 0.02 },
  leftKneePole: { x: -0.1, y: 0.55, z: 0.18 },
  rightKneePole: { x: 0.1, y: 0.55, z: 0.18 },
} satisfies StickFigurePolesV1;

const RELAXED_POLES = {
  leftElbowPole: { x: -0.34, y: 1.12, z: 0.12 },
  rightElbowPole: { x: 0.34, y: 1.1, z: 0.1 },
  leftKneePole: { x: -0.1, y: 0.52, z: 0.16 },
  rightKneePole: { x: 0.1, y: 0.52, z: 0.16 },
} satisfies StickFigurePolesV1;

const SITTING_POLES = {
  leftKneePole: { x: -0.18, y: 0.45, z: 0.64 },
  rightKneePole: { x: 0.18, y: 0.45, z: 0.64 },
  leftElbowPole: { x: -0.36, y: 0.92, z: 0.38 },
  rightElbowPole: { x: 0.36, y: 0.92, z: 0.38 },
} satisfies StickFigurePolesV1;

/**
 * 俯卧姿势：
 * 让身体几乎贴近地面，身体沿 z 轴展开。
 * pelvis 在后，chest / head 在前，双手撑在胸前，双脚伸向身体后方。
 */
const PRONE_POLES = {
  leftElbowPole: { x: -0.46, y: 0.32, z: -0.28 },
  rightElbowPole: { x: 0.46, y: 0.32, z: -0.28 },

  // 膝盖也压低，并朝后方轻微弯曲，避免腿像坐姿一样折起来。
  leftKneePole: { x: -0.12, y: 0.22, z: 0.62 },
  rightKneePole: { x: 0.12, y: 0.22, z: 0.62 },
} satisfies StickFigurePolesV1;

const RUNNING_POLES = {
  leftKneePole: { x: -0.12, y: 0.52, z: 0.56 },
  rightKneePole: { x: 0.14, y: 0.7, z: -0.46 },
  leftElbowPole: { x: -0.5, y: 1.28, z: -0.2 },
  rightElbowPole: { x: 0.52, y: 1.36, z: 0.3 },
} satisfies StickFigurePolesV1;

const WAVING_POLES = {
  leftElbowPole: { x: -0.32, y: 1.08, z: 0.1 },
  rightElbowPole: { x: 0.54, y: 1.46, z: 0.18 },
  leftKneePole: { x: -0.1, y: 0.52, z: 0.16 },
  rightKneePole: { x: 0.1, y: 0.52, z: 0.16 },
} satisfies StickFigurePolesV1;

const CROSSED_ARMS_POLES = {
  leftElbowPole: { x: -0.52, y: 1.24, z: 0.18 },
  rightElbowPole: { x: 0.52, y: 1.24, z: 0.18 },
  leftKneePole: { x: -0.1, y: 0.52, z: 0.16 },
  rightKneePole: { x: 0.1, y: 0.52, z: 0.16 },
} satisfies StickFigurePolesV1;

/**
 * 靠墙姿势：
 * 假设墙在角色背后的 -Z 方向。
 * pelvis / chest / head 向 -Z 后靠，双脚向 +Z 前撑。
 */
const LEAN_WALL_POLES = {
  leftElbowPole: { x: -0.32, y: 1.05, z: -0.08 },
  rightElbowPole: { x: 0.32, y: 1.05, z: -0.08 },

  // 膝盖朝前，形成“脚在前、身体后靠”的稳定支撑。
  leftKneePole: { x: -0.12, y: 0.52, z: 0.28 },
  rightKneePole: { x: 0.12, y: 0.52, z: 0.38 },
} satisfies StickFigurePolesV1;

export const STICK_FIGURE_POSE_PRESETS: StickFigurePosePreset[] = [
  {
    id: "stick-pose-t",
    label: "T 型站姿",
    buildPose: () =>
      buildPose(
        mergeTargets(UPRIGHT_DEFAULT, {
          pelvis: { x: 0, y: 1.05, z: 0 },
          chest: { x: 0, y: 1.46, z: 0 },
          head: { x: 0, y: 1.72, z: 0 },

          leftHand: { x: -0.78, y: 1.43, z: 0 },
          rightHand: { x: 0.78, y: 1.43, z: 0 },

          leftFoot: { x: -0.12, y: 0.04, z: 0.03 },
          rightFoot: { x: 0.12, y: 0.04, z: 0.03 },
        }),
        T_POSE_POLES,
      ),
  },
  {
    id: "stick-pose-relaxed",
    label: "自然站立",
    buildPose: () =>
      buildPose(
        mergeTargets(UPRIGHT_DEFAULT, {
          pelvis: { x: 0, y: 1.04, z: 0 },
          chest: { x: 0.02, y: 1.45, z: 0.02 },
          head: { x: 0.03, y: 1.7, z: 0.02 },

          leftHand: { x: -0.24, y: 1.08, z: 0.08 },
          rightHand: { x: 0.25, y: 1.06, z: 0.07 },

          leftFoot: { x: -0.11, y: 0.04, z: 0.04 },
          rightFoot: { x: 0.12, y: 0.04, z: 0.02 },
        }),
        RELAXED_POLES,
      ),
  },
  {
    id: "stick-pose-sitting",
    label: "坐姿",
    buildPose: () =>
      buildPose(
        {
          pelvis: { x: 0, y: 0.78, z: 0.04 },
          chest: { x: 0, y: 1.16, z: 0.12 },
          head: { x: 0, y: 1.42, z: 0.16 },

          leftHand: { x: -0.24, y: 0.82, z: 0.32 },
          rightHand: { x: 0.24, y: 0.82, z: 0.32 },

          leftFoot: { x: -0.2, y: 0.04, z: 0.58 },
          rightFoot: { x: 0.2, y: 0.04, z: 0.58 },
        },
        SITTING_POLES,
      ),
  },
  {
    id: "stick-pose-prone",
    label: "俯卧",
    buildPose: () =>
      buildPose(
        {
          /**
           * 俯卧重构：
           * 让角色整体趴在地面附近，而不是半躺。
           * z 轴含义：
           * - head/chest 更靠前，也就是 z 更小；
           * - pelvis/feet 更靠后，也就是 z 更大。
           */
          pelvis: { x: 0, y: 0.34, z: 0.28 },
          chest: { x: 0, y: 0.38, z: -0.12 },
          head: { x: 0, y: 0.44, z: -0.46 },

          /**
           * 手掌在胸前偏外侧，类似趴着撑地。
           * y 很低，避免手臂像站姿一样悬空。
           */
          leftHand: { x: -0.36, y: 0.16, z: -0.28 },
          rightHand: { x: 0.36, y: 0.16, z: -0.28 },

          /**
           * 双脚在身体后方，接近地面。
           * z 不要离 pelvis 太远，否则 IK 会把腿拉得过直或过长；
           * 也不要太近，否则会变成跪姿或坐姿。
           */
          leftFoot: { x: -0.16, y: 0.12, z: 0.74 },
          rightFoot: { x: 0.16, y: 0.12, z: 0.74 },
        },
        PRONE_POLES,
      ),
  },
  {
    id: "stick-pose-running",
    label: "跑步",
    buildPose: () =>
      buildPose(
        {
          pelvis: { x: 0, y: 1.02, z: 0 },
          chest: { x: 0.04, y: 1.4, z: 0.12 },
          head: { x: 0.06, y: 1.64, z: 0.18 },

          leftHand: { x: -0.34, y: 1.18, z: -0.22 },
          rightHand: { x: 0.36, y: 1.36, z: 0.34 },

          leftFoot: { x: -0.12, y: 0.06, z: 0.46 },
          rightFoot: { x: 0.18, y: 0.36, z: -0.38 },
        },
        RUNNING_POLES,
      ),
  },
  {
    id: "stick-pose-waving",
    label: "挥手",
    buildPose: () =>
      buildPose(
        mergeTargets(UPRIGHT_DEFAULT, {
          pelvis: { x: 0, y: 1.05, z: 0 },
          chest: { x: 0, y: 1.46, z: 0.02 },
          head: { x: 0.02, y: 1.72, z: 0.02 },

          leftHand: { x: -0.24, y: 1.08, z: 0.08 },
          rightHand: { x: 0.42, y: 1.86, z: 0.16 },

          leftFoot: { x: -0.11, y: 0.04, z: 0.04 },
          rightFoot: { x: 0.11, y: 0.04, z: 0.04 },
        }),
        WAVING_POLES,
      ),
  },
  {
    id: "stick-pose-crossed-arms",
    label: "抱臂",
    buildPose: () =>
      buildPose(
        mergeTargets(UPRIGHT_DEFAULT, {
          pelvis: { x: 0, y: 1.05, z: 0 },
          chest: { x: 0, y: 1.46, z: 0.04 },
          head: { x: 0, y: 1.72, z: 0.02 },

          leftHand: { x: 0.18, y: 1.28, z: 0.18 },
          rightHand: { x: -0.18, y: 1.28, z: 0.18 },

          leftFoot: { x: -0.11, y: 0.04, z: 0.04 },
          rightFoot: { x: 0.11, y: 0.04, z: 0.04 },
        }),
        CROSSED_ARMS_POLES,
      ),
  },
  {
    id: "stick-pose-lean-wall",
    label: "靠墙",
    buildPose: () =>
      buildPose(
        mergeTargets(UPRIGHT_DEFAULT, {
          /**
           * 靠墙重构：
           * 假设墙在角色背后的 -Z 方向。
           * 头、胸、骨盆整体向后偏移，形成靠墙角度。
           */
          pelvis: { x: 0, y: 1.0, z: -0.16 },
          chest: { x: 0, y: 1.38, z: -0.28 },
          head: { x: 0.02, y: 1.62, z: -0.34 },

          /**
           * 手臂自然下垂，略微靠后。
           * 不再让手臂抬起来，否则看起来不像靠墙。
           */
          leftHand: { x: -0.26, y: 0.98, z: -0.08 },
          rightHand: { x: 0.26, y: 0.98, z: -0.08 },

          /**
           * 双脚向前撑住身体。
           * 一前一后可以让姿势更自然，不像普通站立。
           */
          leftFoot: { x: -0.13, y: 0.04, z: 0.18 },
          rightFoot: { x: 0.16, y: 0.04, z: 0.34 },
        }),
        LEAN_WALL_POLES,
      ),
  },
];

export function getStickFigurePosePresetById(id: string): StickFigurePosePreset | undefined {
  return STICK_FIGURE_POSE_PRESETS.find((p) => p.id === id);
}