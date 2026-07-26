import { describe, expect, it } from "vitest";

import { parseComfyUiImageDataUrl } from "./image-data-url";
import { parseComfyUiSourceImageDataUrl } from "./source-image-upload";
import { validateComfyUiTextToImageRequest } from "./validation";

const baseRequest = {
  checkpointName: "local.safetensors",
  positivePrompt: "a local parser regression",
};

function validateSourceImageDataUrl(sourceImageDataUrl: string) {
  return validateComfyUiTextToImageRequest({
    ...baseRequest,
    sourceImageDataUrl,
  });
}

describe("ComfyUI image data URL parsing", () => {
  it("parses and validates a stack-safe 4.6 MB Base64 PNG payload", () => {
    const pngBytes = Buffer.alloc(3_450_000);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(pngBytes);
    const base64 = pngBytes.toString("base64");
    const dataUrl = `data:image/png;base64,${base64}`;

    expect(base64).toHaveLength(4_600_000);
    expect(parseComfyUiImageDataUrl(dataUrl)).toEqual({
      base64,
      mimeSubtype: "png",
    });
    const uploadParsed = parseComfyUiSourceImageDataUrl(dataUrl);
    expect(uploadParsed).toMatchObject({
      extension: "png",
      mimeType: "image/png",
    });
    expect(uploadParsed.bytes).toHaveLength(pngBytes.byteLength);
    expect(uploadParsed.bytes.subarray(0, 8)).toEqual(pngBytes.subarray(0, 8));
    expect(validateSourceImageDataUrl(dataUrl)).toMatchObject({ ok: true });
  });

  it.each([
    ["png", "png", "image/png"],
    ["jpg", "jpg", "image/jpeg"],
    ["jpeg", "jpg", "image/jpeg"],
    ["webp", "webp", "image/webp"],
  ] as const)("keeps the shared parser and source-upload parser equivalent for image/%s", (
    mimeSubtype,
    extension,
    mimeType,
  ) => {
    const bytes = Buffer.from([0, 1, 2, 253, 254, 255]);
    const base64 = bytes.toString("base64");
    const dataUrl = `data:image/${mimeSubtype};base64,${base64}`;

    expect(parseComfyUiImageDataUrl(dataUrl)).toEqual({ base64, mimeSubtype });
    expect(parseComfyUiSourceImageDataUrl(dataUrl)).toEqual({
      bytes,
      extension,
      mimeType,
    });
    expect(validateSourceImageDataUrl(dataUrl)).toMatchObject({ ok: true });
  });

  it("rejects an invalid Base64 character near the end of a multi-megabyte payload", () => {
    const base64 = "A".repeat(4_600_000);
    const invalidDataUrl = `data:image/png;base64,${base64.slice(0, -2)}!A`;

    expect(parseComfyUiImageDataUrl(invalidDataUrl)).toBeNull();
    expect(() => parseComfyUiSourceImageDataUrl(invalidDataUrl)).toThrow(
      "sourceImageDataUrl must be a PNG, JPEG, or WEBP data URL.",
    );
    expect(validateSourceImageDataUrl(invalidDataUrl)).toMatchObject({ ok: false });
  });

  it.each([
    ["empty PNG payload", "data:image/png;base64,"],
    ["unsupported GIF MIME", "data:image/gif;base64,AAAA"],
    ["unsupported BMP MIME", "data:image/bmp;base64,AAAA"],
  ])("rejects %s consistently without reaching an upload boundary", (_case, dataUrl) => {
    expect(parseComfyUiImageDataUrl(dataUrl)).toBeNull();
    expect(() => parseComfyUiSourceImageDataUrl(dataUrl)).toThrow(
      "sourceImageDataUrl must be a PNG, JPEG, or WEBP data URL.",
    );
    expect(validateSourceImageDataUrl(dataUrl)).toMatchObject({ ok: false });
  });
});
