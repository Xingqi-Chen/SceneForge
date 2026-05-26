import {
  Euler,
  Matrix4,
  PerspectiveCamera,
  Quaternion,
  Vector3 as ThreeVector3,
} from "three";

import type { Scene3DConfig, SceneObject3DTransform, Vector3 } from "@/shared/types";
import type {
  StickFigureJointId,
  StickFigurePoseV1,
  StickFigureVec3,
} from "@/shared/types/stick-figure-pose";
import {
  resolveStickFigureHeadBasis,
  resolveStickFigureHeadPoint,
  type StickFigureHeadOffset,
} from "@/shared/utils/stick-figure-head-basis";

const DEG2RAD = Math.PI / 180;
const DEFAULT_CAMERA_NEAR = 0.1;
const DEFAULT_CAMERA_FAR = 1000;
const DEFAULT_BACKGROUND = "#000000";
const DEFAULT_STROKE_WIDTH = 8;
const DEFAULT_JOINT_RADIUS = 5;
const DEFAULT_DEPTH_STROKE_WIDTH = 22;
const DEFAULT_DEPTH_JOINT_RADIUS = 10;
const DEFAULT_FACE_KEYPOINT_RADIUS = 2.2;

const OPENPOSE_JOINT_IDS = [
  "pelvis",
  "chest",
  "head",
  "leftShoulder",
  "leftElbow",
  "leftHand",
  "rightShoulder",
  "rightElbow",
  "rightHand",
  "leftHip",
  "leftKnee",
  "leftFoot",
  "rightHip",
  "rightKnee",
  "rightFoot",
] as const satisfies readonly StickFigureJointId[];

const OPENPOSE_COLORS = [
  "#ff0000",
  "#ff5500",
  "#ffaa00",
  "#ffff00",
  "#aaff00",
  "#55ff00",
  "#00ff00",
  "#00ff55",
  "#00ffaa",
  "#00ffff",
  "#00aaff",
  "#0055ff",
  "#0000ff",
  "#5500ff",
  "#aa00ff",
  "#ff00ff",
  "#ff00aa",
  "#ff0055",
] as const;

const OPENPOSE_SEGMENTS = [
  ["head", "chest"],
  ["chest", "leftShoulder"],
  ["leftShoulder", "leftElbow"],
  ["leftElbow", "leftHand"],
  ["chest", "rightShoulder"],
  ["rightShoulder", "rightElbow"],
  ["rightElbow", "rightHand"],
  ["chest", "pelvis"],
  ["pelvis", "leftHip"],
  ["leftHip", "leftKnee"],
  ["leftKnee", "leftFoot"],
  ["pelvis", "rightHip"],
  ["rightHip", "rightKnee"],
  ["rightKnee", "rightFoot"],
] as const satisfies ReadonlyArray<readonly [StickFigureJointId, StickFigureJointId]>;

const OPENPOSE_HEAD_KEYPOINT_IDS = [
  "neck",
  "nose",
  "leftEye",
  "rightEye",
  "leftEar",
  "rightEar",
] as const;

const OPENPOSE_HEAD_KEYPOINT_COLORS = {
  neck: "#ff0000",
  nose: "#ff5500",
  leftEye: "#ffaa00",
  rightEye: "#ffff00",
  leftEar: "#aaff00",
  rightEar: "#55ff00",
} as const satisfies Record<ComfyUiOpenPoseHeadKeypointId, string>;

const OPENPOSE_HEAD_SEGMENTS = [
  ["neck", "nose"],
  ["nose", "leftEye"],
  ["leftEye", "leftEar"],
  ["nose", "rightEye"],
  ["rightEye", "rightEar"],
] as const satisfies ReadonlyArray<readonly [ComfyUiOpenPoseHeadKeypointId, ComfyUiOpenPoseHeadKeypointId]>;

const DEFAULT_CHARACTER_TRANSFORM: SceneObject3DTransform = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
};

type FacePointTemplate = StickFigureHeadOffset;

function createEllipseTemplates(
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number,
  count: number,
  startRadians: number,
  endRadians: number,
): FacePointTemplate[] {
  const denominator = count > 1 ? count - 1 : 1;

  return Array.from({ length: count }, (_, index) => {
    const t = startRadians + ((endRadians - startRadians) * index) / denominator;

    return {
      x: centerX + Math.cos(t) * radiusX,
      y: centerY + Math.sin(t) * radiusY,
      z: 0.14,
    };
  });
}

