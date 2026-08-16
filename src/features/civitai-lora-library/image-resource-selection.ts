import { isSameCivitaiBaseModel } from "@/features/civitai-lora-library/base-model";
import type {
  CivitaiImageResourceSelectionResult,
  CivitaiImageResourceSelectionWarning,
  CivitaiResourceRecord,
} from "@/features/civitai-lora-library/types";

export type CivitaiImageResourceSelectionUsage = {
  ready: boolean;
  resource: Pick<CivitaiResourceRecord, "baseModel" | "id" | "name" | "resourceType">;
};

function warning(
  resourceId: string,
  resourceName: string,
  reason: CivitaiImageResourceSelectionWarning["reason"],
  message: string,
): CivitaiImageResourceSelectionWarning {
  return { resourceId, resourceName, reason, message };
}

function safeResourceName(resource: CivitaiImageResourceSelectionUsage["resource"]) {
  const name = resource.name.replace(/\s+/g, " ").trim().slice(0, 120);
  return name || resource.id;
}

export function resolveCivitaiImageResourceSelection({
  checkpoint,
  usages,
}: {
  checkpoint: Pick<CivitaiResourceRecord, "baseModel" | "id">;
  usages: readonly CivitaiImageResourceSelectionUsage[];
}): CivitaiImageResourceSelectionResult {
  const seenLoraIds = new Set<string>();
  const loraIds: string[] = [];
  const warnings: CivitaiImageResourceSelectionWarning[] = [];

  for (const usage of usages) {
    const resource = usage.resource;
    if (resource.resourceType !== "lora" || !resource.id) {
      continue;
    }

    const resourceName = safeResourceName(resource);

    if (seenLoraIds.has(resource.id)) {
      warnings.push(warning(
        resource.id,
        resourceName,
        "duplicate_usage",
        `LoRA "${resourceName}" was listed more than once and was selected only once.`,
      ));
      continue;
    }

    seenLoraIds.add(resource.id);
    if (!usage.ready) {
      warnings.push(warning(
        resource.id,
        resourceName,
        "not_ready",
        `LoRA "${resourceName}" was skipped because its ready local file is unavailable.`,
      ));
      continue;
    }

    if (!isSameCivitaiBaseModel(resource.baseModel, checkpoint.baseModel)) {
      warnings.push(warning(
        resource.id,
        resourceName,
        "base_model_mismatch",
        `LoRA "${resourceName}" was skipped because its base model does not match the selected checkpoint.`,
      ));
      continue;
    }

    loraIds.push(resource.id);
  }

  return {
    checkpointId: checkpoint.id,
    loraIds,
    warnings,
  };
}
