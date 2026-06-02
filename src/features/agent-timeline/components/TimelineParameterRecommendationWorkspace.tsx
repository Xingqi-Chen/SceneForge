"use client";

import { useState } from "react";

import type {
  ParameterRecommendationTimelineResult,
  TimelineNodeResult,
} from "@/features/agent-timeline";
import {
  COMFYUI_SAMPLER_OPTIONS,
  COMFYUI_SCHEDULER_OPTIONS,
} from "@/features/editor/ai-prompt/comfyui-generation-options";

import { Button } from "@/components/ui/button";

type TimelineParameterRecommendationWorkspaceProps = {
  editable: boolean;
  emptyState: string;
  node: TimelineNodeResult;
  onSave: (result: ParameterRecommendationTimelineResult) => void;
};

type Draft = {
  cfg: string;
  denoise: string;
  height: string;
  negativeAdditions: string;
  positivePrompt: string;
  samplerName: string;
  scheduler: string;
  seed: string;
  seedMode: "fixed" | "random";
  steps: string;
  width: string;
};

function isParameterRecommendationResult(value: unknown): value is ParameterRecommendationTimelineResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "requestPreview" in value &&
    "seedPolicy" in value &&
    "samplerName" in value
  );
}

function makeDraft(result: ParameterRecommendationTimelineResult): Draft {
  return {
    cfg: String(result.cfg),
    denoise: String(result.denoise),
    height: String(result.height),
    negativeAdditions: result.negativeAdditions.join(", "),
    positivePrompt: result.finalPositivePrompt ?? result.requestPreview.positivePrompt ?? "",
    samplerName: result.samplerName,
    scheduler: result.scheduler,
    seed: result.seedPolicy.mode === "fixed" ? String(result.seedPolicy.seed) : "",
    seedMode: result.seedPolicy.mode,
    steps: String(result.steps),
    width: String(result.width),
  };
}

function clampInteger(value: string, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function clampDimension(value: string, fallback: number) {
  return Math.round(clampInteger(value, fallback, 16, 16384) / 8) * 8;
}

function clampNumber(value: string, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Number(parsed.toFixed(2))));
}

