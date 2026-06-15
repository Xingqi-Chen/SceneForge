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
