import { describe, expect, it } from "vitest";
import { Group, PerspectiveCamera, Ray, Vector3 } from "three";

import {
  intersectViewPlaneLocalPoint,
  screenPixelDeltaToCameraDepthLocalDelta,
  viewPlaneLocalDelta,
} from "./view-plane-depth-drag";

describe("viewPlaneLocalDelta", () => {
  it("seeds last hit on first intersection with zero local delta", () => {
    const group = new Group();
    const camera = new PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0, 0, 5);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);

    const ray = new Ray(new Vector3(0, 0, 5), new Vector3(0, 0, -1));
    const out = viewPlaneLocalDelta(group, camera, ray, { x: 0, y: 0, z: 0 }, null);

    expect(out.hadRayHit).toBe(true);
    expect(out.delta.length()).toBe(0);
    expect(out.nextLastHit).not.toBeNull();
  });

  it("returns the local point on the fixed view plane", () => {
    const group = new Group();
    const camera = new PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0, 0, 5);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);

    const ray = new Ray(new Vector3(0.2, 0.3, 5), new Vector3(0, 0, -1));
    const out = intersectViewPlaneLocalPoint(group, camera, ray, { x: 0, y: 0, z: 0 });

    expect(out.hadRayHit).toBe(true);
    expect(out.point?.x).toBeCloseTo(0.2, 5);
    expect(out.point?.y).toBeCloseTo(0.3, 5);
    expect(out.point?.z).toBeCloseTo(0, 5);
  });

  it("maps vertical screen movement to camera-depth local delta", () => {
    const group = new Group();
    const camera = new PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0, 0, 5);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);

    const delta = screenPixelDeltaToCameraDepthLocalDelta(group, camera, { x: 0, y: 0, z: 0 }, -10, 1000);

    expect(delta.x).toBeCloseTo(0, 5);
    expect(delta.y).toBeCloseTo(0, 5);
    expect(delta.z).toBeLessThan(-0.04);
    expect(delta.z).toBeGreaterThan(-0.05);
  });
});
