// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

const ortMocks = vi.hoisted(() => ({
  create: vi.fn(),
  release: vi.fn(),
  run: vi.fn(),
}));

vi.mock("onnxruntime-node", () => ({
  InferenceSession: { create: ortMocks.create },
  Tensor: class Tensor {
    data: unknown;
    dims: readonly number[];
    type: string;

    constructor(type: string, data: unknown, dims: readonly number[]) {
      this.type = type;
      this.data = data;
      this.dims = dims;
    }
  },
}));

import {
  choosePreparedKrea2ReIdImage,
  KREA2_REID_FACE_CONFIDENCE_THRESHOLD,
  KREA2_REID_PIXEL_BUDGET,
  prepareKrea2ReIdImage,
} from "./krea2-reid-preprocess.server";

const DETECTION_SIZE = 640;

function outputs() {
  return Object.fromEntries([8, 16, 32].flatMap((stride) => {
    const cells = Math.ceil(DETECTION_SIZE / stride) ** 2;
    return [
      [`cls_${stride}`, { data: new Float32Array(cells) }],
      [`obj_${stride}`, { data: new Float32Array(cells) }],
      [`bbox_${stride}`, { data: new Float32Array(cells * 4) }],
    ];
  }));
}

function addFace(
  result: ReturnType<typeof outputs>,
  { column, confidence, height, row, stride = 32, width, xOffset = 0.5, yOffset = 0.5 }: {
    column: number;
    confidence: number;
    height: number;
    row: number;
    stride?: 8 | 16 | 32;
    width: number;
    xOffset?: number;
    yOffset?: number;
  },
) {
  const columns = Math.ceil(DETECTION_SIZE / stride);
  const index = row * columns + column;
  (result[`cls_${stride}`]!.data as Float32Array)[index] = confidence;
  (result[`obj_${stride}`]!.data as Float32Array)[index] = confidence;
  const bbox = result[`bbox_${stride}`]!.data as Float32Array;
  bbox[index * 4] = xOffset;
  bbox[index * 4 + 1] = yOffset;
  bbox[index * 4 + 2] = Math.log(width / stride);
  bbox[index * 4 + 3] = Math.log(height / stride);
}

beforeEach(() => {
  ortMocks.run.mockReset();
  ortMocks.release.mockReset();
  ortMocks.create.mockResolvedValue({
    inputMetadata: [{
      isTensor: true,
      name: "input",
      shape: [1, 3, DETECTION_SIZE, DETECTION_SIZE],
      type: "float32",
    }],
    inputNames: ["input"],
    release: ortMocks.release,
    run: ortMocks.run,
  });
});

