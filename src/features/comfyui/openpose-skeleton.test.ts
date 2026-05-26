import { describe, expect, it } from "vitest";

import type { Scene3DConfig, SceneObject3DTransform, Vector3 } from "@/shared/types";

import { createDefaultStickFigurePoseV1 } from "@/features/editor/store/defaults";

import {
  buildComfyUiDepthSceneSkeletonSvg,
  buildComfyUiDepthSkeletonSvg,
  buildComfyUiOpenPoseSceneSkeletonSvg,
  buildComfyUiOpenPoseSkeletonSvg,
} from "./openpose-skeleton";

const CAMERA: Scene3DConfig["camera"] = {
  position: { x: 0, y: 1.15, z: 5 },
  target: { x: 0, y: 1.05, z: 0 },
  fov: 45,
};

function buildDefaultResult(transform?: SceneObject3DTransform, headRotation3D?: Vector3) {
  return buildComfyUiOpenPoseSkeletonSvg(createDefaultStickFigurePoseV1(), {
    width: 512,
    height: 512,
    camera: CAMERA,
    characterTransform: transform,
    headRotation3D,
  });
}

describe("ComfyUI OpenPose skeleton SVG", () => {
  it("renders a black-background OpenPose-style SVG from the default stick figure pose", () => {
    const result = buildDefaultResult();

    expect(result.svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(result.svg).toContain('<rect width="100%" height="100%" fill="#000000"');
    expect(result.svg).toContain("<line ");
    expect(result.svg).toContain("<circle ");
    expect(result.svg).toContain('data-openpose-keypoint="nose"');
    expect(result.svg).toContain('data-openpose-keypoint="leftEye"');
    expect(result.svg).toContain('data-openpose-keypoint="rightEye"');
    expect(result.svg).toContain('data-openpose-face-index="0"');
    expect(result.points.head.visible).toBe(true);
    expect(result.headKeypoints.nose.visible).toBe(true);
    expect(result.facePoints).toHaveLength(68);
    expect(result.visibleJointIds).toContain("head");
  });

  it("projects the centered character near the middle of the target canvas", () => {
    const result = buildDefaultResult();
    const pelvis = result.points.pelvis;

    expect(pelvis.visible).toBe(true);
    expect(pelvis.x).toBeGreaterThan(220);
    expect(pelvis.x).toBeLessThan(292);
    expect(pelvis.y).toBeGreaterThan(220);
    expect(pelvis.y).toBeLessThan(360);
  });

  it("applies character translation, scale, and rotation before projection", () => {
    const base = buildDefaultResult();
    const transformed = buildDefaultResult({
      position: { x: 0.55, y: 0.15, z: -0.2 },
      rotation: { x: 0, y: 35, z: 6 },
      scale: { x: 1.18, y: 1.08, z: 0.92 },
    });

    expect(transformed.points.leftHand.visible).toBe(true);
    expect(transformed.points.leftHand.x).not.toBeCloseTo(base.points.leftHand.x, 3);
    expect(transformed.points.leftHand.y).not.toBeCloseTo(base.points.leftHand.y, 3);
  });

  it("omits joints and limbs that are behind the current camera", () => {
    const result = buildDefaultResult({
      position: { x: 0, y: 0, z: 8 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    });

    expect(result.visibleJointIds).toEqual([]);
    expect(result.svg).not.toContain("<line ");
    expect(result.svg).not.toContain("<circle ");
    expect(result.svg).not.toContain("data-openpose-face-index");
  });

  it("moves synthesized head keypoints with the character head rotation", () => {
    const base = buildDefaultResult();
    const rotated = buildDefaultResult(undefined, { x: 0, y: 55, z: 0 });

    expect(base.headKeypoints.nose.visible).toBe(true);
    expect(rotated.headKeypoints.nose.visible).toBe(true);
    expect(rotated.headKeypoints.nose.x).not.toBeCloseTo(base.headKeypoints.nose.x, 3);
    expect(rotated.headKeypoints.leftEye.x).not.toBeCloseTo(base.headKeypoints.leftEye.x, 3);
  });

  it("composes multiple 3D skeletons into one OpenPose-style SVG", () => {
    const pose = createDefaultStickFigurePoseV1();
    const result = buildComfyUiOpenPoseSceneSkeletonSvg(
      [
        {
          id: "left-character",
          pose,
          characterTransform: {
            position: { x: -0.35, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
          },
        },
        {
          id: "right-character",
          pose,
          characterTransform: {
            position: { x: 0.35, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
          },
        },
      ],
      {
        width: 512,
        height: 512,
        camera: CAMERA,
      },
    );

    const lineCount = (result.svg.match(/<line /g) ?? []).length;
    const circleCount = (result.svg.match(/<circle /g) ?? []).length;
    const facePointCount = (result.svg.match(/data-openpose-face-index=/g) ?? []).length;

    expect(result.skeletons).toHaveLength(2);
    expect(result.visibleSkeletonCount).toBe(2);
    expect(result.visibleJointCount).toBe(30);
    expect(result.skeletons[0].facePoints).toHaveLength(68);
    expect(result.skeletons[1].facePoints).toHaveLength(68);
    expect(lineCount).toBeGreaterThan(14);
    expect(circleCount).toBeGreaterThan(30);
    expect(facePointCount).toBe(136);
  });
});

describe("ComfyUI Depth skeleton SVG", () => {
  it("renders a black-background grayscale depth SVG from the default stick figure pose", () => {
    const result = buildComfyUiDepthSkeletonSvg(createDefaultStickFigurePoseV1(), {
      width: 512,
      height: 512,
      camera: CAMERA,
    });

    expect(result.svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(result.svg).toContain('<rect width="100%" height="100%" fill="#000000"');
    expect(result.svg).toContain("<line ");
    expect(result.svg).toContain("<circle ");
    expect(result.svg).toMatch(/stroke="#[0-9a-f]{6}"/);
    expect(result.svg).not.toContain("data-openpose-face-index");
    expect(result.svg).not.toContain("data-openpose-keypoint");
    expect(result.depthRange).not.toBeNull();
    expect(result.points.head.visible).toBe(true);
  });

  it("projects the centered depth character near the middle of the target canvas", () => {
    const result = buildComfyUiDepthSkeletonSvg(createDefaultStickFigurePoseV1(), {
      width: 512,
      height: 512,
      camera: CAMERA,
    });

    expect(result.points.pelvis.visible).toBe(true);
    expect(result.points.pelvis.x).toBeGreaterThan(220);
    expect(result.points.pelvis.x).toBeLessThan(292);
  });

  it("applies character transform before producing depth projection points", () => {
    const base = buildComfyUiDepthSkeletonSvg(createDefaultStickFigurePoseV1(), {
      width: 512,
      height: 512,
      camera: CAMERA,
    });
    const transformed = buildComfyUiDepthSkeletonSvg(createDefaultStickFigurePoseV1(), {
      width: 512,
      height: 512,
      camera: CAMERA,
      characterTransform: {
        position: { x: 0.55, y: 0.15, z: -0.2 },
        rotation: { x: 0, y: 35, z: 6 },
        scale: { x: 1.18, y: 1.08, z: 0.92 },
      },
    });

    expect(transformed.points.leftHand.x).not.toBeCloseTo(base.points.leftHand.x, 3);
    expect(transformed.points.leftHand.y).not.toBeCloseTo(base.points.leftHand.y, 3);
  });

  it("omits depth joints and limbs that are behind the current camera", () => {
    const result = buildComfyUiDepthSkeletonSvg(createDefaultStickFigurePoseV1(), {
      width: 512,
      height: 512,
      camera: CAMERA,
      characterTransform: {
        position: { x: 0, y: 0, z: 8 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
    });

    expect(result.visibleJointIds).toEqual([]);
    expect(result.depthRange).toBeNull();
    expect(result.svg).not.toContain("<line ");
    expect(result.svg).not.toContain("<circle ");
  });

  it("composes multiple 3D skeletons into one depth SVG", () => {
    const pose = createDefaultStickFigurePoseV1();
    const result = buildComfyUiDepthSceneSkeletonSvg(
      [
        {
          id: "left-character",
          pose,
          characterTransform: {
            position: { x: -0.35, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
          },
        },
        {
          id: "right-character",
          pose,
          characterTransform: {
            position: { x: 0.35, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
          },
        },
      ],
      {
        width: 512,
        height: 512,
        camera: CAMERA,
      },
    );

    expect(result.skeletons).toHaveLength(2);
    expect(result.visibleSkeletonCount).toBe(2);
    expect(result.visibleJointCount).toBe(30);
    expect(result.svg.match(/<circle /g)).toHaveLength(30);
  });
});
