import type {
  CanvasAspectRatio,
  CanvasConfig,
  CharacterSkeleton,
  JointId,
  LineEndpoints,
  PromptBindingState,
  PromptBindingTargetKind,
  PromptTag,
  PromptTagCategory,
  PromptTagSubcategory,
  SavedComfyUiGeneratedImage,
  Scene,
  SceneForgeProject,
  SceneObject,
  Vector2,
  Vector3,
} from "@/shared/types";

import {
  DEFAULT_PROMPT_CATEGORY_BINDINGS,
  DEFAULT_PROMPT_SUBCATEGORY_BINDINGS,
  createDefaultPromptBindingState,
  createDefaultStickFigurePoseV1,
  defaultCharacter,
  defaultCharacterMannequinJoints3D,
  defaultScene,
} from "@/features/editor/store/defaults";
import {
  COMFYUI_FACE_DETAILER_DEFAULTS,
  COMFYUI_FACE_DETAILER_SAM_DETECTION_HINT_OPTIONS,
  COMFYUI_FACE_DETAILER_SAM_MASK_HINT_USE_NEGATIVE_OPTIONS,
  DEFAULT_COMFYUI_FACE_DETAILER_DETECTOR_MODEL,
  DEFAULT_COMFYUI_HAND_DETAILER_DETECTOR_MODEL,
} from "@/features/comfyui/face-detailer";
import { migrateAuthoringJoints3DToStickFigure } from "@/features/editor/stick-figure-3d/migrate-legacy-joints3d";
import { sanitizeStickFigurePoseV1 } from "@/features/editor/stick-figure-3d/stick-figure-pose-io";
import { defaultLineEndpoints, defaultPolygonPoints } from "@/features/editor/preset-scene-objects";
import {
  PROMPT_TAG_CATEGORY_ORDER,
  PROMPT_TAG_SUBCATEGORY_OPTIONS,
  coercePersistedPromptTag,
  migrateLegacyPromptBindingArrays,
} from "@/features/prompt-engine/prompt-library/prompt-tag-taxonomy";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** 同一列表内按 `id` 保留首次出现项，避免导入或合并产生重复条目。 */
function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const item of items) {
    if (
      item == null ||
      typeof item !== "object" ||
      typeof item.id !== "string" ||
      !item.id ||
      seen.has(item.id)
    ) {
      continue;
    }

    seen.add(item.id);
    result.push(item);
  }

  return result;
}

/** 将不信任来源的单条词库标签修补为安全结构；无法识别则丢弃。 */
function sanitizePromptLibraryTagEntry(raw: unknown): PromptTag | null {
  return coercePersistedPromptTag(raw);
}

function isExportBundleVersion(value: unknown): boolean {
  return value === 1 || value === "1";
}

function dedupePromptTags(tags: PromptTag[]): PromptTag[] {
  return dedupeById(tags);
}

function sanitizeStringIdList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const result: string[] = [];

  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }

    const id = entry.trim();
    if (!id || seen.has(id)) {
      continue;
    }

    seen.add(id);
    result.push(id);
  }

  return result;
}

function sanitizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const result: string[] = [];

  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }

    const text = entry.trim();
    if (!text || seen.has(text)) {
      continue;
    }

    seen.add(text);
    result.push(text);
  }

  return result;
}

const PROMPT_EXPORT_KIND = "sceneforge-prompt";
const COMFYUI_GENERATED_IMAGE_HISTORY_LIMIT = 200;
const COMFYUI_MANAGED_GENERATED_IMAGE_ROUTE_PREFIX = "/api/comfyui/generated-images/";
const COMFYUI_MANAGED_GENERATED_IMAGE_FILENAME_PATTERN = /^[a-f0-9]{32}\.(?:gif|jpg|jpeg|png|webp)$/i;

/** 画布（场景）专用 JSON 导出，`importCanvasBundleFromJson` 与之配对。 */
export const SCENEFORGE_CANVAS_EXPORT_KIND = "sceneforge-canvas" as const;

/** 自定义 Prompt 词库专用 JSON 导出，`importPromptLibraryBundleFromJson` 与之配对。 */
export const SCENEFORGE_PROMPT_LIBRARY_EXPORT_KIND = "sceneforge-prompt-library" as const;

export type CanvasExportFile = {
  kind: typeof SCENEFORGE_CANVAS_EXPORT_KIND;
  version: 1;
  scene: Scene;
};

export type PromptLibraryExportFile = {
  kind: typeof SCENEFORGE_PROMPT_LIBRARY_EXPORT_KIND;
  version: 1;
  promptLibraryTags: SceneForgeProject["settings"]["promptLibraryTags"];
  deletedBuiltInPromptLibraryTagIds: SceneForgeProject["settings"]["deletedBuiltInPromptLibraryTagIds"];
};

const canvasAspectRatios = new Set<CanvasAspectRatio>(["1:1", "4:3", "16:9", "9:16"]);

function sanitizeCanvas(canvas: unknown): CanvasConfig {
  if (!isRecord(canvas)) {
    return { width: 1280, height: 720, aspectRatio: "16:9", background: "#f8fafc" };
  }

  const aspectRatio = canvas.aspectRatio;
  const ar: CanvasAspectRatio =
    typeof aspectRatio === "string" && canvasAspectRatios.has(aspectRatio as CanvasAspectRatio)
      ? (aspectRatio as CanvasAspectRatio)
      : "16:9";

  return {
    width: typeof canvas.width === "number" && Number.isFinite(canvas.width) ? canvas.width : 1280,
    height: typeof canvas.height === "number" && Number.isFinite(canvas.height) ? canvas.height : 720,
    aspectRatio: ar,
    background: typeof canvas.background === "string" ? canvas.background : "#f8fafc",
  };
}

function sanitizeWeight(raw: unknown): SceneObject["weight"] {
  if (!isRecord(raw)) {
    return { enabled: false, value: 1 };
  }

  const value = typeof raw.value === "number" && Number.isFinite(raw.value) ? raw.value : 1;
  const enabled = typeof raw.enabled === "boolean" ? raw.enabled : false;

  return { value, enabled };
}

const SCENE_OBJECT_KINDS = new Set<SceneObject["kind"]>([
  "rectangle",
  "circle",
  "ellipse",
  "polygon",
  "line",
  "image-placeholder",
  "preset",
  "cube",
  "sphere",
  "cylinder",
  "plane",
]);

function coerceSceneObjectKind(value: unknown): SceneObject["kind"] {
  if (typeof value === "string" && SCENE_OBJECT_KINDS.has(value as SceneObject["kind"])) {
    return value as SceneObject["kind"];
  }

  return "rectangle";
}

function sanitizeVector2Point(raw: unknown): Vector2 | null {
  if (!isRecord(raw)) {
    return null;
  }

  if (
    typeof raw.x !== "number" ||
    typeof raw.y !== "number" ||
    !Number.isFinite(raw.x) ||
    !Number.isFinite(raw.y)
  ) {
    return null;
  }

  return { x: raw.x, y: raw.y };
}

function sanitizeVector3Point(raw: unknown, fallback: Vector3): Vector3 {
  if (!isRecord(raw)) {
    return { ...fallback };
  }

  return {
    x: typeof raw.x === "number" && Number.isFinite(raw.x) ? raw.x : fallback.x,
    y: typeof raw.y === "number" && Number.isFinite(raw.y) ? raw.y : fallback.y,
    z: typeof raw.z === "number" && Number.isFinite(raw.z) ? raw.z : fallback.z,
  };
}

function sanitizeNumberInRange(raw: unknown, fallback: number, min: number, max: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, raw));
}

