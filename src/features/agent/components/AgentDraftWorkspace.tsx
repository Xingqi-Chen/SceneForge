"use client";

import { AlertTriangle, CheckCircle2, Loader2, Wand2 } from "lucide-react";
import { useMemo, useState } from "react";

import type {
  AgentErrorResponse,
  AgentGenerationDefaults,
  AgentSingleImageDraftResponse,
} from "@/features/agent";

type DraftForm = {
  batchSize: string;
  cfg: string;
  checkpointName: string;
  denoise: string;
  height: string;
  model: string;
  negativePrompt: string;
  nsfw: boolean;
  outputPrefix: string;
  samplerName: string;
  scheduler: string;
  steps: string;
  userRequest: string;
  width: string;
};

const DEFAULT_FORM: DraftForm = {
  batchSize: "1",
  cfg: "7",
  checkpointName: "",
  denoise: "1",
  height: "1024",
  model: "",
  negativePrompt: "",
  nsfw: false,
  outputPrefix: "SceneForge",
  samplerName: "euler",
  scheduler: "normal",
  steps: "30",
  userRequest: "",
  width: "1024",
};

function parseOptionalNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatOptionalNumber(value: number | undefined) {
  return value === undefined ? undefined : String(value);
}

function buildGenerationDefaults(form: DraftForm): AgentGenerationDefaults {
  const width = parseOptionalNumber(form.width);
  const height = parseOptionalNumber(form.height);
  const steps = parseOptionalNumber(form.steps);
  const cfg = parseOptionalNumber(form.cfg);
  const denoise = parseOptionalNumber(form.denoise);
  const batchSize = parseOptionalNumber(form.batchSize);

  return {
    ...(form.checkpointName.trim() ? { checkpointName: form.checkpointName.trim() } : {}),
    ...(form.negativePrompt.trim() ? { negativePrompt: form.negativePrompt.trim() } : {}),
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(steps !== undefined ? { steps } : {}),
    ...(cfg !== undefined ? { cfg } : {}),
    ...(form.samplerName.trim() ? { samplerName: form.samplerName.trim() } : {}),
    ...(form.scheduler.trim() ? { scheduler: form.scheduler.trim() } : {}),
    ...(denoise !== undefined ? { denoise } : {}),
    ...(batchSize !== undefined ? { batchSize } : {}),
    ...(form.outputPrefix.trim() ? { outputPrefix: form.outputPrefix.trim() } : {}),
  };
}

