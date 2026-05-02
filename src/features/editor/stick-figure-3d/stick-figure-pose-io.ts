import type { StickFigurePoseV1, StickFigureVec3 } from "@/shared/types/stick-figure-pose";

import { STICK_JOINT_IDS } from "./SkeletonModel";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isVec3(v: unknown): v is StickFigureVec3 {
  return (
    isRecord(v) &&
    typeof v.x === "number" &&
    typeof v.y === "number" &&
    typeof v.z === "number" &&
    Number.isFinite(v.x) &&
    Number.isFinite(v.y) &&
    Number.isFinite(v.z)
  );
}

function sanitizeVec3(v: unknown, fallback: StickFigureVec3): StickFigureVec3 {
  if (isVec3(v)) {
    return { x: v.x, y: v.y, z: v.z };
  }
  return { ...fallback };
}

export function sanitizeStickFigurePoseV1(raw: unknown, fallback: StickFigurePoseV1): StickFigurePoseV1 {
  if (!isRecord(raw) || raw.version !== 1 || !isRecord(raw.joints)) {
    return cloneStickFigurePose(fallback);
  }

  const joints = { ...fallback.joints };
  for (const id of STICK_JOINT_IDS) {
    joints[id] = sanitizeVec3(raw.joints[id], fallback.joints[id]);
  }

  const polesRaw = raw.poles;
  const poles: StickFigurePoseV1["poles"] = {};
  if (isRecord(polesRaw)) {
    if (polesRaw.leftElbowPole) {
      poles.leftElbowPole = sanitizeVec3(polesRaw.leftElbowPole, joints.leftElbow);
    }
    if (polesRaw.rightElbowPole) {
      poles.rightElbowPole = sanitizeVec3(polesRaw.rightElbowPole, joints.rightElbow);
    }
    if (polesRaw.leftKneePole) {
      poles.leftKneePole = sanitizeVec3(polesRaw.leftKneePole, joints.leftKnee);
    }
    if (polesRaw.rightKneePole) {
      poles.rightKneePole = sanitizeVec3(polesRaw.rightKneePole, joints.rightKnee);
    }
  }

  const hasPole = Object.keys(poles).length > 0;
  return { version: 1, joints, ...(hasPole ? { poles } : {}) };
}

export function cloneStickFigurePose(pose: StickFigurePoseV1): StickFigurePoseV1 {
  const joints = Object.fromEntries(
    STICK_JOINT_IDS.map((id) => [id, { ...pose.joints[id] }]),
  ) as StickFigurePoseV1["joints"];
  if (!pose.poles) {
    return { version: 1, joints };
  }
  return {
    version: 1,
    joints,
    poles: {
      ...(pose.poles.leftElbowPole ? { leftElbowPole: { ...pose.poles.leftElbowPole } } : {}),
      ...(pose.poles.rightElbowPole ? { rightElbowPole: { ...pose.poles.rightElbowPole } } : {}),
      ...(pose.poles.leftKneePole ? { leftKneePole: { ...pose.poles.leftKneePole } } : {}),
      ...(pose.poles.rightKneePole ? { rightKneePole: { ...pose.poles.rightKneePole } } : {}),
    },
  };
}
