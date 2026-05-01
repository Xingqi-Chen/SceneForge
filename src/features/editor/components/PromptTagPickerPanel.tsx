"use client";

import { ChevronRight, Loader2, Settings, Sparkles, Tags, X } from "lucide-react";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { useEditorStore, type PromptTagTarget } from "@/features/editor/store/editor-store";
import { getLlmProxyErrorMessage, isLlmChatResponse } from "@/features/llm";
import { saveProject, savePromptBindings, savePromptLibrary } from "@/features/persistence";
import {
  DEFAULT_PROMPT_CATEGORY_BINDINGS,
  DEFAULT_PROMPT_SUBCATEGORY_BINDINGS,
} from "@/features/editor/store/defaults";
import { BUILT_IN_PROMPT_LIBRARY_TAGS } from "@/features/prompt-engine/prompt-library/built-in-prompt-tags";
import {
  buildPromptLibraryImportMessages,
  buildPromptLibrarySubcategoryMessages,
  parseLlmPromptLibraryImportContent,
  parseLlmPromptLibrarySubcategoryContent,
} from "@/features/prompt-engine/prompt-library/parse-llm-prompt-library-import";
import {
  PROMPT_TAG_CATEGORY_LABELS,
  PROMPT_TAG_CATEGORY_ORDER,
  PROMPT_TAG_SUBCATEGORY_LABELS,
  PROMPT_TAG_SUBCATEGORY_OPTIONS,
  normalizePromptTagSubcategory,
} from "@/features/prompt-engine/prompt-library/prompt-tag-taxonomy";
import type { BodyPartId, PromptTag, PromptTagCategory, PromptTagSubcategory } from "@/shared/types";

type BodyPartTargetValue = BodyPartId | "character";

type ImportUiStatus = "idle" | "loading" | "success" | "error";
type ManageUiStatus = "idle" | "loading" | "error";
type ClassifyUiStatus = "loading" | "success" | "error";
type PromptLibraryTagDraft = {
  label: string;
  prompt: string;
  category: PromptTagCategory;
  subcategory: PromptTagSubcategory | "";
  negative: boolean;
};

type CollapsedPromptCategories = Partial<Record<PromptTagCategory, boolean>>;
type ClassifyCategoryState = Partial<
  Record<PromptTagCategory, { status: ClassifyUiStatus; message: string }>
>;

const MAX_CLASSIFICATION_TAGS_PER_REQUEST = 10;

function chunkPromptTags(tags: PromptTag[], chunkSize: number) {
  const chunks: PromptTag[][] = [];

  for (let start = 0; start < tags.length; start += chunkSize) {
    chunks.push(tags.slice(start, start + chunkSize));
  }

  return chunks;
}

function createCollapsedPromptCategories(): CollapsedPromptCategories {
  return Object.fromEntries(
    PROMPT_TAG_CATEGORY_ORDER.map((category) => [category, true]),
  ) as CollapsedPromptCategories;
}

function getPromptSubcategoryKey(
  category: PromptTagCategory,
  subcategory: string,
) {
  return `${category}:${subcategory || "uncategorized"}`;
}

function groupPromptLibrary(tags: PromptTag[]) {
  return PROMPT_TAG_CATEGORY_ORDER
    .map((category) => {
      const categoryTags = tags.filter((tag) => tag.category === category);

      return {
        category,
        label: PROMPT_TAG_CATEGORY_LABELS[category],
        tagCount: categoryTags.length,
        uncategorizedTags: categoryTags.filter((tag) => !tag.subcategory),
        subgroups: [
          ...PROMPT_TAG_SUBCATEGORY_OPTIONS[category].map((subcategory) => ({
            subcategory,
            label: PROMPT_TAG_SUBCATEGORY_LABELS[subcategory],
            tags: categoryTags.filter((tag) => tag.subcategory === subcategory),
          })),
          {
            subcategory: "",
            label: "未分类",
            tags: categoryTags.filter((tag) => !tag.subcategory),
          },
        ].filter((group) => group.tags.length > 0),
      };
    })
    .filter((group) => group.subgroups.length > 0);
}

function findAppliedTag(tags: PromptTag[], tag: PromptTag) {
  return tags.find(
    (appliedTag) =>
      appliedTag.prompt === tag.prompt &&
      appliedTag.category === tag.category &&
      Boolean(appliedTag.negative) === Boolean(tag.negative),
  );
}

function filterPromptLibraryGroupsByBindings(
  groups: ReturnType<typeof groupPromptLibrary>,
  categoryBindings: PromptTagCategory[],
  subcategoryBindings: PromptTagSubcategory[],
) {
  const categorySet = new Set(categoryBindings);
  const subcategorySet = new Set(subcategoryBindings);

  return groups
    .filter((group) => categorySet.has(group.category))
    .map((group) => {
      const boundSubcategories = PROMPT_TAG_SUBCATEGORY_OPTIONS[group.category].filter(
        (subcategory) => subcategorySet.has(subcategory),
      );

      if (boundSubcategories.length === 0) {
        return group;
      }

      const subgroups = group.subgroups.filter(
        (subgroup) =>
          subgroup.subcategory !== "" &&
          subcategorySet.has(subgroup.subcategory as PromptTagSubcategory),
      );

      return {
        ...group,
        tagCount: subgroups.reduce((total, subgroup) => total + subgroup.tags.length, 0),
        uncategorizedTags: [],
        subgroups,
      };
    })
    .filter((group) => group.subgroups.length > 0);
}

