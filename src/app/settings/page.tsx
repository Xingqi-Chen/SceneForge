"use client";

import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  Database,
  EyeOff,
  FolderCog,
  Loader2,
  RefreshCw,
  Save,
  Settings,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

import type { CivitaiLibrarySettings } from "@/features/civitai-lora-library/types";
import type {
  CentralSettingsPayload,
  SettingsIntegrationStatus,
  SettingsPathStatus,
  SettingsState,
} from "@/features/settings/types";

type LoadStatus = "idle" | "loading" | "success" | "error";
type CivitaiPathKey = keyof CivitaiLibrarySettings;

const CIVITAI_PATH_FIELDS: Array<{ key: CivitaiPathKey; label: string; placeholder: string }> = [
  {
    key: "loraDownloadPath",
    label: "LoRA download path",
    placeholder: "D:/StableDiffusion/models/Lora",
  },
  {
    key: "checkpointDownloadPath",
    label: "Checkpoint download path",
    placeholder: "D:/StableDiffusion/models/Stable-diffusion",
  },
  {
    key: "diffusionModelPath",
    label: "Diffusion model path",
    placeholder: "D:/ComfyUI/models/diffusion_models",
  },
  {
    key: "controlNetModelPath",
    label: "ControlNet model path",
    placeholder: "D:/ComfyUI/models/controlnet",
  },
];

const linkClassName =
  "inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400";

const actionButtonClassName =
  "inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60";

function emptyCivitaiPaths(): CivitaiLibrarySettings {
  return {
    loraDownloadPath: "",
    checkpointDownloadPath: "",
    diffusionModelPath: "",
    controlNetModelPath: "",
  };
}

function readErrorMessage(payload: unknown, fallback: string) {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof (payload as { error?: unknown }).error === "object" &&
    (payload as { error?: { message?: unknown } }).error &&
    typeof (payload as { error: { message?: unknown } }).error.message === "string"
  ) {
    return (payload as { error: { message: string } }).error.message;
  }

  return fallback;
}

function readErrorDetails(payload: unknown): Partial<Record<CivitaiPathKey, string>> {
  if (
    !payload ||
    typeof payload !== "object" ||
    !("error" in payload) ||
    typeof (payload as { error?: unknown }).error !== "object" ||
    !(payload as { error?: unknown }).error
  ) {
    return {};
  }

  const details = (payload as { error: { details?: unknown } }).error.details;
  if (!details || typeof details !== "object") {
    return {};
  }

  const errors: Partial<Record<CivitaiPathKey, string>> = {};
  for (const field of CIVITAI_PATH_FIELDS) {
    const value = (details as Record<string, unknown>)[field.key];
    if (typeof value === "string") {
      errors[field.key] = value;
    }
  }

  return errors;
}

async function fetchSettings(init?: RequestInit): Promise<CentralSettingsPayload> {
  const response = await fetch("/api/settings", init);
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const error = new Error(readErrorMessage(payload, response.statusText || "Unable to load settings."));
    Object.assign(error, { details: readErrorDetails(payload) });
    throw error;
  }

  return payload as CentralSettingsPayload;
}

function getStatusClassName(state: SettingsState) {
  if (state === "configured") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  if (state === "degraded") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }

  if (state === "default") {
    return "border-blue-200 bg-blue-50 text-blue-700";
  }

  return "border-slate-200 bg-slate-50 text-slate-500";
}

function statusLabel(state: SettingsState) {
  if (state === "configured") {
    return "Configured";
  }
  if (state === "degraded") {
    return "Partial";
  }
  if (state === "default") {
    return "Default";
  }
  return "Missing";
}

function StatusBadge({ state }: { state: SettingsState }) {
  return (
    <span className={`inline-flex h-6 items-center rounded-md border px-2 text-[11px] font-semibold ${getStatusClassName(state)}`}>
      {statusLabel(state)}
    </span>
  );
}

function SectionHeader({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-700">
        {icon}
      </div>
      <div className="min-w-0">
        <h2 className="text-sm font-bold text-slate-900">{title}</h2>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">{description}</p>
      </div>
    </div>
  );
}

function PathRow({ pathStatus }: { pathStatus: SettingsPathStatus }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-bold text-slate-800">{pathStatus.label}</div>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{pathStatus.detail}</p>
        </div>
        <StatusBadge state={pathStatus.state} />
      </div>
      <div className="mt-3 min-h-9 rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-xs font-medium leading-relaxed text-slate-700">
        <span className="break-all">{pathStatus.value || "Not configured"}</span>
      </div>
    </div>
  );
}