function createFacePointTemplates(): FacePointTemplate[] {
  const jaw = createEllipseTemplates(0, -0.08, 0.78, 0.85, 17, Math.PI, Math.PI * 2);
  const leftBrow: FacePointTemplate[] = [
    { x: -0.54, y: 0.32, z: 0.12 },
    { x: -0.43, y: 0.39, z: 0.14 },
    { x: -0.31, y: 0.42, z: 0.16 },
    { x: -0.19, y: 0.39, z: 0.14 },
    { x: -0.08, y: 0.32, z: 0.12 },
  ];
  const rightBrow: FacePointTemplate[] = [
    { x: 0.08, y: 0.32, z: 0.12 },
    { x: 0.19, y: 0.39, z: 0.14 },
    { x: 0.31, y: 0.42, z: 0.16 },
    { x: 0.43, y: 0.39, z: 0.14 },
    { x: 0.54, y: 0.32, z: 0.12 },
  ];
  const noseBridge: FacePointTemplate[] = [
    { x: 0, y: 0.24, z: 0.26 },
    { x: 0, y: 0.11, z: 0.31 },
    { x: 0, y: -0.02, z: 0.34 },
    { x: 0, y: -0.15, z: 0.36 },
  ];
  const noseBase: FacePointTemplate[] = [
    { x: -0.22, y: -0.21, z: 0.25 },
    { x: -0.11, y: -0.27, z: 0.32 },
    { x: 0, y: -0.29, z: 0.36 },
    { x: 0.11, y: -0.27, z: 0.32 },
    { x: 0.22, y: -0.21, z: 0.25 },
  ];
  const leftEye = createEllipseTemplates(-0.29, 0.12, 0.15, 0.065, 6, 0, Math.PI * 2);
  const rightEye = createEllipseTemplates(0.29, 0.12, 0.15, 0.065, 6, 0, Math.PI * 2);
  const outerMouth = createEllipseTemplates(0, -0.48, 0.34, 0.13, 12, 0, Math.PI * 2);
  const innerMouth = createEllipseTemplates(0, -0.48, 0.18, 0.055, 8, 0, Math.PI * 2);

  return [
    ...jaw,
    ...leftBrow,
    ...rightBrow,
    ...noseBridge,
    ...noseBase,
    ...leftEye,
    ...rightEye,
    ...outerMouth,
    ...innerMouth,
  ];
}

const OPENPOSE_FACE_POINT_TEMPLATES = createFacePointTemplates();

export type ComfyUiOpenPosePoint = {
  jointId: StickFigureJointId;
  x: number;
  y: number;
  depth: number;
  visible: boolean;
};

export type ComfyUiOpenPoseHeadKeypointId = (typeof OPENPOSE_HEAD_KEYPOINT_IDS)[number];

export type ComfyUiOpenPoseVirtualPoint = {
  id: ComfyUiOpenPoseHeadKeypointId | `face-${number}`;
  x: number;
  y: number;
  depth: number;
  visible: boolean;
};

export type ComfyUiOpenPoseSvgOptions = {
  width: number;
  height: number;
  camera: Scene3DConfig["camera"];
  characterTransform?: SceneObject3DTransform;
  headRotation3D?: Vector3;
  background?: string;
  strokeWidth?: number;
  jointRadius?: number;
};

export type ComfyUiOpenPoseSvgResult = {
  svg: string;
  points: Record<StickFigureJointId, ComfyUiOpenPosePoint>;
  headKeypoints: Record<ComfyUiOpenPoseHeadKeypointId, ComfyUiOpenPoseVirtualPoint>;
  facePoints: ComfyUiOpenPoseVirtualPoint[];
  visibleJointIds: StickFigureJointId[];
};

export type ComfyUiOpenPoseSceneSkeleton = {
  id: string;
  pose: StickFigurePoseV1;
  characterTransform?: SceneObject3DTransform;
  headRotation3D?: Vector3;
};