export function PromptTagPickerPanel() {
  const {
    addPromptTag,
    deletePromptLibraryTag,
    importPromptLibraryTags,
    project,
    removePromptTag,
    selectBodyPart,
    selectCharacter,
    selection,
    updatePromptCategoryBindings,
    updatePromptLibraryTag,
    updatePromptSubcategoryBindings,
    updatePromptTag,
  } = useEditorStore();
  const [bodyPartTarget, setBodyPartTarget] = useState<BodyPartTargetValue>("character");
  const [importDraft, setImportDraft] = useState("");
  const [importStatus, setImportStatus] = useState<ImportUiStatus>("idle");
  const [importError, setImportError] = useState("");
  const [importFeedback, setImportFeedback] = useState("");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [manageStatus, setManageStatus] = useState<ManageUiStatus>("idle");
  const [manageError, setManageError] = useState("");
  const [pendingManageTag, setPendingManageTag] = useState<PromptTag | null>(null);
  const [collapsedCategories, setCollapsedCategories] = useState<CollapsedPromptCategories>(
    createCollapsedPromptCategories,
  );
  /** At most one secondary subgroup expanded at a time (accordion). */
  const [expandedPromptSubcategoryKey, setExpandedPromptSubcategoryKey] = useState<string | null>(
    null,
  );
  const [classifyCategoryState, setClassifyCategoryState] = useState<ClassifyCategoryState>({});
  const [manageDraft, setManageDraft] = useState<PromptLibraryTagDraft>({
    label: "",
    prompt: "",
    category: "style",
    subcategory: "",
    negative: false,
  });

  const allLibraryTags = useMemo(() => {
    const custom = project.settings.promptLibraryTags ?? [];
    const deletedBuiltIns = new Set(project.settings.deletedBuiltInPromptLibraryTagIds ?? []);
    const builtIns = BUILT_IN_PROMPT_LIBRARY_TAGS.filter((tag) => !deletedBuiltIns.has(tag.id));
    return [...builtIns, ...custom];
  }, [project.settings.deletedBuiltInPromptLibraryTagIds, project.settings.promptLibraryTags]);
  const promptLibraryGroups = useMemo(() => groupPromptLibrary(allLibraryTags), [allLibraryTags]);

  const multiSelection = selection.kind === "multiple";

  const selectedObject =
    selection.kind === "object"
      ? project.scene.objects.find((object) => object.id === selection.id)
      : undefined;
  const selectedCharacter =
    selection.kind === "character"
      ? project.scene.characters.find((character) => character.id === selection.id)
      : selection.kind === "bodyPart"
        ? project.scene.characters.find((character) => character.id === selection.characterId)
        : undefined;
  const currentBodyPartTarget =
    selection.kind === "bodyPart" ? selection.bodyPartId : bodyPartTarget;
  const selectedBodyPart =
    selectedCharacter && currentBodyPartTarget !== "character"
      ? selectedCharacter.bodyParts.find((bodyPart) => bodyPart.id === currentBodyPartTarget)
      : undefined;

  const tagTarget = useMemo<PromptTagTarget>(() => {
    if (multiSelection) {
      return { kind: "scene" };
    }

    if (selectedObject) {
      return { kind: "object", id: selectedObject.id };
    }

    if (selectedCharacter) {
      if (selectedBodyPart) {
        return {
          kind: "bodyPart",
          characterId: selectedCharacter.id,
          bodyPartId: selectedBodyPart.id,
        };
      }

      return { kind: "character", id: selectedCharacter.id };
    }

    return { kind: "scene" };
  }, [multiSelection, selectedBodyPart, selectedCharacter, selectedObject]);
  const currentPromptCategoryBindings = selectedObject
    ? (selectedObject.promptCategoryBindings ?? DEFAULT_PROMPT_CATEGORY_BINDINGS.object)
    : selectedBodyPart
      ? (selectedBodyPart.promptCategoryBindings ?? DEFAULT_PROMPT_CATEGORY_BINDINGS.bodyPart)
      : selectedCharacter
        ? (selectedCharacter.promptCategoryBindings ?? DEFAULT_PROMPT_CATEGORY_BINDINGS.character)
        : (project.scene.promptCategoryBindings ?? DEFAULT_PROMPT_CATEGORY_BINDINGS.scene);
  const currentPromptSubcategoryBindings = selectedObject
    ? (selectedObject.promptSubcategoryBindings ?? DEFAULT_PROMPT_SUBCATEGORY_BINDINGS.object)
    : selectedBodyPart
      ? (selectedBodyPart.promptSubcategoryBindings ?? DEFAULT_PROMPT_SUBCATEGORY_BINDINGS.bodyPart)
      : selectedCharacter
        ? (selectedCharacter.promptSubcategoryBindings ??
          DEFAULT_PROMPT_SUBCATEGORY_BINDINGS.character)
        : (project.scene.promptSubcategoryBindings ?? DEFAULT_PROMPT_SUBCATEGORY_BINDINGS.scene);
  const promptCategoryBindingSet = useMemo(
    () => new Set(currentPromptCategoryBindings),
    [currentPromptCategoryBindings],
  );
  const promptSubcategoryBindingSet = useMemo(
    () => new Set(currentPromptSubcategoryBindings),
    [currentPromptSubcategoryBindings],
  );
  const boundPromptLibraryGroups = useMemo(
    () =>
      filterPromptLibraryGroupsByBindings(
        promptLibraryGroups,
        currentPromptCategoryBindings,
        currentPromptSubcategoryBindings,
      ),
    [currentPromptCategoryBindings, currentPromptSubcategoryBindings, promptLibraryGroups],
  );

  function handleBodyPartTargetChange(nextTarget: BodyPartTargetValue) {
    setBodyPartTarget(nextTarget);

    if (!selectedCharacter) {
      return;
    }

    if (nextTarget === "character") {
      selectCharacter(selectedCharacter.id);
      return;
    }

    selectBodyPart(selectedCharacter.id, nextTarget);
  }

  async function persistCurrentProject(action: () => void, scope: string) {
    try {
      action();
      await saveProject(useEditorStore.getState().project);
    } catch (error) {
      console.error("[SceneForge] [prompt-library] failed to persist prompt tag change", {
        error,
        scope,
      });
    }
  }

  async function persistPromptBindings(action: () => void, scope: string) {
    try {
      action();
      await savePromptBindings(useEditorStore.getState().promptBindings);
    } catch (error) {
      console.error("[SceneForge] [prompt-library] failed to persist prompt binding change", {
        error,
        scope,
      });
    }
  }

  async function handleTogglePromptTag(tag: PromptTag, appliedTag: PromptTag | undefined) {
    if (multiSelection) {
      return;
    }

    await persistCurrentProject(
      () =>
        appliedTag
          ? removePromptTag(tagTarget, appliedTag.id)
          : addPromptTag(tagTarget, tag),
      "toggle-library-tag",
    );
  }

  async function handleRemoveAppliedTag(tagId: string) {
    if (multiSelection) {
      return;
    }

    await persistCurrentProject(() => removePromptTag(tagTarget, tagId), "remove-applied-tag");
  }

  async function handleUpdateAppliedTag(tagId: string, patch: Parameters<typeof updatePromptTag>[2]) {
    if (multiSelection) {
      return;
    }

    await persistCurrentProject(() => updatePromptTag(tagTarget, tagId, patch), "update-applied-tag");
  }

  async function handleTogglePromptCategoryBinding(category: PromptTagCategory) {
    if (multiSelection) {
      return;
    }

    const nextCategories = promptCategoryBindingSet.has(category)
      ? currentPromptCategoryBindings.filter((currentCategory) => currentCategory !== category)
      : PROMPT_TAG_CATEGORY_ORDER.filter(
          (currentCategory) =>
            promptCategoryBindingSet.has(currentCategory) || currentCategory === category,
        );

    if (nextCategories.length === 0) {
      return;
    }

    await persistPromptBindings(
      () => updatePromptCategoryBindings(tagTarget, nextCategories),
      "update-target-category-bindings",
    );
  }

  async function handleTogglePromptSubcategoryBinding(subcategory: PromptTagSubcategory) {
    if (multiSelection) {
      return;
    }

    const nextSubcategories = promptSubcategoryBindingSet.has(subcategory)
      ? currentPromptSubcategoryBindings.filter(
          (currentSubcategory) => currentSubcategory !== subcategory,
        )
      : [...currentPromptSubcategoryBindings, subcategory];

    await persistPromptBindings(
      () => updatePromptSubcategoryBindings(tagTarget, nextSubcategories),
      "update-target-subcategory-bindings",
    );
  }

  async function handleUpdateTagWeightValue(tagId: string, value: number) {
    await handleUpdateAppliedTag(tagId, {
      weight: { value: Number.isFinite(value) ? value : 1 },
    });
  }

  async function handleImportPromptLibrary() {
    const raw = importDraft.trim();
    if (!raw) {
      setImportError("请先粘贴或输入 Prompt 文本。");
      setImportStatus("error");
      return;
    }

    setImportStatus("loading");
    setImportError("");
    setImportFeedback("");

    try {
      const messages = buildPromptLibraryImportMessages(raw);

      console.info("[SceneForge] [prompt-library] client outbound /api/llm/chat import", {
        draftChars: raw.length,
        messageCount: messages.length,
      });

      const response = await fetch("/api/llm/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messages,
          temperature: 0.2,
          maxTokens: 8000,
        }),
      });

      const payload: unknown = await response.json();

      if (!response.ok) {
        console.info("[SceneForge] [prompt-library] client inbound /api/llm/chat error", {
          httpStatus: response.status,
        });
        throw new Error(getLlmProxyErrorMessage(payload));
      }

      if (!isLlmChatResponse(payload)) {
        console.info("[SceneForge] [prompt-library] client inbound invalid response shape", {
          httpStatus: response.status,
        });
        throw new Error("AI 返回格式不正确。");
      }

      const parsed = parseLlmPromptLibraryImportContent(payload.content);
      if (!parsed.ok) {
        throw new Error(parsed.error);
      }

      const added = importPromptLibraryTags(parsed.tags);
      if (added > 0) {
        const nextProject = useEditorStore.getState().project;
        await savePromptLibrary({
          promptLibraryTags: nextProject.settings.promptLibraryTags ?? [],
          deletedBuiltInPromptLibraryTagIds: nextProject.settings.deletedBuiltInPromptLibraryTagIds ?? [],
        });
      }

      console.info("[SceneForge] [prompt-library] import merged into project settings", {
        parsedCount: parsed.tags.length,
        addedCount: added,
        persisted: added > 0,
      });

      setImportStatus("success");
      if (added > 0) {
        setImportFeedback(`已保存 ${added} 条新词条到词库（与内置或已有词条重复的已跳过）。`);
        setImportDraft("");
      } else {
        setImportFeedback("没有新增词条：解析结果与现有词库重复，或无可合并内容。");
      }
    } catch (error) {
      console.error("[SceneForge] [prompt-library] import failed", { error });
      setImportStatus("error");
      setImportError(error instanceof Error ? error.message : "导入失败，请稍后重试。");
    }
  }

  async function handleClassifyUncategorizedTags(
    category: PromptTagCategory,
    tags: PromptTag[],
  ) {
    if (tags.length === 0) {
      setClassifyCategoryState((current) => ({
        ...current,
        [category]: { status: "error", message: "当前大类没有未分类词条。" },
      }));
      return;
    }

    setClassifyCategoryState((current) => ({
      ...current,
      [category]: { status: "loading", message: "AI 分类中..." },
    }));

    try {
      const tagBatches = chunkPromptTags(tags, MAX_CLASSIFICATION_TAGS_PER_REQUEST);
      const assignments = [];

      for (const [batchIndex, tagBatch] of tagBatches.entries()) {
        setClassifyCategoryState((current) => ({
          ...current,
          [category]: {
            status: "loading",
            message: `AI 分类中... ${batchIndex + 1}/${tagBatches.length}`,
          },
        }));

        const messages = buildPromptLibrarySubcategoryMessages(category, tagBatch);

        console.info("[SceneForge] [prompt-library] client outbound /api/llm/chat subcategory", {
          category,
          batchIndex,
          batchCount: tagBatches.length,
          tagCount: tagBatch.length,
          messageCount: messages.length,
        });

        const response = await fetch("/api/llm/chat", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            purpose: "prompt-library-classification",
            messages,
            temperature: 0.1,
            maxTokens: 3000,
          }),
        });

        const payload: unknown = await response.json();

        if (!response.ok) {
          console.info("[SceneForge] [prompt-library] client inbound /api/llm/chat subcategory error", {
            category,
            batchIndex,
            httpStatus: response.status,
          });
          throw new Error(getLlmProxyErrorMessage(payload));
        }

        if (!isLlmChatResponse(payload)) {
          console.info("[SceneForge] [prompt-library] client inbound subcategory invalid response shape", {
            category,
            batchIndex,
            httpStatus: response.status,
          });
          throw new Error("AI 返回格式不正确。");
        }

        const parsed = parseLlmPromptLibrarySubcategoryContent(payload.content, category);
        if (!parsed.ok) {
          throw new Error(parsed.error);
        }

        assignments.push(...parsed.assignments);
      }

      const assignmentById = new Map(
        assignments.map((assignment) => [assignment.id, assignment.subcategory]),
      );
      let updatedCount = 0;

      for (const tag of tags) {
        const subcategory = assignmentById.get(tag.id);
        if (!subcategory) {
          continue;
        }

        const updated = updatePromptLibraryTag({ ...tag, subcategory });
        if (updated) {
          updatedCount += 1;
        }
      }

      if (updatedCount > 0) {
        const nextProject = useEditorStore.getState().project;
        await savePromptLibrary({
          promptLibraryTags: nextProject.settings.promptLibraryTags ?? [],
          deletedBuiltInPromptLibraryTagIds: nextProject.settings.deletedBuiltInPromptLibraryTagIds ?? [],
        });
      }

      console.info("[SceneForge] [prompt-library] subcategory classification merged", {
        category,
        requestedCount: tags.length,
        batchCount: tagBatches.length,
        assignmentCount: assignments.length,
        updatedCount,
        persisted: updatedCount > 0,
      });

      setClassifyCategoryState((current) => ({
        ...current,
        [category]: {
          status: "success",
          message:
            updatedCount > 0
              ? `已分类 ${updatedCount} 条未分类词条。`
              : "AI 返回的分类没有更新任何词条。",
        },
      }));
    } catch (error) {
      console.error("[SceneForge] [prompt-library] subcategory classification failed", {
        category,
        error,
      });
      setClassifyCategoryState((current) => ({
        ...current,
        [category]: {
          status: "error",
          message: error instanceof Error ? error.message : "AI 分类失败，请稍后重试。",
        },
      }));
    }
  }

  function requestManagePromptLibraryTag(tag: PromptTag) {
    setPendingManageTag(tag);
    setManageDraft({
      label: tag.label,
      prompt: tag.prompt,
      category: tag.category,
      subcategory: tag.subcategory ?? "",
      negative: Boolean(tag.negative),
    });
    setManageStatus("idle");
    setManageError("");
  }

  async function confirmDeletePromptLibraryTag() {
    if (!pendingManageTag) {
      return;
    }

    setManageStatus("loading");
    setManageError("");

    try {
      const deleted = deletePromptLibraryTag(pendingManageTag.id);
      if (!deleted) {
        setPendingManageTag(null);
        setManageStatus("idle");
        return;
      }

      const nextProject = useEditorStore.getState().project;
      await savePromptLibrary({
        promptLibraryTags: nextProject.settings.promptLibraryTags ?? [],
        deletedBuiltInPromptLibraryTagIds: nextProject.settings.deletedBuiltInPromptLibraryTagIds ?? [],
      });

      console.info("[SceneForge] [prompt-library] tag deleted from library", {
        tagId: pendingManageTag.id,
        prompt: pendingManageTag.prompt,
      });

      setPendingManageTag(null);
      setManageStatus("idle");
    } catch (error) {
      console.error("[SceneForge] [prompt-library] failed to delete tag", { error });
      setManageStatus("error");
      setManageError("删除失败，请稍后重试。");
    }
  }

  async function handleUpdatePromptLibraryTag() {
    if (!pendingManageTag) {
      return;
    }

    const label = manageDraft.label.trim();
    const prompt = manageDraft.prompt.trim();

    if (!prompt) {
      setManageStatus("error");
      setManageError("Prompt 内容不能为空。");
      return;
    }

    setManageStatus("loading");
    setManageError("");

    try {
      const category = manageDraft.category;
      const subcategory = normalizePromptTagSubcategory(category, manageDraft.subcategory);
      const updated = updatePromptLibraryTag({
        ...pendingManageTag,
        label: label || prompt.slice(0, 48),
        prompt,
        category,
        ...(subcategory ? { subcategory } : { subcategory: undefined }),
        negative: category === "negative" ? true : manageDraft.negative,
      });

      if (!updated) {
        throw new Error("未找到可更新的词库标签。");
      }

      const nextProject = useEditorStore.getState().project;
      await savePromptLibrary({
        promptLibraryTags: nextProject.settings.promptLibraryTags ?? [],
        deletedBuiltInPromptLibraryTagIds: nextProject.settings.deletedBuiltInPromptLibraryTagIds ?? [],
      });

      console.info("[SceneForge] [prompt-library] tag updated in library", {
        tagId: pendingManageTag.id,
        prompt,
        category,
      });

      setPendingManageTag(null);
      setManageStatus("idle");
    } catch (error) {
      console.error("[SceneForge] [prompt-library] failed to update tag", { error });
      setManageStatus("error");
      setManageError(error instanceof Error ? error.message : "更新失败，请稍后重试。");
    }
  }

  function togglePromptCategory(category: PromptTagCategory) {
    setCollapsedCategories((current) => ({
      ...current,
      [category]: !current[category],
    }));
  }

  function isPromptSubcategoryCollapsed(key: string) {
    return expandedPromptSubcategoryKey !== key;
  }

  function togglePromptSubcategory(key: string) {
    setExpandedPromptSubcategoryKey((current) => (current === key ? null : key));
  }

  const appliedTags = multiSelection
    ? []
    : selectedObject
      ? selectedObject.promptTags
      : selectedBodyPart
        ? selectedBodyPart.promptTags
        : selectedCharacter
          ? selectedCharacter.promptTags
          : project.scene.promptTags;

  const targetLabel = multiSelection
    ? `框选（${selection.objectIds.length + selection.characterIds.length} 项）`
    : selectedObject
      ? `对象：${selectedObject.name}`
      : selectedBodyPart
        ? `部位：${selectedBodyPart.label}`
        : selectedCharacter
          ? `人物：${selectedCharacter.name}`
          : "场景";

  return (
    <section className="flex flex-col flex-1">
      <div className="mb-4 flex items-center justify-between gap-3 border-b border-slate-100 pb-3 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="rounded-md bg-pink-50 p-1.5 text-pink-600">
            <Tags className="size-4" />
          </div>
          <h2 className="text-[15px] font-semibold text-slate-800">提示词库</h2>
        </div>
        <Button
          aria-label="打开提示词库设置"
          className="h-8 rounded-md border-slate-200 bg-white px-2.5 text-slate-500 hover:bg-slate-50 hover:text-slate-800"
          onClick={() => setIsSettingsOpen(true)}
          size="sm"
          title="提示词库设置"
          type="button"
          variant="secondary"
        >
          <Settings className="size-3.5" />
        </Button>
      </div>
      <div className="space-y-5 overflow-y-auto pr-1 custom-scrollbar">
        <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">当前目标</p>
          {multiSelection ? (
            <>
              <p className="mt-1.5 text-sm font-bold text-slate-800">{targetLabel}</p>
              <p className="mt-2 text-xs leading-relaxed text-slate-600">
                多选模式下无法为画布目标切换或编辑词条。请单击选中单个场景、对象或人物后再使用提示词库。
              </p>
            </>
          ) : (
            <>
              <p className="mt-1.5 text-sm font-bold text-slate-800">{targetLabel}</p>
              {selectedCharacter ? (
                <select
                  className="mt-3 h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none transition-all focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
                  onChange={(event) =>
                    handleBodyPartTargetChange(event.target.value as BodyPartTargetValue)
                  }
                  value={currentBodyPartTarget}
                >
                  <option value="character">人物整体</option>
                  {selectedCharacter.bodyParts.map((bodyPart) => (
                    <option key={bodyPart.id} value={bodyPart.id}>
                      {bodyPart.label}
                    </option>
                  ))}
                </select>
              ) : null}
            </>
          )}
        </div>

        <div>
          <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">点击选择或取消选择</p>
          <div className="space-y-4">
            {boundPromptLibraryGroups.length > 0 ? boundPromptLibraryGroups.map((group) => {
              const isCollapsed = Boolean(collapsedCategories[group.category]);
              const classifyState = classifyCategoryState[group.category];
              const isClassifying = classifyState?.status === "loading";

              return (
              <div key={group.category}>
                <div className="mb-2 flex items-center gap-2">
                  <button
                    aria-expanded={!isCollapsed}
                    className="flex min-w-0 flex-1 items-center justify-between rounded-md px-2 py-1.5 text-left text-xs font-semibold text-slate-700 transition-all hover:bg-slate-100"
                    onClick={() => togglePromptCategory(group.category)}
                    type="button"
                  >
                    <span className="flex items-center gap-1.5">
                      <ChevronRight
                        className={`size-3.5 text-slate-400 transition-transform ${
                          isCollapsed ? "" : "rotate-90"
                        }`}
                      />
                      {group.label}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                      {group.tagCount}
                    </span>
                  </button>
                  {group.uncategorizedTags.length > 0 ? (
                    <Button
                      className="h-7 shrink-0 rounded-md border-pink-100 bg-pink-50 px-2 text-[11px] text-pink-600 hover:bg-pink-100 disabled:opacity-60"
                      disabled={isClassifying}
                      onClick={() =>
                        void handleClassifyUncategorizedTags(
                          group.category,
                          group.uncategorizedTags,
                        )
                      }
                      title={`让 AI 为 ${group.label} 中 ${group.uncategorizedTags.length} 条未分类词条选择二级分类`}
                      type="button"
                      variant="secondary"
                    >
                      {isClassifying ? <Loader2 className="mr-1 size-3 animate-spin" /> : null}
                      AI 分类 {group.uncategorizedTags.length}
                    </Button>
                  ) : null}
                </div>
                {classifyState && classifyState.status !== "loading" ? (
                  <p
                    className={`mb-2 px-2 text-[11px] leading-relaxed ${
                      classifyState.status === "error" ? "text-rose-600" : "text-emerald-700"
                    }`}
                  >
                    {classifyState.message}
                  </p>
                ) : null}
                {isCollapsed ? null : (
                  <div className="space-y-3">
                  {group.subgroups.map((subgroup) => {
                    const subgroupKey = getPromptSubcategoryKey(
                      group.category,
                      subgroup.subcategory,
                    );
                    const isSubgroupCollapsed = isPromptSubcategoryCollapsed(subgroupKey);

                    return (
                    <div key={subgroupKey}>
                      <button
                        aria-expanded={!isSubgroupCollapsed}
                        className="mb-2 flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-[11px] font-medium text-slate-400 transition-all hover:bg-slate-100 hover:text-slate-600"
                        onClick={() => togglePromptSubcategory(subgroupKey)}
                        type="button"
                      >
                        <span className="flex items-center gap-1.5">
                          <ChevronRight
                            className={`size-3 text-slate-300 transition-transform ${
                              isSubgroupCollapsed ? "" : "rotate-90"
                            }`}
                          />
                          {subgroup.label}
                        </span>
                        <span className="rounded-full bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-400">
                          {subgroup.tags.length}
                        </span>
                      </button>
                      {isSubgroupCollapsed ? null : (
                        <div className="flex flex-wrap gap-2">
                        {subgroup.tags.map((tag) => {
                          const appliedTag = findAppliedTag(appliedTags, tag);

                          return (
                            <span className="relative inline-flex" key={tag.id}>
                              <button
                                aria-pressed={Boolean(appliedTag)}
                                className={
                                  appliedTag
                                    ? "rounded-full bg-slate-800 px-3 py-1.5 pr-6 text-xs font-medium text-white shadow-sm transition-all hover:bg-slate-900 hover:shadow"
                                    : "rounded-full border border-slate-200/80 bg-slate-50/80 px-3 py-1.5 pr-6 text-xs font-medium text-slate-600 shadow-sm transition-all hover:border-slate-300 hover:bg-white hover:text-slate-900 hover:shadow"
                                }
                                onClick={() => void handleTogglePromptTag(tag, appliedTag)}
                                title={tag.prompt}
                                type="button"
                              >
                                {tag.label}
                              </button>
                              <button
                                aria-label={`从词库删除 ${tag.label}`}
                                className={
                                  appliedTag
                                    ? "absolute right-1 top-0.5 rounded-full p-0.5 text-white/50 transition-all hover:bg-white/10 hover:text-white"
                                    : "absolute right-1 top-0.5 rounded-full p-0.5 text-slate-400 transition-all hover:bg-rose-50 hover:text-rose-500"
                                }
                                onClick={() => requestManagePromptLibraryTag(tag)}
                                title={`编辑或删除 ${tag.label}`}
                                type="button"
                              >
                                <X className="size-3" />
                              </button>
                            </span>
                          );
                        })}
                        </div>
                      )}
                    </div>
                    );
                  })}
                  </div>
                )}
              </div>
              );
            }) : (
            <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-5 text-center">
              <p className="text-xs text-slate-500">
                  当前目标没有可显示的绑定分类，请在上方启用至少一个一级分类。
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="pt-2 border-t border-slate-100">
          <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">已应用标签</p>
          {appliedTags.length > 0 ? (
            <div className="space-y-3">
              {appliedTags.map((tag) => (
                <div
                  className="group relative overflow-hidden rounded-md border border-slate-200 bg-white p-3 transition-all hover:border-blue-300"
                  key={tag.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <p className="text-sm font-bold text-slate-800">{tag.label}</p>
                      <p className="mt-1 text-xs leading-relaxed text-slate-500 break-words">{tag.prompt}</p>
                    </div>
                    <button
                      aria-label={`删除 ${tag.label}`}
                      className="rounded-full bg-slate-50 p-1.5 text-slate-400 opacity-0 transition-all hover:bg-rose-50 hover:text-rose-500 group-hover:opacity-100"
                      onClick={() => void handleRemoveAppliedTag(tag.id)}
                      type="button"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                  <div className="mt-3 grid grid-cols-[auto_1fr] items-center gap-3 rounded-md bg-slate-50 p-2.5">
                    <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-700">
                      <input
                        checked={tag.weight.enabled}
                        className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        onChange={(event) =>
                          void handleUpdateAppliedTag(tag.id, {
                            weight: { enabled: event.target.checked },
                          })
                        }
                        type="checkbox"
                      />
                      权重
                    </label>
                    <input
                      aria-label={`${tag.label} 权重值`}
                      className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 outline-none transition-all focus:border-blue-400 focus:ring-1 focus:ring-blue-400 disabled:opacity-50"
                      disabled={!tag.weight.enabled}
                      max={2}
                      min={0.1}
                      onChange={(event) =>
                        void handleUpdateTagWeightValue(tag.id, event.target.valueAsNumber)
                      }
                      step={0.05}
                      type="number"
                      value={tag.weight.value}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-slate-200 bg-slate-50 p-6 text-center">
              <Tags className="mb-2 size-6 text-slate-300" />
              <p className="text-xs text-slate-500">
                还没有给当前目标添加标签。
              </p>
            </div>
          )}
        </div>
      </div>
      {isSettingsOpen && typeof document !== "undefined" ? createPortal(
        <div
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm"
          role="dialog"
        >
          <div className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start gap-3 border-b border-slate-100 bg-pink-50 p-5">
              <div className="rounded-md bg-white p-2 text-pink-600">
                <Settings className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-bold text-slate-900">Prompt 词库设置</h3>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  管理当前目标可用的一级分类，并从已有 Prompt 文本导入词库。
                </p>
              </div>
              <button
                aria-label="关闭 Prompt 词库设置"
                className="rounded-full bg-white/80 p-1.5 text-slate-400 shadow-sm transition-all hover:bg-white hover:text-slate-700"
                onClick={() => setIsSettingsOpen(false)}
                type="button"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="space-y-5 overflow-y-auto p-5 custom-scrollbar">
              <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  当前目标
                </p>
                <p className="mt-1.5 text-sm font-bold text-slate-800">{targetLabel}</p>
                <div className="mt-3 rounded-md border border-slate-200 bg-white p-3">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    绑定一级分类
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {PROMPT_TAG_CATEGORY_ORDER.map((category) => {
                      const enabled = promptCategoryBindingSet.has(category);
                      const isOnlyEnabledCategory =
                        enabled && currentPromptCategoryBindings.length === 1;

                      return (
                        <button
                          aria-pressed={enabled}
                          className={
                            enabled
                              ? "rounded-full bg-pink-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-all hover:bg-pink-700 disabled:cursor-not-allowed disabled:opacity-60"
                              : "rounded-full border border-slate-200/80 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-500 shadow-sm transition-all hover:border-pink-200 hover:bg-pink-50 hover:text-pink-700"
                          }
                          disabled={isOnlyEnabledCategory}
                          key={category}
                          onClick={() => void handleTogglePromptCategoryBinding(category)}
                          title={
                            isOnlyEnabledCategory
                              ? "当前目标至少需要绑定一个一级分类"
                              : `切换 ${PROMPT_TAG_CATEGORY_LABELS[category]} 分类绑定`
                          }
                          type="button"
                        >
                          {PROMPT_TAG_CATEGORY_LABELS[category]}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                    未绑定二级时显示整个一级分类；已绑定二级时只显示选中的二级分类。
                  </p>
                  <div className="mt-4 space-y-3 border-t border-slate-100 pt-3">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      绑定二级分类
                    </p>
                    {PROMPT_TAG_CATEGORY_ORDER.filter((category) =>
                      promptCategoryBindingSet.has(category),
                    ).map((category) => {
                      const boundSubcategories = PROMPT_TAG_SUBCATEGORY_OPTIONS[category].filter(
                        (subcategory) => promptSubcategoryBindingSet.has(subcategory),
                      );

                      return (
                        <div
                          className="rounded-md border border-slate-200 bg-slate-50 p-3"
                          key={category}
                        >
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <p className="text-xs font-semibold text-slate-700">
                              {PROMPT_TAG_CATEGORY_LABELS[category]}
                            </p>
                            <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-slate-400">
                              {boundSubcategories.length > 0
                                ? `已绑定 ${boundSubcategories.length}`
                                : "显示全部"}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {PROMPT_TAG_SUBCATEGORY_OPTIONS[category].map((subcategory) => {
                              const enabled = promptSubcategoryBindingSet.has(subcategory);

                              return (
                                <button
                                  aria-pressed={enabled}
                                  className={
                                    enabled
                                      ? "rounded-full bg-slate-800 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-all hover:bg-slate-900"
                                      : "rounded-full border border-slate-200/80 bg-white px-3 py-1.5 text-xs font-medium text-slate-500 shadow-sm transition-all hover:border-pink-200 hover:bg-pink-50 hover:text-pink-700"
                                  }
                                  key={subcategory}
                                  onClick={() =>
                                    void handleTogglePromptSubcategoryBinding(subcategory)
                                  }
                                  title={`切换 ${PROMPT_TAG_SUBCATEGORY_LABELS[subcategory]} 二级分类绑定`}
                                  type="button"
                                >
                                  {PROMPT_TAG_SUBCATEGORY_LABELS[subcategory]}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="rounded-md border border-pink-100 bg-pink-50 p-4">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  智能导入
                </p>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">
                  粘贴整段 Prompt（可含逗号换行、引号块、LoRA 行等）。将通过 AI 拆分、分类并写入当前项目的词库。
                </p>
                <textarea
                  className="mt-3 min-h-[120px] w-full resize-y rounded-md border border-slate-200 bg-white px-3 py-2.5 text-xs leading-relaxed text-slate-800 outline-none transition-all placeholder:text-slate-400 focus:border-pink-400 focus:ring-1 focus:ring-pink-400 disabled:opacity-60"
                  disabled={importStatus === "loading"}
                  onChange={(event) => {
                    setImportDraft(event.target.value);
                    setImportStatus("idle");
                    setImportError("");
                    setImportFeedback("");
                  }}
                  placeholder="在此粘贴需要解析的 Prompt 文本…"
                  value={importDraft}
                />
                <Button
                  className="mt-3 h-9 w-full gap-2 rounded-md bg-pink-600 text-xs font-medium text-white hover:bg-pink-700 disabled:opacity-60"
                  disabled={importStatus === "loading"}
                  onClick={() => void handleImportPromptLibrary()}
                  size="sm"
                  type="button"
                >
                  {importStatus === "loading" ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="size-3.5" />
                  )}
                  {importStatus === "loading" ? "解析中…" : "AI 解析并导入词库"}
                </Button>
                {importStatus === "error" ? (
                  <p className="mt-2 text-xs leading-relaxed text-rose-600">{importError}</p>
                ) : null}
                {importStatus === "success" && importFeedback ? (
                  <p className="mt-2 text-xs leading-relaxed text-emerald-700">{importFeedback}</p>
                ) : null}
              </div>
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
      {pendingManageTag && typeof document !== "undefined" ? createPortal(
        <div
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm"
          role="dialog"
        >
          <div className="w-full max-w-md overflow-hidden rounded-md border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start gap-3 border-b border-slate-100 bg-pink-50 p-5">
              <div className="rounded-md bg-white p-2 text-pink-600">
                <Tags className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-bold text-slate-900">编辑词库标签</h3>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  更新会立即保存到本地项目；也可以直接从词库删除该标签。
                </p>
              </div>
            </div>
            <div className="space-y-4 p-5">
              <label className="block">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Label
                </span>
                <input
                  className="mt-2 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition-all focus:border-pink-400 focus:ring-1 focus:ring-pink-400 disabled:opacity-60"
                  disabled={manageStatus === "loading"}
                  onChange={(event) =>
                    setManageDraft((draft) => ({ ...draft, label: event.target.value }))
                  }
                  value={manageDraft.label}
                />
              </label>
              <label className="block">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Prompt
                </span>
                <textarea
                  className="mt-2 min-h-[82px] w-full resize-y rounded-md border border-slate-200 bg-white px-3 py-2.5 text-sm leading-relaxed text-slate-800 outline-none transition-all focus:border-pink-400 focus:ring-1 focus:ring-pink-400 disabled:opacity-60"
                  disabled={manageStatus === "loading"}
                  onChange={(event) =>
                    setManageDraft((draft) => ({ ...draft, prompt: event.target.value }))
                  }
                  value={manageDraft.prompt}
                />
              </label>
              <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-3">
                <label className="block">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    分类
                  </span>
                  <select
                    className="mt-2 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition-all focus:border-pink-400 focus:ring-1 focus:ring-pink-400 disabled:opacity-60"
                    disabled={manageStatus === "loading"}
                    onChange={(event) =>
                      setManageDraft((draft) => {
                        const category = event.target.value as PromptTagCategory;
                        const subcategory = normalizePromptTagSubcategory(
                          category,
                          draft.subcategory,
                        );

                        return {
                          ...draft,
                          category,
                          subcategory: subcategory ?? "",
                          negative: category === "negative" ? true : draft.negative,
                        };
                      })
                    }
                    value={manageDraft.category}
                  >
                    {PROMPT_TAG_CATEGORY_ORDER.map((category) => (
                      <option key={category} value={category}>
                        {PROMPT_TAG_CATEGORY_LABELS[category]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    二级分类
                  </span>
                  <select
                    className="mt-2 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition-all focus:border-pink-400 focus:ring-1 focus:ring-pink-400 disabled:opacity-60"
                    disabled={manageStatus === "loading"}
                    onChange={(event) =>
                      setManageDraft((draft) => ({
                        ...draft,
                        subcategory: event.target.value as PromptTagSubcategory | "",
                      }))
                    }
                    value={manageDraft.subcategory}
                  >
                    <option value="">未分类</option>
                    {PROMPT_TAG_SUBCATEGORY_OPTIONS[manageDraft.category].map((subcategory) => (
                      <option key={subcategory} value={subcategory}>
                        {PROMPT_TAG_SUBCATEGORY_LABELS[subcategory]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-700">
                  <input
                    checked={manageDraft.category === "negative" || manageDraft.negative}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-pink-600 focus:ring-pink-500"
                    disabled={manageStatus === "loading" || manageDraft.category === "negative"}
                    onChange={(event) =>
                      setManageDraft((draft) => ({ ...draft, negative: event.target.checked }))
                    }
                    type="checkbox"
                  />
                  负面
                </label>
              </div>
              {manageStatus === "error" ? (
                <p className="text-xs leading-relaxed text-rose-600">{manageError}</p>
              ) : null}
              <div className="grid grid-cols-[auto_1fr_1fr] gap-3">
                <Button
                  className="h-10 rounded-md border-rose-100 bg-rose-50 px-4 text-rose-600 hover:bg-rose-100"
                  disabled={manageStatus === "loading"}
                  onClick={() => void confirmDeletePromptLibraryTag()}
                  type="button"
                  variant="secondary"
                >
                  删除
                </Button>
                <Button
                  className="h-10 rounded-md border-slate-200 bg-slate-50 text-slate-700 hover:bg-white"
                  disabled={manageStatus === "loading"}
                  onClick={() => {
                    setPendingManageTag(null);
                    setManageStatus("idle");
                    setManageError("");
                  }}
                  type="button"
                  variant="secondary"
                >
                  取消
                </Button>
                <Button
                  className="h-10 rounded-md bg-pink-600 text-white hover:bg-pink-700 disabled:opacity-60"
                  disabled={manageStatus === "loading"}
                  onClick={() => void handleUpdatePromptLibraryTag()}
                  type="button"
                >
                  {manageStatus === "loading" ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : null}
                  Update
                </Button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
    </section>
  );
}
