import type {
  ArtistStringPromptFormat,
  NovelAiArtistStringAst,
  NovelAiArtistStringNode,
  StructuredArtistString,
} from "./types";
import type { ArtistStringPromptRenderMode } from "@/shared/types";

type ParseSequenceResult = {
  nodes: NovelAiArtistStringNode[];
  index: number;
  closed: boolean;
  warnings: string[];
};

export type NovelAiArtistReferenceSyntax = "artist-prefix" | "by-prefix" | "preserve";

export type NovelAiWeightedFormatterOptions = {
  artistReferenceSyntax?: NovelAiArtistReferenceSyntax;
  renderMode?: ArtistStringPromptRenderMode;
};

const GROUP_WEIGHT_STEP = 0.1;
const WEIGHTED_TOKEN_PATTERN = /^(.+):([+-]?(?:\d+\.?\d*|\.\d+))$/;

function isOpenGroup(value: string) {
  return value === "{" || value === "[";
}

function closeFor(open: string) {
  return open === "{" ? "}" : "]";
}

function emphasisFor(open: string): "increase" | "decrease" {
  return open === "{" ? "increase" : "decrease";
}

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function parseWeight(value: string): number | null {
  const weight = Number(value);
  return Number.isFinite(weight) ? weight : null;
}

function parseTag(text: string): NovelAiArtistStringNode | null {
  const normalized = normalizeText(text);
  if (!normalized) {
    return null;
  }

  const parenthesizedWeightMatch = /^\((.+)\)$/.exec(normalized);
  if (parenthesizedWeightMatch?.[1]) {
    const weighted = WEIGHTED_TOKEN_PATTERN.exec(parenthesizedWeightMatch[1].trim());
    const weight = weighted?.[2] ? parseWeight(weighted[2]) : null;
    if (weighted?.[1] && weight !== null) {
      const tag = parseTag(weighted[1]);
      return tag?.type === "tag" ? { ...tag, raw: normalized, weight } : null;
    }
  }

  const byWeightedMatch = /^by\s+(.+?)(?::([+-]?(?:\d+\.?\d*|\.\d+)))?$/i.exec(normalized);
  if (byWeightedMatch?.[1]?.trim()) {
    const weight = byWeightedMatch[2] ? parseWeight(byWeightedMatch[2]) : null;
    return {
      type: "tag",
      text: byWeightedMatch[1].trim(),
      artistPrefix: false,
      artistSyntax: "by-prefix",
      ...(weight !== null ? { weight } : {}),
      raw: normalized,
    };
  }

  const artistMatch = /^artist\s*:\s*(.+)$/i.exec(normalized);
  if (artistMatch?.[1]?.trim()) {
    const weighted = WEIGHTED_TOKEN_PATTERN.exec(artistMatch[1].trim());
    const weight = weighted?.[2] ? parseWeight(weighted[2]) : null;
    return {
      type: "tag",
      text: weighted?.[1] && weight !== null ? weighted[1].trim() : artistMatch[1].trim(),
      artistPrefix: true,
      artistSyntax: "artist-prefix",
      ...(weight !== null ? { weight } : {}),
      raw: normalized,
    };
  }

  const weightedTagMatch = WEIGHTED_TOKEN_PATTERN.exec(normalized);
  const tagWeight = weightedTagMatch?.[2] ? parseWeight(weightedTagMatch[2]) : null;

  return {
    type: "tag",
    text: weightedTagMatch?.[1] && tagWeight !== null ? weightedTagMatch[1].trim() : normalized,
    artistPrefix: false,
    ...(tagWeight !== null ? { weight: tagWeight } : {}),
    raw: normalized,
  };
}

function readPlainToken(source: string, start: number, closing: string | null) {
  let index = start;
  while (index < source.length) {
    const char = source[index];
    if (char === "," || isOpenGroup(char) || char === "}" || char === "]" || (closing !== null && char === closing)) {
      break;
    }
    index += 1;
  }

  return {
    text: source.slice(start, index),
    index,
  };
}

