"use client";

import { Layers } from "lucide-react";

import { useEditorStore, type AddSceneObjectInput } from "@/features/editor/store/editor-store";

type AssetDefinition =
  | (AddSceneObjectInput & { id: string; label: string; type: "object" })
  | { id: "character"; label: string; type: "character" };

const assets: AssetDefinition[] = [
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
  { id: "character", label: "人物骨架", type: "character" },
];

export function AssetLibraryPanel() {
  const addObject = useEditorStore((state) => state.addObject);
  const addCharacter = useEditorStore((state) => state.addCharacter);

  function handleAssetClick(asset: AssetDefinition) {
    if (asset.type === "character") {
      addCharacter();
      return;
    }

    addObject(asset);
  }

  return (
    <section className="flex flex-col">
      <div className="mb-4 flex items-center gap-2.5 border-b border-slate-100 pb-3 shrink-0">
        <div className="rounded-lg bg-blue-50 p-1.5 text-blue-600">
          <Layers className="size-4" />
        </div>
        <h2 className="text-[15px] font-semibold text-slate-800">素材库</h2>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {assets.map((asset) => (
          <button
            className="group relative flex flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border border-slate-200/80 bg-slate-50/50 p-4 text-sm font-medium text-slate-700 shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-200 hover:bg-blue-50/50 hover:text-blue-700 hover:shadow"
            key={asset.id}
            onClick={() => handleAssetClick(asset)}
            type="button"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-white/40 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
            <span className="relative z-10">{asset.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
