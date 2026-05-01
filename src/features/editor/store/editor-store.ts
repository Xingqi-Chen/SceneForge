"use client";

import { create } from "zustand";

import type { SceneForgeProject, SceneObject, SceneObjectKind } from "@/shared/types";

import { createDefaultProject } from "./defaults";

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

type EditorState = {
  project: SceneForgeProject;
  selection: EditorSelection;
  setProject: (project: SceneForgeProject) => void;
  resetProject: () => void;
  selectScene: () => void;
  selectObject: (id: string) => void;
  selectCharacter: (id: string) => void;
  addObject: (input: AddSceneObjectInput) => void;
  updateObject: (id: string, patch: Partial<SceneObject>) => void;
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

export const useEditorStore = create<EditorState>((set) => ({
  project: createDefaultProject(),
  selection: { kind: "scene" },
  setProject: (project) => set({ project, selection: { kind: "scene" } }),
  resetProject: () => set({ project: createDefaultProject(), selection: { kind: "scene" } }),
  selectScene: () => set({ selection: { kind: "scene" } }),
  selectObject: (id) => set({ selection: { kind: "object", id } }),
  selectCharacter: (id) => set({ selection: { kind: "character", id } }),
  addObject: ({ kind, name, description = "", fill = "#e2e8f0" }) =>
    set((state) => {
      const nextLayer =
        Math.max(0, ...state.project.scene.objects.map((object) => object.layer)) + 1;
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
}));
