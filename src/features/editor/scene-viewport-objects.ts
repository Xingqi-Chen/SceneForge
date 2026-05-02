import type { SceneObject } from "@/shared/types";

/**
 * 与 ThreeViewport 中筛选 3D 视口基础体一致：带 transform3D 的立方体/球/圆柱/平面
 * 仅应在 3D 视口展示，不出现在 2D Konva 画布上。
 */
export function isThreeDViewportPrimitive(object: SceneObject): boolean {
  return Boolean(
    object.transform3D &&
      (object.kind === "cube" ||
        object.kind === "sphere" ||
        object.kind === "cylinder" ||
        object.kind === "plane"),
  );
}

export function sceneObjectsVisibleOn2DCanvas(objects: SceneObject[]): SceneObject[] {
  return objects.filter((object) => !isThreeDViewportPrimitive(object));
}
