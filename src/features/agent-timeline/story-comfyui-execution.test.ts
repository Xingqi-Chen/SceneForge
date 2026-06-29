import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { ComfyUiGenerateImageResponse, ComfyUiTextToImageRequest } from "@/features/comfyui";

import {
  createStoryComfyUiExecutionAdapter,
  StoryComfyUiExecutionError,
  type StoryComfyUiExecutionClient,
} from "./story-comfyui-execution";
import { executeStoryShotGraph } from "./story-execution";
import type { StoryExecutionRequestBatch } from "./story-planning";

const nsfwContext = {
  audienceRating: "safe",
  contentWarnings: [],
  enabled: false,
  rationale: "test",
} as const;

const baseRequest = {
  checkpointName: "local.safetensors",
  positivePrompt: "rainy station shot",
  width: 1024,
  height: 768,
} satisfies ComfyUiTextToImageRequest;

function createBatch(request: ComfyUiTextToImageRequest = baseRequest): StoryExecutionRequestBatch {
  return {
    mode: "final",
    nsfwContext: {
      ...nsfwContext,
      contentWarnings: [...nsfwContext.contentWarnings],
    },
    requests: [
      {
        nsfwContext: {
          ...nsfwContext,
          contentWarnings: [...nsfwContext.contentWarnings],
        },
        request,
        shotId: "shot-a",
        sourceShotIds: [],
      },
    ],
    storyId: "story-1",
  };
}

function createQueuedResponse(request: ComfyUiTextToImageRequest): ComfyUiGenerateImageResponse {
  return {
    nodeErrors: undefined,
    nodeIds: {
      outputImage: "9",
    },
    number: 7,
    outputNodeId: "9",
    promptId: "prompt-shot-a",
    promptWrapper: {
      negativeNodeId: "3",
      positiveNodeId: "2",
    },
    raw: {
      prompt_id: "prompt-shot-a",
    },
    request,
    workflow: {},
  } as unknown as ComfyUiGenerateImageResponse;
}

function createClient() {
  const getHistory = vi
    .fn<StoryComfyUiExecutionClient["getHistory"]>()
    .mockResolvedValueOnce({
      "prompt-shot-a": {},
    })
    .mockResolvedValueOnce({
      "prompt-shot-a": {
        outputs: {
          "9": {
            images: [
              {
                filename: "shot-a.png",
                type: "output",
              },
            ],
          },
        },
      },
    });
  const client = {
    buildViewUrl: vi.fn<StoryComfyUiExecutionClient["buildViewUrl"]>((image) =>
      `http://comfyui.test/view?filename=${image.filename}&type=${image.type ?? ""}`,
    ),
    generateImage: vi.fn<StoryComfyUiExecutionClient["generateImage"]>((request) =>
      Promise.resolve(createQueuedResponse(request)),
    ),
    getHistory,
    getObjectInfo: vi.fn<StoryComfyUiExecutionClient["getObjectInfo"]>().mockResolvedValue({
      CheckpointLoaderSimple: {},
    }),
    uploadImage: vi.fn<StoryComfyUiExecutionClient["uploadImage"]>(async (request) => ({
      filename: request.filename,
      imageName: request.filename,
      raw: {},
      type: "input",
    })),
  } satisfies StoryComfyUiExecutionClient;

  return client;
}

function createAnimaObjectInfo() {
  return {
    CLIPLoader: {
      input: {
        optional: {
          device: [["default"], {}],
        },
        required: {
          clip_name: [["qwen_3_06b_base.safetensors"], {}],
          type: [["qwen_image"], {}],
        },
      },
    },
    CLIPTextEncode: {},
    EmptyLatentImage: {},
    KSampler: {
      input: {
        required: {
          sampler_name: [["euler"], {}],
          scheduler: [["normal"], {}],
        },
      },
    },
    LoadImage: {},
    PreviewImage: {},
    UNETLoader: {
      input: {
        required: {
          unet_name: [["anima.safetensors"], {}],
          weight_dtype: [["default"], {}],
        },
      },
    },
    VAEDecode: {},
    VAELoader: {
      input: {
        required: {
          vae_name: [["qwen_image_vae.safetensors"], {}],
        },
      },
    },
  };
}

