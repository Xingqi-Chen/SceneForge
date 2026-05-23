import type { ComfyUiViewImageReference } from "./types";

export type ComfyUiWebSocketMessage = {
  type: string;
  data?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function buildComfyUiWebSocketUrl(baseUrl: string, clientId: string) {
  const url = new URL(baseUrl.trim().replace(/\/+$/, ""));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/ws`;
  url.searchParams.set("clientId", clientId);
  return url.toString();
}

export function parseComfyUiWebSocketMessage(value: unknown): ComfyUiWebSocketMessage | null {
  if (typeof value !== "string") {
    return null;
  }

  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed) || typeof parsed.type !== "string") {
    return null;
  }

  return {
    type: parsed.type,
    data: parsed.data,
  };
}

export function getComfyUiWebSocketPromptId(message: ComfyUiWebSocketMessage) {
  return isRecord(message.data) && typeof message.data.prompt_id === "string" ? message.data.prompt_id : null;
}

export function extractComfyUiExecutedImages(message: ComfyUiWebSocketMessage): Array<ComfyUiViewImageReference & { nodeId: string }> {
  if (message.type !== "executed" || !isRecord(message.data)) {
    return [];
  }

  const nodeId = typeof message.data.node === "string" ? message.data.node : null;
  const output = isRecord(message.data.output) ? message.data.output : null;
  if (!nodeId || !output || !Array.isArray(output.images)) {
    return [];
  }

  return output.images.flatMap((image) => {
    if (!isRecord(image) || typeof image.filename !== "string" || !image.filename.trim()) {
      return [];
    }

    return [
      {
        nodeId,
        filename: image.filename,
        subfolder: typeof image.subfolder === "string" ? image.subfolder : undefined,
        type: typeof image.type === "string" ? image.type : undefined,
      },
    ];
  });
}