function sanitizeScene3DConfig(raw: unknown): Scene["three"] {
  const fallback = defaultScene.three;

  if (!isRecord(raw)) {
    return {
      camera: {
        position: { ...fallback.camera.position },
        target: { ...fallback.camera.target },
        fov: fallback.camera.fov,
      },
      lighting: {
        ambientIntensity: fallback.lighting.ambientIntensity,
        directionalIntensity: fallback.lighting.directionalIntensity,
        directionalPosition: { ...fallback.lighting.directionalPosition },
      },
      grid: { ...fallback.grid },
    };
  }

  const camera = isRecord(raw.camera) ? raw.camera : {};
  const lighting = isRecord(raw.lighting) ? raw.lighting : {};
  const grid = isRecord(raw.grid) ? raw.grid : {};

  return {
    camera: {
      position: sanitizeVector3Point(camera.position, fallback.camera.position),
      target: sanitizeVector3Point(camera.target, fallback.camera.target),
      fov: sanitizeNumberInRange(camera.fov, fallback.camera.fov, 15, 100),
    },
    lighting: {
      ambientIntensity: sanitizeNumberInRange(
        lighting.ambientIntensity,
        fallback.lighting.ambientIntensity,
        0,
        2,
      ),
      directionalIntensity: sanitizeNumberInRange(
        lighting.directionalIntensity,
        fallback.lighting.directionalIntensity,
        0,
        3,
      ),
      directionalPosition: sanitizeVector3Point(
        lighting.directionalPosition,
        fallback.lighting.directionalPosition,
      ),
    },
    grid: {
      size: sanitizeNumberInRange(grid.size, fallback.grid.size, 2, 100),
      divisions: Math.round(
        sanitizeNumberInRange(grid.divisions, fallback.grid.divisions, 2, 100),
      ),
    },
  };
}

function sanitizeObject3DTransform(raw: unknown): SceneObject["transform3D"] {
  const fallback = {
    position: { x: 0, y: 0.5, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  };

  if (!isRecord(raw)) {
    return fallback;
  }

  return {
    position: sanitizeVector3Point(raw.position, fallback.position),
    rotation: sanitizeVector3Point(raw.rotation, fallback.rotation),
    scale: sanitizeVector3Point(raw.scale, fallback.scale),
  };
}

function sanitizeCharacter3DTransform(raw: unknown): CharacterSkeleton["transform3D"] {
  const fallback = defaultCharacter.transform3D;

  if (!isRecord(raw) || !fallback) {
    return undefined;
  }

  return {
    position: sanitizeVector3Point(raw.position, fallback.position),
    rotation: sanitizeVector3Point(raw.rotation, fallback.rotation),
    scale: sanitizeVector3Point(raw.scale, fallback.scale),
  };
}

function sanitizeHeadRotation3D(raw: unknown): CharacterSkeleton["headRotation3D"] {
  if (!isRecord(raw)) {
    return undefined;
  }

  const clampAxis = (value: unknown, min: number, max: number): number => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return 0;
    }

    return Math.min(max, Math.max(min, value));
  };

  return {
    x: clampAxis(raw.x, -90, 90),
    y: clampAxis(raw.y, -120, 120),
    z: clampAxis(raw.z, -90, 90),
  };
}

function sanitizeLineEndpoints(raw: unknown, width: number, height: number): LineEndpoints {
  if (!isRecord(raw)) {
    return defaultLineEndpoints(width, height);
  }

  const x1 = typeof raw.x1 === "number" && Number.isFinite(raw.x1) ? raw.x1 : 0;
  const y1 = typeof raw.y1 === "number" && Number.isFinite(raw.y1) ? raw.y1 : 0;
  const x2 = typeof raw.x2 === "number" && Number.isFinite(raw.x2) ? raw.x2 : width;
  const y2 = typeof raw.y2 === "number" && Number.isFinite(raw.y2) ? raw.y2 : 0;

  return { x1, y1, x2, y2 };
}

function sanitizePolygonPointsArray(raw: unknown, width: number, height: number): Vector2[] {
  if (!Array.isArray(raw)) {
    return defaultPolygonPoints(width, height);
  }

  const points: Vector2[] = [];

  for (const entry of raw.slice(0, 48)) {
    const point = sanitizeVector2Point(entry);
    if (point) {
      points.push(point);
    }
  }

  return points.length >= 3 ? points : defaultPolygonPoints(width, height);
}

function sanitizePromptCategoryBindings(
  raw: unknown,
  fallback: PromptTagCategory[],
): PromptTagCategory[] {
  if (!Array.isArray(raw)) {
    return [...fallback];
  }

  const allowed = new Set<PromptTagCategory>(PROMPT_TAG_CATEGORY_ORDER);
  const seen = new Set<PromptTagCategory>();
  const categories = raw.filter((value): value is PromptTagCategory => {
    if (typeof value !== "string" || !allowed.has(value as PromptTagCategory)) {
      return false;
    }

    const category = value as PromptTagCategory;
    if (seen.has(category)) {
      return false;
    }

    seen.add(category);
    return true;
  });

  return categories.length > 0 ? categories : [...fallback];
}

function getPromptSubcategoryCategory(subcategory: PromptTagSubcategory) {
  return PROMPT_TAG_CATEGORY_ORDER.find((category) =>
    PROMPT_TAG_SUBCATEGORY_OPTIONS[category].includes(subcategory),
  );
}

function sanitizePromptSubcategoryBindings(
  raw: unknown,
  categories: PromptTagCategory[],
  fallback: PromptTagSubcategory[],
): PromptTagSubcategory[] {
  if (!Array.isArray(raw)) {
    return [...fallback];
  }

  const categorySet = new Set(categories);
  const allowed = new Set<PromptTagSubcategory>(
    Object.values(PROMPT_TAG_SUBCATEGORY_OPTIONS).flat(),
  );
  const seen = new Set<PromptTagSubcategory>();
  const subcategories = raw.filter((value): value is PromptTagSubcategory => {
    if (typeof value !== "string" || !allowed.has(value as PromptTagSubcategory)) {
      return false;
    }

    const subcategory = value as PromptTagSubcategory;
    const category = getPromptSubcategoryCategory(subcategory);
    if (!category || !categorySet.has(category) || seen.has(subcategory)) {
      return false;
    }

    seen.add(subcategory);
    return true;
  });

  return subcategories.length > 0 ? subcategories : [...fallback];
}

