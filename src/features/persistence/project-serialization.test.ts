import { describe, expect, it } from "vitest";

import type { SavedComicSequence, SavedComfyUiGeneratedImage } from "@/shared/types";
import { createDefaultProject, defaultCharacter, defaultCharacterMannequinJoints3D } from "@/features/editor/store/defaults";
import { serializePromptExport } from "@/features/prompt-engine";
import { isThreeDViewportPrimitive, sceneObjectsVisibleOn2DCanvas } from "@/features/editor/scene-viewport-objects";

import {
  getProjectContentFingerprint,
  importCanvasBundleFromJson,
  importProjectFromJson,
  importPromptLibraryBundleFromJson,
  isSceneForgeProject,
  parseProjectJson,
  SCENEFORGE_PROMPT_LIBRARY_EXPORT_KIND,
  serializeCanvasExport,
  serializeProject,
  serializePromptLibraryExport,
  stripPromptBindingsFromScene,
  stripSharedPromptStateFromProject,
} from "./project-serialization";

function createSavedComfyUiImage(
  patch: Partial<SavedComfyUiGeneratedImage> = {},
): SavedComfyUiGeneratedImage {
  return {
    id: "image-1",
    promptId: "prompt-1",
    batchId: "prompt-1:1",
    nodeId: "9",
    filename: "SceneForge_00001_.png",
    type: "output",
    url: "/api/comfyui/view?filename=SceneForge_00001_.png&type=output",
    seed: 42,
    source: "text-to-image",
    createdAt: "2026-05-26T10:00:00.000Z",
    favorited: false,
    outputNodeId: "9",
    width: 1024,
    height: 1024,
    positivePrompt: "cinematic portrait",
    negativePrompt: "low quality",
    parameters: {
      cfg: 7,
      denoise: 1,
      height: 1024,
      imageCount: 1,
      loras: [],
      outputPrefix: "SceneForge",
      samplerName: "euler",
      savedAt: "2026-05-26T10:00:00.000Z",
      scheduler: "normal",
      seed: 42,
      seedMode: "fixed",
      steps: 30,
      width: 1024,
    },
    selectedCheckpointId: "checkpoint-1",
    selectedLoraIds: ["lora-1"],
    ...patch,
  };
}

