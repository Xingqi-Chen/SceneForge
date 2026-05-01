"use client";

import { create } from "zustand";

import type {
  BodyPartId,
  CharacterSkeleton,
  JointId,
  ProjectSettings,
  PromptTag,
  Scene,
  SceneForgeProject,
  SceneObject,
  SceneObjectKind,
  Vector2,
} from "@/shared/types";

import { createDefaultProject, defaultCharacter } from "./defaults";

export type EditorSelection =
  | { kind: "scene" }
  | { kind: "object"; id: string }
  | { kind: "character"; id: string };

export type AddSceneObjectInput = {
  kind: SceneObjectKind;
  name: string;
  description?: string;
  fill?: string;
};

export type PromptTagTarget =
  | { kind: "scene" }
  | { kind: "object"; id: string }
  | { kind: "character"; id: string }
  | { kind: "bodyPart"; characterId: string; bodyPartId: BodyPartId };

type EditorState = {
  project: SceneForgeProject;
  selection: EditorSelection;
  setProject: (project: SceneForgeProject) => void;
  resetProject: () => void;
  selectScene: () => void;
  selectObject: (id: string) => void;
  selectCharacter: (id: string) => void;
  updateScene: (patch: Partial<Scene>) => void;
  updateProjectSettings: (patch: Partial<ProjectSettings>) => void;
  addObject: (input: AddSceneObjectInput) => void;
  updateObject: (id: string, patch: Partial<SceneObject>) => void;
  deleteSelection: () => void;
  duplicateSelection: () => void;
  bringSelectionForward: () => void;
  sendSelectionBackward: () => void;
  moveSelectionBy: (delta: Vector2) => void;
  addCharacter: () => void;
  updateCharacter: (id: string, patch: Partial<CharacterSkeleton>) => void;
  updateCharacterJoint: (id: string, jointId: JointId, position: Vector2) => void;
  addPromptTag: (target: PromptTagTarget, tag: PromptTag) => void;
  removePromptTag: (target: PromptTagTarget, tagId: string) => void;
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

function hasPromptTag(tags: PromptTag[], tag: PromptTag) {
  return tags.some(
    (existingTag) =>
      existingTag.prompt === tag.prompt &&
      existingTag.category === tag.category &&
      Boolean(existingTag.negative) === Boolean(tag.negative),
  );
}

function addTagToList(tags: PromptTag[], tag: PromptTag) {
  if (hasPromptTag(tags, tag)) {
    return tags;
  }

  return [...tags, clonePromptTag(tag)];
}

function createCharacter(layerOffset: number): CharacterSkeleton {
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
    })),
    promptTags: defaultCharacter.promptTags.map(clonePromptTag),
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
    promptTags: object.promptTags.map(clonePromptTag),
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
    })),
    promptTags: character.promptTags.map(clonePromptTag),
  };
}

export const useEditorStore = create<EditorState>((set) => ({
  project: createDefaultProject(),
  selection: { kind: "scene" },
  setProject: (project) => set({ project, selection: { kind: "scene" } }),
  resetProject: () => set({ project: createDefaultProject(), selection: { kind: "scene" } }),
  selectScene: () => set({ selection: { kind: "scene" } }),
  selectObject: (id) => set({ selection: { kind: "object", id } }),
  selectCharacter: (id) => set({ selection: { kind: "character", id } }),
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
  addObject: ({ kind, name, description = "", fill = "#e2e8f0" }) =>
    set((state) => {
      const nextLayer = getNextLayer(state.project.scene.objects);
      const object: SceneObject = {
        id: createId("object"),
        kind,
        name,
        description,
        position: { x: 160 + nextLayer * 24, y: 120 + nextLayer * 20 },
        size: kind === "circle" ? { width: 120, height: 120 } : { width: 180, height: 120 },
        rotation: 0,
        layer: nextLayer,
        fill,
        includeInPrompt: true,
        weight: { enabled: false, value: 1 },
        promptTags: [],
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

      return state;
    }),
  addCharacter: () =>
    set((state) => {
      const character = createCharacter(state.project.scene.characters.length);

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
}));
