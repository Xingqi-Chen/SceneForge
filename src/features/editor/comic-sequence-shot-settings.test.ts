import { describe, expect, it } from "vitest";

import { createDefaultProject } from "@/features/editor/store/defaults";
import type { SavedComicSequence, SavedComicSequenceShot } from "@/shared/types";

import {
  applyComicSequenceShotSettingsPatchToSequence,
  bindComicSequenceShotImageIds,
} from "./comic-sequence-shot-settings";

function createShot(id: string, title: string, shotPrompt: string): SavedComicSequenceShot {
  return {
    id,
    title,
    scene: createDefaultProject().scene,
    positivePrompt: `${id} positive`,
    negativePrompt: `${id} negative`,
    shotPrompt,
    castCharacterIds: [],
    shotCanvasPrompt: `${id} positive`,
    manualShotPrompt: shotPrompt,
    parameters: {
      cfg: 7,
      denoise: 0.7,
      height: 768,
      imageCount: 1,
      latentImageNode: "EmptyLatentImage",
      loras: [],
      outputPrefix: id,
      samplerName: "euler",
      scheduler: "normal",
      seed: 100,
      seedMode: "fixed",
      steps: 24,
      width: 768,
      savedAt: "2026-05-27T12:00:00.000Z",
    },
    controlNets: [],
    reference: {
      characterName: id,
      characterPrompt: "",
      face: {
        enabled: false,
        mode: "face",
        weight: 0.45,
        startAt: 0,
        endAt: 1,
        images: [],
      },
      character: {
        enabled: false,
        mode: "ipadapter",
        weight: 0.45,
        startAt: 0,
        endAt: 1,
        images: [],
      },
      mode: "face",
      weight: 0.45,
      startAt: 0,
      endAt: 1,
      images: [],
    },
    createdAt: "2026-05-27T12:00:00.000Z",
    updatedAt: "2026-05-27T12:00:00.000Z",
  };
}

function createSequence(): SavedComicSequence {
  return {
    version: 1,
    selectedShotId: "shot-2",
    stylePrompt: "",
    environmentPrompt: "",
    characters: [],
    shots: [
      createShot("shot-1", "Shot 1", "manual 1"),
      createShot("shot-2", "Shot 2", "manual 2"),
      createShot("shot-3", "Shot 3", "manual 3"),
    ],
  };
}

describe("comic sequence shot settings sync", () => {
  it("syncs settings from the selected shot down without replacing titles, casts, or manual prompts", () => {
    const sequence = createSequence();
    sequence.shots[1] = {
      ...sequence.shots[1]!,
      castCharacterIds: ["character-b"],
    };
    sequence.shots[2] = {
      ...sequence.shots[2]!,
      castCharacterIds: ["character-c"],
    };

    const next = applyComicSequenceShotSettingsPatchToSequence(
      sequence,
      {
        castCharacterIds: ["character-shared"],
        negativePrompt: "shared negative",
        positivePrompt: "shared positive",
        previousShotReference: {
          mode: "inpaint",
          denoise: 0.45,
          inpaintMode: "vae-inpaint",
          growMaskBy: 16,
        },
        reference: {
          characterName: "Hero",
          characterPrompt: "same outfit",
          face: {
            enabled: true,
            mode: "face",
            weight: 0.7,
            startAt: 0.1,
            endAt: 0.9,
            images: [{ id: "face-ref", source: "history", imageId: "image-1" }],
          },
          character: {
            enabled: true,
            mode: "ipadapter",
            weight: 0.6,
            startAt: 0,
            endAt: 1,
            images: [],
          },
          mode: "face",
          weight: 0.7,
          startAt: 0.1,
          endAt: 0.9,
          images: [],
        },
      } as Parameters<typeof applyComicSequenceShotSettingsPatchToSequence>[1],
      {
        selectedShotId: "shot-2",
        syncDown: true,
        updatedAt: "2026-05-27T13:00:00.000Z",
      },
    );

    expect(next.shots[0]?.positivePrompt).toBe("shot-1 positive");
    expect(next.shots[1]?.positivePrompt).toBe("shared positive");
    expect(next.shots[2]?.positivePrompt).toBe("shared positive");
    expect(next.shots.map((shot) => shot.title)).toEqual(["Shot 1", "Shot 2", "Shot 3"]);
    expect(next.shots.map((shot) => shot.castCharacterIds)).toEqual([[], ["character-b"], ["character-c"]]);
    expect(next.shots.map((shot) => shot.shotPrompt)).toEqual(["manual 1", "manual 2", "manual 3"]);
    expect(next.shots.map((shot) => shot.manualShotPrompt)).toEqual(["manual 1", "manual 2", "manual 3"]);
    expect(next.shots[2]?.previousShotReference?.mode).toBe("inpaint");
    expect(next.shots[1]?.reference).not.toBe(next.shots[2]?.reference);
  });

  it("only updates the selected shot when sync down is disabled", () => {
    const next = applyComicSequenceShotSettingsPatchToSequence(
      createSequence(),
      { positivePrompt: "selected only" },
      {
        selectedShotId: "shot-2",
        syncDown: false,
        updatedAt: "2026-05-27T13:00:00.000Z",
      },
    );

    expect(next.shots.map((shot) => shot.positivePrompt)).toEqual([
      "shot-1 positive",
      "selected only",
      "shot-3 positive",
    ]);
  });

  it("clears previous-shot settings on the selected shot and following shots", () => {
    const sequence = createSequence();
    sequence.shots = sequence.shots.map((shot) => ({
      ...shot,
      previousShotReference: {
        mode: "img2img",
        denoise: 0.5,
        inpaintMode: "latent-noise-mask",
        growMaskBy: 8,
      },
    }));

    const next = applyComicSequenceShotSettingsPatchToSequence(
      sequence,
      { previousShotReference: undefined },
      {
        selectedShotId: "shot-2",
        syncDown: true,
        updatedAt: "2026-05-27T13:00:00.000Z",
      },
    );

    expect(next.shots[0]?.previousShotReference?.mode).toBe("img2img");
    expect(next.shots[1]?.previousShotReference).toBeUndefined();
    expect(next.shots[2]?.previousShotReference).toBeUndefined();
  });

  it("binds saved direct-shot images to the generated shot for previous-shot reuse", () => {
    const sequence = createSequence();
    sequence.shots[0] = {
      ...sequence.shots[0]!,
      boundImageIds: ["manual-image", "older-image"],
    };

    const next = bindComicSequenceShotImageIds(
      sequence,
      "shot-1",
      ["saved-shot-image", "manual-image", "saved-shot-image"],
      {
        limit: 3,
        updatedAt: "2026-05-27T13:00:00.000Z",
      },
    );

    expect(next.shots[0]?.boundImageIds).toEqual(["saved-shot-image", "manual-image", "older-image"]);
    expect(next.shots[0]?.updatedAt).toBe("2026-05-27T13:00:00.000Z");
    expect(next.shots[1]?.boundImageIds).toBeUndefined();
  });
});