function sanitizeSceneObject(raw: unknown): SceneObject | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || !raw.id) {
    return null;
  }

  const position =
    isRecord(raw.position) &&
    typeof raw.position.x === "number" &&
    typeof raw.position.y === "number" &&
    Number.isFinite(raw.position.x) &&
    Number.isFinite(raw.position.y)
      ? { x: raw.position.x, y: raw.position.y }
      : { x: 0, y: 0 };

  const size =
    isRecord(raw.size) &&
    typeof raw.size.width === "number" &&
    typeof raw.size.height === "number" &&
    Number.isFinite(raw.size.width) &&
    Number.isFinite(raw.size.height)
      ? { width: raw.size.width, height: raw.size.height }
      : { width: 120, height: 120 };

  const kind = coerceSceneObjectKind(raw.kind);

  const promptTagsRaw = Array.isArray(raw.promptTags) ? raw.promptTags : [];
  const promptTags = dedupePromptTags(
    promptTagsRaw.map((t) => coercePersistedPromptTag(t)).filter((tag): tag is PromptTag => tag !== null),
  );

  const promptCategoryBindings = sanitizePromptCategoryBindings(
    raw.promptCategoryBindings,
    DEFAULT_PROMPT_CATEGORY_BINDINGS.object,
  );

  const base: SceneObject = {
    id: raw.id,
    kind,
    name: typeof raw.name === "string" ? raw.name : "对象",
    description: typeof raw.description === "string" ? raw.description : "",
    position,
    size,
    rotation: typeof raw.rotation === "number" && Number.isFinite(raw.rotation) ? raw.rotation : 0,
    layer: typeof raw.layer === "number" && Number.isFinite(raw.layer) ? raw.layer : 0,
    fill: typeof raw.fill === "string" ? raw.fill : "#e2e8f0",
    includeInPrompt: typeof raw.includeInPrompt === "boolean" ? raw.includeInPrompt : true,
    weight: sanitizeWeight(raw.weight),
    promptTags,
    promptCategoryBindings,
    promptSubcategoryBindings: sanitizePromptSubcategoryBindings(
      raw.promptSubcategoryBindings,
      promptCategoryBindings,
      DEFAULT_PROMPT_SUBCATEGORY_BINDINGS.object,
    ),
  };

  if (kind === "line") {
    return {
      ...base,
      lineEndpoints: sanitizeLineEndpoints(raw.lineEndpoints, size.width, size.height),
    };
  }

  if (kind === "polygon") {
    return {
      ...base,
      polygonPoints: sanitizePolygonPointsArray(raw.polygonPoints, size.width, size.height),
    };
  }

  if (kind === "preset") {
    const presetKey = typeof raw.presetKey === "string" && raw.presetKey.trim() ? raw.presetKey.trim() : undefined;
    const transform3D = isRecord(raw.transform3D)
      ? { transform3D: sanitizeObject3DTransform(raw.transform3D) }
      : {};

    return presetKey ? { ...base, presetKey, ...transform3D } : { ...base, ...transform3D };
  }

  if (kind === "image-placeholder") {
    const imageLabel =
      typeof raw.imageLabel === "string" && raw.imageLabel.trim() ? raw.imageLabel.trim() : "Image";
    return { ...base, imageLabel };
  }

  if (kind === "cube" || kind === "sphere" || kind === "cylinder" || kind === "plane") {
    return { ...base, transform3D: sanitizeObject3DTransform(raw.transform3D) };
  }

  return base;
}

function sanitizeCharacter(raw: unknown): CharacterSkeleton | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || !raw.id) {
    return null;
  }

  const position =
    isRecord(raw.position) &&
    typeof raw.position.x === "number" &&
    typeof raw.position.y === "number" &&
    Number.isFinite(raw.position.x) &&
    Number.isFinite(raw.position.y)
      ? { x: raw.position.x, y: raw.position.y }
      : { x: 0, y: 0 };

  const joints = Object.fromEntries(
    (Object.keys(defaultCharacter.joints) as JointId[]).map((jointId) => {
      const j = isRecord(raw.joints) ? raw.joints[jointId] : undefined;
      if (
        isRecord(j) &&
        typeof j.x === "number" &&
        typeof j.y === "number" &&
        Number.isFinite(j.x) &&
        Number.isFinite(j.y)
      ) {
        return [jointId, { x: j.x, y: j.y }];
      }

      return [jointId, { ...defaultCharacter.joints[jointId] }];
    }),
  ) as CharacterSkeleton["joints"];

  const joints3DSource = isRecord(raw.joints3D) ? raw.joints3D : undefined;
  const joints3D: CharacterSkeleton["joints3D"] | undefined = joints3DSource
    ? (Object.fromEntries(
        (Object.keys(defaultCharacter.joints) as JointId[]).map((jointId) => {
          const j = joints3DSource[jointId];
          const fallback = defaultCharacterMannequinJoints3D[jointId];

          if (
            isRecord(j) &&
            typeof j.x === "number" &&
            typeof j.y === "number" &&
            Number.isFinite(j.x) &&
            Number.isFinite(j.y)
          ) {
            const zRaw = j.z;
            const z =
              typeof zRaw === "number" && Number.isFinite(zRaw) ? zRaw : fallback.z;

            return [jointId, { x: j.x, y: j.y, z }];
          }

          return [jointId, { ...fallback }];
        }),
      ) as CharacterSkeleton["joints3D"])
    : undefined;

  const headRotation3D = sanitizeHeadRotation3D(raw.headRotation3D);

  const bodyPartsRaw =
    Array.isArray(raw.bodyParts) && raw.bodyParts.length > 0
      ? (raw.bodyParts as CharacterSkeleton["bodyParts"])
      : defaultCharacter.bodyParts.map((bodyPart) => ({
          ...bodyPart,
          promptTags: bodyPart.promptTags.map((tag) => ({ ...tag, weight: { ...tag.weight } })),
        }));

  const bodyParts = bodyPartsRaw.map((bodyPart) => {
    const migratedBp = migrateLegacyPromptBindingArrays(
      bodyPart.promptCategoryBindings,
      bodyPart.promptSubcategoryBindings,
    );
    const promptCategoryBindings = sanitizePromptCategoryBindings(
      migratedBp.categoriesRaw,
      DEFAULT_PROMPT_CATEGORY_BINDINGS.bodyPart,
    );

    const partTagsRaw = Array.isArray(bodyPart.promptTags) ? bodyPart.promptTags : [];

    return {
      ...bodyPart,
      promptTags: dedupePromptTags(
        partTagsRaw.map((t) => coercePersistedPromptTag(t)).filter((tag): tag is PromptTag => tag !== null),
      ),
      promptCategoryBindings,
      promptSubcategoryBindings: sanitizePromptSubcategoryBindings(
        migratedBp.subcategoriesRaw,
        promptCategoryBindings,
        DEFAULT_PROMPT_SUBCATEGORY_BINDINGS.bodyPart,
      ),
    };
  });

  const charPromptTags = Array.isArray(raw.promptTags) ? raw.promptTags : [];
  const migratedCharBindings = migrateLegacyPromptBindingArrays(
    raw.promptCategoryBindings,
    raw.promptSubcategoryBindings,
  );
  const promptCategoryBindings = sanitizePromptCategoryBindings(
    migratedCharBindings.categoriesRaw,
    DEFAULT_PROMPT_CATEGORY_BINDINGS.character,
  );

  const characterSpaceRaw = raw.characterSpace;
  const characterSpace: CharacterSkeleton["characterSpace"] | undefined =
    characterSpaceRaw === "2d" || characterSpaceRaw === "3d" ? characterSpaceRaw : undefined;

  const limbLengthLocked3D =
    typeof raw.limbLengthLocked3D === "boolean" ? raw.limbLengthLocked3D : undefined;

  const defaultStick = createDefaultStickFigurePoseV1();
  const stickRaw = raw.stickFigurePose3D;
  let stickFigurePose3D: CharacterSkeleton["stickFigurePose3D"] | undefined;
  let joints3DOut: CharacterSkeleton["joints3D"] | undefined = joints3D;

  if (isRecord(stickRaw) && stickRaw.version === 1) {
    stickFigurePose3D = sanitizeStickFigurePoseV1(stickRaw, defaultStick);
    joints3DOut = undefined;
  } else if (joints3D) {
    stickFigurePose3D = migrateAuthoringJoints3DToStickFigure(joints3D);
    joints3DOut = undefined;
  }

  return {
    id: raw.id,
    name: typeof raw.name === "string" ? raw.name : "人物",
    description: typeof raw.description === "string" ? raw.description : "",
    position,
    ...(characterSpace ? { characterSpace } : {}),
    transform3D: sanitizeCharacter3DTransform(raw.transform3D),
    rotation:
      typeof raw.rotation === "number" && Number.isFinite(raw.rotation) ? raw.rotation : undefined,
    scaleX: typeof raw.scaleX === "number" && Number.isFinite(raw.scaleX) ? raw.scaleX : undefined,
    scaleY: typeof raw.scaleY === "number" && Number.isFinite(raw.scaleY) ? raw.scaleY : undefined,
    joints,
    ...(joints3DOut ? { joints3D: joints3DOut } : {}),
    ...(stickFigurePose3D ? { stickFigurePose3D } : {}),
    ...(headRotation3D ? { headRotation3D } : {}),
    ...(limbLengthLocked3D !== undefined ? { limbLengthLocked3D } : {}),
    bodyParts,
    promptTags: dedupePromptTags(
      charPromptTags.map((t) => coercePersistedPromptTag(t)).filter((tag): tag is PromptTag => tag !== null),
    ),
    promptCategoryBindings,
    promptSubcategoryBindings: sanitizePromptSubcategoryBindings(
      migratedCharBindings.subcategoriesRaw,
      promptCategoryBindings,
      DEFAULT_PROMPT_SUBCATEGORY_BINDINGS.character,
    ),
    includeInPrompt: typeof raw.includeInPrompt === "boolean" ? raw.includeInPrompt : true,
  };
}

