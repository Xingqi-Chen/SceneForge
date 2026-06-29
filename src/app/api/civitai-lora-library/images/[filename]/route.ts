import { createCivitaiCachedImageResponse } from "../image-response";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ filename: string }> }) {
  const { filename } = await context.params;
  return createCivitaiCachedImageResponse(filename);
}
