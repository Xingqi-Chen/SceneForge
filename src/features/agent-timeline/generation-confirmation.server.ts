import crypto from "node:crypto";

import type { TimelineWorkflowState } from "./types";

const CONFIRMATION_CONTRACT_VERSION = 1;
const CONFIRMATION_CONTRACT_DOMAIN = "sceneforge.timeline.single-image-generation-confirmation";
const confirmationSigningKey = crypto.randomBytes(32);

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return null;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

export function createTimelineGenerationConfirmationFingerprint(workflow: TimelineWorkflowState) {
  const contract = canonicalize({
    domain: CONFIRMATION_CONTRACT_DOMAIN,
    version: CONFIRMATION_CONTRACT_VERSION,
    workflowId: workflow.workflowId,
    sceneInput: workflow.nodes["scene-input"].result,
    scenePrompt: workflow.nodes["scene-prompt"].result,
    characterTags: workflow.nodes["character-tags"].result,
    characterAction: workflow.nodes["character-action"].result,
    canvasBinding: workflow.nodes["canvas-binding"].result,
    resources: workflow.nodes["resource-recommendation"].result,
    parameters: workflow.nodes["parameter-recommendation"].result,
  });
  return `hmac-sha256:${crypto.createHmac("sha256", confirmationSigningKey).update(JSON.stringify(contract)).digest("hex")}`;
}

export function isTimelineGenerationConfirmationCurrent(workflow: TimelineWorkflowState) {
  const result = workflow.nodes["generation-gate"].result;
  if (typeof result !== "object" || result === null || Array.isArray(result)) return false;
  const fingerprint = (result as Record<string, unknown>).confirmationFingerprint;
  if (typeof fingerprint !== "string" || !/^hmac-sha256:[a-f0-9]{64}$/.test(fingerprint)) return false;
  const expected = createTimelineGenerationConfirmationFingerprint(workflow);
  return crypto.timingSafeEqual(Buffer.from(fingerprint), Buffer.from(expected));
}
