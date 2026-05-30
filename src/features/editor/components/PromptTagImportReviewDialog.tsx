"use client";

import { Loader2, Sparkles, X } from "lucide-react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import type { CharacterPromptTagTarget } from "@/features/prompt-engine/prompt-library/character-image-prompt-tags";
import { BUILT_IN_PROMPT_LIBRARY_TAGS } from "@/features/prompt-engine/prompt-library/built-in-prompt-tags";
import {
  PROMPT_TAG_CATEGORY_LABELS,
  PROMPT_TAG_SUBCATEGORY_LABELS,
} from "@/features/prompt-engine/prompt-library/prompt-tag-taxonomy";
import type { PromptTag, SceneForgeProject } from "@/shared/types";

export type BoundPromptTagSuggestion = {
  target: CharacterPromptTagTarget;
  tag: Omit<PromptTag, "id">;
};

export type PendingPromptTagImportReview = {
  suggestions: BoundPromptTagSuggestion[];
  existingSuggestions: Array<BoundPromptTagSuggestion & { libraryTag: PromptTag }>;
  newSuggestions: BoundPromptTagSuggestion[];
};

export type NewPromptTagApplyMode = "skip" | "temporary" | "import";

type PromptLibrarySettings = Pick<
  SceneForgeProject["settings"],
  "deletedBuiltInPromptLibraryTagIds" | "promptLibraryTags"
>;

type PromptTagImportReviewDialogProps = {
  getSuggestionTargetLabel: (target: CharacterPromptTagTarget) => string;
  isSaving?: boolean;
  onApply: (mode: NewPromptTagApplyMode) => void;
  onCancel: () => void;
  review: PendingPromptTagImportReview;
  title: string;
};

export function getSemanticTagKey(tag: Pick<PromptTag, "prompt" | "category" | "negative">) {
  return [
    tag.prompt.trim().toLocaleLowerCase(),
    tag.category,
    Boolean(tag.negative) ? "negative" : "positive",
  ].join("|");
}

export function getSuggestionTargetKey(target: CharacterPromptTagTarget) {
  if (target.kind === "scene") {
    return "scene";
  }

  return target.kind === "character" ? "character" : `bodyPart:${target.bodyPartId}`;
}

export function getAvailablePromptLibraryTags(settings: PromptLibrarySettings) {
  const custom = settings.promptLibraryTags ?? [];
  const deletedBuiltIns = new Set(settings.deletedBuiltInPromptLibraryTagIds ?? []);
  const builtIns = BUILT_IN_PROMPT_LIBRARY_TAGS.filter((tag) => !deletedBuiltIns.has(tag.id));

  return [...builtIns, ...custom];
}

export function makeTransientPromptTag(tag: Omit<PromptTag, "id">): PromptTag {
  return {
    ...tag,
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? `analysis-${crypto.randomUUID()}`
        : `analysis-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    weight: { ...tag.weight },
  };
}

export function uniquePromptTagSuggestions(suggestions: BoundPromptTagSuggestion[]) {
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

export function splitPromptTagSuggestionsByLibrary(
  suggestions: BoundPromptTagSuggestion[],
  libraryTags: PromptTag[],
): PendingPromptTagImportReview {
  const libraryTagBySemanticKey = new Map(
    libraryTags.map((tag) => [getSemanticTagKey(tag), tag]),
  );
  const existingSuggestions: Array<BoundPromptTagSuggestion & { libraryTag: PromptTag }> = [];
  const newSuggestions: BoundPromptTagSuggestion[] = [];

  for (const suggestion of uniquePromptTagSuggestions(suggestions)) {
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

export function PromptTagImportReviewDialog({
  getSuggestionTargetLabel,
  isSaving = false,
  onApply,
  onCancel,
  review,
  title,
}: PromptTagImportReviewDialogProps) {
  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm"
      role="dialog"
    >
      <div className="flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden rounded-md border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start gap-3 border-b border-slate-100 bg-pink-50 p-5">
          <div className="rounded-md bg-white p-2 text-pink-600">
            <Sparkles className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-slate-900">{title}</h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              AI 识别到 {review.newSuggestions.length} 个词库中不存在的词条。可导入词库，也可仅本次保留并应用到当前目标。
            </p>
          </div>
          <button
            aria-label="关闭新增提示词确认"
            className="rounded-full bg-white/80 p-1.5 text-slate-400 shadow-sm transition-all hover:bg-white hover:text-slate-700 disabled:opacity-50"
            disabled={isSaving}
            onClick={onCancel}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 custom-scrollbar">
          <ul className="space-y-2">
            {review.newSuggestions.map((suggestion) => {
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

        <div className="flex flex-col gap-2 border-t border-slate-100 bg-slate-50 p-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end sm:gap-3">
          <Button
            className="h-10 w-full whitespace-nowrap rounded-md border-slate-200 bg-white px-5 text-slate-700 hover:bg-slate-50 sm:w-auto sm:min-w-[148px]"
            disabled={isSaving}
            onClick={() => onApply("skip")}
            type="button"
            variant="secondary"
          >
            仅选中已有词条
          </Button>
          <Button
            className="h-10 w-full whitespace-nowrap rounded-md border-pink-200 bg-white px-5 text-pink-700 hover:bg-pink-50 disabled:opacity-60 sm:w-auto sm:min-w-[190px]"
            disabled={isSaving}
            onClick={() => onApply("temporary")}
            type="button"
            variant="secondary"
          >
            本次保留，不入词库
          </Button>
          <Button
            className="h-10 w-full whitespace-nowrap rounded-md bg-pink-600 px-5 text-white hover:bg-pink-700 disabled:opacity-60 sm:w-auto sm:min-w-[148px]"
            disabled={isSaving}
            onClick={() => onApply("import")}
            type="button"
          >
            {isSaving ? <Loader2 className="size-4 animate-spin" /> : null}
            导入并选中
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
