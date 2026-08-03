import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import * as ort from "onnxruntime-node";
import sharp from "sharp";

import type { Krea2ReIdPreparationChoice } from "./style-reference";

export const KREA2_REID_DETECTOR_SHA256 = "321aa5a6afabf7ecc46a3d06bfab2b579dc96eb5c3be7edd365fa04502ad9294";
export const KREA2_REID_FACE_CONFIDENCE_THRESHOLD = 0.35;
export const KREA2_REID_PIXEL_BUDGET = 384 * 384;
export const KREA2_REID_MAX_UPLOAD_BYTES = 24 * 1024 * 1024;

const NMS_THRESHOLD = 0.3;
const DETECTOR_FILENAME = "face_detection_yunet_2023mar_int8.onnx";

type FaceBox = { bottom: number; confidence: number; left: number; right: number; top: number };
type PreparedImage = { bytes: Buffer; height: number; width: number };

type LoadedDetectorSession = {
  inputName: "input";
  inputSize: number;
  session: ort.InferenceSession;
};

let detectorSessionPromise: Promise<LoadedDetectorSession> | undefined;

function detectorPath() {
  return path.join(
    /* turbopackIgnore: true */ process.cwd(),
    "src",
    "features",
    "agent-timeline",
    "assets",
    DETECTOR_FILENAME,
  );
}

async function loadDetectorSession() {
  detectorSessionPromise ??= (async () => {
    const modelBytes = await fs.readFile(/* turbopackIgnore: true */ detectorPath());
    const digest = crypto.createHash("sha256").update(modelBytes).digest("hex");
    if (digest !== KREA2_REID_DETECTOR_SHA256) {
      throw new Error("Bundled Krea2 ReID face detector failed its integrity check.");
    }
    const session = await ort.InferenceSession.create(modelBytes);
    const inputNames = session.inputNames ?? [];
    const inputMetadata = session.inputMetadata ?? [];
    const inputName = inputNames.length === 1 ? inputNames[0] : undefined;
    const metadata = inputMetadata.length === 1 ? inputMetadata[0] : undefined;
    const shape = metadata?.isTensor ? metadata.shape : [];
    const inputSize = shape[2];
    if (inputName !== "input" || metadata?.name !== inputName || !metadata.isTensor ||
        metadata.type !== "float32" || shape.length !== 4 || shape[0] !== 1 || shape[1] !== 3 ||
        typeof inputSize !== "number" || !Number.isSafeInteger(inputSize) || inputSize < 32 ||
        inputSize > 4096 || inputSize % 32 !== 0 || shape[3] !== inputSize) {
      await session.release?.();
      throw new Error("Bundled Krea2 ReID face detector has an unsupported input contract.");
    }
    return { inputName, inputSize, session };
  })();
  return detectorSessionPromise;
}

function preparedDimensions(width: number, height: number) {
  const scale = Math.min(1, Math.sqrt(KREA2_REID_PIXEL_BUDGET / (width * height)));
  let preparedWidth = Math.max(1, Math.floor(width * scale));
  let preparedHeight = Math.max(1, Math.floor(height * scale));
  while (preparedWidth * preparedHeight > KREA2_REID_PIXEL_BUDGET) {
    if (preparedWidth >= preparedHeight) preparedWidth -= 1;
    else preparedHeight -= 1;
  }
  return { height: preparedHeight, width: preparedWidth };
}

function tensorData(value: ort.Tensor | undefined) {
  return value?.data instanceof Float32Array ? value.data : undefined;
}

function intersectionOverUnion(a: FaceBox, b: FaceBox) {
  const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const intersection = width * height;
  const union = (a.right - a.left) * (a.bottom - a.top) +
    (b.right - b.left) * (b.bottom - b.top) - intersection;
  return union > 0 ? intersection / union : 0;
}

