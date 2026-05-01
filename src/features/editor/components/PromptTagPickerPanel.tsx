"use client";

import { Loader2, Sparkles, Tags, X } from "lucide-react";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { useEditorStore, type PromptTagTarget } from "@/features/editor/store/editor-store";
import { getLlmProxyErrorMessage, isLlmChatResponse } from "@/features/llm";
import { saveProject } from "@/features/persistence";
import { BUILT_IN_PROMPT_LIBRARY_TAGS } from "@/features/prompt-engine/prompt-library/built-in-prompt-tags";
import {
  buildPromptLibraryImportMessages,
  parseLlmPromptLibraryImportContent,
} from "@/features/prompt-engine/prompt-library/parse-llm-prompt-library-import";
import type { BodyPartId, PromptTag, PromptTagCategory } from "@/shared/types";

const promptCategoryOrder = [
  "style",
  "lighting",
  "quality",
  "scene",
  "character",
  "body-part",
  "negative",
] satisfies PromptTagCategory[];

const promptCategoryLabels: Record<PromptTagCategory, string> = {
  style: "风格",
  lighting: "光照",
  quality: "质量",
  scene: "场景",
  character: "人物",
  "body-part": "身体部位",
  negative: "负面提示",
};

type BodyPartTargetValue = BodyPartId | "character";

type ImportUiStatus = "idle" | "loading" | "success" | "error";
type ManageUiStatus = "idle" | "loading" | "error";
type PromptLibraryTagDraft = {
  label: string;
  prompt: string;
  category: PromptTagCategory;
  negative: boolean;
};

function groupPromptLibrary(tags: PromptTag[]) {
  return promptCategoryOrder
    .map((category) => ({
      category,
      label: promptCategoryLabels[category],
      tags: tags.filter((tag) => tag.category === category),
    }))
    .filter((group) => group.tags.length > 0);
}

