import crypto from "node:crypto";

import type { TimelineWorkflowState } from "./types";
import { resolveTimelineFinalGenerationPolicy, timelineFinalGenerationPolicy } from "./final-generation-policy";
import { getRunSceneInputSettings } from "./run-input-settings";
import {
  deriveTimelineConfirmedReferenceContext,
  sanitizeTimelineConfirmedReferenceContext,
} from "./run-reference-context";
import { isKrea2ReIdReferenceReady, sanitizeCharacterReferenceSnapshot } from "./style-reference";

const CONFIRMATION_CONTRACT_VERSION = 1;
const CONFIRMATION_CONTRACT_DOMAIN = "sceneforge.timeline.single-image-generation-confirmation";
const confirmationSigningKey = crypto.randomBytes(32);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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

function resolveWorkflowFinalPolicy(workflow: TimelineWorkflowState) {
  const sceneInput = workflow.nodes["scene-input"].result;
  const parameters = workflow.nodes["parameter-recommendation"].result;
  const requestPreview = isRecord(parameters) && isRecord(parameters.requestPreview)
    ? parameters.requestPreview
    : {};
  const settings = getRunSceneInputSettings(isRecord(sceneInput) ? sceneInput : {});
  return resolveTimelineFinalGenerationPolicy(requestPreview, settings.finalRedrawPreset, {
    krea2ReId: isKrea2ReIdReferenceReady(sanitizeCharacterReferenceSnapshot(settings.characterReference)),
  });
}

export function createTimelineGenerationConfirmationFingerprint(workflow: TimelineWorkflowState) {
  const resolvedFinalPolicy = resolveWorkflowFinalPolicy(workflow);
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
    referenceContext: deriveTimelineConfirmedReferenceContext(workflow),
    finalPolicy: timelineFinalGenerationPolicy,
    resolvedFinalPolicy,
  });
  return `hmac-sha256:${crypto.createHmac("sha256", confirmationSigningKey).update(JSON.stringify(contract)).digest("hex")}`;
}

export function isTimelineGenerationConfirmationCurrent(workflow: TimelineWorkflowState) {
  const result = workflow.nodes["generation-gate"].result;
  if (typeof result !== "object" || result === null || Array.isArray(result)) return false;
  const gate = result as Record<string, unknown>;
  const fingerprint = gate.confirmationFingerprint;
  const resolvedFinalPolicy = resolveWorkflowFinalPolicy(workflow);
  const sceneInput = workflow.nodes["scene-input"].result;
  const settings = getRunSceneInputSettings(isRecord(sceneInput) ? sceneInput : {});
  const activeKrea2ReId = isKrea2ReIdReferenceReady(
    sanitizeCharacterReferenceSnapshot(settings.characterReference),
  );
  const expectedReferenceContext = deriveTimelineConfirmedReferenceContext(workflow);
  const persistedReferenceContext = sanitizeTimelineConfirmedReferenceContext(gate.referenceContext);
  const canonicalPersistedContext = persistedReferenceContext
    ? JSON.stringify(canonicalize(persistedReferenceContext))
    : null;
  const persistedContextIsCanonical = canonicalPersistedContext !== null &&
    JSON.stringify(canonicalize(gate.referenceContext)) === canonicalPersistedContext;
  if (activeKrea2ReId && (
    expectedReferenceContext?.version !== 2 ||
    expectedReferenceContext.adapter !== "krea2-reid" ||
    !persistedContextIsCanonical ||
    canonicalPersistedContext !== JSON.stringify(canonicalize(expectedReferenceContext))
  )) return false;
  if (!activeKrea2ReId && gate.referenceContext !== undefined && (
    !persistedContextIsCanonical ||
    !expectedReferenceContext ||
    canonicalPersistedContext !== JSON.stringify(canonicalize(expectedReferenceContext))
  )) return false;
  if (gate.finalPolicyVersion !== resolvedFinalPolicy.version ||
      gate.finalRedrawPreset !== resolvedFinalPolicy.preset ||
      gate.finalGenerationFamily !== resolvedFinalPolicy.family ||
      gate.finalSteps !== resolvedFinalPolicy.steps ||
      gate.finalDenoise !== resolvedFinalPolicy.denoise ||
      gate.automaticLocalRepairAuthorized !== settings.automaticLocalRepair ||
      gate.visualStyle !== settings.visualStyle) return false;
  if (typeof fingerprint !== "string" || !/^hmac-sha256:[a-f0-9]{64}$/.test(fingerprint)) return false;
  const expected = createTimelineGenerationConfirmationFingerprint(workflow);
  return crypto.timingSafeEqual(Buffer.from(fingerprint), Buffer.from(expected));
}