function sanitizeScene(scene: unknown): Scene {
  if (!isRecord(scene)) {
    return {
      id: "scene-imported",
      name: "SceneForge 画布",
      description: "",
      mode: "2d",
      canvas: sanitizeCanvas(undefined),
      three: sanitizeScene3DConfig(undefined),
      objects: [],
      characters: [],
      promptTags: [],
      promptCategoryBindings: [...DEFAULT_PROMPT_CATEGORY_BINDINGS.scene],
      promptSubcategoryBindings: [...DEFAULT_PROMPT_SUBCATEGORY_BINDINGS.scene],
    };
  }

  const objectsRaw = Array.isArray(scene.objects) ? scene.objects : [];
  const charactersRaw = Array.isArray(scene.characters) ? scene.characters : [];

  const objects = dedupeById(
    objectsRaw.map(sanitizeSceneObject).filter((o): o is SceneObject => o !== null),
  );
  const characters = dedupeById(
    charactersRaw.map(sanitizeCharacter).filter((c): c is CharacterSkeleton => c !== null),
  );
  const scenePromptTagsRaw = Array.isArray(scene.promptTags) ? scene.promptTags : [];
  const scenePromptTags = dedupePromptTags(
    scenePromptTagsRaw.map((t) => coercePersistedPromptTag(t)).filter((tag): tag is PromptTag => tag !== null),
  );
  const promptCategoryBindings = sanitizePromptCategoryBindings(
    scene.promptCategoryBindings,
    DEFAULT_PROMPT_CATEGORY_BINDINGS.scene,
  );

  return {
    id: typeof scene.id === "string" && scene.id ? scene.id : "scene-imported",
    name: typeof scene.name === "string" ? scene.name : "SceneForge 画布",
    description: typeof scene.description === "string" ? scene.description : "",
    mode: scene.mode === "3d" ? "3d" : "2d",
    canvas: sanitizeCanvas(scene.canvas),
    three: sanitizeScene3DConfig(scene.three),
    objects,
    characters,
    promptTags: scenePromptTags,
    promptCategoryBindings,
    promptSubcategoryBindings: sanitizePromptSubcategoryBindings(
      scene.promptSubcategoryBindings,
      promptCategoryBindings,
      DEFAULT_PROMPT_SUBCATEGORY_BINDINGS.scene,
    ),
  };
}

function sanitizePositiveInteger(raw: unknown, fallback: number): number {
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? Math.round(raw) : fallback;
}

function sanitizeFiniteNumber(raw: unknown, fallback: number): number {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
}

function sanitizeNumberInRangeLoose(raw: unknown, fallback: number, min: number, max: number): number {
  return typeof raw === "number" && Number.isFinite(raw)
    ? Math.min(max, Math.max(min, raw))
    : fallback;
}

function sanitizeIntegerInRangeLoose(raw: unknown, fallback: number, min: number, max: number): number {
  return Math.round(sanitizeNumberInRangeLoose(raw, fallback, min, max));
}

function sanitizeOptionValue<T extends string>(
  raw: unknown,
  fallback: T,
  options: readonly { value: T }[],
): T {
  return typeof raw === "string" ? options.find((option) => option.value === raw)?.value ?? fallback : fallback;
}

function sanitizeSavedDetailerParams(rawDetailer: unknown, rawGenerationParams: Record<string, unknown>, defaultDetectorModel: string) {
  if (!isRecord(rawDetailer)) {
    return undefined;
  }

  return {
    bboxCropFactor: sanitizeNumberInRangeLoose(
      rawDetailer.bboxCropFactor,
      COMFYUI_FACE_DETAILER_DEFAULTS.bboxCropFactor,
      1,
      10,
    ),
    bboxDilation: sanitizeIntegerInRangeLoose(
      rawDetailer.bboxDilation,
      COMFYUI_FACE_DETAILER_DEFAULTS.bboxDilation,
      -512,
      512,
    ),
    bboxThreshold: sanitizeNumberInRangeLoose(
      rawDetailer.bboxThreshold,
      COMFYUI_FACE_DETAILER_DEFAULTS.bboxThreshold,
      0,
      1,
    ),
    cfg: sanitizeFiniteNumber(rawDetailer.cfg, sanitizeFiniteNumber(rawGenerationParams.cfg, 7)),
    cycle: sanitizeIntegerInRangeLoose(rawDetailer.cycle, COMFYUI_FACE_DETAILER_DEFAULTS.cycle, 1, 10),
    denoise: sanitizeNumberInRangeLoose(rawDetailer.denoise, COMFYUI_FACE_DETAILER_DEFAULTS.denoise, 0, 1),
    enabled: rawDetailer.enabled === true,
    detectorModelName: typeof rawDetailer.detectorModelName === "string" && rawDetailer.detectorModelName.trim()
      ? rawDetailer.detectorModelName.trim()
      : defaultDetectorModel,
    dropSize: sanitizeIntegerInRangeLoose(rawDetailer.dropSize, COMFYUI_FACE_DETAILER_DEFAULTS.dropSize, 1, 16384),
    feather: sanitizeIntegerInRangeLoose(rawDetailer.feather, COMFYUI_FACE_DETAILER_DEFAULTS.feather, 0, 100),
    forceInpaint: typeof rawDetailer.forceInpaint === "boolean"
      ? rawDetailer.forceInpaint
      : COMFYUI_FACE_DETAILER_DEFAULTS.forceInpaint,
    guideSize: sanitizeNumberInRangeLoose(rawDetailer.guideSize, COMFYUI_FACE_DETAILER_DEFAULTS.guideSize, 64, 16384),
    guideSizeFor: typeof rawDetailer.guideSizeFor === "boolean"
      ? rawDetailer.guideSizeFor
      : COMFYUI_FACE_DETAILER_DEFAULTS.guideSizeFor,
    maxSize: sanitizeNumberInRangeLoose(rawDetailer.maxSize, COMFYUI_FACE_DETAILER_DEFAULTS.maxSize, 64, 16384),
    noiseMask: typeof rawDetailer.noiseMask === "boolean"
      ? rawDetailer.noiseMask
      : COMFYUI_FACE_DETAILER_DEFAULTS.noiseMask,
    samBBoxExpansion: sanitizeIntegerInRangeLoose(
      rawDetailer.samBBoxExpansion,
      COMFYUI_FACE_DETAILER_DEFAULTS.samBBoxExpansion,
      0,
      1000,
    ),
    samDetectionHint: sanitizeOptionValue(
      rawDetailer.samDetectionHint,
      COMFYUI_FACE_DETAILER_DEFAULTS.samDetectionHint,
      COMFYUI_FACE_DETAILER_SAM_DETECTION_HINT_OPTIONS,
    ),
    samDilation: sanitizeIntegerInRangeLoose(
      rawDetailer.samDilation,
      COMFYUI_FACE_DETAILER_DEFAULTS.samDilation,
      -512,
      512,
    ),
    samMaskHintThreshold: sanitizeNumberInRangeLoose(
      rawDetailer.samMaskHintThreshold,
      COMFYUI_FACE_DETAILER_DEFAULTS.samMaskHintThreshold,
      0,
      1,
    ),
    samMaskHintUseNegative: sanitizeOptionValue(
      rawDetailer.samMaskHintUseNegative,
      COMFYUI_FACE_DETAILER_DEFAULTS.samMaskHintUseNegative,
      COMFYUI_FACE_DETAILER_SAM_MASK_HINT_USE_NEGATIVE_OPTIONS,
    ),
    samThreshold: sanitizeNumberInRangeLoose(
      rawDetailer.samThreshold,
      COMFYUI_FACE_DETAILER_DEFAULTS.samThreshold,
      0,
      1,
    ),
    samplerName: typeof rawDetailer.samplerName === "string" && rawDetailer.samplerName.trim()
      ? rawDetailer.samplerName.trim()
      : typeof rawGenerationParams.samplerName === "string" && rawGenerationParams.samplerName.trim()
        ? rawGenerationParams.samplerName.trim()
        : "euler",
    scheduler: typeof rawDetailer.scheduler === "string" && rawDetailer.scheduler.trim()
      ? rawDetailer.scheduler.trim()
      : typeof rawGenerationParams.scheduler === "string" && rawGenerationParams.scheduler.trim()
        ? rawGenerationParams.scheduler.trim()
        : "normal",
    steps: sanitizePositiveInteger(rawDetailer.steps, sanitizePositiveInteger(rawGenerationParams.steps, 30)),
    wildcard: typeof rawDetailer.wildcard === "string"
      ? rawDetailer.wildcard
      : COMFYUI_FACE_DETAILER_DEFAULTS.wildcard,
  };
}

