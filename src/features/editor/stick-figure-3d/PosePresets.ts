import type { StickFigurePoseV1 } from "@/shared/types/stick-figure-pose";

import { solveStickFigurePose, type StickFigureSolveTargets } from "./solveStickFigurePose";

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

function solveFromTargets(targets: StickFigureSolveTargets): StickFigurePoseV1 {
  return solveStickFigurePose(targets, null, undefined);
}

const BASE = {
  pelvis: { x: 0, y: 1.05, z: 0 },
  chest: { x: 0, y: 1.47, z: 0 },
  head: { x: 0, y: 1.72, z: 0 },
} satisfies Partial<StickFigureSolveTargets>;

export const STICK_FIGURE_POSE_PRESETS: StickFigurePosePreset[] = [
  {
    id: "stick-pose-t",
    label: "T 型站姿",
    buildPose: () =>
      solveFromTargets({
        ...BASE,
        leftHand: { x: -0.58, y: 1.48, z: 0.02 },
        rightHand: { x: 0.58, y: 1.48, z: 0.02 },
        leftFoot: { x: -0.11, y: 0.04, z: 0.04 },
        rightFoot: { x: 0.11, y: 0.04, z: 0.04 },
      }),
  },
  {
    id: "stick-pose-relaxed",
    label: "自然站立",
    buildPose: () =>
      solveFromTargets({
        pelvis: { x: 0, y: 1.05, z: 0 },
        chest: { x: 0.01, y: 1.46, z: 0.02 },
        head: { x: 0.01, y: 1.7, z: 0.02 },
        leftHand: { x: -0.22, y: 1.22, z: 0.06 },
        rightHand: { x: 0.22, y: 1.22, z: 0.06 },
        leftFoot: { x: -0.1, y: 0.04, z: 0.05 },
        rightFoot: { x: 0.1, y: 0.04, z: 0.05 },
      }),
  },
  {
    id: "stick-pose-sitting",
    label: "坐姿",
    buildPose: () =>
      solveFromTargets({
        pelvis: { x: 0, y: 0.72, z: 0.12 },
        chest: { x: 0, y: 1.08, z: 0.22 },
        head: { x: 0, y: 1.32, z: 0.28 },
        leftHand: { x: -0.35, y: 0.95, z: 0.35 },
        rightHand: { x: 0.35, y: 0.95, z: 0.35 },
        leftFoot: { x: -0.12, y: 0.28, z: 0.42 },
        rightFoot: { x: 0.12, y: 0.28, z: 0.42 },
      }),
  },
  {
    id: "stick-pose-prone",
    label: "俯卧",
    buildPose: () =>
      solveFromTargets({
        pelvis: { x: 0, y: 0.52, z: 0 },
        chest: { x: 0, y: 0.58, z: -0.42 },
        head: { x: 0, y: 0.62, z: -0.78 },
        leftHand: { x: -0.45, y: 0.54, z: -0.35 },
        rightHand: { x: 0.45, y: 0.54, z: -0.35 },
        leftFoot: { x: -0.12, y: 0.5, z: 0.38 },
        rightFoot: { x: 0.12, y: 0.5, z: 0.38 },
      }),
  },
  {
    id: "stick-pose-running",
    label: "跑步",
    buildPose: () =>
      solveFromTargets({
        pelvis: { x: 0, y: 1.08, z: 0 },
        chest: { x: 0.06, y: 1.46, z: 0.05 },
        head: { x: 0.08, y: 1.7, z: 0.06 },
        leftHand: { x: -0.35, y: 1.35, z: 0.12 },
        rightHand: { x: 0.42, y: 1.52, z: -0.08 },
        leftFoot: { x: -0.08, y: 0.18, z: 0.22 },
        rightFoot: { x: 0.12, y: 0.52, z: -0.18 },
      }),
  },
  {
    id: "stick-pose-waving",
    label: "挥手",
    buildPose: () =>
      solveFromTargets({
        pelvis: { x: 0, y: 1.05, z: 0 },
        chest: { x: 0, y: 1.46, z: 0 },
        head: { x: 0.02, y: 1.72, z: 0.02 },
        leftHand: { x: -0.2, y: 1.2, z: 0.05 },
        rightHand: { x: 0.42, y: 1.62, z: 0.12 },
        leftFoot: { x: -0.1, y: 0.04, z: 0.04 },
        rightFoot: { x: 0.1, y: 0.04, z: 0.04 },
      }),
  },
  {
    id: "stick-pose-crossed-arms",
    label: "抱臂",
    buildPose: () =>
      solveFromTargets({
        pelvis: { x: 0, y: 1.05, z: 0 },
        chest: { x: 0, y: 1.46, z: 0.04 },
        head: { x: 0, y: 1.72, z: 0.02 },
        leftHand: { x: 0.18, y: 1.28, z: 0.18 },
        rightHand: { x: -0.18, y: 1.28, z: 0.18 },
        leftFoot: { x: -0.1, y: 0.04, z: 0.04 },
        rightFoot: { x: 0.1, y: 0.04, z: 0.04 },
      }),
  },
  {
    id: "stick-pose-lean-wall",
    label: "靠墙",
    buildPose: () =>
      solveFromTargets({
        pelvis: { x: 0, y: 1.05, z: 0.08 },
        chest: { x: 0, y: 1.45, z: 0.12 },
        head: { x: 0.02, y: 1.7, z: 0.14 },
        leftHand: { x: -0.28, y: 1.18, z: 0.1 },
        rightHand: { x: 0.28, y: 1.18, z: 0.1 },
        leftFoot: { x: -0.1, y: 0.04, z: 0.02 },
        rightFoot: { x: 0.1, y: 0.04, z: 0.02 },
      }),
  },
];

export function getStickFigurePosePresetById(id: string): StickFigurePosePreset | undefined {
  return STICK_FIGURE_POSE_PRESETS.find((p) => p.id === id);
}
