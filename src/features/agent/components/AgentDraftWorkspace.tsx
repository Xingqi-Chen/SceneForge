"use client";

import { AlertTriangle, CheckCircle2, Loader2, Plus, Settings, Trash2, Wand2, X } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  BooleanInput,
  NumberInput,
  SelectInput,
  TextInput,
} from "@/components/ui/comfyui-parameter-controls";
import type {
  AgentErrorResponse,
  AgentGenerationDefaults,
  AgentSingleImageDraftResponse,
} from "@/features/agent";
import { COMFYUI_LATENT_IMAGE_NODE_OPTIONS } from "@/features/comfyui/latent-image-node";
import type { ComfyUiLoraInput } from "@/features/comfyui/types";
import {
  COMFYUI_SAMPLER_OPTIONS,
  COMFYUI_SCHEDULER_OPTIONS,
} from "@/features/editor/ai-prompt/comfyui-generation-options";

type AgentLatentImageNode = NonNullable<AgentGenerationDefaults["latentImageNode"]>;

type AgentSettings = {
  nsfw: boolean;
};

type DraftLora = Required<Pick<ComfyUiLoraInput, "loraName" | "strengthModel" | "strengthClip">>;

type DraftConfig = {
  batchSize: number;
  cfg: number;
  checkpointName: string;
  denoise: number;
  height: number;
  latentImageNode: AgentLatentImageNode;
  loras: DraftLora[];
  outputPrefix: string;
  samplerName: string;
  scheduler: string;
  steps: number;
  width: number;
};

const DEFAULT_SETTINGS: AgentSettings = {
  nsfw: false,
};

const DEFAULT_DRAFT_CONFIG: DraftConfig = {
  batchSize: 1,
  cfg: 7,
  checkpointName: "",
  denoise: 1,
  height: 1024,
  latentImageNode: "EmptyLatentImage",
  loras: [],
  outputPrefix: "SceneForge",
  samplerName: "euler",
  scheduler: "normal",
  steps: 30,
  width: 1024,
};

const REQUEST_TEXTAREA_CLASS =
  "mt-2 min-h-52 w-full resize-y rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100";
const MONO_TEXTAREA_CLASS =
  "mt-2 min-h-72 w-full resize-y rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100";
const SECTION_LABEL_CLASS = "text-[10px] font-semibold uppercase tracking-wider text-slate-500";
const FIELD_LABEL_CLASS = "text-sm font-medium text-slate-700";

function errorMessageFromPayload(payload: unknown, fallback: string) {
  const response = payload as Partial<AgentErrorResponse>;
  return response.error?.message ?? fallback;
}

function roundToStep(value: number, step: number, min: number) {
  return Math.max(min, Math.round(value / step) * step);
}

function normalizeDraftLora(lora: ComfyUiLoraInput): DraftLora {
  return {
    loraName: lora.loraName,
    strengthModel: lora.strengthModel ?? 0.7,
    strengthClip: lora.strengthClip ?? lora.strengthModel ?? 0.7,
  };
}

function toDraftConfig(response: AgentSingleImageDraftResponse): DraftConfig {
  const request = response.comfyUiRequest;

  return {
    ...DEFAULT_DRAFT_CONFIG,
    batchSize: request.batchSize ?? DEFAULT_DRAFT_CONFIG.batchSize,
    cfg: request.cfg ?? DEFAULT_DRAFT_CONFIG.cfg,
    checkpointName: request.checkpointName ?? DEFAULT_DRAFT_CONFIG.checkpointName,
    denoise: request.denoise ?? DEFAULT_DRAFT_CONFIG.denoise,
    height: request.height ?? DEFAULT_DRAFT_CONFIG.height,
    latentImageNode: request.latentImageNode ?? DEFAULT_DRAFT_CONFIG.latentImageNode,
    loras: request.loras?.map(normalizeDraftLora) ?? [],
    outputPrefix: request.outputPrefix ?? DEFAULT_DRAFT_CONFIG.outputPrefix,
    samplerName: request.samplerName ?? DEFAULT_DRAFT_CONFIG.samplerName,
    scheduler: request.scheduler ?? DEFAULT_DRAFT_CONFIG.scheduler,
    steps: request.steps ?? DEFAULT_DRAFT_CONFIG.steps,
    width: request.width ?? DEFAULT_DRAFT_CONFIG.width,
  };
}

