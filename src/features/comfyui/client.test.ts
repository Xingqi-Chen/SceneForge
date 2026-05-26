import { describe, expect, it } from "vitest";

import { ComfyUiApiError, createComfyUiClient } from "./client";

describe("createComfyUiClient", () => {
  it("posts API-format workflows to /prompt", async () => {
    const workflow = {
      "1": {
        class_type: "SaveImage",
        inputs: { filename_prefix: "SceneForge" },
      },
    };
    const fetcher: typeof fetch = async (input, init) => {
      expect(input).toBe("http://127.0.0.1:8188/prompt");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        accept: "application/json",
        "content-type": "application/json",
        authorization: "Bearer test-key",
      });
      expect(JSON.parse(String(init?.body))).toEqual({
        prompt: workflow,
        client_id: "client-1",
        extra_data: { source: "test" },
      });

      return Response.json({
        prompt_id: "prompt-1",
        number: 4,
        node_errors: {},
      });
    };
    const client = createComfyUiClient({
      baseUrl: "http://127.0.0.1:8188/",
      apiKey: "test-key",
      fetcher,
    });

    await expect(
      client.queuePrompt(workflow, {
        clientId: "client-1",
        extraData: { source: "test" },
      }),
    ).resolves.toMatchObject({
      promptId: "prompt-1",
      number: 4,
      nodeErrors: {},
    });
  });

  it("builds and queues the basic image workflow", async () => {
    const fetcher: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body));

      expect(body.prompt["1"].class_type).toBe("CheckpointLoaderSimple");
      expect(body.prompt["1"].inputs.ckpt_name).toBe("model.safetensors");
      expect(body.prompt["5"].inputs.seed).toBe(123);
      expect(body.prompt["7"].class_type).toBe("PreviewImage");

      return Response.json({
        prompt_id: "prompt-2",
        number: 7,
      });
    };
    const client = createComfyUiClient({
      baseUrl: "http://localhost:8188",
      fetcher,
    });

    await expect(
      client.generateImage({
        checkpointName: "model.safetensors",
        positivePrompt: "a scene",
        seed: 123,
      }),
    ).resolves.toMatchObject({
      promptId: "prompt-2",
      number: 7,
      outputNodeId: "7",
      nodeIds: {
        previewImage: "7",
      },
    });
  });

  it("requests history, queue, object info, and view URLs with normalized paths", async () => {
    const requested: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      requested.push(String(input));
      return Response.json({ ok: true });
    };
    const client = createComfyUiClient({
      baseUrl: "http://localhost:8188",
      fetcher,
    });

    await client.getHistory("prompt/id");
    await client.getQueue();
    await client.getObjectInfo();
    await client.getObjectInfo("KSampler");

    expect(requested).toEqual([
      "http://localhost:8188/history/prompt%2Fid",
      "http://localhost:8188/queue",
      "http://localhost:8188/object_info",
      "http://localhost:8188/object_info/KSampler",
    ]);
    expect(
      client.buildViewUrl({
        filename: "image.png",
        subfolder: "sub folder",
        type: "output",
      }),
    ).toBe("http://localhost:8188/view?filename=image.png&subfolder=sub+folder&type=output");
  });

  it("uploads images to ComfyUI input storage", async () => {
    const fetcher: typeof fetch = async (input, init) => {
      expect(input).toBe("http://localhost:8188/upload/image");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        accept: "application/json",
        authorization: "Bearer test-key",
      });
      expect(init?.body).toBeInstanceOf(FormData);

      return Response.json({
        name: "pose.png",
        subfolder: "SceneForge",
        type: "input",
      });
    };
    const client = createComfyUiClient({
      baseUrl: "http://localhost:8188",
      apiKey: "test-key",
      fetcher,
    });

    await expect(
      client.uploadImage({
        filename: "pose.png",
        bytes: new Uint8Array([1, 2, 3]),
      }),
    ).resolves.toMatchObject({
      filename: "pose.png",
      imageName: "SceneForge/pose.png",
      subfolder: "SceneForge",
      type: "input",
    });
  });

  it("throws ComfyUiApiError with response status and details", async () => {
    const client = createComfyUiClient({
      baseUrl: "http://localhost:8188",
      fetcher: async () => Response.json({ error: "bad workflow" }, { status: 400 }),
    });

    await expect(client.getQueue()).rejects.toMatchObject({
      name: "ComfyUiApiError",
      statusCode: 400,
      details: { error: "bad workflow" },
    } satisfies Partial<ComfyUiApiError>);
  });
});