function parseSequence(source: string, start: number, closing: string | null): ParseSequenceResult {
  const nodes: NovelAiArtistStringNode[] = [];
  const warnings: string[] = [];
  let index = start;

  while (index < source.length) {
    const char = source[index]!;

    if (char === ",") {
      index += 1;
      continue;
    }

    if (closing !== null && char === closing) {
      return { nodes, index: index + 1, closed: true, warnings };
    }

    if (char === "}" || char === "]") {
      nodes.push({ type: "raw", text: char });
      warnings.push(`Unexpected closing token "${char}" at ${index}.`);
      index += 1;
      continue;
    }

    if (isOpenGroup(char)) {
      const expectedClose = closeFor(char);
      const nested = parseSequence(source, index + 1, expectedClose);
      nodes.push({
        type: "group",
        emphasis: emphasisFor(char),
        closed: nested.closed,
        nodes: nested.nodes,
      });
      warnings.push(...nested.warnings);
      if (!nested.closed) {
        warnings.push(`Missing closing token "${expectedClose}" for token at ${index}.`);
      }
      index = nested.index;
      continue;
    }

    const token = readPlainToken(source, index, closing);
    const tag = parseTag(token.text);
    if (tag) {
      nodes.push(tag);
    }
    index = token.index;
  }

  return {
    nodes,
    index,
    closed: closing === null,
    warnings,
  };
}

export function parseNovelAiArtistString(raw: string): NovelAiArtistStringAst {
  const source = raw.trim();
  const parsed = parseSequence(source, 0, null);
  const warnings = [...parsed.warnings];
  if (source && parsed.nodes.length === 0) {
    warnings.push("No parseable artist string tokens were found.");
  }

  return {
    type: "novelai",
    raw,
    nodes: parsed.nodes,
    warnings,
  };
}

function formatNovelAiNode(node: NovelAiArtistStringNode): string | null {
  if (node.type === "raw") {
    const text = normalizeText(node.text);
    return text || null;
  }

  if (node.type === "tag") {
    const text = normalizeText(node.text);
    if (!text) {
      return null;
    }
    const tagText = node.artistSyntax === "by-prefix" ? `by ${text}` : node.artistPrefix ? `artist:${text}` : text;
    if (typeof node.weight === "number" && Number.isFinite(node.weight)) {
      return node.artistSyntax === "by-prefix"
        ? `${tagText}:${formatWeight(node.weight)}`
        : `(${tagText}:${formatWeight(node.weight)})`;
    }
    return tagText;
  }

  const children = node.nodes
    .map((child) => formatNovelAiNode(child))
    .filter((child): child is string => Boolean(child));
  if (children.length === 0) {
    return null;
  }

  const open = node.emphasis === "increase" ? "{" : "[";
  const close = node.emphasis === "increase" ? "}" : "]";
  return `${open}${children.join(",")}${close}`;
}

export function formatNovelAiArtistString(ast: NovelAiArtistStringAst): string {
  return ast.nodes
    .map((node) => formatNovelAiNode(node))
    .filter((node): node is string => Boolean(node))
    .join(",");
}

function formatWeight(value: number): string {
  return Number(value.toFixed(3)).toString();
}

function isArtistReferenceTag(node: Extract<NovelAiArtistStringNode, { type: "tag" }>) {
  return node.artistPrefix || node.artistSyntax === "artist-prefix" || node.artistSyntax === "by-prefix";
}

function resolveArtistReferenceSyntax(
  node: Extract<NovelAiArtistStringNode, { type: "tag" }>,
  options: NovelAiWeightedFormatterOptions,
): "artist-prefix" | "by-prefix" | null {
  if (!isArtistReferenceTag(node)) {
    return null;
  }

  if (options.artistReferenceSyntax === "artist-prefix" || options.artistReferenceSyntax === "by-prefix") {
    return options.artistReferenceSyntax;
  }

  return node.artistSyntax === "by-prefix" ? "by-prefix" : "artist-prefix";
}

function formatWeightedTag(
  node: Extract<NovelAiArtistStringNode, { type: "tag" }>,
  weight: number | null,
  options: NovelAiWeightedFormatterOptions,
) {
  const text = normalizeText(node.text);
  if (!text) {
    return null;
  }

  const artistSyntax = resolveArtistReferenceSyntax(node, options);
  const tagText = artistSyntax === "by-prefix" ? `by ${text}` : artistSyntax === "artist-prefix" ? `artist:${text}` : text;
  if (weight === null || Math.abs(weight - 1) < 0.0001) {
    return tagText;
  }

  return artistSyntax === "by-prefix"
    ? `${tagText}:${formatWeight(weight)}`
    : `(${tagText}:${formatWeight(weight)})`;
}

