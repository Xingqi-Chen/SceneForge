import type {
  CanvasAspectRatio,
  CanvasConfig,
  CharacterSkeleton,
  JointId,
  PromptTag,
  Scene,
  SceneForgeProject,
  SceneObject,
} from "@/shared/types";

import { defaultCharacter } from "@/features/editor/store/defaults";

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

const PROMPT_TAG_CATEGORY_SET = new Set<PromptTag["category"]>([
  "style",
  "lighting",
  "scene",
  "character",
  "body-part",
  "quality",
  "negative",
]);

/** 将不信任来源的单条词库标签修补为安全结构；无法识别则丢弃。 */
function sanitizePromptLibraryTagEntry(raw: unknown): PromptTag | null {
  if (!isRecord(raw)) {
    return null;
  }

  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id : null;
  if (!id) {
    return null;
  }

  const categoryCandidate = typeof raw.category === "string" ? raw.category : "style";
  const category: PromptTag["category"] = PROMPT_TAG_CATEGORY_SET.has(categoryCandidate as PromptTag["category"])
    ? (categoryCandidate as PromptTag["category"])
    : "style";

  const weightRaw = raw.weight;
  const w = isRecord(weightRaw) ? weightRaw : undefined;
  const value = typeof w?.value === "number" && Number.isFinite(w.value) ? w.value : 1;
  const enabled = typeof w?.enabled === "boolean" ? w.enabled : false;

  const tag: PromptTag = {
    id,
    label: typeof raw.label === "string" ? raw.label : "标签",
    prompt: typeof raw.prompt === "string" ? raw.prompt : "",
    category,
    weight: { value, enabled },
  };

  if (typeof raw.negative === "boolean") {
    tag.negative = raw.negative;
  }

  return tag;
}

function isExportBundleVersion(value: unknown): boolean {
  return value === 1 || value === "1";
}

function dedupePromptTags(tags: PromptTag[]): PromptTag[] {
  return dedupeById(tags);
}

const PROMPT_EXPORT_KIND = "sceneforge-prompt";

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

  const kind = typeof raw.kind === "string" ? raw.kind : "rectangle";

  const promptTags = Array.isArray(raw.promptTags) ? (raw.promptTags as SceneObject["promptTags"]) : [];

  return {
    id: raw.id,
    kind: kind as SceneObject["kind"],
    name: typeof raw.name === "string" ? raw.name : "对象",
    description: typeof raw.description === "string" ? raw.description : "",
    position,
    size,
    rotation: typeof raw.rotation === "number" && Number.isFinite(raw.rotation) ? raw.rotation : 0,
    layer: typeof raw.layer === "number" && Number.isFinite(raw.layer) ? raw.layer : 0,
    fill: typeof raw.fill === "string" ? raw.fill : "#e2e8f0",
    includeInPrompt: typeof raw.includeInPrompt === "boolean" ? raw.includeInPrompt : true,
    weight: sanitizeWeight(raw.weight),
    promptTags: dedupePromptTags(promptTags),
  };
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

  const bodyPartsRaw =
    Array.isArray(raw.bodyParts) && raw.bodyParts.length > 0
      ? (raw.bodyParts as CharacterSkeleton["bodyParts"])
      : defaultCharacter.bodyParts.map((bodyPart) => ({
          ...bodyPart,
          promptTags: bodyPart.promptTags.map((tag) => ({ ...tag, weight: { ...tag.weight } })),
        }));

  const bodyParts = bodyPartsRaw.map((bodyPart) => ({
    ...bodyPart,
    promptTags: dedupePromptTags(bodyPart.promptTags),
  }));

  const charPromptTags = Array.isArray(raw.promptTags)
    ? (raw.promptTags as CharacterSkeleton["promptTags"])
    : [];

  return {
    id: raw.id,
    name: typeof raw.name === "string" ? raw.name : "人物",
    description: typeof raw.description === "string" ? raw.description : "",
    position,
    scaleX: typeof raw.scaleX === "number" && Number.isFinite(raw.scaleX) ? raw.scaleX : undefined,
    scaleY: typeof raw.scaleY === "number" && Number.isFinite(raw.scaleY) ? raw.scaleY : undefined,
    joints,
    bodyParts,
    promptTags: dedupePromptTags(charPromptTags),
    includeInPrompt: typeof raw.includeInPrompt === "boolean" ? raw.includeInPrompt : true,
  };
}

function sanitizeScene(scene: unknown): Scene {
  if (!isRecord(scene)) {
    return {
      id: "scene-imported",
      name: "SceneForge 画布",
      description: "",
      canvas: sanitizeCanvas(undefined),
      objects: [],
      characters: [],
      promptTags: [],
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
  const scenePromptTags = Array.isArray(scene.promptTags) ? (scene.promptTags as Scene["promptTags"]) : [];

  return {
    id: typeof scene.id === "string" && scene.id ? scene.id : "scene-imported",
    name: typeof scene.name === "string" ? scene.name : "SceneForge 画布",
    description: typeof scene.description === "string" ? scene.description : "",
    canvas: sanitizeCanvas(scene.canvas),
    objects,
    characters,
    promptTags: dedupePromptTags(scenePromptTags),
  };
}

function sanitizeSettings(settings: unknown): SceneForgeProject["settings"] {
  if (!isRecord(settings)) {
    return {
      modelFormat: "generic",
      includeSpatialHints: true,
      negativePrompt: "",
      promptLibraryTags: [],
      deletedBuiltInPromptLibraryTagIds: [],
    };
  }

  const modelFormat = settings.modelFormat;
  const mf: SceneForgeProject["settings"]["modelFormat"] =
    typeof modelFormat === "string" &&
    (modelFormat === "generic" || modelFormat === "stable-diffusion" || modelFormat === "midjourney")
      ? modelFormat
      : "generic";

  const libraryTagsRaw = Array.isArray(settings.promptLibraryTags) ? settings.promptLibraryTags : [];
  const libraryTags = dedupeById(
    libraryTagsRaw.map(sanitizePromptLibraryTagEntry).filter((tag): tag is PromptTag => tag !== null),
  );
  const deletedBuiltIns = Array.isArray(settings.deletedBuiltInPromptLibraryTagIds)
    ? (settings.deletedBuiltInPromptLibraryTagIds as string[]).filter((id) => typeof id === "string")
    : [];

  return {
    modelFormat: mf,
    includeSpatialHints: typeof settings.includeSpatialHints === "boolean" ? settings.includeSpatialHints : true,
    negativePrompt: typeof settings.negativePrompt === "string" ? settings.negativePrompt : "",
    promptLibraryTags: libraryTags,
    deletedBuiltInPromptLibraryTagIds: [...new Set(deletedBuiltIns)],
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
  return JSON.stringify(project, null, 2);
}

export function serializeCanvasExport(project: SceneForgeProject): string {
  const payload: CanvasExportFile = {
    kind: SCENEFORGE_CANVAS_EXPORT_KIND,
    version: 1,
    scene: project.scene,
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
  const { version, name, scene, settings } = project;

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
