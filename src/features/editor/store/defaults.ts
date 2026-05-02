import type {
  CharacterSkeleton,
  JointId,
  PromptTag,
  PromptTagCategory,
  PromptTagSubcategory,
  PromptBindingState,
  Scene,
  SceneForgeProject,
  Vector2,
} from "@/shared/types";

const now = new Date("2026-01-01T00:00:00.000Z").toISOString();

/** 人物骨架（角色根与身体部位）默认只绑定「人物」「身体部位」两类词库类目。 */
export const DEFAULT_PROMPT_CATEGORY_BINDINGS = {
  scene: ["style", "lighting", "quality", "scene", "negative"],
  object: ["scene", "lighting", "quality", "negative"],
  character: ["character", "body-part"],
  bodyPart: ["character", "body-part"],
} satisfies Record<string, PromptTagCategory[]>;

/** 与人物 / 身体部位大类对应的默认子类目（骨架内统一使用）。 */
const CHARACTER_AND_BODY_PART_SUBCATEGORIES = [
  "character-subject",
  "character-clothing",
  "character-pose",
  "character-expression",
  "character-accessory",
  "body-part-hair",
  "body-part-eyes",
  "body-part-face",
  "body-part-hands",
  "body-part-legs",
  "body-part-body",
] as const satisfies readonly PromptTagSubcategory[];

export const DEFAULT_PROMPT_SUBCATEGORY_BINDINGS = {
  scene: [],
  object: [],
  character: [...CHARACTER_AND_BODY_PART_SUBCATEGORIES],
  bodyPart: [...CHARACTER_AND_BODY_PART_SUBCATEGORIES],
} satisfies Record<string, PromptTagSubcategory[]>;

export function createDefaultPromptBindingState(): PromptBindingState {
  return {
    scene: {
      promptCategoryBindings: [...DEFAULT_PROMPT_CATEGORY_BINDINGS.scene],
      promptSubcategoryBindings: [...DEFAULT_PROMPT_SUBCATEGORY_BINDINGS.scene],
    },
    object: {
      promptCategoryBindings: [...DEFAULT_PROMPT_CATEGORY_BINDINGS.object],
      promptSubcategoryBindings: [...DEFAULT_PROMPT_SUBCATEGORY_BINDINGS.object],
    },
    character: {
      promptCategoryBindings: [...DEFAULT_PROMPT_CATEGORY_BINDINGS.character],
      promptSubcategoryBindings: [...DEFAULT_PROMPT_SUBCATEGORY_BINDINGS.character],
    },
    bodyPart: {
      promptCategoryBindings: [...DEFAULT_PROMPT_CATEGORY_BINDINGS.bodyPart],
      promptSubcategoryBindings: [...DEFAULT_PROMPT_SUBCATEGORY_BINDINGS.bodyPart],
    },
  };
}