function nonMaximumSuppression(faces: FaceBox[]) {
  const kept: FaceBox[] = [];
  for (const face of faces.sort((a, b) => b.confidence - a.confidence).slice(0, 5000)) {
    if (kept.every((candidate) => intersectionOverUnion(face, candidate) <= NMS_THRESHOLD)) kept.push(face);
  }
  return kept;
}

function decodeFaces(results: ort.InferenceSession.OnnxValueMapType, detectionSize: number) {
  const faces: FaceBox[] = [];
  for (const stride of [8, 16, 32]) {
    const cls = tensorData(results[`cls_${stride}`]);
    const obj = tensorData(results[`obj_${stride}`]);
    const bbox = tensorData(results[`bbox_${stride}`]);
    if (!cls || !obj || !bbox) throw new Error("Krea2 ReID face detector returned incomplete output.");
    const rows = detectionSize / stride;
    const columns = rows;
    const cellCount = rows * columns;
    if (cls.length !== cellCount || obj.length !== cellCount || bbox.length !== cellCount * 4) {
      throw new Error("Krea2 ReID face detector returned an unexpected output shape.");
    }
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const index = row * columns + column;
        const confidence = Math.sqrt(
          Math.min(1, Math.max(0, cls[index]!)) * Math.min(1, Math.max(0, obj[index]!)),
        );
        if (confidence < KREA2_REID_FACE_CONFIDENCE_THRESHOLD) continue;
        const offset = index * 4;
        const centerX = (column + bbox[offset]!) * stride;
        const centerY = (row + bbox[offset + 1]!) * stride;
        const width = Math.exp(bbox[offset + 2]!) * stride;
        const height = Math.exp(bbox[offset + 3]!) * stride;
        faces.push({
          bottom: centerY + height / 2,
          confidence,
          left: centerX - width / 2,
          right: centerX + width / 2,
          top: centerY - height / 2,
        });
      }
    }
  }
  return nonMaximumSuppression(faces);
}

function pythonRound(value: number) {
  const lower = Math.floor(value);
  const fraction = value - lower;
  if (fraction < 0.5) return lower;
  if (fraction > 0.5) return lower + 1;
  return lower % 2 === 0 ? lower : lower + 1;
}

export function detectKrea2ReIdImageContentType(bytes: Uint8Array) {
  if (bytes.length >= 8 &&
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
      bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return "image/png" as const;
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg" as const;
  }
  if (bytes.length >= 12 &&
      String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP") {
    return "image/webp" as const;
  }
  return null;
}

