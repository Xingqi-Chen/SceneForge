import { describe, expect, it } from "vitest";

import {
  getComfyUiKrea2ReIdContextIssue,
  getComfyUiKrea2ReIdWorkflowIssues,
  normalizeComfyUiKrea2ReIdDescriptor,
} from "./krea2-reid";
import type { ComfyUiWorkflow } from "./types";
import { buildBasicTextToImageWorkflow } from "./workflow";

const descriptor = {
  version: 1 as const,
  referenceDigest: `sha256:${"a".repeat(64)}`,
  loraName: "krea2_reid_rank32.safetensors" as const,
  strengthModel: 1 as const,
  kvCache: true as const,
  imageCount: 1 as const,
};

function validWorkflow() {
  return buildBasicTextToImageWorkflow({
    checkpointName: "RedCraft_v4_fp8_scaled.safetensors",
    modelBaseModel: "Krea 2",
    modelStorageKind: "diffusion",
    workflowProfile: "krea2",
    positivePrompt: "portrait in a new outfit",
    negativePrompt: "blur",
    steps: 8,
    cfg: 1,
    samplerName: "euler",
    scheduler: "simple",
    krea2ReId: { imageName: "prepared-reid.png" },
    krea2ReIdDescriptor: descriptor,
  });
}

describe("Krea2 ReID invariant contract", () => {
  it("normalizes only the exact server-owned descriptor", () => {
    expect(normalizeComfyUiKrea2ReIdDescriptor(descriptor)).toEqual(descriptor);
    for (const invalid of [
      undefined,
      null,
      { ...descriptor, version: 2 },
      { ...descriptor, referenceDigest: "sha256:short" },
      { ...descriptor, loraName: "other.safetensors" },
      { ...descriptor, strengthModel: 0.99 },
      { ...descriptor, kvCache: false },
      { ...descriptor, imageCount: 2 },
      { ...descriptor, imageName: "transport.png" },
    ]) {
      expect(normalizeComfyUiKrea2ReIdDescriptor(invalid)).toBe(invalid === undefined ? undefined : null);
    }
  });

  it("selects RedCraft by authoritative metadata and rejects misleading filename-only context", () => {
    expect(getComfyUiKrea2ReIdContextIssue({
      checkpointName: "RedCraft_v4_fp8_scaled.safetensors",
      modelBaseModel: "Krea 2",
      modelStorageKind: "diffusion",
    })).toBe("");
    expect(getComfyUiKrea2ReIdContextIssue({
      checkpointName: "Krea2_Turbo_ReID.safetensors",
      modelBaseModel: "Illustrious",
      modelStorageKind: "diffusion",
      workflowProfile: "krea2",
    })).toContain("authoritative Krea 2 diffusion-model request context");
  });

  it("accepts the generated exact graph and rejects value, connection, image2, and generic-reference tampering", () => {
    const result = validWorkflow();
    expect(getComfyUiKrea2ReIdWorkflowIssues(result.workflow)).toEqual([]);

    const cases: Array<[string, (workflow: ComfyUiWorkflow) => void]> = [
      ["LoRA strength", (workflow) => {
        workflow[result.nodeIds.reIdLora!]!.inputs.strength_model = 0.8;
      }],
      ["kv_cache", (workflow) => {
        workflow[result.nodeIds.reIdPatch!]!.inputs.kv_cache = false;
      }],
      ["patch connection", (workflow) => {
        workflow[result.nodeIds.reIdPatch!]!.inputs.model = [result.nodeIds.unetLoader!, 0];
      }],
      ["image2", (workflow) => {
        workflow[result.nodeIds.positivePrompt]!.inputs.image2 = [result.nodeIds.reIdReferenceImage!, 0];
      }],
      ["reference connection", (workflow) => {
        workflow[result.nodeIds.positivePrompt]!.inputs.image1 = [result.nodeIds.reIdPatch!, 0];
      }],
      ["sampler model", (workflow) => {
        workflow[result.nodeIds.sampler]!.inputs.model = [result.nodeIds.unetLoader!, 0];
      }],
      ["sampler values", (workflow) => {
        workflow[result.nodeIds.sampler]!.inputs.steps = 6;
      }],
      ["generic character adapter", (workflow) => {
        workflow["999"] = {
          class_type: "IPAdapterAdvanced",
          inputs: { image: [result.nodeIds.reIdReferenceImage!, 0], model: [result.nodeIds.reIdPatch!, 0] },
        };
      }],
    ];

    for (const [label, tamper] of cases) {
      const workflow = structuredClone(result.workflow);
      tamper(workflow);
      expect(getComfyUiKrea2ReIdWorkflowIssues(workflow), label).not.toEqual([]);
    }
  });
});