function splitNegativeAdditions(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function mergePromptTags(basePrompt: string, additions: string[]) {
  const tags: string[] = [];
  const seen = new Set<string>();

  for (const tag of [...splitNegativeAdditions(basePrompt), ...additions]) {
    const key = tag.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    tags.push(tag);
  }

  return tags.join(", ");
}

function getOptionLabel(value: string, knownOptions: readonly { label: string; value: string }[]) {
  return knownOptions.find((option) => option.value === value)?.label ?? value;
}

function uniqueOptions(values: string[], fallback: string) {
  return Array.from(new Set([...values.filter(Boolean), fallback].filter(Boolean)));
}

function pickAllowedValue(value: string, options: string[], fallback: string) {
  if (options.includes(value)) {
    return value;
  }

  if (options.includes(fallback)) {
    return fallback;
  }

  return options[0] ?? fallback;
}

export function TimelineParameterRecommendationWorkspace({
  editable,
  emptyState,
  node,
  onSave,
}: TimelineParameterRecommendationWorkspaceProps) {
  const result = isParameterRecommendationResult(node.result) ? node.result : null;
  const [draft, setDraft] = useState(() => (result ? makeDraft(result) : null));

  if (!result || !draft) {
    return (
      <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-500">
        {node.error?.message ?? emptyState}
      </div>
    );
  }

  const samplerOptions = uniqueOptions(
    Array.isArray(result.availableSamplers) ? result.availableSamplers : [],
    result.samplerName,
  );
  const schedulerOptions = uniqueOptions(
    Array.isArray(result.availableSchedulers) ? result.availableSchedulers : [],
    result.scheduler,
  );

  function updateDraft(patch: Partial<Draft>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }

  function handleSave() {
    if (!result || !draft || !editable) {
      return;
    }

    const width = clampDimension(draft.width, result.width);
    const height = clampDimension(draft.height, result.height);
    const steps = clampInteger(draft.steps, result.steps, 1, 150);
    const cfg = clampNumber(draft.cfg, result.cfg, 0, 30);
    const denoise = clampNumber(draft.denoise, result.denoise, 0, 1);
    const seed = clampInteger(draft.seed, 0, 0, Number.MAX_SAFE_INTEGER);
    const seedPolicy = draft.seedMode === "fixed" ? { mode: "fixed" as const, seed } : { mode: "random" as const };
    const negativeAdditions = splitNegativeAdditions(draft.negativeAdditions);
    const negativePrompt = mergePromptTags(
      result.requestPreview.negativePrompt || result.negativePrompt,
      negativeAdditions,
    );
    const positivePrompt = draft.positivePrompt.trim() || result.finalPositivePrompt || result.requestPreview.positivePrompt;
    const samplerName = pickAllowedValue(draft.samplerName, samplerOptions, result.samplerName);
    const scheduler = pickAllowedValue(draft.scheduler, schedulerOptions, result.scheduler);

    onSave({
      ...result,
      cfg,
      denoise,
      finalPositivePrompt: positivePrompt,
      height,
      negativeAdditions,
      negativePrompt,
      samplerName,
      scheduler,
      seedPolicy,
      steps,
      width,
      requestPreview: {
        ...result.requestPreview,
        cfg,
        denoise,
        height,
        negativePrompt,
        positivePrompt,
        samplerName,
        scheduler,
        seed: seedPolicy.mode === "fixed" ? seedPolicy.seed : undefined,
        steps,
        width,
      },
      reason: "Manual render parameter selection.",
    });
  }

  return (
    <div className="flex flex-col gap-4" data-testid="timeline-parameter-workspace">
      <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
        Positive prompt
        <textarea
          className="min-h-28 rounded-md border border-slate-200 px-2 py-2 text-xs leading-relaxed outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          disabled={!editable}
          onChange={(event) => updateDraft({ positivePrompt: event.target.value })}
          value={draft.positivePrompt}
        />
      </label>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
          Width
          <input
            className="h-9 rounded-md border border-slate-200 px-2 text-xs outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            disabled={!editable}
            max={16384}
            min={16}
            onChange={(event) => updateDraft({ width: event.target.value })}
            step={8}
            type="number"
            value={draft.width}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
          Height
          <input
            className="h-9 rounded-md border border-slate-200 px-2 text-xs outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            disabled={!editable}
            max={16384}
            min={16}
            onChange={(event) => updateDraft({ height: event.target.value })}
            step={8}
            type="number"
            value={draft.height}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
          Steps
          <input
            className="h-9 rounded-md border border-slate-200 px-2 text-xs outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            disabled={!editable}
            max={150}
            min={1}
            onChange={(event) => updateDraft({ steps: event.target.value })}
            type="number"
            value={draft.steps}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
          CFG
          <input
            className="h-9 rounded-md border border-slate-200 px-2 text-xs outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            disabled={!editable}
            max={30}
            min={0}
            onChange={(event) => updateDraft({ cfg: event.target.value })}
            step={0.1}
            type="number"
            value={draft.cfg}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
          Denoise
          <input
            className="h-9 rounded-md border border-slate-200 px-2 text-xs outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            disabled={!editable}
            max={1}
            min={0}
            onChange={(event) => updateDraft({ denoise: event.target.value })}
            step={0.05}
            type="number"
            value={draft.denoise}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
          Seed policy
          <select
            className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            disabled={!editable}
            onChange={(event) => updateDraft({ seedMode: event.target.value as Draft["seedMode"] })}
            value={draft.seedMode}
          >
            <option value="random">Random</option>
            <option value="fixed">Fixed</option>
          </select>
        </label>
        {draft.seedMode === "fixed" ? (
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
            Seed
            <input
              className="h-9 rounded-md border border-slate-200 px-2 text-xs outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              disabled={!editable}
              min={0}
              onChange={(event) => updateDraft({ seed: event.target.value })}
              type="number"
              value={draft.seed}
            />
          </label>
        ) : null}
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
          Sampler
          <select
            className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            disabled={!editable}
            onChange={(event) => updateDraft({ samplerName: event.target.value })}
            value={draft.samplerName}
          >
            {samplerOptions.map((option) => (
              <option key={option} value={option}>
                {getOptionLabel(option, COMFYUI_SAMPLER_OPTIONS)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
          Scheduler
          <select
            className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            disabled={!editable}
            onChange={(event) => updateDraft({ scheduler: event.target.value })}
            value={draft.scheduler}
          >
            {schedulerOptions.map((option) => (
              <option key={option} value={option}>
                {getOptionLabel(option, COMFYUI_SCHEDULER_OPTIONS)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
        Negative additions
        <textarea
          className="min-h-20 rounded-md border border-slate-200 px-2 py-2 text-xs outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          disabled={!editable}
          onChange={(event) => updateDraft({ negativeAdditions: event.target.value })}
          value={draft.negativeAdditions}
        />
      </label>

      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
        {result.reason}
      </div>

      <div className="flex justify-end">
        <Button className="h-8 px-3 text-xs shadow-none" disabled={!editable} onClick={handleSave} type="button">
          Save parameters
        </Button>
      </div>
    </div>
  );
}
