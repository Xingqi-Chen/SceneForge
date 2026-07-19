import { describe, expect, it } from "vitest";

import { sanitizeGenerationDetailerSettingsSnapshot } from "./generation-detailers";
import {
  createGenerationStylePaletteSnapshot,
  createSavedParametersFromGenerationStylePalette,
} from "./generation-style-palette";
import { sanitizeRunSceneInputSettingsSnapshot } from "./run-input-settings";

describe("Run scene input generation settings", () => {
  it("requires a checkpoint before creating a saved style palette", () => {
    expect(createGenerationStylePaletteSnapshot({
      checkpointId: null,
      loraIds: ["lora-a"],
      savedParameters: {
        cfg: 7,
        denoise: 1,
        height: 1024,
        imageCount: 1,
        loras: [],
        outputPrefix: "SceneForge",
        samplerName: "euler",
        savedAt: "2026-07-18T00:00:00.000Z",
        scheduler: "normal",
        seed: 0,
        seedMode: "random",
        steps: 30,
        width: 1024,
      },
    })).toBeUndefined();
  });

  it("round-trips saved parameters and independent LoRA strengths", () => {
    const snapshot = createGenerationStylePaletteSnapshot({
      checkpointId: "checkpoint-a",
      loraIds: ["lora-a", "lora-b"],
      savedParameters: {
        cfg: 6.25,
        denoise: 0.83,
        height: 1279,
        imageCount: 4,
        loras: [
          { enabled: true, loraName: "a.safetensors", strengthModel: 0.63, strengthClip: 0.41 },
          { enabled: false, loraName: "b.safetensors", strengthModel: 0.22, strengthClip: 0.17 },
        ],
        outputPrefix: "SceneForge",
        samplerName: "euler",
        savedAt: "2026-07-18T00:00:00.000Z",
        scheduler: "normal",
        seed: 456,
        seedMode: "fixed",
        steps: 41,
        width: 959,
      },
    });

    expect(snapshot).toEqual({
      checkpointId: "checkpoint-a",
      loras: [
        { id: "lora-a", enabled: true, strengthModel: 0.63, strengthClip: 0.41 },
        { id: "lora-b", enabled: false, strengthModel: 0.22, strengthClip: 0.17 },
      ],
      parameters: {
        cfg: 6.25,
        denoise: 0.83,
        height: 1280,
        samplerName: "euler",
        scheduler: "normal",
        seed: 456,
        steps: 41,
        width: 960,
      },
    });

    expect(createSavedParametersFromGenerationStylePalette(snapshot, {
      checkpoint: {
        id: "checkpoint-a",
        resourceType: "model",
        name: "Checkpoint",
        versionName: "v1",
        baseModel: "Illustrious",
        creator: "creator",
        trainedWords: [],
        tags: [],
        categories: [],
        usageGuide: null,
        descriptionSnippet: null,
        averageWeight: null,
        minWeight: null,
        maxWeight: null,
        recommendations: [],
        previewImage: null,
        modelFileName: "checkpoint.safetensors",
        modelStorageKind: "checkpoint",
      },
      loras: [
        {
          id: "lora-a",
          resourceType: "lora",
          name: "LoRA A",
          versionName: "v1",
          baseModel: "Illustrious",
          creator: "creator",
          trainedWords: [],
          tags: [],
          categories: [],
          usageGuide: null,
          descriptionSnippet: null,
          averageWeight: 0.7,
          minWeight: null,
          maxWeight: null,
          recommendations: [],
          previewImage: null,
          modelFileName: "a.safetensors",
        },
        {
          id: "lora-b",
          resourceType: "lora",
          name: "LoRA B",
          versionName: "v1",
          baseModel: "Illustrious",
          creator: "creator",
          trainedWords: [],
          tags: [],
          categories: [],
          usageGuide: null,
          descriptionSnippet: null,
          averageWeight: 0.8,
          minWeight: null,
          maxWeight: null,
          recommendations: [],
          previewImage: null,
          modelFileName: "b.safetensors",
        },
      ],
    })).toMatchObject({
      imageCount: 1,
      seedMode: "fixed",
      seed: 456,
      loras: [
        { loraName: "a.safetensors", enabled: true, strengthModel: 0.63, strengthClip: 0.41 },
        { loraName: "b.safetensors", enabled: false, strengthModel: 0.22, strengthClip: 0.17 },
      ],
    });
  });

  it("defaults legacy records to both detailers disabled", () => {
    const settings = sanitizeRunSceneInputSettingsSnapshot(undefined);

    expect(settings.stylePalette).toBeUndefined();
    expect(settings.detailers).toMatchObject({
      faceDetailer: {
        enabled: false,
        detectorModelName: "bbox/face_yolov8m.pt",
      },
      handDetailer: {
        enabled: false,
        detectorModelName: "bbox/hand_yolov8s.pt",
      },
    });
  });

  it("keeps FaceDetailer and HandDetailer independently configurable", () => {
    const detailers = sanitizeGenerationDetailerSettingsSnapshot({
      faceDetailer: {
        enabled: true,
        detectorModelName: "bbox/custom-face.pt",
        steps: 18,
        denoise: 0.42,
      },
      handDetailer: {
        enabled: false,
        detectorModelName: "bbox/custom-hand.pt",
        steps: 21,
        denoise: 0.57,
      },
    });

    expect(detailers.faceDetailer).toMatchObject({
      enabled: true,
      detectorModelName: "bbox/custom-face.pt",
      steps: 18,
      denoise: 0.42,
    });
    expect(detailers.handDetailer).toMatchObject({
      enabled: false,
      detectorModelName: "bbox/custom-hand.pt",
      steps: 21,
      denoise: 0.57,
    });
  });
});
