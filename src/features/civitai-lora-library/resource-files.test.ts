import { describe, expect, it } from "vitest";

import { getCivitaiModelStorageKind } from "./resource-files";

describe("Civitai model storage selection", () => {
  it("stores Krea 2 models as diffusion models rather than checkpoints", () => {
    const base = {
      id: "resource-krea",
      resourceType: "model" as const,
      name: "Krea 2 Turbo",
      versionName: "v1",
      civitaiModelVersionId: 1,
      downloadUrl: "https://example.test/krea-2.safetensors",
      filesJson: [],
    };

    expect(getCivitaiModelStorageKind({ ...base, baseModel: "Krea 2" })).toBe("diffusion");
    expect(getCivitaiModelStorageKind({
      ...base,
      name: "Illustrio Model",
      versionName: "v1",
      downloadUrl: "https://example.test/illustrio.safetensors",
      baseModel: "Illustrious",
    })).toBe("checkpoint");
  });
});
