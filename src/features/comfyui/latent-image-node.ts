export const COMFYUI_LATENT_IMAGE_NODE_OPTIONS = [
  {
    label: "EmptyLatentImage",
    value: "EmptyLatentImage",
  },
  {
    label: "EmptySD3LatentImage",
    value: "EmptySD3LatentImage",
  },
] as const;

export type ComfyUiLatentImageNode = (typeof COMFYUI_LATENT_IMAGE_NODE_OPTIONS)[number]["value"];

export const DEFAULT_COMFYUI_LATENT_IMAGE_NODE: ComfyUiLatentImageNode = "EmptyLatentImage";

export function normalizeComfyUiLatentImageNode(value: unknown): ComfyUiLatentImageNode | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return COMFYUI_LATENT_IMAGE_NODE_OPTIONS.find((option) => option.value === trimmed)?.value;
}

export function getComfyUiLatentImageNodeTitle(node: ComfyUiLatentImageNode) {
  return node === "EmptySD3LatentImage" ? "Empty SD3 Latent Image" : "Empty Latent Image";
}
