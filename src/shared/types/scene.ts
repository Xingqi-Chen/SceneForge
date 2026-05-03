import type { StickFigurePoseV1 } from "./stick-figure-pose";

export type Vector2 = {
  x: number;
  y: number;
};

export type Vector3 = {
  x: number;
  y: number;
  z: number;
};

export type Size2D = {
  width: number;
  height: number;
};

export type CanvasAspectRatio = "1:1" | "4:3" | "16:9" | "9:16";

export type CanvasConfig = {
  width: number;
  height: number;
  aspectRatio: CanvasAspectRatio;
  background: string;
};

export type PromptWeight = {
  value: number;
  enabled: boolean;
};

export type PromptTag = {
  id: string;
  label: string;
  prompt: string;
  category: PromptTagCategory;
  subcategory?: PromptTagSubcategory;
  weight: PromptWeight;
  negative?: boolean;
};

export type PromptTagCategory =
  | "style"
  | "lighting"
  | "scene"
  | "character"
  | "outfit"
  | "body-part"
  | "quality"
  | "negative";

export type PromptTagSubcategory =
  | "style-rendering"
  | "style-camera"
  | "style-composition"
  | "style-color"
  | "lighting-source"
  | "lighting-mood"
  | "lighting-shadow"
  | "quality-detail"
  | "quality-resolution"
  | "quality-finish"
  | "scene-environment"
  | "scene-weather"
  | "scene-background"
  | "scene-prop"
  | "character-subject"
  | "character-pose"
  | "character-expression"
  | "outfit-upper"
  | "outfit-lower"
  | "outfit-dress"
  | "outfit-footwear"
  | "outfit-accessory"
  | "outfit-full"
  | "body-part-hair"
  | "body-part-eyes"
  | "body-part-face"
  | "body-part-hands"
  | "body-part-legs"
  | "body-part-body"
  | "negative-quality"
  | "negative-anatomy"
  | "negative-artifact"
  | "negative-composition";

export type SceneObjectKind =
  | "rectangle"
  | "circle"
  | "ellipse"
  | "polygon"
  | "line"
  | "image-placeholder"
  | "preset"
  | "cube"
  | "sphere"
  | "cylinder"
  | "plane";

export type SceneMode = "2d" | "3d";

export type Scene3DConfig = {
  camera: {
    position: Vector3;
    target: Vector3;
    fov: number;
  };
  lighting: {
    ambientIntensity: number;
    directionalIntensity: number;
    directionalPosition: Vector3;
  };
  grid: {
    size: number;
    divisions: number;
  };
};

export type SceneObject3DTransform = {
  position: Vector3;
  rotation: Vector3;
  scale: Vector3;
};

/** Line segment in local space (origin at object `position`, same units as `size`). */
export type LineEndpoints = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export type SceneObject = {
  id: string;
  kind: SceneObjectKind;
  name: string;
  description: string;
  position: Vector2;
  size: Size2D;
  rotation: number;
  layer: number;
  fill: string;
  includeInPrompt: boolean;
  weight: PromptWeight;
  promptTags: PromptTag[];
  promptCategoryBindings?: PromptTagCategory[];
  promptSubcategoryBindings?: PromptTagSubcategory[];
  /** When `kind` is `"line"`, segment endpoints in local space. Defaults to horizontal midline across `size`. */
  lineEndpoints?: LineEndpoints;
  /** When `kind` is `"polygon"`, closed path vertices in local space (relative to `position`). */
  polygonPoints?: Vector2[];
  /** When `kind` is `"preset"`, stable id of the preset from the asset library. */
  presetKey?: string;
  /** Short label drawn on `image-placeholder` objects. */
  imageLabel?: string;
  /** 3D transform used by primitive 3D scene objects. 2D objects continue to use `position`, `size`, and `rotation`. */
  transform3D?: SceneObject3DTransform;
};

export type BodyPartId =
  | "head"
  | "torso"
  | "leftUpperArm"
  | "leftForearm"
  | "rightUpperArm"
  | "rightForearm"
  | "leftThigh"
  | "leftShin"
  | "rightThigh"
  | "rightShin"
  | "leftHand"
  | "rightHand"
  | "leftFoot"
  | "rightFoot";

export type JointId =
  | "neck"
  /** 躯干中点（颈—髋之间），用于 2D/3D 脊柱弯曲与低模躯干分段。 */
  | "spine"
  | "leftShoulder"
  | "rightShoulder"
  | "leftElbow"
  | "rightElbow"
  | "leftWrist"
  | "rightWrist"
  | "hip"
  | "leftKnee"
  | "rightKnee"
  | "leftAnkle"
  | "rightAnkle";

export type CharacterBodyPart = {
  id: BodyPartId;
  label: string;
  promptTags: PromptTag[];
  promptCategoryBindings?: PromptTagCategory[];
  promptSubcategoryBindings?: PromptTagSubcategory[];
};

/** 人体所属编辑视口；缺省表示旧数据，2D 与 3D 中都会显示。 */
export type CharacterSpace = "2d" | "3d";

export type CharacterSkeleton = {
  id: string;
  name: string;
  description: string;
  /** 若设置，则限制该人物仅参与对应视口的展示与选择。 */
  characterSpace?: CharacterSpace;
  position: Vector2;
  /** 3D root transform for the low-poly mannequin in 3D scene mode. */
  transform3D?: SceneObject3DTransform;
  /** Degrees, same convention as scene objects (Konva). */
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  /** 2D 画布关节（Konva）；仅由 2D 模式下的关节拖拽更新。 */
  joints: Record<JointId, Vector2>;
  /**
   * 3D 低模人体姿态：x/y 与 2D `joints` 同创作平面语义；`z` 为人体根局部空间深度（米），与 2D 独立。
   * 旧版 mannequin；新项目使用 `stickFigurePose3D`。加载时若仅有此项会迁移为 stick pose。
   */
  joints3D?: Record<JointId, Vector3>;
  /** 3D 火柴人 / 关节人姿态（根局部米、Y 上），含 IK 解算后的全关节位置。 */
  stickFigurePose3D?: StickFigurePoseV1;
  /**
   * 头部相对颈关节（`neck`）的欧拉角，单位度，旋转顺序 XYZ，与 3D 根节点 `transform3D.rotation` 约定一致。
   * 仅影响 3D 低模头部网格；未设置视为 0,0,0。
   */
  headRotation3D?: Vector3;
  /** 3D 模式下锁死四肢骨段长度：拖拽上述肢链关节时仅绕对端摆动，不改变骨长。 */
  limbLengthLocked3D?: boolean;
  bodyParts: CharacterBodyPart[];
  promptTags: PromptTag[];
  promptCategoryBindings?: PromptTagCategory[];
  promptSubcategoryBindings?: PromptTagSubcategory[];
  includeInPrompt: boolean;
};

export type Scene = {
  id: string;
  name: string;
  description: string;
  mode: SceneMode;
  canvas: CanvasConfig;
  three: Scene3DConfig;
  objects: SceneObject[];
  characters: CharacterSkeleton[];
  promptTags: PromptTag[];
  promptCategoryBindings?: PromptTagCategory[];
  promptSubcategoryBindings?: PromptTagSubcategory[];
};