function findAppliedTag(tags: PromptTag[], tag: PromptTag) {
  return tags.find(
    (appliedTag) =>
      appliedTag.prompt === tag.prompt &&
      appliedTag.category === tag.category &&
      Boolean(appliedTag.negative) === Boolean(tag.negative),
  );
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
    updatePromptLibraryTag,
    updatePromptTag,
  } = useEditorStore();
  const [bodyPartTarget, setBodyPartTarget] = useState<BodyPartTargetValue>("character");
  const [importDraft, setImportDraft] = useState("");
  const [importStatus, setImportStatus] = useState<ImportUiStatus>("idle");
  const [importError, setImportError] = useState("");
  const [importFeedback, setImportFeedback] = useState("");
  const [manageStatus, setManageStatus] = useState<ManageUiStatus>("idle");
  const [manageError, setManageError] = useState("");
  const [pendingManageTag, setPendingManageTag] = useState<PromptTag | null>(null);
  const [manageDraft, setManageDraft] = useState<PromptLibraryTagDraft>({
    label: "",
    prompt: "",
    category: "style",
    negative: false,
  });

  const allLibraryTags = useMemo(() => {
    const custom = project.settings.promptLibraryTags ?? [];
    const deletedBuiltIns = new Set(project.settings.deletedBuiltInPromptLibraryTagIds ?? []);
    const builtIns = BUILT_IN_PROMPT_LIBRARY_TAGS.filter((tag) => !deletedBuiltIns.has(tag.id));
    return [...builtIns, ...custom];
  }, [project.settings.deletedBuiltInPromptLibraryTagIds, project.settings.promptLibraryTags]);
  const promptLibraryGroups = useMemo(() => groupPromptLibrary(allLibraryTags), [allLibraryTags]);

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
  }, [selectedBodyPart, selectedCharacter, selectedObject]);

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

  async function handleTogglePromptTag(tag: PromptTag, appliedTag: PromptTag | undefined) {
    await persistCurrentProject(
      () =>
        appliedTag
          ? removePromptTag(tagTarget, appliedTag.id)
          : addPromptTag(tagTarget, tag),
      "toggle-library-tag",
    );
  }

  async function handleRemoveAppliedTag(tagId: string) {
    await persistCurrentProject(() => removePromptTag(tagTarget, tagId), "remove-applied-tag");
  }

  async function handleUpdateAppliedTag(tagId: string, patch: Parameters<typeof updatePromptTag>[2]) {
    await persistCurrentProject(() => updatePromptTag(tagTarget, tagId, patch), "update-applied-tag");
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
        await saveProject(nextProject);
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

  function requestManagePromptLibraryTag(tag: PromptTag) {
    setPendingManageTag(tag);
    setManageDraft({
      label: tag.label,
      prompt: tag.prompt,
      category: tag.category,
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
      await saveProject(nextProject);

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
      const updated = updatePromptLibraryTag({
        ...pendingManageTag,
        label: label || prompt.slice(0, 48),
        prompt,
        category,
        negative: category === "negative" ? true : manageDraft.negative,
      });

      if (!updated) {
        throw new Error("未找到可更新的词库标签。");
      }

      const nextProject = useEditorStore.getState().project;
      await saveProject(nextProject);

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

  const appliedTags = selectedObject
    ? selectedObject.promptTags
    : selectedBodyPart
      ? selectedBodyPart.promptTags
      : selectedCharacter
        ? selectedCharacter.promptTags
        : project.scene.promptTags;

  const targetLabel = selectedObject
    ? `对象：${selectedObject.name}`
    : selectedBodyPart
      ? `部位：${selectedBodyPart.label}`
      : selectedCharacter
        ? `人物：${selectedCharacter.name}`
        : "场景";

  return (
    <section className="flex flex-col flex-1">
      <div className="mb-4 flex items-center gap-2.5 border-b border-slate-100 pb-3 shrink-0">
        <div className="rounded-lg bg-pink-50 p-1.5 text-pink-600">
          <Tags className="size-4" />
        </div>
        <h2 className="text-[15px] font-semibold text-slate-800">Prompt 词库</h2>
      </div>
      <div className="space-y-5 overflow-y-auto pr-1 custom-scrollbar">
        <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4 shadow-sm">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">当前目标</p>
          <p className="mt-1.5 text-sm font-bold text-slate-800">{targetLabel}</p>
          {selectedCharacter ? (
            <select
              className="mt-3 h-9 w-full rounded-xl border border-slate-200/80 bg-white px-3 text-xs text-slate-700 shadow-sm outline-none transition-all focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10"
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
        </div>

        <div className="rounded-2xl border border-pink-100/80 bg-pink-50/20 p-4 shadow-sm">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">从文本导入</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-600">
            粘贴整段 Prompt（可含逗号换行、引号块、LoRA 行等）。将通过 AI 拆分、分类并写入当前项目的词库。
          </p>
          <textarea
            className="mt-3 min-h-[100px] w-full resize-y rounded-xl border border-slate-200/80 bg-white px-3 py-2.5 text-xs leading-relaxed text-slate-800 shadow-inner outline-none transition-all placeholder:text-slate-400 focus:border-pink-300 focus:ring-2 focus:ring-pink-200/40 disabled:opacity-60"
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
            className="mt-3 h-9 w-full gap-2 rounded-xl bg-pink-600 text-xs font-medium text-white shadow-sm hover:bg-pink-700 disabled:opacity-60"
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

        <div>
          <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">点击选择或取消选择</p>
          <div className="space-y-4">
            {promptLibraryGroups.map((group) => (
              <div key={group.category}>
                <p className="mb-2 text-xs font-semibold text-slate-700">{group.label}</p>
                <div className="flex flex-wrap gap-2">
                  {group.tags.map((tag) => {
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
              </div>
            ))}
          </div>
        </div>

        <div className="pt-2 border-t border-slate-100">
          <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">已应用标签</p>
          {appliedTags.length > 0 ? (
            <div className="space-y-3">
              {appliedTags.map((tag) => (
                <div
                  className="group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-3 shadow-sm transition-all hover:border-blue-200 hover:shadow-md"
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
                  <div className="mt-3 grid grid-cols-[auto_1fr] items-center gap-3 rounded-xl bg-slate-50/80 p-2.5 shadow-inner">
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
                      className="w-full rounded-lg border border-slate-200/80 bg-white px-2.5 py-1.5 text-xs text-slate-900 shadow-sm outline-none transition-all focus:border-blue-400 focus:ring-2 focus:ring-blue-400/10 disabled:opacity-50"
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
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200/80 bg-slate-50/50 p-6 text-center">
              <Tags className="mb-2 size-6 text-slate-300" />
              <p className="text-xs text-slate-500">
                还没有给当前目标添加标签。
              </p>
            </div>
          )}
        </div>
      </div>
      {pendingManageTag && typeof document !== "undefined" ? createPortal(
        <div
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm"
          role="dialog"
        >
          <div className="w-full max-w-md overflow-hidden rounded-3xl border border-white/60 bg-white shadow-2xl">
            <div className="flex items-start gap-3 border-b border-slate-100 bg-pink-50/70 p-5">
              <div className="rounded-2xl bg-white p-2 text-pink-600 shadow-sm">
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
                  className="mt-2 h-10 w-full rounded-xl border border-slate-200/80 bg-white px-3 text-sm text-slate-800 shadow-sm outline-none transition-all focus:border-pink-300 focus:ring-2 focus:ring-pink-200/40 disabled:opacity-60"
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
                  className="mt-2 min-h-[82px] w-full resize-y rounded-xl border border-slate-200/80 bg-white px-3 py-2.5 text-sm leading-relaxed text-slate-800 shadow-sm outline-none transition-all focus:border-pink-300 focus:ring-2 focus:ring-pink-200/40 disabled:opacity-60"
                  disabled={manageStatus === "loading"}
                  onChange={(event) =>
                    setManageDraft((draft) => ({ ...draft, prompt: event.target.value }))
                  }
                  value={manageDraft.prompt}
                />
              </label>
              <div className="grid grid-cols-[1fr_auto] items-end gap-3">
                <label className="block">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    分类
                  </span>
                  <select
                    className="mt-2 h-10 w-full rounded-xl border border-slate-200/80 bg-white px-3 text-sm text-slate-800 shadow-sm outline-none transition-all focus:border-pink-300 focus:ring-2 focus:ring-pink-200/40 disabled:opacity-60"
                    disabled={manageStatus === "loading"}
                    onChange={(event) =>
                      setManageDraft((draft) => ({
                        ...draft,
                        category: event.target.value as PromptTagCategory,
                        negative:
                          event.target.value === "negative" ? true : draft.negative,
                      }))
                    }
                    value={manageDraft.category}
                  >
                    {promptCategoryOrder.map((category) => (
                      <option key={category} value={category}>
                        {promptCategoryLabels[category]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex h-10 items-center gap-2 rounded-xl border border-slate-200/80 bg-slate-50/70 px-3 text-xs font-medium text-slate-700">
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
                  className="h-10 rounded-xl border-rose-100 bg-rose-50 px-4 text-rose-600 shadow-sm hover:bg-rose-100"
                  disabled={manageStatus === "loading"}
                  onClick={() => void confirmDeletePromptLibraryTag()}
                  type="button"
                  variant="secondary"
                >
                  删除
                </Button>
                <Button
                  className="h-10 rounded-xl border-slate-200/80 bg-slate-50/80 text-slate-700 shadow-sm hover:bg-white"
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
                  className="h-10 rounded-xl bg-pink-600 text-white shadow-sm hover:bg-pink-700 disabled:opacity-60"
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
