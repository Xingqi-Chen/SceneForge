"use client";

import { create } from "zustand";

import type {
  BodyPartId,
  CharacterSkeleton,
  JointId,
  LineEndpoints,
  PromptBindingState,
  PromptBindingTargetKind,
  ProjectSettings,
  PromptTag,
  PromptTagCategory,
  PromptTagSubcategory,
  Scene,
  SceneForgeProject,
  SceneObject,
  SceneObjectKind,
  Vector2,
} from "@/shared/types";

import { BUILT_IN_PROMPT_LIBRARY_TAGS } from "@/features/prompt-engine/prompt-library/built-in-prompt-tags";
import { mergeImportedPromptLibraryTags } from "@/features/prompt-engine/prompt-library/merge-imported-prompt-library-tags";
import {
  PROMPT_TAG_CATEGORY_ORDER,
  PROMPT_TAG_SUBCATEGORY_OPTIONS,
  normalizePromptTagSubcategory,
} from "@/features/prompt-engine/prompt-library/prompt-tag-taxonomy";

import {
  PRESET_SCENE_OBJECTS,
  defaultLineEndpoints,
  defaultPolygonPoints,
} from "@/features/editor/preset-scene-objects";

import {
  DEFAULT_PROMPT_CATEGORY_BINDINGS,
  DEFAULT_PROMPT_SUBCATEGORY_BINDINGS,
  createDefaultPromptBindingState,
  createDefaultProject,
  defaultCharacter,
} from "./defaults";
import {
  applyPromptBindingsToProject,
  extractPromptBindingsFromProject,
} from "@/features/persistence/project-serialization";

export type EditorSelection =
  | { kind: "scene" }
  | { kind: "object"; id: string }
  | { kind: "character"; id: string }
  | { kind: "bodyPart"; characterId: string; bodyPartId: BodyPartId }
  | { kind: "multiple"; objectIds: string[]; characterIds: string[] };

export type AddSceneObjectInput = {
  kind: SceneObjectKind;
  name: string;
  description?: string;
  fill?: string;
  presetKey?: string;
  lineEndpoints?: LineEndpoints;
  polygonPoints?: Vector2[];
  imageLabel?: string;
};

export type PromptTagTarget =
  | { kind: "scene" }
  | { kind: "object"; id: string }
  | { kind: "character"; id: string }
  | { kind: "bodyPart"; characterId: string; bodyPartId: BodyPartId };

type PromptTagPatch = Partial<Omit<PromptTag, "id" | "weight">> & {
  weight?: Partial<PromptTag["weight"]>;
};

type EditorState = {
  project: SceneForgeProject;
  promptBindings: PromptBindingState;
  selection: EditorSelection;
  /** Last successful AI Prompt preview text; cleared when loading another project. */
  aiGeneratedPrompt: string;
  setAiGeneratedPrompt: (prompt: string) => void;
  setProject: (project: SceneForgeProject) => void;
  resetProject: () => void;
  selectScene: () => void;
  selectObject: (id: string) => void;
  selectCharacter: (id: string) => void;
  selectBodyPart: (characterId: string, bodyPartId: BodyPartId) => void;
  /** Box selection: pass scene-space hit ids; empty lists clear to scene selection. */
  selectMultiple: (objectIds: string[], characterIds: string[]) => void;
  /** Ctrl/Cmd+click: add/remove a scene object from the current selection. */
  toggleObjectInSelection: (objectId: string) => void;
  /** Ctrl/Cmd+click: add/remove a character from the current selection. */
  toggleCharacterInSelection: (characterId: string) => void;
  updateScene: (patch: Partial<Scene>) => void;
  updateProjectDocument: (patch: Partial<Pick<SceneForgeProject, "name">>) => void;
  updateProjectSettings: (patch: Partial<ProjectSettings>) => void;
  addObject: (input: AddSceneObjectInput) => void;
  updateObject: (id: string, patch: Partial<SceneObject>) => void;
  deleteSelection: () => void;
  duplicateSelection: () => void;
  bringSelectionForward: () => void;
  sendSelectionBackward: () => void;
  moveSelectionBy: (delta: Vector2) => void;
  /** Batch positions during multi-select drag (must match current `multiple` selection ids). */
  setMultiSelectionPositions: (payload: {
    objects: Record<string, Vector2>;
    characters: Record<string, Vector2>;
  }) => void;
  addCharacter: () => void;
  updateCharacter: (id: string, patch: Partial<CharacterSkeleton>) => void;
  updateCharacterJoint: (id: string, jointId: JointId, position: Vector2) => void;
  addPromptTag: (target: PromptTagTarget, tag: PromptTag) => void;
  updatePromptTag: (target: PromptTagTarget, tagId: string, patch: PromptTagPatch) => void;
  removePromptTag: (target: PromptTagTarget, tagId: string) => void;
  updatePromptCategoryBindings: (
    target: PromptTagTarget,
    categories: PromptTagCategory[],
  ) => void;
  updatePromptSubcategoryBindings: (
    target: PromptTagTarget,
    subcategories: PromptTagSubcategory[],
  ) => void;
  /** Merges parsed tags into `settings.promptLibraryTags`, skipping duplicates vs built-in and existing custom entries. Returns count added. */
  importPromptLibraryTags: (incoming: Array<Omit<PromptTag, "id">>) => number;
  updatePromptLibraryTag: (tag: PromptTag) => boolean;
  deletePromptLibraryTag: (tagId: string) => boolean;
};

