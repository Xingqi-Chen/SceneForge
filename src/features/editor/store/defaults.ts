import type {
  CharacterSkeleton,
  PromptTag,
  PromptTagCategory,
  Scene,
  SceneForgeProject,
} from "@/shared/types";

const now = new Date("2026-01-01T00:00:00.000Z").toISOString();

export const DEFAULT_PROMPT_CATEGORY_BINDINGS = {
  scene: ["style", "lighting", "quality", "scene", "negative"],
  object: ["scene", "lighting", "quality", "negative"],
  character: ["style", "lighting", "quality", "character", "negative"],
  bodyPart: ["body-part", "negative"],
} satisfies Record<string, PromptTagCategory[]>;

export const defaultCharacter: CharacterSkeleton = {
  id: "character-hero",
  name: "主角",
  description: "",
  position: { x: 420, y: 200 },
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
    },
    { id: "torso", label: "躯干", promptTags: [], promptCategoryBindings: [...DEFAULT_PROMPT_CATEGORY_BINDINGS.bodyPart] },
    { id: "leftUpperArm", label: "左上臂", promptTags: [], promptCategoryBindings: [...DEFAULT_PROMPT_CATEGORY_BINDINGS.bodyPart] },
    { id: "leftForearm", label: "左前臂", promptTags: [], promptCategoryBindings: [...DEFAULT_PROMPT_CATEGORY_BINDINGS.bodyPart] },
    { id: "rightUpperArm", label: "右上臂", promptTags: [], promptCategoryBindings: [...DEFAULT_PROMPT_CATEGORY_BINDINGS.bodyPart] },
    { id: "rightForearm", label: "右前臂", promptTags: [], promptCategoryBindings: [...DEFAULT_PROMPT_CATEGORY_BINDINGS.bodyPart] },
    { id: "leftThigh", label: "左大腿", promptTags: [], promptCategoryBindings: [...DEFAULT_PROMPT_CATEGORY_BINDINGS.bodyPart] },
    { id: "leftShin", label: "左小腿", promptTags: [], promptCategoryBindings: [...DEFAULT_PROMPT_CATEGORY_BINDINGS.bodyPart] },
    { id: "rightThigh", label: "右大腿", promptTags: [], promptCategoryBindings: [...DEFAULT_PROMPT_CATEGORY_BINDINGS.bodyPart] },
    { id: "rightShin", label: "右小腿", promptTags: [], promptCategoryBindings: [...DEFAULT_PROMPT_CATEGORY_BINDINGS.bodyPart] },
    { id: "leftHand", label: "左手", promptTags: [], promptCategoryBindings: [...DEFAULT_PROMPT_CATEGORY_BINDINGS.bodyPart] },
    { id: "rightHand", label: "右手", promptTags: [], promptCategoryBindings: [...DEFAULT_PROMPT_CATEGORY_BINDINGS.bodyPart] },
    { id: "leftFoot", label: "左脚", promptTags: [], promptCategoryBindings: [...DEFAULT_PROMPT_CATEGORY_BINDINGS.bodyPart] },
    { id: "rightFoot", label: "右脚", promptTags: [], promptCategoryBindings: [...DEFAULT_PROMPT_CATEGORY_BINDINGS.bodyPart] },
  ],
  promptTags: [],
  promptCategoryBindings: [...DEFAULT_PROMPT_CATEGORY_BINDINGS.character],
};

export const defaultScene: Scene = {
  id: "scene-default",
  name: "SceneForge 画布",
  description: "",
  canvas: {
    width: 1280,
    height: 720,
    aspectRatio: "16:9",
    background: "#f8fafc",
  },
  objects: [],
  characters: [],
  promptTags: [],
  promptCategoryBindings: [...DEFAULT_PROMPT_CATEGORY_BINDINGS.scene],
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
    joints: Object.fromEntries(
      Object.entries(character.joints).map(([jointId, position]) => [jointId, { ...position }]),
    ) as CharacterSkeleton["joints"],
    bodyParts: character.bodyParts.map((bodyPart) => ({
      ...bodyPart,
      promptTags: bodyPart.promptTags.map(clonePromptTag),
      promptCategoryBindings: bodyPart.promptCategoryBindings
        ? [...bodyPart.promptCategoryBindings]
        : undefined,
    })),
    promptTags: character.promptTags.map(clonePromptTag),
    promptCategoryBindings: character.promptCategoryBindings
      ? [...character.promptCategoryBindings]
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
      promptTags: object.promptTags.map(clonePromptTag),
      promptCategoryBindings: object.promptCategoryBindings
        ? [...object.promptCategoryBindings]
        : undefined,
    })),
    characters: scene.characters.map(cloneCharacter),
    promptTags: scene.promptTags.map(clonePromptTag),
    promptCategoryBindings: scene.promptCategoryBindings ? [...scene.promptCategoryBindings] : undefined,
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