function formatWeightedNovelAiNode(
  node: NovelAiArtistStringNode,
  options: NovelAiWeightedFormatterOptions,
  weightDelta = 0,
): string | null {
  if (node.type === "raw") {
    const text = normalizeText(node.text);
    return text || null;
  }

  if (node.type === "tag") {
    const explicitWeight = typeof node.weight === "number" && Number.isFinite(node.weight) ? node.weight : null;
    const finalWeight = explicitWeight !== null
      ? explicitWeight + weightDelta
      : weightDelta === 0
        ? null
        : 1 + weightDelta;
    return formatWeightedTag(node, finalWeight, options);
  }

  const nextWeightDelta = weightDelta + (node.emphasis === "increase" ? GROUP_WEIGHT_STEP : -GROUP_WEIGHT_STEP);
  const children = node.nodes
    .map((child) => formatWeightedNovelAiNode(child, options, nextWeightDelta))
    .filter((child): child is string => Boolean(child));

  return children.length > 0 ? children.join(",") : null;
}

export function formatWeightedNovelAiArtistString(
  ast: NovelAiArtistStringAst,
  options: NovelAiWeightedFormatterOptions = { artistReferenceSyntax: "artist-prefix" },
): string {
  const formatterOptions: NovelAiWeightedFormatterOptions = {
    artistReferenceSyntax: "artist-prefix",
    ...options,
  };

  return ast.nodes
    .map((node) => formatWeightedNovelAiNode(node, formatterOptions))
    .filter((node): node is string => Boolean(node))
    .join(",");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function coerceNovelAiNode(value: unknown): NovelAiArtistStringNode | null {
  if (!isRecord(value) || typeof value.type !== "string") {
    return null;
  }

  if (value.type === "raw") {
    return typeof value.text === "string" ? { type: "raw", text: value.text } : null;
  }

  if (value.type === "tag") {
    if (typeof value.text !== "string") {
      return null;
    }
    return {
      type: "tag",
      text: value.text,
      artistPrefix: Boolean(value.artistPrefix),
      artistSyntax:
        value.artistSyntax === "by-prefix" || value.artistSyntax === "artist-prefix"
          ? value.artistSyntax
          : Boolean(value.artistPrefix)
            ? "artist-prefix"
            : undefined,
      weight: typeof value.weight === "number" && Number.isFinite(value.weight) ? value.weight : undefined,
      raw: typeof value.raw === "string" ? value.raw : value.text,
    };
  }

  if (value.type === "group") {
    const emphasis = value.emphasis === "decrease" ? "decrease" : "increase";
    const rawNodes = Array.isArray(value.nodes) ? value.nodes : [];
    return {
      type: "group",
      emphasis,
      closed: value.closed !== false,
      nodes: rawNodes.map(coerceNovelAiNode).filter((node): node is NovelAiArtistStringNode => Boolean(node)),
    };
  }

  return null;
}

export function coerceStructuredArtistString(value: unknown): StructuredArtistString | null {
  if (!isRecord(value) || value.type !== "novelai") {
    return null;
  }

  const nodes = Array.isArray(value.nodes)
    ? value.nodes.map(coerceNovelAiNode).filter((node): node is NovelAiArtistStringNode => Boolean(node))
    : [];

  return {
    type: "novelai",
    raw: typeof value.raw === "string" ? value.raw : "",
    nodes,
    warnings: Array.isArray(value.warnings)
      ? value.warnings.filter((warning): warning is string => typeof warning === "string")
      : [],
  };
}

export function formatArtistStringForPlatform(
  structured: StructuredArtistString,
  promptFormat: ArtistStringPromptFormat,
  options?: NovelAiWeightedFormatterOptions,
): string {
  if (promptFormat === "novelai") {
    if (options?.renderMode === "novelai") {
      return formatNovelAiArtistString(structured);
    }

    if (options?.renderMode === "by-weight") {
      return formatWeightedNovelAiArtistString(structured, {
        ...options,
        artistReferenceSyntax: "by-prefix",
      });
    }

    return formatWeightedNovelAiArtistString(structured, {
      ...options,
      artistReferenceSyntax: options?.artistReferenceSyntax ?? "artist-prefix",
    });
  }

  return "";
}

export function normalizeFormattedArtistString(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}
