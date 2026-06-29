"use client";

import { Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { SelectedCivitaiResourcesPreview } from "@/features/civitai-lora-library";
import {
  parseCivitaiAiPromptResponse,
  type CivitaiAiPromptResult,
} from "@/features/editor/ai-prompt/civitai-ai-context";
import {
  buildStylePaletteAdviceMessages,
  getStylePalettePromptPreset,
  type StylePalettePromptPreset,
} from "@/features/editor/ai-prompt/style-palette-prompts";
import { getLlmProxyErrorMessage, isLlmChatResponse } from "@/features/llm";

type LoadStatus = "idle" | "loading" | "success" | "error";

export type StylePaletteAdviceState = {
  error: string;
  result: CivitaiAiPromptResult | null;
  status: LoadStatus;
};

export const EMPTY_STYLE_PALETTE_ADVICE: StylePaletteAdviceState = {
  error: "",
  result: null,
  status: "idle",
};

export type StylePaletteAiAdvicePanelProps = {
  advice: StylePaletteAdviceState;
  artistPrompts?: string[];
  className?: string;
  disabled?: boolean;
  emptyMessage?: string;
  onAdviceChange: (advice: StylePaletteAdviceState) => void;
  preset?: StylePalettePromptPreset;
  resources: SelectedCivitaiResourcesPreview;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function AdviceValue({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === "") {
    return <span className="text-slate-400">none</span>;
  }

  if (Array.isArray(value)) {
    return (
      <div className="space-y-1">
        {value.map((item, index) => (
          <div className="rounded-md bg-white/70 px-2 py-1" key={index}>
            <AdviceValue value={item} />
          </div>
        ))}
      </div>
    );
  }

  if (isRecord(value)) {
    return (
      <div className="grid gap-2">
        {Object.entries(value)
          .filter(([, item]) => item !== null && item !== undefined && item !== "")
          .map(([key, item]) => (
            <div className="rounded-md bg-white/70 px-2 py-1" key={key}>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{key}</p>
              <div className="mt-0.5 text-xs leading-relaxed text-slate-700">
                <AdviceValue value={item} />
              </div>
            </div>
          ))}
      </div>
    );
  }

  return <span>{typeof value === "number" ? Number(value.toFixed(3)).toString() : String(value)}</span>;
}

export function StylePaletteAiAdvicePanel({
  advice,
  artistPrompts = [],
  className = "",
  disabled = false,
  emptyMessage = "Advice uses only the selected artist strings and Civitai resources, not the canvas prompt.",
  onAdviceChange,
  preset = getStylePalettePromptPreset("portrait"),
  resources,
}: StylePaletteAiAdvicePanelProps) {
  async function generateAdvice() {
    if (!resources.checkpoint) {
      onAdviceChange({
        error: "Please select a Civitai checkpoint before generating style advice.",
        result: null,
        status: "error",
      });
      return;
    }

    onAdviceChange({ error: "", result: null, status: "loading" });

    try {
      const response = await fetch("/api/llm/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          purpose: "stable-diffusion-prompt-generation",
          messages: buildStylePaletteAdviceMessages({
            artistPrompts,
            preset,
            resources,
          }),
          temperature: 0.25,
          maxTokens: 900,
        }),
      });
      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(getLlmProxyErrorMessage(payload));
      }

      if (!isLlmChatResponse(payload)) {
        throw new Error("AI style advice returned an invalid response.");
      }

      onAdviceChange({
        error: "",
        result: parseCivitaiAiPromptResponse(payload.content),
        status: "success",
      });
    } catch (error) {
      onAdviceChange({
        error: error instanceof Error ? error.message : "AI style advice failed.",
        result: null,
        status: "error",
      });
    }
  }

  return (
    <div className={`self-start rounded-md border border-teal-100 bg-white p-3 ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-bold uppercase tracking-wider text-teal-700">AI Style Advice</p>
        <Button
          className="h-8 rounded-md bg-teal-600 px-3 text-xs text-white hover:bg-teal-700 disabled:opacity-60"
          disabled={advice.status === "loading" || disabled}
          onClick={() => void generateAdvice()}
          size="sm"
          type="button"
        >
          {advice.status === "loading" ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
          Generate
        </Button>
      </div>
      {advice.status === "error" && advice.error ? (
        <p className="mt-3 rounded-md border border-rose-100 bg-rose-50 px-3 py-2 text-xs leading-relaxed text-rose-700">
          {advice.error}
        </p>
      ) : null}
      {advice.result ? (
        <div className="mt-3 max-h-[min(46vh,360px)] space-y-3 overflow-y-auto rounded-md border border-teal-100 bg-teal-50/60 p-3 pr-2 text-xs">
          {advice.result.parseWarning ? (
            <p className="rounded-md bg-amber-50 px-3 py-2 leading-relaxed text-amber-800">{advice.result.parseWarning}</p>
          ) : null}
          {advice.result.parameterSuggestionReason ? (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-teal-700">Reason</p>
              <p className="mt-1 leading-relaxed text-slate-700">{advice.result.parameterSuggestionReason}</p>
            </div>
          ) : null}
          {advice.result.overallEffect ? (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-teal-700">Overall Effect</p>
              <p className="mt-1 leading-relaxed text-slate-700">{advice.result.overallEffect}</p>
            </div>
          ) : null}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-teal-700">Parameters</p>
            <div className="mt-1">
              <AdviceValue value={advice.result.parameterSuggestions} />
            </div>
          </div>
        </div>
      ) : advice.status === "loading" ? (
        <p className="mt-3 rounded-md bg-teal-50 px-3 py-2 text-xs leading-relaxed text-teal-700">
          <Loader2 className="mr-1.5 inline size-3.5 animate-spin" />
          Generating style-only parameter advice...
        </p>
      ) : (
        <p className="mt-3 text-xs leading-relaxed text-slate-500">{emptyMessage}</p>
      )}
    </div>
  );
}
