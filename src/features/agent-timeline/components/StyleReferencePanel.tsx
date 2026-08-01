"use client";

import { ImageIcon, LoaderCircle, RefreshCw, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { SelectedCivitaiResourcesPreview } from "@/features/civitai-lora-library";
import {
  STYLE_REFERENCE_IP_ADAPTER_DEFAULTS,
  createStyleReferenceSnapshot,
  getStyleReferenceCapability,
  getStyleReferenceContextMismatch,
  parseStyleReferenceAnalysisContent,
  sanitizeStyleReferenceIpAdapterSettings,
  sanitizeStyleReferenceMetadata,
  type StyleReferenceAnalysis,
  type CharacterReferenceSnapshot,
  type StyleReferenceMetadata,
  type StyleReferenceSnapshot,
} from "@/features/agent-timeline/style-reference";
import {
  getLlmProxyErrorMessage,
  isLlmChatResponse,
  type LlmChatRequest,
} from "@/features/llm";
import type { PromptProfileId } from "@/shared/prompt-profile";
import {
  buildRunVisualStyleLlmInstructions,
  type RunVisualStyle,
} from "@/features/agent-timeline/run-visual-style";

type StyleReferenceFileInfo = {
  byteLength: number;
  contentType: string;
  name: string;
};

type KreaAdapterPreflight = {
  available: boolean;
  key: string;
  reason: string;
};

type KreaAdapterAvailability = {
  reason: string;
  status: "available" | "pending" | "unavailable";
};

const KREA_ADAPTER_PREFLIGHT_ERROR_PREFIX = "Krea adapter preflight blocks generation:";

type Props = {
  characterReference?: CharacterReferenceSnapshot;
  checkpointId?: string | null;
  disabled?: boolean;
  nsfwEnabled: boolean;
  onChange: (snapshot: StyleReferenceSnapshot | undefined) => void;
  promptProfile: PromptProfileId;
  selectedCheckpoint: SelectedCivitaiResourcesPreview["checkpoint"];
  snapshot?: StyleReferenceSnapshot;
  visualStyle?: RunVisualStyle;
  workflowLabel: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getApiErrorMessage(payload: unknown, fallback: string) {
  return isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === "string"
    ? payload.error.message
    : fallback;
}

function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string"
      ? resolve(reader.result)
      : reject(new Error("Style reference image could not be read."));
    reader.onerror = () => reject(new Error("Style reference image could not be read."));
    reader.readAsDataURL(file);
  });
}

function buildAnalysisRequest({
  dataUrl,
  fileInfo,
  nsfwEnabled,
  promptProfile,
  visualStyle,
  workflowLabel,
}: {
  dataUrl: string;
  fileInfo: StyleReferenceFileInfo;
  nsfwEnabled: boolean;
  promptProfile: PromptProfileId;
  visualStyle?: RunVisualStyle;
  workflowLabel: string;
}): LlmChatRequest {
  const modelInstruction = promptProfile === "anima"
    ? "Generate an Anima-compatible stylePrompt as concise natural-language visual clauses, not tag soup."
    : promptProfile === "krea2"
      ? "Generate a Krea 2-compatible stylePrompt as one faithful natural-language visual style clause covering medium/rendering, lighting/color/texture, and atmosphere/framing. Do not use Danbooru tags, tag soup, or terse keyword lists."
      : "Generate an Illustrious-compatible stylePrompt as compact comma-separated SD/Danbooru-friendly style tags and short visual phrases.";

  return {
    purpose: "story-style-reference-analysis",
    nsfw: nsfwEnabled,
    messages: [
      {
        role: "system",
        content: [
          `You analyze one visual style reference image for SceneForge ${workflowLabel} generation.`,
          "Return only valid JSON. No markdown, comments, or prose.",
          "Describe reusable visual style only: medium, rendering finish, linework, color palette, lighting, texture, camera/framing, atmosphere, and production style.",
          "Do not identify or imitate living artists, copyrighted characters, logos, celebrities, or specific franchise names.",
          "Do not reproduce the image subject, identity, pose, or narrative content.",
          "The stylePrompt must be directly reusable as one opaque positive-prompt addition.",
          modelInstruction,
          ...(visualStyle ? [buildRunVisualStyleLlmInstructions(visualStyle, promptProfile)] : []),
          '{"summary":"one concise sentence","stylePrompt":"one reusable visual style segment"}',
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: JSON.stringify({
              contentType: fileInfo.contentType,
              filename: fileInfo.name,
              promptProfile,
              ...(visualStyle ? { visualStyle } : {}),
            }),
          },
          { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
        ],
      },
    ],
    temperature: 0.1,
    maxTokens: 700,
  };
}

