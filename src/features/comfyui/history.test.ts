import { describe, expect, it } from "vitest";

import { extractComfyUiHistoryImages, isComfyUiPromptHistoryComplete } from "./history";

describe("ComfyUI history helpers", () => {
  it("extracts generated image references from prompt history outputs", () => {
    const history = {
      "prompt-1": {
        outputs: {
          "7": {
            images: [
              {
                filename: "SceneForge_00001_.png",
                subfolder: "",
                type: "output",
              },
            ],
          },
          "8": {
            text: ["done"],
          },
        },
      },
    };

    expect(extractComfyUiHistoryImages(history, "prompt-1")).toEqual([
      {
        nodeId: "7",
        filename: "SceneForge_00001_.png",
        subfolder: "",
        type: "output",
      },
    ]);
    expect(isComfyUiPromptHistoryComplete(history, "prompt-1")).toBe(true);
  });

  it("treats missing history as incomplete", () => {
    expect(extractComfyUiHistoryImages({}, "prompt-1")).toEqual([]);
    expect(isComfyUiPromptHistoryComplete({}, "prompt-1")).toBe(false);
  });
});
