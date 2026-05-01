import { Tags } from "lucide-react";

const tags = ["电影感", "柔和光线", "头发提示词", "高质量", "负面提示词"];

export function PromptTagPickerPanel() {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Tags className="size-4 text-slate-500" />
        <h2 className="text-sm font-semibold text-slate-950">Prompt 词库</h2>
      </div>
      <div className="flex flex-wrap gap-2">
        {tags.map((tag) => (
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700" key={tag}>
            {tag}
          </span>
        ))}
      </div>
    </section>
  );
}
