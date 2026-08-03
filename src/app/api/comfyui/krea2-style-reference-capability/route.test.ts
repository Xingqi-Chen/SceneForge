// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  preflightKrea2ReferenceCapability: vi.fn(),
}));

vi.mock("@/features/comfyui", () => ({
  ComfyUiApiError: class ComfyUiApiError extends Error {},
}));

vi.mock("@/features/comfyui/krea2-reference-capability.server", () => ({
  preflightKrea2ReferenceCapability: mocks.preflightKrea2ReferenceCapability,
}));

import { POST } from "./route";

describe("Krea reference-adapter capability route", () => {
  afterEach(() => vi.resetAllMocks());

  it.each([
    ["style", undefined],
    ["reid", "reid"],
  ] as const)("delegates a no-queue %s probe with authoritative model metadata", async (mode, referenceMode) => {
    mocks.preflightKrea2ReferenceCapability.mockResolvedValue({
      available: true,
      reason: `${mode} graph verified`,
    });

    const response = await POST(new Request("http://localhost/api/comfyui/krea2-style-reference-capability", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        checkpointName: "RedCraft_v4_fp8_scaled.safetensors",
        modelBaseModel: "Krea 2",
        modelStorageKind: "diffusion",
        ...(referenceMode ? { referenceMode } : {}),
      }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ available: true, reason: `${mode} graph verified` });
    expect(mocks.preflightKrea2ReferenceCapability).toHaveBeenCalledWith({
      checkpointName: "RedCraft_v4_fp8_scaled.safetensors",
      mode,
      modelBaseModel: "Krea 2",
    });
  });

  it("fails before preflight when diffusion metadata is incomplete", async () => {
    const response = await POST(new Request("http://localhost/api/comfyui/krea2-style-reference-capability", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        checkpointName: "Krea2_Turbo_Misleading.safetensors",
        modelStorageKind: "diffusion",
        referenceMode: "reid",
      }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ available: false });
    expect(mocks.preflightKrea2ReferenceCapability).not.toHaveBeenCalled();
  });

  it("returns fail-closed availability when local preflight throws", async () => {
    mocks.preflightKrea2ReferenceCapability.mockRejectedValue(new Error("object_info unavailable"));
    const response = await POST(new Request("http://localhost/api/comfyui/krea2-style-reference-capability", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        checkpointName: "RedCraft_v4.safetensors",
        modelBaseModel: "Krea 2",
        modelStorageKind: "diffusion",
        referenceMode: "reid",
      }),
    }));

    await expect(response.json()).resolves.toEqual({
      available: false,
      reason: "Krea reference-adapter preflight failed. Reference upload and queueing remain blocked.",
    });
  });
});
