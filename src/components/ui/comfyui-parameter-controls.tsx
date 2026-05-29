"use client";

import { ChevronDown } from "lucide-react";

export const COMFYUI_TEXT_FIELD_CLASS =
  "h-9 min-w-0 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-700 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100";
export const COMFYUI_SELECT_FIELD_CLASS = `${COMFYUI_TEXT_FIELD_CLASS} w-full appearance-none pr-9`;

export function NumberInput({
  label,
  min,
  max,
  onChange,
  step = 1,
  value,
}: {
  label: string;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
  step?: number;
  value: number;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</span>
      <input
        className={COMFYUI_TEXT_FIELD_CLASS}
        max={max}
        min={min}
        onChange={(event) => {
          const parsed = Number(event.target.value);
          if (Number.isFinite(parsed)) {
            onChange(parsed);
          }
        }}
        step={step}
        type="number"
        value={value}
      />
    </label>
  );
}

export function TextInput({
  label,
  onChange,
  placeholder,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</span>
      <input
        className={COMFYUI_TEXT_FIELD_CLASS}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type="text"
        value={value}
      />
    </label>
  );
}

export function TextAreaInput({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</span>
      <textarea
        className="min-h-16 w-full resize-y rounded-md border border-slate-200 bg-white px-2 py-2 text-xs leading-relaxed text-slate-700 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </label>
  );
}

export function BooleanInput({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex min-h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700">
      <input
        checked={checked}
        className="size-3.5 rounded border-slate-300 text-sky-600"
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      {label}
    </label>
  );
}

export function SelectInput({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: readonly { label: string; value: string }[];
  value: string;
}) {
  const selectedValue = options.some((option) => option.value === value) ? value : options[0]?.value ?? "";

  return (
    <label className="grid gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</span>
      <span className="relative min-w-0">
        <select className={COMFYUI_SELECT_FIELD_CLASS} onChange={(event) => onChange(event.target.value)} value={selectedValue}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
      </span>
    </label>
  );
}
