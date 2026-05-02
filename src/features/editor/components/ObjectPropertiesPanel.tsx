"use client";

import { MousePointer2 } from "lucide-react";
import { useState, type ChangeEvent, type ReactNode } from "react";

import { defaultLineEndpoints, defaultPolygonPoints } from "@/features/editor/preset-scene-objects";
import { useEditorStore } from "@/features/editor/store/editor-store";
import type {
  CanvasAspectRatio,
  CharacterSkeleton,
  PromptModelFormat,
  Scene3DConfig,
  SceneObject,
  SceneObject3DTransform,
  Vector2,
  Vector3,
} from "@/shared/types";

function FieldLabel({ children }: { children: ReactNode }) {
  return <label className="text-xs font-medium text-slate-500">{children}</label>;
}

function getNumber(event: ChangeEvent<HTMLInputElement>) {
  return Number.isFinite(event.target.valueAsNumber) ? event.target.valueAsNumber : 0;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getClampedNumber(event: ChangeEvent<HTMLInputElement>, min: number, max: number) {
  return clampNumber(getNumber(event), min, max);
}

function is3DSceneObject(object: SceneObject) {
  return Boolean(object.transform3D);
}

function Vector3Fields({
  labels,
  onChange,
  value,
}: {
  labels: [string, string, string];
  onChange: (axis: keyof Vector3, value: number) => void;
  value: Vector3;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {(["x", "y", "z"] as const).map((axis, index) => (
        <div className="space-y-1" key={axis}>
          <FieldLabel>{labels[index]}</FieldLabel>
          <input
            className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
            onChange={(event) => onChange(axis, getNumber(event))}
            step={0.1}
            type="number"
            value={value[axis]}
          />
        </div>
      ))}
    </div>
  );
}

function parsePolygonPointsJson(text: string): Vector2[] | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }

  if (!Array.isArray(data)) {
    return null;
  }

  const points: Vector2[] = [];

  for (const item of data) {
    if (
      item &&
      typeof item === "object" &&
      "x" in item &&
      "y" in item &&
      typeof (item as Vector2).x === "number" &&
      typeof (item as Vector2).y === "number" &&
      Number.isFinite((item as Vector2).x) &&
      Number.isFinite((item as Vector2).y)
    ) {
      points.push({ x: (item as Vector2).x, y: (item as Vector2).y });
    }
  }

  return points.length >= 3 ? points : null;
}

function PolygonPointsField({
  width,
  height,
  points,
  onCommit,
}: {
  width: number;
  height: number;
  points: Vector2[] | undefined;
  onCommit: (next: Vector2[]) => void;
}) {
  const [value, setValue] = useState(() =>
    JSON.stringify(points ?? defaultPolygonPoints(width, height), null, 2),
  );
  const [error, setError] = useState("");

  return (
    <div className="space-y-1.5">
      <FieldLabel>多边形顶点 JSON</FieldLabel>
      <textarea
        className="min-h-[120px] w-full resize-y rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-xs leading-relaxed text-slate-900 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
        spellCheck={false}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setError("");
        }}
        onBlur={() => {
          const parsed = parsePolygonPointsJson(value);
          if (!parsed) {
            setError("需要至少 3 个 { \"x\", \"y\" } 顶点且为合法 JSON。");
            return;
          }
          onCommit(parsed);
        }}
      />
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

const canvasSizes: Record<CanvasAspectRatio, { width: number; height: number }> = {
  "1:1": { width: 960, height: 960 },
  "4:3": { width: 1024, height: 768 },
  "16:9": { width: 1280, height: 720 },
  "9:16": { width: 720, height: 1280 },
};

