// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createComfyUiClient: vi.fn(),
  validateComfyUiRequestAgainstObjectInfo: vi.fn(),
  validateComfyUiTextToImageRequest: vi.fn(),
}));

vi.mock("@/features/comfyui", () => ({
  ComfyUiApiError: class ComfyUiApiError extends Error {},
  createComfyUiClient: mocks.createComfyUiClient,
  validateComfyUiRequestAgainstObjectInfo: mocks.validateComfyUiRequestAgainstObjectInfo,
  validateComfyUiTextToImageRequest: mocks.validateComfyUiTextToImageRequest,
}));

import { POST } from "./route";

describe("Krea reference-adapter capability route", () => {
  afterEach(() => vi.resetAllMocks());

  it("performs a no-queue probe for the fixed dual-reference Krea graph and adapter context", async () => {
    const getObjectInfo = vi.fn().mockResolvedValue({ TextEncodeKrea2OstrisEdit: {} });
    mocks.createComfyUiClient.mockReturnValue({ getObjectInfo, generateImage: vi.fn() });
    mocks.validateComfyUiTextToImageRequest.mockImplementation((request) => ({ ok: true, request }));
    mocks.validateComfyUiRequestAgainstObjectInfo.mockReturnValue({ errors: [], warnings: [] });

    const response = await POST(new Request("http://localhost/api/comfyui/krea2-style-reference-capability", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        checkpointName: "krea-2-turbo-unet.safetensors",
        modelBaseModel: "Krea 2",
        modelStorageKind: "diffusion",
        hasCharacterReference: true,
      }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ available: true });
    expect(mocks.validateComfyUiTextToImageRequest).toHaveBeenCalledWith(expect.objectContaining({
      checkpointName: "krea-2-turbo-unet.safetensors",
      workflowProfile: "krea2",
      krea2StyleReference: {
        styleImageName: "sceneforge-krea-style-reference-preflight.png",
        characterImageName: "sceneforge-krea-character-reference-preflight.png",
      },
    }));
    expect(getObjectInfo).toHaveBeenCalledTimes(1);
    expect(mocks.validateComfyUiRequestAgainstObjectInfo).toHaveBeenCalledTimes(1);
  });

  it("returns prompt-only availability when the local graph is incompatible and never queues", async () => {
    const generateImage = vi.fn();
    mocks.createComfyUiClient.mockReturnValue({ getObjectInfo: vi.fn().mockResolvedValue({}), generateImage });
    mocks.validateComfyUiTextToImageRequest.mockImplementation((request) => ({ ok: true, request }));
    mocks.validateComfyUiRequestAgainstObjectInfo.mockReturnValue({
      errors: ["Krea2OstrisEditModelPatch node is not available in ComfyUI."], warnings: [],
    });

    const response = await POST(new Request("http://localhost/api/comfyui/krea2-style-reference-capability", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ checkpointName: "krea-2-turbo-unet.safetensors", modelBaseModel: "Krea 2", modelStorageKind: "diffusion" }),
    }));

    await expect(response.json()).resolves.toEqual({
      available: false,
      reason: "Krea2OstrisEditModelPatch node is not available in ComfyUI.",
    });
    expect(generateImage).not.toHaveBeenCalled();
  });
});
