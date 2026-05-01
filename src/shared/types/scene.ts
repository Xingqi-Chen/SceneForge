export type Vector2 = {
  x: number;
  y: number;
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
  | "character-clothing"
  | "character-pose"
  | "character-expression"
  | "character-accessory"
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
  | "preset";

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

export type CharacterSkeleton = {
  id: string;
  name: string;
  description: string;
  position: Vector2;
  scaleX?: number;
  scaleY?: number;
  joints: Record<JointId, Vector2>;
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
  canvas: CanvasConfig;
  objects: SceneObject[];
  characters: CharacterSkeleton[];
  promptTags: PromptTag[];
  promptCategoryBindings?: PromptTagCategory[];
  promptSubcategoryBindings?: PromptTagSubcategory[];
};
