import { handleLlmResponsesRequest } from "@/features/llm/responses-handler.server";

export { resolveDefaultModel, resolveRequestModel } from "@/features/llm/model-routing.server";

export const runtime = "nodejs";

/** Compatibility route; all generation uses the shared Responses handler. */
export async function POST(request: Request) {
  return handleLlmResponsesRequest(request, "/api/llm/chat");
}
