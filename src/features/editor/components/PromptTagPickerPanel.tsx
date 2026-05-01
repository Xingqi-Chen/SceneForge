import { Tags, X } from "lucide-react";
import { useMemo, useState } from "react";

import { useEditorStore, type PromptTagTarget } from "@/features/editor/store/editor-store";
import type { BodyPartId, PromptTag, PromptTagCategory } from "@/shared/types";

const promptLibrary: PromptTag[] = [
  {
    id: "library-cinematic",
    label: "电影感",
    prompt: "cinematic composition",
    category: "style",
    weight: { enabled: true, value: 1.15 },
  },
  {
    id: "library-soft-light",
    label: "柔和光线",
    prompt: "soft light",
    category: "lighting",
    weight: { enabled: true, value: 1.1 },
  },
  {
    id: "library-high-quality",
    label: "高质量",
    prompt: "high quality, detailed illustration",
    category: "quality",
    weight: { enabled: false, value: 1 },
  },
  {
    id: "library-long-hair",
    label: "长发",
    prompt: "long flowing hair",
    category: "body-part",
    weight: { enabled: true, value: 1.2 },
  },
  {
    id: "library-blue-eyes",
    label: "蓝色眼睛",
    prompt: "blue eyes",
    category: "body-part",
    weight: { enabled: false, value: 1 },
  },
  {
    id: "library-holding-sword",
    label: "手持剑",
    prompt: "holding a sword",
    category: "body-part",
    weight: { enabled: false, value: 1 },
  },
  {
    id: "library-standing-pose",
    label: "自然站姿",
    prompt: "standing naturally",
    category: "character",
    weight: { enabled: false, value: 1 },
  },
  {
    id: "library-misty-background",
    label: "雾气背景",
    prompt: "misty background",
    category: "scene",
    weight: { enabled: false, value: 1 },
  },
  {
    id: "library-negative-low-quality",
    label: "低质量负面",
    prompt: "low quality, blurry",
    category: "negative",
    weight: { enabled: false, value: 1 },
    negative: true,
  },
];

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
    project,
    removePromptTag,
    selectBodyPart,
    selectCharacter,
    selection,
    updatePromptTag,
  } = useEditorStore();
  const [bodyPartTarget, setBodyPartTarget] = useState<BodyPartTargetValue>("character");
  const promptLibraryGroups = useMemo(() => groupPromptLibrary(promptLibrary), []);

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

  function updateTagWeightValue(tagId: string, value: number) {
    updatePromptTag(tagTarget, tagId, {
      weight: { value: Number.isFinite(value) ? value : 1 },
    });
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
                      <button
                        aria-pressed={Boolean(appliedTag)}
                        className={
                          appliedTag
                            ? "rounded-full bg-slate-800 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-all hover:bg-slate-900 hover:shadow"
                            : "rounded-full border border-slate-200/80 bg-slate-50/80 px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition-all hover:border-slate-300 hover:bg-white hover:text-slate-900 hover:shadow"
                        }
                        key={tag.id}
                        onClick={() =>
                          appliedTag
                            ? removePromptTag(tagTarget, appliedTag.id)
                            : addPromptTag(tagTarget, tag)
                        }
                        title={tag.prompt}
                        type="button"
                      >
                        {tag.label}
                      </button>
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
                      onClick={() => removePromptTag(tagTarget, tag.id)}
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
                          updatePromptTag(tagTarget, tag.id, {
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
                      onChange={(event) => updateTagWeightValue(tag.id, event.target.valueAsNumber)}
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
    </section>
  );
}
