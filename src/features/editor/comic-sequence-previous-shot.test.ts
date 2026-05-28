import { describe, expect, it } from "vitest";

import type { ComfyUiGeneratedImage } from "@/features/comfyui";
import type { SavedComicSequenceShot, SavedComfyUiGeneratedImage } from "@/shared/types";
import {
  createComicSequenceSavedPreviousShotResults,
  createFullImageMaskDataUrl,
  findComicSequencePreviousShotSource,
  PENDING_COMIC_SEQUENCE_PREVIOUS_SHOT_SOURCE_KEY,
  resolveComicSequencePreviousShotAction,
} from "./comic-sequence-previous-shot";

function shot(id: string): SavedComicSequenceShot {
  return { id } as SavedComicSequenceShot;
}

function image(filename: string): ComfyUiGeneratedImage {
  return {
    filename,
    nodeId: "preview",
    type: "output",
    url: `/view/${filename}`,
  };
}

function savedSequenceImage(patch: Partial<SavedComfyUiGeneratedImage>): SavedComfyUiGeneratedImage {
  return {
    id: "history-image-1",
    promptId: "prompt-1",
    batchId: "prompt-1:1",
    nodeId: "preview",
    filename: "source.png",
    type: "output",
    url: "/api/comfyui/generated-images/source.png",
    seed: 42,
    source: "sequence",
    createdAt: "2026-05-27T12:00:00.000Z",
    favorited: false,
    shotId: "shot-1",
    width: 1024,
    height: 1024,
    positivePrompt: "positive",
    negativePrompt: "negative",
    parameters: {} as SavedComfyUiGeneratedImage["parameters"],
    selectedCheckpointId: null,
    selectedLoraIds: [],
    ...patch,
  };
}

describe("comic sequence previous-shot helpers", () => {
  it("resolves the first generated candidate from the immediately previous shot", () => {
    const first = image("first.png");
    const second = image("second.png");

    const source = findComicSequencePreviousShotSource({
      currentShotId: "shot-2",
      shots: [shot("shot-1"), shot("shot-2")],
      results: [
        {
          shotId: "shot-1",
          images: [first, second],
        },
      ],
    });

    expect(source?.image).toBe(first);
    expect(source?.previousShot.id).toBe("shot-1");
  });

  it("uses saved sequence images as previous-shot fallback after reopening the workspace", () => {
    const savedResults = createComicSequenceSavedPreviousShotResults([
      savedSequenceImage({
        filename: "local-copy.png",
        localFilename: "local-copy.png",
        sourceReference: {
          filename: "original-comfyui-output.png",
          type: "output",
        },
        url: "/api/comfyui/generated-images/local-copy.png",
      }),
      savedSequenceImage({
        id: "not-sequence",
        source: "text-to-image",
      }),
    ]);
    const source = findComicSequencePreviousShotSource({
      currentShotId: "shot-2",
      shots: [shot("shot-1"), shot("shot-2")],
      results: savedResults,
    });

    expect(source?.image).toEqual({
      filename: "original-comfyui-output.png",
      nodeId: "preview",
      type: "output",
      url: "/api/comfyui/generated-images/local-copy.png",
    });
    expect(source?.previousShot.id).toBe("shot-1");
  });

  it("skips empty pending results before falling back to a later previous-shot source", () => {
    const fallback = image("saved-fallback.png");
    const source = findComicSequencePreviousShotSource({
      currentShotId: "shot-2",
      shots: [shot("shot-1"), shot("shot-2")],
      results: [
        {
          shotId: "shot-1",
          images: [],
        },
        {
          shotId: "shot-1",
          images: [fallback],
        },
      ],
    });

    expect(source?.image).toBe(fallback);
    expect(source?.previousShot.id).toBe("shot-1");
  });

  it("falls back to text-to-image when no previous source exists", () => {
    const source = findComicSequencePreviousShotSource({
      currentShotId: "shot-1",
      shots: [shot("shot-1"), shot("shot-2")],
      results: [],
    });

    expect(source).toBeNull();
    expect(
      resolveComicSequencePreviousShotAction({
        reference: {
          mode: "img2img",
          denoise: 0.65,
          inpaintMode: "latent-noise-mask",
          growMaskBy: 6,
        },
        source,
      }),
    ).toBe("text-to-image");
  });

  it("pauses local inpaint generation when the matching mask is missing", () => {
    const source = findComicSequencePreviousShotSource({
      currentShotId: "shot-2",
      shots: [shot("shot-1"), shot("shot-2")],
      results: [
        {
          shotId: "shot-1",
          images: [image("source.png")],
        },
      ],
    });

    expect(
      resolveComicSequencePreviousShotAction({
        reference: {
          mode: "inpaint",
          denoise: 0.5,
          inpaintMode: "latent-noise-mask",
          growMaskBy: 6,
        },
        source,
      }),
    ).toBe("pause-for-mask");
    expect(
      resolveComicSequencePreviousShotAction({
        mask: {
          maskDataUrl: "data:image/png;base64,mask",
          sourceKey: source?.sourceKey ?? "",
        },
        reference: {
          mode: "inpaint",
          denoise: 0.5,
          inpaintMode: "latent-noise-mask",
          growMaskBy: 6,
        },
        source,
      }),
    ).toBe("inpaint");
    expect(
      resolveComicSequencePreviousShotAction({
        mask: {
          maskDataUrl: "data:image/png;base64,pending-mask",
          sourceKey: PENDING_COMIC_SEQUENCE_PREVIOUS_SHOT_SOURCE_KEY,
        },
        reference: {
          mode: "inpaint",
          denoise: 0.5,
          inpaintMode: "latent-noise-mask",
          growMaskBy: 6,
        },
        source,
      }),
    ).toBe("inpaint");
  });

  it("builds a full-image PNG mask", () => {
    const calls: Array<{ height: number; width: number; x: number; y: number }> = [];
    const canvas = {
      height: 0,
      width: 0,
      getContext: () => ({
        fillStyle: "",
        fillRect: (x: number, y: number, width: number, height: number) => {
          calls.push({ height, width, x, y });
        },
      }),
      toDataURL: (type?: string) => `data:${type};base64,mask`,
    };

    expect(createFullImageMaskDataUrl(320, 180, () => canvas)).toBe("data:image/png;base64,mask");
    expect(canvas.width).toBe(320);
    expect(canvas.height).toBe(180);
    expect(calls).toEqual([{ height: 180, width: 320, x: 0, y: 0 }]);
  });
});
