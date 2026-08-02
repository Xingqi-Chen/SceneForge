import { isKrea2CivitaiBaseModel } from "@/features/civitai-lora-library/base-model";

import type {
  ComfyUiKrea2StyleReferenceDescriptor,
  ComfyUiTextToImageRequest,
} from "./types";
import { resolveComfyUiTextToImageWorkflowProfile } from "./workflow-profiles";

/**
 * The Krea edit LoRA is paired with the Ostris Krea 2 reference-conditioning
 * nodes. It is not compatible with the generic SD/Illustrious IPAdapter path.
 */
export const KREA2_STYLE_REFERENCE_LORA_NAME = "krea2_style_reference.safetensors";
export const KREA2_STYLE_REFERENCE_TEXT_ENCODE_NODE = "TextEncodeKrea2OstrisEdit";
export const KREA2_STYLE_REFERENCE_MODEL_PATCH_NODE = "Krea2OstrisEditModelPatch";

export function normalizeComfyUiKrea2StyleReferenceDescriptor(
  value: unknown,
): ComfyUiKrea2StyleReferenceDescriptor | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = ["version", "referenceDigest", "loraName", "weight", "startPercent", "endPercent", "references"];
  const references = record.references === undefined
    ? undefined
    : Array.isArray(record.references) && record.references.length >= 1 && record.references.length <= 2
      ? record.references.map((entry) => {
          if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return null;
          const role = (entry as Record<string, unknown>).role;
          const referenceDigest = (entry as Record<string, unknown>).referenceDigest;
          return (role === "style" || role === "character") &&
              typeof referenceDigest === "string" && /^sha256:[a-f0-9]{64}$/.test(referenceDigest)
            ? { role, referenceDigest }
            : null;
        })
      : null;
  if (Object.keys(record).some((key) => !keys.includes(key)) ||
      record.version !== 1 ||
      typeof record.referenceDigest !== "string" ||
      !/^sha256:[a-f0-9]{64}$/.test(record.referenceDigest) ||
      record.loraName !== KREA2_STYLE_REFERENCE_LORA_NAME ||
      !["weight", "startPercent", "endPercent"].every((key) =>
        typeof record[key] === "number" && Number.isFinite(record[key]) &&
        Number(record[key]) >= 0 && Number(record[key]) <= 1) ||
      record.startPercent !== 0 || record.endPercent !== 1 || references === null ||
      references && (new Set(references.map((entry) => entry?.role)).size !== references.length ||
        references.length === 2 && (references[0]?.role !== "style" || references[1]?.role !== "character"))) {
    return null;
  }
  return {
    version: 1,
    referenceDigest: record.referenceDigest,
    loraName: KREA2_STYLE_REFERENCE_LORA_NAME,
    weight: record.weight as number,
    startPercent: 0,
    endPercent: 1,
    ...(references ? { references: references as Array<{ role: "style" | "character"; referenceDigest: string }> } : {}),
  };
}

export function getComfyUiKrea2StyleReferenceContextIssue(
  request: Pick<
    ComfyUiTextToImageRequest,
    "checkpointName" | "modelBaseModel" | "modelStorageKind" | "workflowProfile"
  >,
) {
  const profile = resolveComfyUiTextToImageWorkflowProfile(request).id;
  if (profile !== "krea2" || request.modelStorageKind !== "diffusion" ||
      !isKrea2CivitaiBaseModel(request.modelBaseModel)) {
    return "Krea style reference requires a Krea 2 diffusion-model request context.";
  }

  const normalizedCheckpointName = request.checkpointName.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (!normalizedCheckpointName.includes("krea2") || !normalizedCheckpointName.includes("turbo")) {
    return "Krea style reference requires a compatible Krea 2 Turbo diffusion model.";
  }

  return "";
}

export function isComfyUiKrea2StyleReferenceTimingSupported(
  value: { startPercent?: number; endPercent?: number },
) {
  return (value.startPercent ?? 0) === 0 && (value.endPercent ?? 1) === 1;
}
