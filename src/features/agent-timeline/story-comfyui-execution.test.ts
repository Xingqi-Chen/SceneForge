import { describe, expect, it, vi } from "vitest";

import type { ComfyUiGenerateImageResponse, ComfyUiTextToImageRequest } from "@/features/comfyui";

import {
  createStoryComfyUiExecutionAdapter,
  StoryComfyUiExecutionError,
  type StoryComfyUiExecutionAdapterOptions,
  type StoryComfyUiExecutionClient,
} from "./story-comfyui-execution";
import { executeStoryShotGraph } from "./story-execution";
import type { StoryExecutionRequestBatch } from "./story-planning";

type UploadSequenceReferences = NonNullable<StoryComfyUiExecutionAdapterOptions["uploadSequenceReferences"]>;

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
const readyStyleReference = {
  status: "ready",
  mode: "ipadapter",
  metadata: {
    byteLength: 1234,
    contentType: "image/png",
    filename: "story-style.png",
    storedFilename: "0123456789abcdef0123456789abcdef.png",
    uploadedAt: "2026-06-14T00:00:00.000Z",
    url: "/api/comfyui/sequence-references/0123456789abcdef0123456789abcdef.png",
  },
  analysis: {
    analyzedAt: "2026-06-14T00:00:01.000Z",
    model: "vision-model",
    summary: "Soft watercolor anime rendering with pastel highlights.",
    stylePrompt: "soft watercolor anime rendering, clean pencil linework, pastel highlights",
  },
  ipAdapter: {
    weight: 0.45,
    startPercent: 0,
    endPercent: 1,
  },
  settingsSnapshot: {
    capturedAt: "2026-06-14T00:00:02.000Z",
    checkpointBaseModel: "Illustrious",
    checkpointId: "checkpoint-local",
    modeReason: "Illustrious checkpoints support the sequence-style IPAdapter reference.",
    promptProfile: "illustrious",
  },
} as const;

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

  it("uploads Story style references through sequence-style IPAdapter character references", async () => {
    const generatedRequests: ComfyUiTextToImageRequest[] = [];
    const client = createClient();
    client.generateImage = vi.fn<StoryComfyUiExecutionClient["generateImage"]>((request) => {
      generatedRequests.push(request);
      return Promise.resolve(createQueuedResponse(request));
    });
    const uploadSequenceReferences =
      vi.fn<UploadSequenceReferences>(async (_client, sequenceId, characters) => {
        expect(sequenceId).toBe("story-1");
        expect(characters).toHaveLength(1);
        expect(characters[0]).toMatchObject({
          id: "story-style-reference",
          name: "Story style reference",
          mode: "ipadapter",
          prompt: "soft watercolor anime rendering, clean pencil linework, pastel highlights",
          references: [
            {
              id: "story-style-reference-image",
              storedFilename: "0123456789abcdef0123456789abcdef.png",
            },
          ],
          weight: 0.45,
          startPercent: 0,
          endPercent: 1,
        });

        return characters.map((character) => ({
          ...character,
          id: character.id ?? "story-style-reference",
          references: character.references.map((reference) => ({
            id: reference.id ?? "story-style-reference-image",
            imageName: "uploaded-story-style.png",
            ...(typeof reference.weight === "number" ? { weight: reference.weight } : {}),
          })),
        }));
      });
    const validateRequest = vi.fn((request: unknown) => ({
      ok: true as const,
      request: request as ComfyUiTextToImageRequest,
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
      uploadSequenceReferences,
      validateObjectInfo: (request) => ({
        errors: [],
        request,
        warnings: [],
      }),
      validateRequest,
    });
    const batch = createBatch();

    const result = await executeStoryShotGraph({
      ...batch,
      requests: [
        {
          ...batch.requests[0],
          styleReference: readyStyleReference,
        },
      ],
    }, adapter);

    expect(result.shots[0]?.status).toBe("done");
    expect(uploadSequenceReferences).toHaveBeenCalledTimes(1);
    expect(generatedRequests[0]).toMatchObject({
      characterReferences: [
        {
          id: "story-style-reference",
          images: [
            {
              id: "story-style-reference-image",
              imageName: "uploaded-story-style.png",
            },
          ],
          mode: "ipadapter",
          name: "Story style reference",
          prompt: "soft watercolor anime rendering, clean pencil linework, pastel highlights",
          weight: 0.45,
          startPercent: 0,
          endPercent: 1,
        },
      ],
    });
    expect(validateRequest).toHaveBeenCalledWith(expect.objectContaining({
      characterReferences: expect.any(Array),
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
