import type { CharacterSkeleton, PromptTag, Scene, SceneForgeProject } from "@/shared/types";

const now = new Date("2026-01-01T00:00:00.000Z").toISOString();

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
    },
    { id: "torso", label: "躯干", promptTags: [] },
    { id: "leftUpperArm", label: "左上臂", promptTags: [] },
    { id: "leftForearm", label: "左前臂", promptTags: [] },
    { id: "rightUpperArm", label: "右上臂", promptTags: [] },
    { id: "rightForearm", label: "右前臂", promptTags: [] },
    { id: "leftThigh", label: "左大腿", promptTags: [] },
    { id: "leftShin", label: "左小腿", promptTags: [] },
    { id: "rightThigh", label: "右大腿", promptTags: [] },
    { id: "rightShin", label: "右小腿", promptTags: [] },
    { id: "leftHand", label: "左手", promptTags: [] },
    { id: "rightHand", label: "右手", promptTags: [] },
    { id: "leftFoot", label: "左脚", promptTags: [] },
    { id: "rightFoot", label: "右脚", promptTags: [] },
  ],
  promptTags: [],
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
    })),
    promptTags: character.promptTags.map(clonePromptTag),
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
    })),
    characters: scene.characters.map(cloneCharacter),
    promptTags: scene.promptTags.map(clonePromptTag),
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
