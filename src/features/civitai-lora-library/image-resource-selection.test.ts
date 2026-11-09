import { describe, expect, it } from "vitest";

import type { CivitaiResourceRecord } from "./types";
import {
  resolveCivitaiImageResourceSelection,
  type CivitaiImageResourceSelectionUsage,
} from "./image-resource-selection";

function usage({
  baseModel = "Illustrious",
  id,
  name = id,
  ready = true,
  resourceType = "lora",
}: {
  baseModel?: string | null;
  id: string;
  name?: string;
  ready?: boolean;
  resourceType?: CivitaiResourceRecord["resourceType"];
}): CivitaiImageResourceSelectionUsage {
  return {
    ready,
    resource: { baseModel, id, name, resourceType },
  };
}

describe("resolveCivitaiImageResourceSelection", () => {
  const checkpoint = { id: "checkpoint-current", baseModel: "Illustrious" };

  it.each(["Krea 2", " KREA_2_TURBO "])("selects ready mixed aliases for %s without changing the checkpoint or usage order", (baseModel) => {
    const result = resolveCivitaiImageResourceSelection({
      checkpoint: { id: "official-krea-checkpoint", baseModel },
      usages: [
        usage({ id: "image-checkpoint", resourceType: "model", baseModel: "Krea 2 Turbo" }),
        usage({ id: "mrpopo-full-potential-v3", name: "Mrpopo Full Potential v3.0", baseModel: "Krea 2 Turbo" }),
        usage({ id: "standard-lora", baseModel: "krea2" }),
        usage({ id: "mrpopo-full-potential-v3", baseModel: "Krea_2_Turbo" }),
        usage({ id: "unready-turbo", baseModel: "Krea 2 Turbo", ready: false }),
        usage({ id: "missing-base", baseModel: null }),
        usage({ id: "other-family", baseModel: "Anima" }),
        usage({ id: "unknown-krea", baseModel: "Krea 2 Pro" }),
        usage({ id: "compact-turbo", baseModel: "Krea2Turbo" }),
      ],
    });

    expect(result.checkpointId).toBe("official-krea-checkpoint");
    expect(result.loraIds).toEqual(["mrpopo-full-potential-v3", "standard-lora", "compact-turbo"]);
    expect(result.warnings.map(({ resourceId, reason }) => ({ resourceId, reason }))).toEqual([
      { resourceId: "mrpopo-full-potential-v3", reason: "duplicate_usage" },
      { resourceId: "unready-turbo", reason: "not_ready" },
      { resourceId: "missing-base", reason: "base_model_mismatch" },
      { resourceId: "other-family", reason: "base_model_mismatch" },
      { resourceId: "unknown-krea", reason: "base_model_mismatch" },
    ]);
  });

  it("ignores zero, multiple, unready, and mismatched image checkpoint usages", () => {
    const withoutImageModels = resolveCivitaiImageResourceSelection({
      checkpoint,
      usages: [usage({ id: "lora-ready" })],
    });
    const withIrrelevantImageModels = resolveCivitaiImageResourceSelection({
      checkpoint,
      usages: [
        usage({ id: "image-model-unready", ready: false, resourceType: "model" }),
        usage({ baseModel: "Anima", id: "image-model-mismatch", resourceType: "model" }),
        usage({ id: "image-model-second", resourceType: "model" }),
        usage({ id: "lora-ready" }),
      ],
    });

    expect(withoutImageModels).toEqual({
      checkpointId: checkpoint.id,
      loraIds: ["lora-ready"],
      warnings: [],
    });
    expect(withIrrelevantImageModels).toEqual(withoutImageModels);
  });

  it("keeps every compatible ready LoRA beyond the recommendation limit in usage order", () => {
    const loraIds = ["lora-5", "lora-2", "lora-4", "lora-1", "lora-6", "lora-3"];

    const result = resolveCivitaiImageResourceSelection({
      checkpoint,
      usages: loraIds.map((id) => usage({ id })),
    });

    expect(result.checkpointId).toBe(checkpoint.id);
    expect(result.loraIds).toEqual(loraIds);
    expect(result.loraIds).toHaveLength(6);
  });

  it("deduplicates by resource ID without disturbing first-usage order", () => {
    const result = resolveCivitaiImageResourceSelection({
      checkpoint,
      usages: [
        usage({ id: "lora-b" }),
        usage({ id: "lora-a" }),
        usage({ id: "lora-b" }),
        usage({ id: "lora-c" }),
        usage({ id: "lora-a" }),
      ],
    });

    expect(result.loraIds).toEqual(["lora-b", "lora-a", "lora-c"]);
    expect(result.warnings.map(({ resourceId, reason }) => ({ resourceId, reason }))).toEqual([
      { resourceId: "lora-b", reason: "duplicate_usage" },
      { resourceId: "lora-a", reason: "duplicate_usage" },
    ]);
  });

  it("skips non-ready and exact-base mismatched LoRAs with safe warnings", () => {
    const result = resolveCivitaiImageResourceSelection({
      checkpoint,
      usages: [
        usage({ id: "lora-not-ready", name: "Not Ready", ready: false }),
        usage({ baseModel: "Illustrious XL", id: "lora-near-match", name: "Near Match" }),
        usage({ baseModel: null, id: "lora-no-base", name: "No Base" }),
        usage({ id: "lora-ready", name: "Ready" }),
      ],
    });

    expect(result.loraIds).toEqual(["lora-ready"]);
    expect(result.warnings).toMatchObject([
      { resourceId: "lora-not-ready", resourceName: "Not Ready", reason: "not_ready" },
      { resourceId: "lora-near-match", resourceName: "Near Match", reason: "base_model_mismatch" },
      { resourceId: "lora-no-base", resourceName: "No Base", reason: "base_model_mismatch" },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/[A-Za-z]:\\|\/Users\/|\/home\//);
  });

  it("returns a successful empty replacement when no LoRA is eligible", () => {
    const result = resolveCivitaiImageResourceSelection({
      checkpoint,
      usages: [
        usage({ id: "ignored-model", resourceType: "model" }),
        usage({ id: "not-ready", ready: false }),
        usage({ baseModel: "Anima", id: "wrong-base" }),
      ],
    });

    expect(result).toMatchObject({
      checkpointId: checkpoint.id,
      loraIds: [],
    });
    expect(result.warnings).toHaveLength(2);
  });

  it("sanitizes warning names without changing resource identity", () => {
    const longUnsafeName = `  Unsafe\nname C:\\private\\models\\${"x".repeat(180)}  `;
    const result = resolveCivitaiImageResourceSelection({
      checkpoint,
      usages: [usage({ id: "safe-id", name: longUnsafeName, ready: false })],
    });

    expect(result.warnings[0]?.resourceId).toBe("safe-id");
    expect(result.warnings[0]?.resourceName).not.toContain("\n");
    expect(result.warnings[0]?.resourceName.length).toBeLessThanOrEqual(120);
  });
});
