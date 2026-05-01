"use client";

import { Layers } from "lucide-react";

import {
  PRESET_SCENE_CATEGORY_ORDER,
  PRESET_SCENE_OBJECTS,
  type PresetSceneCategory,
} from "@/features/editor/preset-scene-objects";
import { useEditorStore, type AddSceneObjectInput } from "@/features/editor/store/editor-store";

type ShapeAssetDefinition = AddSceneObjectInput & { id: string; label: string; type: "object" };

type PresetLibraryAsset = {
  id: string;
  label: string;
  type: "object";
  category: PresetSceneCategory;
  input: AddSceneObjectInput;
};

type AssetDefinition = ShapeAssetDefinition | PresetLibraryAsset | { id: "character"; label: string; type: "character" };

const shapeAssets: ShapeAssetDefinition[] = [
  {
    id: "rectangle",
    label: "矩形",
    type: "object",
    kind: "rectangle",
    name: "矩形",
    fill: "#e2e8f0",
  },
  {
    id: "circle",
    label: "圆形",
    type: "object",
    kind: "circle",
    name: "圆形",
    fill: "#fde68a",
  },
  {
    id: "ellipse",
    label: "椭圆",
    type: "object",
    kind: "ellipse",
    name: "椭圆",
    fill: "#ddd6fe",
  },
  {
    id: "line",
    label: "线段",
    type: "object",
    kind: "line",
    name: "线段",
    fill: "#334155",
  },
  {
    id: "polygon",
    label: "多边形",
    type: "object",
    kind: "polygon",
    name: "三角形",
    fill: "#86efac",
  },
  {
    id: "image-placeholder",
    label: "图片占位",
    type: "object",
    kind: "image-placeholder",
    name: "图片占位",
    fill: "#94a3b8",
    imageLabel: "Image",
  },
];

const presetLibraryAssets: PresetLibraryAsset[] = PRESET_SCENE_OBJECTS.map((preset) => ({
  id: preset.key,
  label: preset.label,
  type: "object" as const,
  category: preset.category,
  input: {
    kind: "preset",
    name: preset.name,
    description: preset.description,
    fill: preset.fill,
    presetKey: preset.key,
  },
}));

export function AssetLibraryPanel() {
  const addObject = useEditorStore((state) => state.addObject);
  const addCharacter = useEditorStore((state) => state.addCharacter);

  function handleAssetClick(asset: AssetDefinition) {
    if (asset.type === "character") {
      addCharacter();
      return;
    }

    if ("input" in asset) {
      addObject(asset.input);
      return;
    }

    addObject(asset);
  }

  return (
    <section className="flex flex-col">
      <div className="mb-4 flex items-center gap-2.5 border-b border-slate-100 pb-3 shrink-0">
        <div className="rounded-md bg-blue-50 p-1.5 text-blue-600">
          <Layers className="size-4" />
        </div>
        <h2 className="text-[15px] font-semibold text-slate-800">元素库</h2>
      </div>

      <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">基础形状</div>
      <div className="grid grid-cols-2 gap-3">
        {shapeAssets.map((asset) => (
          <button
            className="group relative flex flex-col items-center justify-center gap-2 overflow-hidden rounded-md border border-slate-200 bg-white p-4 text-sm font-medium text-slate-700 transition-all hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
            key={asset.id}
            onClick={() => handleAssetClick(asset)}
            type="button"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-white/40 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
            <span className="relative z-10">{asset.label}</span>
          </button>
        ))}
        <button
          className="group relative flex flex-col items-center justify-center gap-2 overflow-hidden rounded-md border border-slate-200 bg-white p-4 text-sm font-medium text-slate-700 transition-all hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
          type="button"
          onClick={() => handleAssetClick({ id: "character", label: "人物骨架", type: "character" })}
        >
          <div className="absolute inset-0 bg-gradient-to-br from-white/40 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
          <span className="relative z-10">人物骨架</span>
        </button>
      </div>

      <div className="my-4 h-px w-full bg-slate-100 shrink-0" />

      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">预设场景</div>
      <p className="mb-2 text-[10px] leading-snug text-slate-400">
        按常见二次元插画布景分类；描述为英文便于生成与导出衔接。
      </p>
      <div className="flex max-h-[min(480px,52vh)] flex-col gap-3 overflow-y-auto pr-0.5">
        {PRESET_SCENE_CATEGORY_ORDER.map((cat) => {
          const inCategory = presetLibraryAssets.filter((asset) => asset.category === cat.id);
          if (inCategory.length === 0) {
            return null;
          }

          return (
            <div key={cat.id}>
              <div className="mb-1.5 pl-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                {cat.label}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {inCategory.map((asset) => (
                  <button
                    className="group relative flex min-h-[2.75rem] flex-col items-center justify-center gap-0.5 overflow-hidden rounded-md border border-dashed border-slate-300 bg-white px-2 py-2 text-xs font-medium text-slate-700 transition-all hover:border-amber-400 hover:bg-amber-50 hover:text-amber-900"
                    key={asset.id}
                    onClick={() => handleAssetClick(asset)}
                    title={asset.input.description}
                    type="button"
                  >
                    <div className="absolute inset-0 bg-gradient-to-br from-white/40 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
                    <span className="relative z-10 text-center leading-tight">{asset.label}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