function sanitizeSavedComfyUiGenerationParams(
  raw: unknown,
): SceneForgeProject["settings"]["savedComfyUiGenerationParams"] | undefined {
  if (raw === null) {
    return null;
  }

  if (!isRecord(raw)) {
    return undefined;
  }

  const seed = typeof raw.seed === "number" && Number.isSafeInteger(raw.seed) && raw.seed >= 0
    ? raw.seed
    : 0;
  const seedMode = raw.seedMode === "fixed" ? "fixed" : "random";
  const denoise = sanitizeFiniteNumber(raw.denoise, 1);
  const latentImageNode =
    raw.latentImageNode === "EmptyLatentImage" || raw.latentImageNode === "EmptySD3LatentImage"
      ? raw.latentImageNode
      : undefined;
  const promptWrapper = isRecord(raw.promptWrapper)
    ? {
        ...(typeof raw.promptWrapper.positivePrefix === "string"
          ? { positivePrefix: raw.promptWrapper.positivePrefix }
          : {}),
        ...(typeof raw.promptWrapper.negativePrefix === "string"
          ? { negativePrefix: raw.promptWrapper.negativePrefix }
          : {}),
      }
    : undefined;
  const faceDetailer = sanitizeSavedDetailerParams(
    raw.faceDetailer,
    raw,
    DEFAULT_COMFYUI_FACE_DETAILER_DETECTOR_MODEL,
  );
  const handDetailer = sanitizeSavedDetailerParams(
    raw.handDetailer,
    raw,
    DEFAULT_COMFYUI_HAND_DETAILER_DETECTOR_MODEL,
  );
  const loras = Array.isArray(raw.loras)
    ? raw.loras.flatMap((lora) => {
        if (!isRecord(lora) || typeof lora.loraName !== "string" || !lora.loraName.trim()) {
          return [];
        }

        return [
          {
            enabled: lora.enabled !== false,
            loraName: lora.loraName.trim(),
            strengthClip: sanitizeFiniteNumber(lora.strengthClip, sanitizeFiniteNumber(lora.strengthModel, 0.7)),
            strengthModel: sanitizeFiniteNumber(lora.strengthModel, 0.7),
          },
        ];
      })
    : [];
  const inpaint = isRecord(raw.inpaint)
    ? {
        denoise: sanitizeNumberInRangeLoose(raw.inpaint.denoise, 0.65, 0, 1),
        growMaskBy: sanitizeIntegerInRangeLoose(raw.inpaint.growMaskBy, 6, 0, 512),
        mode: raw.inpaint.mode === "vae-inpaint" ? "vae-inpaint" as const : "latent-noise-mask" as const,
      }
    : undefined;

  return {
    width: sanitizePositiveInteger(raw.width, 1024),
    height: sanitizePositiveInteger(raw.height, 1024),
    seed,
    seedMode,
    steps: sanitizePositiveInteger(raw.steps, 30),
    cfg: sanitizeFiniteNumber(raw.cfg, 7),
    samplerName: typeof raw.samplerName === "string" && raw.samplerName.trim() ? raw.samplerName.trim() : "euler",
    scheduler: typeof raw.scheduler === "string" && raw.scheduler.trim() ? raw.scheduler.trim() : "normal",
    denoise: Math.min(1, Math.max(0, denoise)),
    imageCount: sanitizePositiveInteger(raw.imageCount, 1),
    ...(latentImageNode ? { latentImageNode } : {}),
    ...(promptWrapper ? { promptWrapper } : {}),
    ...(inpaint ? { inpaint } : {}),
    outputPrefix: typeof raw.outputPrefix === "string" && raw.outputPrefix.trim() ? raw.outputPrefix.trim() : "SceneForge",
    ...(faceDetailer ? { faceDetailer } : {}),
    ...(handDetailer ? { handDetailer } : {}),
    loras,
    savedAt: typeof raw.savedAt === "string" && raw.savedAt.trim()
      ? raw.savedAt
      : "1970-01-01T00:00:00.000Z",
  };
}

