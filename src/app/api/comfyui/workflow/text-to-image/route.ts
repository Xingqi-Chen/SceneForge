import { NextResponse } from "next/server";

import { buildBasicTextToImageWorkflow, validateComfyUiTextToImageRequest } from "@/features/comfyui";

export const runtime = "nodejs";

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

export async function POST(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return errorResponse("Request body must be valid JSON.", 400);
  }

  const validation = validateComfyUiTextToImageRequest(payload);
  if (!validation.ok) {
    return errorResponse(validation.message, 400, validation.details);
  }

  const workflow = buildBasicTextToImageWorkflow(validation.request);

  return NextResponse.json({
    workflow: workflow.workflow,
    nodeIds: workflow.nodeIds,
    outputNodeId: workflow.outputNodeId,
    request: workflow.request,
  });
}
