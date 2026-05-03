import type { PromptTag } from "@/shared/types";

import {
  migrateLegacyPromptTagCategorySubcategory,
  normalizePromptTagCategory,
  normalizePromptTagSubcategory,
} from "./prompt-tag-taxonomy";

function sameSemanticTag(
  left: Pick<PromptTag, "prompt" | "category" | "negative">,
  right: Pick<PromptTag, "prompt" | "category" | "negative">,
) {
  return (
    left.prompt === right.prompt &&
    left.category === right.category &&
    Boolean(left.negative) === Boolean(right.negative)
  );
}

function listHasSemanticTag(tags: PromptTag[], candidate: Pick<PromptTag, "prompt" | "category" | "negative">) {
  return tags.some((tag) => sameSemanticTag(tag, candidate));
}

function normalizeIncomingTag(tag: Omit<PromptTag, "id">): Omit<PromptTag, "id"> {
  const migrated = migrateLegacyPromptTagCategorySubcategory(tag.category, tag.subcategory);
  const category = normalizePromptTagCategory(migrated.category);
  const negative = category === "negative" ? true : Boolean(tag.negative);
  const label = tag.label.trim() || tag.prompt.trim().slice(0, 48) || "未命名";
  const weight =
    tag.weight && typeof tag.weight.value === "number" && Number.isFinite(tag.weight.value)
      ? { enabled: Boolean(tag.weight.enabled), value: tag.weight.value }
      : { enabled: false, value: 1 };

  return {
    ...tag,
    label,
    prompt: tag.prompt.trim(),
    category,
    subcategory: normalizePromptTagSubcategory(category, migrated.subcategory),
    negative,
    weight,
  };
}

export function mergeImportedPromptLibraryTags(
  builtIn: PromptTag[],
  existingCustom: PromptTag[],
  incoming: Array<Omit<PromptTag, "id">>,
  newId: () => string,
): { next: PromptTag[]; addedCount: number } {
  const newTags = collectNewImportedPromptLibraryTags(builtIn, existingCustom, incoming);
  const created = newTags.map((tag) => ({ ...tag, id: newId() }));

  return { next: [...existingCustom, ...created], addedCount: created.length };
}

function collectNewImportedPromptLibraryTags(
  builtIn: PromptTag[],
  existingCustom: PromptTag[],
  incoming: Array<Omit<PromptTag, "id">>,
) {
  const reference: PromptTag[] = [...builtIn, ...existingCustom];
  const newTags: Array<Omit<PromptTag, "id">> = [];

  for (const raw of incoming) {
    const normalized = normalizeIncomingTag(raw);
    if (!normalized.prompt) {
      continue;
    }

    if (listHasSemanticTag(reference, normalized)) {
      continue;
    }

    newTags.push(normalized);
    reference.push({ ...normalized, id: `__import-preview-${reference.length}__` });
  }

  return newTags;
}

/** 与 {@link mergeImportedPromptLibraryTags} 相同的去重规则，返回将新增的词条（不含 id），用于导入前预览。 */
export function computePromptLibraryImportPreview(
  builtIn: PromptTag[],
  existingCustom: PromptTag[],
  incoming: Array<Omit<PromptTag, "id">>,
): Array<Omit<PromptTag, "id">> {
  return collectNewImportedPromptLibraryTags(builtIn, existingCustom, incoming);
}
