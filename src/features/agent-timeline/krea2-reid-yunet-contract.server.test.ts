// @vitest-environment node

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import * as ort from "onnxruntime-node";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  KREA2_REID_DETECTOR_SHA256,
  prepareKrea2ReIdImage,
} from "./krea2-reid-preprocess.server";

const detectorPath = path.join(
  process.cwd(),
  "src",
  "features",
  "agent-timeline",
  "assets",
  "face_detection_yunet_2023mar_int8.onnx",
);

describe("bundled YuNet runtime contract", () => {
  it("loads the checksum-pinned model and executes its real input/output tensor contract", { timeout: 20_000 }, async () => {
    const modelBytes = await fs.readFile(detectorPath);
    expect(crypto.createHash("sha256").update(modelBytes).digest("hex"))
      .toBe(KREA2_REID_DETECTOR_SHA256);

    const session = await ort.InferenceSession.create(modelBytes);
    expect(session.inputNames).toEqual(["input"]);
    expect(session.inputMetadata).toEqual([
      expect.objectContaining({
        isTensor: true,
        name: "input",
        shape: [1, 3, 640, 640],
        type: "float32",
      }),
    ]);

    const result = await session.run({
      input: new ort.Tensor("float32", new Float32Array(1 * 3 * 640 * 640), [1, 3, 640, 640]),
    });
    for (const [stride, cells] of [[8, 6400], [16, 1600], [32, 400]] as const) {
      expect(result[`cls_${stride}`]).toMatchObject({ dims: [1, cells, 1], type: "float32" });
      expect(result[`obj_${stride}`]).toMatchObject({ dims: [1, cells, 1], type: "float32" });
      expect(result[`bbox_${stride}`]).toMatchObject({ dims: [1, cells, 4], type: "float32" });
      expect(result[`kps_${stride}`]).toMatchObject({ dims: [1, cells, 10], type: "float32" });
    }
  });

  it("runs production preprocessing against the bundled session without mocking onnxruntime", { timeout: 20_000 }, async () => {
    const input = await sharp({
      create: { background: "#808080", channels: 3, height: 64, width: 64 },
    }).png().toBuffer();

    const result = await prepareKrea2ReIdImage(input);

    expect(result.faceDetected).toBe(false);
    expect(result.crop).toBeUndefined();
    expect(await sharp(result.original.bytes).metadata()).toMatchObject({
      channels: 3,
      format: "png",
      height: 64,
      width: 64,
    });
  });
});