export const defaultCharacter: CharacterSkeleton = {
  id: "character-hero",
  name: "主角",
  description: "",
  position: { x: 420, y: 200 },
  transform3D: {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  },
  rotation: 0,
  includeInPrompt: true,
  joints: {
    neck: { x: 0, y: 24 },
    leftShoulder: { x: -36, y: 48 },
    rightShoulder: { x: 36, y: 48 },
    leftElbow: { x: -64, y: 108 },
    rightElbow: { x: 64, y: 108 },
    leftWrist: { x: -72, y: 168 },
    rightWrist: { x: 72, y: 168 },
    hip: { x: 0, y: 148 },
    leftKnee: { x: -28, y: 228 },
    rightKnee: { x: 28, y: 228 },
    leftAnkle: { x: -32, y: 308 },
    rightAnkle: { x: 32, y: 308 },
  },
  bodyParts: [
    {
      id: "head",
      label: "头部",
      promptTags: [],
      promptCategoryBindings: [...DEFAULT_PROMPT_CATEGORY_BINDINGS.bodyPart],
      promptSubcategoryBindings: [...DEFAULT_PROMPT_SUBCATEGORY_BINDINGS.bodyPart],
    },
    { id: "torso", label: "躯干", promptTags: [], promptCategoryBindings: [...DEFAULT_PROMPT_CATEGORY_BINDINGS.bodyPart], promptSubcategoryBindings: [...DEFAULT_PROMPT_SUBCATEGORY_BINDINGS.bodyPart] },
    { id: "leftUpperArm", label: "左上臂", promptTags: [], promptCategoryBindings: [...DEFAULT_PROMPT_CATEGORY_BINDINGS.bodyPart], promptSubcategoryBindings: [...DEFAULT_PROMPT_SUBCATEGORY_BINDINGS.bodyPart] },
    { id: "leftForearm", label: "左前臂", promptTags: [], promptCategoryBindings: [...DEFAULT_PROMPT_CATEGORY_BINDINGS.bodyPart], promptSubcategoryBindings: [...DEFAULT_PROMPT_SUBCATEGORY_BINDINGS.bodyPart] },
    { id: "rightUpperArm", label: "右上臂", promptTags: [], promptCategoryBindings: [...DEFAULT_PROMPT_CATEGORY_BINDINGS.bodyPart], promptSubcategoryBindings: [...DEFAULT_PROMPT_SUBCATEGORY_BINDINGS.bodyPart] },
    { id: "rightForearm", label: "右前臂", promptTags: [], promptCategoryBindings: [...DEFAULT_PROMPT_CATEGORY_BINDINGS.bodyPart], promptSubcategoryBindings: [...DEFAULT_PROMPT_SUBCATEGORY_BINDINGS.bodyPart] },
    { id: "leftThigh", label: "左大腿", promptTags: [], promptCategoryBindings: [...DEFAULT_PROMPT_CATEGORY_BINDINGS.bodyPart], promptSubcategoryBindings: [...DEFAULT_PROMPT_SUBCATEGORY_BINDINGS.bodyPart] },
    { id: "leftShin", label: "左小腿", promptTags: [], promptCategoryBindings: [...DEFAULT_PROMPT_CATEGORY_BINDINGS.bodyPart], promptSubcategoryBindings: [...DEFAULT_PROMPT_SUBCATEGORY_BINDINGS.bodyPart] },
    { id: "rightThigh", label: "右大腿", promptTags: [], promptCategoryBindings: [...DEFAULT_PROMPT_CATEGORY_BINDINGS.bodyPart], promptSubcategoryBindings: [...DEFAULT_PROMPT_SUBCATEGORY_BINDINGS.bodyPart] },
    { id: "rightShin", label: "右小腿", promptTags: [], promptCategoryBindings: [...DEFAULT_PROMPT_CATEGORY_BINDINGS.bodyPart], promptSubcategoryBindings: [...DEFAULT_PROMPT_SUBCATEGORY_BINDINGS.bodyPart] },
    { id: "leftHand", label: "左手", promptTags: [], promptCategoryBindings: [...DEFAULT_PROMPT_CATEGORY_BINDINGS.bodyPart], promptSubcategoryBindings: [...DEFAULT_PROMPT_SUBCATEGORY_BINDINGS.bodyPart] },
    { id: "rightHand", label: "右手", promptTags: [], promptCategoryBindings: [...DEFAULT_PROMPT_CATEGORY_BINDINGS.bodyPart], promptSubcategoryBindings: [...DEFAULT_PROMPT_SUBCATEGORY_BINDINGS.bodyPart] },
    { id: "leftFoot", label: "左脚", promptTags: [], promptCategoryBindings: [...DEFAULT_PROMPT_CATEGORY_BINDINGS.bodyPart], promptSubcategoryBindings: [...DEFAULT_PROMPT_SUBCATEGORY_BINDINGS.bodyPart] },
    { id: "rightFoot", label: "右脚", promptTags: [], promptCategoryBindings: [...DEFAULT_PROMPT_CATEGORY_BINDINGS.bodyPart], promptSubcategoryBindings: [...DEFAULT_PROMPT_SUBCATEGORY_BINDINGS.bodyPart] },
  ],
  promptTags: [],
  promptCategoryBindings: [...DEFAULT_PROMPT_CATEGORY_BINDINGS.character],
  promptSubcategoryBindings: [...DEFAULT_PROMPT_SUBCATEGORY_BINDINGS.character],
};

/** 3D mannequin 在 `joints3D` 未设置时的默认关节平面（与初始 `joints` 几何一致，但不随 2D `joints` 更新）。 */
export const defaultCharacterMannequinJointPlane: Record<JointId, Vector2> = Object.fromEntries(
  (Object.keys(defaultCharacter.joints) as JointId[]).map((jointId) => [
    jointId,
    { ...defaultCharacter.joints[jointId] },
  ]),
) as Record<JointId, Vector2>;

