"use client";

import { AlertTriangle, CheckCircle2, Loader2, Wand2 } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  BooleanInput,
  NumberInput,
  SelectInput,
  TextAreaInput,
  TextInput,
} from "@/components/ui/comfyui-parameter-controls";
import type {
  AgentErrorResponse,
  AgentGenerationDefaults,
  AgentSingleImageDraftResponse,
} from "@/features/agent";
import { COMFYUI_LATENT_IMAGE_NODE_OPTIONS } from "@/features/comfyui";
import {
  COMFYUI_SAMPLER_OPTIONS,
  COMFYUI_SCHEDULER_OPTIONS,
} from "@/features/editor/ai-prompt/comfyui-generation-options";

type AgentLatentImageNode = NonNullable<AgentGenerationDefaults["latentImageNode"]>;

type DraftForm = {
  batchSize: number;
  cfg: number;
  checkpointName: string;
  denoise: number;
  height: number;
  latentImageNode: AgentLatentImageNode;
  negativePrompt: string;
  nsfw: boolean;
  outputPrefix: string;
  samplerName: string;
  scheduler: string;
  steps: number;
  userRequest: string;
  width: number;
};

const DEFAULT_FORM: DraftForm = {
  batchSize: 1,
  cfg: 7,
  checkpointName: "",
  denoise: 1,
  height: 1024,
  latentImageNode: "EmptyLatentImage",
  negativePrompt: "",
  nsfw: false,
  outputPrefix: "SceneForge",
  samplerName: "euler",
  scheduler: "normal",
  steps: 30,
  userRequest: "",
  width: 1024,
};

const REQUEST_TEXTAREA_CLASS =
  "mt-2 min-h-44 w-full resize-y rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100";
const MONO_TEXTAREA_CLASS =
  "mt-2 min-h-72 w-full resize-y rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100";
const SECTION_LABEL_CLASS = "text-[10px] font-semibold uppercase tracking-wider text-slate-500";
const FIELD_LABEL_CLASS = "text-sm font-medium text-slate-700";

function buildGenerationDefaults(form: DraftForm): AgentGenerationDefaults {
  return {
    ...(form.checkpointName.trim() ? { checkpointName: form.checkpointName.trim() } : {}),
    ...(form.negativePrompt.trim() ? { negativePrompt: form.negativePrompt.trim() } : {}),
    width: form.width,
    height: form.height,
    steps: form.steps,
    cfg: form.cfg,
    samplerName: form.samplerName,
    scheduler: form.scheduler,
    denoise: form.denoise,
    batchSize: form.batchSize,
    latentImageNode: form.latentImageNode,
    ...(form.outputPrefix.trim() ? { outputPrefix: form.outputPrefix.trim() } : {}),
  };
}

function errorMessageFromPayload(payload: unknown, fallback: string) {
  const response = payload as Partial<AgentErrorResponse>;
  return response.error?.message ?? fallback;
}

function roundToStep(value: number, step: number, min: number) {
  return Math.max(min, Math.round(value / step) * step);
}