function buildGenerationDefaults(config: DraftConfig): AgentGenerationDefaults {
  return {
    checkpointName: config.checkpointName,
    loras: config.loras
      .filter((lora) => lora.loraName.trim())
      .map((lora) => ({
        loraName: lora.loraName.trim(),
        strengthModel: lora.strengthModel,
        strengthClip: lora.strengthClip,
      })),
    width: config.width,
    height: config.height,
    steps: config.steps,
    cfg: config.cfg,
    samplerName: config.samplerName,
    scheduler: config.scheduler,
    denoise: config.denoise,
    batchSize: config.batchSize,
    latentImageNode: config.latentImageNode,
    ...(config.outputPrefix.trim() ? { outputPrefix: config.outputPrefix.trim() } : {}),
  };
}

export function AgentDraftWorkspace() {
  const [settings, setSettings] = useState<AgentSettings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [userRequest, setUserRequest] = useState("");
  const [draft, setDraft] = useState<AgentSingleImageDraftResponse | null>(null);
  const [draftConfig, setDraftConfig] = useState<DraftConfig | null>(null);
  const [draftPositivePrompt, setDraftPositivePrompt] = useState("");
  const [draftNegativePrompt, setDraftNegativePrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const editableComfyUiRequest = useMemo(() => {
    if (!draft || !draftConfig) {
      return null;
    }

    return {
      ...buildGenerationDefaults(draftConfig),
      positivePrompt: draftPositivePrompt,
      negativePrompt: draftNegativePrompt,
    };
  }, [draft, draftConfig, draftNegativePrompt, draftPositivePrompt]);

  function patchDraftConfig(patch: Partial<DraftConfig>) {
    setDraftConfig((current) => (current ? { ...current, ...patch } : current));
  }

  function patchLora(index: number, patch: Partial<DraftLora>) {
    setDraftConfig((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        loras: current.loras.map((lora, loraIndex) => (
          loraIndex === index ? { ...lora, ...patch } : lora
        )),
      };
    });
  }

  function addLora() {
    setDraftConfig((current) => current
      ? {
          ...current,
          loras: [...current.loras, { loraName: "", strengthClip: 0.7, strengthModel: 0.7 }],
        }
      : current);
  }

  function removeLora(index: number) {
    setDraftConfig((current) => current
      ? {
          ...current,
          loras: current.loras.filter((_lora, loraIndex) => loraIndex !== index),
        }
      : current);
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
          userRequest,
          nsfw: settings.nsfw,
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(errorMessageFromPayload(payload, "Agent draft request failed."));
      }

      const nextDraft = payload as AgentSingleImageDraftResponse;
      setDraft(nextDraft);
      setDraftConfig(toDraftConfig(nextDraft));
      setDraftPositivePrompt(nextDraft.positivePrompt);
      setDraftNegativePrompt(nextDraft.negativePrompt);
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
          <div className="relative flex items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 sm:inline-flex">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Confirmation gate
            </span>
            <Button
              aria-expanded={settingsOpen}
              aria-haspopup="dialog"
              className="h-8 shadow-none"
              onClick={() => setSettingsOpen((current) => !current)}
              type="button"
              variant="secondary"
            >
              <Settings className="size-4" />
              Settings
            </Button>
            {settingsOpen ? (
              <div
                className="absolute right-0 top-10 z-50 w-72 rounded-md border border-slate-200 bg-white p-3 shadow-xl"
                role="dialog"
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold text-slate-900">Agent Settings</h2>
                  <button
                    aria-label="Close settings"
                    className="rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                    onClick={() => setSettingsOpen(false)}
                    type="button"
                  >
                    <X className="size-4" />
                  </button>
                </div>
                <BooleanInput
                  checked={settings.nsfw}
                  label="NSFW"
                  onChange={(value) => setSettings((current) => ({ ...current, nsfw: value }))}
                />
              </div>
            ) : null}
          </div>
        </header>

        <div className="relative z-0 flex min-h-0 flex-1 overflow-hidden max-lg:flex-col">
          <section className="touch-scroll-region custom-scrollbar flex w-[380px] shrink-0 flex-col overflow-y-auto border-r border-slate-200 bg-white p-4 max-lg:max-h-[50dvh] max-lg:w-full max-lg:border-b max-lg:border-r-0">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-900">Draft Input</h2>
              <Wand2 className="size-4 shrink-0 text-slate-400" />
            </div>

            <label className="block">
              <span className={SECTION_LABEL_CLASS}>Request</span>
              <textarea
                className={REQUEST_TEXTAREA_CLASS}
                onChange={(event) => setUserRequest(event.target.value)}
                placeholder="cinematic rain alley with a lone traveler, neon reflections, dramatic rim light"
                value={userRequest}
              />
            </label>

            <div className="mt-5 border-t border-slate-100 pt-4">
              <Button
                className="h-10 w-full shadow-none"
                disabled={isLoading || !userRequest.trim()}
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

            {draft && draftConfig ? (
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

                <section className="space-y-4 rounded-md border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-slate-900">Generation Defaults</h3>
                    <Button className="h-8 shadow-none" onClick={addLora} type="button" variant="secondary">
                      <Plus className="size-4" />
                      LoRA
                    </Button>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <TextInput
                      label="checkpoint"
                      onChange={(value) => patchDraftConfig({ checkpointName: value })}
                      placeholder="model.safetensors"
                      value={draftConfig.checkpointName}
                    />
                    <TextInput
                      label="output prefix"
                      onChange={(value) => patchDraftConfig({ outputPrefix: value })}
                      value={draftConfig.outputPrefix}
                    />
                    <NumberInput
                      label="width"
                      min={16}
                      onChange={(value) => patchDraftConfig({ width: roundToStep(value, 8, 16) })}
                      step={8}
                      value={draftConfig.width}
                    />
                    <NumberInput
                      label="height"
                      min={16}
                      onChange={(value) => patchDraftConfig({ height: roundToStep(value, 8, 16) })}
                      step={8}
                      value={draftConfig.height}
                    />
                    <NumberInput
                      label="steps"
                      min={1}
                      onChange={(value) => patchDraftConfig({ steps: Math.max(1, Math.round(value)) })}
                      value={draftConfig.steps}
                    />
                    <NumberInput
                      label="cfg"
                      min={0}
                      onChange={(value) => patchDraftConfig({ cfg: value })}
                      step={0.5}
                      value={draftConfig.cfg}
                    />
                    <NumberInput
                      label="denoise"
                      max={1}
                      min={0}
                      onChange={(value) => patchDraftConfig({ denoise: Math.min(1, Math.max(0, value)) })}
                      step={0.05}
                      value={draftConfig.denoise}
                    />
                    <NumberInput
                      label="images"
                      max={16}
                      min={1}
                      onChange={(value) => patchDraftConfig({ batchSize: Math.min(16, Math.max(1, Math.round(value))) })}
                      value={draftConfig.batchSize}
                    />
                    <SelectInput
                      label="sampler"
                      onChange={(value) => patchDraftConfig({ samplerName: value })}
                      options={COMFYUI_SAMPLER_OPTIONS}
                      value={draftConfig.samplerName}
                    />
                    <SelectInput
                      label="scheduler"
                      onChange={(value) => patchDraftConfig({ scheduler: value })}
                      options={COMFYUI_SCHEDULER_OPTIONS}
                      value={draftConfig.scheduler}
                    />
                    <SelectInput
                      label="latent"
                      onChange={(value) => patchDraftConfig({ latentImageNode: value as AgentLatentImageNode })}
                      options={COMFYUI_LATENT_IMAGE_NODE_OPTIONS}
                      value={draftConfig.latentImageNode}
                    />
                  </div>

                  {draftConfig.loras.length > 0 ? (
                    <div className="space-y-3 border-t border-slate-100 pt-4">
                      <p className={SECTION_LABEL_CLASS}>LoRAs</p>
                      {draftConfig.loras.map((lora, index) => (
                        <div className="grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 lg:grid-cols-[minmax(0,1fr)_120px_120px_auto]" key={index}>
                          <TextInput
                            label="lora"
                            onChange={(value) => patchLora(index, { loraName: value })}
                            placeholder="lora.safetensors"
                            value={lora.loraName}
                          />
                          <NumberInput
                            label="model"
                            onChange={(value) => patchLora(index, { strengthModel: value })}
                            step={0.05}
                            value={lora.strengthModel}
                          />
                          <NumberInput
                            label="clip"
                            onChange={(value) => patchLora(index, { strengthClip: value })}
                            step={0.05}
                            value={lora.strengthClip}
                          />
                          <Button
                            aria-label={`Remove LoRA ${index + 1}`}
                            className="h-9 self-end border-rose-200 bg-white text-rose-600 shadow-none hover:bg-rose-50"
                            onClick={() => removeLora(index)}
                            type="button"
                            variant="secondary"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </section>

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