export type ComfyUiOpenPoseProjectedSkeleton = {
  id: string;
  points: Record<StickFigureJointId, ComfyUiOpenPosePoint>;
  headKeypoints: Record<ComfyUiOpenPoseHeadKeypointId, ComfyUiOpenPoseVirtualPoint>;
  facePoints: ComfyUiOpenPoseVirtualPoint[];
  visibleJointIds: StickFigureJointId[];
  visibleJointCount: number;
  visibleHeadKeypointCount: number;
  visibleFacePointCount: number;
};

export type ComfyUiOpenPoseSceneSvgOptions = Omit<ComfyUiOpenPoseSvgOptions, "characterTransform">;

export type ComfyUiOpenPoseSceneSvgResult = {
  svg: string;
  skeletons: ComfyUiOpenPoseProjectedSkeleton[];
  visibleJointCount: number;
  visibleSkeletonCount: number;
};

export type ComfyUiDepthPoint = ComfyUiOpenPosePoint;

export type ComfyUiDepthSvgOptions = {
  width: number;
  height: number;
  camera: Scene3DConfig["camera"];
  characterTransform?: SceneObject3DTransform;
  background?: string;
  strokeWidth?: number;
  jointRadius?: number;
};

export type ComfyUiDepthSvgResult = {
  svg: string;
  points: Record<StickFigureJointId, ComfyUiDepthPoint>;
  visibleJointIds: StickFigureJointId[];
  depthRange: ComfyUiDepthRange | null;
};

export type ComfyUiDepthSceneSkeleton = ComfyUiOpenPoseSceneSkeleton;

export type ComfyUiDepthProjectedSkeleton = {
  id: string;
  points: Record<StickFigureJointId, ComfyUiDepthPoint>;
  visibleJointIds: StickFigureJointId[];
  visibleJointCount: number;
};

export type ComfyUiDepthRange = {
  min: number;
  max: number;
};

export type ComfyUiDepthSceneSvgOptions = Omit<ComfyUiDepthSvgOptions, "characterTransform">;

export type ComfyUiDepthSceneSvgResult = {
  svg: string;
  skeletons: ComfyUiDepthProjectedSkeleton[];
  visibleJointCount: number;
  visibleSkeletonCount: number;
  depthRange: ComfyUiDepthRange | null;
};

function finitePositive(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function svgNumber(value: number) {
  if (!Number.isFinite(value)) {
    return "0";
  }

  const rounded = Math.abs(value) < 0.0005 ? 0 : value;
  return Number(rounded.toFixed(3)).toString();
}

function escapeSvgAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function toThreeVec3(value: StickFigureVec3 | SceneObject3DTransform["position"]) {
  return new ThreeVector3(value.x, value.y, value.z);
}

function createCharacterTransformMatrix(transform: SceneObject3DTransform) {
  const position = toThreeVec3(transform.position);
  const rotation = new Euler(
    transform.rotation.x * DEG2RAD,
    transform.rotation.y * DEG2RAD,
    transform.rotation.z * DEG2RAD,
    "XYZ",
  );
  const quaternion = new Quaternion().setFromEuler(rotation);
  const scale = toThreeVec3(transform.scale);

  return new Matrix4().compose(position, quaternion, scale);
}

function createCamera(options: ComfyUiOpenPoseSvgOptions) {
  const width = finitePositive(options.width, 1);
  const height = finitePositive(options.height, 1);
  const camera = new PerspectiveCamera(
    options.camera.fov,
    width / height,
    DEFAULT_CAMERA_NEAR,
    DEFAULT_CAMERA_FAR,
  );

  camera.position.set(
    options.camera.position.x,
    options.camera.position.y,
    options.camera.position.z,
  );
  camera.lookAt(
    options.camera.target.x,
    options.camera.target.y,
    options.camera.target.z,
  );
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);

  return camera;
}

