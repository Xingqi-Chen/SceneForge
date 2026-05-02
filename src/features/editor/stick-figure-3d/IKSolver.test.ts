import { describe, expect, it } from "vitest";
import { Vector3 } from "three";

import { clampTargetToReach, solveTwoBoneIk } from "./IKSolver";

describe("IKSolver", () => {
  it("clamps unreachable target to max reach", () => {
    const root = { x: 0, y: 0, z: 0 };
    const far = { x: 10, y: 0, z: 0 };
    const c = clampTargetToReach(root, far, 0.3, 0.3);
    const d = Math.hypot(c.x - root.x, c.y - root.y, c.z - root.z);
    expect(d).toBeLessThanOrEqual(0.6 + 1e-4);
    expect(d).toBeGreaterThan(0.59);
  });

  it("preserves bone lengths for reachable target", () => {
    const root = { x: 0, y: 0, z: 0 };
    const mid = { x: 0.2, y: 0.1, z: 0 };
    const end = { x: 0.4, y: 0.1, z: 0 };
    const target = { x: 0.45, y: 0.12, z: 0 };
    const L0 = 0.28;
    const L1 = 0.26;
    const out = solveTwoBoneIk(root, mid, end, target, L0, L1);
    const d0 = Math.hypot(out.mid.x - out.root.x, out.mid.y - out.root.y, out.mid.z - out.root.z);
    const d1 = Math.hypot(out.end.x - out.mid.x, out.end.y - out.mid.y, out.end.z - out.mid.z);
    expect(Math.abs(d0 - L0)).toBeLessThan(0.02);
    expect(Math.abs(d1 - L1)).toBeLessThan(0.02);
  });

  it("bends for off-axis reachable target (elbow not fully straight)", () => {
    const root = { x: 0, y: 0, z: 0 };
    const mid = { x: 0.25, y: 0, z: 0 };
    const end = { x: 0.5, y: 0, z: 0 };
    const target = { x: 0.22, y: 0.22, z: 0 };
    const L0 = 0.28;
    const L1 = 0.26;
    const out = solveTwoBoneIk(root, mid, end, target, L0, L1);
    const u = new Vector3(out.mid.x - out.root.x, out.mid.y - out.root.y, out.mid.z - out.root.z).normalize();
    const v = new Vector3(out.end.x - out.mid.x, out.end.y - out.mid.y, out.end.z - out.mid.z).normalize();
    expect(Math.abs(u.dot(v))).toBeLessThan(0.995);
  });

  it("uses pole to bias elbow side", () => {
    const root = { x: 0, y: 1, z: 0 };
    const mid = { x: 0.1, y: 1.15, z: 0 };
    const end = { x: 0.35, y: 1.2, z: 0 };
    const target = { x: 0.4, y: 1.2, z: 0 };
    const poleBack = { x: 0, y: 1.1, z: -0.6 };
    const poleFront = { x: 0, y: 1.1, z: 0.6 };
    const L0 = 0.28;
    const L1 = 0.26;
    const a = solveTwoBoneIk(root, mid, end, target, L0, L1, poleBack);
    const b = solveTwoBoneIk(root, mid, end, target, L0, L1, poleFront);
    expect(Math.abs(a.mid.z - b.mid.z)).toBeGreaterThan(0.02);
  });
});
