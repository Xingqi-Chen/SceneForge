import { handleLlmResponsesRequest } from "@/features/llm/responses-handler.server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleLlmResponsesRequest(request, "/api/llm/responses");
}
