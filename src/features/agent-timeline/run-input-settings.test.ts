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

    expect(settings.visualStyle).toBe("anime");
    expect(settings.stylePalette).toBeUndefined();
    expect(settings.styleReference).toBeUndefined();
    expect(settings.automaticLocalRepair).toBe(false);
    expect(settings.finalRedrawPreset).toBe("balanced");
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

  it("accepts only the closed visual-style values and otherwise defaults to anime", () => {
    expect(sanitizeRunSceneInputSettingsSnapshot({ visualStyle: "anime" }).visualStyle).toBe("anime");
    expect(sanitizeRunSceneInputSettingsSnapshot({ visualStyle: "photoreal" }).visualStyle).toBe("photoreal");

    for (const visualStyle of [
      undefined,
      null,
      "",
      "realistic",
      "photo",
      "ANIME",
      "__proto__",
      1,
      {},
      [],
    ]) {
      expect(sanitizeRunSceneInputSettingsSnapshot({ visualStyle }).visualStyle).toBe("anime");
    }
  });

  it("accepts only an explicit boolean true for automatic local repair", () => {
    expect(sanitizeRunSceneInputSettingsSnapshot({ automaticLocalRepair: true }).automaticLocalRepair).toBe(true);
    for (const automaticLocalRepair of [undefined, false, "true", 1, {}, []]) {
      expect(sanitizeRunSceneInputSettingsSnapshot({ automaticLocalRepair }).automaticLocalRepair).toBe(false);
    }
  });

  it("persists only supported Final redraw presets and rejects numeric denoise injection", () => {
    expect(sanitizeRunSceneInputSettingsSnapshot({ finalRedrawPreset: "strong" }).finalRedrawPreset).toBe("strong");
    expect(sanitizeRunSceneInputSettingsSnapshot({ finalRedrawPreset: "conservative" }).finalRedrawPreset)
      .toBe("conservative");
    expect(sanitizeRunSceneInputSettingsSnapshot({ finalRedrawPreset: 0.99, finalDenoise: 0.99 }).finalRedrawPreset)
      .toBe("balanced");
    for (const finalRedrawPreset of [undefined, "__proto__", "constructor", "toString", 1]) {
      expect(sanitizeRunSceneInputSettingsSnapshot({ finalRedrawPreset }).finalRedrawPreset).toBe("balanced");
    }
  });

  it("round-trips only sanitized Run style-reference metadata, analysis context, and adapter settings", () => {
    const settings = sanitizeRunSceneInputSettingsSnapshot({
      promptProfile: "illustrious",
      styleReference: {
        status: "ready",
        mode: "ipadapter",
        metadata: {
          byteLength: 512,
          contentType: "image/png",
          filename: "style.png",
          storedFilename: "0123456789abcdef0123456789abcdef.png",
          uploadedAt: "2026-07-19T00:00:00.000Z",
          url: "https://forged.invalid/style.png",
          bytes: [1, 2, 3],
        },
        analysis: {
          analyzedAt: "2026-07-19T00:00:01.000Z",
          model: "vision-model",
          stylePrompt: "soft gouache, cobalt shadows",
          summary: "Soft gouache.",
          dataUrl: "data:image/png;base64,SECRET",
        },
        ipAdapter: { weight: 0.45, start_at: 0, end_at: 1 },
        settingsSnapshot: {
          capturedAt: "2026-07-19T00:00:02.000Z",
          checkpointBaseModel: "Illustrious",
          checkpointId: "checkpoint-a",
          modeReason: "Illustrious supports IPAdapter.",
          promptProfile: "illustrious",
        },
        dataUrl: "data:image/png;base64,SECRET",
      },
    });

    expect(settings.styleReference).toMatchObject({
      status: "ready",
      mode: "ipadapter",
      metadata: {
        filename: "style.png",
        storedFilename: "0123456789abcdef0123456789abcdef.png",
        url: "/api/comfyui/sequence-references/0123456789abcdef0123456789abcdef.png",
      },
      analysis: {
        stylePrompt: "soft gouache, cobalt shadows",
      },
      ipAdapter: { weight: 0.45, startPercent: 0, endPercent: 1 },
    });
    expect(JSON.stringify(settings.styleReference)).not.toContain("SECRET");
    expect(JSON.stringify(settings.styleReference)).not.toContain("forged.invalid");
  });

  it("round-trips only safe Run character-reference metadata and preserves legacy byte-free defaults", () => {
    const settings = sanitizeRunSceneInputSettingsSnapshot({
      characterReference: {
        status: "ready",
        strength: 0.666,
        dataUrl: "data:image/png;base64,CHARACTER_SECRET",
        metadata: {
          byteLength: 512,
          contentType: "image/png",
          filename: "C:\\private\\hero.png",
          storedFilename: "fedcba9876543210fedcba9876543210.png",
          uploadedAt: "2026-07-19T00:00:00.000Z",
          url: "https://attacker.invalid/hero.png",
          bytes: [1, 2, 3],
        },
      },
      kreaReferenceStrength: "0.864",
    });

    expect(settings).toMatchObject({
      characterReference: {
        status: "ready",
        strength: 0.67,
        metadata: {
          storedFilename: "fedcba9876543210fedcba9876543210.png",
          url: "/api/comfyui/sequence-references/fedcba9876543210fedcba9876543210.png",
        },
      },
      kreaReferenceStrength: 0.86,
    });
    const serialized = JSON.stringify(settings);
    expect(serialized).not.toContain("CHARACTER_SECRET");
    expect(serialized).not.toContain("attacker.invalid");
    expect(serialized).not.toContain("C:\\\\private");

    expect(sanitizeRunSceneInputSettingsSnapshot({})).not.toHaveProperty("characterReference");
    expect(sanitizeRunSceneInputSettingsSnapshot({})).not.toHaveProperty("kreaReferenceStrength");
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
