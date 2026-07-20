"use client";

import { ImageIcon, LoaderCircle, RefreshCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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
  type StyleReferenceMetadata,
  type StyleReferenceSnapshot,
} from "@/features/agent-timeline/style-reference";
import {
  getLlmProxyErrorMessage,
  isLlmChatResponse,
  type LlmChatRequest,
} from "@/features/llm";
import type { PromptProfileId } from "@/shared/prompt-profile";

type StyleReferenceFileInfo = {
  byteLength: number;
  contentType: string;
  name: string;
};

type Props = {
  checkpointId?: string | null;
  disabled?: boolean;
  nsfwEnabled: boolean;
  onChange: (snapshot: StyleReferenceSnapshot | undefined) => void;
  promptProfile: PromptProfileId;
  selectedCheckpoint: SelectedCivitaiResourcesPreview["checkpoint"];
  snapshot?: StyleReferenceSnapshot;
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
  workflowLabel,
}: {
  dataUrl: string;
  fileInfo: StyleReferenceFileInfo;
  nsfwEnabled: boolean;
  promptProfile: PromptProfileId;
  workflowLabel: string;
}): LlmChatRequest {
  const modelInstruction = promptProfile === "anima"
    ? "Generate an Anima-compatible stylePrompt as concise natural-language visual clauses, not tag soup."
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
  workflowLabel,
}: {
  dataUrl: string;
  fileInfo: StyleReferenceFileInfo;
  nsfwEnabled: boolean;
  promptProfile: PromptProfileId;
  workflowLabel: string;
}): Promise<StyleReferenceAnalysis> {
  const response = await fetch("/api/llm/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(buildAnalysisRequest({ dataUrl, fileInfo, nsfwEnabled, promptProfile, workflowLabel })),
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

export function StyleReferencePanel({
  checkpointId,
  disabled = false,
  nsfwEnabled,
  onChange,
  promptProfile,
  selectedCheckpoint,
  snapshot,
  workflowLabel,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dataUrl, setDataUrl] = useState<string>();
  const [fileInfo, setFileInfo] = useState<StyleReferenceFileInfo>();
  const [isProcessing, setIsProcessing] = useState(false);
  const capability = getStyleReferenceCapability({
    baseModel: selectedCheckpoint ? selectedCheckpoint.baseModel ?? null : promptProfile,
  });
  const currentCheckpointBaseModel = selectedCheckpoint
    ? selectedCheckpoint.baseModel ?? null
    : (checkpointId && checkpointId === snapshot?.settingsSnapshot?.checkpointId
      ? snapshot.settingsSnapshot.checkpointBaseModel
      : promptProfile);
  const mismatch = getStyleReferenceContextMismatch(snapshot, {
    checkpointBaseModel: currentCheckpointBaseModel,
    checkpointId,
    promptProfile,
  });
  const busy = isProcessing;
  const ipAdapter = sanitizeStyleReferenceIpAdapterSettings(snapshot?.ipAdapter);

  useEffect(() => {
    if (mismatch && snapshot?.status === "ready") {
      onChange({ ...snapshot, error: mismatch, mode: "prompt-only", status: "mismatch", ipAdapter: undefined });
      return;
    }
    if (snapshot?.status === "ready" && snapshot.mode === "ipadapter" && capability.mode !== "ipadapter") {
      onChange({
        ...snapshot,
        ipAdapter: undefined,
        mode: "prompt-only",
        settingsSnapshot: snapshot.settingsSnapshot
          ? { ...snapshot.settingsSnapshot, modeReason: capability.reason }
          : snapshot.settingsSnapshot,
      });
    }
  }, [capability.mode, capability.reason, mismatch, onChange, snapshot]);

  async function finishAnalysis(metadata: StyleReferenceMetadata, nextDataUrl: string, nextFileInfo: StyleReferenceFileInfo) {
    onChange({ metadata, mode: "prompt-only", status: "pending" });
    const analysis = await analyzeReference({
      dataUrl: nextDataUrl,
      fileInfo: nextFileInfo,
      nsfwEnabled,
      promptProfile,
      workflowLabel,
    });
    onChange(createStyleReferenceSnapshot({
      analysis,
      capturedAt: new Date().toISOString(),
      checkpointBaseModel: currentCheckpointBaseModel,
      checkpointId,
      ipAdapter: STYLE_REFERENCE_IP_ADAPTER_DEFAULTS,
      metadata,
      mode: capability.mode === "ipadapter" ? "ipadapter" : "prompt-only",
      modeReason: capability.reason,
      promptProfile,
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
    onChange({ mode: "prompt-only", status: "pending" });
    let uploadedMetadata: StyleReferenceMetadata | undefined;
    try {
      const nextDataUrl = await readFileAsDataUrl(file);
      setDataUrl(nextDataUrl);
      uploadedMetadata = await uploadReference(nextDataUrl, nextFileInfo);
      await finishAnalysis(uploadedMetadata, nextDataUrl, nextFileInfo);
    } catch (error) {
      onChange({
        ...(uploadedMetadata ? { metadata: uploadedMetadata } : {}),
        error: error instanceof Error ? error.message : `${workflowLabel} style reference failed.`,
        mode: "prompt-only",
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
      onChange({
        ...snapshot,
        error: error instanceof Error ? error.message : "Style reference analysis failed.",
        mode: "prompt-only",
        status: "failed",
      });
    } finally {
      setIsProcessing(false);
    }
  }

  function updateReady(patch: Partial<StyleReferenceSnapshot>) {
    if (!snapshot?.analysis || !snapshot.metadata) return;
    onChange({ ...snapshot, ...patch, status: "ready" });
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
      {snapshot && snapshot.status !== "ready" && !busy ? (
        <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
          <p>{snapshot.error ?? "Style reference is not ready."}</p>
          <button className="mt-2 inline-flex h-8 items-center gap-2 rounded-md border border-rose-200 bg-white px-3" disabled={disabled} onClick={() => void handleRetry()} type="button"><RefreshCw className="size-3.5" /> Retry analysis</button>
        </div>
      ) : null}
      {snapshot?.status === "ready" && snapshot.analysis ? (
        <div className="mt-3 grid gap-2 rounded-md border border-emerald-100 bg-emerald-50/60 p-3 text-xs">
          <div className="flex justify-between gap-2"><strong className="text-emerald-800">{snapshot.metadata?.filename ?? "Style reference"} analyzed</strong><span className="uppercase text-emerald-700">{snapshot.mode === "ipadapter" ? "IPAdapter" : "Prompt-only"}</span></div>
          <p className="text-slate-700">{snapshot.analysis.summary}</p>
          <textarea
            aria-label="Style prompt"
            className="min-h-16 rounded-md border border-emerald-100 bg-white p-2 text-slate-700 outline-none"
            disabled={disabled}
            onChange={(event) => updateReady({ analysis: { ...snapshot.analysis!, stylePrompt: event.target.value } })}
            value={snapshot.analysis.stylePrompt}
          />
        </div>
      ) : null}
      {snapshot?.status === "ready" && capability.mode === "ipadapter" ? (
        <div className="mt-3 grid gap-3 rounded-md border border-indigo-100 bg-indigo-50/40 p-3">
          <label className="flex items-center gap-2 text-xs font-medium text-indigo-800">
            <input checked={snapshot.mode === "ipadapter"} disabled={disabled} onChange={(event) => updateReady({ mode: event.target.checked ? "ipadapter" : "prompt-only", ipAdapter: event.target.checked ? ipAdapter : undefined })} type="checkbox" />
            Use IPAdapter in addition to the style prompt
          </label>
          {snapshot.mode === "ipadapter" ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <NumberInput label="weight" onChange={(weight) => updateReady({ ipAdapter: sanitizeStyleReferenceIpAdapterSettings({ ...ipAdapter, weight }) })} value={ipAdapter.weight} />
              <NumberInput label="start_at" onChange={(startPercent) => updateReady({ ipAdapter: sanitizeStyleReferenceIpAdapterSettings({ ...ipAdapter, startPercent }) })} value={ipAdapter.startPercent} />
              <NumberInput label="end_at" onChange={(endPercent) => updateReady({ ipAdapter: sanitizeStyleReferenceIpAdapterSettings({ ...ipAdapter, endPercent }) })} value={ipAdapter.endPercent} />
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