function projectLocalPoint(
  localPoint: StickFigureVec3,
  transformMatrix: Matrix4,
  camera: PerspectiveCamera,
  width: number,
  height: number,
): Omit<ComfyUiOpenPosePoint, "jointId"> {
  const worldPoint = new ThreeVector3(localPoint.x, localPoint.y, localPoint.z).applyMatrix4(transformMatrix);
  const cameraSpacePoint = worldPoint.clone().applyMatrix4(camera.matrixWorldInverse);
  const depth = -cameraSpacePoint.z;
  const projectedPoint = worldPoint.clone().project(camera);
  const x = ((projectedPoint.x + 1) / 2) * width;
  const y = ((1 - projectedPoint.y) / 2) * height;
  const visible =
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    Number.isFinite(projectedPoint.z) &&
    depth > camera.near &&
    depth < camera.far &&
    projectedPoint.x >= -1 &&
    projectedPoint.x <= 1 &&
    projectedPoint.y >= -1 &&
    projectedPoint.y <= 1 &&
    projectedPoint.z >= -1 &&
    projectedPoint.z <= 1;

  return { x, y, depth, visible };
}

function projectPoint(
  jointId: StickFigureJointId,
  localPoint: StickFigureVec3,
  transformMatrix: Matrix4,
  camera: PerspectiveCamera,
  width: number,
  height: number,
): ComfyUiOpenPosePoint {
  return {
    jointId,
    ...projectLocalPoint(localPoint, transformMatrix, camera, width, height),
  };
}

function projectVirtualPoint(
  id: ComfyUiOpenPoseVirtualPoint["id"],
  localPoint: ThreeVector3,
  transformMatrix: Matrix4,
  camera: PerspectiveCamera,
  width: number,
  height: number,
): ComfyUiOpenPoseVirtualPoint {
  return {
    id,
    ...projectLocalPoint(localPoint, transformMatrix, camera, width, height),
  };
}

function renderSegment(
  from: ComfyUiOpenPosePoint,
  to: ComfyUiOpenPosePoint,
  color: string,
  strokeWidth: number,
) {
  if (!from.visible || !to.visible) {
    return "";
  }

  return `<line x1="${svgNumber(from.x)}" y1="${svgNumber(from.y)}" x2="${svgNumber(to.x)}" y2="${svgNumber(to.y)}" stroke="${color}" stroke-width="${svgNumber(strokeWidth)}" stroke-linecap="round" opacity="0.95" />`;
}

function renderJoint(point: ComfyUiOpenPosePoint, color: string, radius: number) {
  if (!point.visible) {
    return "";
  }

  return `<circle cx="${svgNumber(point.x)}" cy="${svgNumber(point.y)}" r="${svgNumber(radius)}" fill="${color}" />`;
}

function renderVirtualPoint(
  point: ComfyUiOpenPoseVirtualPoint,
  color: string,
  radius: number,
  attributes: Record<string, string>,
) {
  if (!point.visible) {
    return "";
  }

  const renderedAttributes = Object.entries(attributes)
    .map(([key, value]) => `${key}="${escapeSvgAttribute(value)}"`)
    .join(" ");
  const attributeSuffix = renderedAttributes ? ` ${renderedAttributes}` : "";

  return `<circle cx="${svgNumber(point.x)}" cy="${svgNumber(point.y)}" r="${svgNumber(radius)}" fill="${color}"${attributeSuffix} />`;
}

function renderVirtualSegment(
  from: ComfyUiOpenPoseVirtualPoint,
  to: ComfyUiOpenPoseVirtualPoint,
  color: string,
  strokeWidth: number,
  keypoint: string,
) {
  if (!from.visible || !to.visible) {
    return "";
  }

  return `<line x1="${svgNumber(from.x)}" y1="${svgNumber(from.y)}" x2="${svgNumber(to.x)}" y2="${svgNumber(to.y)}" stroke="${color}" stroke-width="${svgNumber(strokeWidth)}" stroke-linecap="round" opacity="0.92" data-openpose-keypoint="${escapeSvgAttribute(keypoint)}" />`;
}

function buildHeadKeypoints(
  skeleton: ComfyUiOpenPoseSceneSkeleton,
  transformMatrix: Matrix4,
  camera: PerspectiveCamera,
  width: number,
  height: number,
) {
  const basis = resolveStickFigureHeadBasis(skeleton.pose);
  const headKeypointOffsets = {
    neck: null,
    nose: { x: 0, y: -0.08, z: 0.42 },
    leftEye: { x: -0.26, y: 0.13, z: 0.26 },
    rightEye: { x: 0.26, y: 0.13, z: 0.26 },
    leftEar: { x: -0.68, y: 0.03, z: 0.06 },
    rightEar: { x: 0.68, y: 0.03, z: 0.06 },
  } as const satisfies Record<ComfyUiOpenPoseHeadKeypointId, FacePointTemplate | null>;

  return Object.fromEntries(
    OPENPOSE_HEAD_KEYPOINT_IDS.map((id) => {
      const offset = headKeypointOffsets[id];
      const localPoint = offset
        ? resolveStickFigureHeadPoint(basis, offset, skeleton.headRotation3D)
        : basis.neck;

      return [id, projectVirtualPoint(id, localPoint, transformMatrix, camera, width, height)];
    }),
  ) as Record<ComfyUiOpenPoseHeadKeypointId, ComfyUiOpenPoseVirtualPoint>;
}