function readNonEmptyString(raw: unknown): string | null {
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function readOptionalNonEmptyString(raw: unknown): string | undefined {
  return readNonEmptyString(raw) ?? undefined;
}

function readTimestamp(raw: unknown): string | null {
  const value = readNonEmptyString(raw);
  if (!value) {
    return null;
  }

  const time = Date.parse(value);
  return Number.isFinite(time) ? value : null;
}

function getComfyUiGeneratedImageDedupeKey(image: Pick<
  SavedComfyUiGeneratedImage,
  "filename" | "nodeId" | "promptId" | "subfolder" | "type"
>): string {
  return [
    image.promptId,
    image.nodeId,
    image.filename,
    image.subfolder ?? "",
    image.type ?? "",
  ].join("\u0000");
}

function getCreatedAtTime(value: string): number {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function sanitizeComfyUiImageReference(raw: unknown) {
  if (!isRecord(raw)) {
    return null;
  }

  const filename = readNonEmptyString(raw.filename);
  if (!filename) {
    return null;
  }
  const subfolder = readOptionalNonEmptyString(raw.subfolder);
  const type = readOptionalNonEmptyString(raw.type);

  return {
    filename,
    ...(subfolder ? { subfolder } : {}),
    ...(type ? { type } : {}),
  };
}

function readManagedGeneratedImageFilename(raw: unknown): string | undefined {
  const value = readOptionalNonEmptyString(raw);
  return value && COMFYUI_MANAGED_GENERATED_IMAGE_FILENAME_PATTERN.test(value) ? value : undefined;
}

function readManagedGeneratedImageFilenameFromUrl(url: string): string | undefined {
  if (!url.startsWith(COMFYUI_MANAGED_GENERATED_IMAGE_ROUTE_PREFIX)) {
    return undefined;
  }

  const rawFilename = url
    .slice(COMFYUI_MANAGED_GENERATED_IMAGE_ROUTE_PREFIX.length)
    .split(/[?#]/)[0];

  try {
    return readManagedGeneratedImageFilename(decodeURIComponent(rawFilename));
  } catch {
    return undefined;
  }
}

function sanitizeComfyUiGeneratedImage(raw: unknown): SavedComfyUiGeneratedImage | null {
  if (!isRecord(raw)) {
    return null;
  }

  const parameters = sanitizeSavedComfyUiGenerationParams(raw.parameters);
  if (!parameters) {
    return null;
  }

  const id = readNonEmptyString(raw.id);
  const promptId = readNonEmptyString(raw.promptId);
  const batchId = readNonEmptyString(raw.batchId);
  const nodeId = readNonEmptyString(raw.nodeId);
  const filename = readNonEmptyString(raw.filename);
  const url = readNonEmptyString(raw.url);
  const createdAt = readTimestamp(raw.createdAt);

  if (!id || !promptId || !batchId || !nodeId || !filename || !url || !createdAt) {
    return null;
  }

  const fallbackWidth = parameters.width;
  const fallbackHeight = parameters.height;
  const sourceReference = sanitizeComfyUiImageReference(raw.sourceReference);
  const inferredLocalFilename = readManagedGeneratedImageFilenameFromUrl(url);
  const storage = raw.storage === "sceneforge"
    ? "sceneforge"
    : raw.storage === "comfyui"
      ? "comfyui"
      : inferredLocalFilename
        ? "sceneforge"
        : undefined;
  const localFilename = readManagedGeneratedImageFilename(raw.localFilename) ?? inferredLocalFilename;
  const subfolder = readOptionalNonEmptyString(raw.subfolder);
  const type = readOptionalNonEmptyString(raw.type);
  const parentImageId = readOptionalNonEmptyString(raw.parentImageId);
  const outputNodeId = readOptionalNonEmptyString(raw.outputNodeId);

  return {
    id,
    promptId,
    batchId,
    nodeId,
    filename,
    ...(subfolder ? { subfolder } : {}),
    ...(type ? { type } : {}),
    url,
    seed: typeof raw.seed === "number" && Number.isSafeInteger(raw.seed) && raw.seed >= 0
      ? raw.seed
      : parameters.seed,
    source: raw.source === "inpaint" ? "inpaint" : "text-to-image",
    ...(storage ? { storage } : {}),
    ...(localFilename ? { localFilename } : {}),
    ...(sourceReference ? { sourceReference } : {}),
    createdAt,
    favorited: raw.favorited === true,
    ...(parentImageId ? { parentImageId } : {}),
    ...(outputNodeId ? { outputNodeId } : {}),
    width: sanitizePositiveInteger(raw.width, fallbackWidth),
    height: sanitizePositiveInteger(raw.height, fallbackHeight),
    positivePrompt: typeof raw.positivePrompt === "string" ? raw.positivePrompt : "",
    negativePrompt: typeof raw.negativePrompt === "string" ? raw.negativePrompt : "",
    parameters,
    selectedCheckpointId: readOptionalNonEmptyString(raw.selectedCheckpointId) ?? null,
    selectedLoraIds: sanitizeStringIdList(raw.selectedLoraIds),
  };
}

function mergeComfyUiGeneratedImages(
  images: SavedComfyUiGeneratedImage[],
): SavedComfyUiGeneratedImage[] {
  const byKey = new Map<string, SavedComfyUiGeneratedImage>();

  for (const image of images) {
    const key = getComfyUiGeneratedImageDedupeKey(image);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, image);
      continue;
    }

    const next = getCreatedAtTime(image.createdAt) >= getCreatedAtTime(existing.createdAt)
      ? image
      : existing;
    byKey.set(key, {
      ...next,
      favorited: existing.favorited || image.favorited,
    });
  }

  const ordered = Array.from(byKey.values()).sort(
    (a, b) => getCreatedAtTime(b.createdAt) - getCreatedAtTime(a.createdAt),
  );
  const favorites = ordered.filter((image) => image.favorited);
  const favoriteIds = new Set(favorites.map((image) => image.id));
  const remainingSlots = Math.max(0, COMFYUI_GENERATED_IMAGE_HISTORY_LIMIT - favorites.length);
  const recentUnfavorited = ordered
    .filter((image) => !favoriteIds.has(image.id) && !image.favorited)
    .slice(0, remainingSlots);

  return [...favorites, ...recentUnfavorited].sort(
    (a, b) => getCreatedAtTime(b.createdAt) - getCreatedAtTime(a.createdAt),
  );
}

function sanitizeComfyUiGeneratedImages(raw: unknown): SavedComfyUiGeneratedImage[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return mergeComfyUiGeneratedImages(
    raw
      .map(sanitizeComfyUiGeneratedImage)
      .filter((image): image is SavedComfyUiGeneratedImage => image !== null),
  );
}

function sanitizeSettings(settings: unknown): SceneForgeProject["settings"] {
  if (!isRecord(settings)) {
    return {
      modelFormat: "generic",
      includeSpatialHints: true,
      supportsNsfw: false,
      negativePrompt: "",
      selectedCivitaiCheckpointId: null,
      selectedCivitaiLoraIds: [],
      selectedArtistStringIds: [],
      selectedArtistStringPrompts: [],
      artistStringPromptRenderMode: "artist-weight",
      promptLibraryTags: [],
      deletedBuiltInPromptLibraryTagIds: [],
      comfyUiGeneratedImages: [],
    };
  }

  const savedComfyUiGenerationParams = sanitizeSavedComfyUiGenerationParams(
    settings.savedComfyUiGenerationParams,
  );
  const modelFormat = settings.modelFormat;
  const mf: SceneForgeProject["settings"]["modelFormat"] =
    typeof modelFormat === "string" &&
    (modelFormat === "generic" || modelFormat === "stable-diffusion")
      ? modelFormat
      : "generic";

  const libraryTagsRaw = Array.isArray(settings.promptLibraryTags) ? settings.promptLibraryTags : [];
  const libraryTags = dedupeById(
    libraryTagsRaw.map(sanitizePromptLibraryTagEntry).filter((tag): tag is PromptTag => tag !== null),
  );
  const deletedBuiltIns = Array.isArray(settings.deletedBuiltInPromptLibraryTagIds)
    ? (settings.deletedBuiltInPromptLibraryTagIds as string[]).filter((id) => typeof id === "string")
    : [];
  const selectedArtistStringIds = sanitizeStringIdList(settings.selectedArtistStringIds);
  if (
    selectedArtistStringIds.length === 0 &&
    typeof settings.selectedArtistStringId === "string" &&
    settings.selectedArtistStringId.trim()
  ) {
    selectedArtistStringIds.push(settings.selectedArtistStringId.trim());
  }
  const selectedArtistStringPrompts = sanitizeStringList(settings.selectedArtistStringPrompts);
  if (
    selectedArtistStringPrompts.length === 0 &&
    typeof settings.selectedArtistStringPrompt === "string" &&
    settings.selectedArtistStringPrompt.trim()
  ) {
    selectedArtistStringPrompts.push(settings.selectedArtistStringPrompt.trim());
  }

  return {
    modelFormat: mf,
    includeSpatialHints: typeof settings.includeSpatialHints === "boolean" ? settings.includeSpatialHints : true,
    supportsNsfw: typeof settings.supportsNsfw === "boolean" ? settings.supportsNsfw : false,
    negativePrompt: typeof settings.negativePrompt === "string" ? settings.negativePrompt : "",
    selectedCivitaiCheckpointId:
      typeof settings.selectedCivitaiCheckpointId === "string" && settings.selectedCivitaiCheckpointId.trim()
        ? settings.selectedCivitaiCheckpointId.trim()
        : null,
    selectedCivitaiLoraIds: sanitizeStringIdList(settings.selectedCivitaiLoraIds),
    selectedArtistStringIds,
    selectedArtistStringPrompts,
    artistStringPromptRenderMode:
      settings.artistStringPromptRenderMode === "novelai" ||
      settings.artistStringPromptRenderMode === "artist-weight" ||
      settings.artistStringPromptRenderMode === "by-weight"
        ? settings.artistStringPromptRenderMode
        : "artist-weight",
    ...(savedComfyUiGenerationParams !== undefined ? { savedComfyUiGenerationParams } : {}),
    promptLibraryTags: libraryTags,
    deletedBuiltInPromptLibraryTagIds: [...new Set(deletedBuiltIns)],
    comfyUiGeneratedImages: sanitizeComfyUiGeneratedImages(settings.comfyUiGeneratedImages),
  };
}

export type GlobalPromptLibraryState = Pick<
  SceneForgeProject["settings"],
  "promptLibraryTags" | "deletedBuiltInPromptLibraryTagIds"
>;

const PROMPT_BINDING_TARGETS = ["scene", "object", "character", "bodyPart"] as const;

const PROMPT_BINDING_FALLBACKS = {
  scene: {
    categories: DEFAULT_PROMPT_CATEGORY_BINDINGS.scene,
    subcategories: DEFAULT_PROMPT_SUBCATEGORY_BINDINGS.scene,
  },
  object: {
    categories: DEFAULT_PROMPT_CATEGORY_BINDINGS.object,
    subcategories: DEFAULT_PROMPT_SUBCATEGORY_BINDINGS.object,
  },
  character: {
    categories: DEFAULT_PROMPT_CATEGORY_BINDINGS.character,
    subcategories: DEFAULT_PROMPT_SUBCATEGORY_BINDINGS.character,
  },
  bodyPart: {
    categories: DEFAULT_PROMPT_CATEGORY_BINDINGS.bodyPart,
    subcategories: DEFAULT_PROMPT_SUBCATEGORY_BINDINGS.bodyPart,
  },
} satisfies Record<
  PromptBindingTargetKind,
  { categories: PromptTagCategory[]; subcategories: PromptTagSubcategory[] }
>;

/** Sanitize only shared prompt library fields (used by global library file API). */
export function sanitizeGlobalPromptLibraryPayload(payload: unknown): GlobalPromptLibraryState {
  const coerced = sanitizeSettings(
    isRecord(payload)
      ? {
          modelFormat: "generic",
          includeSpatialHints: true,
          supportsNsfw: false,
          negativePrompt: "",
          promptLibraryTags: payload.promptLibraryTags,
          deletedBuiltInPromptLibraryTagIds: payload.deletedBuiltInPromptLibraryTagIds,
        }
      : {},
  );

  return {
    promptLibraryTags: coerced.promptLibraryTags,
    deletedBuiltInPromptLibraryTagIds: coerced.deletedBuiltInPromptLibraryTagIds,
  };
}

/** Sanitize shared prompt-library binding fields (used by global binding file API). */
export function sanitizeGlobalPromptBindingsPayload(payload: unknown): PromptBindingState {
  const defaults = createDefaultPromptBindingState();

  if (!isRecord(payload)) {
    return defaults;
  }

  return Object.fromEntries(
    PROMPT_BINDING_TARGETS.map((target) => {
      const raw = isRecord(payload[target]) ? payload[target] : {};
      const fallback = PROMPT_BINDING_FALLBACKS[target];
      const migrated = migrateLegacyPromptBindingArrays(
        raw.promptCategoryBindings,
        raw.promptSubcategoryBindings,
      );
      const promptCategoryBindings = sanitizePromptCategoryBindings(
        migrated.categoriesRaw,
        fallback.categories,
      );

      return [
        target,
        {
          promptCategoryBindings,
          promptSubcategoryBindings: sanitizePromptSubcategoryBindings(
            migrated.subcategoriesRaw,
            promptCategoryBindings,
            fallback.subcategories,
          ),
        },
      ];
    }),
  ) as PromptBindingState;
}

/** Project JSON on disk does not persist the shared prompt library. */
export function stripPromptLibraryFromProject(project: SceneForgeProject): SceneForgeProject {
  return {
    ...project,
    settings: {
      ...project.settings,
      promptLibraryTags: [],
      deletedBuiltInPromptLibraryTagIds: [],
    },
  };
}

function stripSceneObjectPromptBindings(object: SceneObject): SceneObject {
  const { promptCategoryBindings, promptSubcategoryBindings, ...rest } = object;
  void promptCategoryBindings;
  void promptSubcategoryBindings;
  return rest;
}

function stripCharacterPromptBindings(character: CharacterSkeleton): CharacterSkeleton {
  const { promptCategoryBindings, promptSubcategoryBindings, ...rest } = character;
  void promptCategoryBindings;
  void promptSubcategoryBindings;

  return {
    ...rest,
    bodyParts: character.bodyParts.map((bodyPart) => {
      const {
        promptCategoryBindings: bodyPartCategoryBindings,
        promptSubcategoryBindings: bodyPartSubcategoryBindings,
        ...bodyPartRest
      } = bodyPart;
      void bodyPartCategoryBindings;
      void bodyPartSubcategoryBindings;
      return bodyPartRest;
    }),
  };
}

export function stripPromptBindingsFromScene(scene: Scene): Scene {
  const { promptCategoryBindings, promptSubcategoryBindings, ...rest } = scene;
  void promptCategoryBindings;
  void promptSubcategoryBindings;

  return {
    ...rest,
    objects: scene.objects.map(stripSceneObjectPromptBindings),
    characters: scene.characters.map(stripCharacterPromptBindings),
  };
}

/** Project JSON on disk does not persist shared prompt-library target bindings. */
export function stripPromptBindingsFromProject(project: SceneForgeProject): SceneForgeProject {
  return {
    ...project,
    scene: stripPromptBindingsFromScene(project.scene),
  };
}

export function stripSharedPromptStateFromProject(project: SceneForgeProject): SceneForgeProject {
  return stripPromptBindingsFromProject(stripPromptLibraryFromProject(project));
}

export function applyPromptBindingsToScene(
  scene: Scene,
  bindings: PromptBindingState,
): Scene {
  return {
    ...scene,
    promptCategoryBindings: [...bindings.scene.promptCategoryBindings],
    promptSubcategoryBindings: [...bindings.scene.promptSubcategoryBindings],
    objects: scene.objects.map((object) => ({
      ...object,
      promptCategoryBindings: [...bindings.object.promptCategoryBindings],
      promptSubcategoryBindings: [...bindings.object.promptSubcategoryBindings],
    })),
    characters: scene.characters.map((character) => ({
      ...character,
      promptCategoryBindings: [...bindings.character.promptCategoryBindings],
      promptSubcategoryBindings: [...bindings.character.promptSubcategoryBindings],
      bodyParts: character.bodyParts.map((bodyPart) => ({
        ...bodyPart,
        promptCategoryBindings: [...bindings.bodyPart.promptCategoryBindings],
        promptSubcategoryBindings: [...bindings.bodyPart.promptSubcategoryBindings],
      })),
    })),
  };
}

export function applyPromptBindingsToProject(
  project: SceneForgeProject,
  bindings: PromptBindingState,
): SceneForgeProject {
  return {
    ...project,
    scene: applyPromptBindingsToScene(project.scene, bindings),
  };
}

export function extractPromptBindingsFromProject(project: SceneForgeProject): PromptBindingState {
  const object = project.scene.objects[0];
  const character = project.scene.characters[0];
  const bodyPart = character?.bodyParts[0];
  const defaults = createDefaultPromptBindingState();

  return sanitizeGlobalPromptBindingsPayload({
    scene: {
      promptCategoryBindings:
        project.scene.promptCategoryBindings ?? defaults.scene.promptCategoryBindings,
      promptSubcategoryBindings:
        project.scene.promptSubcategoryBindings ?? defaults.scene.promptSubcategoryBindings,
    },
    object: {
      promptCategoryBindings:
        object?.promptCategoryBindings ?? defaults.object.promptCategoryBindings,
      promptSubcategoryBindings:
        object?.promptSubcategoryBindings ?? defaults.object.promptSubcategoryBindings,
    },
    character: {
      promptCategoryBindings:
        character?.promptCategoryBindings ?? defaults.character.promptCategoryBindings,
      promptSubcategoryBindings:
        character?.promptSubcategoryBindings ?? defaults.character.promptSubcategoryBindings,
    },
    bodyPart: {
      promptCategoryBindings:
        bodyPart?.promptCategoryBindings ?? defaults.bodyPart.promptCategoryBindings,
      promptSubcategoryBindings:
        bodyPart?.promptSubcategoryBindings ?? defaults.bodyPart.promptSubcategoryBindings,
    },
  });
}

export function mergePromptLibraryIntoProject(
  project: SceneForgeProject,
  library: GlobalPromptLibraryState,
): SceneForgeProject {
  return {
    ...project,
    settings: {
      ...project.settings,
      promptLibraryTags: library.promptLibraryTags ?? [],
      deletedBuiltInPromptLibraryTagIds: library.deletedBuiltInPromptLibraryTagIds ?? [],
    },
  };
}

/**
 * 修补不信任来源的项目 JSON（缺省数组、画布默认值等），避免编辑器在 `.map` 等处崩溃。
 */
export function sanitizeImportedProject(project: SceneForgeProject): SceneForgeProject {
  return {
    ...project,
    version: 1,
    id: typeof project.id === "string" && project.id ? project.id : "project-imported",
    name: typeof project.name === "string" ? project.name : "Imported Project",
    createdAt: typeof project.createdAt === "string" ? project.createdAt : new Date().toISOString(),
    updatedAt: typeof project.updatedAt === "string" ? project.updatedAt : new Date().toISOString(),
    settings: sanitizeSettings(project.settings),
    scene: sanitizeScene(project.scene),
  };
}

export function serializeProject(project: SceneForgeProject) {
  const stripped = stripSharedPromptStateFromProject(project);
  return JSON.stringify(
    {
      ...stripped,
      scene: stripLegacyMannequinJoints3DFromScene(stripped.scene),
    },
    null,
    2,
  );
}

function stripLegacyMannequinJoints3DFromScene(scene: Scene): Scene {
  return {
    ...scene,
    characters: scene.characters.map((character) => {
      if (!character.stickFigurePose3D) {
        return character;
      }
      const { joints3D, ...rest } = character;
      void joints3D;
      return rest;
    }),
  };
}

export function serializeCanvasExport(project: SceneForgeProject): string {
  const payload: CanvasExportFile = {
    kind: SCENEFORGE_CANVAS_EXPORT_KIND,
    version: 1,
    scene: stripPromptBindingsFromScene(project.scene),
  };

  return JSON.stringify(payload, null, 2);
}

/**
 * 从「导出画布 JSON」生成的文件恢复场景；不含项目设置与词库。
 * 若为完整 SceneForge 项目 JSON（旧版备份），则仅读取其中的 `scene`。
 */
export function importCanvasBundleFromJson(json: string): Scene {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("文件不是有效的 JSON。");
  }

  if (isSceneForgeProject(parsed)) {
    return sanitizeScene(parsed.scene);
  }

  if (!isRecord(parsed) || parsed.kind !== SCENEFORGE_CANVAS_EXPORT_KIND || !isExportBundleVersion(parsed.version)) {
    throw new Error("不是有效的 SceneForge 画布文件。");
  }

  return sanitizeScene(parsed.scene);
}

export function serializePromptLibraryExport(project: SceneForgeProject): string {
  const payload: PromptLibraryExportFile = {
    kind: SCENEFORGE_PROMPT_LIBRARY_EXPORT_KIND,
    version: 1,
    promptLibraryTags: project.settings.promptLibraryTags ?? [],
    deletedBuiltInPromptLibraryTagIds: project.settings.deletedBuiltInPromptLibraryTagIds ?? [],
  };

  return JSON.stringify(payload, null, 2);
}

/**
 * 从「导出词库 JSON」生成的文件恢复自定义词库与隐藏的内置词条 id；不含画布与已应用到场景的引用。
 * 若为完整 SceneForge 项目 JSON（旧版备份），则仅读取其中的词库字段。
 */
export function importPromptLibraryBundleFromJson(
  json: string,
): Pick<SceneForgeProject["settings"], "promptLibraryTags" | "deletedBuiltInPromptLibraryTagIds"> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("文件不是有效的 JSON。");
  }

  if (isSceneForgeProject(parsed)) {
    const normalized = sanitizeImportedProject(parsed);
    return {
      promptLibraryTags: normalized.settings.promptLibraryTags,
      deletedBuiltInPromptLibraryTagIds: normalized.settings.deletedBuiltInPromptLibraryTagIds,
    };
  }

  if (
    !isRecord(parsed) ||
    parsed.kind !== SCENEFORGE_PROMPT_LIBRARY_EXPORT_KIND ||
    !isExportBundleVersion(parsed.version)
  ) {
    throw new Error("不是有效的 SceneForge 词库文件。");
  }

  const coerced = sanitizeSettings({
    modelFormat: "generic",
    includeSpatialHints: true,
    supportsNsfw: false,
    negativePrompt: "",
    promptLibraryTags: parsed.promptLibraryTags,
    deletedBuiltInPromptLibraryTagIds: parsed.deletedBuiltInPromptLibraryTagIds,
  });

  return {
    promptLibraryTags: coerced.promptLibraryTags,
    deletedBuiltInPromptLibraryTagIds: coerced.deletedBuiltInPromptLibraryTagIds,
  };
}

