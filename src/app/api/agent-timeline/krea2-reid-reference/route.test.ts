// @vitest-environment node

import sharp from "sharp";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  choosePreparedKrea2ReIdImage: vi.fn(),
  preflightKrea2ReferenceCapability: vi.fn(),
  prepareKrea2ReIdImage: vi.fn(),
  storeSequenceReferenceBytes: vi.fn(),
}));

vi.mock("@/features/comfyui/krea2-reference-capability.server", () => ({
  preflightKrea2ReferenceCapability: mocks.preflightKrea2ReferenceCapability,
}));

vi.mock("@/features/comfyui/sequence-reference-storage", () => ({
  storeSequenceReferenceBytes: mocks.storeSequenceReferenceBytes,
}));

vi.mock("@/features/agent-timeline/krea2-reid-preprocess.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/agent-timeline/krea2-reid-preprocess.server")>()),
  choosePreparedKrea2ReIdImage: mocks.choosePreparedKrea2ReIdImage,
  KREA2_REID_DETECTOR_SHA256: "a".repeat(64),
  prepareKrea2ReIdImage: mocks.prepareKrea2ReIdImage,
}));

import { POST } from "./route";

const cropBytes = Buffer.from("SELECTED_CROP_ONLY");
const originalBytes = Buffer.from("NORMALIZED_ORIGINAL_ONLY");
const maxUploadBytes = 24 * 1024 * 1024;
const imageBytes = new Map<string, Buffer>();