function buildFacePoints(
  skeleton: ComfyUiOpenPoseSceneSkeleton,
  transformMatrix: Matrix4,
  camera: PerspectiveCamera,
  width: number,
  height: number,
) {
  const basis = resolveStickFigureHeadBasis(skeleton.pose);

  return OPENPOSE_FACE_POINT_TEMPLATES.map((offset, index) => {
    const localPoint = resolveStickFigureHeadPoint(
      basis,
      {
        x: offset.x,
        y: offset.y - 0.08,
        z: (offset.z ?? 0) + 0.22,
      },
      skeleton.headRotation3D,
    );

    return projectVirtualPoint(`face-${index}`, localPoint, transformMatrix, camera, width, height);
  });
}

function projectSkeleton(
  skeleton: ComfyUiOpenPoseSceneSkeleton,
  camera: PerspectiveCamera,
  width: number,
  height: number,
): ComfyUiOpenPoseProjectedSkeleton {
  const characterTransform = skeleton.characterTransform ?? DEFAULT_CHARACTER_TRANSFORM;
  const transformMatrix = createCharacterTransformMatrix(characterTransform);
  const points = Object.fromEntries(
    OPENPOSE_JOINT_IDS.map((jointId) => [
      jointId,
      projectPoint(jointId, skeleton.pose.joints[jointId], transformMatrix, camera, width, height),
    ]),
  ) as Record<StickFigureJointId, ComfyUiOpenPosePoint>;
  const headKeypoints = buildHeadKeypoints(skeleton, transformMatrix, camera, width, height);
  const facePoints = buildFacePoints(skeleton, transformMatrix, camera, width, height);
  const visibleJointIds = OPENPOSE_JOINT_IDS.filter((jointId) => points[jointId].visible);

  return {
    id: skeleton.id,
    points,
    headKeypoints,
    facePoints,
    visibleJointIds,
    visibleJointCount: visibleJointIds.length,
    visibleHeadKeypointCount: OPENPOSE_HEAD_KEYPOINT_IDS.filter((id) => headKeypoints[id].visible).length,
    visibleFacePointCount: facePoints.filter((point) => point.visible).length,
  };
}

function renderSkeletonElements(
  skeleton: ComfyUiOpenPoseProjectedSkeleton,
  skeletonIndex: number,
  strokeWidth: number,
  jointRadius: number,
) {
  const colorOffset = skeletonIndex * 3;
  const segmentElements = OPENPOSE_SEGMENTS.map(([from, to], index) =>
    renderSegment(
      skeleton.points[from],
      skeleton.points[to],
      OPENPOSE_COLORS[(index + colorOffset) % OPENPOSE_COLORS.length],
      strokeWidth,
    ),
  ).filter(Boolean);
  const jointElements = OPENPOSE_JOINT_IDS.map((jointId, index) =>
    renderJoint(
      skeleton.points[jointId],
      OPENPOSE_COLORS[(index + colorOffset) % OPENPOSE_COLORS.length],
      jointRadius,
    ),
  ).filter(Boolean);
  const headSegmentElements = OPENPOSE_HEAD_SEGMENTS.map(([from, to]) =>
    renderVirtualSegment(
      skeleton.headKeypoints[from],
      skeleton.headKeypoints[to],
      OPENPOSE_HEAD_KEYPOINT_COLORS[to],
      Math.max(1, strokeWidth * 0.62),
      `${from}-${to}`,
    ),
  ).filter(Boolean);
  const headKeypointElements = OPENPOSE_HEAD_KEYPOINT_IDS.map((id) =>
    renderVirtualPoint(
      skeleton.headKeypoints[id],
      OPENPOSE_HEAD_KEYPOINT_COLORS[id],
      Math.max(1, jointRadius * 0.9),
      { "data-openpose-keypoint": id },
    ),
  ).filter(Boolean);
  const facePointElements = skeleton.facePoints.map((point, index) =>
    renderVirtualPoint(
      point,
      "#ffffff",
      DEFAULT_FACE_KEYPOINT_RADIUS,
      { "data-openpose-face-index": String(index) },
    ),
  ).filter(Boolean);

  return [...segmentElements, ...jointElements, ...headSegmentElements, ...headKeypointElements, ...facePointElements];
}