function createId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function touchProject(project: SceneForgeProject): SceneForgeProject {
  return {
    ...project,
    updatedAt: new Date().toISOString(),
  };
}

function clonePromptTag(tag: PromptTag): PromptTag {
  return {
    ...tag,
    id: createId("tag"),
    weight: { ...tag.weight },
  };
}

function normalizePromptCategoryBindings(categories: PromptTagCategory[]) {
  const validCategories = new Set<PromptTagCategory>(PROMPT_TAG_CATEGORY_ORDER);
  const seen = new Set<PromptTagCategory>();

  return categories.filter((category) => {
    if (!validCategories.has(category) || seen.has(category)) {
      return false;
    }

    seen.add(category);
    return true;
  });
}

function getPromptSubcategoryCategory(subcategory: PromptTagSubcategory) {
  return PROMPT_TAG_CATEGORY_ORDER.find((category) =>
    PROMPT_TAG_SUBCATEGORY_OPTIONS[category].includes(subcategory),
  );
}

function normalizePromptSubcategoryBindings(
  subcategories: PromptTagSubcategory[],
  categories: PromptTagCategory[],
) {
  const categorySet = new Set(categories);
  const seen = new Set<PromptTagSubcategory>();

  return subcategories.filter((subcategory) => {
    const category = getPromptSubcategoryCategory(subcategory);
    if (!category || !categorySet.has(category) || seen.has(subcategory)) {
      return false;
    }

    seen.add(subcategory);
    return true;
  });
}

function getPromptBindingTargetKind(target: PromptTagTarget): PromptBindingTargetKind {
  return target.kind === "bodyPart" ? "bodyPart" : target.kind;
}

function hasPromptTag(tags: PromptTag[], tag: PromptTag) {
  return tags.some(
    (existingTag) =>
      existingTag.prompt === tag.prompt &&
      existingTag.category === tag.category &&
      Boolean(existingTag.negative) === Boolean(tag.negative),
  );
}

function isSameSemanticPromptTag(left: PromptTag, right: PromptTag) {
  return (
    left.prompt === right.prompt &&
    left.category === right.category &&
    Boolean(left.negative) === Boolean(right.negative)
  );
}

function addTagToList(tags: PromptTag[], tag: PromptTag) {
  if (hasPromptTag(tags, tag)) {
    return tags;
  }

  return [...tags, clonePromptTag(tag)];
}

function removeSemanticTagFromList(tags: PromptTag[], tagToRemove: PromptTag) {
  return tags.filter((tag) => !isSameSemanticPromptTag(tag, tagToRemove));
}

function removeSemanticTagFromScene(scene: Scene, tagToRemove: PromptTag): Scene {
  return {
    ...scene,
    promptTags: removeSemanticTagFromList(scene.promptTags, tagToRemove),
    objects: scene.objects.map((object) => ({
      ...object,
      promptTags: removeSemanticTagFromList(object.promptTags, tagToRemove),
    })),
    characters: scene.characters.map((character) => ({
      ...character,
      promptTags: removeSemanticTagFromList(character.promptTags, tagToRemove),
      bodyParts: character.bodyParts.map((bodyPart) => ({
        ...bodyPart,
        promptTags: removeSemanticTagFromList(bodyPart.promptTags, tagToRemove),
      })),
    })),
  };
}

function updateTagInList(tags: PromptTag[], tagId: string, patch: PromptTagPatch) {
  return tags.map((tag) =>
    tag.id === tagId
      ? {
          ...tag,
          ...patch,
          weight: patch.weight ? { ...tag.weight, ...patch.weight } : tag.weight,
        }
      : tag,
  );
}

function createCharacter(layerOffset: number, bindings: PromptBindingState): CharacterSkeleton {
  return {
    ...defaultCharacter,
    id: createId("character"),
    name: `人物 ${layerOffset + 1}`,
    position: {
      x: defaultCharacter.position.x + layerOffset * 48,
      y: defaultCharacter.position.y,
    },
    joints: Object.fromEntries(
      Object.entries(defaultCharacter.joints).map(([jointId, position]) => [
        jointId,
        { ...position },
      ]),
    ) as CharacterSkeleton["joints"],
    bodyParts: defaultCharacter.bodyParts.map((bodyPart) => ({
      ...bodyPart,
      promptTags: bodyPart.promptTags.map(clonePromptTag),
      promptCategoryBindings: [...bindings.bodyPart.promptCategoryBindings],
      promptSubcategoryBindings: [...bindings.bodyPart.promptSubcategoryBindings],
    })),
    promptTags: defaultCharacter.promptTags.map(clonePromptTag),
    promptCategoryBindings: [...bindings.character.promptCategoryBindings],
    promptSubcategoryBindings: [...bindings.character.promptSubcategoryBindings],
  };
}

function getNextLayer(objects: SceneObject[]) {
  return Math.max(0, ...objects.map((object) => object.layer)) + 1;
}