export function ObjectPropertiesPanel() {
  const {
    project,
    selection,
    updateCharacter,
    updateCharacter3DTransform,
    updateObject,
    updateObject3DTransform,
    updateProjectSettings,
    updateScene,
  } = useEditorStore();
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
  const selectedBodyPart =
    selection.kind === "bodyPart" && selectedCharacter
      ? selectedCharacter.bodyParts.find((bodyPart) => bodyPart.id === selection.bodyPartId)
      : undefined;

  function updateSelectedObject(patch: Partial<SceneObject>) {
    if (selectedObject) {
      updateObject(selectedObject.id, patch);
    }
  }

  function updateSelectedCharacter(patch: Partial<CharacterSkeleton>) {
    if (selectedCharacter) {
      updateCharacter(selectedCharacter.id, patch);
    }
  }

  function updateSelectedObject3DTransform(
    key: keyof SceneObject3DTransform,
    axis: keyof Vector3,
    value: number,
  ) {
    if (!selectedObject?.transform3D) {
      return;
    }

    updateObject3DTransform(selectedObject.id, {
      [key]: {
        ...selectedObject.transform3D[key],
        [axis]: value,
      },
    });
  }

  function updateSelectedCharacter3DTransform(
    key: keyof SceneObject3DTransform,
    axis: keyof Vector3,
    value: number,
  ) {
    if (!selectedCharacter) {
      return;
    }

    const transform = selectedCharacter.transform3D ?? {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    };

    updateCharacter3DTransform(selectedCharacter.id, {
      [key]: {
        ...transform[key],
        [axis]: value,
      },
    });
  }

  function handleAspectRatioChange(aspectRatio: CanvasAspectRatio) {
    updateScene({
      canvas: {
        ...project.scene.canvas,
        ...canvasSizes[aspectRatio],
        aspectRatio,
      },
    });
  }

  function updateScene3DCameraVector(
    key: keyof Pick<Scene3DConfig["camera"], "position" | "target">,
    axis: keyof Vector3,
    value: number,
  ) {
    updateScene({
      three: {
        ...project.scene.three,
        camera: {
          ...project.scene.three.camera,
          [key]: {
            ...project.scene.three.camera[key],
            [axis]: value,
          },
        },
      },
    });
  }

  function updateScene3DLightingPosition(axis: keyof Vector3, value: number) {
    updateScene({
      three: {
        ...project.scene.three,
        lighting: {
          ...project.scene.three.lighting,
          directionalPosition: {
            ...project.scene.three.lighting.directionalPosition,
            [axis]: value,
          },
        },
      },
    });
  }

  function updateScene3DConfig(patch: Partial<Scene3DConfig>) {
    updateScene({
      three: {
        ...project.scene.three,
        ...patch,
        camera: patch.camera
          ? { ...project.scene.three.camera, ...patch.camera }
          : project.scene.three.camera,
        lighting: patch.lighting
          ? { ...project.scene.three.lighting, ...patch.lighting }
          : project.scene.three.lighting,
        grid: patch.grid ? { ...project.scene.three.grid, ...patch.grid } : project.scene.three.grid,
      },
    });
  }

  return (
    <section className="flex flex-col">
      <div className="mb-4 flex items-center gap-2.5 border-b border-slate-100 pb-3 shrink-0">
        <div className="rounded-md bg-orange-50 p-1.5 text-orange-600">
          <MousePointer2 className="size-4" />
        </div>
        <h2 className="text-[15px] font-semibold text-slate-800">属性面板</h2>
      </div>
      <div className="overflow-y-auto pr-1 custom-scrollbar">
        {selection.kind === "multiple" ? (
          <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-3 text-sm leading-relaxed text-slate-600">
            已选中 {selection.objectIds.length} 个场景对象、{selection.characterIds.length}{" "}
            个角色。空白处拖拽可框选；按住 Ctrl（Mac：⌘）点击可追加或取消选中；多选时在任一选中项上按住左键拖拽可整体移动（亦可使用方向键微调）。选中单个对象后可编辑详细属性。
          </div>
        ) : selectedObject ? (
        <div className="space-y-4 text-sm">
          <div className="space-y-1.5">
            <FieldLabel>名称</FieldLabel>
            <input
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-all focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
              onChange={(event) => updateSelectedObject({ name: event.target.value })}
              value={selectedObject.name}
            />
          </div>
          <div className="space-y-1.5">
            <FieldLabel>场景描述</FieldLabel>
              <textarea
                className="min-h-[80px] w-full resize-none rounded-md border border-slate-200 bg-white px-3 py-2 text-sm leading-relaxed text-slate-900 outline-none transition-all focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
              onChange={(event) => updateSelectedObject({ description: event.target.value })}
              value={selectedObject.description}
            />
          </div>
          {is3DSceneObject(selectedObject) ? (
            <div className="space-y-3 rounded-md border border-indigo-100 bg-indigo-50/70 p-3">
              <div>
                <div className="text-xs font-semibold text-indigo-700">3D 基础体</div>
                <p className="mt-1 text-[11px] leading-relaxed text-indigo-700/80">
                  使用右侧数值调整位置、旋转和缩放；视口内可点击选中并用鼠标轨道查看。
                </p>
              </div>
              <div className="space-y-1.5">
                <FieldLabel>位置</FieldLabel>
                <Vector3Fields
                  labels={["X", "Y", "Z"]}
                  onChange={(axis, value) => updateSelectedObject3DTransform("position", axis, value)}
                  value={selectedObject.transform3D?.position ?? { x: 0, y: 0, z: 0 }}
                />
              </div>
              <div className="space-y-1.5">
                <FieldLabel>旋转（度）</FieldLabel>
                <Vector3Fields
                  labels={["X", "Y", "Z"]}
                  onChange={(axis, value) => updateSelectedObject3DTransform("rotation", axis, value)}
                  value={selectedObject.transform3D?.rotation ?? { x: 0, y: 0, z: 0 }}
                />
              </div>
              <div className="space-y-1.5">
                <FieldLabel>缩放</FieldLabel>
                <Vector3Fields
                  labels={["X", "Y", "Z"]}
                  onChange={(axis, value) => updateSelectedObject3DTransform("scale", axis, value)}
                  value={selectedObject.transform3D?.scale ?? { x: 1, y: 1, z: 1 }}
                />
              </div>
            </div>
          ) : null}
          {!is3DSceneObject(selectedObject) && selectedObject.kind === "line" ? (
            <div className="space-y-2 rounded-md border border-slate-100 bg-slate-50/90 p-3">
              <div className="text-xs font-semibold text-slate-600">线段端点（局部坐标）</div>
              <div className="grid grid-cols-2 gap-2">
                {(
                  ["x1", "y1", "x2", "y2"] as const
                ).map((key) => (
                  <div className="space-y-1" key={key}>
                    <FieldLabel>{key.toUpperCase()}</FieldLabel>
                    <input
                      className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
                      type="number"
                      value={
                        (selectedObject.lineEndpoints ??
                          defaultLineEndpoints(selectedObject.size.width, selectedObject.size.height))[key]
                      }
                      onChange={(event) => {
                        const base =
                          selectedObject.lineEndpoints ??
                          defaultLineEndpoints(selectedObject.size.width, selectedObject.size.height);
                        const next = { ...base, [key]: getNumber(event) };
                        updateSelectedObject({ lineEndpoints: next });
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {!is3DSceneObject(selectedObject) && selectedObject.kind === "polygon" ? (
            <PolygonPointsField
              key={`${selectedObject.id}:${JSON.stringify(selectedObject.polygonPoints ?? [])}`}
              height={selectedObject.size.height}
              onCommit={(next) => updateSelectedObject({ polygonPoints: next })}
              points={selectedObject.polygonPoints}
              width={selectedObject.size.width}
            />
          ) : null}
          {!is3DSceneObject(selectedObject) && selectedObject.kind === "image-placeholder" ? (
            <div className="space-y-1.5">
              <FieldLabel>占位标签</FieldLabel>
              <input
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
                value={selectedObject.imageLabel ?? "Image"}
                onChange={(event) => updateSelectedObject({ imageLabel: event.target.value })}
              />
            </div>
          ) : null}
          {!is3DSceneObject(selectedObject) && selectedObject.kind === "preset" && selectedObject.presetKey ? (
            <div className="space-y-1.5">
              <FieldLabel>预设 ID</FieldLabel>
              <input
                readOnly
                className="w-full cursor-not-allowed rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600"
                value={selectedObject.presetKey}
              />
            </div>
          ) : null}
          {!is3DSceneObject(selectedObject) ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <FieldLabel>X</FieldLabel>
              <input
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-all focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
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
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-all focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
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
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-all focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
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
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-all focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
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
            <div className="space-y-1.5">
              <FieldLabel>旋转</FieldLabel>
              <input
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-all focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
                onChange={(event) => updateSelectedObject({ rotation: getNumber(event) })}
                type="number"
                value={selectedObject.rotation}
              />
            </div>
            <div className="space-y-1.5">
              <FieldLabel>层级</FieldLabel>
              <input
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-all focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
                onChange={(event) => updateSelectedObject({ layer: getNumber(event) })}
                type="number"
                value={selectedObject.layer}
              />
            </div>
          </div>
          ) : null}
          <div className="grid grid-cols-[1fr_auto] items-end gap-3">
            <div className="space-y-1.5">
              <FieldLabel>颜色</FieldLabel>
              <div className="relative overflow-hidden rounded-md border border-slate-200 transition-all focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-400">
                <input
                  className="h-10 w-full cursor-pointer bg-transparent"
                  onChange={(event) => updateSelectedObject({ fill: event.target.value })}
                  type="color"
                  value={selectedObject.fill}
                />
              </div>
            </div>
            <label className="flex h-10 cursor-pointer items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-4 text-xs font-medium text-slate-700 transition-all hover:bg-white">
              <input
                checked={selectedObject.includeInPrompt}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                onChange={(event) =>
                  updateSelectedObject({ includeInPrompt: event.target.checked })
                }
                type="checkbox"
              />
              参与 Prompt
            </label>
          </div>
          <div className="grid grid-cols-[auto_1fr] items-center gap-3 rounded-md border border-slate-200 bg-slate-50 p-3.5">
            <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-700">
              <input
                checked={selectedObject.weight.enabled}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
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
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 outline-none transition-all focus:border-blue-400 focus:ring-1 focus:ring-blue-400 disabled:opacity-50"
              disabled={!selectedObject.weight.enabled}
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
        <div className="space-y-4 text-sm">
          {selectedBodyPart ? (
            <div className="flex items-center gap-2 rounded-md border border-blue-100 bg-blue-50 p-3 text-xs font-medium text-blue-700">
              <div className="h-1.5 w-1.5 rounded-full bg-blue-500" />
              当前部位：{selectedBodyPart.label}
            </div>
          ) : null}
          <div className="space-y-1.5">
            <FieldLabel>人物名称</FieldLabel>
            <input
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-all focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
              onChange={(event) => updateSelectedCharacter({ name: event.target.value })}
              value={selectedCharacter.name}
            />
          </div>
          <div className="space-y-1.5">
            <FieldLabel>人物描述</FieldLabel>
              <textarea
                className="min-h-[80px] w-full resize-none rounded-md border border-slate-200 bg-white px-3 py-2 text-sm leading-relaxed text-slate-900 outline-none transition-all focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
              onChange={(event) => updateSelectedCharacter({ description: event.target.value })}
              value={selectedCharacter.description}
            />
          </div>
          {project.scene.mode === "3d" ? (
            <div className="space-y-3 rounded-md border border-indigo-100 bg-indigo-50/70 p-3">
              <div>
                <div className="text-xs font-semibold text-indigo-700">3D 人体</div>
                <p className="mt-1 text-[11px] leading-relaxed text-indigo-700/80">
                  调整低模人体在 3D 舞台中的根位置、朝向和整体比例。拖拽关节球可在正面调整肢体（默认）；按住 Shift 拖拽同一关节可在深度方向（局部 Z）微调，与 2D 画布的骨骼拖拽彼此独立。
                </p>
              </div>
              <div className="space-y-1.5">
                <FieldLabel>位置</FieldLabel>
                <Vector3Fields
                  labels={["X", "Y", "Z"]}
                  onChange={(axis, value) => updateSelectedCharacter3DTransform("position", axis, value)}
                  value={selectedCharacter.transform3D?.position ?? { x: 0, y: 0, z: 0 }}
                />
              </div>
              <div className="space-y-1.5">
                <FieldLabel>旋转（度）</FieldLabel>
                <Vector3Fields
                  labels={["X", "Y", "Z"]}
                  onChange={(axis, value) => updateSelectedCharacter3DTransform("rotation", axis, value)}
                  value={selectedCharacter.transform3D?.rotation ?? { x: 0, y: 0, z: 0 }}
                />
              </div>
              <div className="space-y-1.5">
                <FieldLabel>缩放</FieldLabel>
                <Vector3Fields
                  labels={["X", "Y", "Z"]}
                  onChange={(axis, value) => updateSelectedCharacter3DTransform("scale", axis, value)}
                  value={selectedCharacter.transform3D?.scale ?? { x: 1, y: 1, z: 1 }}
                />
              </div>
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <FieldLabel>X</FieldLabel>
              <input
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-all focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
                onChange={(event) =>
                  updateSelectedCharacter({
                    position: { ...selectedCharacter.position, x: getNumber(event) },
                  })
                }
                type="number"
                value={selectedCharacter.position.x}
              />
            </div>
            <div className="space-y-1.5">
              <FieldLabel>Y</FieldLabel>
              <input
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-all focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
                onChange={(event) =>
                  updateSelectedCharacter({
                    position: { ...selectedCharacter.position, y: getNumber(event) },
                  })
                }
                type="number"
                value={selectedCharacter.position.y}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <FieldLabel>旋转（度）</FieldLabel>
            <input
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-all focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
              onChange={(event) => updateSelectedCharacter({ rotation: getNumber(event) })}
              type="number"
              value={selectedCharacter.rotation ?? 0}
            />
          </div>
          <label className="flex h-10 cursor-pointer items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-4 text-xs font-medium text-slate-700 transition-all hover:bg-white">
            <input
              checked={selectedCharacter.includeInPrompt}
              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              onChange={(event) =>
                updateSelectedCharacter({ includeInPrompt: event.target.checked })
              }
              type="checkbox"
            />
            人物参与 Prompt
          </label>
        </div>
      ) : (
        <div className="space-y-4 text-sm">
          <div className="space-y-1.5">
            <FieldLabel>场景名称</FieldLabel>
            <input
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-all focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
              onChange={(event) => updateScene({ name: event.target.value })}
              value={project.scene.name}
            />
          </div>
          <div className="space-y-1.5">
            <FieldLabel>场景描述</FieldLabel>
              <textarea
                className="min-h-[80px] w-full resize-none rounded-md border border-slate-200 bg-white px-3 py-2 text-sm leading-relaxed text-slate-900 outline-none transition-all focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
              onChange={(event) => updateScene({ description: event.target.value })}
              value={project.scene.description}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <FieldLabel>画布比例</FieldLabel>
              <select
                className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-all focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
                onChange={(event) => handleAspectRatioChange(event.target.value as CanvasAspectRatio)}
                value={project.scene.canvas.aspectRatio}
              >
                <option value="1:1">1:1</option>
                <option value="4:3">4:3</option>
                <option value="16:9">16:9</option>
                <option value="9:16">9:16</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <FieldLabel>背景色</FieldLabel>
              <div className="relative overflow-hidden rounded-md border border-slate-200 transition-all focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-400">
                <input
                  className="h-10 w-full cursor-pointer bg-transparent"
                  onChange={(event) =>
                    updateScene({
                      canvas: { ...project.scene.canvas, background: event.target.value },
                    })
                  }
                  type="color"
                  value={project.scene.canvas.background}
                />
              </div>
            </div>
          </div>
          <div className="space-y-1.5">
            <FieldLabel>Prompt 格式</FieldLabel>
            <select
              className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-all focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
              onChange={(event) =>
                updateProjectSettings({ modelFormat: event.target.value as PromptModelFormat })
              }
              value={project.settings.modelFormat}
            >
              <option value="generic">通用 Prompt</option>
              <option value="stable-diffusion">Stable Diffusion</option>
              <option value="midjourney">Midjourney</option>
            </select>
          </div>
          <label className="flex h-10 cursor-pointer items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-4 text-xs font-medium text-slate-700 transition-all hover:bg-white">
            <input
              checked={project.settings.includeSpatialHints}
              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              onChange={(event) =>
                updateProjectSettings({ includeSpatialHints: event.target.checked })
              }
              type="checkbox"
            />
            启用空间提示
          </label>
          {project.scene.mode === "3d" ? (
            <div className="space-y-3 rounded-md border border-indigo-100 bg-indigo-50/70 p-3">
              <div>
                <div className="text-xs font-semibold text-indigo-700">3D 场景配置</div>
                <p className="mt-1 text-[11px] leading-relaxed text-indigo-700/80">
                  这些设置会随项目保存；拖动 3D 视口调整相机后，也会同步到这里。
                </p>
              </div>
              <div className="space-y-1.5">
                <FieldLabel>相机位置</FieldLabel>
                <Vector3Fields
                  labels={["X", "Y", "Z"]}
                  onChange={(axis, value) => updateScene3DCameraVector("position", axis, value)}
                  value={project.scene.three.camera.position}
                />
              </div>
              <div className="space-y-1.5">
                <FieldLabel>相机目标</FieldLabel>
                <Vector3Fields
                  labels={["X", "Y", "Z"]}
                  onChange={(axis, value) => updateScene3DCameraVector("target", axis, value)}
                  value={project.scene.three.camera.target}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <FieldLabel>视角 FOV</FieldLabel>
                  <input
                    className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
                    max={100}
                    min={15}
                    onChange={(event) =>
                      updateScene3DConfig({
                        camera: {
                          ...project.scene.three.camera,
                          fov: getClampedNumber(event, 15, 100),
                        },
                      })
                    }
                    type="number"
                    value={project.scene.three.camera.fov}
                  />
                </div>
                <div className="space-y-1.5">
                  <FieldLabel>环境光</FieldLabel>
                  <input
                    className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
                    max={2}
                    min={0}
                    onChange={(event) =>
                      updateScene3DConfig({
                        lighting: {
                          ...project.scene.three.lighting,
                          ambientIntensity: getClampedNumber(event, 0, 2),
                        },
                      })
                    }
                    step={0.05}
                    type="number"
                    value={project.scene.three.lighting.ambientIntensity}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <FieldLabel>方向光位置</FieldLabel>
                <Vector3Fields
                  labels={["X", "Y", "Z"]}
                  onChange={updateScene3DLightingPosition}
                  value={project.scene.three.lighting.directionalPosition}
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <FieldLabel>方向光</FieldLabel>
                  <input
                    className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
                    max={3}
                    min={0}
                    onChange={(event) =>
                      updateScene3DConfig({
                        lighting: {
                          ...project.scene.three.lighting,
                          directionalIntensity: getClampedNumber(event, 0, 3),
                        },
                      })
                    }
                    step={0.05}
                    type="number"
                    value={project.scene.three.lighting.directionalIntensity}
                  />
                </div>
                <div className="space-y-1.5">
                  <FieldLabel>网格尺寸</FieldLabel>
                  <input
                    className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
                    min={2}
                    onChange={(event) =>
                      updateScene3DConfig({
                        grid: {
                          ...project.scene.three.grid,
                          size: getClampedNumber(event, 2, 100),
                        },
                      })
                    }
                    max={100}
                    type="number"
                    value={project.scene.three.grid.size}
                  />
                </div>
                <div className="space-y-1.5">
                  <FieldLabel>网格分段</FieldLabel>
                  <input
                    className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
                    min={2}
                    onChange={(event) =>
                      updateScene3DConfig({
                        grid: {
                          ...project.scene.three.grid,
                          divisions: Math.round(getClampedNumber(event, 2, 100)),
                        },
                      })
                    }
                    max={100}
                    type="number"
                    value={project.scene.three.grid.divisions}
                  />
                </div>
              </div>
            </div>
          ) : null}
          <div className="space-y-1.5">
            <FieldLabel>负面提示词</FieldLabel>
              <textarea
                className="min-h-[80px] w-full resize-none rounded-md border border-slate-200 bg-white px-3 py-2 text-sm leading-relaxed text-slate-900 outline-none transition-all focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
              onChange={(event) => updateProjectSettings({ negativePrompt: event.target.value })}
              value={project.settings.negativePrompt}
            />
          </div>
        </div>
      )}
      </div>
    </section>
  );
}
