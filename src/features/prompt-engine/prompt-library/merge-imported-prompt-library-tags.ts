import type { PromptTag } from "@/shared/types";

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
  const negative = tag.category === "negative" ? true : Boolean(tag.negative);
  const label = tag.label.trim() || tag.prompt.trim().slice(0, 48) || "未命名";
  const weight =
    tag.weight && typeof tag.weight.value === "number" && Number.isFinite(tag.weight.value)
      ? { enabled: Boolean(tag.weight.enabled), value: tag.weight.value }
      : { enabled: false, value: 1 };

  return {
    ...tag,
    label,
    prompt: tag.prompt.trim(),
    category: tag.category,
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
  const reference: PromptTag[] = [...builtIn, ...existingCustom];
  let next = [...existingCustom];
  let addedCount = 0;

  for (const raw of incoming) {
    const normalized = normalizeIncomingTag(raw);
    if (!normalized.prompt) {
      continue;
    }

    if (listHasSemanticTag(reference, normalized) || listHasSemanticTag(next, normalized)) {
      continue;
    }

    const created: PromptTag = { ...normalized, id: newId() };
    next = [...next, created];
    reference.push(created);
    addedCount += 1;
  }

  return { next, addedCount };
}
