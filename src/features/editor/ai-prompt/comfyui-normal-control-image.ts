import {
  BoxGeometry,
  CapsuleGeometry,
  Color,
  Euler,
  Group,
  Mesh,
  MeshNormalMaterial,
  PerspectiveCamera,
  Quaternion,
  Scene as ThreeScene,
  SphereGeometry,
  Vector3 as ThreeVector3,
  WebGLRenderer,
} from "three";

import { getCharacterStickFigurePose } from "@/features/editor/stick-figure-3d/get-character-stick-pose";
import type { CharacterSkeleton, Scene, SceneObject3DTransform } from "@/shared/types";
import type { StickFigurePoseV1 } from "@/shared/types/stick-figure-pose";
import { characterAppearsInThreeViewport } from "@/shared/utils/character-space";

export type ComfyUiNormalControlImageUnavailableReason =
  | "not-browser"
  | "scene-not-3d"
  | "no-3d-characters"
  | "webgl-unavailable"
  | "render-failed";

export type ComfyUiNormalControlImagePreview = {
  available: boolean;
  characterCount: number;
  error?: string;
  height: number;
  imageDataUrl: string | null;
  reason?: ComfyUiNormalControlImageUnavailableReason;
  width: number;
};

type NormalRendererLike = {
  dispose: () => void;
  forceContextLoss?: () => void;
  render: (scene: ThreeScene, camera: PerspectiveCamera) => void;
  setClearColor: (color: Color, alpha?: number) => void;
  setPixelRatio: (value: number) => void;
  setSize: (width: number, height: number, updateStyle?: boolean) => void;
};

export type ComfyUiNormalControlImageRendererFactory = (canvas: HTMLCanvasElement) => NormalRendererLike;

export type ComfyUiNormalControlImageRenderOptions = {
  createRenderer?: ComfyUiNormalControlImageRendererFactory;
  height: number;
  width: number;
};

const Y_UP = new ThreeVector3(0, 1, 0);
const DEG_TO_RAD = Math.PI / 180;

const DEFAULT_CHARACTER_TRANSFORM: SceneObject3DTransform = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
};

function normalizeDimension(value: number) {
  return Math.max(1, Math.round(value));
}

function toVector3(value: { x: number; y: number; z: number }) {
  return new ThreeVector3(value.x, value.y, value.z);
}

function boneQuat(from: ThreeVector3, to: ThreeVector3): Quaternion {
  const direction = new ThreeVector3().subVectors(to, from);
  const length = direction.length();

  if (length < 1e-8) {
    return new Quaternion();
  }

  direction.multiplyScalar(1 / length);
  return new Quaternion().setFromUnitVectors(Y_UP, direction);
}

function createCamera(scene: Scene, width: number, height: number) {
  const camera = new PerspectiveCamera(scene.three.camera.fov, width / height, 0.1, 1000);
  camera.position.copy(toVector3(scene.three.camera.position));
  camera.lookAt(toVector3(scene.three.camera.target));
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
}

function applyCharacterTransform(group: Group, transform: SceneObject3DTransform | undefined) {
  const resolved = transform ?? DEFAULT_CHARACTER_TRANSFORM;

  group.position.set(resolved.position.x, resolved.position.y, resolved.position.z);
  group.rotation.copy(new Euler(
    resolved.rotation.x * DEG_TO_RAD,
    resolved.rotation.y * DEG_TO_RAD,
    resolved.rotation.z * DEG_TO_RAD,
    "XYZ",
  ));
  group.scale.set(resolved.scale.x, resolved.scale.y, resolved.scale.z);
  group.updateMatrixWorld(true);
}

function addCapsule(
  group: Group,
  material: MeshNormalMaterial,
  pose: StickFigurePoseV1,
  fromKey: keyof StickFigurePoseV1["joints"],
  toKey: keyof StickFigurePoseV1["joints"],
  radius: number,
) {
  const from = toVector3(pose.joints[fromKey]);
  const to = toVector3(pose.joints[toKey]);
  const distance = from.distanceTo(to);
  const cylinderLength = Math.max(0.02, distance - 2 * radius);
  const geometry = new CapsuleGeometry(radius, cylinderLength, 6, 10);
  const mesh = new Mesh(geometry, material);

  mesh.position.copy(new ThreeVector3().addVectors(from, to).multiplyScalar(0.5));
  mesh.quaternion.copy(boneQuat(from, to));
  group.add(mesh);
}

function addSphere(
  group: Group,
  material: MeshNormalMaterial,
  pose: StickFigurePoseV1,
  jointKey: keyof StickFigurePoseV1["joints"],
  radius: number,
  widthSegments: number,
  heightSegments: number,
) {
  const geometry = new SphereGeometry(radius, widthSegments, heightSegments);
  const mesh = new Mesh(geometry, material);

  mesh.position.copy(toVector3(pose.joints[jointKey]));
  group.add(mesh);
}