describe("server-only Krea2 ReID preprocessing", () => {
  it("normalizes EXIF orientation to bounded RGB PNG without retaining alpha", async () => {
    ortMocks.run.mockResolvedValue(outputs());
    const rgba = Buffer.alloc(800 * 400 * 4, 255);
    const input = await sharp(rgba, { raw: { channels: 4, height: 400, width: 800 } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();

    const result = await prepareKrea2ReIdImage(input);
    const metadata = await sharp(result.original.bytes).metadata();

    expect(result.faceDetected).toBe(false);
    expect(result.crop).toBeUndefined();
    expect(result.warning).toContain(`confidence ${KREA2_REID_FACE_CONFIDENCE_THRESHOLD}`);
    expect(result.original.width).toBeLessThan(result.original.height);
    expect(result.original.width * result.original.height).toBeLessThanOrEqual(KREA2_REID_PIXEL_BUDGET);
    expect(metadata).toMatchObject({ format: "png", channels: 3 });
    expect(metadata.width).toBe(result.original.width);
    expect(metadata.height).toBe(result.original.height);
  });

  it("ignores sub-threshold detections and selects the highest-confidence upstream crop", async () => {
    const resultMap = outputs();
    addFace(resultMap, { column: 1, confidence: 0.34, height: 96, row: 1, width: 96 });
    addFace(resultMap, { column: 2, confidence: 0.4, height: 32, row: 6, width: 32 });
    addFace(resultMap, { column: 6, confidence: 0.9, height: 128, row: 8, width: 128 });
    ortMocks.run.mockResolvedValue(resultMap);
    const input = await sharp({
      create: { background: { b: 120, g: 80, r: 40 }, channels: 3, height: 480, width: 640 },
    }).png().toBuffer();

    const result = await prepareKrea2ReIdImage(input);

    expect(result.faceDetected).toBe(true);
    expect(result.crop).toMatchObject({ width: 196, height: 196 });
    expect(result.crop!.width * result.crop!.height).toBeLessThanOrEqual(KREA2_REID_PIXEL_BUDGET);
    expect(choosePreparedKrea2ReIdImage(result, "crop")).toBe(result.crop);
    expect(choosePreparedKrea2ReIdImage(result, "original")).toBe(result.original);
  });

  it("clamps an edge face crop to source bounds and keeps both choices within the pixel budget", async () => {
    const resultMap = outputs();
    addFace(resultMap, { column: 9, confidence: 0.95, height: 128, row: 1, width: 128 });
    ortMocks.run.mockResolvedValue(resultMap);
    const input = await sharp({
      create: { background: "#663399", channels: 3, height: 600, width: 1200 },
    }).webp().toBuffer();

    const result = await prepareKrea2ReIdImage(input);

    expect(result.crop).toBeDefined();
    for (const image of [result.original, result.crop!]) {
      expect(image.width).toBeGreaterThan(0);
      expect(image.height).toBeGreaterThan(0);
      expect(image.width * image.height).toBeLessThanOrEqual(KREA2_REID_PIXEL_BUDGET);
      const metadata = await sharp(image.bytes).metadata();
      expect(metadata).toMatchObject({ format: "png", channels: 3, width: image.width, height: image.height });
    }
  });

  it("matches pinned Python rounding and independent clamps for a left-edge half-tie crop", async () => {
    const resultMap = outputs();
    addFace(resultMap, {
      column: 5,
      confidence: 0.95,
      height: 65,
      row: 20,
      stride: 8,
      width: 65,
      xOffset: 0.4375,
    });
    ortMocks.run.mockResolvedValue(resultMap);
    const sourcePixels = Buffer.alloc(640 * 640 * 3);
    for (let y = 0; y < 640; y += 1) {
      for (let x = 0; x < 640; x += 1) {
        const offset = (y * 640 + x) * 3;
        sourcePixels[offset] = y % 256;
        sourcePixels[offset + 1] = x % 256;
      }
    }
    const input = await sharp(sourcePixels, { raw: { channels: 3, height: 640, width: 640 } })
      .png()
      .toBuffer();

    const result = await prepareKrea2ReIdImage(input);

    // Pinned Python: round(11 - 65 / 2) === -22, crop_right === 108,
    // then clamp the left edge independently to zero.
    expect(result.crop).toMatchObject({ width: 108, height: 130 });
    await expect(sharp(result.crop!.bytes).metadata()).resolves.toMatchObject({
      format: "png",
      height: 130,
      width: 108,
    });
    const cropPixels = await sharp(result.crop!.bytes).raw().toBuffer();
    expect([...cropPixels.subarray(0, 3)]).toEqual([67, 0, 0]);
    expect([...cropPixels.subarray(cropPixels.length - 3)]).toEqual([196, 107, 0]);
  });

  it("fails closed when crop is selected without a detected face", async () => {
    ortMocks.run.mockResolvedValue(outputs());
    const input = await sharp({
      create: { background: "white", channels: 3, height: 128, width: 128 },
    }).png().toBuffer();
    const result = await prepareKrea2ReIdImage(input);

    expect(() => choosePreparedKrea2ReIdImage(result, "crop"))
      .toThrow("A detected-face crop is not available");
  });
});
