import type { ComfyUiGeneratedImage } from "@/features/comfyui";
import type {
  SavedComicSequencePreviousShotReference,
  SavedComicSequenceShot,
  SavedComfyUiGeneratedImage,
} from "@/shared/types";

export type ComicSequencePreviousShotResult = {
  images: ComfyUiGeneratedImage[];
  shotId?: string;
};

export type ComicSequencePreviousShotSource = {
  image: ComfyUiGeneratedImage;
  previousShot: SavedComicSequenceShot;
  sourceKey: string;
};

export type ComicSequencePreviousShotMask = {
  maskDataUrl: string;
  sourceKey: string;
};

export type ComicSequencePreviousShotAction = "text-to-image" | "img2img" | "inpaint" | "pause-for-mask";
export const PENDING_COMIC_SEQUENCE_PREVIOUS_SHOT_SOURCE_KEY = "__pending_previous_shot_source__";

type MaskCanvas = {
  height: number;
  width: number;
  getContext(contextId: "2d"): Pick<CanvasRenderingContext2D, "fillRect" | "fillStyle"> | null;
  toDataURL(type?: string): string;
};

export function getComfyUiGeneratedImageReferenceKey(
  image: Pick<ComfyUiGeneratedImage, "filename" | "nodeId" | "subfolder" | "type">,
) {
  return [image.nodeId, image.filename, image.subfolder ?? "", image.type ?? ""].join("\u0000");
}

export function findComicSequencePreviousShotSource({
  currentShotId,
  results,
  shots,
}: {
  currentShotId: string;
  results: ComicSequencePreviousShotResult[];
  shots: SavedComicSequenceShot[];
}): ComicSequencePreviousShotSource | null {
  const shotIndex = shots.findIndex((shot) => shot.id === currentShotId);
  if (shotIndex <= 0) {
    return null;
  }

  const previousShot = shots[shotIndex - 1];
  for (const result of results) {
    if (result.shotId !== previousShot.id) {
      continue;
    }

    const image = result.images[0];
    if (!image) {
      continue;
    }

    return {
      image,
      previousShot,
      sourceKey: getComfyUiGeneratedImageReferenceKey(image),
    };
  }

  return null;
}

export function createComicSequenceImageFromSavedImage(
  record: SavedComfyUiGeneratedImage,
): ComfyUiGeneratedImage {
  const sourceReference = record.sourceReference ?? record;

  return {
    filename: sourceReference.filename,
    nodeId: record.nodeId,
    ...(sourceReference.subfolder !== undefined ? { subfolder: sourceReference.subfolder } : {}),
    ...(sourceReference.type !== undefined ? { type: sourceReference.type } : {}),
    url: record.url,
  };
}

function createPreviousShotResultFromSavedImage(
  record: SavedComfyUiGeneratedImage,
  shotId: string,
): ComicSequencePreviousShotResult {
  const image = createComicSequenceImageFromSavedImage(record);

  return {
    images: [image],
    shotId,
  };
}

export function promoteComicSequenceResultImage<Result extends { images: ComfyUiGeneratedImage[]; promptId: string }>(
  results: Result[],
  promptId: string,
  image: ComfyUiGeneratedImage,
): Result[] {
  const targetKey = getComfyUiGeneratedImageReferenceKey(image);

  return results.map((result) => {
    if (result.promptId !== promptId) {
      return result;
    }

    const remainingImages = result.images.filter(
      (candidate) => getComfyUiGeneratedImageReferenceKey(candidate) !== targetKey,
    );
    if (remainingImages.length === result.images.length) {
      return result;
    }

    return {
      ...result,
      images: [image, ...remainingImages],
    };
  });
}

export function createComicSequenceSavedPreviousShotResults(
  savedImages: SavedComfyUiGeneratedImage[],
  shots: Array<Pick<SavedComicSequenceShot, "boundImageIds" | "id">> = [],
): ComicSequencePreviousShotResult[] {
  const savedImageById = new Map(savedImages.map((image) => [image.id, image]));
  const seen = new Set<string>();
  const results: ComicSequencePreviousShotResult[] = [];

  function append(record: SavedComfyUiGeneratedImage, shotId: string) {
    const key = `${shotId}\u0000${record.id}`;
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    results.push(createPreviousShotResultFromSavedImage(record, shotId));
  }

  for (const shot of shots) {
    for (const imageId of shot.boundImageIds ?? []) {
      const record = savedImageById.get(imageId);
      if (record) {
        append(record, shot.id);
      }
    }
  }

  for (const record of savedImages) {
    if (record.source === "sequence" && record.shotId) {
      append(record, record.shotId);
    }
  }

  return results;
}

export function resolveComicSequencePreviousShotAction({
  mask,
  reference,
  source,
}: {
  mask?: ComicSequencePreviousShotMask;
  reference?: SavedComicSequencePreviousShotReference;
  source?: ComicSequencePreviousShotSource | null;
}): ComicSequencePreviousShotAction {
  if (!reference || !source) {
    return "text-to-image";
  }

  if (reference.mode === "img2img") {
    return "img2img";
  }

  return mask?.maskDataUrl &&
    (mask.sourceKey === source.sourceKey || mask.sourceKey === PENDING_COMIC_SEQUENCE_PREVIOUS_SHOT_SOURCE_KEY)
    ? "inpaint"
    : "pause-for-mask";
}

export function createFullImageMaskDataUrl(
  width: number,
  height: number,
  createCanvas: () => MaskCanvas = () => document.createElement("canvas"),
) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("Mask dimensions must be positive.");
  }

  const canvas = createCanvas();
  canvas.width = Math.round(width);
  canvas.height = Math.round(height);
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to create full image mask.");
  }

  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);

  return canvas.toDataURL("image/png");
}