async function uploadReference(dataUrl: string, fileInfo: StyleReferenceFileInfo) {
  const response = await fetch("/api/comfyui/sequence-references", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ dataUrl }),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(getApiErrorMessage(payload, "Unable to store the style reference."));
  }
  const metadata = sanitizeStyleReferenceMetadata({
    byteLength: isRecord(payload) ? payload.byteLength ?? fileInfo.byteLength : fileInfo.byteLength,
    contentType: isRecord(payload) ? payload.contentType ?? fileInfo.contentType : fileInfo.contentType,
    filename: fileInfo.name,
    storedFilename: isRecord(payload) ? payload.filename : undefined,
    uploadedAt: new Date().toISOString(),
  });
  if (!metadata) {
    throw new Error("Style reference storage returned incomplete or unsafe image metadata.");
  }
  return metadata;
}

async function analyzeReference({
  dataUrl,
  fileInfo,
  nsfwEnabled,
  promptProfile,
  visualStyle,
  workflowLabel,
}: {
  dataUrl: string;
  fileInfo: StyleReferenceFileInfo;
  nsfwEnabled: boolean;
  promptProfile: PromptProfileId;
  visualStyle?: RunVisualStyle;
  workflowLabel: string;
}): Promise<StyleReferenceAnalysis> {
  const response = await fetch("/api/llm/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(buildAnalysisRequest({
      dataUrl,
      fileInfo,
      nsfwEnabled,
      promptProfile,
      visualStyle,
      workflowLabel,
    })),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(getLlmProxyErrorMessage(payload) ?? "Unable to analyze the style reference.");
  }
  if (!isLlmChatResponse(payload)) {
    throw new Error("Style reference analysis response did not include chat content.");
  }
  return parseStyleReferenceAnalysisContent(payload.content, {
    analyzedAt: new Date().toISOString(),
    model: payload.model,
  });
}

async function preflightKreaReferenceBeforeUpload({
  hasCharacterReference,
  selectedCheckpoint,
}: {
  hasCharacterReference: boolean;
  selectedCheckpoint: SelectedCivitaiResourcesPreview["checkpoint"];
}) {
  if (!selectedCheckpoint?.baseModel || !selectedCheckpoint.modelFileName) {
    throw new Error("Select a compatible local Krea 2 Turbo diffusion checkpoint before uploading a Krea reference.");
  }
  const response = await fetch("/api/comfyui/krea2-style-reference-capability", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      checkpointName: selectedCheckpoint.modelFileName,
      modelBaseModel: selectedCheckpoint.baseModel,
      modelStorageKind: "diffusion",
      hasStyleReference: true,
      hasCharacterReference,
    }),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok || !isRecord(payload) || payload.available !== true) {
    throw new Error(isRecord(payload) && typeof payload.reason === "string"
      ? payload.reason
      : "Krea reference-adapter preflight is unavailable. Reference upload remains blocked.");
  }
}

function NumberInput({ label, onChange, value }: { label: string; onChange: (value: number) => void; value: number }) {
  return (
    <label className="grid gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</span>
      <input
        className="h-8 rounded-md border border-indigo-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
        max={1}
        min={0}
        onChange={(event) => {
          const parsed = Number(event.target.value);
          if (Number.isFinite(parsed)) onChange(parsed);
        }}
        step={0.01}
        type="number"
        value={value}
      />
    </label>
  );
}

function getKreaAdapterBlockingError(availability: KreaAdapterAvailability) {
  return availability.status === "pending"
    ? `${KREA_ADAPTER_PREFLIGHT_ERROR_PREFIX} local verification is pending. The explicit adapter selection is preserved, but generation remains blocked until verification succeeds or you disable IPAdapter.`
    : `${KREA_ADAPTER_PREFLIGHT_ERROR_PREFIX} ${availability.reason} The explicit adapter selection is preserved. Disable IPAdapter explicitly to continue with the analyzed style prompt only.`;
}

