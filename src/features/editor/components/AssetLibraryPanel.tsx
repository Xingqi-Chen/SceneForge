"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, Layers } from "lucide-react";

import {
  PRESET_SCENE_CATEGORY_ORDER,
  PRESET_SCENE_OBJECTS,
  type PresetSceneCategory,
} from "@/features/editor/preset-scene-objects";
import { cn } from "@/shared/utils/cn";
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

const threeDAssets: ShapeAssetDefinition[] = [
  {
    id: "cube",
    label: "立方体",
    type: "object",
    kind: "cube",
    name: "立方体",
    fill: "#60a5fa",
  },
  {
    id: "sphere",
    label: "球体",
    type: "object",
    kind: "sphere",
    name: "球体",
    fill: "#fbbf24",
  },
  {
    id: "cylinder",
    label: "圆柱",
    type: "object",
    kind: "cylinder",
    name: "圆柱",
    fill: "#34d399",
  },
  {
    id: "plane",
    label: "平面",
    type: "object",
    kind: "plane",
    name: "平面",
    fill: "#94a3b8",
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

function LibrarySection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mb-3 flex w-full min-h-0 items-center justify-between gap-2 rounded-md text-left outline-none ring-offset-2 transition-colors hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-400"
        aria-expanded={open}
      >
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</span>
        <ChevronDown
          className={cn("size-4 shrink-0 text-slate-400 transition-transform duration-200", open && "rotate-180")}
          aria-hidden
        />
      </button>
      {open ? <div className="min-h-0">{children}</div> : null}
    </div>
  );
}

function PresetCategorySection({
  label,
  assets,
  onAssetClick,
}: {
  label: string;
  assets: PresetLibraryAsset[];
  onAssetClick: (asset: AssetDefinition) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mb-1.5 flex w-full items-center justify-between gap-2 rounded-md py-0.5 pl-0.5 text-left outline-none ring-offset-2 transition-colors hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-400"
        aria-expanded={open}
      >
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</span>
        <ChevronDown
          className={cn("size-3.5 shrink-0 text-slate-400 transition-transform duration-200", open && "rotate-180")}
          aria-hidden
        />
      </button>
      {open ? (
        <div className="grid grid-cols-2 gap-2">
          {assets.map((asset) => (
            <button
              className="group relative flex min-h-[2.75rem] flex-col items-center justify-center gap-0.5 overflow-hidden rounded-md border border-dashed border-slate-300 bg-white px-2 py-2 text-xs font-medium text-slate-700 transition-all hover:border-amber-400 hover:bg-amber-50 hover:text-amber-900"
              key={asset.id}
              onClick={() => onAssetClick(asset)}
              title={asset.input.description}
              type="button"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-white/40 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
              <span className="relative z-10 text-center leading-tight">{asset.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function AssetLibraryPanel() {
  const addObject = useEditorStore((state) => state.addObject);
  const addCharacter = useEditorStore((state) => state.addCharacter);
  const setSceneMode = useEditorStore((state) => state.setSceneMode);
  const sceneMode = useEditorStore((state) => state.project.scene.mode);
  const is2d = sceneMode === "2d";
  const is3d = sceneMode === "3d";

  function handleAssetClick(asset: AssetDefinition) {
    if (asset.type === "character") {
      addCharacter();
      return;
    }

    if ("input" in asset) {
      addObject(asset.input);
      return;
    }

    if (
      asset.kind === "cube" ||
      asset.kind === "sphere" ||
      asset.kind === "cylinder" ||
      asset.kind === "plane"
    ) {
      setSceneMode("3d");
    }

    addObject(asset);
  }

  return (
    <section className="flex flex-col">
      <div className="mb-4 flex items-center gap-2.5 border-b border-slate-100 pb-3 shrink-0">
        <div className="rounded-md bg-blue-50 p-1.5 text-blue-600">
          <Layers className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold text-slate-800">元素库</h2>
          <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
            {is2d ? "当前为 2D 画布：仅显示平面与预设场景。" : "当前为 3D 画布：仅显示 3D 基础体。"}
          </p>
        </div>
      </div>

      {is2d ? (
        <>
          <LibrarySection title="基础形状">
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
          </LibrarySection>

          <div className="my-4 h-px w-full shrink-0 bg-slate-100" />
        </>
      ) : null}

      {is3d ? (
        <LibrarySection title="3D 基础体">
          <p className="mb-2 text-[10px] leading-snug text-slate-400">
            用低模人体与基础几何体搭建简化 3D 舞台；位置、旋转和缩放可在右侧属性面板调整。
          </p>
          <div className="grid grid-cols-2 gap-3">
            <button
              className="group relative flex flex-col items-center justify-center gap-2 overflow-hidden rounded-md border border-slate-200 bg-white p-4 text-sm font-medium text-slate-700 transition-all hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
              onClick={() => handleAssetClick({ id: "character", label: "3D 人体", type: "character" })}
              type="button"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-white/40 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
              <span className="relative z-10">3D 人体</span>
            </button>
            {threeDAssets.map((asset) => (
              <button
                className="group relative flex flex-col items-center justify-center gap-2 overflow-hidden rounded-md border border-slate-200 bg-white p-4 text-sm font-medium text-slate-700 transition-all hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
                key={asset.id}
                onClick={() => handleAssetClick(asset)}
                type="button"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-white/40 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
                <span className="relative z-10">{asset.label}</span>
              </button>
            ))}
          </div>
        </LibrarySection>
      ) : null}

      {is2d ? (
        <LibrarySection title="预设场景">
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
                <PresetCategorySection
                  key={cat.id}
                  label={cat.label}
                  assets={inCategory}
                  onAssetClick={handleAssetClick}
                />
              );
            })}
          </div>
        </LibrarySection>
      ) : null}
    </section>
  );
}