describe("story ComfyUI execution adapter", () => {
  it("reuses ComfyUI validation, object_info, queue, history, view fetch, and generated image storage helpers", async () => {
    const client = createClient();
    const fetchImage = vi.fn(async () => ({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
    }));
    const storeImage = vi.fn(async (bytes: Uint8Array, contentType: string | null) => ({
      byteLength: bytes.byteLength,
      contentType: contentType ?? "image/png",
      filename: "stored-shot-a.png",
      url: "/api/comfyui/generated-images/stored-shot-a.png",
    }));
    const validateRequest = vi.fn(() => ({
      ok: true as const,
      request: baseRequest,
    }));
    const validateObjectInfo = vi.fn(() => ({
      errors: [],
      request: baseRequest,
      warnings: ["sampler option normalized"],
    }));
    const adapter = createStoryComfyUiExecutionAdapter({
      client,
      fetchImage,
      historyPollAttempts: 2,
      historyPollIntervalMs: 0,
      now: () => "2026-06-15T00:00:00.000Z",
      storeImage,
      validateObjectInfo,
      validateRequest,
    });

    const result = await executeStoryShotGraph(createBatch(), adapter);

    expect(validateRequest).toHaveBeenCalledWith(baseRequest);
    expect(client.getObjectInfo).toHaveBeenCalledTimes(1);
    expect(validateObjectInfo).toHaveBeenCalledWith(baseRequest, {
      CheckpointLoaderSimple: {},
    });
    expect(client.generateImage).toHaveBeenCalledWith(baseRequest, {
      clientId: "shot-a:2026-06-15T00:00:00.000Z",
    });
    expect(client.getHistory).toHaveBeenCalledTimes(2);
    expect(client.buildViewUrl).toHaveBeenCalledWith({
      filename: "shot-a.png",
      nodeId: "9",
      type: "output",
    });
    expect(fetchImage).toHaveBeenCalledWith("http://comfyui.test/view?filename=shot-a.png&type=output");
    expect(storeImage).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), "image/png");
    expect(result.shots[0]).toMatchObject({
      queueMetadata: {
        outputNodeId: "9",
        promptId: "prompt-shot-a",
        warnings: ["sampler option normalized"],
      },
      resultReference: {
        completed: true,
        image: {
          filename: "shot-a.png",
          nodeId: "9",
          type: "output",
          url: "http://comfyui.test/view?filename=shot-a.png&type=output",
        },
        promptId: "prompt-shot-a",
        shotId: "shot-a",
        storedImage: {
          byteLength: 3,
          contentType: "image/png",
          filename: "stored-shot-a.png",
          url: "/api/comfyui/generated-images/stored-shot-a.png",
        },
        warnings: ["sampler option normalized"],
      },
      status: "done",
    });
    expect(JSON.stringify(result)).not.toContain("data:image");
    expect(JSON.stringify(result)).not.toContain("base64");
  });

  it("uploads Story-managed approved character reference images before queueing", async () => {
    const previousSequenceReferenceDir = process.env.SCENEFORGE_SEQUENCE_REFERENCE_DIR;
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sceneforge-story-ref-"));

    try {
      process.env.SCENEFORGE_SEQUENCE_REFERENCE_DIR = tempDir;
      const referenceFilename = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png";
      await fs.writeFile(path.join(tempDir, referenceFilename), new Uint8Array([90, 91, 92]));

      const request = {
        checkpointName: "anima.safetensors",
        modelBaseModel: "Anima",
        modelStorageKind: "diffusion",
        positivePrompt: "rainy station shot",
        workflowProfile: "anima",
        characterReferences: [
          {
            id: "story-reference:character-face:lead",
            name: "Lead character-face reference",
            mode: "face",
            images: [
              {
                id: "story-reference:character-face:lead:approved",
                imageName: referenceFilename,
              },
            ],
          },
        ],
      } satisfies ComfyUiTextToImageRequest;
      const client = createClient();
      const generatedRequests: ComfyUiTextToImageRequest[] = [];
      client.uploadImage = vi.fn<StoryComfyUiExecutionClient["uploadImage"]>(async (upload) => ({
        filename: upload.filename,
        imageName: "uploaded-lead-reference.png",
        raw: {},
        type: "input",
      }));
      client.generateImage = vi.fn<StoryComfyUiExecutionClient["generateImage"]>((queuedRequest) => {
        generatedRequests.push(queuedRequest);
        return Promise.resolve(createQueuedResponse(queuedRequest));
      });
      const validateRequest = vi.fn((value: unknown) => ({
        ok: true as const,
        request: value as ComfyUiTextToImageRequest,
      }));
      const validateObjectInfo = vi.fn((queuedRequest: ComfyUiTextToImageRequest) => ({
        errors: [],
        request: queuedRequest,
        warnings: [],
      }));
      const adapter = createStoryComfyUiExecutionAdapter({
        client,
        fetchImage: async () => ({
          bytes: new Uint8Array([1, 2, 3]),
          contentType: "image/png",
        }),
        historyPollAttempts: 2,
        historyPollIntervalMs: 0,
        storeImage: async (bytes: Uint8Array, contentType: string | null) => ({
          byteLength: bytes.byteLength,
          contentType: contentType ?? "image/png",
          filename: "stored-shot-a.png",
          url: "/api/comfyui/generated-images/stored-shot-a.png",
        }),
        validateObjectInfo,
        validateRequest,
      });

      const result = await executeStoryShotGraph(createBatch(request), adapter);

      expect(result.shots[0]?.status).toBe("done");
      expect(client.uploadImage).toHaveBeenCalledWith(expect.objectContaining({
        bytes: new Uint8Array([90, 91, 92]),
        filename: "sceneforge-story-ref-character-face-lead-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png",
        mimeType: "image/png",
        type: "input",
      }));
      expect(validateRequest).toHaveBeenLastCalledWith(expect.objectContaining({
        characterReferences: [
          expect.objectContaining({
            id: "story-reference:character-face:lead",
            images: [
              {
                id: "story-reference:character-face:lead:approved",
                imageName: "uploaded-lead-reference.png",
              },
            ],
          }),
        ],
      }));
      expect(validateObjectInfo).toHaveBeenCalledWith(expect.objectContaining({
        characterReferences: [
          expect.objectContaining({
            images: [
              expect.objectContaining({
                imageName: "uploaded-lead-reference.png",
              }),
            ],
          }),
        ],
      }), expect.anything());
      expect(generatedRequests[0]?.characterReferences?.[0]?.images[0]?.imageName).toBe("uploaded-lead-reference.png");
    } finally {
      if (previousSequenceReferenceDir === undefined) {
        delete process.env.SCENEFORGE_SEQUENCE_REFERENCE_DIR;
      } else {
        process.env.SCENEFORGE_SEQUENCE_REFERENCE_DIR = previousSequenceReferenceDir;
      }

      await fs.rm(tempDir, { force: true, recursive: true });
    }
  });

  it("omits Anima character references with visible guidance when IPAdapter nodes are missing", async () => {
    const generatedRequests: ComfyUiTextToImageRequest[] = [];
    const request = {
      checkpointName: "anima.safetensors",
      modelBaseModel: "Anima",
      modelStorageKind: "diffusion",
      positivePrompt: "rainy station shot",
      samplerName: "euler",
      scheduler: "normal",
      workflowProfile: "anima",
      characterReferences: [
        {
          id: "queued-reference:character-face:lead",
          name: "Lead character-face reference",
          mode: "face",
          images: [{ imageName: "already-in-comfy-input.png" }],
        },
      ],
    } satisfies ComfyUiTextToImageRequest;
    const client = {
      ...createClient(),
      generateImage: vi.fn<StoryComfyUiExecutionClient["generateImage"]>((queuedRequest) => {
        generatedRequests.push(queuedRequest);
        return Promise.resolve(createQueuedResponse(queuedRequest));
      }),
      getObjectInfo: vi.fn<StoryComfyUiExecutionClient["getObjectInfo"]>().mockResolvedValue(createAnimaObjectInfo()),
    } satisfies StoryComfyUiExecutionClient;
    const adapter = createStoryComfyUiExecutionAdapter({
      client,
      fetchImage: async () => ({
        bytes: new Uint8Array([1, 2, 3]),
        contentType: "image/png",
      }),
      historyPollAttempts: 2,
      historyPollIntervalMs: 0,
      storeImage: async (bytes: Uint8Array, contentType: string | null) => ({
        byteLength: bytes.byteLength,
        contentType: contentType ?? "image/png",
        filename: "stored-shot-a.png",
        url: "/api/comfyui/generated-images/stored-shot-a.png",
      }),
    });

    const result = await executeStoryShotGraph(createBatch(request), adapter);

    expect(result.shots[0]?.status).toBe("done");
    expect(generatedRequests[0]).not.toHaveProperty("characterReferences");
    expect(result.shots[0]?.queueMetadata?.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining("Story character references were omitted because ComfyUI is missing Anima IPAdapter"),
      expect.stringContaining("Install ComfyUI_IPAdapter_plus"),
    ]));
    expect(result.shots[0]?.resultReference?.warnings).toEqual(result.shots[0]?.queueMetadata?.warnings);
  });

  it("does not require IPAdapter nodes for unrelated Anima prompt-only generation", async () => {
    const generatedRequests: ComfyUiTextToImageRequest[] = [];
    const request = {
      checkpointName: "anima.safetensors",
      modelBaseModel: "Anima",
      modelStorageKind: "diffusion",
      positivePrompt: "rainy station shot",
      samplerName: "euler",
      scheduler: "normal",
      workflowProfile: "anima",
    } satisfies ComfyUiTextToImageRequest;
    const client = {
      ...createClient(),
      generateImage: vi.fn<StoryComfyUiExecutionClient["generateImage"]>((queuedRequest) => {
        generatedRequests.push(queuedRequest);
        return Promise.resolve(createQueuedResponse(queuedRequest));
      }),
      getObjectInfo: vi.fn<StoryComfyUiExecutionClient["getObjectInfo"]>().mockResolvedValue(createAnimaObjectInfo()),
    } satisfies StoryComfyUiExecutionClient;
    const adapter = createStoryComfyUiExecutionAdapter({
      client,
      fetchImage: async () => ({
        bytes: new Uint8Array([1, 2, 3]),
        contentType: "image/png",
      }),
      historyPollAttempts: 2,
      historyPollIntervalMs: 0,
      storeImage: async (bytes: Uint8Array, contentType: string | null) => ({
        byteLength: bytes.byteLength,
        contentType: contentType ?? "image/png",
        filename: "stored-shot-a.png",
        url: "/api/comfyui/generated-images/stored-shot-a.png",
      }),
    });

    const result = await executeStoryShotGraph(createBatch(request), adapter);

    expect(result.shots[0]?.status).toBe("done");
    expect(generatedRequests[0]?.characterReferences).toEqual([]);
    expect(result.shots[0]?.queueMetadata?.warnings).toEqual([]);
    expect(result.shots[0]?.resultReference?.warnings).toEqual([]);
  });

  it("uploads source shot results into downstream img2img and reference inputs", async () => {
    const generatedRequests: ComfyUiTextToImageRequest[] = [];
    const uploadNames = ["uploaded-shot-a.png", "uploaded-shot-b.png"];
    const client = {
      buildViewUrl: vi.fn<StoryComfyUiExecutionClient["buildViewUrl"]>((image) =>
        `http://comfyui.test/view?filename=${image.filename}&type=${image.type ?? ""}`,
      ),
      generateImage: vi.fn<StoryComfyUiExecutionClient["generateImage"]>((request, options) => {
        generatedRequests.push(request);
        const shotId = options?.clientId?.split(":")[0] ?? "shot";

        return Promise.resolve({
          ...createQueuedResponse(request),
          promptId: `prompt-${shotId}`,
          raw: {
            prompt_id: `prompt-${shotId}`,
          },
        });
      }),
      getHistory: vi.fn<StoryComfyUiExecutionClient["getHistory"]>(async (promptId) => {
        const shotId = promptId.replace(/^prompt-/, "");

        return {
          [promptId]: {
            outputs: {
              "9": {
                images: [
                  {
                    filename: `${shotId}.png`,
                    type: "output",
                  },
                ],
              },
            },
          },
        };
      }),
      getObjectInfo: vi.fn<StoryComfyUiExecutionClient["getObjectInfo"]>().mockResolvedValue({
        CheckpointLoaderSimple: {},
        IPAdapterAdvanced: {},
        IPAdapterUnifiedLoader: {},
        LoadImage: {},
      }),
      uploadImage: vi.fn<StoryComfyUiExecutionClient["uploadImage"]>(async (request) => ({
        filename: request.filename,
        imageName: uploadNames.shift() ?? request.filename,
        raw: {},
        type: "input",
      })),
    } satisfies StoryComfyUiExecutionClient;
    const fetchImage = vi.fn(async (url: string) => ({
      bytes: new Uint8Array(url.includes("shot-a") ? [10, 11] : [20, 21]),
      contentType: "image/png",
    }));
    const storeImage = vi.fn(async (bytes: Uint8Array, contentType: string | null) => ({
      byteLength: bytes.byteLength,
      contentType: contentType ?? "image/png",
      filename: `stored-${bytes[0]}.png`,
      url: `/api/comfyui/generated-images/stored-${bytes[0]}.png`,
    }));
    const validateRequest = vi.fn((request: unknown) => ({
      ok: true as const,
      request: request as ComfyUiTextToImageRequest,
    }));
    const adapter = createStoryComfyUiExecutionAdapter({
      client,
      fetchImage,
      historyPollAttempts: 1,
      historyPollIntervalMs: 0,
      now: () => "2026-06-15T00:00:00.000Z",
      storeImage,
      validateObjectInfo: (request) => ({
        errors: [],
        request,
        warnings: [],
      }),
      validateRequest,
    });
    const result = await executeStoryShotGraph({
      ...createBatch(),
      requests: [
        {
          ...createBatch().requests[0],
          shotId: "shot-a",
          sourceShotIds: [],
        },
        {
          ...createBatch().requests[0],
          shotId: "shot-b",
          sourceShotIds: [],
        },
        {
          ...createBatch().requests[0],
          shotId: "shot-c",
          sourceShotIds: ["shot-a", "shot-b"],
        },
      ],
    }, adapter);

    expect(result.status).toBe("done");
    expect(fetchImage).toHaveBeenCalledWith("http://comfyui.test/view?filename=shot-a.png&type=output");
    expect(fetchImage).toHaveBeenCalledWith("http://comfyui.test/view?filename=shot-b.png&type=output");
    expect(client.uploadImage).toHaveBeenCalledWith(expect.objectContaining({
      bytes: new Uint8Array([10, 11]),
      filename: "sceneforge-story-shot-a.png",
      mimeType: "image/png",
      type: "input",
    }));
    expect(client.uploadImage).toHaveBeenCalledWith(expect.objectContaining({
      bytes: new Uint8Array([20, 21]),
      filename: "sceneforge-story-shot-b.png",
      mimeType: "image/png",
      type: "input",
    }));
    expect(generatedRequests[2]).toMatchObject({
      imageName: "uploaded-shot-a.png",
      characterReferences: [
        {
          id: "source-shot-b",
          images: [{ imageName: "uploaded-shot-b.png" }],
          mode: "ipadapter",
          name: "Source shot shot-b",
        },
      ],
    });
    expect(validateRequest).toHaveBeenCalledWith(expect.objectContaining({
      characterReferences: expect.any(Array),
      imageName: "uploaded-shot-a.png",
    }));
  });

  it("ignores forged upstream source image URLs during downstream regeneration", async () => {
    const client = {
      ...createClient(),
      buildViewUrl: vi.fn<StoryComfyUiExecutionClient["buildViewUrl"]>((image) =>
        `http://comfyui.test/view?filename=${image.filename}&type=${image.type ?? ""}`,
      ),
      uploadImage: vi.fn<StoryComfyUiExecutionClient["uploadImage"]>(async (request) => ({
        filename: request.filename,
        imageName: "uploaded-source.png",
        raw: {},
        type: "input",
      })),
    } satisfies StoryComfyUiExecutionClient;
    const fetchedUrls: string[] = [];
    const fetchImage = vi.fn(async (url: string) => {
      fetchedUrls.push(url);
      if (url.includes("evil.test")) {
        throw new Error("forged URL was fetched");
      }

      return {
        bytes: new Uint8Array([42, 43]),
        contentType: "image/png",
      };
    });
    const adapter = createStoryComfyUiExecutionAdapter({
      client,
      fetchImage,
      historyPollAttempts: 2,
      historyPollIntervalMs: 0,
      storeImage: async (bytes: Uint8Array, contentType: string | null) => ({
        byteLength: bytes.byteLength,
        contentType: contentType ?? "image/png",
        filename: "stored-shot-b.png",
        url: "/api/comfyui/generated-images/stored-shot-b.png",
      }),
      validateObjectInfo: (request) => ({
        errors: [],
        request,
        warnings: [],
      }),
      validateRequest: (request) => ({
        ok: true,
        request: request as ComfyUiTextToImageRequest,
      }),
    });
    const batch = {
      ...createBatch(),
      requests: [
        {
          ...createBatch().requests[0],
          shotId: "shot-a",
          sourceShotIds: [],
        },
        {
          ...createBatch().requests[0],
          shotId: "shot-b",
          sourceShotIds: ["shot-a"],
        },
      ],
    };

    const result = await executeStoryShotGraph(batch, adapter, {
      initialState: {
        errors: [],
        mode: "final",
        readyShotIds: ["shot-b"],
        shots: [
          {
            resultReference: {
              completed: true,
              image: {
                filename: "shot-a.png",
                nodeId: "9",
                type: "output",
                url: "http://evil.test/internal-metadata.png",
              },
              images: [
                {
                  filename: "shot-a.png",
                  nodeId: "9",
                  type: "output",
                  url: "http://evil.test/secondary.png",
                },
              ],
              promptId: "forged-shot-a",
              shotId: "shot-a",
              storedImage: {
                byteLength: 99,
                contentType: "image/png",
                filename: "stored-shot-a.png",
                url: "http://evil.test/stored.png",
              },
              warnings: [],
            },
            shotId: "shot-a",
            sourceShotIds: [],
            status: "done",
          },
          {
            shotId: "shot-b",
            sourceShotIds: ["shot-a"],
            status: "stale",
          },
        ],
        staleShotIds: ["shot-b"],
        status: "stale",
        storyId: "story-1",
      },
    });

    expect(result.shots.find((shot) => shot.shotId === "shot-b")?.status).toBe("done");
    expect(client.buildViewUrl).toHaveBeenCalledWith({
      filename: "shot-a.png",
      type: "output",
    });
    expect(fetchImage).toHaveBeenCalledWith("http://comfyui.test/view?filename=shot-a.png&type=output");
    expect(fetchedUrls.every((url) => !url.includes("evil.test"))).toBe(true);
    expect(client.uploadImage).toHaveBeenCalledWith(expect.objectContaining({
      bytes: new Uint8Array([42, 43]),
      filename: "sceneforge-story-shot-a.png",
      type: "input",
    }));
  });

  it("does not send the ComfyUI API key when a forged source view URL points outside the configured view endpoint", async () => {
    const previousBaseUrl = process.env.COMFYUI_BASE_URL;
    const previousApiKey = process.env.COMFYUI_API_KEY;
    const fetchMock = vi.fn();

    process.env.COMFYUI_BASE_URL = "http://comfyui.local:8188/api";
    process.env.COMFYUI_API_KEY = "secret-key";
    vi.stubGlobal("fetch", fetchMock);

    try {
      const client = {
        ...createClient(),
        buildViewUrl: vi.fn<StoryComfyUiExecutionClient["buildViewUrl"]>(() =>
          "http://evil.test/view?filename=shot-a.png&type=output",
        ),
      } satisfies StoryComfyUiExecutionClient;
      const adapter = createStoryComfyUiExecutionAdapter({
        client,
        historyPollAttempts: 1,
        historyPollIntervalMs: 0,
        validateObjectInfo: (request) => ({
          errors: [],
          request,
          warnings: [],
        }),
        validateRequest: (request) => ({
          ok: true,
          request: request as ComfyUiTextToImageRequest,
        }),
      });
      const result = await executeStoryShotGraph({
        ...createBatch(),
        requests: [
          {
            ...createBatch().requests[0],
            shotId: "shot-a",
            sourceShotIds: [],
          },
          {
            ...createBatch().requests[0],
            shotId: "shot-b",
            sourceShotIds: ["shot-a"],
          },
        ],
      }, adapter, {
        initialState: {
          errors: [],
          mode: "final",
          readyShotIds: ["shot-b"],
          shots: [
            {
              resultReference: {
                completed: true,
                image: {
                  filename: "shot-a.png",
                  nodeId: "9",
                  type: "output",
                  url: "http://evil.test/forged.png",
                },
                promptId: "forged-shot-a",
                shotId: "shot-a",
                warnings: [],
              },
              shotId: "shot-a",
              sourceShotIds: [],
              status: "done",
            },
            {
              shotId: "shot-b",
              sourceShotIds: ["shot-a"],
              status: "stale",
            },
          ],
          staleShotIds: ["shot-b"],
          status: "stale",
          storyId: "story-1",
        },
      });

      expect(result.shots.find((shot) => shot.shotId === "shot-b")).toMatchObject({
        error: {
          code: "shot_execution_failed",
          message: "ComfyUI image request URL is not from the configured ComfyUI view endpoint.",
        },
        status: "error",
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(client.generateImage).not.toHaveBeenCalled();
    } finally {
      if (previousBaseUrl === undefined) {
        delete process.env.COMFYUI_BASE_URL;
      } else {
        process.env.COMFYUI_BASE_URL = previousBaseUrl;
      }

      if (previousApiKey === undefined) {
        delete process.env.COMFYUI_API_KEY;
      } else {
        process.env.COMFYUI_API_KEY = previousApiKey;
      }

      vi.unstubAllGlobals();
    }
  });

  it("validates and queues the preview-transformed request when preview has no source shots", async () => {
    const client = createClient();
    const previewSourceRequest = {
      ...baseRequest,
      batchSize: 4,
      faceDetailer: {
        enabled: true,
      },
      handDetailer: {
        enabled: true,
      },
      preview: true,
      steps: 28,
    } satisfies ComfyUiTextToImageRequest;
    const fetchImage = vi.fn(async () => ({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
    }));
    const queuedRequests: ComfyUiTextToImageRequest[] = [];
    client.generateImage = vi.fn<StoryComfyUiExecutionClient["generateImage"]>((request) => {
      queuedRequests.push(request);
      return Promise.resolve(createQueuedResponse(request));
    });
    const validateRequest = vi.fn((request: unknown) => ({
      ok: true as const,
      request: request as ComfyUiTextToImageRequest,
    }));
    const validateObjectInfo = vi.fn((request: ComfyUiTextToImageRequest) => ({
      errors: [],
      request,
      warnings: [],
    }));
    const adapter = createStoryComfyUiExecutionAdapter({
      client,
      fetchImage,
      historyPollAttempts: 2,
      historyPollIntervalMs: 0,
      storeImage: async (bytes: Uint8Array, contentType: string | null) => ({
        byteLength: bytes.byteLength,
        contentType: contentType ?? "image/png",
        filename: "stored-shot-a.png",
        url: "/api/comfyui/generated-images/stored-shot-a.png",
      }),
      validateObjectInfo,
      validateRequest,
    });

    const result = await executeStoryShotGraph(createBatch(previewSourceRequest), adapter);

    expect(result.shots[0]?.status).toBe("done");
    expect(validateRequest).toHaveBeenNthCalledWith(1, previewSourceRequest);
    expect(validateRequest).toHaveBeenNthCalledWith(2, expect.objectContaining({
      batchSize: 1,
      faceDetailer: expect.objectContaining({ enabled: false }),
      handDetailer: expect.objectContaining({ enabled: false }),
      preview: true,
      steps: 10,
    }));
    expect(validateObjectInfo).toHaveBeenCalledWith(expect.objectContaining({
      batchSize: 1,
      faceDetailer: expect.objectContaining({ enabled: false }),
      handDetailer: expect.objectContaining({ enabled: false }),
      preview: true,
      steps: 10,
    }), {
      CheckpointLoaderSimple: {},
    });
    expect(queuedRequests[0]).toMatchObject({
      batchSize: 1,
      faceDetailer: { enabled: false },
      handDetailer: { enabled: false },
      preview: true,
      steps: 10,
    });
  });

  it("stops before object_info and queueing when ComfyUI request validation fails", async () => {
    const client = createClient();
    const adapter = createStoryComfyUiExecutionAdapter({
      client,
      validateRequest: () => ({
        details: { checkpointName: "missing" },
        message: "checkpointName is required.",
        ok: false,
      }),
    });

    const result = await executeStoryShotGraph(createBatch(), adapter);

    expect(result.shots[0]).toMatchObject({
      error: {
        code: "shot_execution_failed",
        message: "checkpointName is required.",
      },
      status: "error",
    });
    expect(client.getObjectInfo).not.toHaveBeenCalled();
    expect(client.generateImage).not.toHaveBeenCalled();
  });

  it("stops before queueing when object_info compatibility fails", async () => {
    const client = createClient();
    const adapter = createStoryComfyUiExecutionAdapter({
      client,
      validateObjectInfo: () => ({
        errors: ["Checkpoint is not available."],
        request: baseRequest,
        warnings: [],
      }),
      validateRequest: () => ({
        ok: true,
        request: baseRequest,
      }),
    });

    const result = await executeStoryShotGraph(createBatch(), adapter);

    expect(result.shots[0]).toMatchObject({
      error: {
        code: "shot_execution_failed",
        message: "ComfyUI request does not match the current ComfyUI model/node options.",
      },
      status: "error",
    });
    expect(client.getObjectInfo).toHaveBeenCalledTimes(1);
    expect(client.generateImage).not.toHaveBeenCalled();
  });

  it("uses production-scale default history polling for real ComfyUI generations", async () => {
    const client = createClient();
    let historyCalls = 0;
    client.getHistory = vi.fn<StoryComfyUiExecutionClient["getHistory"]>(async () => {
      historyCalls += 1;

      return historyCalls < 26
        ? {
            "prompt-shot-a": {},
          }
        : {
            "prompt-shot-a": {
              outputs: {
                "9": {
                  images: [
                    {
                      filename: "shot-a.png",
                      type: "output",
                    },
                  ],
                },
              },
            },
          };
    });
    const fetchImage = vi.fn(async () => ({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
    }));
    const storeImage = vi.fn(async (bytes: Uint8Array, contentType: string | null) => ({
      byteLength: bytes.byteLength,
      contentType: contentType ?? "image/png",
      filename: "stored-shot-a.png",
      url: "/api/comfyui/generated-images/stored-shot-a.png",
    }));
    const adapter = createStoryComfyUiExecutionAdapter({
      client,
      fetchImage,
      historyPollIntervalMs: 0,
      storeImage,
      validateObjectInfo: () => ({
        errors: [],
        request: baseRequest,
        warnings: [],
      }),
      validateRequest: () => ({
        ok: true,
        request: baseRequest,
      }),
    });

    const result = await executeStoryShotGraph(createBatch(), adapter);

    expect(client.getHistory).toHaveBeenCalledTimes(26);
    expect(result.shots[0]).toMatchObject({
      resultReference: {
        promptId: "prompt-shot-a",
      },
      status: "done",
    });
  });

  it("raises a typed error when prompt history never completes", async () => {
    const client = createClient();
    client.getHistory = vi.fn<StoryComfyUiExecutionClient["getHistory"]>().mockResolvedValue({
      "prompt-shot-a": {},
    });
    const adapter = createStoryComfyUiExecutionAdapter({
      client,
      historyPollAttempts: 1,
      historyPollIntervalMs: 0,
      validateObjectInfo: () => ({
        errors: [],
        request: baseRequest,
        warnings: [],
      }),
      validateRequest: () => ({
        ok: true,
        request: baseRequest,
      }),
    });

    const result = await executeStoryShotGraph(createBatch(), adapter);

    expect(result.shots[0]?.error?.message).toBe("Timed out waiting for ComfyUI prompt history completion.");
    expect(result.shots[0]?.error?.details).toBeInstanceOf(StoryComfyUiExecutionError);
  });
});
