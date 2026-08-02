"use client";

import { ImageIcon, LoaderCircle, X } from "lucide-react";
import { useRef, useState } from "react";

import type { SelectedCivitaiResourcesPreview } from "@/features/civitai-lora-library";
import {
  CHARACTER_REFERENCE_DEFAULT_STRENGTH,
  createCharacterReferenceSnapshot,
  sanitizeCharacterReferenceSnapshot,
  sanitizeStyleReferenceMetadata,
  type CharacterReferenceSnapshot,
  type StyleReferenceSnapshot,
} from "@/features/agent-timeline/style-reference";
import type { PromptProfileId } from "@/shared/prompt-profile";

type Props = {
  disabled?: boolean;
  kreaReferenceStrength: number;
  onChange: (snapshot: CharacterReferenceSnapshot | undefined) => void;
  onKreaReferenceStrengthChange: (strength: number) => void;
  promptProfile: PromptProfileId;
  selectedCheckpoint: SelectedCivitaiResourcesPreview["checkpoint"];
  snapshot?: CharacterReferenceSnapshot;
  styleReference?: StyleReferenceSnapshot;
};

type FileInfo = {
  byteLength: number;
  contentType: string;
  name: string;
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
      : reject(new Error("Character reference image could not be read."));
    reader.onerror = () => reject(new Error("Character reference image could not be read."));
    reader.readAsDataURL(file);
  });
}

async function uploadReference(dataUrl: string, fileInfo: FileInfo) {
  const response = await fetch("/api/comfyui/sequence-references", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ dataUrl }),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(getApiErrorMessage(payload, "Unable to store the character reference."));
  }
  const metadata = sanitizeStyleReferenceMetadata({
    byteLength: isRecord(payload) ? payload.byteLength ?? fileInfo.byteLength : fileInfo.byteLength,
    contentType: isRecord(payload) ? payload.contentType ?? fileInfo.contentType : fileInfo.contentType,
    filename: fileInfo.name,
    storedFilename: isRecord(payload) ? payload.filename : undefined,
    uploadedAt: new Date().toISOString(),
  });
  if (!metadata) {
    throw new Error("Character reference storage returned incomplete or unsafe image metadata.");
  }
  return metadata;
}

async function preflightKreaReference({
  hasStyleReference,
  selectedCheckpoint,
}: {
  hasStyleReference: boolean;
  selectedCheckpoint: SelectedCivitaiResourcesPreview["checkpoint"];
}) {
  if (!selectedCheckpoint?.baseModel || !selectedCheckpoint.modelFileName) {
    throw new Error("Select a compatible local Krea 2 Turbo diffusion checkpoint before uploading a character reference.");
  }
  const response = await fetch("/api/comfyui/krea2-style-reference-capability", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      checkpointName: selectedCheckpoint.modelFileName,
      modelBaseModel: selectedCheckpoint.baseModel,
      modelStorageKind: "diffusion",
      hasStyleReference,
      hasCharacterReference: true,
    }),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok || !isRecord(payload) || payload.available !== true) {
    throw new Error(isRecord(payload) && typeof payload.reason === "string"
      ? payload.reason
      : "Krea reference-adapter preflight is unavailable. Character reference upload remains blocked.");
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

export function CharacterReferencePanel({
  disabled = false,
  kreaReferenceStrength,
  onChange,
  onKreaReferenceStrengthChange,
  promptProfile,
  selectedCheckpoint,
  snapshot,
  styleReference,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const isKrea2 = promptProfile === "krea2";
  const normalized = sanitizeCharacterReferenceSnapshot(snapshot);
  const hasKreaStyleReference = styleReference?.status === "ready" && styleReference.mode === "ipadapter";

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      onChange({
        error: "Run character reference must be a PNG, JPEG, or WEBP image.",
        status: "failed",
        strength: normalized?.strength ?? CHARACTER_REFERENCE_DEFAULT_STRENGTH,
      });
      return;
    }
    const fileInfo = { byteLength: file.size, contentType: file.type, name: file.name };
    setBusy(true);
    onChange({ status: "pending", strength: normalized?.strength ?? CHARACTER_REFERENCE_DEFAULT_STRENGTH });
    try {
      if (isKrea2) {
        await preflightKreaReference({ hasStyleReference: hasKreaStyleReference, selectedCheckpoint });
      }
      const metadata = await uploadReference(await readFileAsDataUrl(file), fileInfo);
      onChange(createCharacterReferenceSnapshot({
        metadata,
        strength: normalized?.strength ?? CHARACTER_REFERENCE_DEFAULT_STRENGTH,
      }));
    } catch (error) {
      onChange({
        error: error instanceof Error ? error.message : "Character reference upload failed.",
        status: "failed",
        strength: normalized?.strength ?? CHARACTER_REFERENCE_DEFAULT_STRENGTH,
      });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <section className="mt-3 rounded-md border border-indigo-100 bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Character reference</h3>
          <p className="mt-1 text-xs text-slate-500">Optional identity image for every Run Preview and Final. It remains separate from img2img and global style.</p>
        </div>
        <div className="flex gap-2">
          <label className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border border-indigo-200 px-3 text-xs font-medium text-indigo-700 hover:bg-indigo-50">
            {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <ImageIcon className="size-3.5" />}
            {normalized ? "Replace" : "Upload"}
            <input
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              disabled={disabled || busy}
              onChange={(event) => void handleFile(event.target.files?.[0])}
              ref={inputRef}
              type="file"
            />
          </label>
          {normalized ? (
            <button className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-200 px-3 text-xs text-slate-700 hover:bg-slate-50" disabled={disabled || busy} onClick={() => onChange(undefined)} type="button">
              <X className="size-3.5" /> Remove
            </button>
          ) : null}
        </div>
      </div>
      {isKrea2 ? (
        <div className="mt-3 rounded-md border border-indigo-100 bg-indigo-50/40 p-3">
          <NumberInput label="Shared Krea reference strength" onChange={onKreaReferenceStrengthChange} value={kreaReferenceStrength} />
          <p className="mt-2 text-xs leading-relaxed text-slate-600">One verified Krea2OstrisEdit path applies this strength to every active style or character reference; timing is fixed from 0 to 1.</p>
        </div>
      ) : normalized?.status === "ready" ? (
        <div className="mt-3 rounded-md border border-indigo-100 bg-indigo-50/40 p-3">
          <NumberInput label="Character strength" onChange={(strength) => onChange({ ...normalized, strength })} value={normalized.strength} />
        </div>
      ) : null}
      {busy ? <p className="mt-3 text-xs text-indigo-700">Preparing character reference...</p> : null}
      {normalized?.status === "ready" ? <p className="mt-3 text-xs text-emerald-700">{normalized.metadata?.filename ?? "Character reference"} is ready for identity conditioning.</p> : null}
      {normalized && normalized.status !== "ready" && !busy ? <p className="mt-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{normalized.error ?? "Character reference is not ready."}</p> : null}
    </section>
  );
}
