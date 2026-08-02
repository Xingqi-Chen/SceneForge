import { NextResponse } from "next/server";

import { preflightKrea2ReferenceCapability } from "@/features/comfyui/krea2-reference-capability.server";
import { storeSequenceReferenceBytes } from "@/features/comfyui/sequence-reference-storage";
import {
  choosePreparedKrea2ReIdImage,
  detectKrea2ReIdImageContentType,
  KREA2_REID_DETECTOR_SHA256,
  KREA2_REID_MAX_UPLOAD_BYTES,
  prepareKrea2ReIdImage,
} from "@/features/agent-timeline/krea2-reid-preprocess.server";

export const runtime = "nodejs";

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const NO_STORE_HEADERS = { "cache-control": "no-store, max-age=0" };
const MAX_MULTIPART_BODY_BYTES = KREA2_REID_MAX_UPLOAD_BYTES + 256 * 1024;
const BASE_MULTIPART_FIELDS = ["action", "checkpointName", "modelBaseModel", "modelStorageKind", "file"] as const;
const REQUIRED_TEXT_FIELDS = ["action", "checkpointName", "modelBaseModel", "modelStorageKind"] as const;

class MultipartBodyTooLargeError extends Error {}

function textField(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { headers: NO_STORE_HEADERS, status });
}

async function readBoundedMultipartBody(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(contentType) || !/boundary=(?:"[^"]+"|[^;\s]+)/i.test(contentType)) {
    throw new Error("multipart-content-type-invalid");
  }
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const parsedLength = Number(contentLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 1) throw new Error("multipart-length-invalid");
    if (parsedLength > MAX_MULTIPART_BODY_BYTES) throw new MultipartBodyTooLargeError();
  }
  if (!request.body) throw new Error("multipart-body-missing");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_MULTIPART_BODY_BYTES) throw new MultipartBodyTooLargeError();
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { body, contentType };
}

function getMultipartPartsIssue(form: FormData, action: string) {
  const entries = Array.from(form.entries());
  const allowedFields = new Set<string>([
    ...BASE_MULTIPART_FIELDS,
    ...(action === "store" ? ["choice"] : []),
  ]);
  if (entries.some(([name, value]) =>
    !allowedFields.has(name) || name === "file" && !(value instanceof File) ||
    name !== "file" && typeof value !== "string")) {
    return "Krea2 ReID multipart data contained an unsupported part.";
  }
  for (const name of REQUIRED_TEXT_FIELDS) {
    if (form.getAll(name).length !== 1) return `Krea2 ReID multipart field ${name} must appear exactly once.`;
  }
  if (form.getAll("file").length > 1) return "Krea2 ReID multipart field file must not appear more than once.";
  if (action === "store" ? form.getAll("choice").length !== 1 : form.has("choice")) {
    return "Krea2 ReID multipart choice did not match the requested action.";
  }
  return "";
}

export async function POST(request: Request) {
  let form: FormData;
  try {
    const { body, contentType } = await readBoundedMultipartBody(request);
    form = await new Request(request.url, {
      body,
      headers: { "content-type": contentType },
      method: "POST",
    }).formData();
  } catch (error) {
    if (error instanceof MultipartBodyTooLargeError) {
      return json({ error: { message: "Krea2 ReID multipart upload is too large." } }, 413);
    }
    return json({ error: { message: "Krea2 ReID preprocessing requires multipart form data." } }, 400);
  }

  const action = textField(form, "action");
  const partsIssue = getMultipartPartsIssue(form, action);
  if (partsIssue) return json({ error: { message: partsIssue } }, 400);
  const checkpointName = textField(form, "checkpointName");
  const modelBaseModel = textField(form, "modelBaseModel");
  if ((action !== "preview" && action !== "store") || !checkpointName || !modelBaseModel ||
      checkpointName.length > 512 || modelBaseModel.length > 128 ||
      textField(form, "modelStorageKind") !== "diffusion") {
    return json({ error: { message: "Select a ready Krea 2 diffusion model before preparing ReID." } }, 400);
  }

  const file = form.get("file");
  if (!(file instanceof File) || !IMAGE_TYPES.has(file.type) || file.size < 1 ||
      file.size > KREA2_REID_MAX_UPLOAD_BYTES) {
    return json({ error: { message: "Choose a PNG, JPEG, or WEBP image no larger than 24 MB." } }, 415);
  }
  const sourceBytes = new Uint8Array(await file.arrayBuffer());
  if (detectKrea2ReIdImageContentType(sourceBytes) !== file.type) {
    return json({ error: { message: "Uploaded image content must match its PNG, JPEG, or WEBP media type." } }, 415);
  }

  try {
    const capability = await preflightKrea2ReferenceCapability({
      checkpointName,
      mode: "reid",
      modelBaseModel,
    });
    if (!capability.available) {
      return json({ error: { message: capability.reason } }, 409);
    }
  } catch {
    return json({ error: { message: "Local Krea2 ReID preflight is unavailable. No reference was stored." } }, 503);
  }

  try {
    const prepared = await prepareKrea2ReIdImage(sourceBytes);
    if (action === "preview") {
      return json({
        faceDetected: prepared.faceDetected,
        warning: prepared.warning,
        original: {
          dataUrl: `data:image/png;base64,${prepared.original.bytes.toString("base64")}`,
          height: prepared.original.height,
          width: prepared.original.width,
        },
        ...(prepared.crop
          ? {
              crop: {
                dataUrl: `data:image/png;base64,${prepared.crop.bytes.toString("base64")}`,
                height: prepared.crop.height,
                width: prepared.crop.width,
              },
            }
          : {}),
      });
    }

    const choice = textField(form, "choice");
    if (choice !== "crop" && choice !== "original") {
      return json({ error: { message: "Choose the detected crop or normalized original before storing ReID." } }, 400);
    }
    const selected = choosePreparedKrea2ReIdImage(prepared, choice);
    const stored = await storeSequenceReferenceBytes(selected.bytes, "image/png");
    return json({
      metadata: {
        byteLength: stored.byteLength,
        contentType: stored.contentType,
        storedFilename: stored.filename,
        uploadedAt: new Date().toISOString(),
      },
      preparation: {
        choice,
        detector: "yunet-2023mar-int8",
        detectorSha256: KREA2_REID_DETECTOR_SHA256,
        faceDetected: prepared.faceDetected,
        height: selected.height,
        version: 1,
        width: selected.width,
      },
    });
  } catch (error) {
    const message = error instanceof Error &&
      (error.message.startsWith("Krea2 ReID reference") || error.message.startsWith("A detected-face crop"))
      ? error.message
      : "Krea2 ReID preprocessing failed. No reference was stored.";
    return json({ error: { message } }, 422);
  }
}
