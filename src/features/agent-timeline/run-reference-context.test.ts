import { describe, expect, it } from "vitest";

import { createTimelineWorkflowState, setTimelineNodeManualResult } from "./state";
import {
  deriveTimelineConfirmedReferenceContext,
  sanitizeTimelineConfirmedReferenceContext,
} from "./run-reference-context";
import type { TimelineWorkflowState } from "./types";

const styleReference = {
  status: "ready" as const,
  mode: "ipadapter" as const,
  metadata: {
    byteLength: 321,
    contentType: "image/png",
    storedFilename: "0123456789abcdef0123456789abcdef.png",
    uploadedAt: "2026-07-19T00:00:00.000Z",
  },
  analysis: {
    analyzedAt: "2026-07-19T00:00:01.000Z",
    stylePrompt: "soft gouache",
    summary: "Soft gouache.",
  },
  ipAdapter: { weight: 0.45, startPercent: 0, endPercent: 1 },
  settingsSnapshot: {
    capturedAt: "2026-07-19T00:00:02.000Z",
    checkpointBaseModel: "Krea 2",
    checkpointId: "checkpoint-krea",
    modeReason: "Krea adapter is available.",
    promptProfile: "krea2" as const,
  },
};

const characterReference = {
  status: "ready" as const,
  strength: 0.35,
  metadata: {
    byteLength: 654,
    contentType: "image/webp",
    storedFilename: "fedcba9876543210fedcba9876543210.webp",
    uploadedAt: "2026-07-19T00:00:00.000Z",
  },
};

function workflowWithRequest(settingsSnapshot: Record<string, unknown>, requestPreview: Record<string, unknown>) {
  let workflow: TimelineWorkflowState = createTimelineWorkflowState({
    workflowId: "run-reference-context",
    sceneRequest: "A quiet station",
    settingsSnapshot,
  });
  workflow = setTimelineNodeManualResult(workflow, "parameter-recommendation", { requestPreview });
  return workflow;
}

describe("confirmed Run reference context", () => {
  it("keeps the selected character but omits a legacy IPAdapter style reference outside an effective supported profile", () => {
    const context = deriveTimelineConfirmedReferenceContext(workflowWithRequest({
      promptProfile: "anima",
      styleReference,
      characterReference,
    }, {
      checkpointName: "pencil-xl-diffusion.safetensors",
      modelBaseModel: "Anima",
      modelStorageKind: "diffusion",
      positivePrompt: "a quiet station",
    }));

    expect(context).toMatchObject({
      adapter: "ipadapter",
      references: [{
        role: "character",
        storedFilename: "fedcba9876543210fedcba9876543210.webp",
        strength: 0.35,
      }],
    });
  });

  it("captures only managed identity metadata and shares the Krea strength across ordered roles", () => {
    const context = deriveTimelineConfirmedReferenceContext(workflowWithRequest({
      promptProfile: "krea2",
      kreaReferenceStrength: 0.82,
      styleReference: {
        ...styleReference,
        dataUrl: "data:image/png;base64,STYLE_SECRET",
      },
      characterReference: {
        ...characterReference,
        bytes: [1, 2, 3],
      },
    }, {
      checkpointName: "krea-2-turbo-unet.safetensors",
      modelBaseModel: "Krea 2",
      modelStorageKind: "diffusion",
      positivePrompt: "a quiet station, soft gouache",
      workflowProfile: "krea2",
    }));

    expect(context).toEqual({
      version: 1,
      adapter: "krea2-ostris",
      references: [
        {
          role: "style",
          storedFilename: "0123456789abcdef0123456789abcdef.png",
          contentType: "image/png",
          byteLength: 321,
          strength: 0.82,
        },
        {
          role: "character",
          storedFilename: "fedcba9876543210fedcba9876543210.webp",
          contentType: "image/webp",
          byteLength: 654,
          strength: 0.82,
        },
      ],
      startPercent: 0,
      endPercent: 1,
    });
    expect(JSON.stringify(context)).not.toContain("STYLE_SECRET");
    expect(JSON.stringify(context)).not.toContain('"bytes"');
  });

  it("fails closed for reordered and unequal Krea contexts while stripping byte-bearing transport fields", () => {
    const valid = {
      version: 1,
      adapter: "krea2-ostris",
      references: [
        { role: "style", storedFilename: "0123456789abcdef0123456789abcdef.png", contentType: "image/png", byteLength: 321, strength: 0.8 },
        { role: "character", storedFilename: "fedcba9876543210fedcba9876543210.webp", contentType: "image/webp", byteLength: 654, strength: 0.8 },
      ],
      startPercent: 0,
      endPercent: 1,
    };
    expect(sanitizeTimelineConfirmedReferenceContext(valid)).toEqual(valid);
    expect(sanitizeTimelineConfirmedReferenceContext({
      ...valid,
      references: [...valid.references].reverse(),
    })).toBeUndefined();
    expect(sanitizeTimelineConfirmedReferenceContext({
      ...valid,
      references: [{ ...valid.references[0], bytes: [1, 2, 3] }],
    })).toEqual({ ...valid, references: [valid.references[0]] });
    expect(sanitizeTimelineConfirmedReferenceContext({
      ...valid,
      references: [valid.references[0], { ...valid.references[1], strength: 0.4 }],
    })).toBeUndefined();
  });
});