export const defaultScene: Scene = {
  id: "scene-default",
  name: "SceneForge 画布",
  description: "",
  mode: "2d",
  canvas: {
    width: 1280,
    height: 720,
    aspectRatio: "16:9",
    background: "#f8fafc",
  },
  three: {
    camera: {
      position: { x: 6, y: 5, z: 7 },
      target: { x: 0, y: 0.8, z: 0 },
      fov: 45,
    },
    lighting: {
      ambientIntensity: 0.65,
      directionalIntensity: 1.1,
      directionalPosition: { x: 5, y: 8, z: 4 },
    },
    grid: {
      size: 12,
      divisions: 12,
    },
  },
  objects: [],
  characters: [],
  promptTags: [],
  promptCategoryBindings: [...DEFAULT_PROMPT_CATEGORY_BINDINGS.scene],
  promptSubcategoryBindings: [...DEFAULT_PROMPT_SUBCATEGORY_BINDINGS.scene],
};

function clonePromptTag(tag: PromptTag): PromptTag {
  return {
    ...tag,
    weight: { ...tag.weight },
  };
}

function cloneCharacter(character: CharacterSkeleton): CharacterSkeleton {
  return {
    ...character,
    position: { ...character.position },
    transform3D: character.transform3D
      ? {
          position: { ...character.transform3D.position },
          rotation: { ...character.transform3D.rotation },
          scale: { ...character.transform3D.scale },
        }
      : undefined,
    joints: Object.fromEntries(
      Object.entries(character.joints).map(([jointId, position]) => [jointId, { ...position }]),
    ) as CharacterSkeleton["joints"],
    joints3D: character.joints3D
      ? (Object.fromEntries(
          Object.entries(character.joints3D).map(([jointId, position]) => [jointId, { ...position }]),
        ) as CharacterSkeleton["joints3D"])
      : undefined,
    bodyParts: character.bodyParts.map((bodyPart) => ({
      ...bodyPart,
      promptTags: bodyPart.promptTags.map(clonePromptTag),
      promptCategoryBindings: bodyPart.promptCategoryBindings
        ? [...bodyPart.promptCategoryBindings]
        : undefined,
      promptSubcategoryBindings: bodyPart.promptSubcategoryBindings
        ? [...bodyPart.promptSubcategoryBindings]
        : undefined,
    })),
    promptTags: character.promptTags.map(clonePromptTag),
    promptCategoryBindings: character.promptCategoryBindings
      ? [...character.promptCategoryBindings]
      : undefined,
    promptSubcategoryBindings: character.promptSubcategoryBindings
      ? [...character.promptSubcategoryBindings]
      : undefined,
  };
}

function cloneScene(scene: Scene): Scene {
  return {
    ...scene,
    canvas: { ...scene.canvas },
    objects: scene.objects.map((object) => ({
      ...object,
      position: { ...object.position },
      size: { ...object.size },
      weight: { ...object.weight },
      transform3D: object.transform3D
        ? {
            position: { ...object.transform3D.position },
            rotation: { ...object.transform3D.rotation },
            scale: { ...object.transform3D.scale },
          }
        : undefined,
      lineEndpoints: object.lineEndpoints ? { ...object.lineEndpoints } : undefined,
      polygonPoints: object.polygonPoints?.map((point) => ({ ...point })),
      promptTags: object.promptTags.map(clonePromptTag),
      promptCategoryBindings: object.promptCategoryBindings
        ? [...object.promptCategoryBindings]
        : undefined,
      promptSubcategoryBindings: object.promptSubcategoryBindings
        ? [...object.promptSubcategoryBindings]
        : undefined,
    })),
    three: {
      camera: {
        position: { ...scene.three.camera.position },
        target: { ...scene.three.camera.target },
        fov: scene.three.camera.fov,
      },
      lighting: {
        ambientIntensity: scene.three.lighting.ambientIntensity,
        directionalIntensity: scene.three.lighting.directionalIntensity,
        directionalPosition: { ...scene.three.lighting.directionalPosition },
      },
      grid: { ...scene.three.grid },
    },
    characters: scene.characters.map(cloneCharacter),
    promptTags: scene.promptTags.map(clonePromptTag),
    promptCategoryBindings: scene.promptCategoryBindings ? [...scene.promptCategoryBindings] : undefined,
    promptSubcategoryBindings: scene.promptSubcategoryBindings
      ? [...scene.promptSubcategoryBindings]
      : undefined,
  };
}

export function createDefaultProject(): SceneForgeProject {
  return {
    id: "project-default",
    name: "Untitled SceneForge Project",
    version: 1,
    scene: cloneScene(defaultScene),
    settings: {
      modelFormat: "generic",
      includeSpatialHints: true,
      negativePrompt: "low quality, blurry, extra fingers",
      promptLibraryTags: [],
      deletedBuiltInPromptLibraryTagIds: [],
    },
    createdAt: now,
    updatedAt: now,
  };
}
