"use client";

import { useMemo, useState } from "react";
import { Check, Tags } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DEFAULT_PROMPT_CATEGORY_BINDINGS,
  DEFAULT_PROMPT_SUBCATEGORY_BINDINGS,
} from "@/features/editor/store/defaults";
import { useEditorStore, type PromptTagTarget } from "@/features/editor/store/editor-store";
import { saveProject } from "@/features/persistence";
import { getAvailablePromptLibraryTags } from "@/features/editor/components/PromptTagImportReviewDialog";
import {
  PROMPT_TAG_CATEGORY_LABELS,
  PROMPT_TAG_CATEGORY_ORDER,
  PROMPT_TAG_SUBCATEGORY_LABELS,
  PROMPT_TAG_SUBCATEGORY_OPTIONS,
} from "@/features/prompt-engine/prompt-library/prompt-tag-taxonomy";
import type { BodyPartId, PromptTag, PromptTagCategory, PromptTagSubcategory } from "@/shared/types";
import { cn } from "@/shared/utils/cn";

type BodyPartTargetValue = BodyPartId | "character";
type PromptLibraryGroup = {
  category: PromptTagCategory;
  label: string;
  tagCount: number;
  subgroups: Array<{
    subcategory: PromptTagSubcategory | "";
    label: string;
    tags: PromptTag[];
  }>;
};

const WHOLE_CHARACTER_PROMPT_CATEGORIES: PromptTagCategory[] = ["character"];
const WHOLE_CHARACTER_PROMPT_SUBCATEGORIES: PromptTagSubcategory[] = [
  ...PROMPT_TAG_SUBCATEGORY_OPTIONS.character,
];
const HEAD_EXTRA_PROMPT_CATEGORIES: PromptTagCategory[] = ["negative"];
const HEAD_EXTRA_PROMPT_SUBCATEGORIES: PromptTagSubcategory[] = [
  "negative-anatomy",
  "negative-artifact",
];

function mergePromptBindingValues<T>(base: T[], extras: T[]) {
  return Array.from(new Set([...base, ...extras]));
}

function getPromptSubcategoryKey(category: PromptTagCategory, subcategory: string) {
  return `${category}:${subcategory || "uncategorized"}`;
}

function groupPromptLibrary(tags: PromptTag[]): PromptLibraryGroup[] {
  return PROMPT_TAG_CATEGORY_ORDER
    .map((category) => {
      const categoryTags = tags.filter((tag) => tag.category === category);
      const subgroups = [
        ...PROMPT_TAG_SUBCATEGORY_OPTIONS[category].map(
          (subcategory): PromptLibraryGroup["subgroups"][number] => ({
            subcategory: subcategory as PromptTagSubcategory,
            label: PROMPT_TAG_SUBCATEGORY_LABELS[subcategory],
            tags: categoryTags.filter((tag) => tag.subcategory === subcategory),
          }),
        ),
        {
          subcategory: "" as const,
          label: "Uncategorized",
          tags: categoryTags.filter((tag) => !tag.subcategory),
        },
      ].filter((group) => group.tags.length > 0) as PromptLibraryGroup["subgroups"];

      return {
        category,
        label: PROMPT_TAG_CATEGORY_LABELS[category],
        tagCount: categoryTags.length,
        subgroups,
      };
    })
    .filter((group) => group.subgroups.length > 0);
}

