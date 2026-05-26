import {
  buildComfyUiDepthSceneSkeletonSvg,
  buildComfyUiOpenPoseSceneSkeletonSvg,
  type ComfyUiDepthProjectedSkeleton,
  type ComfyUiDepthRange,
  type ComfyUiOpenPoseProjectedSkeleton,
} from "@/features/comfyui";
import { getCharacterStickFigurePose } from "@/features/editor/stick-figure-3d/get-character-stick-pose";
import type { Scene } from "@/shared/types";
import { characterAppearsInThreeViewport } from "@/shared/utils/character-space";

export type ComfyUiControlNetOpenPosePreviewUnavailableReason =
  | "scene-not-3d"
  | "no-3d-characters";

export type ComfyUiControlNetPosePreview = {
  skeletons: ComfyUiOpenPoseProjectedSkeleton[];
  svg: string | null;
  visibleJointCount: number;
  visibleSkeletonCount: number;
};

export type ComfyUiControlNetDepthPreview = {
  depthRange: ComfyUiDepthRange | null;
  skeletons: ComfyUiDepthProjectedSkeleton[];
  svg: string | null;
  visibleJointCount: number;
  visibleSkeletonCount: number;
};

export type ComfyUiControlNetOpenPosePreview = {
  available: boolean;
  characterCount: number;
  depth: ComfyUiControlNetDepthPreview;
  height: number;
  openPose: ComfyUiControlNetPosePreview;
  reason?: ComfyUiControlNetOpenPosePreviewUnavailableReason;
  skeletons: ComfyUiOpenPoseProjectedSkeleton[];
  svg: string | null;
  visibleJointCount: number;
  visibleSkeletonCount: number;
  width: number;
};

const EMPTY_POSE_PREVIEW: ComfyUiControlNetPosePreview = {
  skeletons: [],
  svg: null,
  visibleJointCount: 0,
  visibleSkeletonCount: 0,
};

const EMPTY_DEPTH_PREVIEW: ComfyUiControlNetDepthPreview = {
  depthRange: null,
  skeletons: [],
  svg: null,
  visibleJointCount: 0,
  visibleSkeletonCount: 0,
};

export function buildComfyUiControlNetOpenPosePreview(
  scene: Scene,
  options: { width: number; height: number },
): ComfyUiControlNetOpenPosePreview {
  const width = Math.max(1, Math.round(options.width));
  const height = Math.max(1, Math.round(options.height));

  if (scene.mode !== "3d") {
    return {
      available: false,
      characterCount: 0,
      depth: EMPTY_DEPTH_PREVIEW,
      height,
      openPose: EMPTY_POSE_PREVIEW,
      reason: "scene-not-3d",
      skeletons: [],
      svg: null,
      visibleJointCount: 0,
      visibleSkeletonCount: 0,
      width,
    };
  }

  const characters = scene.characters.filter(characterAppearsInThreeViewport);

  if (characters.length === 0) {
    return {
      available: false,
      characterCount: 0,
      depth: EMPTY_DEPTH_PREVIEW,
      height,
      openPose: EMPTY_POSE_PREVIEW,
      reason: "no-3d-characters",
      skeletons: [],
      svg: null,
      visibleJointCount: 0,
      visibleSkeletonCount: 0,
      width,
    };
  }

  const skeletons = characters.map((character) => ({
    id: character.id,
    pose: getCharacterStickFigurePose(character),
    characterTransform: character.transform3D,
    headRotation3D: character.headRotation3D,
  }));
  const openPose = buildComfyUiOpenPoseSceneSkeletonSvg(
    skeletons,
    {
      width,
      height,
      camera: scene.three.camera,
    },
  );
  const depth = buildComfyUiDepthSceneSkeletonSvg(
    skeletons,
    {
      width,
      height,
      camera: scene.three.camera,
    },
  );

  return {
    available: true,
    characterCount: characters.length,
    depth: {
      depthRange: depth.depthRange,
      skeletons: depth.skeletons,
      svg: depth.svg,
      visibleJointCount: depth.visibleJointCount,
      visibleSkeletonCount: depth.visibleSkeletonCount,
    },
    height,
    openPose: {
      skeletons: openPose.skeletons,
      svg: openPose.svg,
      visibleJointCount: openPose.visibleJointCount,
      visibleSkeletonCount: openPose.visibleSkeletonCount,
    },
    skeletons: openPose.skeletons,
    svg: openPose.svg,
    visibleJointCount: openPose.visibleJointCount,
    visibleSkeletonCount: openPose.visibleSkeletonCount,
    width,
  };
}
