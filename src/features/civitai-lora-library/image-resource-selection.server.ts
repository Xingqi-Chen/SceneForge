import { isSameCivitaiBaseModel } from "@/features/civitai-lora-library/base-model";
import {
  getCivitaiResourceDownloadStatus,
  isCivitaiResourceDownloadReady,
} from "@/features/civitai-lora-library/download";
import {
  resolveCivitaiImageResourceSelection,
  type CivitaiImageResourceSelectionUsage,
} from "@/features/civitai-lora-library/image-resource-selection";
import { getCivitaiResourceConfiguredDownloadPath } from "@/features/civitai-lora-library/resource-files";
import type { CivitaiImageResourceSelectionResult } from "@/features/civitai-lora-library/types";
import {
  getCivitaiResourceDetailFromSqlite,
  getImportedImageFromSqlite,
  listImportedImageLoraUsagesFromSqlite,
  loadCivitaiLibrarySettingsFromSqlite,
  type SceneForgeSqliteDatabase,
} from "@/features/persistence/sqlite-storage";

export type CivitaiImageResourceSelectionErrorCode =
  | "checkpoint_base_model_missing"
  | "checkpoint_context_mismatch"
  | "checkpoint_not_found"
  | "checkpoint_not_ready"
  | "checkpoint_wrong_type"
  | "image_base_model_mismatch"
  | "image_not_found";

export class CivitaiImageResourceSelectionError extends Error {
  readonly code: CivitaiImageResourceSelectionErrorCode;
  readonly statusCode: number;

  constructor(
    message: string,
    options: {
      code: CivitaiImageResourceSelectionErrorCode;
      statusCode: number;
    },
  ) {
    super(message);
    this.name = "CivitaiImageResourceSelectionError";
    this.code = options.code;
    this.statusCode = options.statusCode;
  }
}

export async function selectImportedImageResourcesFromSqlite({
  checkpointBaseModel,
  checkpointId,
  db,
  importedImageId,
}: {
  checkpointBaseModel: string;
  checkpointId: string;
  db: SceneForgeSqliteDatabase;
  importedImageId: string;
}): Promise<CivitaiImageResourceSelectionResult> {
  const checkpoint = getCivitaiResourceDetailFromSqlite(db, checkpointId);
  if (!checkpoint) {
    throw new CivitaiImageResourceSelectionError("The selected checkpoint is no longer available.", {
      code: "checkpoint_not_found",
      statusCode: 404,
    });
  }
  if (checkpoint.resourceType !== "model") {
    throw new CivitaiImageResourceSelectionError("The selected resource is not a checkpoint.", {
      code: "checkpoint_wrong_type",
      statusCode: 422,
    });
  }
  if (!checkpoint.baseModel?.trim()) {
    throw new CivitaiImageResourceSelectionError("The selected checkpoint has no usable base-model metadata.", {
      code: "checkpoint_base_model_missing",
      statusCode: 422,
    });
  }
  if (!isSameCivitaiBaseModel(checkpoint.baseModel, checkpointBaseModel)) {
    throw new CivitaiImageResourceSelectionError("The selected checkpoint changed. Reload the image gallery and try again.", {
      code: "checkpoint_context_mismatch",
      statusCode: 409,
    });
  }

  const settings = loadCivitaiLibrarySettingsFromSqlite(db);
  const checkpointStatus = await getCivitaiResourceDownloadStatus(
    checkpoint,
    getCivitaiResourceConfiguredDownloadPath(checkpoint, settings),
  );
  if (!isCivitaiResourceDownloadReady(checkpointStatus)) {
    throw new CivitaiImageResourceSelectionError("The selected checkpoint is not available as a ready local resource.", {
      code: "checkpoint_not_ready",
      statusCode: 422,
    });
  }

  const image = getImportedImageFromSqlite(db, importedImageId);
  if (!image) {
    throw new CivitaiImageResourceSelectionError("Imported image not found.", {
      code: "image_not_found",
      statusCode: 404,
    });
  }
  if (!isSameCivitaiBaseModel(image.baseModel, checkpoint.baseModel)) {
    throw new CivitaiImageResourceSelectionError("This image no longer matches the selected checkpoint base model.", {
      code: "image_base_model_mismatch",
      statusCode: 409,
    });
  }

  const imageLoraUsages = listImportedImageLoraUsagesFromSqlite(db, importedImageId);
  const readinessByResourceId = new Map<string, boolean>();
  const uniqueResources = Array.from(
    new Map(
      imageLoraUsages
        .map(({ resource }) => [resource.id, resource] as const)
        .filter(([id]) => Boolean(id)),
    ).values(),
  );
  await Promise.all(uniqueResources.map(async (resource) => {
    const status = await getCivitaiResourceDownloadStatus(
      resource,
      getCivitaiResourceConfiguredDownloadPath(resource, settings),
    );
    readinessByResourceId.set(resource.id, isCivitaiResourceDownloadReady(status));
  }));

  const usages: CivitaiImageResourceSelectionUsage[] = imageLoraUsages.map(({ resource }) => ({
    ready: readinessByResourceId.get(resource.id) === true,
    resource,
  }));
  return resolveCivitaiImageResourceSelection({ checkpoint, usages });
}