function filterPromptLibraryGroupsByBindings(
  groups: PromptLibraryGroup[],
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
        subgroups,
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

export function TimelinePromptLibraryDrawer() {
  const {
    addPromptTag,
    project,
    removePromptTag,
    selectBodyPart,
    selectCharacter,
    selection,
  } = useEditorStore();
  const [bodyPartTarget, setBodyPartTarget] = useState<BodyPartTargetValue>("character");
  const [selectedPromptCategory, setSelectedPromptCategory] = useState<PromptTagCategory | null>(
    null,
  );
  const [selectedPromptSubcategoryKey, setSelectedPromptSubcategoryKey] = useState<string | null>(
    null,
  );

  const allLibraryTags = useMemo(
    () => getAvailablePromptLibraryTags(project.settings),
    [project.settings],
  );
  const promptLibraryGroups = useMemo(
    () => groupPromptLibrary(allLibraryTags),
    [allLibraryTags],
  );
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
  const isWholeCharacterTarget = Boolean(selectedCharacter && !selectedBodyPart);

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

  const rawPromptCategoryBindings = selectedObject
    ? (selectedObject.promptCategoryBindings ?? DEFAULT_PROMPT_CATEGORY_BINDINGS.object)
    : selectedBodyPart
      ? (selectedBodyPart.promptCategoryBindings ?? DEFAULT_PROMPT_CATEGORY_BINDINGS.bodyPart)
      : selectedCharacter
        ? (selectedCharacter.promptCategoryBindings ?? DEFAULT_PROMPT_CATEGORY_BINDINGS.character)
        : (project.scene.promptCategoryBindings ?? DEFAULT_PROMPT_CATEGORY_BINDINGS.scene);
  const rawPromptSubcategoryBindings = selectedObject
    ? (selectedObject.promptSubcategoryBindings ?? DEFAULT_PROMPT_SUBCATEGORY_BINDINGS.object)
    : selectedBodyPart
      ? (selectedBodyPart.promptSubcategoryBindings ?? DEFAULT_PROMPT_SUBCATEGORY_BINDINGS.bodyPart)
      : selectedCharacter
        ? (selectedCharacter.promptSubcategoryBindings ??
          DEFAULT_PROMPT_SUBCATEGORY_BINDINGS.character)
        : (project.scene.promptSubcategoryBindings ?? DEFAULT_PROMPT_SUBCATEGORY_BINDINGS.scene);
  const currentPromptCategoryBindings = isWholeCharacterTarget
    ? WHOLE_CHARACTER_PROMPT_CATEGORIES
    : selectedBodyPart?.id === "head"
      ? mergePromptBindingValues(rawPromptCategoryBindings, HEAD_EXTRA_PROMPT_CATEGORIES)
      : rawPromptCategoryBindings;
  const currentPromptSubcategoryBindings = isWholeCharacterTarget
    ? rawPromptSubcategoryBindings.filter((subcategory) =>
        WHOLE_CHARACTER_PROMPT_SUBCATEGORIES.includes(subcategory),
      )
    : selectedBodyPart?.id === "head"
      ? mergePromptBindingValues(rawPromptSubcategoryBindings, HEAD_EXTRA_PROMPT_SUBCATEGORIES)
      : rawPromptSubcategoryBindings;
  const boundPromptLibraryGroups = useMemo(
    () =>
      filterPromptLibraryGroupsByBindings(
        promptLibraryGroups,
        currentPromptCategoryBindings,
        currentPromptSubcategoryBindings,
      ),
    [currentPromptCategoryBindings, currentPromptSubcategoryBindings, promptLibraryGroups],
  );
  const selectedPromptLibraryGroup =
    boundPromptLibraryGroups.find((group) => group.category === selectedPromptCategory) ??
    boundPromptLibraryGroups[0];
  const selectedPromptLibrarySubgroup = selectedPromptLibraryGroup
    ? (
        selectedPromptLibraryGroup.subgroups.find(
          (subgroup) =>
            getPromptSubcategoryKey(
              selectedPromptLibraryGroup.category,
              subgroup.subcategory,
            ) === selectedPromptSubcategoryKey,
        ) ?? selectedPromptLibraryGroup.subgroups[0]
      )
    : undefined;
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
    ? `Multiple (${selection.objectIds.length + selection.characterIds.length})`
    : selectedObject
      ? `Object: ${selectedObject.name}`
      : selectedBodyPart
        ? `Body part: ${selectedBodyPart.label}`
        : selectedCharacter
          ? `Character: ${selectedCharacter.name}`
          : "Scene";

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

  async function handleTogglePromptTag(tag: PromptTag, appliedTag: PromptTag | undefined) {
    if (multiSelection) {
      return;
    }

    if (appliedTag) {
      removePromptTag(tagTarget, appliedTag.id);
    } else {
      addPromptTag(tagTarget, tag);
    }

    try {
      await saveProject(useEditorStore.getState().project);
    } catch (error) {
      console.error("[SceneForge] [timeline-prompt-library] failed to persist prompt tag change", {
        error,
      });
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white" data-testid="timeline-prompt-library-drawer">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-3 py-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Prompt library
          </p>
          <p className="truncate text-xs text-slate-500">{targetLabel}</p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-500">
          <Tags className="size-3" />
          {allLibraryTags.length}
        </span>
      </div>

      <div className="custom-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {selectedCharacter ? (
          <label className="block rounded-md border border-slate-200 bg-slate-50 p-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Target
            </span>
            <select
              className="mt-1.5 h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
              onChange={(event) =>
                handleBodyPartTargetChange(event.target.value as BodyPartTargetValue)
              }
              value={currentBodyPartTarget}
            >
              <option value="character">Whole character</option>
              {selectedCharacter.bodyParts.map((bodyPart) => (
                <option key={bodyPart.id} value={bodyPart.id}>
                  {bodyPart.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {multiSelection ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
            Select a single scene target before applying prompt-library tags.
          </div>
        ) : null}

        {boundPromptLibraryGroups.length > 0 && selectedPromptLibraryGroup ? (
          <>
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Categories
              </p>
              <div className="flex flex-wrap gap-1.5">
                {boundPromptLibraryGroups.map((group) => {
                  const isSelected = group.category === selectedPromptLibraryGroup.category;

                  return (
                    <button
                      aria-pressed={isSelected}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                        isSelected
                          ? "border-slate-900 bg-slate-900 text-white"
                          : "border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700",
                      )}
                      key={group.category}
                      onClick={() => {
                        setSelectedPromptCategory(group.category);
                        setSelectedPromptSubcategoryKey(null);
                      }}
                      type="button"
                    >
                      {group.label}
                      <span className="ml-1 text-[10px] opacity-70">{group.tagCount}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Direction
              </p>
              <div className="flex flex-wrap gap-1.5">
                {selectedPromptLibraryGroup.subgroups.map((subgroup) => {
                  const subgroupKey = getPromptSubcategoryKey(
                    selectedPromptLibraryGroup.category,
                    subgroup.subcategory,
                  );
                  const isSelected =
                    selectedPromptLibrarySubgroup &&
                    getPromptSubcategoryKey(
                      selectedPromptLibraryGroup.category,
                      selectedPromptLibrarySubgroup.subcategory,
                    ) === subgroupKey;

                  return (
                    <button
                      aria-pressed={Boolean(isSelected)}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                        isSelected
                          ? "border-indigo-600 bg-indigo-600 text-white"
                          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50",
                      )}
                      key={subgroupKey}
                      onClick={() => setSelectedPromptSubcategoryKey(subgroupKey)}
                      type="button"
                    >
                      {subgroup.label}
                      <span className="ml-1 text-[10px] opacity-70">{subgroup.tags.length}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Available tags
              </p>
              {selectedPromptLibrarySubgroup ? (
                <div className="flex flex-wrap gap-1.5">
                  {selectedPromptLibrarySubgroup.tags.map((tag) => {
                    const appliedTag = findAppliedTag(appliedTags, tag);

                    return (
                      <button
                        aria-pressed={Boolean(appliedTag)}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors",
                          appliedTag
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-slate-200 bg-white text-slate-700 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700",
                        )}
                        data-testid="timeline-prompt-library-tag"
                        key={tag.id}
                        onClick={() => void handleTogglePromptTag(tag, appliedTag)}
                        title={tag.prompt}
                        type="button"
                      >
                        {appliedTag ? <Check className="size-3" /> : null}
                        {tag.label}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-500">
            No prompt-library tags match the current target bindings.
          </div>
        )}

        <div className="space-y-2 border-t border-slate-200 pt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Applied tags
          </p>
          {appliedTags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {appliedTags.map((tag) => (
                <Button
                  className="h-7 rounded-md border-slate-200 bg-slate-50 px-2 text-xs text-slate-700 hover:bg-white"
                  key={tag.id}
                  onClick={() => void handleTogglePromptTag(tag, tag)}
                  size="sm"
                  title={tag.prompt}
                  type="button"
                  variant="secondary"
                >
                  {tag.label}
                </Button>
              ))}
            </div>
          ) : (
            <p className="text-xs leading-relaxed text-slate-500">
              No tags are applied to this target yet.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