/**
 * 用于检测「内容相同、主键不同」的重复项目（不含 id / 时间戳）。
 */
export function getProjectContentFingerprint(project: SceneForgeProject): string {
  const stripped = stripSharedPromptStateFromProject(project);
  const { version, name, scene, settings } = stripped;

  return JSON.stringify({ version, name, scene, settings });
}

export function isSceneForgeProject(value: unknown): value is SceneForgeProject {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    value.version === 1 &&
    isRecord(value.scene) &&
    isRecord(value.settings) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

export function parseProjectJson(json: string): SceneForgeProject {
  const parsed: unknown = JSON.parse(json);

  if (!isSceneForgeProject(parsed)) {
    throw new Error("Invalid SceneForge project data.");
  }

  return sanitizeImportedProject(parsed);
}

/**
 * 从完整项目 JSON 恢复项目（内部校验、历史数据与测试用）。
 * 拒绝误选的 Prompt 轻量导出、画布包、词库包；并对结构做修补以便编辑器安全加载。
 */
export function importProjectFromJson(json: string): SceneForgeProject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("文件不是有效的 JSON。");
  }

  if (isRecord(parsed) && parsed.kind === PROMPT_EXPORT_KIND) {
    throw new Error("这是旧的 Prompt 文本导出文件，已不再支持；请使用「导入词库 JSON」或「导入画布 JSON」。");
  }

  if (isRecord(parsed) && parsed.kind === SCENEFORGE_CANVAS_EXPORT_KIND) {
    throw new Error("这是画布导出文件，请使用「导入画布 JSON」。");
  }

  if (isRecord(parsed) && parsed.kind === SCENEFORGE_PROMPT_LIBRARY_EXPORT_KIND) {
    throw new Error("这是词库导出文件，请使用「导入词库 JSON」。");
  }

  if (!isSceneForgeProject(parsed)) {
    throw new Error("不是有效的 SceneForge 项目文件。");
  }

  return sanitizeImportedProject(parsed);
}
