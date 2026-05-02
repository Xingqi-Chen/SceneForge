import type { JointId, Vector3 } from "@/shared/types";
import type { StickFigurePoseV1, StickFigureVec3 } from "@/shared/types/stick-figure-pose";

import { solveStickFigurePose, type StickFigureSolveTargets } from "./solveStickFigurePose";

/** Same mapping as legacy mannequin authoring plane → root-local meters. */
export function authoringJoints3DToMeterSpace(plane: Record<JointId, Vector3>): Record<JointId, Vector3> {
  const mannequinHipY = 1.07;
  const jointScaleX = 0.011;
  const jointScaleY = (1.82 - 1.07) / (148 - 24);
  const hip = plane.hip;
  const out = {} as Record<JointId, Vector3>;
  for (const jid of Object.keys(plane) as JointId[]) {
    const j = plane[jid];
    out[jid] = {
      x: (j.x - hip.x) * jointScaleX,
      y: mannequinHipY - (j.y - hip.y) * jointScaleY,
      z: j.z,
    };
  }
  return out;
}

function toStickVec(v: Vector3): StickFigureVec3 {
  return { x: v.x, y: v.y, z: v.z };
}

export function migratedStickPoseFromAuthoringJoints3D(plane: Record<JointId, Vector3>): StickFigurePoseV1 {
  const m = authoringJoints3DToMeterSpace(plane);
  const neck = m.neck;
  const spine = m.spine;
  const chest: StickFigureVec3 = {
    x: spine.x * 0.42 + neck.x * 0.58,
    y: spine.y * 0.42 + neck.y * 0.58,
    z: spine.z * 0.42 + neck.z * 0.58,
  };
  const head: StickFigureVec3 = { x: neck.x, y: neck.y + 0.22, z: neck.z + 0.015 };
  const pelvis = toStickVec(m.hip);
  const targets: StickFigureSolveTargets = {
    pelvis,
    chest,
    head,
    leftHand: toStickVec(m.leftWrist),
    rightHand: toStickVec(m.rightWrist),
    leftFoot: { x: m.leftAnkle.x, y: m.leftAnkle.y - 0.04, z: m.leftAnkle.z + 0.06 },
    rightFoot: { x: m.rightAnkle.x, y: m.rightAnkle.y - 0.04, z: m.rightAnkle.z + 0.06 },
  };
  return solveStickFigurePose(targets, null, undefined);
}

export function migrateAuthoringJoints3DToStickFigure(
  joints3D: Record<JointId, Vector3>,
): StickFigurePoseV1 {
  return migratedStickPoseFromAuthoringJoints3D(joints3D);
}