describe("project serialization", () => {
  it("round-trips valid project data without embedding prompt library in project JSON", () => {
    const project = createDefaultProject();
    project.settings.promptLibraryTags = [
      {
        id: "custom-1",
        label: "测试",
        prompt: "test",
        category: "style",
        weight: { enabled: false, value: 1 },
      },
    ];
    const serialized = serializeProject(project);
    const parsed = parseProjectJson(serialized);

    expect(stripSharedPromptStateFromProject(parsed)).toEqual(stripSharedPromptStateFromProject(project));
  });

  it("round-trips the project NSFW support setting", () => {
    const project = createDefaultProject();
    project.settings.supportsNsfw = true;

    const imported = importProjectFromJson(serializeProject(project));

    expect(imported.settings.supportsNsfw).toBe(true);
  });

  it("defaults missing project NSFW support to false", () => {
    const project = createDefaultProject();
    const raw = JSON.parse(serializeProject(project));
    delete raw.settings.supportsNsfw;

    const imported = importProjectFromJson(JSON.stringify(raw));

    expect(imported.settings.supportsNsfw).toBe(false);
  });

  it("round-trips saved ComfyUI FaceDetailer and HandDetailer parameters", () => {
    const project = createDefaultProject();
    project.settings.savedComfyUiGenerationParams = {
      cfg: 7,
      denoise: 1,
      faceDetailer: {
        bboxCropFactor: 2.4,
        bboxDilation: 14,
        bboxThreshold: 0.45,
        cfg: 5.5,
        cycle: 2,
        denoise: 0.4,
        enabled: true,
        detectorModelName: "bbox/face_yolov8s.pt",
        dropSize: 16,
        feather: 8,
        forceInpaint: false,
        guideSize: 640,
        guideSizeFor: false,
        maxSize: 1280,
        noiseMask: false,
        samBBoxExpansion: 6,
        samDetectionHint: "rect-4",
        samDilation: 3,
        samMaskHintThreshold: 0.62,
        samMaskHintUseNegative: "Small",
        samThreshold: 0.86,
        samplerName: "dpmpp_2m",
        scheduler: "karras",
        steps: 18,
        wildcard: "[LAB] face",
      },
      handDetailer: {
        bboxCropFactor: 2.8,
        bboxDilation: 18,
        bboxThreshold: 0.4,
        cfg: 6,
        cycle: 2,
        denoise: 0.45,
        enabled: true,
        detectorModelName: "bbox/hand_yolov8s.pt",
        dropSize: 20,
        feather: 6,
        forceInpaint: true,
        guideSize: 576,
        guideSizeFor: true,
        maxSize: 1152,
        noiseMask: true,
        samBBoxExpansion: 8,
        samDetectionHint: "center-1",
        samDilation: 4,
        samMaskHintThreshold: 0.64,
        samMaskHintUseNegative: "False",
        samThreshold: 0.9,
        samplerName: "dpmpp_2m",
        scheduler: "karras",
        steps: 20,
        wildcard: "[LAB] hand",
      },
      height: 1024,
      imageCount: 1,
      latentImageNode: "EmptyLatentImage",
      loras: [],
      outputPrefix: "SceneForge",
      promptWrapper: {
        negativePrefix: "",
        positivePrefix: "",
      },
      samplerName: "euler",
      savedAt: "2026-05-24T00:00:00.000Z",
      scheduler: "normal",
      seed: 123,
      seedMode: "fixed",
      steps: 30,
      width: 1024,
    };

    const parsed = parseProjectJson(serializeProject(project));

    expect(parsed.settings.savedComfyUiGenerationParams?.faceDetailer).toEqual({
      bboxCropFactor: 2.4,
      bboxDilation: 14,
      bboxThreshold: 0.45,
      cfg: 5.5,
      cycle: 2,
      denoise: 0.4,
      enabled: true,
      detectorModelName: "bbox/face_yolov8s.pt",
      dropSize: 16,
      feather: 8,
      forceInpaint: false,
      guideSize: 640,
      guideSizeFor: false,
      maxSize: 1280,
      noiseMask: false,
      samBBoxExpansion: 6,
      samDetectionHint: "rect-4",
      samDilation: 3,
      samMaskHintThreshold: 0.62,
      samMaskHintUseNegative: "Small",
      samThreshold: 0.86,
      samplerName: "dpmpp_2m",
      scheduler: "karras",
      steps: 18,
      wildcard: "[LAB] face",
    });
    expect(parsed.settings.savedComfyUiGenerationParams?.handDetailer).toEqual({
      bboxCropFactor: 2.8,
      bboxDilation: 18,
      bboxThreshold: 0.4,
      cfg: 6,
      cycle: 2,
      denoise: 0.45,
      enabled: true,
      detectorModelName: "bbox/hand_yolov8s.pt",
      dropSize: 20,
      feather: 6,
      forceInpaint: true,
      guideSize: 576,
      guideSizeFor: true,
      maxSize: 1152,
      noiseMask: true,
      samBBoxExpansion: 8,
      samDetectionHint: "center-1",
      samDilation: 4,
      samMaskHintThreshold: 0.64,
      samMaskHintUseNegative: "False",
      samThreshold: 0.9,
      samplerName: "dpmpp_2m",
      scheduler: "karras",
      steps: 20,
      wildcard: "[LAB] hand",
    });
  });

  it("round-trips saved Comic Sequence shots and per-shot node settings", () => {
    const project = createDefaultProject();
    const baseParameters = createSavedComfyUiImage().parameters;
    const savedComicSequence: SavedComicSequence = {
      version: 1,
      defaults: {
        ...baseParameters,
        seed: 1000,
        seedMode: "random",
      },
      selectedShotId: "shot-1",
      shots: [
        {
          id: "shot-1",
          title: "Opening panel",
          scene: project.scene,
          positivePrompt: "hero on rooftop",
          negativePrompt: "low quality",
          shotPrompt: "windy night, dutch angle",
          parameters: {
            ...baseParameters,
            cfg: 6.5,
            faceDetailer: {
              bboxCropFactor: 2.4,
              bboxDilation: 14,
              bboxThreshold: 0.45,
              cfg: 5.5,
              cycle: 2,
              denoise: 0.4,
              enabled: true,
              detectorModelName: "bbox/face_yolov8s.pt",
              dropSize: 16,
              feather: 8,
              forceInpaint: false,
              guideSize: 640,
              guideSizeFor: false,
              maxSize: 1280,
              noiseMask: false,
              samBBoxExpansion: 6,
              samDetectionHint: "rect-4",
              samDilation: 3,
              samMaskHintThreshold: 0.62,
              samMaskHintUseNegative: "Small",
              samThreshold: 0.86,
              samplerName: "dpmpp_2m",
              scheduler: "karras",
              steps: 18,
              wildcard: "[SEQ] face",
            },
            handDetailer: {
              bboxCropFactor: 2.8,
              bboxDilation: 18,
              bboxThreshold: 0.4,
              cfg: 6,
              cycle: 2,
              denoise: 0.45,
              enabled: false,
              detectorModelName: "bbox/hand_yolov8s.pt",
              dropSize: 20,
              feather: 6,
              forceInpaint: true,
              guideSize: 576,
              guideSizeFor: true,
              maxSize: 1152,
              noiseMask: true,
              samBBoxExpansion: 8,
              samDetectionHint: "center-1",
              samDilation: 4,
              samMaskHintThreshold: 0.64,
              samMaskHintUseNegative: "False",
              samThreshold: 0.9,
              samplerName: "dpmpp_2m",
              scheduler: "karras",
              steps: 20,
              wildcard: "[SEQ] hand",
            },
          },
          controlNets: [
            {
              type: "openpose",
              enabled: true,
              modelName: "control_v11p_sd15_openpose_fp16.safetensors",
              strength: 0.82,
              startPercent: 0.1,
              endPercent: 0.9,
            },
          ],
          reference: {
            characterName: "Hero",
            characterPrompt: "same scar and cape",
            face: {
              enabled: true,
              mode: "face",
              weight: 0.72,
              startAt: 0.2,
              endAt: 0.85,
              images: [
                {
                  id: "history-ref-1",
                  source: "history",
                  imageId: "image-1",
                },
              ],
            },
            character: {
              enabled: true,
              mode: "ipadapter",
              weight: 0.6,
              startAt: 0.1,
              endAt: 0.95,
              images: [
                {
                  id: "upload-ref-1",
                  source: "upload",
                  filename: "0123456789abcdef0123456789abcdef.png",
                  name: "uploaded-reference.png",
                  url: "/api/comfyui/sequence-references/0123456789abcdef0123456789abcdef.png",
                },
              ],
            },
            mode: "faceid",
            weight: 0.72,
            startAt: 0.2,
            endAt: 0.85,
            images: [
              {
                id: "history-ref-1",
                source: "history",
                imageId: "image-1",
              },
              {
                id: "upload-ref-1",
                source: "upload",
                filename: "0123456789abcdef0123456789abcdef.png",
                name: "uploaded-reference.png",
                url: "/api/comfyui/sequence-references/0123456789abcdef0123456789abcdef.png",
              },
            ],
          },
          boundImageIds: ["image-1", "image-2"],
          previousShotReference: {
            mode: "inpaint",
            denoise: 0.58,
            inpaintMode: "vae-inpaint",
            growMaskBy: 12,
          },
          createdAt: "2026-05-27T12:00:00.000Z",
          updatedAt: "2026-05-27T12:30:00.000Z",
        },
      ],
    };
    project.settings.savedComicSequence = savedComicSequence;

    const imported = importProjectFromJson(serializeProject(project));

    expect(imported.settings.savedComicSequence).toEqual(savedComicSequence);
  });

  it("sanitizes Comic Sequence previous-shot reference settings", () => {
    const project = createDefaultProject();
    const raw = JSON.parse(serializeProject(project));
    raw.settings.savedComicSequence = {
      version: 1,
      selectedShotId: "shot-valid",
      shots: [
        {
          id: "shot-valid",
          title: "Valid previous reference",
          scene: project.scene,
          positivePrompt: "valid prompt",
          negativePrompt: "",
          shotPrompt: "",
          parameters: createSavedComfyUiImage().parameters,
          controlNets: [],
          reference: {},
          boundImageIds: ["image-1", "", "image-1", 42],
          previousShotReference: {
            mode: "img2img",
            denoise: 0.02,
            inpaintMode: "vae-inpaint",
            growMaskBy: -20,
            sourceImage: { filename: "must-not-persist.png" },
            maskDataUrl: "data:image/png;base64,AAAA",
          },
          createdAt: "2026-05-27T12:00:00.000Z",
          updatedAt: "2026-05-27T12:00:00.000Z",
        },
        {
          id: "shot-invalid",
          title: "Invalid previous reference",
          scene: project.scene,
          positivePrompt: "invalid prompt",
          negativePrompt: "",
          shotPrompt: "",
          parameters: createSavedComfyUiImage().parameters,
          controlNets: [],
          reference: {},
          previousShotReference: {
            mode: "off",
            denoise: 0.4,
            inpaintMode: "vae-inpaint",
            growMaskBy: 8,
          },
          createdAt: "2026-05-27T12:00:00.000Z",
          updatedAt: "2026-05-27T12:00:00.000Z",
        },
      ],
    };

    const imported = importProjectFromJson(JSON.stringify(raw));
    const shots = imported.settings.savedComicSequence?.shots ?? [];

    expect(shots[0]?.previousShotReference).toEqual({
      mode: "img2img",
      denoise: 0.1,
      inpaintMode: "vae-inpaint",
      growMaskBy: 0,
    });
    expect(shots[0]?.boundImageIds).toEqual(["image-1"]);
    expect(shots[1]?.previousShotReference).toBeUndefined();
  });

  it("migrates legacy Comic Sequence reference mode into independent channels", () => {
    const project = createDefaultProject();
    const raw = JSON.parse(serializeProject(project));
    raw.settings.savedComicSequence = {
      version: 1,
      selectedShotId: "shot-legacy",
      shots: [
        {
          id: "shot-legacy",
          title: "Legacy shot",
          scene: project.scene,
          positivePrompt: "legacy prompt",
          negativePrompt: "",
          shotPrompt: "",
          parameters: createSavedComfyUiImage().parameters,
          controlNets: [],
          reference: {
            characterName: "Hero",
            characterPrompt: "scar",
            mode: "ipadapter",
            weight: 0.5,
            startAt: 0.15,
            endAt: 0.8,
            images: [
              {
                id: "legacy-ref",
                source: "history",
                imageId: "image-1",
              },
            ],
          },
          createdAt: "2026-05-27T12:00:00.000Z",
          updatedAt: "2026-05-27T12:00:00.000Z",
        },
      ],
    };

    const imported = importProjectFromJson(JSON.stringify(raw));
    const reference = imported.settings.savedComicSequence?.shots[0]?.reference;

    expect(reference?.character).toMatchObject({
      enabled: true,
      mode: "ipadapter",
      weight: 0.5,
      startAt: 0.15,
      endAt: 0.8,
      images: [
        {
          id: "legacy-ref",
          source: "history",
          imageId: "image-1",
        },
      ],
    });
    expect(reference?.face).toMatchObject({
      enabled: false,
      images: [],
      mode: "face",
    });
  });

  it("defaults missing ComfyUI generated image history to an empty array", () => {
    const project = createDefaultProject();
    const raw = JSON.parse(serializeProject(project));
    delete raw.settings.comfyUiGeneratedImages;

    const imported = importProjectFromJson(JSON.stringify(raw));

    expect(imported.settings.comfyUiGeneratedImages).toEqual([]);
  });

  it("round-trips valid ComfyUI generated image history", () => {
    const project = createDefaultProject();
    const historyImage = createSavedComfyUiImage({
      id: "history-image",
      source: "inpaint",
      parentImageId: "parent-image",
      favorited: true,
    });
    project.settings.comfyUiGeneratedImages = [historyImage];

    const imported = importProjectFromJson(serializeProject(project));

    expect(imported.settings.comfyUiGeneratedImages).toEqual([historyImage]);
  });

  it("round-trips ComfyUI sequence image metadata", () => {
    const project = createDefaultProject();
    const historyImage = createSavedComfyUiImage({
      source: "sequence",
      sequenceId: "seq-1",
      shotId: "shot-2",
      characterReferenceIds: ["hero-ref", "side-ref"],
    });
    project.settings.comfyUiGeneratedImages = [historyImage];

    const imported = importProjectFromJson(serializeProject(project));

    expect(imported.settings.comfyUiGeneratedImages).toEqual([historyImage]);
  });

  it("round-trips SceneForge-managed ComfyUI generated image storage metadata", () => {
    const project = createDefaultProject();
    const historyImage = createSavedComfyUiImage({
      storage: "sceneforge",
      localFilename: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png",
      url: "/api/comfyui/generated-images/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png",
      sourceReference: {
        filename: "ComfyUI_temp_00001_.png",
        type: "temp",
      },
    });
    project.settings.comfyUiGeneratedImages = [historyImage];

    const imported = importProjectFromJson(serializeProject(project));

    expect(imported.settings.comfyUiGeneratedImages).toEqual([historyImage]);
  });

  it("infers SceneForge-managed image filenames from generated image URLs", () => {
    const project = createDefaultProject();
    const historyImage = createSavedComfyUiImage({
      url: "/api/comfyui/generated-images/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png",
    });
    project.settings.comfyUiGeneratedImages = [historyImage];

    const imported = importProjectFromJson(serializeProject(project));

    expect(imported.settings.comfyUiGeneratedImages[0]).toMatchObject({
      storage: "sceneforge",
      localFilename: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png",
    });
  });

  it("filters invalid ComfyUI generated image history records", () => {
    const project = createDefaultProject();
    const raw = JSON.parse(serializeProject(project));
    raw.settings.comfyUiGeneratedImages = [
      createSavedComfyUiImage({ id: "valid-image" }),
      { id: "missing-required-fields" },
      createSavedComfyUiImage({ id: "missing-parameters", parameters: null as never }),
    ];

    const imported = importProjectFromJson(JSON.stringify(raw));

    expect(imported.settings.comfyUiGeneratedImages).toHaveLength(1);
    expect(imported.settings.comfyUiGeneratedImages[0].id).toBe("valid-image");
  });

  it("merges duplicate ComfyUI generated image history records and preserves favorites", () => {
    const project = createDefaultProject();
    const raw = JSON.parse(serializeProject(project));
    raw.settings.comfyUiGeneratedImages = [
      createSavedComfyUiImage({
        id: "older-favorite",
        createdAt: "2026-05-26T10:00:00.000Z",
        favorited: true,
      }),
      createSavedComfyUiImage({
        id: "newer-duplicate",
        createdAt: "2026-05-26T11:00:00.000Z",
        favorited: false,
      }),
    ];

    const imported = importProjectFromJson(JSON.stringify(raw));

    expect(imported.settings.comfyUiGeneratedImages).toHaveLength(1);
    expect(imported.settings.comfyUiGeneratedImages[0]).toMatchObject({
      id: "newer-duplicate",
      favorited: true,
    });
  });

  it("keeps favorites and trims old unfavorited ComfyUI generated images over the history limit", () => {
    const project = createDefaultProject();
    const raw = JSON.parse(serializeProject(project));
    raw.settings.comfyUiGeneratedImages = [
      createSavedComfyUiImage({
        id: "favorite-old-1",
        filename: "favorite-old-1.png",
        createdAt: "2026-05-20T00:00:00.000Z",
        favorited: true,
      }),
      createSavedComfyUiImage({
        id: "favorite-old-2",
        filename: "favorite-old-2.png",
        createdAt: "2026-05-20T00:01:00.000Z",
        favorited: true,
      }),
      ...Array.from({ length: 205 }, (_, index) =>
        createSavedComfyUiImage({
          id: `unfavorited-${index}`,
          filename: `unfavorited-${index}.png`,
          createdAt: new Date(Date.UTC(2026, 4, 21, 0, index)).toISOString(),
          favorited: false,
        }),
      ),
    ];

    const imported = importProjectFromJson(JSON.stringify(raw));
    const ids = imported.settings.comfyUiGeneratedImages.map((image) => image.id);

    expect(imported.settings.comfyUiGeneratedImages).toHaveLength(200);
    expect(ids).toContain("favorite-old-1");
    expect(ids).toContain("favorite-old-2");
    expect(ids).toContain("unfavorited-204");
    expect(ids).not.toContain("unfavorited-0");
  });

  it("rejects invalid imported data", () => {
    expect(isSceneForgeProject({ version: 1 })).toBe(false);
    expect(() => parseProjectJson(JSON.stringify({ version: 1 }))).toThrow(
      "Invalid SceneForge project data.",
    );
  });

  it("falls back to generic format when importing legacy Midjourney settings", () => {
    const project = createDefaultProject();
    const raw = JSON.parse(serializeProject(project));
    raw.settings.modelFormat = "midjourney";

    const imported = importProjectFromJson(JSON.stringify(raw));

    expect(imported.settings.modelFormat).toBe("generic");
  });

  it("clamps imported 3D scene config to viewport-safe ranges", () => {
    const project = createDefaultProject();
    project.scene.three.camera.fov = 500;
    project.scene.three.lighting.ambientIntensity = -1;
    project.scene.three.lighting.directionalIntensity = 9;
    project.scene.three.grid = { size: 0, divisions: 2.6 };

    const imported = importProjectFromJson(JSON.stringify(project));

    expect(imported.scene.three.camera.fov).toBe(100);
    expect(imported.scene.three.lighting.ambientIntensity).toBe(0);
    expect(imported.scene.three.lighting.directionalIntensity).toBe(3);
    expect(imported.scene.three.grid).toEqual({ size: 2, divisions: 3 });
  });

  it("round-trips and sanitizes character 3D transforms", () => {
    const project = createDefaultProject();
    project.scene.characters.push({
      ...structuredClone(defaultCharacter),
      id: "character-3d",
      transform3D: {
        position: { x: 2, y: 0, z: -1 },
        rotation: { x: 0, y: 45, z: 0 },
        scale: { x: 1.2, y: 1.2, z: 1.2 },
      },
    });

    const imported = importProjectFromJson(serializeProject(project));

    expect(imported.scene.characters[0].transform3D).toEqual({
      position: { x: 2, y: 0, z: -1 },
      rotation: { x: 0, y: 45, z: 0 },
      scale: { x: 1.2, y: 1.2, z: 1.2 },
    });

    const raw = JSON.parse(serializeProject(project));
    raw.scene.characters[0].transform3D = {
      position: { x: "bad", y: 3, z: Number.NaN },
      rotation: { x: 10, y: "bad", z: 20 },
      scale: { x: 2, y: null, z: 3 },
    };

    const sanitized = importProjectFromJson(JSON.stringify(raw));
    expect(sanitized.scene.characters[0].transform3D).toEqual({
      position: { x: 0, y: 3, z: 0 },
      rotation: { x: 10, y: 0, z: 20 },
      scale: { x: 2, y: 1, z: 3 },
    });
  });

  it("importProjectFromJson rejects prompt export files", () => {
    const promptJson = serializePromptExport(createDefaultProject(), "");
    expect(() => importProjectFromJson(promptJson)).toThrow("导入词库 JSON");
  });

  it("importProjectFromJson rejects canvas bundle files", () => {
    const canvasJson = serializeCanvasExport(createDefaultProject());
    expect(() => importProjectFromJson(canvasJson)).toThrow("导入画布 JSON");
  });

  it("importProjectFromJson rejects prompt library bundle files", () => {
    const libJson = serializePromptLibraryExport(createDefaultProject());
    expect(() => importProjectFromJson(libJson)).toThrow("导入词库 JSON");
  });

  it("round-trips canvas export bundle", () => {
    const project = createDefaultProject();
    project.scene.name = "画布备份";
    const scene = importCanvasBundleFromJson(serializeCanvasExport(project));
    expect(stripPromptBindingsFromScene(scene)).toEqual(stripPromptBindingsFromScene(project.scene));
  });

  it("round-trips prompt library export bundle", () => {
    const project = createDefaultProject();
    project.settings.promptLibraryTags = [
      {
        id: "custom-1",
        label: "测试",
        prompt: "test",
        category: "style",
        subcategory: "style-rendering",
        weight: { enabled: false, value: 1 },
      },
    ];
    project.settings.deletedBuiltInPromptLibraryTagIds = ["builtin-a"];
    const lib = importPromptLibraryBundleFromJson(serializePromptLibraryExport(project));
    expect(lib.promptLibraryTags).toEqual(project.settings.promptLibraryTags);
    expect(lib.deletedBuiltInPromptLibraryTagIds).toEqual(["builtin-a"]);
  });

  it("importPromptLibraryBundleFromJson extracts library from full project JSON", () => {
    const project = createDefaultProject();
    project.settings.promptLibraryTags = [
      {
        id: "x",
        label: "L",
        prompt: "p",
        category: "style",
        subcategory: "style-color",
        weight: { enabled: false, value: 1 },
      },
    ];
    const lib = importPromptLibraryBundleFromJson(serializePromptLibraryExport(project));
    expect(lib.promptLibraryTags).toEqual(project.settings.promptLibraryTags);
  });

  it("remaps dropped outfit subcategories when importing prompt library", () => {
    const json = JSON.stringify({
      kind: SCENEFORGE_PROMPT_LIBRARY_EXPORT_KIND,
      version: 1,
      promptLibraryTags: [
        {
          id: "old-bag",
          label: "包",
          prompt: "backpack",
          category: "outfit",
          subcategory: "outfit-bag",
          weight: { value: 1, enabled: false },
        },
      ],
      deletedBuiltInPromptLibraryTagIds: [],
    });

    const lib = importPromptLibraryBundleFromJson(json);
    expect(lib.promptLibraryTags[0]?.subcategory).toBe("outfit-accessory");
  });

  it("migrates legacy character clothing/accessory tags to the outfit taxonomy", () => {
    const json = JSON.stringify({
      kind: SCENEFORGE_PROMPT_LIBRARY_EXPORT_KIND,
      version: 1,
      promptLibraryTags: [
        {
          id: "old-shirt",
          label: "衬衫",
          prompt: "white shirt",
          category: "character",
          subcategory: "character-clothing",
          weight: { value: 1, enabled: false },
        },
        {
          id: "old-ring",
          label: "戒指",
          prompt: "ring",
          category: "character",
          subcategory: "character-accessory",
          weight: { value: 1, enabled: false },
        },
      ],
      deletedBuiltInPromptLibraryTagIds: [],
    });

    const lib = importPromptLibraryBundleFromJson(json);
    expect(lib.promptLibraryTags[0]?.category).toBe("outfit");
    expect(lib.promptLibraryTags[0]?.subcategory).toBe("outfit-full");
    expect(lib.promptLibraryTags[1]?.category).toBe("outfit");
    expect(lib.promptLibraryTags[1]?.subcategory).toBe("outfit-accessory");
  });

  it("migrates legacy prompt subcategory bindings on character import", () => {
    const project = createDefaultProject();
    const raw = JSON.parse(serializeProject(project)) as Record<string, unknown>;
    const char = structuredClone(defaultCharacter) as Record<string, unknown>;
    char.id = "legacy-bindings";
    char.promptCategoryBindings = ["character", "body-part"];
    char.promptSubcategoryBindings = ["character-subject", "character-clothing", "body-part-hair"];
    raw.scene = { ...(raw.scene as object), characters: [char] } as unknown;

    const imported = importProjectFromJson(JSON.stringify(raw));
    const first = imported.scene.characters[0];
    expect(first?.promptCategoryBindings).toEqual(["character", "body-part", "outfit"]);
    expect(first?.promptSubcategoryBindings).toContain("outfit-full");
    expect(first?.promptSubcategoryBindings).not.toContain("character-clothing");
  });

  it("keeps valid prompt library subcategories and drops invalid ones", () => {
    const json = JSON.stringify({
      kind: SCENEFORGE_PROMPT_LIBRARY_EXPORT_KIND,
      version: 1,
      promptLibraryTags: [
        {
          id: "valid",
          label: "雨天",
          prompt: "rainy day",
          category: "scene",
          subcategory: "scene-weather",
          weight: { value: 1, enabled: false },
        },
        {
          id: "invalid",
          label: "错位",
          prompt: "blue eyes",
          category: "body-part",
          subcategory: "scene-weather",
          weight: { value: 1, enabled: false },
        },
      ],
      deletedBuiltInPromptLibraryTagIds: [],
    });

    const lib = importPromptLibraryBundleFromJson(json);
    expect(lib.promptLibraryTags[0]?.subcategory).toBe("scene-weather");
    expect(lib.promptLibraryTags[1]?.subcategory).toBeUndefined();
  });

  it("importCanvasBundleFromJson extracts scene from full project JSON", () => {
    const project = createDefaultProject();
    project.scene.name = "从完整项目来";
    const scene = importCanvasBundleFromJson(serializeProject(project));
    expect(scene.name).toBe("从完整项目来");
  });

  it("importPromptLibraryBundleFromJson accepts version as string and skips junk entries", () => {
    const json = JSON.stringify({
      kind: SCENEFORGE_PROMPT_LIBRARY_EXPORT_KIND,
      version: "1",
      promptLibraryTags: [
        null,
        { id: "keep", label: "OK", prompt: "p", category: "style", weight: { value: 1, enabled: false } },
        { id: "keep", label: "Dup id", prompt: "p2", category: "scene", weight: { value: 1, enabled: false } },
      ],
      deletedBuiltInPromptLibraryTagIds: [],
    });
    const lib = importPromptLibraryBundleFromJson(json);
    expect(lib.promptLibraryTags).toHaveLength(1);
    expect(lib.promptLibraryTags[0]?.id).toBe("keep");
    expect(lib.promptLibraryTags[0]?.label).toBe("OK");
  });

  it("importProjectFromJson coerces missing scene arrays", () => {
    const minimal = {
      id: "p1",
      name: "Test",
      version: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      scene: {},
      settings: {},
    };
    const imported = importProjectFromJson(JSON.stringify(minimal));
    expect(imported.scene.objects).toEqual([]);
    expect(imported.scene.characters).toEqual([]);
    expect(imported.scene.promptTags).toEqual([]);
    expect(Array.isArray(imported.settings.promptLibraryTags)).toBe(true);
    expect(imported.settings.selectedCivitaiCheckpointId).toBeNull();
    expect(imported.settings.selectedCivitaiLoraIds).toEqual([]);
    expect(imported.settings.selectedArtistStringIds).toEqual([]);
    expect(imported.settings.selectedArtistStringPrompts).toEqual([]);
    expect(imported.settings.artistStringPromptRenderMode).toBe("artist-weight");
  });

  it("normalizes selected external resources on project import", () => {
    const project = createDefaultProject();
    const raw = JSON.parse(serializeProject(project));
    raw.settings.selectedCivitaiCheckpointId = " checkpoint-a ";
    raw.settings.selectedCivitaiLoraIds = ["lora-a", "lora-b", "lora-a", "", 12, " lora-c "];
    raw.settings.selectedArtistStringIds = ["artist-string-a", " artist-string-b ", "artist-string-a", "", 12];
    raw.settings.selectedArtistStringPrompts = [" {artist:foo}, bar ", "{artist:bar}", "{artist:foo}, bar", "", 12];
    raw.settings.artistStringPromptRenderMode = "by-weight";

    const imported = importProjectFromJson(JSON.stringify(raw));

    expect(imported.settings.selectedCivitaiCheckpointId).toBe("checkpoint-a");
    expect(imported.settings.selectedCivitaiLoraIds).toEqual(["lora-a", "lora-b", "lora-c"]);
    expect(imported.settings.selectedArtistStringIds).toEqual(["artist-string-a", "artist-string-b"]);
    expect(imported.settings.selectedArtistStringPrompts).toEqual(["{artist:foo}, bar", "{artist:bar}"]);
    expect(imported.settings.artistStringPromptRenderMode).toBe("by-weight");
  });

  it("migrates legacy selected artist string settings on project import", () => {
    const project = createDefaultProject();
    const raw = JSON.parse(serializeProject(project));
    raw.settings.selectedArtistStringId = " artist-string-a ";
    raw.settings.selectedArtistStringPrompt = " {artist:foo}, bar ";
    delete raw.settings.selectedArtistStringIds;
    delete raw.settings.selectedArtistStringPrompts;

    const imported = importProjectFromJson(JSON.stringify(raw));

    expect(imported.settings.selectedArtistStringIds).toEqual(["artist-string-a"]);
    expect(imported.settings.selectedArtistStringPrompts).toEqual(["{artist:foo}, bar"]);
  });

  it("coerces target prompt category bindings on import", () => {
    const project = createDefaultProject();
    project.scene.promptCategoryBindings = ["scene", "scene", "bad" as never];
    project.scene.promptSubcategoryBindings = [
      "scene-weather",
      "scene-weather",
      "style-color",
      "bad" as never,
    ];
    project.scene.objects.push({
      id: "object-1",
      kind: "rectangle",
      name: "对象",
      description: "",
      position: { x: 0, y: 0 },
      size: { width: 120, height: 120 },
      rotation: 0,
      layer: 1,
      fill: "#e2e8f0",
      includeInPrompt: true,
      weight: { enabled: false, value: 1 },
      promptTags: [],
      promptCategoryBindings: ["character"],
      promptSubcategoryBindings: ["character-pose", "scene-prop"],
    });
    project.scene.characters.push({
      ...structuredClone(defaultCharacter),
      id: "character-1",
      promptCategoryBindings: [],
      promptSubcategoryBindings: ["character-expression"],
      bodyParts: [
        {
          id: "head",
          label: "头部",
          promptTags: [],
          promptCategoryBindings: ["body-part", "negative", "body-part"],
          promptSubcategoryBindings: [
            "body-part-hair",
            "negative-quality",
            "scene-weather",
            "body-part-hair",
          ],
        },
      ],
    });

    const imported = importProjectFromJson(JSON.stringify(project));

    expect(imported.scene.promptCategoryBindings).toEqual(["scene"]);
    expect(imported.scene.promptSubcategoryBindings).toEqual(["scene-weather"]);
    expect(imported.scene.objects[0]?.promptCategoryBindings).toEqual(["character"]);
    expect(imported.scene.objects[0]?.promptSubcategoryBindings).toEqual(["character-pose"]);
    expect(imported.scene.characters[0]?.promptCategoryBindings).toEqual(["character"]);
    expect(imported.scene.characters[0]?.promptSubcategoryBindings).toEqual([
      "character-expression",
    ]);
    expect(imported.scene.characters[0]?.bodyParts[0]?.promptCategoryBindings).toEqual([
      "body-part",
      "negative",
    ]);
    expect(imported.scene.characters[0]?.bodyParts[0]?.promptSubcategoryBindings).toEqual([
      "body-part-hair",
      "negative-quality",
    ]);
  });

  it("dedupes duplicate ids in scene and settings on import", () => {
    const project = createDefaultProject();
    const tag: (typeof project.scene.promptTags)[number] = {
      id: "dup-tag",
      label: "重复",
      prompt: "test",
      category: "style",
      weight: { enabled: false, value: 1 },
    };
    project.scene.promptTags = [tag, { ...tag }];

    const libTag: (typeof project.settings.promptLibraryTags)[number] = {
      id: "lib-dup",
      label: "库",
      prompt: "lib",
      category: "scene",
      weight: { enabled: false, value: 1 },
    };
    project.settings.promptLibraryTags = [libTag, { ...libTag }];
    project.settings.deletedBuiltInPromptLibraryTagIds = ["a", "a", "b"];

    const imported = importProjectFromJson(JSON.stringify(project));
    expect(imported.scene.promptTags).toHaveLength(1);
    expect(imported.settings.promptLibraryTags).toHaveLength(1);
    expect(imported.settings.deletedBuiltInPromptLibraryTagIds).toEqual(["a", "b"]);
  });

  it("getProjectContentFingerprint ignores id, timestamps, and prompt library", () => {
    const base = createDefaultProject();
    base.settings.promptLibraryTags = [
      {
        id: "only-in-base",
        label: "L",
        prompt: "p",
        category: "style",
        weight: { enabled: false, value: 1 },
      },
    ];
    const other: typeof base = {
      ...base,
      id: "other-id",
      createdAt: "2000-01-01T00:00:00.000Z",
      updatedAt: "2099-01-01T00:00:00.000Z",
      settings: {
        ...base.settings,
        promptLibraryTags: [],
        deletedBuiltInPromptLibraryTagIds: [],
      },
    };
    expect(getProjectContentFingerprint(base)).toBe(getProjectContentFingerprint(other));
  });

  it("round-trips line, polygon, preset, and image-placeholder scene objects", () => {
    const project = createDefaultProject();
    project.scene.objects = [
      {
        id: "obj-line",
        kind: "line",
        name: "线",
        description: "",
        position: { x: 10, y: 20 },
        size: { width: 100, height: 40 },
        rotation: 0,
        layer: 0,
        fill: "#000000",
        includeInPrompt: true,
        weight: { enabled: false, value: 1 },
        promptTags: [],
        lineEndpoints: { x1: 0, y1: 20, x2: 100, y2: 20 },
      },
      {
        id: "obj-poly",
        kind: "polygon",
        name: "三",
        description: "",
        position: { x: 0, y: 0 },
        size: { width: 50, height: 50 },
        rotation: 0,
        layer: 1,
        fill: "#00ff00",
        includeInPrompt: true,
        weight: { enabled: false, value: 1 },
        promptTags: [],
        polygonPoints: [
          { x: 0, y: 50 },
          { x: 25, y: 0 },
          { x: 50, y: 50 },
        ],
      },
      {
        id: "obj-preset",
        kind: "preset",
        name: "树",
        description: "tree",
        position: { x: 5, y: 5 },
        size: { width: 80, height: 100 },
        rotation: 0,
        layer: 2,
        fill: "#006600",
        includeInPrompt: true,
        weight: { enabled: false, value: 1 },
        promptTags: [],
        presetKey: "preset-tree",
      },
      {
        id: "obj-img",
        kind: "image-placeholder",
        name: "图",
        description: "",
        position: { x: 1, y: 2 },
        size: { width: 60, height: 70 },
        rotation: 0,
        layer: 3,
        fill: "#cccccc",
        includeInPrompt: true,
        weight: { enabled: false, value: 1 },
        promptTags: [],
        imageLabel: "Ref",
      },
    ];

    const imported = importProjectFromJson(serializeProject(project));

    expect(imported.scene.objects).toHaveLength(4);
    expect(imported.scene.objects[0]?.kind).toBe("line");
    expect(imported.scene.objects[0]?.lineEndpoints).toEqual({ x1: 0, y1: 20, x2: 100, y2: 20 });
    expect(imported.scene.objects[1]?.polygonPoints).toHaveLength(3);
    expect(imported.scene.objects[2]?.presetKey).toBe("preset-tree");
    expect(imported.scene.objects[3]?.imageLabel).toBe("Ref");
  });

  it("round-trips 3D scene mode and primitive transforms", () => {
    const project = createDefaultProject();
    project.scene.mode = "3d";
    project.scene.three.camera.position = { x: 7, y: 6, z: 8 };
    project.scene.three.camera.target = { x: 0, y: 1.2, z: -1 };
    project.scene.three.camera.fov = 52;
    project.scene.three.lighting.ambientIntensity = 0.35;
    project.scene.three.lighting.directionalIntensity = 1.7;
    project.scene.three.lighting.directionalPosition = { x: -3, y: 9, z: 2 };
    project.scene.three.grid = { size: 18, divisions: 9 };
    project.scene.objects = [
      {
        id: "obj-cube",
        kind: "cube",
        name: "立方体",
        description: "blue cube",
        position: { x: 0, y: 0 },
        size: { width: 120, height: 120 },
        rotation: 0,
        layer: 0,
        fill: "#60a5fa",
        includeInPrompt: true,
        weight: { enabled: false, value: 1 },
        promptTags: [],
        transform3D: {
          position: { x: 1, y: 0.5, z: -2 },
          rotation: { x: 0, y: 45, z: 0 },
          scale: { x: 1.5, y: 1, z: 1 },
        },
      },
    ];

    const imported = importProjectFromJson(serializeProject(project));

    expect(imported.scene.mode).toBe("3d");
    expect(imported.scene.three).toMatchObject({
      camera: {
        position: { x: 7, y: 6, z: 8 },
        target: { x: 0, y: 1.2, z: -1 },
        fov: 52,
      },
      lighting: {
        ambientIntensity: 0.35,
        directionalIntensity: 1.7,
        directionalPosition: { x: -3, y: 9, z: 2 },
      },
      grid: { size: 18, divisions: 9 },
    });
    expect(imported.scene.objects[0]?.kind).toBe("cube");
    expect(imported.scene.objects[0]?.transform3D).toEqual({
      position: { x: 1, y: 0.5, z: -2 },
      rotation: { x: 0, y: 45, z: 0 },
      scale: { x: 1.5, y: 1, z: 1 },
    });
  });

  it("round-trips 3D preset transforms so they stay in the 3D viewport", () => {
    const project = createDefaultProject();
    project.scene.mode = "3d";
    project.scene.objects = [
      {
        id: "obj-preset-3d",
        kind: "preset",
        name: "桌子",
        description: "table",
        position: { x: 0, y: 0 },
        size: { width: 160, height: 80 },
        rotation: 0,
        layer: 0,
        fill: "#a16207",
        includeInPrompt: true,
        weight: { enabled: false, value: 1 },
        promptTags: [],
        presetKey: "preset-table",
        transform3D: {
          position: { x: 2, y: 0.4, z: -1 },
          rotation: { x: 0, y: 30, z: 0 },
          scale: { x: 1.6, y: 0.8, z: 0.8 },
        },
      },
    ];

    const imported = importProjectFromJson(serializeProject(project));
    const object = imported.scene.objects[0];

    expect(object?.transform3D).toEqual({
      position: { x: 2, y: 0.4, z: -1 },
      rotation: { x: 0, y: 30, z: 0 },
      scale: { x: 1.6, y: 0.8, z: 0.8 },
    });
    expect(object && isThreeDViewportPrimitive(object)).toBe(true);
    expect(sceneObjectsVisibleOn2DCanvas(imported.scene.objects)).toHaveLength(0);
  });

  it("migrates legacy character joints3D to stickFigurePose3D on import", () => {
    const base = createDefaultProject();
    const payload = {
      ...base,
      scene: {
        ...base.scene,
        characters: [
          {
            ...defaultCharacter,
            id: "char-migrate",
            name: "迁移",
            characterSpace: "3d" as const,
            joints3D: { ...defaultCharacterMannequinJoints3D },
          },
        ],
      },
    };
    const imported = importProjectFromJson(JSON.stringify(payload));
    const ch = imported.scene.characters[0];
    expect(ch?.stickFigurePose3D?.version).toBe(1);
    expect(Number.isFinite(ch?.stickFigurePose3D?.joints.pelvis.y)).toBe(true);
    expect(ch?.joints3D).toBeUndefined();
  });
});
