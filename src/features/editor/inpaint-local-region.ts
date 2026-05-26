import type {
  ComfyUiInpaintLocalRegionConfig,
  ComfyUiInpaintLocalRegionSource,
  ComfyUiSam2Bbox,
} from "@/features/comfyui";

type ImageSize = {
  height: number;
  width: number;
};

type MaskAlphaData = {
  data: Uint8ClampedArray | number[];
  height: number;
  width: number;
};

export type InpaintLocalRegionRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ResolveInpaintLocalRegionInput = {
  alignment?: number;
  box?: ComfyUiSam2Bbox | null;
  feather: number;
  harmonizeAfter?: {
    denoise: number;
    enabled: boolean;
  };
  mask: MaskAlphaData;
  minSize?: number;
  padding: number;
  sourceSize: ImageSize;
};

export type ResolvedInpaintLocalRegion = ComfyUiInpaintLocalRegionConfig & {
  feather: number;
  height: number;
  padding: number;
  source: ComfyUiInpaintLocalRegionSource;
  width: number;
  x: number;
  y: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeRect(rect: InpaintLocalRegionRect, sourceSize: ImageSize) {
  const x = clamp(Math.round(rect.x), 0, sourceSize.width);
  const y = clamp(Math.round(rect.y), 0, sourceSize.height);
  const right = clamp(Math.round(rect.x + rect.width), 0, sourceSize.width);
  const bottom = clamp(Math.round(rect.y + rect.height), 0, sourceSize.height);

  if (right <= x || bottom <= y) {
    return null;
  }

  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
}

export function findMaskAlphaBounds(mask: MaskAlphaData, alphaThreshold = 0): InpaintLocalRegionRect | null {
  let minX = mask.width;
  let minY = mask.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      const alpha = mask.data[(y * mask.width + x) * 4 + 3] ?? 0;
      if (alpha <= alphaThreshold) {
        continue;
      }

      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) {
    return null;
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

export function padAndAlignLocalRegion(
  rect: InpaintLocalRegionRect,
  sourceSize: ImageSize,
  padding: number,
  alignment = 8,
  minSize = 8,
) {
  const padded = normalizeRect(
    {
      x: rect.x - padding,
      y: rect.y - padding,
      width: rect.width + padding * 2,
      height: rect.height + padding * 2,
    },
    sourceSize,
  );
  if (!padded) {
    return null;
  }

  let x = Math.floor(padded.x / alignment) * alignment;
  let y = Math.floor(padded.y / alignment) * alignment;
  let right = Math.ceil((padded.x + padded.width) / alignment) * alignment;
  let bottom = Math.ceil((padded.y + padded.height) / alignment) * alignment;

  right = clamp(right, 0, sourceSize.width);
  bottom = clamp(bottom, 0, sourceSize.height);
  x = clamp(x, 0, right);
  y = clamp(y, 0, bottom);

  if (right - x < minSize) {
    const deficit = minSize - (right - x);
    x = Math.max(0, x - Math.ceil(deficit / 2));
    right = Math.min(sourceSize.width, x + minSize);
  }

  if (bottom - y < minSize) {
    const deficit = minSize - (bottom - y);
    y = Math.max(0, y - Math.ceil(deficit / 2));
    bottom = Math.min(sourceSize.height, y + minSize);
  }

  if (right <= x || bottom <= y) {
    return null;
  }

  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
}

export function resolveInpaintLocalRegion({
  alignment = 8,
  box,
  feather,
  harmonizeAfter,
  mask,
  minSize = 8,
  padding,
  sourceSize,
}: ResolveInpaintLocalRegionInput): ResolvedInpaintLocalRegion | null {
  const source: ComfyUiInpaintLocalRegionSource = box ? "box" : "mask-bounds";
  const baseRegion = box ? normalizeRect(box, sourceSize) : findMaskAlphaBounds(mask);
  if (!baseRegion) {
    return null;
  }

  const region = padAndAlignLocalRegion(baseRegion, sourceSize, padding, alignment, minSize);
  if (!region) {
    return null;
  }

  return {
    ...region,
    source,
    padding,
    feather,
    ...(harmonizeAfter ? { harmonizeAfter } : {}),
  };
}