function errorMessageFromPayload(payload: unknown, fallback: string) {
  const response = payload as Partial<AgentErrorResponse>;
  return response.error?.message ?? fallback;
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
          model: form.model.trim() || undefined,
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
        width: formatOptionalNumber(nextDraft.comfyUiRequest.width) ?? current.width,
        height: formatOptionalNumber(nextDraft.comfyUiRequest.height) ?? current.height,
        steps: formatOptionalNumber(nextDraft.comfyUiRequest.steps) ?? current.steps,
        cfg: formatOptionalNumber(nextDraft.comfyUiRequest.cfg) ?? current.cfg,
        denoise: formatOptionalNumber(nextDraft.comfyUiRequest.denoise) ?? current.denoise,
        batchSize: formatOptionalNumber(nextDraft.comfyUiRequest.batchSize) ?? current.batchSize,
      }));
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Agent draft request failed.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="h-[100dvh] overflow-hidden bg-slate-950 text-slate-100">
      <div className="grid h-full grid-cols-[minmax(360px,420px)_1fr] max-lg:grid-cols-1">
        <section className="flex min-h-0 flex-col border-r border-slate-800 bg-slate-900/95 max-lg:border-b max-lg:border-r-0">
          <header className="border-b border-slate-800 px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h1 className="text-xl font-semibold tracking-normal">Agent Draft</h1>
                <p className="mt-1 text-sm text-slate-400">Single-image draft</p>
              </div>
              <span className="rounded bg-cyan-400 px-2 py-1 text-xs font-semibold text-slate-950">Draft</span>
            </div>
          </header>

          <div className="custom-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
            <label className="block">
              <span className="text-sm font-medium text-slate-200">Request</span>
              <textarea
                className="mt-2 min-h-44 w-full resize-y rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-400"
                value={form.userRequest}
                onChange={(event) => updateForm("userRequest", event.target.value)}
                placeholder="cinematic rain alley with a lone traveler, neon reflections, dramatic rim light"
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-sm font-medium text-slate-200">Model</span>
                <input
                  className="mt-2 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-400"
                  value={form.model}
                  onChange={(event) => updateForm("model", event.target.value)}
                  placeholder="default"
                />
              </label>
              <label className="flex items-end gap-2 rounded border border-slate-800 bg-slate-950 px-3 py-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-cyan-400"
                  checked={form.nsfw}
                  onChange={(event) => updateForm("nsfw", event.target.checked)}
                />
                <span className="text-sm font-medium text-slate-200">NSFW model</span>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-sm font-medium text-slate-200">Checkpoint</span>
                <input
                  className="mt-2 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-400"
                  value={form.checkpointName}
                  onChange={(event) => updateForm("checkpointName", event.target.value)}
                  placeholder="model.safetensors"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-200">Output prefix</span>
                <input
                  className="mt-2 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-400"
                  value={form.outputPrefix}
                  onChange={(event) => updateForm("outputPrefix", event.target.value)}
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {(["width", "height", "steps", "cfg", "denoise", "batchSize"] as const).map((field) => (
                <label key={field} className="block">
                  <span className="text-sm font-medium capitalize text-slate-200">{field}</span>
                  <input
                    className="mt-2 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-400"
                    value={form[field]}
                    onChange={(event) => updateForm(field, event.target.value)}
                  />
                </label>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-sm font-medium text-slate-200">Sampler</span>
                <input
                  className="mt-2 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-400"
                  value={form.samplerName}
                  onChange={(event) => updateForm("samplerName", event.target.value)}
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-200">Scheduler</span>
                <input
                  className="mt-2 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-400"
                  value={form.scheduler}
                  onChange={(event) => updateForm("scheduler", event.target.value)}
                />
              </label>
            </div>

            <label className="block">
              <span className="text-sm font-medium text-slate-200">Negative prompt default</span>
              <textarea
                className="mt-2 min-h-24 w-full resize-y rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-400"
                value={form.negativePrompt}
                onChange={(event) => updateForm("negativePrompt", event.target.value)}
              />
            </label>
          </div>

          <footer className="border-t border-slate-800 p-5">
            <button
              type="button"
              className="flex h-11 w-full items-center justify-center gap-2 rounded bg-cyan-400 px-4 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
              disabled={isLoading || !form.userRequest.trim()}
              onClick={submitDraft}
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
              Generate draft
            </button>
          </footer>
        </section>

        <section className="custom-scrollbar min-h-0 overflow-y-auto bg-slate-950 px-6 py-6">
          {error ? (
            <div className="mb-4 flex items-start gap-3 rounded border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          {draft ? (
            <div className="mx-auto max-w-5xl space-y-5">
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
                <div>
                  <p className="text-sm text-slate-400">{draft.draftId}</p>
                  <h2 className="mt-1 text-2xl font-semibold tracking-normal">{draft.title ?? "Untitled draft"}</h2>
                </div>
                <div className="flex items-center gap-2 rounded border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-100">
                  <CheckCircle2 className="h-4 w-4" />
                  Confirmation required
                </div>
              </header>

              <div className="grid grid-cols-2 gap-5 max-xl:grid-cols-1">
                <label className="block">
                  <span className="text-sm font-medium text-slate-200">Positive prompt</span>
                  <textarea
                    className="mt-2 min-h-72 w-full resize-y rounded border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-sm text-slate-100 outline-none transition focus:border-cyan-400"
                    value={draftPositivePrompt}
                    onChange={(event) => setDraftPositivePrompt(event.target.value)}
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-slate-200">Negative prompt</span>
                  <textarea
                    className="mt-2 min-h-72 w-full resize-y rounded border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-sm text-slate-100 outline-none transition focus:border-cyan-400"
                    value={draftNegativePrompt}
                    onChange={(event) => setDraftNegativePrompt(event.target.value)}
                  />
                </label>
              </div>

              {draft.warnings.length > 0 ? (
                <div className="rounded border border-amber-400/30 bg-amber-400/10 px-4 py-3">
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-100">
                    <AlertTriangle className="h-4 w-4" />
                    Warnings
                  </div>
                  <ul className="space-y-1 text-sm text-amber-50">
                    {draft.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <pre className="max-h-96 overflow-auto rounded border border-slate-800 bg-slate-900 p-4 text-xs text-slate-300">
                {JSON.stringify(editableComfyUiRequest, null, 2)}
              </pre>
            </div>
          ) : (
            <div className="grid h-full min-h-[420px] place-items-center">
              <div className="max-w-md text-center">
                <Wand2 className="mx-auto h-10 w-10 text-cyan-300" />
                <h2 className="mt-4 text-2xl font-semibold tracking-normal">No draft yet</h2>
                <p className="mt-2 text-sm text-slate-400">Waiting for draft input.</p>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
