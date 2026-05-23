import type { ComfyUiViewImageReference } from "./types";

export type ComfyUiHistoryImageReference = ComfyUiViewImageReference & {
  nodeId: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readHistoryEntry(history: unknown, promptId: string): Record<string, unknown> | null {
  if (!isRecord(history)) {
    return null;
  }

  const entry = history[promptId];
  return isRecord(entry) ? entry : null;
}

export function extractComfyUiHistoryImages(history: unknown, promptId: string): ComfyUiHistoryImageReference[] {
  const entry = readHistoryEntry(history, promptId);
  const outputs = isRecord(entry?.outputs) ? entry.outputs : null;

  if (!outputs) {
    return [];
  }

  const images: ComfyUiHistoryImageReference[] = [];
  for (const [nodeId, output] of Object.entries(outputs)) {
    if (!isRecord(output) || !Array.isArray(output.images)) {
      continue;
    }

    for (const image of output.images) {
      if (!isRecord(image) || typeof image.filename !== "string" || !image.filename.trim()) {
        continue;
      }

      images.push({
        nodeId,
        filename: image.filename,
        subfolder: typeof image.subfolder === "string" ? image.subfolder : undefined,
        type: typeof image.type === "string" ? image.type : undefined,
      });
    }
  }

  return images;
}

export function isComfyUiPromptHistoryComplete(history: unknown, promptId: string) {
  const entry = readHistoryEntry(history, promptId);
  return Boolean(entry && isRecord(entry.outputs));
}