function cloneSceneObject(object: SceneObject): SceneObject {
  return {
    ...object,
    id: createId("object"),
    name: `${object.name} 副本`,
    position: {
      x: object.position.x + 32,
      y: object.position.y + 32,
    },
    size: { ...object.size },
    weight: { ...object.weight },
    lineEndpoints: object.lineEndpoints ? { ...object.lineEndpoints } : undefined,
    polygonPoints: object.polygonPoints?.map((point) => ({ ...point })),
    promptTags: object.promptTags.map(clonePromptTag),
    promptCategoryBindings: object.promptCategoryBindings
      ? [...object.promptCategoryBindings]
      : [...DEFAULT_PROMPT_CATEGORY_BINDINGS.object],
    promptSubcategoryBindings: object.promptSubcategoryBindings
      ? [...object.promptSubcategoryBindings]
      : [...DEFAULT_PROMPT_SUBCATEGORY_BINDINGS.object],
  };
}

function selectionFromIds(objectIds: string[], characterIds: string[]): EditorSelection {
  const objectIdList = [...new Set(objectIds)];
  const characterIdList = [...new Set(characterIds)];

  if (objectIdList.length === 0 && characterIdList.length === 0) {
    return { kind: "scene" };
  }

  if (objectIdList.length === 1 && characterIdList.length === 0) {
    return { kind: "object", id: objectIdList[0] };
  }

  if (objectIdList.length === 0 && characterIdList.length === 1) {
    return { kind: "character", id: characterIdList[0] };
  }

  return {
    kind: "multiple",
    objectIds: objectIdList,
    characterIds: characterIdList,
  };
}

function cloneCharacterSkeleton(character: CharacterSkeleton): CharacterSkeleton {
  return {
    ...character,
    id: createId("character"),
    name: `${character.name} 副本`,
    position: {
      x: character.position.x + 48,
      y: character.position.y + 24,
    },
    joints: Object.fromEntries(
      Object.entries(character.joints).map(([jointId, position]) => [
        jointId,
        { ...position },
      ]),
    ) as CharacterSkeleton["joints"],
    bodyParts: character.bodyParts.map((bodyPart) => ({
      ...bodyPart,
      promptTags: bodyPart.promptTags.map(clonePromptTag),
      promptCategoryBindings: bodyPart.promptCategoryBindings
        ? [...bodyPart.promptCategoryBindings]
        : [...DEFAULT_PROMPT_CATEGORY_BINDINGS.bodyPart],
      promptSubcategoryBindings: bodyPart.promptSubcategoryBindings
        ? [...bodyPart.promptSubcategoryBindings]
        : [...DEFAULT_PROMPT_SUBCATEGORY_BINDINGS.bodyPart],
    })),
    promptTags: character.promptTags.map(clonePromptTag),
    promptCategoryBindings: character.promptCategoryBindings
      ? [...character.promptCategoryBindings]
      : [...DEFAULT_PROMPT_CATEGORY_BINDINGS.character],
    promptSubcategoryBindings: character.promptSubcategoryBindings
      ? [...character.promptSubcategoryBindings]
      : [...DEFAULT_PROMPT_SUBCATEGORY_BINDINGS.character],
  };
}

