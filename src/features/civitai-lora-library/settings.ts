import type { CivitaiLibrarySettings } from "./types";

export const DEFAULT_CIVITAI_LIBRARY_SETTINGS: CivitaiLibrarySettings = {
  loraDownloadPath: "",
  checkpointDownloadPath: "",
  diffusionModelPath: "",
  controlNetModelPath: "",
};

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