async function detectHighestConfidenceFace(
  normalized: sharp.Sharp,
  imageWidth: number,
  imageHeight: number,
) {
  const detector = await loadDetectorSession();
  const detectionSize = detector.inputSize;
  const side = Math.min(imageWidth, imageHeight);
  const squareLeft = imageWidth > imageHeight ? Math.floor((imageWidth - side) / 2) : 0;
  const squareTop = 0;
  const { data } = await normalized.clone()
    .extract({ left: squareLeft, top: squareTop, width: side, height: side })
    .resize(detectionSize, detectionSize, { fit: "fill", kernel: sharp.kernel.lanczos3 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const planeSize = detectionSize * detectionSize;
  const input = new Float32Array(planeSize * 3);
  for (let index = 0; index < planeSize; index += 1) {
    input[index] = data[index * 3 + 2]!;
    input[planeSize + index] = data[index * 3 + 1]!;
    input[planeSize * 2 + index] = data[index * 3]!;
  }
  const results = await detector.session.run({
    [detector.inputName]: new ort.Tensor("float32", input, [1, 3, detectionSize, detectionSize]),
  });
  const face = decodeFaces(results, detectionSize)[0];
  if (!face) return null;

  const scale = side / detectionSize;
  const faceLeft = Math.floor(face.left * scale + squareLeft);
  const faceTop = Math.floor(face.top * scale + squareTop);
  const faceRight = Math.ceil(face.right * scale + squareLeft);
  const faceBottom = Math.ceil(face.bottom * scale + squareTop);
  if (faceRight <= faceLeft || faceBottom <= faceTop) return null;

  // Exact upstream expanded_head_crop: 2x face width, anchored at face
  // bottom. Python round uses ties-to-even, and all four raw bounds are
  // independently clamped only after expansion.
  const faceWidth = faceRight - faceLeft;
  const rawCropLeft = pythonRound(faceLeft - faceWidth / 2);
  const rawCropRight = pythonRound(faceRight + faceWidth / 2);
  const rawCropTop = pythonRound(faceBottom - faceWidth * 2);
  const rawCropBottom = pythonRound(faceBottom);
  const cropLeft = Math.max(0, Math.min(imageWidth, rawCropLeft));
  const cropTop = Math.max(0, Math.min(imageHeight, rawCropTop));
  const cropRight = Math.max(0, Math.min(imageWidth, rawCropRight));
  const cropBottom = Math.max(0, Math.min(imageHeight, rawCropBottom));
  return cropRight > cropLeft && cropBottom > cropTop
    ? { height: cropBottom - cropTop, left: cropLeft, top: cropTop, width: cropRight - cropLeft }
    : null;
}

async function encodePrepared(pipeline: sharp.Sharp, width: number, height: number): Promise<PreparedImage> {
  const dimensions = preparedDimensions(width, height);
  return {
    bytes: await pipeline
      .resize(dimensions.width, dimensions.height, { fit: "fill", kernel: sharp.kernel.lanczos3 })
      .png({ compressionLevel: 9 })
      .toBuffer(),
    ...dimensions,
  };
}

export async function prepareKrea2ReIdImage(bytes: Uint8Array) {
  if (bytes.byteLength < 1 || bytes.byteLength > KREA2_REID_MAX_UPLOAD_BYTES) {
    throw new Error("Krea2 ReID reference must be a non-empty image no larger than 24 MB.");
  }
  const detectedContentType = detectKrea2ReIdImageContentType(bytes);
  if (!detectedContentType) {
    throw new Error("Krea2 ReID reference must decode as PNG, JPEG, or WEBP.");
  }
  const sourceMetadata = await sharp(bytes, { failOn: "error", limitInputPixels: 100_000_000 }).metadata();
  const expectedFormat = detectedContentType === "image/jpeg" ? "jpeg" : detectedContentType.slice(6);
  if (sourceMetadata.format !== expectedFormat) {
    throw new Error("Krea2 ReID reference format did not match its file signature.");
  }
  const normalizedPipeline = sharp(bytes, { failOn: "error", limitInputPixels: 100_000_000 })
    .rotate()
    .removeAlpha()
    .toColourspace("srgb");
  const normalizedOutput = await normalizedPipeline.png().toBuffer({ resolveWithObject: true });
  const { width, height } = normalizedOutput.info;
  if (!width || !height) throw new Error("Krea2 ReID reference dimensions could not be read.");
  const normalized = sharp(normalizedOutput.data, { failOn: "error" });

  const original = await encodePrepared(normalized.clone(), width, height);
  const cropRegion = await detectHighestConfidenceFace(normalized, width, height);
  const crop = cropRegion
    ? await encodePrepared(
        normalized.clone().extract(cropRegion),
        cropRegion.width,
        cropRegion.height,
      )
    : undefined;
  return {
    crop,
    faceDetected: Boolean(crop),
    original,
    warning: crop
      ? "Face detected. Compare the upstream head/shoulders crop with the normalized original before choosing."
      : "No face was detected at confidence 0.35. The normalized original remains available; replace the image if identity conditioning is weak.",
  };
}

export function choosePreparedKrea2ReIdImage(
  prepared: Awaited<ReturnType<typeof prepareKrea2ReIdImage>>,
  choice: Krea2ReIdPreparationChoice,
) {
  if (choice === "crop" && !prepared.crop) throw new Error("A detected-face crop is not available for this image.");
  return choice === "crop" ? prepared.crop! : prepared.original;
}
