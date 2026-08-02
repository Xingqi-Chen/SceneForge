import { describe, expect, it } from "vitest";

import {
  CHARACTER_REFERENCE_DEFAULT_STRENGTH,
  STYLE_REFERENCE_IP_ADAPTER_DEFAULTS,
  appendStyleReferencePromptExactlyOnce,
  buildCharacterReferenceSequenceCharacter,
  buildStyleReferenceSequenceCharacter,
  createCharacterReferenceSnapshot,
  createKrea2ReIdReferenceSnapshot,
  createStyleReferenceSnapshot,
  getCharacterReferenceBlockingIssue,
  getStyleReferenceBlockingIssue,
  getStyleReferenceCapability,
  getStyleReferenceContextMismatch,
  parseStyleReferenceAnalysisContent,
  sanitizeCharacterReferenceSnapshot,
  sanitizeStyleReferenceIpAdapterSettings,
  sanitizeStyleReferenceSnapshot,
} from "./style-reference";

const metadata = {
  byteLength: 321,
  contentType: "image/png",
  filename: "style.png",
  storedFilename: "0123456789abcdef0123456789abcdef.png",
  uploadedAt: "2026-07-19T00:00:00.000Z",
  url: "/forged/url",
};

const analysis = {
  analyzedAt: "2026-07-19T00:00:01.000Z",
  model: "vision-model",
  stylePrompt: "soft gouache, cobalt shadows",
  summary: "Soft gouache with cobalt shadows.",
};

function readyReference(mode: "prompt-only" | "ipadapter" = "ipadapter") {
  return createStyleReferenceSnapshot({
    analysis,
    capturedAt: "2026-07-19T00:00:02.000Z",
    checkpointBaseModel: "Illustrious",
    checkpointId: "checkpoint-a",
    ipAdapter: STYLE_REFERENCE_IP_ADAPTER_DEFAULTS,
    metadata,
    mode,
    modeReason: "Illustrious supports IPAdapter.",
    promptProfile: "illustrious",
  });
}

