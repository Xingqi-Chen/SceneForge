/**
 * 3D primitive 几何：与 ThreeViewport 一致的本地 AABB 与 Group 变换（Euler XYZ + plane 基准绕 X -90°）。
 * 落地：将物体世界包围盒最低点对齐到 y=0。
 */

import { Box3, Euler, Matrix4, Quaternion, Vector3 } from "three";

import type { SceneObject, SceneObject3DTransform, SceneObjectKind, Vector3 as Vec3 } from "@/shared/types";

const DEG2RAD = Math.PI / 180;

function isPrimitive3DKind(kind: SceneObjectKind): boolean {
  return kind === "cube" || kind === "sphere" || kind === "cylinder" || kind === "plane";
}

/** 与 ThreeViewport.PrimitiveGeometry 尺寸一致（未缩放时的本地 AABB）。 */
function getLocalBoundingBox(kind: SceneObjectKind): Box3 {
  if (kind === "sphere") {
    return new Box3(new Vector3(-0.6, -0.6, -0.6), new Vector3(0.6, 0.6, 0.6));
  }

  if (kind === "cylinder") {
    return new Box3(new Vector3(-0.5, -0.6, -0.5), new Vector3(0.5, 0.6, 0.5));
  }

  if (kind === "plane") {
    return new Box3(new Vector3(-0.7, -0.7, -0.0005), new Vector3(0.7, 0.7, 0.0005));
  }

  return new Box3(new Vector3(-0.5, -0.5, -0.5), new Vector3(0.5, 0.5, 0.5));
}

function eulerForPrimitive(kind: SceneObjectKind, rotationDeg: Vec3): Euler {
  const baseX = kind === "plane" ? -90 : 0;

  return new Euler(
    (rotationDeg.x + baseX) * DEG2RAD,
    rotationDeg.y * DEG2RAD,
    rotationDeg.z * DEG2RAD,
    "XYZ",
  );
}

export function computeWorldBounds(
  kind: SceneObjectKind,
  transform: SceneObject3DTransform,
): { min: Vec3; max: Vec3 } {
  const local = getLocalBoundingBox(kind);
  const position = new Vector3(transform.position.x, transform.position.y, transform.position.z);
  const scale = new Vector3(transform.scale.x, transform.scale.y, transform.scale.z);
  const quaternion = new Quaternion().setFromEuler(eulerForPrimitive(kind, transform.rotation));
  const matrix = new Matrix4().compose(position, quaternion, scale);
  const world = local.clone().applyMatrix4(matrix);

  return {
    min: { x: world.min.x, y: world.min.y, z: world.min.z },
    max: { x: world.max.x, y: world.max.y, z: world.max.z },
  };
}

function roundPositionComponent(value: number): number {
  return Number(value.toFixed(6));
}

/** 将物体最低对世界坐标 y=0 对齐（仅移动 position.y）。 */
export function snapTransformToGround(
  kind: SceneObjectKind,
  transform: SceneObject3DTransform,
): SceneObject3DTransform {
  if (!isPrimitive3DKind(kind)) {
    return {
      position: { ...transform.position },
      rotation: { ...transform.rotation },
      scale: { ...transform.scale },
    };
  }

  const bounds = computeWorldBounds(kind, transform);
  const deltaY = -bounds.min.y;

  return {
    position: {
      x: roundPositionComponent(transform.position.x),
      y: roundPositionComponent(transform.position.y + deltaY),
      z: roundPositionComponent(transform.position.z),
    },
    rotation: { ...transform.rotation },
    scale: { ...transform.scale },
  };
}

/** 供 store 判断是否为可落地吸附的 3D 基础体。 */
export function is3DPrimitiveObject(object: SceneObject): boolean {
  return Boolean(object.transform3D) && isPrimitive3DKind(object.kind);
}
