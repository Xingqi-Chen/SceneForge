"use client";

import { ImagePlus, Loader2, Sparkles, TextCursorInput, Upload, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { getCharacterStickFigurePose } from "@/features/editor/stick-figure-3d/get-character-stick-pose";
import {
  buildStickFigurePoseGenerationMessages,
  buildStickFigurePoseImageGenerationMessages,
  parseStickFigurePoseGenerationResponse,
} from "@/features/editor/stick-figure-3d/llm-pose-generation";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { BUILT_IN_PROMPT_LIBRARY_TAGS } from "@/features/prompt-engine/prompt-library/built-in-prompt-tags";
import {
  buildCharacterImagePromptTagMessages,
  buildCharacterTextPromptTagMessages,
  buildSceneImagePromptTagMessages,
  buildSceneTextPromptTagMessages,
  isCharacterBodyPromptTagCategory,
  isScenePromptTagCategory,
  parseCharacterImagePromptTagsContent,
  SCENE_PROMPT_TAG_CATEGORIES,
  type CharacterPromptTagTarget,
} from "@/features/prompt-engine/prompt-library/character-image-prompt-tags";
import {
  PROMPT_TAG_CATEGORY_LABELS,
  PROMPT_TAG_SUBCATEGORY_LABELS,
} from "@/features/prompt-engine/prompt-library/prompt-tag-taxonomy";
import { getLlmProxyErrorMessage, isLlmChatResponse, type LlmChatMessage } from "@/features/llm";
import { saveProject, savePromptLibrary } from "@/features/persistence";
import { characterAppearsInThreeViewport } from "@/shared/utils/character-space";
import type { PromptTag, PromptTagCategory } from "@/shared/types";

type AnalyzeStatus = "idle" | "loading" | "success" | "error";

type BoundPromptTagSuggestion = {
  target: CharacterPromptTagTarget;
  tag: Omit<PromptTag, "id">;
};

type PendingImportReview = {
  suggestions: BoundPromptTagSuggestion[];
  existingSuggestions: Array<BoundPromptTagSuggestion & { libraryTag: PromptTag }>;
  newSuggestions: BoundPromptTagSuggestion[];
};

const SCENE_REVERSE_PROMPT_CATEGORY_SET = new Set<PromptTagCategory>(
  SCENE_PROMPT_TAG_CATEGORIES,
);
const MAX_IMAGE_EDGE = 768;
const MAX_POSE_IMAGE_EDGE = 512;
const JPEG_QUALITY = 0.72;

function getSemanticTagKey(tag: Pick<PromptTag, "prompt" | "category" | "negative">) {
  return [
    tag.prompt.trim().toLocaleLowerCase(),
    tag.category,
    Boolean(tag.negative) ? "negative" : "positive",
  ].join("|");
}

function makeTransientPromptTag(tag: Omit<PromptTag, "id">): PromptTag {
  return {
    ...tag,
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? `analysis-${crypto.randomUUID()}`
        : `analysis-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    weight: { ...tag.weight },
  };
}

function uniqueSuggestions(suggestions: BoundPromptTagSuggestion[]) {
  const seen = new Set<string>();

  return suggestions.filter((suggestion) => {
    const key = `${getSuggestionTargetKey(suggestion.target)}:${getSemanticTagKey(suggestion.tag)}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function getSuggestionTargetKey(target: CharacterPromptTagTarget) {
  if (target.kind === "scene") {
    return "scene";
  }

  return target.kind === "character" ? "character" : `bodyPart:${target.bodyPartId}`;
}

function getAllowedCategories(categories: PromptTagCategory[] | undefined) {
  return new Set((categories ?? []).filter(isCharacterBodyPromptTagCategory));
}

function getAllowedWholeCharacterCategories(categories: PromptTagCategory[] | undefined) {
  const allowed: PromptTagCategory[] = categories?.includes("character") ? ["character"] : [];
  return new Set(allowed);
}

function getAllowedSceneCategories(categories: PromptTagCategory[] | undefined) {
  return new Set((categories ?? []).filter(isScenePromptTagCategory));
}

async function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  const image = new Image();

  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("无法读取图片。"));
      image.src = url;
    });

    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function compressImageForLlm(file: File) {
  const image = await loadImage(file);
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("当前浏览器无法压缩图片。");
  }

  context.drawImage(image, 0, 0, width, height);

  return {
    dataUrl: canvas.toDataURL("image/jpeg", JPEG_QUALITY),
    width,
    height,
  };
}

