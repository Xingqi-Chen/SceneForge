import { Matrix4, OrthographicCamera, PerspectiveCamera, Plane, Quaternion, Vector3, type Camera, type Group, type Ray } from "three";

const _anchorWorld = new Vector3();
const _planeNormal = new Vector3();
const _plane = new Plane();
const _hit = new Vector3();
const _inv = new Matrix4();
const _p0l = new Vector3();
const _p1l = new Vector3();
const _worldDelta = new Vector3();
const _camRight = new Vector3();
const _camUp = new Vector3();
const _camForward = new Vector3();
const _camQuat = new Quaternion();

export type ViewPlaneLocalPointResult = {
  point: Vector3 | null;
  hadRayHit: boolean;
};

function worldUnitsPerPixelAtAnchor(group: Group, camera: Camera, anchorLocal: { x: number; y: number; z: number }, viewportHeight: number): number {
  const safeViewportHeight = Math.max(1, viewportHeight);
  _anchorWorld.set(anchorLocal.x, anchorLocal.y, anchorLocal.z).applyMatrix4(group.matrixWorld);

  if (camera instanceof PerspectiveCamera) {
    const distance = Math.max(0.001, camera.position.distanceTo(_anchorWorld));
    return (2 * distance * Math.tan((camera.fov * Math.PI) / 360)) / safeViewportHeight;
  }

  if (camera instanceof OrthographicCamera) {
    return Math.abs((camera.top - camera.bottom) / camera.zoom) / safeViewportHeight;
  }

  return 0.001;
}

/**
 * 指针射线与「过锚点、法线为相机朝向」的视线平面求交，并返回角色根局部点。
 * 调用方可以自己比较连续点来获得完整 3D delta，避免把交互提前切成局部轴分量。
 */
export function intersectViewPlaneLocalPoint(
  group: Group,
  camera: Camera,
  worldRay: Ray,
  anchorLocal: { x: number; y: number; z: number },
): ViewPlaneLocalPointResult {
  group.updateMatrixWorld(true);
  _anchorWorld.set(anchorLocal.x, anchorLocal.y, anchorLocal.z).applyMatrix4(group.matrixWorld);

  camera.getWorldDirection(_planeNormal);
  _plane.setFromNormalAndCoplanarPoint(_planeNormal, _anchorWorld);

  const hit = worldRay.intersectPlane(_plane, _hit);
  if (!hit) {
    return { point: null, hadRayHit: false };
  }

  _inv.copy(group.matrixWorld).invert();
  return { point: _hit.clone().applyMatrix4(_inv), hadRayHit: true };
}

/**
 * 「视线平面」约束拖拽：过锚点的平面法线为相机朝向，
 * 指针射线与该平面求交，将相邻两交点变到角色根局部后得到完整局部增量。
 *
 * 与 DCC/引擎里「在视图平面拖动再投影到约束轴/平面」的常见做法一致；
 * 调用方可以取 z 做深度约束，也可以取 x/y 做局部平面拖拽。
 */
export function viewPlaneLocalDelta(
  group: Group,
  camera: Camera,
  worldRay: Ray,
  anchorLocal: { x: number; y: number; z: number },
  lastHitWorld: Vector3 | null,
): { delta: Vector3; nextLastHit: Vector3 | null; hadRayHit: boolean } {
  group.updateMatrixWorld(true);
  _anchorWorld.set(anchorLocal.x, anchorLocal.y, anchorLocal.z).applyMatrix4(group.matrixWorld);

  camera.getWorldDirection(_planeNormal);
  _plane.setFromNormalAndCoplanarPoint(_planeNormal, _anchorWorld);

  const hit = worldRay.intersectPlane(_plane, _hit);
  const hadRayHit = hit !== null;

  if (!hadRayHit) {
    return { delta: new Vector3(), nextLastHit: lastHitWorld, hadRayHit: false };
  }

  if (!lastHitWorld) {
    return { delta: new Vector3(), nextLastHit: _hit.clone(), hadRayHit: true };
  }

  _inv.copy(group.matrixWorld).invert();
  _p0l.copy(lastHitWorld).applyMatrix4(_inv);
  _p1l.copy(_hit).applyMatrix4(_inv);
  return { delta: _p1l.clone().sub(_p0l), nextLastHit: _hit.clone(), hadRayHit: true };
}

/**
 * 射线与视线平面平行等退化：屏幕像素位移 → 相机右/上世界方向 → 角色根局部 z 分量。
 */
export function screenPixelDeltaToLocalZ(
  group: Group,
  camera: Camera,
  dPixelX: number,
  dPixelY: number,
  sensitivity: number,
): number {
  if (dPixelX === 0 && dPixelY === 0) {
    return 0;
  }
  camera.getWorldQuaternion(_camQuat);
  _camRight.set(1, 0, 0).applyQuaternion(_camQuat).multiplyScalar(dPixelX * sensitivity);
  _camUp.set(0, 1, 0).applyQuaternion(_camQuat).multiplyScalar(-dPixelY * sensitivity);
  _worldDelta.copy(_camRight).add(_camUp);

  _inv.copy(group.matrixWorld).invert();
  _p0l.set(0, 0, 0).applyMatrix4(_inv);
  _p1l.copy(_worldDelta).applyMatrix4(_inv);
  return _p1l.sub(_p0l).z;
}

/**
 * Shift 深度拖拽：屏幕上下位移 → 相机前后方向 → 角色根局部完整 3D 增量。
 *
 * 只使用垂直像素位移作为深度手势，缩放随相机距离/FOV/正交 zoom 变化；
 * 这样不会把视线平面内的横向运动误读成角色局部 z。
 */
export function screenPixelDeltaToCameraDepthLocalDelta(
  group: Group,
  camera: Camera,
  anchorLocal: { x: number; y: number; z: number },
  dPixelY: number,
  viewportHeight: number,
): Vector3 {
  if (dPixelY === 0) {
    return new Vector3();
  }

  group.updateMatrixWorld(true);
  const worldUnitsPerPixel = worldUnitsPerPixelAtAnchor(group, camera, anchorLocal, viewportHeight);
  camera.getWorldDirection(_camForward);
  _worldDelta.copy(_camForward).multiplyScalar(-dPixelY * worldUnitsPerPixel);

  _inv.copy(group.matrixWorld).invert();
  _p0l.set(0, 0, 0).applyMatrix4(_inv);
  _p1l.copy(_worldDelta).applyMatrix4(_inv);
  return _p1l.clone().sub(_p0l);
}
