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

const krea2ReIdReference = {
  kind: "krea2-reid" as const,
  status: "ready" as const,
  strength: 1,
  metadata: {
    byteLength: 777,
    contentType: "image/png",
    storedFilename: "fedcba9876543210fedcba9876543210.png",
    uploadedAt: "2026-08-02T00:00:00.000Z",
  },
  reIdPreparation: {
    choice: "crop" as const,
    detector: "yunet-2023mar-int8" as const,
    detectorSha256: "a".repeat(64),
    faceDetected: true,
    height: 256,
    version: 1 as const,
    width: 256,
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

  it("captures only the prepared ReID identity while pausing the stored Krea style adapter", () => {
    const context = deriveTimelineConfirmedReferenceContext(workflowWithRequest({
      promptProfile: "krea2",
      kreaReferenceStrength: 0.82,
      styleReference: {
        ...styleReference,
        dataUrl: "data:image/png;base64,STYLE_SECRET",
      },
      characterReference: {
        ...krea2ReIdReference,
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
      version: 2,
      adapter: "krea2-reid",
      references: [
        {
          role: "character",
          storedFilename: "fedcba9876543210fedcba9876543210.png",
          contentType: "image/png",
          byteLength: 777,
          strength: 1,
        },
      ],
      startPercent: 0,
      endPercent: 1,
    });
    expect(JSON.stringify(context)).not.toContain("STYLE_SECRET");
    expect(JSON.stringify(context)).not.toContain('"bytes"');
  });

  it("restores style-only context after ReID removal and never migrates a generic Krea character", () => {
    const settings = {
      promptProfile: "krea2" as const,
      kreaReferenceStrength: 0.82,
      styleReference,
    };
    const request = {
      checkpointName: "RedCraft_v4_fp8.safetensors",
      modelBaseModel: "Krea 2",
      modelStorageKind: "diffusion" as const,
      positivePrompt: "a quiet station, soft gouache",
      workflowProfile: "krea2" as const,
    };

    expect(deriveTimelineConfirmedReferenceContext(workflowWithRequest(settings, request))).toMatchObject({
      version: 1,
      adapter: "krea2-ostris",
      references: [{ role: "style", strength: 0.82 }],
    });
    expect(deriveTimelineConfirmedReferenceContext(workflowWithRequest({
      ...settings,
      characterReference,
    }, request))).toMatchObject({
      version: 1,
      adapter: "krea2-ostris",
      references: [{ role: "style" }],
    });
  });

  it("fails closed for tampered v2 ReID and legacy dual-image contexts while stripping transport fields", () => {
    const valid = {
      version: 2,
      adapter: "krea2-reid",
      references: [{
        role: "character",
        storedFilename: "fedcba9876543210fedcba9876543210.png",
        contentType: "image/png",
        byteLength: 777,
        strength: 1,
        bytes: [1, 2, 3],
        dataUrl: "data:image/png;base64,SECRET",
        path: "C:\\private\\reid.png",
        temporaryComfyUiName: "transient.png",
      }],
      startPercent: 0,
      endPercent: 1,
    };
    expect(sanitizeTimelineConfirmedReferenceContext(valid)).toEqual({
      ...valid,
      references: [{
        role: "character",
        storedFilename: "fedcba9876543210fedcba9876543210.png",
        contentType: "image/png",
        byteLength: 777,
        strength: 1,
      }],
    });
    expect(sanitizeTimelineConfirmedReferenceContext({
      ...valid,
      version: 1,
    })).toBeUndefined();
    expect(sanitizeTimelineConfirmedReferenceContext({
      ...valid,
      references: [{ ...valid.references[0], strength: 0.99 }],
    })).toBeUndefined();
    expect(sanitizeTimelineConfirmedReferenceContext({
      version: 1,
      adapter: "krea2-ostris",
      references: [
        { role: "style", storedFilename: "0123456789abcdef0123456789abcdef.png", contentType: "image/png", byteLength: 321, strength: 0.8 },
        { role: "character", storedFilename: "fedcba9876543210fedcba9876543210.webp", contentType: "image/webp", byteLength: 654, strength: 0.8 },
      ],
      startPercent: 0,
      endPercent: 1,
    })).toBeUndefined();
  });
});
