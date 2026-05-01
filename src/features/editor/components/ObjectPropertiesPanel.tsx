"use client";

import { MousePointer2 } from "lucide-react";
import type { ChangeEvent, ReactNode } from "react";

import { useEditorStore } from "@/features/editor/store/editor-store";
import type { SceneObject } from "@/shared/types";

function FieldLabel({ children }: { children: ReactNode }) {
  return <label className="text-xs font-medium text-slate-500">{children}</label>;
}

function getNumber(event: ChangeEvent<HTMLInputElement>) {
  return Number.isFinite(event.target.valueAsNumber) ? event.target.valueAsNumber : 0;
}

export function ObjectPropertiesPanel() {
  const { project, selection, updateObject } = useEditorStore();
  const selectedObject =
    selection.kind === "object"
      ? project.scene.objects.find((object) => object.id === selection.id)
      : undefined;
  const selectedCharacter =
    selection.kind === "character"
      ? project.scene.characters.find((character) => character.id === selection.id)
      : undefined;

  function updateSelectedObject(patch: Partial<SceneObject>) {
    if (selectedObject) {
      updateObject(selectedObject.id, patch);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <MousePointer2 className="size-4 text-slate-500" />
        <h2 className="text-sm font-semibold text-slate-950">对象属性</h2>
      </div>
      {selectedObject ? (
        <div className="space-y-4 text-sm">
          <div className="space-y-1.5">
            <FieldLabel>名称</FieldLabel>
            <input
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-950 outline-none focus:border-slate-400"
              onChange={(event) => updateSelectedObject({ name: event.target.value })}
              value={selectedObject.name}
            />
          </div>
          <div className="space-y-1.5">
            <FieldLabel>场景描述</FieldLabel>
            <textarea
              className="min-h-20 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm leading-5 text-slate-950 outline-none focus:border-slate-400"
              onChange={(event) => updateSelectedObject({ description: event.target.value })}
              value={selectedObject.description}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <FieldLabel>X</FieldLabel>
              <input
                className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                onChange={(event) =>
                  updateSelectedObject({
                    position: { ...selectedObject.position, x: getNumber(event) },
                  })
                }
                type="number"
                value={selectedObject.position.x}
              />
            </div>
            <div className="space-y-1.5">
              <FieldLabel>Y</FieldLabel>
              <input
                className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                onChange={(event) =>
                  updateSelectedObject({
                    position: { ...selectedObject.position, y: getNumber(event) },
                  })
                }
                type="number"
                value={selectedObject.position.y}
              />
            </div>
            <div className="space-y-1.5">
              <FieldLabel>宽度</FieldLabel>
              <input
                className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                min={16}
                onChange={(event) =>
                  updateSelectedObject({
                    size: { ...selectedObject.size, width: getNumber(event) },
                  })
                }
                type="number"
                value={selectedObject.size.width}
              />
            </div>
            <div className="space-y-1.5">
              <FieldLabel>高度</FieldLabel>
              <input
                className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                min={16}
                onChange={(event) =>
                  updateSelectedObject({
                    size: { ...selectedObject.size, height: getNumber(event) },
                  })
                }
                type="number"
                value={selectedObject.size.height}
              />
            </div>
          </div>
          <div className="grid grid-cols-[1fr_auto] items-end gap-3">
            <div className="space-y-1.5">
              <FieldLabel>颜色</FieldLabel>
              <input
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-2"
                onChange={(event) => updateSelectedObject({ fill: event.target.value })}
                type="color"
                value={selectedObject.fill}
              />
            </div>
            <label className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs text-slate-600">
              <input
                checked={selectedObject.includeInPrompt}
                onChange={(event) =>
                  updateSelectedObject({ includeInPrompt: event.target.checked })
                }
                type="checkbox"
              />
              参与 Prompt
            </label>
          </div>
          <div className="grid grid-cols-[auto_1fr] items-center gap-3 rounded-xl bg-slate-50 p-3">
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input
                checked={selectedObject.weight.enabled}
                onChange={(event) =>
                  updateSelectedObject({
                    weight: { ...selectedObject.weight, enabled: event.target.checked },
                  })
                }
                type="checkbox"
              />
              启用权重
            </label>
            <input
              className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
              max={2}
              min={0.1}
              onChange={(event) =>
                updateSelectedObject({
                  weight: { ...selectedObject.weight, value: getNumber(event) },
                })
              }
              step={0.05}
              type="number"
              value={selectedObject.weight.value}
            />
          </div>
        </div>
      ) : selectedCharacter ? (
        <div className="space-y-2 text-sm text-slate-600">
          <p className="font-medium text-slate-950">{selectedCharacter.name}</p>
          <p>{selectedCharacter.description}</p>
          <p className="text-xs text-slate-500">
            人物骨架已参与 Prompt。后续可继续扩展关节点拖拽和部位级提示词编辑。
          </p>
        </div>
      ) : (
        <p className="text-sm text-slate-500">选择画布对象后，在这里编辑名称、描述和权重。</p>
      )}
    </section>
  );
}
