import { NextResponse } from "next/server";

export const runtime = "nodejs";

const DEFAULT_COMFYUI_BASE_URL = "http://127.0.0.1:8188";

function errorResponse(message: string, status: number, details?: unknown) {
  return NextResponse.json(
    {
      error: {
        message,
        details,
      },
    },
    { status },
  );
}

function getComfyUiBaseUrl() {
  return (process.env.COMFYUI_BASE_URL ?? DEFAULT_COMFYUI_BASE_URL).trim().replace(/\/+$/, "");
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const filename = params.get("filename")?.trim();

  if (!filename) {
    return errorResponse("filename is required.", 400);
  }

  const viewUrl = new URL(`${getComfyUiBaseUrl()}/view`);
  viewUrl.searchParams.set("filename", filename);

  for (const key of ["subfolder", "type"] as const) {
    const value = params.get(key);
    if (value !== null) {
      viewUrl.searchParams.set(key, value);
    }
  }

  try {
    const response = await fetch(viewUrl, {
      cache: "no-store",
      headers: {
        accept: "image/*",
        ...(process.env.COMFYUI_API_KEY ? { authorization: `Bearer ${process.env.COMFYUI_API_KEY}` } : {}),
      },
    });

    if (!response.ok || !response.body) {
      const details = await response.text().catch(() => null);
      return errorResponse("ComfyUI image request failed.", response.status || 502, details);
    }

    return new Response(response.body, {
      status: response.status,
      headers: {
        "cache-control": "no-store",
        expires: "0",
        pragma: "no-cache",
        "content-type": response.headers.get("content-type") ?? "application/octet-stream",
      },
    });
  } catch (error) {
    console.error("[SceneForge] [comfyui] unexpected image view failure", { error });
    return errorResponse("Unexpected ComfyUI image request failure.", 500);
  }
}
