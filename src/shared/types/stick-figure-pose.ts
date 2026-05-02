/** Root-local meters (Y-up), structurally compatible with scene `Vector3`. */
export type StickFigureVec3 = {
  x: number;
  y: number;
  z: number;
};

/** Root-local meters (Y-up), same space as 3D stick figure IK and rendering. */
export type StickFigureJointId =
  | "pelvis"
  | "chest"
  | "head"
  | "leftShoulder"
  | "leftElbow"
  | "leftHand"
  | "rightShoulder"
  | "rightElbow"
  | "rightHand"
  | "leftHip"
  | "leftKnee"
  | "leftFoot"
  | "rightHip"
  | "rightKnee"
  | "rightFoot";

export type StickFigurePolesV1 = {
  leftElbowPole?: StickFigureVec3;
  rightElbowPole?: StickFigureVec3;
  leftKneePole?: StickFigureVec3;
  rightKneePole?: StickFigureVec3;
};

/** Persisted 3D stick figure pose (joints + optional pole hints for IK bend direction). */
export type StickFigurePoseV1 = {
  version: 1;
  joints: Record<StickFigureJointId, StickFigureVec3>;
  poles?: StickFigurePolesV1;
};