function renderSvg(width: number, height: number, background: string, elements: string[]) {
  const svgElements = [
    `<rect width="100%" height="100%" fill="${background}" />`,
    ...elements,
  ];

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${svgNumber(width)}" height="${svgNumber(height)}" viewBox="0 0 ${svgNumber(width)} ${svgNumber(height)}" role="img" aria-label="ComfyUI OpenPose skeleton">\n${svgElements.join("\n")}\n</svg>`;
}

function renderDepthSvg(width: number, height: number, background: string, elements: string[]) {
  const svgElements = [
    `<rect width="100%" height="100%" fill="${background}" />`,
    ...elements,
  ];

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${svgNumber(width)}" height="${svgNumber(height)}" viewBox="0 0 ${svgNumber(width)} ${svgNumber(height)}" role="img" aria-label="ComfyUI Depth skeleton">\n${svgElements.join("\n")}\n</svg>`;
}

function computeDepthRange(skeletons: readonly ComfyUiDepthProjectedSkeleton[]): ComfyUiDepthRange | null {
  const depths = skeletons.flatMap((skeleton) =>
    skeleton.visibleJointIds.map((jointId) => skeleton.points[jointId].depth),
  ).filter((depth) => Number.isFinite(depth));

  if (depths.length === 0) {
    return null;
  }

  return {
    min: Math.min(...depths),
    max: Math.max(...depths),
  };
}

function depthIntensity(depth: number, range: ComfyUiDepthRange | null) {
  if (!range || range.max - range.min < 0.0001) {
    return 220;
  }

  const normalized = Math.max(0, Math.min(1, (depth - range.min) / (range.max - range.min)));
  return Math.round(235 - normalized * 175);
}

function gray(value: number) {
  const channel = Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
  return `#${channel}${channel}${channel}`;
}

function renderDepthSkeletonElements(
  skeleton: ComfyUiDepthProjectedSkeleton,
  range: ComfyUiDepthRange | null,
  strokeWidth: number,
  jointRadius: number,
) {
  const segments = OPENPOSE_SEGMENTS.map(([from, to]) => {
    const fromPoint = skeleton.points[from];
    const toPoint = skeleton.points[to];

    if (!fromPoint.visible || !toPoint.visible) {
      return null;
    }

    const depth = (fromPoint.depth + toPoint.depth) / 2;
    const color = gray(depthIntensity(depth, range));

    return {
      depth,
      element: `<line x1="${svgNumber(fromPoint.x)}" y1="${svgNumber(fromPoint.y)}" x2="${svgNumber(toPoint.x)}" y2="${svgNumber(toPoint.y)}" stroke="${color}" stroke-width="${svgNumber(strokeWidth)}" stroke-linecap="round" opacity="0.95" />`,
    };
  }).filter((item): item is { depth: number; element: string } => item !== null);
  const joints = OPENPOSE_JOINT_IDS.map((jointId) => {
    const point = skeleton.points[jointId];

    if (!point.visible) {
      return null;
    }

    const color = gray(depthIntensity(point.depth, range));

    return {
      depth: point.depth,
      element: `<circle cx="${svgNumber(point.x)}" cy="${svgNumber(point.y)}" r="${svgNumber(jointRadius)}" fill="${color}" opacity="0.98" />`,
    };
  }).filter((item): item is { depth: number; element: string } => item !== null);

  return [...segments, ...joints]
    .sort((left, right) => right.depth - left.depth)
    .map((item) => item.element);
}