function addFoot(
  group: Group,
  material: MeshNormalMaterial,
  pose: StickFigurePoseV1,
  jointKey: "leftFoot" | "rightFoot",
) {
  const foot = pose.joints[jointKey];
  const mesh = new Mesh(new BoxGeometry(0.14, 0.06, 0.22), material);

  mesh.position.set(foot.x, foot.y - 0.03, foot.z + 0.04);
  group.add(mesh);
}

function addCharacterMannequin(scene: ThreeScene, character: CharacterSkeleton, material: MeshNormalMaterial) {
  const pose = getCharacterStickFigurePose(character);
  const group = new Group();

  addCapsule(group, material, pose, "pelvis", "chest", 0.11);
  addCapsule(group, material, pose, "leftShoulder", "leftElbow", 0.048);
  addCapsule(group, material, pose, "leftElbow", "leftHand", 0.042);
  addCapsule(group, material, pose, "rightShoulder", "rightElbow", 0.048);
  addCapsule(group, material, pose, "rightElbow", "rightHand", 0.042);
  addCapsule(group, material, pose, "leftHip", "leftKnee", 0.055);
  addCapsule(group, material, pose, "leftKnee", "leftFoot", 0.048);
  addCapsule(group, material, pose, "rightHip", "rightKnee", 0.055);
  addCapsule(group, material, pose, "rightKnee", "rightFoot", 0.048);

  addSphere(group, material, pose, "pelvis", 0.095, 18, 18);
  addSphere(group, material, pose, "chest", 0.085, 18, 18);
  addSphere(group, material, pose, "leftShoulder", 0.07, 18, 18);
  addSphere(group, material, pose, "rightShoulder", 0.07, 18, 18);
  addSphere(group, material, pose, "leftHip", 0.07, 18, 18);
  addSphere(group, material, pose, "rightHip", 0.07, 18, 18);
  addSphere(group, material, pose, "head", 0.11, 20, 20);
  addSphere(group, material, pose, "leftHand", 0.055, 14, 14);
  addSphere(group, material, pose, "rightHand", 0.055, 14, 14);
  addFoot(group, material, pose, "leftFoot");
  addFoot(group, material, pose, "rightFoot");

  applyCharacterTransform(group, character.transform3D);
  scene.add(group);
}

function disposeScene(scene: ThreeScene) {
  scene.traverse((object) => {
    if (!(object instanceof Mesh)) {
      return;
    }

    object.geometry.dispose();
  });
}

function createDefaultRenderer(canvas: HTMLCanvasElement): NormalRendererLike {
  return new WebGLRenderer({
    alpha: false,
    antialias: true,
    canvas,
    preserveDrawingBuffer: true,
  });
}

export async function renderComfyUiNormalControlImage(
  scene: Scene,
  options: ComfyUiNormalControlImageRenderOptions,
): Promise<ComfyUiNormalControlImagePreview> {
  const width = normalizeDimension(options.width);
  const height = normalizeDimension(options.height);

  if (typeof document === "undefined") {
    return {
      available: false,
      characterCount: 0,
      height,
      imageDataUrl: null,
      reason: "not-browser",
      width,
    };
  }

  if (scene.mode !== "3d") {
    return {
      available: false,
      characterCount: 0,
      height,
      imageDataUrl: null,
      reason: "scene-not-3d",
      width,
    };
  }

  const characters = scene.characters.filter(characterAppearsInThreeViewport);
  if (characters.length === 0) {
    return {
      available: false,
      characterCount: 0,
      height,
      imageDataUrl: null,
      reason: "no-3d-characters",
      width,
    };
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  let renderer: NormalRendererLike | null = null;
  const normalScene = new ThreeScene();
  const material = new MeshNormalMaterial();

  try {
    renderer = options.createRenderer?.(canvas) ?? createDefaultRenderer(canvas);
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    renderer.setClearColor(new Color("#000000"), 1);

    for (const character of characters) {
      addCharacterMannequin(normalScene, character, material);
    }

    renderer.render(normalScene, createCamera(scene, width, height));

    return {
      available: true,
      characterCount: characters.length,
      height,
      imageDataUrl: canvas.toDataURL("image/png"),
      width,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to render normal ControlNet image.";
    const reason: ComfyUiNormalControlImageUnavailableReason = /webgl|context/i.test(message)
      ? "webgl-unavailable"
      : "render-failed";

    return {
      available: false,
      characterCount: characters.length,
      error: message,
      height,
      imageDataUrl: null,
      reason,
      width,
    };
  } finally {
    disposeScene(normalScene);
    material.dispose();
    renderer?.dispose();
    renderer?.forceContextLoss?.();
  }
}
