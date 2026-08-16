export type TimelineDimensions = {
  height: number;
  width: number;
};

export const KREA2_FORMAL_DIMENSION_ALIGNMENT = 16;
export const KREA2_FORMAL_DIMENSION_MIN = 16;
export const KREA2_FORMAL_DIMENSION_MAX = 16_384;
export const KREA2_PREVIEW_LONGEST_EDGE = 768;

export function greatestCommonDivisor(left: number, right: number) {
  let first = left;
  let second = right;
  while (second !== 0) {
    const remainder = first % second;
    first = second;
    second = remainder;
  }
  return first;
}

export function leastCommonMultiple(left: number, right: number) {
  return (left / greatestCommonDivisor(left, right)) * right;
}

export function getExactAspectAlignedPreviewDimensions(
  width: number,
  height: number,
  longestEdge: number,
  alignment: number,
): TimelineDimensions | null {
  if (![width, height, longestEdge, alignment].every((value) => Number.isSafeInteger(value) && value > 0)) {
    return null;
  }
  if (Math.max(width, height) <= longestEdge) {
    return { width, height };
  }

  const ratioDivisor = greatestCommonDivisor(width, height);
  const ratioWidth = width / ratioDivisor;
  const ratioHeight = height / ratioDivisor;
  const widthAlignmentMultiplier = alignment / greatestCommonDivisor(ratioWidth, alignment);
  const heightAlignmentMultiplier = alignment / greatestCommonDivisor(ratioHeight, alignment);
  const alignmentMultiplier = leastCommonMultiple(widthAlignmentMultiplier, heightAlignmentMultiplier);
  const maximumMultiplier = Math.floor(longestEdge / Math.max(ratioWidth, ratioHeight));
  const multiplier = Math.floor(maximumMultiplier / alignmentMultiplier) * alignmentMultiplier;

  return multiplier < alignmentMultiplier
    ? null
    : { width: ratioWidth * multiplier, height: ratioHeight * multiplier };
}

export function getKrea2PreviewDimensions(width: number, height: number) {
  return getExactAspectAlignedPreviewDimensions(
    width,
    height,
    KREA2_PREVIEW_LONGEST_EDGE,
    KREA2_FORMAL_DIMENSION_ALIGNMENT,
  );
}

export function isValidKrea2FormalDimensions(width: number, height: number) {
  return [width, height].every((value) =>
    Number.isSafeInteger(value) &&
    value >= KREA2_FORMAL_DIMENSION_MIN &&
    value <= KREA2_FORMAL_DIMENSION_MAX &&
    value % KREA2_FORMAL_DIMENSION_ALIGNMENT === 0,
  );
}

type Krea2DimensionCandidate = TimelineDimensions & {
  aspectErrorDenominator: bigint;
  aspectErrorNumerator: bigint;
  areaError: bigint;
  dimensionError: bigint;
  enlargesArea: boolean;
  previewArea: number;
};

function compareBigInts(left: bigint, right: bigint) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareKrea2DimensionCandidates(left: Krea2DimensionCandidate, right: Krea2DimensionCandidate) {
  const dimensionComparison = compareBigInts(left.dimensionError, right.dimensionError);
  if (dimensionComparison !== 0) return dimensionComparison;

  const aspectComparison = compareBigInts(
    left.aspectErrorNumerator * right.aspectErrorDenominator,
    right.aspectErrorNumerator * left.aspectErrorDenominator,
  );
  if (aspectComparison !== 0) return aspectComparison;

  const areaComparison = compareBigInts(left.areaError, right.areaError);
  if (areaComparison !== 0) return areaComparison;
  if (left.enlargesArea !== right.enlargesArea) return left.enlargesArea ? 1 : -1;
  if (left.previewArea !== right.previewArea) return right.previewArea - left.previewArea;
  if (left.width !== right.width) return left.width - right.width;
  return left.height - right.height;
}

export function normalizeKrea2AiDimensions(advisedWidth: number, advisedHeight: number): TimelineDimensions | null {
  if (![advisedWidth, advisedHeight].every((value) => Number.isSafeInteger(value) && value > 0)) {
    return null;
  }

  if (isValidKrea2FormalDimensions(advisedWidth, advisedHeight) &&
      getKrea2PreviewDimensions(advisedWidth, advisedHeight)) {
    return { width: advisedWidth, height: advisedHeight };
  }

  const advisedWidthBigInt = BigInt(advisedWidth);
  const advisedHeightBigInt = BigInt(advisedHeight);
  const advisedArea = advisedWidthBigInt * advisedHeightBigInt;
  let best: Krea2DimensionCandidate | null = null;
  const maximumReducedAxis = KREA2_PREVIEW_LONGEST_EDGE / KREA2_FORMAL_DIMENSION_ALIGNMENT;
  const maximumFormalScale = KREA2_FORMAL_DIMENSION_MAX / KREA2_FORMAL_DIMENSION_ALIGNMENT;

  for (let ratioWidth = 1; ratioWidth <= maximumReducedAxis; ratioWidth += 1) {
    for (let ratioHeight = 1; ratioHeight <= maximumReducedAxis; ratioHeight += 1) {
      if (greatestCommonDivisor(ratioWidth, ratioHeight) !== 1) {
        continue;
      }

      const maximumScale = Math.floor(maximumFormalScale / Math.max(ratioWidth, ratioHeight));
      for (let scale = 1; scale <= maximumScale; scale += 1) {
        const width = KREA2_FORMAL_DIMENSION_ALIGNMENT * ratioWidth * scale;
        const height = KREA2_FORMAL_DIMENSION_ALIGNMENT * ratioHeight * scale;
        const preview = getKrea2PreviewDimensions(width, height);
        if (!preview) {
          continue;
        }

        const widthBigInt = BigInt(width);
        const heightBigInt = BigInt(height);
        const widthDelta = widthBigInt - advisedWidthBigInt;
        const heightDelta = heightBigInt - advisedHeightBigInt;
        const area = widthBigInt * heightBigInt;
        const aspectDifference = widthBigInt * advisedHeightBigInt - heightBigInt * advisedWidthBigInt;
        const candidate: Krea2DimensionCandidate = {
          width,
          height,
          dimensionError:
            widthDelta * widthDelta * advisedHeightBigInt * advisedHeightBigInt +
            heightDelta * heightDelta * advisedWidthBigInt * advisedWidthBigInt,
          aspectErrorNumerator: aspectDifference < BigInt(0) ? -aspectDifference : aspectDifference,
          aspectErrorDenominator:
            widthBigInt * advisedHeightBigInt + heightBigInt * advisedWidthBigInt,
          areaError: area > advisedArea ? area - advisedArea : advisedArea - area,
          enlargesArea: area > advisedArea,
          previewArea: preview.width * preview.height,
        };
        if (!best || compareKrea2DimensionCandidates(candidate, best) < 0) {
          best = candidate;
        }
      }
    }
  }

  return best ? { width: best.width, height: best.height } : null;
}
