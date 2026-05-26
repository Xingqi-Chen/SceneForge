// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

describe("ComfyUI text-to-image workflow route", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a workflow without calling ComfyUI", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await POST(
      new Request("http://localhost/api/comfyui/workflow/text-to-image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          checkpointName: "model.safetensors",
          positivePrompt: "a quiet forest",
          seed: 123,
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(payload.outputNodeId).toBe("7");
    expect(payload.workflow["1"].class_type).toBe("CheckpointLoaderSimple");
    expect(payload.workflow["5"].inputs.seed).toBe(123);
    expect(payload.workflow["7"].class_type).toBe("PreviewImage");
  });
});
