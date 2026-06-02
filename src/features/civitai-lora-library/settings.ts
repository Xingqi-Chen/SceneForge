import type { CivitaiLibrarySettings } from "./types";

export type CivitaiLibrarySettingsPathKey = keyof CivitaiLibrarySettings;

export const DEFAULT_CIVITAI_LIBRARY_SETTINGS: CivitaiLibrarySettings = {
  loraDownloadPath: "",
  checkpointDownloadPath: "",
  diffusionModelPath: "",
  controlNetModelPath: "",
};

export const CIVITAI_LIBRARY_SETTINGS_PATH_LABELS: Record<CivitaiLibrarySettingsPathKey, string> = {
  loraDownloadPath: "LoRA download path",
  checkpointDownloadPath: "Checkpoint download path",
  diffusionModelPath: "Diffusion model path",
  controlNetModelPath: "ControlNet model path",
};

const CIVITAI_LIBRARY_SETTINGS_PATH_KEYS = Object.keys(
  CIVITAI_LIBRARY_SETTINGS_PATH_LABELS,
) as CivitaiLibrarySettingsPathKey[];

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function sanitizeCivitaiLibrarySettingsPayload(payload: unknown): CivitaiLibrarySettings {
  if (!payload || typeof payload !== "object") {
    return { ...DEFAULT_CIVITAI_LIBRARY_SETTINGS };
  }

  const record = payload as Record<string, unknown>;
  return {
    loraDownloadPath: readTrimmedString(record.loraDownloadPath),
    checkpointDownloadPath: readTrimmedString(record.checkpointDownloadPath),
    diffusionModelPath: readTrimmedString(record.diffusionModelPath),
    controlNetModelPath: readTrimmedString(record.controlNetModelPath),
  };
}

function isLocalAbsolutePath(value: string): boolean {
  return (
    value.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    /^\\\\[^\\]+\\[^\\]+/.test(value) ||
    /^\/\/[^/]+\/[^/]+/.test(value)
  );
}

function hasParentTraversal(value: string): boolean {
  return value.split(/[\\/]+/).some((part) => part === "..");
}

function hasInvalidWindowsPathCharacters(value: string): boolean {
  const withoutDrivePrefix = /^[A-Za-z]:/.test(value) ? value.slice(2) : value;
  return /[<>:"|?*]/.test(withoutDrivePrefix);
}

export function validateCivitaiLibrarySettingsPath(
  key: CivitaiLibrarySettingsPathKey,
  value: string,
): string | null {
  const label = CIVITAI_LIBRARY_SETTINGS_PATH_LABELS[key];

  if (value.length === 0) {
    return null;
  }

  if (value.length > 1024) {
    return `${label} must be 1024 characters or fewer.`;
  }

  if (/[\u0000-\u001f\u007f]/.test(value)) {
    return `${label} cannot contain control characters.`;
  }

  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value)) {
    return `${label} must be a local filesystem path, not a URL.`;
  }

  if (!isLocalAbsolutePath(value)) {
    return `${label} must be an absolute local path, such as D:/ComfyUI/models or /mnt/models.`;
  }

  if (hasParentTraversal(value)) {
    return `${label} cannot contain parent directory segments (..).`;
  }

  if ((value.includes("\\") || /^[A-Za-z]:/.test(value) || /^\\\\/.test(value)) && hasInvalidWindowsPathCharacters(value)) {
    return `${label} contains characters that are not valid in a Windows path.`;
  }

  return null;
}

export type CivitaiLibrarySettingsValidationResult =
  | {
      ok: true;
      settings: CivitaiLibrarySettings;
    }
  | {
      ok: false;
      settings: CivitaiLibrarySettings;
      errors: Partial<Record<CivitaiLibrarySettingsPathKey, string>>;
    };

export function validateCivitaiLibrarySettingsPayload(payload: unknown): CivitaiLibrarySettingsValidationResult {
  const settings = sanitizeCivitaiLibrarySettingsPayload(payload);
  const errors: Partial<Record<CivitaiLibrarySettingsPathKey, string>> = {};
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};

  for (const key of CIVITAI_LIBRARY_SETTINGS_PATH_KEYS) {
    if (key in record && typeof record[key] !== "string") {
      errors[key] = `${CIVITAI_LIBRARY_SETTINGS_PATH_LABELS[key]} must be a string path.`;
      continue;
    }

    const error = validateCivitaiLibrarySettingsPath(key, settings[key]);
    if (error) {
      errors[key] = error;
    }
  }

  return Object.keys(errors).length > 0
    ? { ok: false, settings, errors }
    : { ok: true, settings };
}