async function compressPoseImageForLlm(file: File) {
  const image = await loadImage(file);
  const scale = Math.min(1, MAX_POSE_IMAGE_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("当前浏览器无法压缩姿态图片。");
  }

  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}

export function CharacterImagePromptTagPanel() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const {
    addPromptTag,
    applyCharacter3DPose,
    importPromptLibraryTags,
    project,
    selection,
    updateCharacter,
    updateScene,
  } = useEditorStore();
  const [status, setStatus] = useState<AnalyzeStatus>("idle");
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [compressedSize, setCompressedSize] = useState<{ width: number; height: number } | null>(
    null,
  );
  const [inferPoseFromImage, setInferPoseFromImage] = useState(false);
  const [poseStatus, setPoseStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [poseError, setPoseError] = useState("");
  const [pendingReview, setPendingReview] = useState<PendingImportReview | null>(null);
  const [savingReview, setSavingReview] = useState(false);
  const [textPrompt, setTextPrompt] = useState("");

  const selectedCharacter =
    selection.kind === "character"
      ? project.scene.characters.find((character) => character.id === selection.id)
      : undefined;
  const isSceneTarget = selection.kind === "scene";
  const isCharacterTarget = Boolean(
    project.scene.mode === "3d" &&
      selectedCharacter &&
      characterAppearsInThreeViewport(selectedCharacter),
  );
  const visibleForSelection = isSceneTarget || isCharacterTarget;
  const shouldInferPose = !isSceneTarget && inferPoseFromImage;
  const targetTagLabel = isSceneTarget ? "场景标签" : "部位标签";

  const allLibraryTags = useMemo(() => {
    const custom = project.settings.promptLibraryTags ?? [];
    const deletedBuiltIns = new Set(project.settings.deletedBuiltInPromptLibraryTagIds ?? []);
    const builtIns = BUILT_IN_PROMPT_LIBRARY_TAGS.filter((tag) => !deletedBuiltIns.has(tag.id));

    return [...builtIns, ...custom];
  }, [project.settings.deletedBuiltInPromptLibraryTagIds, project.settings.promptLibraryTags]);

  const libraryTagBySemanticKey = useMemo(
    () => new Map(allLibraryTags.map((tag) => [getSemanticTagKey(tag), tag])),
    [allLibraryTags],
  );

  if (!visibleForSelection) {
    return null;
  }

  function splitByLibrary(suggestions: BoundPromptTagSuggestion[]): PendingImportReview {
    const existingSuggestions: Array<BoundPromptTagSuggestion & { libraryTag: PromptTag }> = [];
    const newSuggestions: BoundPromptTagSuggestion[] = [];

    for (const suggestion of uniqueSuggestions(suggestions)) {
      const libraryTag = libraryTagBySemanticKey.get(getSemanticTagKey(suggestion.tag));
      if (libraryTag) {
        existingSuggestions.push({ ...suggestion, libraryTag });
      } else {
        newSuggestions.push(suggestion);
      }
    }

    return {
      suggestions,
      existingSuggestions,
      newSuggestions,
    };
  }

  async function applySuggestions(review: PendingImportReview, importNewTags: boolean) {
    const character = selectedCharacter;
    if (!isSceneTarget && !character) {
      return;
    }

    setSavingReview(true);
    setError("");

    try {
      if (importNewTags && review.newSuggestions.length > 0) {
        importPromptLibraryTags(review.newSuggestions.map((suggestion) => suggestion.tag));
        const nextProject = useEditorStore.getState().project;
        await savePromptLibrary({
          promptLibraryTags: nextProject.settings.promptLibraryTags ?? [],
          deletedBuiltInPromptLibraryTagIds:
            nextProject.settings.deletedBuiltInPromptLibraryTagIds ?? [],
        });
      }

      const tagsToApply: Array<BoundPromptTagSuggestion & { tagToApply: PromptTag }> = [
        ...review.existingSuggestions.map((suggestion) => ({
          ...suggestion,
          tagToApply: suggestion.libraryTag,
        })),
        ...(importNewTags
          ? review.newSuggestions.map((suggestion) => ({
              ...suggestion,
              tagToApply: makeTransientPromptTag(suggestion.tag),
            }))
          : []),
      ];

      if (isSceneTarget) {
        updateScene({
          promptTags: project.scene.promptTags.filter(
            (tag) => !SCENE_REVERSE_PROMPT_CATEGORY_SET.has(tag.category),
          ),
        });
      } else if (character) {
        updateCharacter(character.id, {
          promptTags: [],
          bodyParts: character.bodyParts.map((bodyPart) => ({
            ...bodyPart,
            promptTags: [],
          })),
        });
      }

      for (const suggestion of tagsToApply) {
        if (suggestion.target.kind === "scene") {
          addPromptTag({ kind: "scene" }, suggestion.tagToApply);
          continue;
        }

        if (!character) {
          continue;
        }

        addPromptTag(
          suggestion.target.kind === "character"
            ? {
                kind: "character",
                id: character.id,
              }
            : {
                kind: "bodyPart",
                characterId: character.id,
                bodyPartId: suggestion.target.bodyPartId,
              },
          suggestion.tagToApply,
        );
      }

      await saveProject(useEditorStore.getState().project);
      setPendingReview(null);
      setStatus("success");
      setFeedback(
        importNewTags
          ? `已导入 ${review.newSuggestions.length} 个新词条，并选中 ${tagsToApply.length} 个${targetTagLabel}。`
          : `已跳过新词条，选中 ${tagsToApply.length} 个已有${targetTagLabel}。`,
      );
    } catch (caught) {
      console.error("[SceneForge] [prompt-library] failed to apply image prompt tags", {
        error: caught,
      });
      setStatus("error");
      setError(caught instanceof Error ? caught.message : "应用提示词失败，请稍后重试。");
    } finally {
      setSavingReview(false);
    }
  }

  async function generatePoseFromImage(file: File, character: typeof selectedCharacter) {
    if (!character) {
      return;
    }

    setPoseStatus("loading");
    setPoseError("");

    try {
      const imageDataUrl = await compressPoseImageForLlm(file);
      const currentPose = getCharacterStickFigurePose(character);
      const response = await fetch("/api/llm/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purpose: "stick-figure-pose-generation",
          messages: buildStickFigurePoseImageGenerationMessages(imageDataUrl, currentPose),
          temperature: 0.2,
          maxTokens: 900,
        }),
      });
      const payload: unknown = await response.json();

      if (!response.ok) {
        throw new Error(getLlmProxyErrorMessage(payload));
      }

      if (!isLlmChatResponse(payload)) {
        throw new Error("AI 返回格式不正确，请重试。");
      }

      const result = parseStickFigurePoseGenerationResponse(payload.content, currentPose);
      if (!result) {
        throw new Error("AI 没有返回可用的姿态 JSON，请换一张更清晰的人物图片重试。");
      }

      applyCharacter3DPose(character.id, result.pose);
      if (result.characterDescription) {
        updateCharacter(character.id, { description: result.characterDescription });
      }

      await saveProject(useEditorStore.getState().project);
      setPoseStatus("success");
    } catch (caught) {
      console.error("[SceneForge] [editor] failed to generate 3D character pose from left image", {
        error: caught,
      });
      setPoseStatus("error");
      setPoseError(caught instanceof Error ? caught.message : "图片姿态推断失败，请稍后重试。");
    }
  }

  async function generatePoseFromText(prompt: string, character: typeof selectedCharacter) {
    if (!character) {
      return;
    }

    setPoseStatus("loading");
    setPoseError("");

    try {
      const currentPose = getCharacterStickFigurePose(character);
      const response = await fetch("/api/llm/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purpose: "stick-figure-pose-generation",
          messages: buildStickFigurePoseGenerationMessages(prompt, currentPose),
          temperature: 0.2,
          maxTokens: 900,
        }),
      });
      const payload: unknown = await response.json();

      if (!response.ok) {
        throw new Error(getLlmProxyErrorMessage(payload));
      }

      if (!isLlmChatResponse(payload)) {
        throw new Error("AI 返回格式不正确，请重试。");
      }

      const result = parseStickFigurePoseGenerationResponse(payload.content, currentPose);
      if (!result) {
        throw new Error("AI 没有返回可用的姿态 JSON，请换一种描述重试。");
      }

      applyCharacter3DPose(character.id, result.pose);
      if (result.characterDescription) {
        updateCharacter(character.id, { description: result.characterDescription });
      }

      await saveProject(useEditorStore.getState().project);
      setPoseStatus("success");
    } catch (caught) {
      console.error("[SceneForge] [editor] failed to generate 3D character pose from left text", {
        error: caught,
      });
      setPoseStatus("error");
      setPoseError(caught instanceof Error ? caught.message : "文本姿态生成失败，请稍后重试。");
    }
  }

  async function analyzePromptTagMessages(
    messages: LlmChatMessage[],
    character: typeof selectedCharacter,
    temperature = 0.35,
  ) {
    if (!isSceneTarget && !character) {
      return null;
    }

    const response = await fetch("/api/llm/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messages,
        temperature,
        maxTokens: 2200,
      }),
    });
    const payload: unknown = await response.json();

    if (!response.ok) {
      throw new Error(getLlmProxyErrorMessage(payload));
    }

    if (!isLlmChatResponse(payload)) {
      throw new Error("AI 返回格式不正确。");
    }

    const parsed = parseCharacterImagePromptTagsContent(payload.content);
    if (!parsed.ok) {
      throw new Error(parsed.error);
    }

    const allowedSceneCategories = getAllowedSceneCategories(project.scene.promptCategoryBindings);
    const allowedCharacterCategories = character
      ? getAllowedWholeCharacterCategories(character.promptCategoryBindings)
      : new Set<PromptTagCategory>();
    const allowedBodyPartCategories = new Map(
      character?.bodyParts.map((part) => [
        part.id,
        getAllowedCategories(part.promptCategoryBindings),
      ]) ?? [],
    );
    const suggestions = parsed.items.filter(
      (item) => {
        if (isSceneTarget) {
          return (
            item.target.kind === "scene" &&
            isScenePromptTagCategory(item.tag.category) &&
            allowedSceneCategories.has(item.tag.category)
          );
        }

        if (item.target.kind === "character") {
          return (
            isCharacterBodyPromptTagCategory(item.tag.category) &&
            allowedCharacterCategories.has(item.tag.category)
          );
        }

        if (item.target.kind === "scene") {
          return false;
        }

        return (
          isCharacterBodyPromptTagCategory(item.tag.category) &&
          (allowedBodyPartCategories.get(item.target.bodyPartId)?.has(item.tag.category) ?? false)
        );
      },
    );
    const review = splitByLibrary(suggestions);

    if (review.existingSuggestions.length === 0 && review.newSuggestions.length === 0) {
      throw new Error(
        isSceneTarget ? "AI 未返回可用于当前场景的提示词。" : "AI 未返回可用于当前人物部位的提示词。",
      );
    }

    return review;
  }

  async function handleAnalyzeFile(file: File | undefined) {
    const character = selectedCharacter;
    if (!isSceneTarget && !character) {
      return;
    }

    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      setStatus("error");
      setError("请上传图片文件。");
      return;
    }

    setStatus("loading");
    setError("");
    setFeedback("");
    setPendingReview(null);
    setPoseStatus(shouldInferPose ? "loading" : "idle");
    setPoseError("");

    try {
      const compressed = await compressImageForLlm(file);
      setCompressedSize({ width: compressed.width, height: compressed.height });
      const messages =
        isSceneTarget || !character
          ? buildSceneImagePromptTagMessages({
              sceneTarget: {
                label: project.scene.name,
                description: project.scene.description,
                promptCategoryBindings: project.scene.promptCategoryBindings,
              },
              imageDataUrl: compressed.dataUrl,
            })
          : buildCharacterImagePromptTagMessages({
              bodyParts: character.bodyParts,
              characterTarget: {
                label: character.name,
                promptCategoryBindings: character.promptCategoryBindings,
              },
              imageDataUrl: compressed.dataUrl,
            });

      const review = await analyzePromptTagMessages(messages, character, 0.2);
      if (!review) {
        return;
      }

      if (review.newSuggestions.length > 0) {
        setPendingReview(review);
        setStatus("success");
        setFeedback(
          `识别到 ${review.existingSuggestions.length} 个已有词条、${review.newSuggestions.length} 个新词条。`,
        );
        if (shouldInferPose) {
          await generatePoseFromImage(file, character);
        }
        return;
      }

      await applySuggestions(review, false);
      if (shouldInferPose) {
        await generatePoseFromImage(file, character);
      }
    } catch (caught) {
      console.error("[SceneForge] [prompt-library] character image analysis failed", {
        error: caught,
      });
      setStatus("error");
      setError(caught instanceof Error ? caught.message : "图片分析失败，请稍后重试。");
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  async function handleAnalyzeTextPrompt() {
    const character = selectedCharacter;
    const prompt = textPrompt.trim();
    if (!isSceneTarget && !character) {
      return;
    }

    if (!prompt) {
      setStatus("error");
      setError(isSceneTarget ? "请输入用于反推的场景描述。" : "请输入用于反推的人物描述。");
      return;
    }

    setStatus("loading");
    setError("");
    setFeedback("");
    setPendingReview(null);
    setCompressedSize(null);
    setPoseStatus(shouldInferPose ? "loading" : "idle");
    setPoseError("");

    try {
      const messages =
        isSceneTarget || !character
          ? buildSceneTextPromptTagMessages({
              sceneTarget: {
                label: project.scene.name,
                description: project.scene.description,
                promptCategoryBindings: project.scene.promptCategoryBindings,
              },
              userPrompt: prompt,
            })
          : buildCharacterTextPromptTagMessages({
              bodyParts: character.bodyParts,
              characterTarget: {
                label: character.name,
                promptCategoryBindings: character.promptCategoryBindings,
              },
              userPrompt: prompt,
            });
      const review = await analyzePromptTagMessages(messages, character);
      if (!review) {
        return;
      }

      if (review.newSuggestions.length > 0) {
        setPendingReview(review);
        setStatus("success");
        setFeedback(
          `识别到 ${review.existingSuggestions.length} 个已有词条、${review.newSuggestions.length} 个新词条。`,
        );
        if (shouldInferPose) {
          await generatePoseFromText(prompt, character);
        }
        return;
      }

      await applySuggestions(review, false);
      if (shouldInferPose) {
        await generatePoseFromText(prompt, character);
      }
    } catch (caught) {
      console.error("[SceneForge] [prompt-library] character text analysis failed", {
        error: caught,
      });
      setStatus("error");
      setError(caught instanceof Error ? caught.message : "文本反推失败，请稍后重试。");
    }
  }

  function getSuggestionTargetLabel(target: CharacterPromptTagTarget) {
    if (target.kind === "scene") {
      return project.scene.name;
    }

    if (target.kind === "character") {
      return selectedCharacter?.name ?? "人物";
    }

    return (
      selectedCharacter?.bodyParts.find((part) => part.id === target.bodyPartId)?.label ??
      target.bodyPartId
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
            {isSceneTarget ? "场景图片反推" : "人物图片反推"}
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            {isSceneTarget
              ? "选中场景后上传参考图，自动绑定风格、光照、质量与场景词。"
              : "选中整个人物后上传参考图，自动绑定到可见部位。"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="rounded-md bg-pink-50 p-2 text-pink-600">
            <ImagePlus className="size-4" />
          </div>
        </div>
      </div>

      <input
        accept="image/*"
        className="hidden"
        disabled={status === "loading" || poseStatus === "loading"}
        onChange={(event) => void handleAnalyzeFile(event.target.files?.[0])}
        ref={fileInputRef}
        type="file"
      />
      <div
        className={`grid items-center gap-2 ${
          isSceneTarget ? "grid-cols-1" : "grid-cols-[auto_1fr]"
        }`}
      >
        {!isSceneTarget ? (
          <button
            aria-pressed={inferPoseFromImage}
            className={`relative h-9 w-14 rounded-full border p-0.5 transition-colors ${
              inferPoseFromImage
                ? "border-indigo-300 bg-indigo-500"
                : "border-slate-200 bg-slate-100"
            } disabled:cursor-not-allowed disabled:opacity-60`}
            disabled={status === "loading" || poseStatus === "loading"}
            onClick={() => setInferPoseFromImage((current) => !current)}
            title="同步从图片推断 3D 姿态"
            type="button"
          >
            <span
              className={`block size-7 rounded-full bg-white shadow-sm transition-transform ${
                inferPoseFromImage ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        ) : null}
        <Button
          className="h-9 w-full rounded-md bg-pink-600 text-xs text-white hover:bg-pink-700 disabled:opacity-60"
          disabled={status === "loading" || poseStatus === "loading"}
          onClick={() => fileInputRef.current?.click()}
          size="sm"
          type="button"
        >
          {status === "loading" || poseStatus === "loading" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Upload className="size-4" />
          )}
          {status === "loading"
            ? shouldInferPose
              ? "分析/推断中..."
              : "分析中..."
            : poseStatus === "loading"
              ? "推断姿态中..."
              : "上传并分析图片"}
        </Button>
      </div>
      <p className="text-[11px] leading-relaxed text-slate-500">
        {isSceneTarget
          ? "场景分析会提取风格、光照、质量与环境提示词。"
          : inferPoseFromImage
            ? "已开启同步姿态推断。"
            : "开启左侧开关可同步从图片推断 3D 姿态。"}
      </p>

      <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-2">
        <textarea
          className="min-h-20 w-full resize-y rounded-md border border-slate-200 bg-white px-3 py-2 text-xs leading-relaxed text-slate-700 outline-none transition focus:border-pink-300 focus:ring-2 focus:ring-pink-100 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={status === "loading" || poseStatus === "loading"}
          onChange={(event) => setTextPrompt(event.target.value)}
          placeholder={
            isSceneTarget
              ? "也可以输入场景描述反推，例如：雨夜里的赛博朋克小巷"
              : "也可以输入描述反推，例如：生成一个穿着长裙的漂亮女生"
          }
          value={textPrompt}
        />
        <Button
          className="h-9 w-full rounded-md border border-pink-200 bg-white text-xs text-pink-700 hover:bg-pink-50 disabled:opacity-60"
          disabled={
            status === "loading" || poseStatus === "loading" || textPrompt.trim().length === 0
          }
          onClick={() => void handleAnalyzeTextPrompt()}
          size="sm"
          type="button"
          variant="secondary"
        >
          {status === "loading" || poseStatus === "loading" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <TextCursorInput className="size-4" />
          )}
          用文本反推提示词
        </Button>
      </div>

      {compressedSize ? (
        <p className="text-[11px] leading-relaxed text-slate-500">
          已压缩到 {compressedSize.width} x {compressedSize.height} 后提交给 AI。
        </p>
      ) : null}
      {status === "error" && error ? (
        <p className="text-xs leading-relaxed text-rose-600">{error}</p>
      ) : null}
      {status === "success" && feedback ? (
        <p className="text-xs leading-relaxed text-emerald-700">{feedback}</p>
      ) : null}
      {!isSceneTarget && poseStatus === "success" ? (
        <p className="text-xs leading-relaxed text-indigo-700">已同步生成 3D 姿态。</p>
      ) : null}
      {!isSceneTarget && poseStatus === "error" && poseError ? (
        <p className="text-xs leading-relaxed text-rose-600">{poseError}</p>
      ) : null}

      {pendingReview && typeof document !== "undefined"
        ? createPortal(
            <div
              aria-modal="true"
              className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm"
              role="dialog"
            >
              <div className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-md border border-slate-200 bg-white shadow-2xl">
                <div className="flex items-start gap-3 border-b border-slate-100 bg-pink-50 p-5">
                  <div className="rounded-md bg-white p-2 text-pink-600">
                    <Sparkles className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-base font-bold text-slate-900">
                      {isSceneTarget ? "导入新的场景提示词" : "导入新的部位提示词"}
                    </h3>
                    <p className="mt-1 text-xs leading-relaxed text-slate-500">
                      AI 识别到 {pendingReview.newSuggestions.length} 个词库中不存在的词条。确认后会先导入词库，再选中这些标签。
                    </p>
                  </div>
                  <button
                    aria-label="关闭新增提示词确认"
                    className="rounded-full bg-white/80 p-1.5 text-slate-400 shadow-sm transition-all hover:bg-white hover:text-slate-700 disabled:opacity-50"
                    disabled={savingReview}
                    onClick={() => setPendingReview(null)}
                    type="button"
                  >
                    <X className="size-4" />
                  </button>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-5 custom-scrollbar">
                  <ul className="space-y-2">
                    {pendingReview.newSuggestions.map((suggestion) => {
                      const targetLabel = getSuggestionTargetLabel(suggestion.target);
                      const subcategory = suggestion.tag.subcategory
                        ? PROMPT_TAG_SUBCATEGORY_LABELS[suggestion.tag.subcategory]
                        : "未分类";

                      return (
                        <li
                          className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs"
                          key={`${getSuggestionTargetKey(suggestion.target)}:${getSemanticTagKey(suggestion.tag)}`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-semibold text-slate-900">
                                {targetLabel} / {suggestion.tag.label}
                              </p>
                              <p className="mt-1 break-words leading-relaxed text-slate-600">
                                {suggestion.tag.prompt}
                              </p>
                            </div>
                            <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-slate-500">
                              {PROMPT_TAG_CATEGORY_LABELS[suggestion.tag.category]} / {subcategory}
                            </span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>

                <div className="grid grid-cols-2 gap-3 border-t border-slate-100 bg-slate-50 p-4">
                  <Button
                    className="h-10 rounded-md border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    disabled={savingReview}
                    onClick={() => void applySuggestions(pendingReview, false)}
                    type="button"
                    variant="secondary"
                  >
                    仅选中已有词条
                  </Button>
                  <Button
                    className="h-10 rounded-md bg-pink-600 text-white hover:bg-pink-700 disabled:opacity-60"
                    disabled={savingReview}
                    onClick={() => void applySuggestions(pendingReview, true)}
                    type="button"
                  >
                    {savingReview ? <Loader2 className="size-4 animate-spin" /> : null}
                    导入并选中
                  </Button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </section>
  );
}