function IntegrationCard({ integration }: { integration: SettingsIntegrationStatus }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900">{integration.label}</h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">{integration.detail}</p>
        </div>
        <StatusBadge state={integration.state} />
      </div>
      <dl className="mt-4 grid gap-2 text-xs">
        {integration.config.map((entry) => (
          <div className="grid gap-1 rounded-md bg-slate-50 px-3 py-2 sm:grid-cols-[10rem_1fr]" key={entry.label}>
            <dt className="font-semibold text-slate-600">{entry.label}</dt>
            <dd className="min-w-0 text-slate-700">
              {entry.redacted ? (
                <span className="inline-flex items-center gap-1.5">
                  <EyeOff className="size-3.5 text-slate-400" />
                  {entry.configured ? "Configured" : "Missing"}
                </span>
              ) : entry.value ? (
                <span className="break-all">{entry.value}</span>
              ) : (
                <span>{entry.configured ? "Configured" : "Missing"}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<CentralSettingsPayload | null>(null);
  const [draft, setDraft] = useState<CivitaiLibrarySettings>(emptyCivitaiPaths);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("idle");
  const [loadError, setLoadError] = useState("");
  const [saveStatus, setSaveStatus] = useState<LoadStatus>("idle");
  const [saveError, setSaveError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<CivitaiPathKey, string>>>({});

  const hasChanges = useMemo(() => {
    if (!settings) {
      return false;
    }

    return CIVITAI_PATH_FIELDS.some((field) => draft[field.key].trim() !== settings.civitai.paths[field.key]);
  }, [draft, settings]);

  async function loadSettings() {
    setLoadStatus("loading");
    setLoadError("");

    try {
      const payload = await fetchSettings();
      setSettings(payload);
      setDraft(payload.civitai.paths);
      setFieldErrors({});
      setLoadStatus("success");
    } catch (error) {
      setLoadStatus("error");
      setLoadError(error instanceof Error ? error.message : "Unable to load settings.");
    }
  }

  async function saveCivitaiPaths() {
    setSaveStatus("loading");
    setSaveError("");
    setFieldErrors({});

    const nextPaths = CIVITAI_PATH_FIELDS.reduce((accumulator, field) => {
      accumulator[field.key] = draft[field.key].trim();
      return accumulator;
    }, emptyCivitaiPaths());

    try {
      const payload = await fetchSettings({
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ civitai: { paths: nextPaths } }),
      });
      setSettings(payload);
      setDraft(payload.civitai.paths);
      setSaveStatus("success");
    } catch (error) {
      setSaveStatus("error");
      setSaveError(error instanceof Error ? error.message : "Unable to save Civitai paths.");
      if (error instanceof Error && "details" in error) {
        setFieldErrors((error as Error & { details?: Partial<Record<CivitaiPathKey, string>> }).details ?? {});
      }
    }
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadSettings();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, []);

  return (
    <main className="sf-app-shell flex min-h-0 flex-col overflow-hidden bg-slate-100 font-sans text-slate-950 selection:bg-blue-100 selection:text-blue-900">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 py-3 shadow-sm">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-700">
            <Settings className="size-4" />
          </div>
          <h1 className="truncate text-sm font-bold text-slate-900">Settings</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            className={actionButtonClassName}
            disabled={loadStatus === "loading" || saveStatus === "loading"}
            onClick={() => void loadSettings()}
            type="button"
          >
            {loadStatus === "loading" ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            Refresh
          </button>
          <Link className={linkClassName} href="/">
            <ArrowLeft className="size-3.5" />
            Timeline
          </Link>
        </div>
      </header>

      <section className="min-h-0 flex-1 overflow-auto p-4">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
          {loadStatus === "loading" && !settings ? (
            <div className="flex min-h-48 items-center justify-center rounded-md border border-slate-200 bg-white text-sm text-slate-500">
              <Loader2 className="mr-2 size-4 animate-spin" />
              Loading settings
            </div>
          ) : null}

          {loadStatus === "error" && !settings ? (
            <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
              <div className="flex items-center gap-2 font-semibold">
                <TriangleAlert className="size-4" />
                Settings could not be loaded
              </div>
              <p className="mt-2 text-xs leading-relaxed">{loadError}</p>
            </div>
          ) : null}

          {settings ? (
            <>
              <section className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
                <SectionHeader
                  description="Server-only flags are shown as status. Secret values and model names are not returned to the browser."
                  icon={<ShieldCheck className="size-4" />}
                  title="General"
                />
                <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-bold text-slate-800">NSFW UI mode</div>
                      <p className="mt-1 text-[11px] text-slate-500">{settings.general.nsfw.detail}</p>
                    </div>
                    <span
                      className={`inline-flex h-7 items-center rounded-md border px-2.5 text-xs font-semibold ${
                        settings.general.nsfw.enabled
                          ? "border-rose-200 bg-rose-50 text-rose-700"
                          : "border-slate-200 bg-white text-slate-600"
                      }`}
                    >
                      {settings.general.nsfw.enabled ? "Enabled" : "Disabled"}
                    </span>
                  </div>
                </div>
              </section>

              <section className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
                <SectionHeader
                  description="Environment-backed paths are read-only here. Change them in .env.local and restart the server."
                  icon={<FolderCog className="size-4" />}
                  title="Storage Paths"
                />
                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  {settings.storage.paths.map((pathStatus) => (
                    <PathRow key={pathStatus.id} pathStatus={pathStatus} />
                  ))}
                </div>
              </section>

              <section className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <SectionHeader
                    description="These resource paths are stored in SceneForge SQLite and used by Civitai downloads, local resource checks, and ControlNet model discovery."
                    icon={<Database className="size-4" />}
                    title="Civitai Resource Paths"
                  />
                  <button
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-indigo-600 px-3 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={!hasChanges || saveStatus === "loading"}
                    onClick={() => void saveCivitaiPaths()}
                    type="button"
                  >
                    {saveStatus === "loading" ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                    Save Civitai Paths
                  </button>
                </div>

                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  {CIVITAI_PATH_FIELDS.map((field) => (
                    <label className="block rounded-md border border-slate-200 bg-slate-50 p-3 text-xs font-semibold text-slate-700" key={field.key}>
                      <span>{field.label}</span>
                      <input
                        className={`mt-2 h-10 w-full rounded-md border bg-white px-3 text-sm font-normal text-slate-800 outline-none transition focus:ring-2 disabled:opacity-60 ${
                          fieldErrors[field.key]
                            ? "border-rose-300 focus:border-rose-400 focus:ring-rose-100"
                            : "border-slate-200 focus:border-indigo-400 focus:ring-indigo-100"
                        }`}
                        disabled={saveStatus === "loading"}
                        onChange={(event) => {
                          setDraft((current) => ({ ...current, [field.key]: event.target.value }));
                          setSaveStatus("idle");
                          setFieldErrors((current) => ({ ...current, [field.key]: undefined }));
                        }}
                        placeholder={field.placeholder}
                        value={draft[field.key]}
                      />
                      {fieldErrors[field.key] ? (
                        <p className="mt-2 text-[11px] leading-relaxed text-rose-600">{fieldErrors[field.key]}</p>
                      ) : null}
                    </label>
                  ))}
                </div>

                <div className="mt-4 min-h-5 text-xs">
                  {saveStatus === "success" ? (
                    <span className="inline-flex items-center gap-1.5 text-emerald-700">
                      <CheckCircle2 className="size-3.5" />
                      Civitai paths saved.
                    </span>
                  ) : null}
                  {saveStatus === "error" ? (
                    <span className="inline-flex items-center gap-1.5 text-rose-700">
                      <TriangleAlert className="size-3.5" />
                      {saveError}
                    </span>
                  ) : null}
                </div>

                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  {settings.civitai.pathStatuses.map((pathStatus) => (
                    <PathRow key={pathStatus.id} pathStatus={pathStatus} />
                  ))}
                </div>
              </section>

              <section className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
                <SectionHeader
                  description="Integration checks are configuration snapshots only. SceneForge does not call external services from this page."
                  icon={<CheckCircle2 className="size-4" />}
                  title="Integration Status"
                />
                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  {settings.integrations.map((integration) => (
                    <IntegrationCard integration={integration} key={integration.id} />
                  ))}
                </div>
              </section>
            </>
          ) : null}
        </div>
      </section>
    </main>
  );
}
