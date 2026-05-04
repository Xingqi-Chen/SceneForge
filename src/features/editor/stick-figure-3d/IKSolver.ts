import { Vector3 } from "three";

import type { StickFigureVec3 } from "@/shared/types/stick-figure-pose";

const EPS = 1e-5;

function toV3(p: StickFigureVec3): Vector3 {
  return new Vector3(p.x, p.y, p.z);
}

function fromV3(v: Vector3): StickFigureVec3 {
  return { x: v.x, y: v.y, z: v.z };
}

export function clampTargetToReach(
  root: StickFigureVec3,
  target: StickFigureVec3,
  len0: number,
  len1: number,
): StickFigureVec3 {
  const r = toV3(root);
  const t = toV3(target);
  const maxD = len0 + len1 - EPS;
  const dir = new Vector3().subVectors(t, r);
  const d = dir.length();
  if (d <= maxD) {
    return { x: target.x, y: target.y, z: target.z };
  }
  if (d < EPS) {
    return fromV3(r.clone().add(new Vector3(0, maxD, 0)));
  }
  dir.multiplyScalar(maxD / d);
  return fromV3(r.clone().add(dir));
}

/**
 * Two-bone IK (root–mid–end) with clamped unreachable target.
 * Mid joint is chosen from the two analytic circle intersections; pole or warm-start `mid` picks the bend side.
 */
export function solveTwoBoneIk(
  root: StickFigureVec3,
  mid: StickFigureVec3,
  _end: StickFigureVec3,
  target: StickFigureVec3,
  len0: number,
  len1: number,
  pole?: StickFigureVec3,
): { root: StickFigureVec3; mid: StickFigureVec3; end: StickFigureVec3 } {
  const p0 = toV3(root);
  const tClamped = toV3(clampTargetToReach(root, target, len0, len1));
  const hint = toV3(mid);
  const p1 = new Vector3();
  const p2 = new Vector3();
  const scratch = new Vector3();

  const bend = twoBoneBendGeometry(p0, tClamped, len0, len1);
  if (!bend) {
    scratch.subVectors(tClamped, p0);
    const dl = scratch.length();
    if (dl < EPS) {
      scratch.set(0, 1, 0);
    } else {
      scratch.divideScalar(dl);
    }
    p1.copy(p0).add(scratch.clone().multiplyScalar(len0));
    p2.copy(p1).add(scratch.multiplyScalar(len1));
  } else {
    const { base, axis, height } = bend;
    const bendHint = pole ? toV3(pole) : hint;
    scratch.subVectors(bendHint, p0);
    scratch.addScaledVector(axis, -scratch.dot(axis));
    if (scratch.lengthSq() < EPS * EPS) {
      scratch.subVectors(hint, p0);
      scratch.addScaledVector(axis, -scratch.dot(axis));
    }
    if (scratch.lengthSq() < EPS * EPS) {
      scratch.crossVectors(axis, new Vector3(0, 1, 0));
      if (scratch.lengthSq() < EPS * EPS) {
        scratch.crossVectors(axis, new Vector3(1, 0, 0));
      }
    }
    scratch.setLength(height);
    p1.copy(base).add(scratch);
    p2.copy(tClamped);
  }

  return { root: fromV3(p0), mid: fromV3(p1), end: fromV3(p2) };
}

export const solveTwoBoneFabrik = solveTwoBoneIk;

function twoBoneBendGeometry(
  root: Vector3,
  end: Vector3,
  len0: number,
  len1: number,
): { base: Vector3; axis: Vector3; height: number } | null {
  const d = root.distanceTo(end);
  if (d < EPS) {
    return null;
  }
  if (d > len0 + len1 + EPS) {
    return null;
  }
  const u = new Vector3().subVectors(end, root).divideScalar(d);
  const x = (d * d + len0 * len0 - len1 * len1) / (2 * d);
  const hSq = len0 * len0 - x * x;
  if (hSq < -1e-6) {
    return null;
  }
  const h = Math.sqrt(Math.max(0, hSq));
  const base = root.clone().add(u.clone().multiplyScalar(x));
  return { base, axis: u, height: h };
}