function isKreaAdapterPreflightBlockingSnapshot(snapshot: StyleReferenceSnapshot | undefined) {
  return snapshot?.mode === "ipadapter" &&
    snapshot.status !== "ready" &&
    snapshot.error?.startsWith(KREA_ADAPTER_PREFLIGHT_ERROR_PREFIX) === true;
}

export function StyleReferencePanel({
  characterReference,
  checkpointId,
  disabled = false,
  nsfwEnabled,
  onChange,
  promptProfile,
  selectedCheckpoint,
  snapshot,
  visualStyle,
  workflowLabel,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dataUrl, setDataUrl] = useState<string>();
  const [fileInfo, setFileInfo] = useState<StyleReferenceFileInfo>();
  const [isProcessing, setIsProcessing] = useState(false);
  const [kreaAdapterPreflight, setKreaAdapterPreflight] = useState<KreaAdapterPreflight>();
  const baseCapability = getStyleReferenceCapability({
    baseModel: selectedCheckpoint ? selectedCheckpoint.baseModel ?? null : promptProfile,
    modelFileName: selectedCheckpoint?.modelFileName,
    promptProfile,
  });
  const isKrea2 = promptProfile === "krea2";
  const kreaAdapterPreflightKey = isKrea2 && selectedCheckpoint?.modelFileName && selectedCheckpoint.baseModel
    ? `${selectedCheckpoint.baseModel}\u0000${selectedCheckpoint.modelFileName}`
    : "";
  const currentKreaAdapterPreflight = kreaAdapterPreflight?.key === kreaAdapterPreflightKey
    ? kreaAdapterPreflight
    : undefined;
  const kreaAdapterAvailability = useMemo<KreaAdapterAvailability | undefined>(() => !isKrea2
    ? undefined
    : !selectedCheckpoint?.modelFileName || !selectedCheckpoint.baseModel
      ? {
          status: "unavailable",
          reason: "Select a compatible local Krea 2 Turbo diffusion checkpoint before enabling its reference adapter.",
        }
      : currentKreaAdapterPreflight
        ? {
            status: currentKreaAdapterPreflight.available ? "available" : "unavailable",
            reason: currentKreaAdapterPreflight.reason,
          }
        : {
            status: "pending",
            reason: "Checking the selected Krea 2 Turbo checkpoint and local reference-adapter graph.",
          }, [
    currentKreaAdapterPreflight,
    isKrea2,
    selectedCheckpoint,
  ]);
  const capability = kreaAdapterAvailability
    ? {
        mode: kreaAdapterAvailability.status === "available" ? "ipadapter" as const : "prompt-only" as const,
        reason: kreaAdapterAvailability.reason,
      }
    : baseCapability;
  const currentCheckpointBaseModel = selectedCheckpoint
    ? selectedCheckpoint.baseModel ?? null
    : (checkpointId && checkpointId === snapshot?.settingsSnapshot?.checkpointId
      ? snapshot.settingsSnapshot.checkpointBaseModel
      : promptProfile);
  const mismatch = getStyleReferenceContextMismatch(snapshot, {
    checkpointBaseModel: currentCheckpointBaseModel,
    checkpointId,
    promptProfile,
    visualStyle,
  });
  const busy = isProcessing;
  const ipAdapter = sanitizeStyleReferenceIpAdapterSettings(snapshot?.ipAdapter);
  const kreaAdapterBlocked = isKreaAdapterPreflightBlockingSnapshot(snapshot);
  const hasAnalyzedReference = Boolean(
    snapshot?.analysis &&
    snapshot.metadata &&
    (snapshot.status === "ready" || kreaAdapterBlocked),
  );
  const showIpAdapterControls = hasAnalyzedReference &&
    (capability.mode === "ipadapter" || isKrea2 && snapshot?.mode === "ipadapter");

  useEffect(() => {
    if (!isKrea2) {
      return;
    }
    if (!selectedCheckpoint?.modelFileName || !selectedCheckpoint.baseModel) {
      return;
    }

    let cancelled = false;
    void fetch("/api/comfyui/krea2-style-reference-capability", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        checkpointName: selectedCheckpoint.modelFileName,
        modelBaseModel: selectedCheckpoint.baseModel,
        modelStorageKind: "diffusion",
        hasCharacterReference: characterReference?.status === "ready",
      }),
    })
      .then(async (response) => {
        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok || !isRecord(payload) || typeof payload.available !== "boolean" ||
            typeof payload.reason !== "string") {
          throw new Error("Krea adapter preflight is unavailable.");
        }
        return { available: payload.available, reason: payload.reason };
      })
      .then((next) => {
        if (!cancelled) setKreaAdapterPreflight({ ...next, key: kreaAdapterPreflightKey });
      })
      .catch(() => {
        if (!cancelled) {
          setKreaAdapterPreflight({
            available: false,
            key: kreaAdapterPreflightKey,
            reason: "Krea adapter preflight is unavailable. The analyzed style prompt remains usable without an adapter.",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [characterReference?.status, isKrea2, kreaAdapterPreflightKey, selectedCheckpoint?.baseModel, selectedCheckpoint?.modelFileName]);

  useEffect(() => {
    if (mismatch && snapshot?.status === "ready") {
      onChange(isKrea2 && snapshot.mode === "ipadapter"
        ? { ...snapshot, error: mismatch, status: "mismatch" }
        : { ...snapshot, error: mismatch, mode: "prompt-only", status: "mismatch", ipAdapter: undefined });
      return;
    }

    if (isKrea2 && snapshot?.mode === "ipadapter" && snapshot.analysis && snapshot.metadata &&
        !mismatch && kreaAdapterAvailability) {
      const modeReason = kreaAdapterAvailability.reason;
      const settingsSnapshot = snapshot.settingsSnapshot
        ? { ...snapshot.settingsSnapshot, modeReason }
        : snapshot.settingsSnapshot;
      const currentPreflightBlock = isKreaAdapterPreflightBlockingSnapshot(snapshot);

      if (kreaAdapterAvailability.status === "available") {
        if (currentPreflightBlock) {
          onChange({ ...snapshot, error: undefined, settingsSnapshot, status: "ready" });
        } else if (snapshot.status === "ready" && snapshot.settingsSnapshot?.modeReason !== modeReason) {
          onChange({ ...snapshot, settingsSnapshot });
        }
        return;
      }

      const error = getKreaAdapterBlockingError(kreaAdapterAvailability);
      const status = kreaAdapterAvailability.status === "pending" ? "pending" as const : "mismatch" as const;
      if (
        snapshot.status === "ready" ||
        currentPreflightBlock &&
          (snapshot.status !== status || snapshot.error !== error ||
            snapshot.settingsSnapshot?.modeReason !== modeReason)
      ) {
        onChange({ ...snapshot, error, settingsSnapshot, status });
      }
      return;
    }

    if (!isKrea2 && snapshot?.status === "ready" &&
        snapshot.mode === "ipadapter" && capability.mode !== "ipadapter") {
      onChange({
        ...snapshot,
        ipAdapter: undefined,
        mode: "prompt-only",
        settingsSnapshot: snapshot.settingsSnapshot
          ? { ...snapshot.settingsSnapshot, modeReason: capability.reason }
          : snapshot.settingsSnapshot,
      });
    }
  }, [
    capability.mode,
    capability.reason,
    isKrea2,
    kreaAdapterAvailability,
    mismatch,
    onChange,
    snapshot,
  ]);

  async function finishAnalysis(metadata: StyleReferenceMetadata, nextDataUrl: string, nextFileInfo: StyleReferenceFileInfo) {
    const preserveKreaAdapter = isKrea2 && snapshot?.mode === "ipadapter";
    const pendingIpAdapter = preserveKreaAdapter
      ? sanitizeStyleReferenceIpAdapterSettings(snapshot.ipAdapter)
      : undefined;
    onChange({
      metadata,
      mode: preserveKreaAdapter ? "ipadapter" : "prompt-only",
      ...(pendingIpAdapter ? { ipAdapter: pendingIpAdapter } : {}),
      status: "pending",
    });
    const analysis = await analyzeReference({
      dataUrl: nextDataUrl,
      fileInfo: nextFileInfo,
      nsfwEnabled,
      promptProfile,
      visualStyle,
      workflowLabel,
    });
    onChange(createStyleReferenceSnapshot({
      analysis,
      capturedAt: new Date().toISOString(),
      checkpointBaseModel: currentCheckpointBaseModel,
      checkpointId,
      ipAdapter: pendingIpAdapter ?? STYLE_REFERENCE_IP_ADAPTER_DEFAULTS,
      metadata,
      mode: preserveKreaAdapter || capability.mode === "ipadapter" ? "ipadapter" : "prompt-only",
      modeReason: capability.reason,
      promptProfile,
      visualStyle,
    }));
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      onChange({ error: `${workflowLabel} style reference must be a PNG, JPEG, or WEBP image.`, mode: "prompt-only", status: "failed" });
      return;
    }
    const nextFileInfo = { byteLength: file.size, contentType: file.type, name: file.name };
    setFileInfo(nextFileInfo);
    setIsProcessing(true);
    const preserveKreaAdapter = isKrea2 && snapshot?.mode === "ipadapter";
    onChange({
      mode: preserveKreaAdapter ? "ipadapter" : "prompt-only",
      ...(preserveKreaAdapter ? { ipAdapter } : {}),
      status: "pending",
    });
    let uploadedMetadata: StyleReferenceMetadata | undefined;
    try {
      if (isKrea2) {
        await preflightKreaReferenceBeforeUpload({
          hasCharacterReference: characterReference?.status === "ready",
          selectedCheckpoint,
        });
      }
      const nextDataUrl = await readFileAsDataUrl(file);
      setDataUrl(nextDataUrl);
      uploadedMetadata = await uploadReference(nextDataUrl, nextFileInfo);
      await finishAnalysis(uploadedMetadata, nextDataUrl, nextFileInfo);
    } catch (error) {
      const preserveKreaAdapter = isKrea2 && snapshot?.mode === "ipadapter";
      onChange({
        ...(uploadedMetadata ? { metadata: uploadedMetadata } : {}),
        error: error instanceof Error ? error.message : `${workflowLabel} style reference failed.`,
        mode: preserveKreaAdapter ? "ipadapter" : "prompt-only",
        ...(preserveKreaAdapter ? { ipAdapter } : {}),
        status: "failed",
      });
    } finally {
      setIsProcessing(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleRetry() {
    if (!snapshot?.metadata) {
      inputRef.current?.click();
      return;
    }
    setIsProcessing(true);
    try {
      let nextDataUrl = dataUrl;
      let nextFileInfo = fileInfo;
      if (!nextDataUrl) {
        const response = await fetch(snapshot.metadata.url);
        if (!response.ok) throw new Error("Stored style reference could not be loaded. Replace or remove it.");
        const blob = await response.blob();
        nextDataUrl = await readFileAsDataUrl(blob);
        nextFileInfo = {
          byteLength: snapshot.metadata.byteLength,
          contentType: snapshot.metadata.contentType,
          name: snapshot.metadata.filename ?? snapshot.metadata.storedFilename,
        };
        setDataUrl(nextDataUrl);
        setFileInfo(nextFileInfo);
      }
      if (!nextFileInfo) throw new Error("Style reference file metadata is missing. Replace the reference.");
      await finishAnalysis(snapshot.metadata, nextDataUrl, nextFileInfo);
    } catch (error) {
      const preserveKreaAdapter = isKrea2 && snapshot.mode === "ipadapter";
      onChange({
        ...snapshot,
        error: error instanceof Error ? error.message : "Style reference analysis failed.",
        mode: preserveKreaAdapter ? "ipadapter" : "prompt-only",
        ipAdapter: preserveKreaAdapter ? ipAdapter : undefined,
        status: "failed",
      });
    } finally {
      setIsProcessing(false);
    }
  }

  function updateAnalyzed(
    patch: Partial<StyleReferenceSnapshot>,
    options: { clearKreaAdapterBlock?: boolean } = {},
  ) {
    if (!snapshot?.analysis || !snapshot.metadata) return;
    onChange({
      ...snapshot,
      ...patch,
      status: kreaAdapterBlocked && !options.clearKreaAdapterBlock ? snapshot.status : "ready",
    });
  }

  return (
    <section className="mt-3 rounded-md border border-indigo-100 bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Style reference</h3>
          <p className="mt-1 text-xs text-slate-500">Optional global visual style for every {workflowLabel} output.</p>
        </div>
        <div className="flex gap-2">
          <label className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border border-indigo-200 px-3 text-xs font-medium text-indigo-700 hover:bg-indigo-50">
            {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <ImageIcon className="size-3.5" />}
            {snapshot ? "Replace" : "Upload"}
            <input
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              disabled={disabled || busy}
              onChange={(event) => void handleFile(event.target.files?.[0])}
              ref={inputRef}
              type="file"
            />
          </label>
          {snapshot ? (
            <button className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-200 px-3 text-xs text-slate-700 hover:bg-slate-50" disabled={disabled || busy} onClick={() => onChange(undefined)} type="button">
              <X className="size-3.5" /> Remove
            </button>
          ) : null}
        </div>
      </div>
      <p className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">{capability.reason}</p>
      {!snapshot ? <p className="mt-3 rounded-md border border-dashed border-slate-200 p-3 text-center text-xs text-slate-500">No {workflowLabel} style reference selected.</p> : null}
      {busy ? <p className="mt-3 flex items-center gap-2 rounded-md border border-indigo-100 bg-indigo-50 p-3 text-xs text-indigo-700"><LoaderCircle className="size-3.5 animate-spin" /> Uploading or analyzing style reference...</p> : null}
      {snapshot && snapshot.status !== "ready" && !busy && !kreaAdapterBlocked ? (
        <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
          <p>{snapshot.error ?? "Style reference is not ready."}</p>
          <button className="mt-2 inline-flex h-8 items-center gap-2 rounded-md border border-rose-200 bg-white px-3" disabled={disabled} onClick={() => void handleRetry()} type="button"><RefreshCw className="size-3.5" /> Retry analysis</button>
        </div>
      ) : null}
      {kreaAdapterBlocked ? (
        <p className="mt-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-xs leading-relaxed text-rose-700">
          {snapshot?.error}
        </p>
      ) : null}
      {hasAnalyzedReference && snapshot?.analysis ? (
        <div className="mt-3 grid gap-2 rounded-md border border-emerald-100 bg-emerald-50/60 p-3 text-xs">
          <div className="flex justify-between gap-2"><strong className="text-emerald-800">{snapshot.metadata?.filename ?? "Style reference"} analyzed</strong><span className="uppercase text-emerald-700">{snapshot.mode === "ipadapter" ? "IPAdapter" : "Prompt-only"}</span></div>
          <p className="text-slate-700">{snapshot.analysis.summary}</p>
          <textarea
            aria-label="Style prompt"
            className="min-h-16 rounded-md border border-emerald-100 bg-white p-2 text-slate-700 outline-none"
            disabled={disabled}
            onChange={(event) => updateAnalyzed({ analysis: { ...snapshot.analysis!, stylePrompt: event.target.value } })}
            value={snapshot.analysis.stylePrompt}
          />
        </div>
      ) : null}
      {showIpAdapterControls && snapshot ? (
        <div className="mt-3 grid gap-3 rounded-md border border-indigo-100 bg-indigo-50/40 p-3">
          <label className="flex items-center gap-2 text-xs font-medium text-indigo-800">
            <input
              checked={snapshot.mode === "ipadapter"}
              disabled={disabled}
              onChange={(event) => updateAnalyzed({
                error: undefined,
                mode: event.target.checked ? "ipadapter" : "prompt-only",
                ipAdapter: event.target.checked ? ipAdapter : undefined,
                settingsSnapshot: snapshot.settingsSnapshot
                  ? { ...snapshot.settingsSnapshot, modeReason: capability.reason }
                  : snapshot.settingsSnapshot,
              }, { clearKreaAdapterBlock: true })}
              type="checkbox"
            />
            Use IPAdapter in addition to the style prompt
          </label>
          {snapshot.mode === "ipadapter" ? (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                {!isKrea2 ? <>
                  <NumberInput label="weight" onChange={(weight) => updateAnalyzed({ ipAdapter: sanitizeStyleReferenceIpAdapterSettings({ ...ipAdapter, weight }) })} value={ipAdapter.weight} />
                  <NumberInput label="start_at" onChange={(startPercent) => updateAnalyzed({ ipAdapter: sanitizeStyleReferenceIpAdapterSettings({ ...ipAdapter, startPercent }) })} value={ipAdapter.startPercent} />
                  <NumberInput label="end_at" onChange={(endPercent) => updateAnalyzed({ ipAdapter: sanitizeStyleReferenceIpAdapterSettings({ ...ipAdapter, endPercent }) })} value={ipAdapter.endPercent} />
                </> : null}
              </div>
              {isKrea2 ? <p className="text-xs leading-relaxed text-slate-600">Krea timing is fixed to start_at 0 and end_at 1. Its shared reference strength is controlled with the Run character-reference setting.</p> : null}
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