export function AgentDraftWorkspace() {
  const [form, setForm] = useState<DraftForm>(DEFAULT_FORM);
  const [draft, setDraft] = useState<AgentSingleImageDraftResponse | null>(null);
  const [draftPositivePrompt, setDraftPositivePrompt] = useState("");
  const [draftNegativePrompt, setDraftNegativePrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const generationDefaults = useMemo(() => buildGenerationDefaults(form), [form]);
  const editableComfyUiRequest = useMemo(() => {
    if (!draft) {
      return null;
    }

    return {
      ...draft.comfyUiRequest,
      ...generationDefaults,
      positivePrompt: draftPositivePrompt,
      negativePrompt: draftNegativePrompt,
    };
  }, [draft, draftNegativePrompt, draftPositivePrompt, generationDefaults]);

  function updateForm<K extends keyof DraftForm>(key: K, value: DraftForm[K]) {
    setForm((current) => ({
      ...current,
      [key]: value,
    }));
  }

  async function submitDraft() {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/agent/draft", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          userRequest: form.userRequest,
          nsfw: form.nsfw,
          generationDefaults,
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(errorMessageFromPayload(payload, "Agent draft request failed."));
      }

      const nextDraft = payload as AgentSingleImageDraftResponse;
      setDraft(nextDraft);
      setDraftPositivePrompt(nextDraft.positivePrompt);
      setDraftNegativePrompt(nextDraft.negativePrompt);
      setForm((current) => ({
        ...current,
        checkpointName: nextDraft.comfyUiRequest.checkpointName ?? current.checkpointName,
        negativePrompt: nextDraft.negativePrompt,
        outputPrefix: nextDraft.comfyUiRequest.outputPrefix ?? current.outputPrefix,
        samplerName: nextDraft.comfyUiRequest.samplerName ?? current.samplerName,
        scheduler: nextDraft.comfyUiRequest.scheduler ?? current.scheduler,
        latentImageNode: nextDraft.comfyUiRequest.latentImageNode ?? current.latentImageNode,
        width: nextDraft.comfyUiRequest.width ?? current.width,
        height: nextDraft.comfyUiRequest.height ?? current.height,
        steps: nextDraft.comfyUiRequest.steps ?? current.steps,
        cfg: nextDraft.comfyUiRequest.cfg ?? current.cfg,
        denoise: nextDraft.comfyUiRequest.denoise ?? current.denoise,
        batchSize: nextDraft.comfyUiRequest.batchSize ?? current.batchSize,
      }));
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Agent draft request failed.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="sf-app-shell flex overflow-hidden bg-slate-50 font-sans text-slate-950 selection:bg-blue-100 selection:text-blue-900">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <header className="relative z-50 flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-3 sm:px-4">
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="shrink-0 text-sm font-bold tracking-tight text-slate-900">SceneForge | Agent Draft</h1>
            <span className="hidden rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600 sm:inline-flex">
              Single-image draft
            </span>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Confirmation gate
          </span>
        </header>

        <div className="relative z-0 flex min-h-0 flex-1 overflow-hidden max-lg:flex-col">
          <section className="touch-scroll-region custom-scrollbar flex w-[380px] shrink-0 flex-col overflow-y-auto border-r border-slate-200 bg-white p-4 max-lg:max-h-[50dvh] max-lg:w-full max-lg:border-b max-lg:border-r-0">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-900">Draft Input</h2>
              <Wand2 className="size-4 shrink-0 text-slate-400" />
            </div>

            <div className="space-y-5">
              <label className="block">
                <span className={SECTION_LABEL_CLASS}>Request</span>
                <textarea
                  className={REQUEST_TEXTAREA_CLASS}
                  onChange={(event) => updateForm("userRequest", event.target.value)}
                  placeholder="cinematic rain alley with a lone traveler, neon reflections, dramatic rim light"
                  value={form.userRequest}
                />
              </label>

              <BooleanInput checked={form.nsfw} label="NSFW model" onChange={(value) => updateForm("nsfw", value)} />

              <div className="border-t border-slate-100 pt-5">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Generation Defaults
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <TextInput
                    label="checkpoint"
                    onChange={(value) => updateForm("checkpointName", value)}
                    placeholder="model.safetensors"
                    value={form.checkpointName}
                  />
                  <TextInput
                    label="output prefix"
                    onChange={(value) => updateForm("outputPrefix", value)}
                    value={form.outputPrefix}
                  />
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3">
                  <NumberInput
                    label="width"
                    min={16}
                    onChange={(value) => updateForm("width", roundToStep(value, 8, 16))}
                    step={8}
                    value={form.width}
                  />
                  <NumberInput
                    label="height"
                    min={16}
                    onChange={(value) => updateForm("height", roundToStep(value, 8, 16))}
                    step={8}
                    value={form.height}
                  />
                  <NumberInput
                    label="steps"
                    min={1}
                    onChange={(value) => updateForm("steps", Math.max(1, Math.round(value)))}
                    value={form.steps}
                  />
                  <NumberInput
                    label="cfg"
                    min={0}
                    onChange={(value) => updateForm("cfg", value)}
                    step={0.5}
                    value={form.cfg}
                  />
                  <NumberInput
                    label="denoise"
                    max={1}
                    min={0}
                    onChange={(value) => updateForm("denoise", Math.min(1, Math.max(0, value)))}
                    step={0.05}
                    value={form.denoise}
                  />
                  <NumberInput
                    label="images"
                    max={16}
                    min={1}
                    onChange={(value) => updateForm("batchSize", Math.min(16, Math.max(1, Math.round(value))))}
                    value={form.batchSize}
                  />
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3">
                  <SelectInput
                    label="sampler"
                    onChange={(value) => updateForm("samplerName", value)}
                    options={COMFYUI_SAMPLER_OPTIONS}
                    value={form.samplerName}
                  />
                  <SelectInput
                    label="scheduler"
                    onChange={(value) => updateForm("scheduler", value)}
                    options={COMFYUI_SCHEDULER_OPTIONS}
                    value={form.scheduler}
                  />
                  <div className="col-span-2">
                    <SelectInput
                      label="latent"
                      onChange={(value) => updateForm("latentImageNode", value as AgentLatentImageNode)}
                      options={COMFYUI_LATENT_IMAGE_NODE_OPTIONS}
                      value={form.latentImageNode}
                    />
                  </div>
                </div>

                <div className="mt-3">
                  <TextAreaInput
                    label="negative prompt default"
                    onChange={(value) => updateForm("negativePrompt", value)}
                    value={form.negativePrompt}
                  />
                </div>
              </div>
            </div>

            <div className="mt-5 border-t border-slate-100 pt-4">
              <Button
                className="h-10 w-full shadow-none"
                disabled={isLoading || !form.userRequest.trim()}
                onClick={submitDraft}
                type="button"
              >
                {isLoading ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
                Generate draft
              </Button>
            </div>
          </section>

          <section className="custom-scrollbar min-h-0 flex-1 overflow-y-auto bg-slate-50 px-4 py-4 sm:px-6 sm:py-6">
            {error ? (
              <div className="mb-4 flex items-start gap-3 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>{error}</span>
              </div>
            ) : null}

            {draft ? (
              <div className="mx-auto max-w-5xl space-y-5">
                <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
                  <div>
                    <p className="text-xs font-medium text-slate-500">{draft.draftId}</p>
                    <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">
                      {draft.title ?? "Untitled draft"}
                    </h2>
                  </div>
                  <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">
                    <CheckCircle2 className="size-4" />
                    Confirmation required
                  </div>
                </header>

                <div className="grid grid-cols-2 gap-5 max-xl:grid-cols-1">
                  <label className="block">
                    <span className={FIELD_LABEL_CLASS}>Positive prompt</span>
                    <textarea
                      className={MONO_TEXTAREA_CLASS}
                      onChange={(event) => setDraftPositivePrompt(event.target.value)}
                      value={draftPositivePrompt}
                    />
                  </label>
                  <label className="block">
                    <span className={FIELD_LABEL_CLASS}>Negative prompt</span>
                    <textarea
                      className={MONO_TEXTAREA_CLASS}
                      onChange={(event) => setDraftNegativePrompt(event.target.value)}
                      value={draftNegativePrompt}
                    />
                  </label>
                </div>

                {draft.warnings.length > 0 ? (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
                    <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-800">
                      <AlertTriangle className="size-4" />
                      Warnings
                    </div>
                    <ul className="space-y-1 text-sm text-amber-700">
                      {draft.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <pre className="max-h-96 overflow-auto rounded-md border border-slate-200 bg-white p-4 font-mono text-xs text-slate-600">
                  {JSON.stringify(editableComfyUiRequest, null, 2)}
                </pre>
              </div>
            ) : (
              <div className="grid h-full min-h-[420px] place-items-center">
                <div className="max-w-md text-center">
                  <div className="mx-auto flex size-12 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-400 shadow-sm">
                    <Wand2 className="size-5" />
                  </div>
                  <h2 className="mt-4 text-lg font-semibold tracking-tight text-slate-900">No draft yet</h2>
                  <p className="mt-2 text-sm text-slate-500">Waiting for draft input.</p>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
