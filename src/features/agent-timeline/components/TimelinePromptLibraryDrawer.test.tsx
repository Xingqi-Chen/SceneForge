import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDefaultProject } from "@/features/editor/store/defaults";
import { useEditorStore } from "@/features/editor/store/editor-store";
import type { BodyPartId, PromptTag } from "@/shared/types";

const saveProjectMock = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock("@/features/persistence", () => ({
  saveProject: saveProjectMock,
}));

import { TimelinePromptLibraryDrawer } from "./TimelinePromptLibraryDrawer";

let container: HTMLDivElement;
let root: Root;

const libraryCharacterTag: PromptTag = {
  id: "library-courier",
  label: "Library courier",
  prompt: "solo courier protagonist",
  category: "character",
  subcategory: "character-subject",
  negative: false,
  weight: { enabled: true, value: 1.2 },
};

function getButtonByText(label: string) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.replace(/\s+/g, " ").trim() === label,
  );

  if (!button) {
    throw new Error(`Unable to find button "${label}".`);
  }

  return button as HTMLButtonElement;
}

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve();
  });
}

function seedSelectedCharacterWithLibraryTags(tags: PromptTag[]) {
  useEditorStore.getState().setProject(createDefaultProject());
  useEditorStore.getState().setSceneMode("3d");
  useEditorStore.getState().updateProjectSettings({ promptLibraryTags: tags });
  useEditorStore.getState().addCharacter();

  const character = useEditorStore.getState().project.scene.characters[0];
  useEditorStore.getState().updateCharacter(character.id, { name: "Courier" });

  return character.id;
}

function getBodyPartPromptTags(characterId: string, bodyPartId: BodyPartId) {
  return (
    useEditorStore
      .getState()
      .project.scene.characters.find((character) => character.id === characterId)
      ?.bodyParts.find((bodyPart) => bodyPart.id === bodyPartId)?.promptTags ?? []
  );
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  saveProjectMock.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
});

describe("TimelinePromptLibraryDrawer", () => {
  it("uses prompt-library tags with editor store add/remove and body-part target selection", async () => {
    const characterId = seedSelectedCharacterWithLibraryTags([libraryCharacterTag]);

    act(() => {
      root.render(<TimelinePromptLibraryDrawer />);
    });

    expect(container.querySelector('[data-testid="timeline-prompt-library-drawer"]')).not.toBeNull();
    expect(container.textContent).toContain("Character: Courier");

    act(() => {
      getButtonByText("Library courier").click();
    });
    await flushAsyncWork();

    expect(useEditorStore.getState().project.scene.characters[0].promptTags).toContainEqual(
      expect.objectContaining({
        label: "Library courier",
        prompt: "solo courier protagonist",
      }),
    );
    expect(saveProjectMock).toHaveBeenCalledTimes(1);

    act(() => {
      getButtonByText("Library courier").click();
    });
    await flushAsyncWork();

    expect(useEditorStore.getState().project.scene.characters[0].promptTags).toEqual([]);
    expect(saveProjectMock).toHaveBeenCalledTimes(2);

    const targetSelect = container.querySelector("select") as HTMLSelectElement | null;
    expect(targetSelect).not.toBeNull();

    act(() => {
      if (!targetSelect) {
        throw new Error("Expected body-part target select.");
      }

      targetSelect.value = "torso";
      targetSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(useEditorStore.getState().selection).toEqual({
      kind: "bodyPart",
      characterId,
      bodyPartId: "torso",
    });
    expect(container.textContent).toContain("Body part:");

    act(() => {
      getButtonByText("Library courier").click();
    });
    await flushAsyncWork();

    expect(getBodyPartPromptTags(characterId, "torso")).toContainEqual(
      expect.objectContaining({
        label: "Library courier",
        prompt: "solo courier protagonist",
      }),
    );
    expect(useEditorStore.getState().project.scene.characters[0].promptTags).toEqual([]);
    expect(saveProjectMock).toHaveBeenCalledTimes(3);
  });
});