function blobPart(bytes: Uint8Array) {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

beforeAll(async () => {
  const fixture = () => sharp({
    create: { background: "#56789a", channels: 3, height: 8, width: 8 },
  });
  imageBytes.set("image/png", await fixture().png().toBuffer());
  imageBytes.set("image/jpeg", await fixture().jpeg().toBuffer());
  imageBytes.set("image/webp", await fixture().webp().toBuffer());
  imageBytes.set("image/tiff", await fixture().tiff().toBuffer());
  imageBytes.set("image/gif", await fixture().gif().toBuffer());
  imageBytes.set("image/avif", await fixture().avif().toBuffer());
});

function prepared(faceDetected = true) {
  return {
    crop: faceDetected ? { bytes: cropBytes, height: 192, width: 192 } : undefined,
    faceDetected,
    original: { bytes: originalBytes, height: 256, width: 384 },
    warning: faceDetected
      ? "Face detected. Compare choices."
      : "No face was detected at confidence 0.35.",
    rawUploadBytes: Buffer.from("RAW_SECRET"),
    detectorPath: "C:\\private\\yunet.onnx",
    tensors: [0.1, 0.2],
    temporaryComfyUiName: "transient-input.png",
  };
}

function multipartRequest({
  action = "preview",
  choice,
  contentType = "image/png",
  includeFile = true,
  modelBaseModel = "Krea 2",
  modelStorageKind = "diffusion",
  mutateForm,
  bytes,
}: {
  action?: string;
  choice?: string;
  contentType?: string;
  includeFile?: boolean;
  modelBaseModel?: string;
  modelStorageKind?: string;
  mutateForm?: (form: FormData) => void;
  bytes?: Uint8Array;
} = {}) {
  const form = new FormData();
  form.set("action", action);
  form.set("checkpointName", "RedCraft_v4_fp8_scaled.safetensors");
  form.set("modelBaseModel", modelBaseModel);
  form.set("modelStorageKind", modelStorageKind);
  if (choice) form.set("choice", choice);
  if (includeFile) {
    form.set("file", new File([blobPart(bytes ?? imageBytes.get(contentType) ?? imageBytes.get("image/png")!)], "identity.bin", {
      type: contentType,
    }));
  }
  mutateForm?.(form);
  return new Request("http://localhost/api/agent-timeline/krea2-reid-reference", {
    method: "POST",
    body: form,
  });
}

beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("Krea2 ReID multipart API", () => {
  it("rejects non-multipart, invalid actions, and incomplete authoritative context before inference", async () => {
    mocks.preflightKrea2ReferenceCapability.mockResolvedValue({ available: true, reason: "ok" });
    const nonMultipart = await POST(new Request("http://localhost/api/agent-timeline/krea2-reid-reference", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }));
    expect(nonMultipart.status).toBe(400);

    for (const request of [
      multipartRequest({ action: "delete" }),
      multipartRequest({ modelBaseModel: "" }),
      multipartRequest({ modelStorageKind: "checkpoint" }),
    ]) {
      const response = await POST(request);
      expect(response.status).toBe(400);
    }
    expect(mocks.preflightKrea2ReferenceCapability).not.toHaveBeenCalled();
    expect(mocks.prepareKrea2ReIdImage).not.toHaveBeenCalled();
  });

  it("blocks unavailable or failed ReID capability before reading or storing the image", async () => {
    mocks.preflightKrea2ReferenceCapability.mockResolvedValueOnce({ available: false, reason: "Missing ReID LoRA." });
    const unavailable = await POST(multipartRequest());
    expect(unavailable.status).toBe(409);
    await expect(unavailable.json()).resolves.toEqual({ error: { message: "Missing ReID LoRA." } });

    mocks.preflightKrea2ReferenceCapability.mockRejectedValueOnce(new Error("offline"));
    const failed = await POST(multipartRequest());
    expect(failed.status).toBe(503);
    expect(mocks.prepareKrea2ReIdImage).not.toHaveBeenCalled();
    expect(mocks.storeSequenceReferenceBytes).not.toHaveBeenCalled();
  });

  it.each(["image/png", "image/jpeg", "image/webp"])("accepts %s and returns transient bounded preview choices", async (contentType) => {
    mocks.preflightKrea2ReferenceCapability.mockResolvedValue({ available: true, reason: "ok" });
    mocks.prepareKrea2ReIdImage.mockResolvedValue(prepared());
    const response = await POST(multipartRequest({ contentType }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      faceDetected: true,
      crop: { dataUrl: expect.stringMatching(/^data:image\/png;base64,/), height: 192, width: 192 },
      original: { dataUrl: expect.stringMatching(/^data:image\/png;base64,/), height: 256, width: 384 },
    });
    expect(mocks.preflightKrea2ReferenceCapability).toHaveBeenCalledWith({
      checkpointName: "RedCraft_v4_fp8_scaled.safetensors",
      mode: "reid",
      modelBaseModel: "Krea 2",
    });
    expect(mocks.storeSequenceReferenceBytes).not.toHaveBeenCalled();
  });

  it("returns only normalized original plus a visible warning when no face is detected", async () => {
    mocks.preflightKrea2ReferenceCapability.mockResolvedValue({ available: true, reason: "ok" });
    mocks.prepareKrea2ReIdImage.mockResolvedValue(prepared(false));
    const response = await POST(multipartRequest());
    const payload = await response.json();

    expect(payload.faceDetected).toBe(false);
    expect(payload.warning).toContain("No face was detected at confidence 0.35");
    expect(payload).not.toHaveProperty("crop");
    expect(payload.original).toMatchObject({ height: 256, width: 384 });
  });

  it("rejects missing files, unsupported media, and storage without an explicit choice", async () => {
    mocks.preflightKrea2ReferenceCapability.mockResolvedValue({ available: true, reason: "ok" });
    mocks.prepareKrea2ReIdImage.mockResolvedValue(prepared());

    expect((await POST(multipartRequest({ includeFile: false }))).status).toBe(415);
    expect((await POST(multipartRequest({ contentType: "image/gif" }))).status).toBe(415);
    const noChoice = await POST(multipartRequest({ action: "store" }));
    expect(noChoice.status).toBe(400);
    expect(mocks.storeSequenceReferenceBytes).not.toHaveBeenCalled();
  });

  it("rejects declared and actual multipart bodies above the upload boundary before preflight", async () => {
    mocks.preflightKrea2ReferenceCapability.mockResolvedValue({ available: true, reason: "ok" });

    const declared = multipartRequest();
    declared.headers.set("content-length", String(maxUploadBytes * 2));
    const declaredResponse = await POST(declared);
    expect(declaredResponse.status).toBe(413);

    const oversizedForm = new FormData();
    oversizedForm.set("action", "preview");
    oversizedForm.set("checkpointName", "RedCraft_v4_fp8_scaled.safetensors");
    oversizedForm.set("modelBaseModel", "Krea 2");
    oversizedForm.set("modelStorageKind", "diffusion");
    oversizedForm.set("file", new File([blobPart(imageBytes.get("image/png")!)], "identity.png", { type: "image/png" }));
    oversizedForm.set("padding", "x".repeat(maxUploadBytes + 1024 * 1024));
    const encoded = new Request("http://localhost/upload", { method: "POST", body: oversizedForm });
    const rawBody = await encoded.arrayBuffer();
    expect(rawBody.byteLength).toBeGreaterThan(maxUploadBytes);
    const actualResponse = await POST(new Request(
      "http://localhost/api/agent-timeline/krea2-reid-reference",
      {
        method: "POST",
        headers: { "content-type": encoded.headers.get("content-type")! },
        body: rawBody,
      },
    ));
    expect(actualResponse.status).toBe(413);
    expect(mocks.preflightKrea2ReferenceCapability).not.toHaveBeenCalled();
    expect(mocks.prepareKrea2ReIdImage).not.toHaveBeenCalled();
  });

  it("rejects duplicate files, extra file parts, and unexpected fields before preflight", async () => {
    mocks.preflightKrea2ReferenceCapability.mockResolvedValue({ available: true, reason: "ok" });
    const png = imageBytes.get("image/png")!;
    const requests = [
      multipartRequest({
        mutateForm: (form) => form.append("file", new File([blobPart(png)], "second.png", { type: "image/png" })),
      }),
      multipartRequest({
        mutateForm: (form) => form.set("alternate", new File([blobPart(png)], "alternate.png", { type: "image/png" })),
      }),
      multipartRequest({ mutateForm: (form) => form.set("debug", "true") }),
    ];

    for (const request of requests) {
      expect((await POST(request)).status).toBe(400);
    }
    expect(mocks.preflightKrea2ReferenceCapability).not.toHaveBeenCalled();
    expect(mocks.prepareKrea2ReIdImage).not.toHaveBeenCalled();
  });

  it.each([
    ["TIFF", "image/tiff", "image/png"],
    ["GIF", "image/gif", "image/jpeg"],
    ["AVIF", "image/avif", "image/webp"],
  ])("rejects real %s bytes masquerading as an accepted media type", async (_label, actualType, declaredType) => {
    mocks.preflightKrea2ReferenceCapability.mockResolvedValue({ available: true, reason: "ok" });

    const response = await POST(multipartRequest({
      bytes: imageBytes.get(actualType)!,
      contentType: declaredType,
    }));

    expect(response.status).toBe(415);
    expect(mocks.prepareKrea2ReIdImage).not.toHaveBeenCalled();
    expect(mocks.storeSequenceReferenceBytes).not.toHaveBeenCalled();
  });

  it.each([
    ["crop", cropBytes, 192, 192],
    ["original", originalBytes, 384, 256],
  ] as const)("persists only the explicitly selected %s PNG and sanitized metadata", async (choice, selectedBytes, width, height) => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const nextPrepared = prepared();
    mocks.preflightKrea2ReferenceCapability.mockResolvedValue({ available: true, reason: "ok" });
    mocks.prepareKrea2ReIdImage.mockResolvedValue(nextPrepared);
    mocks.choosePreparedKrea2ReIdImage.mockImplementation((_value, selectedChoice) =>
      selectedChoice === "crop" ? nextPrepared.crop : nextPrepared.original);
    mocks.storeSequenceReferenceBytes.mockResolvedValue({
      byteLength: selectedBytes.byteLength,
      contentType: "image/png",
      filename: "0123456789abcdef0123456789abcdef.png",
    });

    const response = await POST(multipartRequest({ action: "store", choice }));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(mocks.choosePreparedKrea2ReIdImage).toHaveBeenCalledWith(nextPrepared, choice);
    expect(mocks.storeSequenceReferenceBytes).toHaveBeenCalledTimes(1);
    expect(mocks.storeSequenceReferenceBytes).toHaveBeenCalledWith(selectedBytes, "image/png");
    expect(payload).toMatchObject({
      metadata: {
        byteLength: selectedBytes.byteLength,
        contentType: "image/png",
        storedFilename: "0123456789abcdef0123456789abcdef.png",
      },
      preparation: {
        choice,
        detector: "yunet-2023mar-int8",
        detectorSha256: "a".repeat(64),
        faceDetected: true,
        height,
        version: 1,
        width,
      },
    });
    const persisted = JSON.stringify(payload);
    for (const secret of [
      "RAW_SECRET", "NORMALIZED_ORIGINAL_ONLY", "SELECTED_CROP_ONLY", "private", "yunet.onnx",
      "tensors", "transient-input", "data:image", "path",
    ]) {
      expect(persisted).not.toContain(secret);
      expect(JSON.stringify([...consoleLog.mock.calls, ...consoleWarn.mock.calls, ...consoleError.mock.calls]))
        .not.toContain(secret);
    }
  });
});
