import { describe, expect, it } from "vitest";

import { normalizeComfyUiViewImageReference } from "./generated-image-reference";

describe("normalizeComfyUiViewImageReference", () => {
  it.each(["", "   ", "\t\r\n"])(
    "treats an empty ComfyUI subfolder %j as absent",
    (subfolder) => {
      expect(normalizeComfyUiViewImageReference({
        filename: "ComfyUI_temp_00001_.png",
        subfolder,
        type: "temp",
      })).toEqual({
        filename: "ComfyUI_temp_00001_.png",
        type: "temp",
      });
    },
  );

  it("preserves a valid nested relative subfolder", () => {
    expect(normalizeComfyUiViewImageReference({
      filename: "output.png",
      subfolder: "timeline/run-1",
      type: "output",
    })).toEqual({
      filename: "output.png",
      subfolder: "timeline/run-1",
      type: "output",
    });
  });

  it.each([
    ["empty filename", { filename: "", type: "temp" }],
    ["whitespace filename", { filename: "  ", type: "temp" }],
    ["filename path", { filename: "private/output.png", type: "output" }],
    ["absolute subfolder", { filename: "output.png", subfolder: "/private", type: "output" }],
    ["drive subfolder", { filename: "output.png", subfolder: "C:/private", type: "output" }],
    ["colon subfolder", { filename: "output.png", subfolder: "private:cache", type: "output" }],
    ["parent traversal", { filename: "output.png", subfolder: "../private", type: "output" }],
    ["empty path segment", { filename: "output.png", subfolder: "private//nested", type: "output" }],
  ])("rejects %s", (_case, reference) => {
    expect(normalizeComfyUiViewImageReference(reference)).toBeNull();
  });
});
