"use client";

import { ImageIcon, LoaderCircle, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { SelectedCivitaiResourcesPreview } from "@/features/civitai-lora-library";
import {
  CHARACTER_REFERENCE_DEFAULT_STRENGTH,
  createCharacterReferenceSnapshot,
  createKrea2ReIdReferenceSnapshot,
  isKrea2ReIdReferenceReady,
  sanitizeCharacterReferenceSnapshot,
  sanitizeStyleReferenceMetadata,
  type CharacterReferenceSnapshot,
  type Krea2ReIdPreparation,
  type Krea2ReIdPreparationChoice,
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

type FileInfo = { byteLength: number; contentType: string; name: string };
type PreparedPreview = {
  crop?: { dataUrl: string; height: number; width: number };
  faceDetected: boolean;
  original: { dataUrl: string; height: number; width: number };
  warning: string;
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

async function uploadGenericReference(dataUrl: string, fileInfo: FileInfo) {
  const response = await fetch("/api/comfyui/sequence-references", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ dataUrl }),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(getApiErrorMessage(payload, "Unable to store the character reference."));
  const metadata = sanitizeStyleReferenceMetadata({
    byteLength: isRecord(payload) ? payload.byteLength ?? fileInfo.byteLength : fileInfo.byteLength,
    contentType: isRecord(payload) ? payload.contentType ?? fileInfo.contentType : fileInfo.contentType,
    filename: fileInfo.name,
    storedFilename: isRecord(payload) ? payload.filename : undefined,
    uploadedAt: new Date().toISOString(),
  });
  if (!metadata) throw new Error("Character reference storage returned incomplete or unsafe image metadata.");
  return metadata;
}

function createKreaFormData(
  file: File,
  selectedCheckpoint: SelectedCivitaiResourcesPreview["checkpoint"],
  action: "preview" | "store",
  choice?: Krea2ReIdPreparationChoice,
) {
  if (!selectedCheckpoint?.baseModel || !selectedCheckpoint.modelFileName) {
    throw new Error("Select a compatible local Krea 2 diffusion model before preparing ReID.");
  }
  const form = new FormData();
  form.set("action", action);
  form.set("checkpointName", selectedCheckpoint.modelFileName);
  form.set("modelBaseModel", selectedCheckpoint.baseModel);
  form.set("modelStorageKind", "diffusion");
  form.set("file", file);
  if (choice) form.set("choice", choice);
  return form;
}

async function requestKreaPreview(file: File, checkpoint: SelectedCivitaiResourcesPreview["checkpoint"]) {
  const response = await fetch("/api/agent-timeline/krea2-reid-reference", {
    method: "POST",
    body: createKreaFormData(file, checkpoint, "preview"),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok || !isRecord(payload) || !isRecord(payload.original) ||
      typeof payload.original.dataUrl !== "string" || typeof payload.warning !== "string") {
    throw new Error(getApiErrorMessage(payload, "Krea2 ReID preprocessing failed."));
  }
  return payload as PreparedPreview;
}

async function storeKreaReference(
  file: File,
  checkpoint: SelectedCivitaiResourcesPreview["checkpoint"],
  choice: Krea2ReIdPreparationChoice,
) {
  const response = await fetch("/api/agent-timeline/krea2-reid-reference", {
    method: "POST",
    body: createKreaFormData(file, checkpoint, "store", choice),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok || !isRecord(payload) || !isRecord(payload.metadata) || !isRecord(payload.preparation)) {
    throw new Error(getApiErrorMessage(payload, "Krea2 ReID reference could not be stored."));
  }
  const metadata = sanitizeStyleReferenceMetadata(payload.metadata);
  if (!metadata) throw new Error("Krea2 ReID storage returned incomplete metadata.");
  return createKrea2ReIdReferenceSnapshot({
    metadata,
    preparation: payload.preparation as Krea2ReIdPreparation,
  });
}

function NumberInput({ label, onChange, value }: { label: string; onChange: (value: number) => void; value: number }) {
  return (
    <label className="grid gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</span>
      <input className="h-8 rounded-md border border-indigo-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100" max={1} min={0} onChange={(event) => {
        const parsed = Number(event.target.value);
        if (Number.isFinite(parsed)) onChange(parsed);
      }} step={0.01} type="number" value={value} />
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
  const [error, setError] = useState("");
  const [pendingFile, setPendingFile] = useState<File>();
  const [prepared, setPrepared] = useState<PreparedPreview>();
  const [choice, setChoice] = useState<Krea2ReIdPreparationChoice>();
  const [consented, setConsented] = useState(false);
  const isKrea2 = promptProfile === "krea2";
  const normalized = sanitizeCharacterReferenceSnapshot(snapshot);
  const reIdReady = isKrea2ReIdReferenceReady(normalized);

  useEffect(() => {
    if (!prepared) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [prepared]);

  function closePreparation() {
    setPrepared(undefined);
    setPendingFile(undefined);
    setConsented(false);
    setChoice(undefined);
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      const message = "Run character reference must be a PNG, JPEG, or WEBP image.";
      setError(message);
      if (!isKrea2) {
        onChange({
          error: message,
          status: "failed",
          strength: normalized?.strength ?? CHARACTER_REFERENCE_DEFAULT_STRENGTH,
        });
      }
      return;
    }
    setBusy(true);
    setError("");
    if (!isKrea2) {
      onChange({
        status: "pending",
        strength: normalized?.strength ?? CHARACTER_REFERENCE_DEFAULT_STRENGTH,
      });
    }
    try {
      if (isKrea2) {
        const preview = await requestKreaPreview(file, selectedCheckpoint);
        setPendingFile(file);
        setPrepared(preview);
        setChoice(preview.crop ? undefined : "original");
      } else {
        const fileInfo = { byteLength: file.size, contentType: file.type, name: file.name };
        const metadata = await uploadGenericReference(await readFileAsDataUrl(file), fileInfo);
        onChange(createCharacterReferenceSnapshot({
          metadata,
          strength: normalized?.strength ?? CHARACTER_REFERENCE_DEFAULT_STRENGTH,
        }));
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Character reference upload failed.";
      setError(message);
      if (!isKrea2) {
        onChange({
          error: message,
          status: "failed",
          strength: normalized?.strength ?? CHARACTER_REFERENCE_DEFAULT_STRENGTH,
        });
      }
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function confirmKreaReference() {
    if (!pendingFile || !prepared || !choice || !consented) return;
    setBusy(true);
    setError("");
    try {
      onChange(await storeKreaReference(pendingFile, selectedCheckpoint, choice));
      closePreparation();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Krea2 ReID reference could not be stored.");
    } finally {
      setBusy(false);
    }
  }

  const modal = prepared && pendingFile ? (
    <div aria-modal="true" className="fixed inset-0 z-[100] grid place-items-center overflow-hidden bg-slate-950/65 p-4" role="dialog">
      <div className="max-h-[calc(100dvh-2rem)] w-full max-w-4xl overflow-y-auto rounded-xl bg-white p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Choose the prepared Krea2 ReID image</h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">Only the selected prepared PNG is stored. The raw upload and alternate preview remain transient.</p>
          </div>
          <button aria-label="Close ReID preparation" className="rounded-md p-1 text-slate-500 hover:bg-slate-100" disabled={busy} onClick={closePreparation} type="button"><X className="size-4" /></button>
        </div>
        <p className={`mt-4 rounded-md border p-3 text-xs ${prepared.faceDetected ? "border-indigo-200 bg-indigo-50 text-indigo-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}>{prepared.warning}</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {prepared.crop ? (
            <label className={`cursor-pointer rounded-lg border p-3 ${choice === "crop" ? "border-indigo-500 ring-2 ring-indigo-100" : "border-slate-200"}`}>
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-800"><input checked={choice === "crop"} name="reid-choice" onChange={() => setChoice("crop")} type="radio" /> Upstream head/shoulders crop</div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt="Prepared ReID head and shoulders crop" className="mt-3 max-h-72 w-full rounded-md bg-slate-100 object-contain" src={prepared.crop.dataUrl} />
              <p className="mt-2 text-[11px] text-slate-500">{prepared.crop.width} × {prepared.crop.height}</p>
            </label>
          ) : null}
          <label className={`cursor-pointer rounded-lg border p-3 ${choice === "original" ? "border-indigo-500 ring-2 ring-indigo-100" : "border-slate-200"}`}>
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-800"><input checked={choice === "original"} name="reid-choice" onChange={() => setChoice("original")} type="radio" /> Normalized original</div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt="Prepared ReID normalized original" className="mt-3 max-h-72 w-full rounded-md bg-slate-100 object-contain" src={prepared.original.dataUrl} />
            <p className="mt-2 text-[11px] text-slate-500">{prepared.original.width} × {prepared.original.height}</p>
          </label>
        </div>
        <label className="mt-4 flex items-start gap-2 rounded-md border border-slate-200 p-3 text-xs leading-relaxed text-slate-700">
          <input checked={consented} className="mt-0.5" onChange={(event) => setConsented(event.target.checked)} type="checkbox" />
          <span>I have the subject&apos;s consent or another lawful right to use this identity reference. I understand this experimental local workflow can reproduce identity traits.</span>
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button className="h-9 rounded-md border border-slate-200 px-4 text-xs text-slate-700" disabled={busy} onClick={closePreparation} type="button">Cancel</button>
          <button className="inline-flex h-9 items-center gap-2 rounded-md bg-indigo-600 px-4 text-xs font-semibold text-white disabled:opacity-50" disabled={busy || !choice || !consented} onClick={() => void confirmKreaReference()} type="button">{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : null} Use selected image</button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      <section className="mt-3 rounded-md border border-indigo-100 bg-white p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">{isKrea2 ? "Krea2 ReID" : "Character reference"}</h3>
            <p className="mt-1 text-xs text-slate-500">{isKrea2 ? "Experimental identity conditioning for Run Preview and Final only." : "Optional identity image for every Run Preview and Final. It remains separate from img2img and global style."}</p>
          </div>
          <div className="flex gap-2">
            <label className="relative inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border border-indigo-200 px-3 text-xs font-medium text-indigo-700 hover:bg-indigo-50">
              {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <ImageIcon className="size-3.5" />}
              {normalized ? "Replace" : "Upload"}
              <input accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={disabled || busy} onChange={(event) => void handleFile(event.target.files?.[0])} ref={inputRef} type="file" />
            </label>
            {normalized ? <button className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-200 px-3 text-xs text-slate-700 hover:bg-slate-50" disabled={disabled || busy} onClick={() => { setError(""); onChange(undefined); }} type="button"><X className="size-3.5" /> Remove</button> : null}
          </div>
        </div>
        {isKrea2 ? (
          <div className="mt-3 rounded-md border border-indigo-100 bg-indigo-50/40 p-3 text-xs leading-relaxed text-slate-600">
            {!reIdReady ? (
              <div className="mb-3">
                <NumberInput label="Krea style-image strength" onChange={onKreaReferenceStrengthChange} value={kreaReferenceStrength} />
              </div>
            ) : null}
            ReID is fixed at LoRA strength 1.0, 8 steps, CFG 1, Euler/simple, and one prepared image. While active it pauses—but does not delete—the Krea style-image adapter; the analyzed style prompt remains in the prompt exactly once.
            <p className="mt-2 text-amber-800">Local graph validation does not certify upstream compatibility. Community Krea weights, including FP8 variants, may fail or produce different results.</p>
          </div>
        ) : normalized?.status === "ready" ? (
          <div className="mt-3 rounded-md border border-indigo-100 bg-indigo-50/40 p-3"><NumberInput label="Character strength" onChange={(strength) => onChange({ ...normalized, strength })} value={normalized.strength} /></div>
        ) : null}
        {busy && !prepared ? <p className="mt-3 text-xs text-indigo-700">Preparing character reference...</p> : null}
        {reIdReady ? <p className="mt-3 text-xs text-emerald-700">Prepared {normalized.reIdPreparation.choice} is ready for Krea2 ReID.</p> : null}
        {!isKrea2 && normalized?.status === "ready" ? <p className="mt-3 text-xs text-emerald-700">{normalized.metadata?.filename ?? "Character reference"} is ready for identity conditioning.</p> : null}
        {styleReference?.mode === "ipadapter" && reIdReady ? <p className="mt-2 text-xs text-indigo-700">Krea style-image conditioning is paused until ReID is removed.</p> : null}
        {error ? <p className="mt-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{error}</p> : null}
        {normalized && normalized.status !== "ready" && !busy ? <p className="mt-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{normalized.error ?? "Character reference is not ready."}</p> : null}
      </section>
      {typeof document !== "undefined" && modal ? createPortal(modal, document.body) : null}
    </>
  );
}