describe("workflow-neutral style reference contract", () => {
  it("keeps Run character references byte-free and blocks ready records without safe storage metadata", () => {
    const sanitized = sanitizeCharacterReferenceSnapshot({
      status: "ready",
      strength: 0.666,
      bytes: [1, 2, 3],
      dataUrl: "data:image/png;base64,CHARACTER_SECRET",
      metadata: {
        ...metadata,
        bytes: [1, 2, 3],
        filename: "C:\\private\\hero.png",
        url: "https://attacker.invalid/hero.png",
      },
    });

    expect(sanitized).toEqual({
      status: "ready",
      strength: 0.67,
      metadata: {
        byteLength: metadata.byteLength,
        contentType: metadata.contentType,
        storedFilename: metadata.storedFilename,
        uploadedAt: metadata.uploadedAt,
        url: `/api/comfyui/sequence-references/${metadata.storedFilename}`,
      },
    });
    expect(JSON.stringify(sanitized)).not.toContain("CHARACTER_SECRET");
    expect(JSON.stringify(sanitized)).not.toContain("attacker.invalid");
    expect(JSON.stringify(sanitized)).not.toContain("C:\\\\private");

    const missingStorage = sanitizeCharacterReferenceSnapshot({ status: "ready", strength: 0.4 });
    expect(missingStorage).toEqual({
      error: "Character reference storage is missing or invalid. Replace or remove the reference.",
      status: "invalid",
      strength: 0.4,
    });
    expect(getCharacterReferenceBlockingIssue(missingStorage)).toContain("storage is missing");
    expect(createCharacterReferenceSnapshot({ metadata })).toMatchObject({
      status: "ready",
      strength: CHARACTER_REFERENCE_DEFAULT_STRENGTH,
    });
    expect(buildCharacterReferenceSequenceCharacter(sanitized, { id: "run-character-reference" })).toMatchObject({
      id: "run-character-reference",
      mode: "ipadapter",
      weight: 0.67,
      references: [{ storedFilename: metadata.storedFilename }],
    });
  });

  it("persists only sanitized prepared ReID metadata and never upgrades legacy Krea character state", () => {
    const prepared = createKrea2ReIdReferenceSnapshot({
      metadata: {
        ...metadata,
        filename: "C:\\private\\identity.png",
        url: "https://attacker.invalid/identity.png",
      },
      preparation: {
        choice: "crop",
        detector: "yunet-2023mar-int8",
        detectorSha256: "a".repeat(64),
        faceDetected: true,
        height: 256,
        version: 1,
        width: 256,
      },
    });
    const sanitized = sanitizeCharacterReferenceSnapshot({
      ...prepared,
      bytes: [1, 2, 3],
      dataUrl: "data:image/png;base64,SECRET_REID",
      path: "C:\\private\\identity.png",
      tensor: [0.1, 0.2],
      tempName: "comfy-temp.png",
      reIdPreparation: {
        ...prepared.reIdPreparation,
        alternatePreview: "data:image/png;base64,ALTERNATE",
        detectorPath: "C:\\models\\yunet.onnx",
      },
    });

    expect(sanitized).toMatchObject({
      kind: "krea2-reid",
      status: "ready",
      strength: 1,
      metadata: {
        storedFilename: metadata.storedFilename,
        url: `/api/comfyui/sequence-references/${metadata.storedFilename}`,
      },
      reIdPreparation: {
        choice: "crop",
        detector: "yunet-2023mar-int8",
        faceDetected: true,
        height: 256,
        version: 1,
        width: 256,
      },
    });
    const serialized = JSON.stringify(sanitized);
    for (const secret of ["SECRET_REID", "ALTERNATE", "private", "yunet.onnx", "comfy-temp", "tensor"]) {
      expect(serialized).not.toContain(secret);
    }

    const legacy = sanitizeCharacterReferenceSnapshot({
      status: "ready",
      strength: 0.8,
      metadata,
      reIdPreparation: prepared.reIdPreparation,
    });
    expect(legacy).toMatchObject({ status: "ready", strength: 0.8 });
    expect(legacy).not.toHaveProperty("kind");
    expect(legacy).not.toHaveProperty("reIdPreparation");
  });

  it("sanitizes storage metadata and drops bytes, data URLs, forged URLs, paths, and unknown fields", () => {
    const sanitized = sanitizeStyleReferenceSnapshot({
      ...readyReference(),
      bytes: [1, 2, 3],
      dataUrl: "data:image/png;base64,SECRET",
      metadata: {
        ...metadata,
        filename: "C:\\private\\style.png",
        url: "https://attacker.invalid/style.png",
        apiKey: "SECRET",
      },
      analysis: {
        ...analysis,
        rawImage: "data:image/png;base64,SECRET",
      },
      cache: { path: "C:\\private\\cache" },
    });

    expect(sanitized).toMatchObject({
      status: "ready",
      metadata: {
        storedFilename: metadata.storedFilename,
        url: `/api/comfyui/sequence-references/${metadata.storedFilename}`,
      },
      analysis,
    });
    expect(sanitized?.metadata).not.toHaveProperty("filename");
    const persisted = JSON.stringify(sanitized);
    expect(persisted).not.toContain("SECRET");
    expect(persisted).not.toContain("attacker.invalid");
    expect(persisted).not.toContain("C:\\\\private");
    expect(persisted).not.toContain("rawImage");
    expect(persisted).not.toContain("cache");
  });

  it("keeps pending, failed, mismatch, and invalid states explicitly blocking", () => {
    for (const status of ["pending", "failed", "mismatch", "invalid"] as const) {
      const snapshot = sanitizeStyleReferenceSnapshot({
        error: `${status} reference`,
        mode: "prompt-only",
        status,
      });
      expect(snapshot?.status).toBe(status);
      expect(getStyleReferenceBlockingIssue(snapshot, "Run")).toBe(`${status} reference`);
    }
    expect(getStyleReferenceBlockingIssue(undefined, "Run")).toBe("");
  });

  it("parses JSON or fenced prose payloads and rejects missing style prompts", () => {
    expect(parseStyleReferenceAnalysisContent(
      'Result: {"summary":"Ink wash","stylePrompt":"ink wash, paper grain"}',
      { analyzedAt: analysis.analyzedAt, model: "vision" },
    )).toEqual({
      analyzedAt: analysis.analyzedAt,
      model: "vision",
      stylePrompt: "ink wash, paper grain",
      summary: "Ink wash",
    });
    expect(() => parseStyleReferenceAnalysisContent(
      '{"summary":"No reusable prompt"}',
      { analyzedAt: analysis.analyzedAt },
    )).toThrow("did not include a reusable stylePrompt");
  });

  it("normalizes IPAdapter defaults, bounds, aliases, and start/end ordering", () => {
    expect(sanitizeStyleReferenceIpAdapterSettings(undefined)).toEqual({
      endPercent: 1,
      startPercent: 0,
      weight: 0.45,
    });
    expect(sanitizeStyleReferenceIpAdapterSettings({ weight: -3, start_at: -1, end_at: 4 })).toEqual({
      endPercent: 1,
      startPercent: 0,
      weight: 0,
    });
    expect(sanitizeStyleReferenceIpAdapterSettings({ weight: 4, startPercent: 0.2, endPercent: 0.8 })).toEqual({
      endPercent: 0.8,
      startPercent: 0.2,
      weight: 1,
    });
    expect(sanitizeStyleReferenceIpAdapterSettings({ startPercent: 0.9, endPercent: 0.1 })).toEqual({
      endPercent: 1,
      startPercent: 0,
      weight: 0.45,
    });
  });

  it("uses IPAdapter only for Illustrious and keeps Anima/unknown/unsupported prompt-only", () => {
    expect(getStyleReferenceCapability({ baseModel: "Illustrious XL" }).mode).toBe("ipadapter");
    expect(getStyleReferenceCapability({ modelFileName: "anima_v2.safetensors" }).mode).toBe("prompt-only");
    expect(getStyleReferenceCapability({ baseModel: "SDXL 1.0" }).mode).toBe("prompt-only");
    expect(getStyleReferenceCapability({}).mode).toBe("prompt-only");
  });

  it("detects prompt-profile, base-model, and checkpoint context mismatches", () => {
    const reference = readyReference();
    expect(getStyleReferenceContextMismatch(reference, {
      checkpointBaseModel: "illustrious",
      checkpointId: "checkpoint-a",
      promptProfile: "illustrious",
    })).toBe("");
    for (const current of [
      { checkpointBaseModel: "Anima", checkpointId: "checkpoint-a", promptProfile: "illustrious" as const },
      { checkpointBaseModel: "Illustrious", checkpointId: "checkpoint-b", promptProfile: "illustrious" as const },
      { checkpointBaseModel: "Illustrious", checkpointId: "checkpoint-a", promptProfile: "anima" as const },
    ]) {
      expect(getStyleReferenceContextMismatch(reference, current)).toContain("different base model or checkpoint");
    }
  });

  it("appends the opaque style segment once at the end and preserves its internal text", () => {
    const reference = readyReference();
    const once = appendStyleReferencePromptExactlyOnce("subject, dramatic light", reference);
    expect(once).toBe("subject, dramatic light, soft gouache, cobalt shadows");
    expect(appendStyleReferencePromptExactlyOnce(once, reference)).toBe(once);
  });

  it("builds an Illustrious sequence reference with normalized 0, 0.45, and 1 values", () => {
    expect(buildStyleReferenceSequenceCharacter(readyReference(), {
      id: "run-style-reference",
      name: "Run style reference",
    })).toEqual({
      id: "run-style-reference",
      name: "Run style reference",
      prompt: analysis.stylePrompt,
      enabled: true,
      mode: "ipadapter",
      references: [{
        id: "run-style-reference-image",
        storedFilename: metadata.storedFilename,
      }],
      weight: 0.45,
      startPercent: 0,
      endPercent: 1,
    });
    expect(buildStyleReferenceSequenceCharacter(readyReference("prompt-only"))).toBeNull();
  });
});