export function buildComfyUiOpenPoseSceneSkeletonSvg(
  skeletons: readonly ComfyUiOpenPoseSceneSkeleton[],
  options: ComfyUiOpenPoseSceneSvgOptions,
): ComfyUiOpenPoseSceneSvgResult {
  const width = finitePositive(options.width, 1);
  const height = finitePositive(options.height, 1);
  const camera = createCamera({ ...options, width, height });
  const strokeWidth = finitePositive(options.strokeWidth ?? DEFAULT_STROKE_WIDTH, DEFAULT_STROKE_WIDTH);
  const jointRadius = finitePositive(options.jointRadius ?? DEFAULT_JOINT_RADIUS, DEFAULT_JOINT_RADIUS);
  const background = escapeSvgAttribute(options.background ?? DEFAULT_BACKGROUND);
  const projectedSkeletons = skeletons.map((skeleton) => projectSkeleton(skeleton, camera, width, height));
  const elements = projectedSkeletons.flatMap((skeleton, index) =>
    renderSkeletonElements(skeleton, index, strokeWidth, jointRadius),
  );

  return {
    svg: renderSvg(width, height, background, elements),
    skeletons: projectedSkeletons,
    visibleJointCount: projectedSkeletons.reduce((sum, skeleton) => sum + skeleton.visibleJointCount, 0),
    visibleSkeletonCount: projectedSkeletons.filter((skeleton) => skeleton.visibleJointCount > 0).length,
  };
}

export function buildComfyUiOpenPoseSkeletonSvg(
  pose: StickFigurePoseV1,
  options: ComfyUiOpenPoseSvgOptions,
): ComfyUiOpenPoseSvgResult {
  const sceneResult = buildComfyUiOpenPoseSceneSkeletonSvg(
    [
      {
        id: "skeleton",
        pose,
        characterTransform: options.characterTransform,
        headRotation3D: options.headRotation3D,
      },
    ],
    options,
  );
  const skeleton = sceneResult.skeletons[0];

  return {
    svg: sceneResult.svg,
    points: skeleton.points,
    headKeypoints: skeleton.headKeypoints,
    facePoints: skeleton.facePoints,
    visibleJointIds: skeleton.visibleJointIds,
  };
}

export function buildComfyUiDepthSceneSkeletonSvg(
  skeletons: readonly ComfyUiDepthSceneSkeleton[],
  options: ComfyUiDepthSceneSvgOptions,
): ComfyUiDepthSceneSvgResult {
  const width = finitePositive(options.width, 1);
  const height = finitePositive(options.height, 1);
  const camera = createCamera({ ...options, width, height });
  const strokeWidth = finitePositive(options.strokeWidth ?? DEFAULT_DEPTH_STROKE_WIDTH, DEFAULT_DEPTH_STROKE_WIDTH);
  const jointRadius = finitePositive(options.jointRadius ?? DEFAULT_DEPTH_JOINT_RADIUS, DEFAULT_DEPTH_JOINT_RADIUS);
  const background = escapeSvgAttribute(options.background ?? DEFAULT_BACKGROUND);
  const projectedSkeletons = skeletons.map((skeleton) => projectSkeleton(skeleton, camera, width, height));
  const depthRange = computeDepthRange(projectedSkeletons);
  const elements = projectedSkeletons.flatMap((skeleton) =>
    renderDepthSkeletonElements(skeleton, depthRange, strokeWidth, jointRadius),
  );

  return {
    svg: renderDepthSvg(width, height, background, elements),
    skeletons: projectedSkeletons,
    visibleJointCount: projectedSkeletons.reduce((sum, skeleton) => sum + skeleton.visibleJointCount, 0),
    visibleSkeletonCount: projectedSkeletons.filter((skeleton) => skeleton.visibleJointCount > 0).length,
    depthRange,
  };
}

export function buildComfyUiDepthSkeletonSvg(
  pose: StickFigurePoseV1,
  options: ComfyUiDepthSvgOptions,
): ComfyUiDepthSvgResult {
  const sceneResult = buildComfyUiDepthSceneSkeletonSvg(
    [
      {
        id: "skeleton",
        pose,
        characterTransform: options.characterTransform,
      },
    ],
    options,
  );
  const skeleton = sceneResult.skeletons[0];

  return {
    svg: sceneResult.svg,
    points: skeleton.points,
    visibleJointIds: skeleton.visibleJointIds,
    depthRange: sceneResult.depthRange,
  };
}
