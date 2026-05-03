import { describe, expect, it } from "vitest";

import type { PromptTag } from "@/shared/types";

import { BUILT_IN_PROMPT_LIBRARY_TAGS } from "./built-in-prompt-tags";
import { mergeImportedPromptLibraryTags } from "./merge-imported-prompt-library-tags";

describe("mergeImportedPromptLibraryTags", () => {
  it("adds new tags with ids", () => {
    let n = 0;
    const { next, addedCount } = mergeImportedPromptLibraryTags(
      BUILT_IN_PROMPT_LIBRARY_TAGS,
      [],
      [
        {
          label: "测试",
          prompt: "unique token xyz",
          category: "scene",
          subcategory: "scene-environment",
          weight: { enabled: false, value: 1 },
        },
      ],
      () => `id-${++n}`,
    );

    expect(addedCount).toBe(1);
    expect(next).toHaveLength(1);
    expect(next[0]?.id).toBe("id-1");
    expect(next[0]?.prompt).toBe("unique token xyz");
    expect(next[0]?.subcategory).toBe("scene-environment");
  });

  it("skips duplicates against built-in", () => {
    const { next, addedCount } = mergeImportedPromptLibraryTags(
      BUILT_IN_PROMPT_LIBRARY_TAGS,
      [],
      [
        {
          label: "蓝眼",
          prompt: "blue eyes",
          category: "body-part",
          weight: { enabled: false, value: 1 },
        },
      ],
      () => "id-1",
    );

    expect(addedCount).toBe(0);
    expect(next).toHaveLength(0);
  });

  it("skips duplicates within existing custom", () => {
    const existing = [
      {
        id: "x",
        label: "已有",
        prompt: "rain",
        category: "scene" as const,
        weight: { enabled: false, value: 1 },
      },
    ];

    const { next, addedCount } = mergeImportedPromptLibraryTags(
      BUILT_IN_PROMPT_LIBRARY_TAGS,
      existing,
      [
        {
          label: "重复",
          prompt: "rain",
          category: "scene",
          weight: { enabled: false, value: 1 },
        },
      ],
      () => "id-new",
    );

    expect(addedCount).toBe(0);
    expect(next).toHaveLength(1);
  });

  it("migrates legacy character clothing tags into outfit tags", () => {
    const legacyTag = {
      label: "Legacy shirt",
      prompt: "white shirt",
      category: "character",
      subcategory: "character-clothing",
      weight: { enabled: false, value: 1 },
    } as unknown as Omit<PromptTag, "id">;

    const { next, addedCount } = mergeImportedPromptLibraryTags(
      BUILT_IN_PROMPT_LIBRARY_TAGS,
      [],
      [legacyTag],
      () => "id-outfit",
    );

    expect(addedCount).toBe(1);
    expect(next[0]).toMatchObject({
      id: "id-outfit",
      category: "outfit",
      subcategory: "outfit-full",
      prompt: "white shirt",
    });
  });

  it("dedupes legacy clothing imports against existing outfit tags", () => {
    const legacyTag = {
      label: "Legacy shirt",
      prompt: "white shirt",
      category: "character",
      subcategory: "character-clothing",
      weight: { enabled: false, value: 1 },
    } as unknown as Omit<PromptTag, "id">;
    const existing = [
      {
        id: "existing-outfit",
        label: "Existing shirt",
        prompt: "white shirt",
        category: "outfit" as const,
        subcategory: "outfit-full" as const,
        weight: { enabled: false, value: 1 },
      },
    ];

    const { next, addedCount } = mergeImportedPromptLibraryTags(
      BUILT_IN_PROMPT_LIBRARY_TAGS,
      existing,
      [legacyTag],
      () => "id-new",
    );

    expect(addedCount).toBe(0);
    expect(next).toEqual(existing);
  });
});