export const useEditorStore = create<EditorState>((set) => ({
  project: applyPromptBindingsToProject(createDefaultProject(), createDefaultPromptBindingState()),
  promptBindings: createDefaultPromptBindingState(),
  selection: { kind: "scene" },
  aiGeneratedPrompt: "",
  setAiGeneratedPrompt: (prompt) => set({ aiGeneratedPrompt: prompt }),
  setProject: (project) => {
    const promptBindings = extractPromptBindingsFromProject(project);

    return set({
      project: applyPromptBindingsToProject(
        {
          ...project,
          settings: {
            ...project.settings,
            promptLibraryTags: project.settings.promptLibraryTags ?? [],
            deletedBuiltInPromptLibraryTagIds:
              project.settings.deletedBuiltInPromptLibraryTagIds ?? [],
          },
        },
        promptBindings,
      ),
      promptBindings,
      selection: { kind: "scene" },
      aiGeneratedPrompt: "",
    });
  },
  resetProject: () =>
    set((state) => {
      const nextProject = createDefaultProject();
      const freshId = createId("project");
      const stamp = new Date().toISOString();

      return {
        project: applyPromptBindingsToProject(
          {
            ...nextProject,
            id: freshId,
            createdAt: stamp,
            updatedAt: stamp,
            settings: {
              ...nextProject.settings,
              ...state.project.settings,
              promptLibraryTags: state.project.settings.promptLibraryTags ?? [],
              deletedBuiltInPromptLibraryTagIds:
                state.project.settings.deletedBuiltInPromptLibraryTagIds ?? [],
            },
          },
          state.promptBindings,
        ),
        selection: { kind: "scene" },
        aiGeneratedPrompt: "",
      };
    }),
  selectScene: () => set({ selection: { kind: "scene" } }),
  selectObject: (id) => set({ selection: { kind: "object", id } }),
  selectCharacter: (id) => set({ selection: { kind: "character", id } }),
  selectBodyPart: (characterId, bodyPartId) =>
    set({ selection: { kind: "bodyPart", characterId, bodyPartId } }),
  selectMultiple: (objectIds, characterIds) =>
    set(() => ({
      selection: selectionFromIds(objectIds, characterIds),
    })),
  toggleObjectInSelection: (id: string) =>
    set((state) => {
      const sel = state.selection;
      if (sel.kind === "object") {
        if (sel.id === id) {
          return { selection: { kind: "scene" } };
        }

        return { selection: selectionFromIds([sel.id, id], []) };
      }

      if (sel.kind === "multiple") {
        const next = new Set(sel.objectIds);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }

        return { selection: selectionFromIds([...next], sel.characterIds) };
      }

      if (sel.kind === "character") {
        return { selection: selectionFromIds([id], [sel.id]) };
      }

      if (sel.kind === "bodyPart") {
        return { selection: selectionFromIds([id], [sel.characterId]) };
      }

      return { selection: selectionFromIds([id], []) };
    }),
  toggleCharacterInSelection: (characterId: string) =>
    set((state) => {
      const sel = state.selection;
      if (sel.kind === "character") {
        if (sel.id === characterId) {
          return { selection: { kind: "scene" } };
        }

        return { selection: selectionFromIds([], [sel.id, characterId]) };
      }

      if (sel.kind === "bodyPart") {
        if (sel.characterId === characterId) {
          return { selection: { kind: "scene" } };
        }

        return { selection: selectionFromIds([], [sel.characterId, characterId]) };
      }

      if (sel.kind === "object") {
        return { selection: selectionFromIds([sel.id], [characterId]) };
      }

      if (sel.kind === "multiple") {
        const next = new Set(sel.characterIds);
        if (next.has(characterId)) {
          next.delete(characterId);
        } else {
          next.add(characterId);
        }

        return { selection: selectionFromIds(sel.objectIds, [...next]) };
      }

      return { selection: selectionFromIds([], [characterId]) };
    }),
  updateScene: (patch) =>
    set((state) => ({
      project: touchProject({
        ...state.project,
        scene: {
          ...state.project.scene,
          ...patch,
        },
      }),
    })),
  updateProjectDocument: (patch) =>
    set((state) => ({
      project: touchProject({
        ...state.project,
        ...patch,
      }),
    })),
  updateProjectSettings: (patch) =>
    set((state) => ({
      project: touchProject({
        ...state.project,
        settings: {
          ...state.project.settings,
          ...patch,
        },
      }),
    })),
  addObject: (input) =>
    set((state) => {
      const nextLayer = getNextLayer(state.project.scene.objects);
      const description = input.description ?? "";
      const fill = input.fill ?? "#e2e8f0";

      let size: SceneObject["size"];
      let lineEndpoints: LineEndpoints | undefined;
      let polygonPoints: Vector2[] | undefined;
      let presetKey: string | undefined;
      let imageLabel: string | undefined;

      if (input.kind === "circle") {
        size = { width: 120, height: 120 };
      } else if (input.kind === "ellipse") {
        size = { width: 160, height: 100 };
      } else if (input.kind === "line") {
        size = { width: 200, height: 48 };
        lineEndpoints = input.lineEndpoints ?? defaultLineEndpoints(size.width, size.height);
      } else if (input.kind === "polygon") {
        size = { width: 160, height: 140 };
        polygonPoints = input.polygonPoints ?? defaultPolygonPoints(size.width, size.height);
      } else if (input.kind === "image-placeholder") {
        size = { width: 180, height: 140 };
        imageLabel = input.imageLabel?.trim() || "Image";
      } else if (input.kind === "preset") {
        const def = PRESET_SCENE_OBJECTS.find((entry) => entry.key === input.presetKey);
        size = def ? { ...def.size } : { width: 180, height: 120 };
        presetKey = input.presetKey;
      } else {
        size = { width: 180, height: 120 };
      }

      const object: SceneObject = {
        id: createId("object"),
        kind: input.kind,
        name: input.name,
        description,
        position: { x: 160 + nextLayer * 24, y: 120 + nextLayer * 20 },
        size,
        rotation: 0,
        layer: nextLayer,
        fill,
        includeInPrompt: true,
        weight: { enabled: false, value: 1 },
        promptTags: [],
        promptCategoryBindings: [...state.promptBindings.object.promptCategoryBindings],
        promptSubcategoryBindings: [...state.promptBindings.object.promptSubcategoryBindings],
        ...(lineEndpoints ? { lineEndpoints } : {}),
        ...(polygonPoints ? { polygonPoints: polygonPoints.map((point) => ({ ...point })) } : {}),
        ...(presetKey ? { presetKey } : {}),
        ...(imageLabel ? { imageLabel } : {}),
      };

      return {
        project: touchProject({
          ...state.project,
          scene: {
            ...state.project.scene,
            objects: [...state.project.scene.objects, object],
          },
        }),
        selection: { kind: "object", id: object.id },
      };
    }),
  updateObject: (id, patch) =>
    set((state) => ({
      project: touchProject({
        ...state.project,
        scene: {
          ...state.project.scene,
          objects: state.project.scene.objects.map((object) =>
            object.id === id ? { ...object, ...patch } : object,
          ),
        },
      }),
    })),
  deleteSelection: () =>
    set((state) => {
      if (state.selection.kind === "object") {
        const selectionId = state.selection.id;
        const objects = state.project.scene.objects.filter(
          (object) => object.id !== selectionId,
        );

        if (objects.length === state.project.scene.objects.length) {
          return state;
        }

        return {
          project: touchProject({
            ...state.project,
            scene: {
              ...state.project.scene,
              objects,
            },
          }),
          selection: { kind: "scene" },
        };
      }

      if (state.selection.kind === "character") {
        const selectionId = state.selection.id;
        const characters = state.project.scene.characters.filter(
          (character) => character.id !== selectionId,
        );

        if (characters.length === state.project.scene.characters.length) {
          return state;
        }

        return {
          project: touchProject({
            ...state.project,
            scene: {
              ...state.project.scene,
              characters,
            },
          }),
          selection: { kind: "scene" },
        };
      }

      if (state.selection.kind === "multiple") {
        const idObject = new Set(state.selection.objectIds);
        const idCharacter = new Set(state.selection.characterIds);
        const objects = state.project.scene.objects.filter((object) => !idObject.has(object.id));
        const characters = state.project.scene.characters.filter(
          (character) => !idCharacter.has(character.id),
        );

        if (
          objects.length === state.project.scene.objects.length &&
          characters.length === state.project.scene.characters.length
        ) {
          return state;
        }

        return {
          project: touchProject({
            ...state.project,
            scene: {
              ...state.project.scene,
              objects,
              characters,
            },
          }),
          selection: { kind: "scene" },
        };
      }

      return state;
    }),
  duplicateSelection: () =>
    set((state) => {
      if (state.selection.kind === "object") {
        const selectionId = state.selection.id;
        const selectedObject = state.project.scene.objects.find(
          (object) => object.id === selectionId,
        );

        if (!selectedObject) {
          return state;
        }

        const object = {
          ...cloneSceneObject(selectedObject),
          layer: getNextLayer(state.project.scene.objects),
        };

        return {
          project: touchProject({
            ...state.project,
            scene: {
              ...state.project.scene,
              objects: [...state.project.scene.objects, object],
            },
          }),
          selection: { kind: "object", id: object.id },
        };
      }

      if (state.selection.kind === "character") {
        const selectionId = state.selection.id;
        const selectedCharacter = state.project.scene.characters.find(
          (character) => character.id === selectionId,
        );

        if (!selectedCharacter) {
          return state;
        }

        const character = cloneCharacterSkeleton(selectedCharacter);

        return {
          project: touchProject({
            ...state.project,
            scene: {
              ...state.project.scene,
              characters: [...state.project.scene.characters, character],
            },
          }),
          selection: { kind: "character", id: character.id },
        };
      }

      if (state.selection.kind === "multiple") {
        let objects = [...state.project.scene.objects];
        let characters = [...state.project.scene.characters];
        const newObjectIds: string[] = [];
        const newCharacterIds: string[] = [];

        for (const id of state.selection.objectIds) {
          const selectedObject = objects.find((object) => object.id === id);
          if (!selectedObject) {
            continue;
          }

          const object = {
            ...cloneSceneObject(selectedObject),
            layer: getNextLayer(objects),
          };
          objects = [...objects, object];
          newObjectIds.push(object.id);
        }

        for (const id of state.selection.characterIds) {
          const selectedCharacter = characters.find((character) => character.id === id);
          if (!selectedCharacter) {
            continue;
          }

          const character = cloneCharacterSkeleton(selectedCharacter);
          characters = [...characters, character];
          newCharacterIds.push(character.id);
        }

        if (newObjectIds.length === 0 && newCharacterIds.length === 0) {
          return state;
        }

        return {
          project: touchProject({
            ...state.project,
            scene: {
              ...state.project.scene,
              objects,
              characters,
            },
          }),
          selection: {
            kind: "multiple",
            objectIds: newObjectIds,
            characterIds: newCharacterIds,
          },
        };
      }

      return state;
    }),
  bringSelectionForward: () =>
    set((state) => {
      if (state.selection.kind !== "object") {
        return state;
      }

      const selectionId = state.selection.id;
      const selectedObject = state.project.scene.objects.find(
        (object) => object.id === selectionId,
      );

      if (!selectedObject) {
        return state;
      }

      const nextObject = state.project.scene.objects
        .filter((object) => object.layer > selectedObject.layer)
        .sort((left, right) => left.layer - right.layer)[0];

      if (!nextObject) {
        return state;
      }

      return {
        project: touchProject({
          ...state.project,
          scene: {
            ...state.project.scene,
            objects: state.project.scene.objects.map((object) => {
              if (object.id === selectedObject.id) {
                return { ...object, layer: nextObject.layer };
              }

              if (object.id === nextObject.id) {
                return { ...object, layer: selectedObject.layer };
              }

              return object;
            }),
          },
        }),
      };
    }),
  sendSelectionBackward: () =>
    set((state) => {
      if (state.selection.kind !== "object") {
        return state;
      }

      const selectionId = state.selection.id;
      const selectedObject = state.project.scene.objects.find(
        (object) => object.id === selectionId,
      );

      if (!selectedObject) {
        return state;
      }

      const previousObject = state.project.scene.objects
        .filter((object) => object.layer < selectedObject.layer)
        .sort((left, right) => right.layer - left.layer)[0];

      if (!previousObject) {
        return state;
      }

      return {
        project: touchProject({
          ...state.project,
          scene: {
            ...state.project.scene,
            objects: state.project.scene.objects.map((object) => {
              if (object.id === selectedObject.id) {
                return { ...object, layer: previousObject.layer };
              }

              if (object.id === previousObject.id) {
                return { ...object, layer: selectedObject.layer };
              }

              return object;
            }),
          },
        }),
      };
    }),
  moveSelectionBy: (delta) =>
    set((state) => {
      if (state.selection.kind === "object") {
        const selectionId = state.selection.id;
        let moved = false;
        const objects = state.project.scene.objects.map((object) => {
          if (object.id !== selectionId) {
            return object;
          }

          moved = true;

          return {
            ...object,
            position: {
              x: object.position.x + delta.x,
              y: object.position.y + delta.y,
            },
          };
        });

        if (!moved) {
          return state;
        }

        return {
          project: touchProject({
            ...state.project,
            scene: {
              ...state.project.scene,
              objects,
            },
          }),
        };
      }

      if (state.selection.kind === "character") {
        const selectionId = state.selection.id;
        let moved = false;
        const characters = state.project.scene.characters.map((character) => {
          if (character.id !== selectionId) {
            return character;
          }

          moved = true;

          return {
            ...character,
            position: {
              x: character.position.x + delta.x,
              y: character.position.y + delta.y,
            },
          };
        });

        if (!moved) {
          return state;
        }

        return {
          project: touchProject({
            ...state.project,
            scene: {
              ...state.project.scene,
              characters,
            },
          }),
        };
      }

      if (state.selection.kind === "multiple") {
        const idObject = new Set(state.selection.objectIds);
        const idCharacter = new Set(state.selection.characterIds);
        let moved = false;

        const objects = state.project.scene.objects.map((object) => {
          if (!idObject.has(object.id)) {
            return object;
          }

          moved = true;

          return {
            ...object,
            position: {
              x: object.position.x + delta.x,
              y: object.position.y + delta.y,
            },
          };
        });

        const characters = state.project.scene.characters.map((character) => {
          if (!idCharacter.has(character.id)) {
            return character;
          }

          moved = true;

          return {
            ...character,
            position: {
              x: character.position.x + delta.x,
              y: character.position.y + delta.y,
            },
          };
        });

        if (!moved) {
          return state;
        }

        return {
          project: touchProject({
            ...state.project,
            scene: {
              ...state.project.scene,
              objects,
              characters,
            },
          }),
        };
      }

      return state;
    }),
  setMultiSelectionPositions: (payload) =>
    set((state) => {
      if (state.selection.kind !== "multiple") {
        return state;
      }

      const allowedObjects = new Set(state.selection.objectIds);
      const allowedCharacters = new Set(state.selection.characterIds);
      let changed = false;

      const objects = state.project.scene.objects.map((object) => {
        if (!allowedObjects.has(object.id)) {
          return object;
        }

        const next = payload.objects[object.id];
        if (!next) {
          return object;
        }

        changed = true;

        return {
          ...object,
          position: { x: next.x, y: next.y },
        };
      });

      const characters = state.project.scene.characters.map((character) => {
        if (!allowedCharacters.has(character.id)) {
          return character;
        }

        const next = payload.characters[character.id];
        if (!next) {
          return character;
        }

        changed = true;

        return {
          ...character,
          position: { x: next.x, y: next.y },
        };
      });

      if (!changed) {
        return state;
      }

      return {
        project: touchProject({
          ...state.project,
          scene: {
            ...state.project.scene,
            objects,
            characters,
          },
        }),
      };
    }),
  addCharacter: () =>
    set((state) => {
      const character = createCharacter(state.project.scene.characters.length, state.promptBindings);

      return {
        project: touchProject({
          ...state.project,
          scene: {
            ...state.project.scene,
            characters: [...state.project.scene.characters, character],
          },
        }),
        selection: { kind: "character", id: character.id },
      };
    }),
  updateCharacter: (id, patch) =>
    set((state) => ({
      project: touchProject({
        ...state.project,
        scene: {
          ...state.project.scene,
          characters: state.project.scene.characters.map((character) =>
            character.id === id ? { ...character, ...patch } : character,
          ),
        },
      }),
    })),
  updateCharacterJoint: (id, jointId, position) =>
    set((state) => ({
      project: touchProject({
        ...state.project,
        scene: {
          ...state.project.scene,
          characters: state.project.scene.characters.map((character) =>
            character.id === id
              ? {
                  ...character,
                  joints: {
                    ...character.joints,
                    [jointId]: position,
                  },
                }
              : character,
          ),
        },
      }),
    })),
  addPromptTag: (target, tag) =>
    set((state) => {
      if (target.kind === "scene") {
        return {
          project: touchProject({
            ...state.project,
            scene: {
              ...state.project.scene,
              promptTags: addTagToList(state.project.scene.promptTags, tag),
            },
          }),
        };
      }

      if (target.kind === "object") {
        return {
          project: touchProject({
            ...state.project,
            scene: {
              ...state.project.scene,
              objects: state.project.scene.objects.map((object) =>
                object.id === target.id
                  ? { ...object, promptTags: addTagToList(object.promptTags, tag) }
                  : object,
              ),
            },
          }),
        };
      }

      const targetCharacterId = target.kind === "bodyPart" ? target.characterId : target.id;

      return {
        project: touchProject({
          ...state.project,
          scene: {
            ...state.project.scene,
            characters: state.project.scene.characters.map((character) => {
              if (character.id !== targetCharacterId) {
                return character;
              }

              if (target.kind === "bodyPart") {
                return {
                  ...character,
                  bodyParts: character.bodyParts.map((bodyPart) =>
                    bodyPart.id === target.bodyPartId
                      ? { ...bodyPart, promptTags: addTagToList(bodyPart.promptTags, tag) }
                      : bodyPart,
                  ),
                };
              }

              return { ...character, promptTags: addTagToList(character.promptTags, tag) };
            }),
          },
        }),
      };
    }),
  updatePromptTag: (target, tagId, patch) =>
    set((state) => {
      if (target.kind === "scene") {
        return {
          project: touchProject({
            ...state.project,
            scene: {
              ...state.project.scene,
              promptTags: updateTagInList(state.project.scene.promptTags, tagId, patch),
            },
          }),
        };
      }

      if (target.kind === "object") {
        return {
          project: touchProject({
            ...state.project,
            scene: {
              ...state.project.scene,
              objects: state.project.scene.objects.map((object) =>
                object.id === target.id
                  ? { ...object, promptTags: updateTagInList(object.promptTags, tagId, patch) }
                  : object,
              ),
            },
          }),
        };
      }

      const targetCharacterId = target.kind === "bodyPart" ? target.characterId : target.id;

      return {
        project: touchProject({
          ...state.project,
          scene: {
            ...state.project.scene,
            characters: state.project.scene.characters.map((character) => {
              if (character.id !== targetCharacterId) {
                return character;
              }

              if (target.kind === "bodyPart") {
                return {
                  ...character,
                  bodyParts: character.bodyParts.map((bodyPart) =>
                    bodyPart.id === target.bodyPartId
                      ? {
                          ...bodyPart,
                          promptTags: updateTagInList(bodyPart.promptTags, tagId, patch),
                        }
                      : bodyPart,
                  ),
                };
              }

              return {
                ...character,
                promptTags: updateTagInList(character.promptTags, tagId, patch),
              };
            }),
          },
        }),
      };
    }),
  removePromptTag: (target, tagId) =>
    set((state) => {
      if (target.kind === "scene") {
        return {
          project: touchProject({
            ...state.project,
            scene: {
              ...state.project.scene,
              promptTags: state.project.scene.promptTags.filter((tag) => tag.id !== tagId),
            },
          }),
        };
      }

      if (target.kind === "object") {
        return {
          project: touchProject({
            ...state.project,
            scene: {
              ...state.project.scene,
              objects: state.project.scene.objects.map((object) =>
                object.id === target.id
                  ? { ...object, promptTags: object.promptTags.filter((tag) => tag.id !== tagId) }
                  : object,
              ),
            },
          }),
        };
      }

      const targetCharacterId = target.kind === "bodyPart" ? target.characterId : target.id;

      return {
        project: touchProject({
          ...state.project,
          scene: {
            ...state.project.scene,
            characters: state.project.scene.characters.map((character) => {
              if (character.id !== targetCharacterId) {
                return character;
              }

              if (target.kind === "bodyPart") {
                return {
                  ...character,
                  bodyParts: character.bodyParts.map((bodyPart) =>
                    bodyPart.id === target.bodyPartId
                      ? {
                          ...bodyPart,
                          promptTags: bodyPart.promptTags.filter((tag) => tag.id !== tagId),
                        }
                      : bodyPart,
                  ),
                };
              }

              return {
                ...character,
                promptTags: character.promptTags.filter((tag) => tag.id !== tagId),
              };
            }),
          },
        }),
      };
    }),
  updatePromptCategoryBindings: (target, categories) =>
    set((state) => {
      const bindingTarget = getPromptBindingTargetKind(target);
      const promptCategoryBindings = normalizePromptCategoryBindings(categories);
      const promptSubcategoryBindings = normalizePromptSubcategoryBindings(
        state.promptBindings[bindingTarget].promptSubcategoryBindings,
        promptCategoryBindings,
      );
      const promptBindings = {
        ...state.promptBindings,
        [bindingTarget]: {
          promptCategoryBindings,
          promptSubcategoryBindings,
        },
      };

      if (target.kind === "scene") {
        return {
          promptBindings,
          project: touchProject({
            ...state.project,
            scene: {
              ...state.project.scene,
              promptCategoryBindings,
              promptSubcategoryBindings,
            },
          }),
        };
      }

      if (target.kind === "object") {
        return {
          promptBindings,
          project: touchProject({
            ...state.project,
            scene: {
              ...state.project.scene,
              objects: state.project.scene.objects.map((object) => ({
                ...object,
                promptCategoryBindings,
                promptSubcategoryBindings,
              })),
            },
          }),
        };
      }

      return {
        promptBindings,
        project: touchProject({
          ...state.project,
          scene: {
            ...state.project.scene,
            characters: state.project.scene.characters.map((character) =>
              target.kind === "bodyPart"
                ? {
                    ...character,
                    bodyParts: character.bodyParts.map((bodyPart) => ({
                      ...bodyPart,
                      promptCategoryBindings,
                      promptSubcategoryBindings,
                    })),
                  }
                : {
                    ...character,
                    promptCategoryBindings,
                    promptSubcategoryBindings,
                  },
            ),
          },
        }),
      };
    }),
  updatePromptSubcategoryBindings: (target, subcategories) =>
    set((state) => {
      const bindingTarget = getPromptBindingTargetKind(target);
      const promptCategoryBindings = state.promptBindings[bindingTarget].promptCategoryBindings;
      const promptSubcategoryBindings = normalizePromptSubcategoryBindings(
        subcategories,
        promptCategoryBindings,
      );
      const promptBindings = {
        ...state.promptBindings,
        [bindingTarget]: {
          promptCategoryBindings,
          promptSubcategoryBindings,
        },
      };

      if (target.kind === "scene") {
        return {
          promptBindings,
          project: touchProject({
            ...state.project,
            scene: {
              ...state.project.scene,
              promptSubcategoryBindings,
            },
          }),
        };
      }

      if (target.kind === "object") {
        return {
          promptBindings,
          project: touchProject({
            ...state.project,
            scene: {
              ...state.project.scene,
              objects: state.project.scene.objects.map((object) => ({
                ...object,
                promptSubcategoryBindings,
              })),
            },
          }),
        };
      }

      return {
        promptBindings,
        project: touchProject({
          ...state.project,
          scene: {
            ...state.project.scene,
            characters: state.project.scene.characters.map((character) =>
              target.kind === "bodyPart"
                ? {
                    ...character,
                    bodyParts: character.bodyParts.map((bodyPart) => ({
                      ...bodyPart,
                      promptSubcategoryBindings,
                    })),
                  }
                : {
                    ...character,
                    promptSubcategoryBindings,
                  },
            ),
          },
        }),
      };
    }),
  importPromptLibraryTags: (incoming) => {
    let addedCount = 0;

    set((state) => {
      const existing = state.project.settings.promptLibraryTags ?? [];
      const { next, addedCount: added } = mergeImportedPromptLibraryTags(
        BUILT_IN_PROMPT_LIBRARY_TAGS,
        existing,
        incoming,
        () => createId("lib"),
      );

      addedCount = added;

      if (added === 0) {
        return state;
      }

      return {
        project: touchProject({
          ...state.project,
          settings: {
            ...state.project.settings,
            promptLibraryTags: next,
          },
        }),
      };
    });

    return addedCount;
  },
  updatePromptLibraryTag: (tag) => {
    let updated = false;

    set((state) => {
      const existingCustomTags = state.project.settings.promptLibraryTags ?? [];
      const customTagExists = existingCustomTags.some((existingTag) => existingTag.id === tag.id);
      const normalizedTag: PromptTag = {
        ...tag,
        label: tag.label.trim() || tag.prompt.trim().slice(0, 48) || "未命名",
        prompt: tag.prompt.trim(),
        negative: tag.category === "negative" ? true : Boolean(tag.negative),
        subcategory: normalizePromptTagSubcategory(tag.category, tag.subcategory),
        weight: { ...tag.weight },
      };

      if (!normalizedTag.prompt) {
        return state;
      }

      if (customTagExists) {
        updated = true;

        return {
          project: touchProject({
            ...state.project,
            settings: {
              ...state.project.settings,
              promptLibraryTags: existingCustomTags.map((existingTag) =>
                existingTag.id === tag.id ? normalizedTag : existingTag,
              ),
            },
          }),
        };
      }

      const builtInTag = BUILT_IN_PROMPT_LIBRARY_TAGS.find(
        (existingTag) => existingTag.id === tag.id,
      );
      if (!builtInTag) {
        return state;
      }

      const existingHiddenBuiltIns = state.project.settings.deletedBuiltInPromptLibraryTagIds ?? [];
      const nextHiddenBuiltIns = existingHiddenBuiltIns.includes(builtInTag.id)
        ? existingHiddenBuiltIns
        : [...existingHiddenBuiltIns, builtInTag.id];

      updated = true;

      return {
        project: touchProject({
          ...state.project,
          settings: {
            ...state.project.settings,
            deletedBuiltInPromptLibraryTagIds: nextHiddenBuiltIns,
            promptLibraryTags: [
              ...existingCustomTags,
              { ...normalizedTag, id: createId("lib") },
            ],
          },
        }),
      };
    });

    return updated;
  },
  deletePromptLibraryTag: (tagId) => {
    let deleted = false;

    set((state) => {
      const builtInTag = BUILT_IN_PROMPT_LIBRARY_TAGS.find((tag) => tag.id === tagId);
      const customTag = (state.project.settings.promptLibraryTags ?? []).find(
        (tag) => tag.id === tagId,
      );
      const tagToDelete = builtInTag ?? customTag;
      const existingHiddenBuiltIns = state.project.settings.deletedBuiltInPromptLibraryTagIds ?? [];

      if (!tagToDelete) {
        return state;
      }

      if (builtInTag) {
        if (existingHiddenBuiltIns.includes(tagId)) {
          return state;
        }

        deleted = true;

        return {
          project: touchProject({
            ...state.project,
            scene: removeSemanticTagFromScene(state.project.scene, tagToDelete),
            settings: {
              ...state.project.settings,
              deletedBuiltInPromptLibraryTagIds: [...existingHiddenBuiltIns, tagId],
            },
          }),
        };
      }

      const existingCustomTags = state.project.settings.promptLibraryTags ?? [];
      const nextCustomTags = existingCustomTags.filter((tag) => tag.id !== tagId);

      if (nextCustomTags.length === existingCustomTags.length) {
        return state;
      }

      deleted = true;

      return {
        project: touchProject({
          ...state.project,
          scene: removeSemanticTagFromScene(state.project.scene, tagToDelete),
          settings: {
            ...state.project.settings,
            promptLibraryTags: nextCustomTags,
          },
        }),
      };
    });

    return deleted;
  },
}));
