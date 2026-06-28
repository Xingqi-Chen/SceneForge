function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPositiveInteger(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function extractCivitaiExampleImageDimensions(
  officialImagesJson: unknown,
  maxItems = 6,
) {
  if (!Array.isArray(officialImagesJson)) {
    return [];
  }

  const dimensions = new Map<string, { count: number; index: number }>();

  for (const image of officialImagesJson) {
    if (!isRecord(image)) {
      continue;
    }

    const width = readPositiveInteger(image.width);
    const height = readPositiveInteger(image.height);

    if (width === null || height === null) {
      continue;
    }

    const key = `${width}x${height}`;
    const existing = dimensions.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      dimensions.set(key, {
        count: 1,
        index: dimensions.size,
      });
    }
  }

  return Array.from(dimensions.entries())
    .sort(([, left], [, right]) => right.count - left.count || left.index - right.index)
    .slice(0, maxItems)
    .map(([dimension, summary]) =>
      summary.count > 1 ? `${dimension} (${summary.count} examples)` : dimension,
    );
}
