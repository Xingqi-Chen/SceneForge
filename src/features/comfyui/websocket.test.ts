import { describe, expect, it } from "vitest";

import {
  buildComfyUiWebSocketUrl,
  extractComfyUiExecutedImages,
  getComfyUiWebSocketPromptId,
  parseComfyUiWebSocketMessage,
} from "./websocket";

describe("ComfyUI websocket helpers", () => {
  it("builds websocket URLs from ComfyUI base URLs", () => {
    expect(buildComfyUiWebSocketUrl("http://127.0.0.1:8188/", "client-1")).toBe(
      "ws://127.0.0.1:8188/ws?clientId=client-1",
    );
    expect(buildComfyUiWebSocketUrl("https://comfyui.test/base", "client 1")).toBe(
      "wss://comfyui.test/base/ws?clientId=client+1",
    );
  });

  it("parses JSON websocket messages and prompt ids", () => {
    const message = parseComfyUiWebSocketMessage(
      JSON.stringify({
        type: "progress",
        data: {
          prompt_id: "prompt-1",
          value: 4,
          max: 30,
        },
      }),
    );

    expect(message).toMatchObject({
      type: "progress",
      data: {
        prompt_id: "prompt-1",
      },
    });
    expect(message ? getComfyUiWebSocketPromptId(message) : null).toBe("prompt-1");
  });

  it("extracts images from executed events", () => {
    expect(
      extractComfyUiExecutedImages({
        type: "executed",
        data: {
          node: "7",
          output: {
            images: [
              {
                filename: "SceneForge_00001_.png",
                subfolder: "",
                type: "output",
              },
            ],
          },
          prompt_id: "prompt-1",
        },
      }),
    ).toEqual([
      {
        nodeId: "7",
        filename: "SceneForge_00001_.png",
        subfolder: "",
        type: "output",
      },
    ]);
  });
});
