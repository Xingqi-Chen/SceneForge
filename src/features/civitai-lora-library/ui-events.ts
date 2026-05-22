"use client";

export const OPEN_CIVITAI_LIBRARY_RESOURCE_DETAIL_EVENT =
  "sceneforge:civitai-library:open-resource-detail";

export type CivitaiLibraryResourceDetailTarget = {
  id: string;
  resourceType: "lora" | "model";
};

export function dispatchOpenCivitaiLibraryResourceDetail(target: CivitaiLibraryResourceDetailTarget) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<CivitaiLibraryResourceDetailTarget>(OPEN_CIVITAI_LIBRARY_RESOURCE_DETAIL_EVENT, {
      detail: target,
    }),
  );
}

export function isOpenCivitaiLibraryResourceDetailEvent(
  event: Event,
): event is CustomEvent<CivitaiLibraryResourceDetailTarget> {
  const detail = "detail" in event ? event.detail : null;

  return (
    Boolean(detail) &&
    typeof detail === "object" &&
    typeof (detail as { id?: unknown }).id === "string" &&
    ((detail as { resourceType?: unknown }).resourceType === "lora" ||
      (detail as { resourceType?: unknown }).resourceType === "model")
  );
}
