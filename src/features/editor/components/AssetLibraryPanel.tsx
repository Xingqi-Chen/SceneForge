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
    description: "simple rectangular scene object",
    fill: "#e2e8f0",
  },
  {
    id: "circle",
    label: "圆形",
    type: "object",
    kind: "circle",
    name: "圆形",
    description: "round scene object",
    fill: "#fde68a",
  },
  {
    id: "window",
    label: "窗户",
    type: "object",
    kind: "rectangle",
    name: "窗户",
    description: "large window with soft light",
    fill: "#bfdbfe",
  },
  {
    id: "table",
    label: "桌子",
    type: "object",
    kind: "rectangle",
    name: "桌子",
    description: "wooden table in the foreground",
    fill: "#92400e",
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
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Layers className="size-4 text-slate-500" />
        <h2 className="text-sm font-semibold text-slate-950">素材库</h2>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {assets.map((asset) => (
          <button
            className="rounded-xl border border-slate-200 px-3 py-2 text-left text-sm text-slate-700 hover:border-slate-300 hover:bg-slate-50"
            key={asset.id}
            onClick={() => handleAssetClick(asset)}
            type="button"
          >
            {asset.label}
          </button>
        ))}
      </div>
    </section>
  );
}
