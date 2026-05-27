import {
  buildComfyUiWebSocketUrl,
  ComfyUiApiError,
  createComfyUiClient,
  extractComfyUiHistoryImages,
  getComfyUiWebSocketPromptId,
  isComfyUiPromptHistoryComplete,
  parseComfyUiWebSocketMessage,
  type ComfyUiGeneratedImage,
  type ComfyUiPromptHistoryResponse,
} from "@/features/comfyui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_COMFYUI_BASE_URL = "http://127.0.0.1:8188";
const COMFYUI_EVENT_TIMEOUT_MS = 60 * 60 * 1000;
const COMFYUI_EVENT_HEARTBEAT_MS = 15000;
const COMFYUI_HISTORY_RETRY_INTERVAL_MS = 500;

function getComfyUiBaseUrl() {
  return process.env.COMFYUI_BASE_URL ?? DEFAULT_COMFYUI_BASE_URL;
}

function buildViewProxyUrl(image: { filename: string; subfolder?: string; type?: string }, promptId: string) {
  const params = new URLSearchParams();
  params.set("filename", image.filename);
  params.set("promptId", promptId);

  if (image.subfolder !== undefined) {
    params.set("subfolder", image.subfolder);
  }

  if (image.type !== undefined) {
    params.set("type", image.type);
  }

  return `/api/comfyui/view?${params.toString()}`;
}

function toGeneratedImages(
  images: Array<{ nodeId: string; filename: string; subfolder?: string; type?: string }>,
  promptId: string,
): ComfyUiGeneratedImage[] {
  return images.map((image) => ({
    ...image,
    url: buildViewProxyUrl(image, promptId),
  }));
}

function sse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function sseComment(comment: string) {
  return `: ${comment}\n\n`;
}

function errorPayload(error: unknown) {
  if (error instanceof ComfyUiApiError) {
    return {
      message: error.message,
      statusCode: error.statusCode,
      details: error.details,
    };
  }

  return {
    message: error instanceof Error ? error.message : "Unexpected ComfyUI websocket listener failure.",
  };
}

export async function GET(request: Request, context: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await context.params;
  const normalizedClientId = clientId.trim();
  const params = new URL(request.url).searchParams;
  const promptId = params.get("promptId")?.trim() ?? "";
  const expectedImages = Math.max(1, Number(params.get("expectedImages") ?? 1) || 1);

  if (!normalizedClientId) {
    return new Response(sse("comfyui-error", { message: "clientId is required." }), {
      headers: { "content-type": "text/event-stream" },
      status: 400,
    });
  }

  if (!promptId) {
    return new Response(sse("comfyui-error", { message: "promptId is required." }), {
      headers: { "content-type": "text/event-stream" },
      status: 400,
    });
  }

  const client = createComfyUiClient({
    baseUrl: getComfyUiBaseUrl(),
    apiKey: process.env.COMFYUI_API_KEY || undefined,
  });
  const websocketUrl = buildComfyUiWebSocketUrl(getComfyUiBaseUrl(), normalizedClientId);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let waitingForFinalHistory = false;
      let websocket: WebSocket | null = null;
      let timeout: ReturnType<typeof setTimeout> | null = null;
      let heartbeat: ReturnType<typeof setInterval> | null = null;

      const send = (event: string, data: unknown) => {
        if (!closed) {
          controller.enqueue(encoder.encode(sse(event, data)));
        }
      };

      const sendComment = (comment: string) => {
        if (!closed) {
          controller.enqueue(encoder.encode(sseComment(comment)));
        }
      };

      const cleanup = () => {
        if (timeout) {
          clearTimeout(timeout);
          timeout = null;
        }

        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }

        if (websocket && websocket.readyState < WebSocket.CLOSING) {
          websocket.close();
        }
      };

      const close = () => {
        if (closed) {
          return;
        }

        closed = true;
        cleanup();
        controller.close();
      };

      const fail = (error: unknown, options?: { retryable?: boolean }) => {
        send("comfyui-error", {
          ...errorPayload(error),
          retryable: options?.retryable ?? false,
        });
        close();
      };

      const readCompleteHistory = async () => {
        const raw = await client.getHistory(promptId);
        if (!isComfyUiPromptHistoryComplete(raw, promptId)) {
          return null;
        }

        const images = toGeneratedImages(extractComfyUiHistoryImages(raw, promptId), promptId);
        if (images.length < expectedImages) {
          return null;
        }

        return {
          images,
          raw,
        };
      };

      const completeFromHistory = async () => {
        const complete = await readCompleteHistory();
        if (!complete) {
          return false;
        }

        const payload: ComfyUiPromptHistoryResponse = {
          promptId,
          completed: true,
          images: complete.images,
          raw: complete.raw,
        };
        send("complete", payload);
        close();
        return true;
      };

      const waitForFinalHistory = async () => {
        if (waitingForFinalHistory) {
          return;
        }

        waitingForFinalHistory = true;
        while (!closed) {
          if (await completeFromHistory()) {
            return;
          }

          await new Promise((resolve) => setTimeout(resolve, COMFYUI_HISTORY_RETRY_INTERVAL_MS));
        }
      };

      heartbeat = setInterval(() => {
        sendComment("heartbeat");
      }, COMFYUI_EVENT_HEARTBEAT_MS);

      timeout = setTimeout(() => {
        send("listener-timeout", {
          message: "Timed out waiting for ComfyUI websocket completion; falling back to history polling.",
        });
        close();
      }, COMFYUI_EVENT_TIMEOUT_MS);

      request.signal.addEventListener("abort", close, { once: true });

      try {
        websocket = new WebSocket(websocketUrl);
      } catch (error) {
        fail(error);
        return;
      }

      websocket.addEventListener("open", () => {
        send("connected", { clientId: normalizedClientId, promptId });
        void completeFromHistory().catch(fail);
      });

      websocket.addEventListener("message", (event) => {
        let message;
        try {
          message = parseComfyUiWebSocketMessage(event.data);
        } catch {
          return;
        }

        if (!message) {
          return;
        }

        const messagePromptId = getComfyUiWebSocketPromptId(message);
        if (messagePromptId && messagePromptId !== promptId) {
          return;
        }

        if (message.type === "progress" || message.type === "executing") {
          send(message.type, message.data ?? {});
          if (
            message.type === "executing" &&
            message.data &&
            typeof message.data === "object" &&
            !Array.isArray(message.data) &&
            (message.data as { node?: unknown }).node === null
          ) {
            void waitForFinalHistory().catch(fail);
          }
          return;
        }

        if (message.type === "execution_error") {
          fail(message.data ?? new Error("ComfyUI execution failed."));
          return;
        }

        if (message.type === "executed") {
          void completeFromHistory().catch(fail);
          return;
        }

        if (message.type === "execution_success") {
          void waitForFinalHistory().catch(fail);
        }
      });

      websocket.addEventListener("error", () => {
        fail(new Error("ComfyUI websocket connection failed."), { retryable: true });
      });

      websocket.addEventListener("close", () => {
        if (!closed && !waitingForFinalHistory) {
          fail(new Error("ComfyUI websocket connection closed before generation completed."), { retryable: true });
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "content-type": "text/event-stream",
    },
  });
}
