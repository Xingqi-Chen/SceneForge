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
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Tags className="size-4 text-slate-500" />
        <h2 className="text-sm font-semibold text-slate-950">Prompt 词库</h2>
      </div>
      <div className="space-y-3">
        <div className="rounded-xl bg-slate-50 p-3">
          <p className="text-xs font-medium text-slate-500">当前目标</p>
          <p className="mt-1 text-sm font-semibold text-slate-950">{targetLabel}</p>
          {selectedCharacter ? (
            <select
              className="mt-2 h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs"
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
          <p className="mb-2 text-xs font-medium text-slate-500">点击选择或取消选择</p>
          <div className="space-y-3">
            {promptLibraryGroups.map((group) => (
              <div key={group.category}>
                <p className="mb-1.5 text-xs font-semibold text-slate-700">{group.label}</p>
                <div className="flex flex-wrap gap-2">
                  {group.tags.map((tag) => {
                    const appliedTag = findAppliedTag(appliedTags, tag);

                    return (
                      <button
                        aria-pressed={Boolean(appliedTag)}
                        className={
                          appliedTag
                            ? "rounded-full bg-slate-950 px-3 py-1 text-xs text-white hover:bg-slate-800"
                            : "rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700 hover:bg-slate-200"
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

        <div>
          <p className="mb-2 text-xs font-medium text-slate-500">已应用标签</p>
          {appliedTags.length > 0 ? (
            <div className="space-y-2">
              {appliedTags.map((tag) => (
                <div
                  className="rounded-xl border border-slate-200 p-2"
                  key={tag.id}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-medium text-slate-950">{tag.label}</p>
                      <p className="mt-0.5 text-xs leading-5 text-slate-500">{tag.prompt}</p>
                    </div>
                    <button
                      aria-label={`删除 ${tag.label}`}
                      className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      onClick={() => removePromptTag(tagTarget, tag.id)}
                      type="button"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                  <div className="mt-2 grid grid-cols-[auto_1fr] items-center gap-2 rounded-lg bg-slate-50 p-2">
                    <label className="flex items-center gap-1.5 text-xs text-slate-600">
                      <input
                        checked={tag.weight.enabled}
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
                      className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-950 disabled:bg-slate-100 disabled:text-slate-400"
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
            <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500">
              还没有给当前目标添加标签。
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
