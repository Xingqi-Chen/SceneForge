import { beforeEach, describe, expect, it } from "vitest";

import { getCharacterStickFigurePose } from "@/features/editor/stick-figure-3d/get-character-stick-pose";
import { createDefaultProject, createDefaultStickFigurePoseV1 } from "@/features/editor/store/defaults";
import { useEditorStore } from "@/features/editor/store/editor-store";
import type { PromptTag } from "@/shared/types";

import {
  bindPrimaryTimelineCharacterToEditorStore,
  getPrimaryTimelineCharacterPoseFromEditorStore,
} from "./editor-canvas-binding";
import type { TimelineCanvasBindingInput } from "./t5-node-adapters";

function createPose() {
  const pose = createDefaultStickFigurePoseV1();
  pose.joints.leftHand = { x: -0.56, y: 1.32, z: 0.24 };
  pose.joints.rightFoot = { x: 0.24, y: 0.04, z: -0.12 };

  return pose;
}

function createBindingInput(
  patch: Partial<TimelineCanvasBindingInput> = {},
): TimelineCanvasBindingInput {
  const pose = patch.pose ?? createPose();

  return {
    primaryCharacter: {
      name: "Courier",
      description: "A focused courier in a reflective jacket",
    },
    characterTags: [
      {
        targetKind: "character",
        label: "Courier",
        prompt: "solo courier protagonist",
        category: "character",
        subcategory: "character-subject",
        negative: false,
        weight: { enabled: false, value: 1 },
      },
      {
        targetKind: "bodyPart",
        label: "Reflective jacket",
        prompt: "reflective yellow jacket",
        category: "outfit",
        subcategory: "outfit-upper",
        bodyPartId: "torso",
        negative: false,
        weight: { enabled: false, value: 1 },
      },
    ],
    action: "leaping across wet pavement",
    pose,
    transform: {
      position: { x: 1.2, y: 0, z: -0.5 },
      rotation: { x: 0, y: 0.4, z: 0 },
      scale: { x: 1.1, y: 1.1, z: 1.1 },
    },
    spatialSummary: "Courier is bound as the primary editable 3D character at center stage.",
    ...patch,
  };
}

const manualCharacterTag: PromptTag = {
  id: "manual-character-tag",
  label: "Manual note",
  prompt: "manual character note",
  category: "character",
  subcategory: "character-subject",
  weight: {
    enabled: false,
    value: 1,
  },
};

const manualTorsoTag: PromptTag = {
  id: "manual-torso-tag",
  label: "Manual torso note",
  prompt: "manual torso note",
  category: "outfit",
  subcategory: "outfit-upper",
  weight: {
    enabled: false,
    value: 1,
  },
};

describe("editor canvas binding", () => {
  beforeEach(() => {
    useEditorStore.getState().setProject(createDefaultProject());
  });

  it("creates one editable 3D primary character with tags, body-part bindings, transform, and pose", () => {
    const pose = createPose();
    const result = bindPrimaryTimelineCharacterToEditorStore(createBindingInput({ pose }));
    const state = useEditorStore.getState();
    const character = state.project.scene.characters[0];
    const torso = character.bodyParts.find((bodyPart) => bodyPart.id === "torso");

    expect(state.project.scene.mode).toBe("3d");
    expect(state.project.scene.characters).toHaveLength(1);
    expect(state.selection).toEqual({ kind: "character", id: character.id });
    expect(character).toMatchObject({
      id: result.primaryCharacter.id,
      name: "Courier",
      description: "A focused courier in a reflective jacket",
      characterSpace: "3d",
      includeInPrompt: true,
    });
    expect(character.promptTags).toMatchObject([
      {
        label: "Courier",
        prompt: "solo courier protagonist",
        category: "character",
        subcategory: "character-subject",
      },
    ]);
    expect(torso?.promptTags).toMatchObject([
      {
        label: "Reflective jacket",
        prompt: "reflective yellow jacket",
        category: "outfit",
        subcategory: "outfit-upper",
      },
    ]);
    expect(character.transform3D?.position.x).toBe(1.2);
    expect(character.transform3D?.position.z).toBe(-0.5);
    expect(character.transform3D?.rotation).toEqual({ x: 0, y: 0.4, z: 0 });
    expect(character.transform3D?.scale).toEqual({ x: 1.1, y: 1.1, z: 1.1 });
    expect(getCharacterStickFigurePose(character).joints.leftHand).toEqual(pose.joints.leftHand);
    expect(getPrimaryTimelineCharacterPoseFromEditorStore().joints.leftHand).toEqual(pose.joints.leftHand);
    expect(result.spatialSummary).toContain("primary editable 3D character");
  });

  it("reuses the primary 3D character and replaces prior timeline tags while preserving manual tags", () => {
    const firstResult = bindPrimaryTimelineCharacterToEditorStore(createBindingInput());
    let character = useEditorStore.getState().project.scene.characters[0];

    useEditorStore.getState().updateCharacter(firstResult.primaryCharacter.id, {
      promptTags: [...character.promptTags, manualCharacterTag],
      bodyParts: character.bodyParts.map((bodyPart) =>
        bodyPart.id === "torso"
          ? {
              ...bodyPart,
              promptTags: [...bodyPart.promptTags, manualTorsoTag],
            }
          : bodyPart,
      ),
    });

    const secondResult = bindPrimaryTimelineCharacterToEditorStore(
      createBindingInput({
        primaryCharacter: {
          name: "Scout",
          description: "A scout checking a rain-soaked signal light",
        },
        characterTags: [
          {
            targetKind: "character",
            label: "Scout",
            prompt: "solo scout protagonist",
            category: "character",
            subcategory: "character-subject",
            negative: false,
            weight: { enabled: false, value: 1 },
          },
          {
            targetKind: "bodyPart",
            label: "Signal coat",
            prompt: "rainproof signal coat",
            category: "outfit",
            subcategory: "outfit-upper",
            bodyPartId: "torso",
            negative: false,
            weight: { enabled: false, value: 1 },
          },
        ],
      }),
    );
    character = useEditorStore.getState().project.scene.characters[0];
    const torso = character.bodyParts.find((bodyPart) => bodyPart.id === "torso");

    expect(secondResult.primaryCharacter.id).toBe(firstResult.primaryCharacter.id);
    expect(character.name).toBe("Scout");
    expect(character.promptTags.map((tag) => tag.prompt)).toEqual([
      "manual character note",
      "solo scout protagonist",
    ]);
    expect(torso?.promptTags.map((tag) => tag.prompt)).toEqual([
      "manual torso note",
      "rainproof signal coat",
    ]);
  });

  it("preserves parsed prompt-tag metadata when binding timeline tags", () => {
    bindPrimaryTimelineCharacterToEditorStore(
      createBindingInput({
        characterTags: [
          {
            targetKind: "bodyPart",
            bodyPartId: "torso",
            label: "Reflective jacket",
            prompt: "reflective yellow jacket",
            category: "outfit",
            subcategory: "outfit-upper",
            negative: true,
            weight: { enabled: true, value: 1.25 },
          },
        ],
      }),
    );

    const character = useEditorStore.getState().project.scene.characters[0];
    const torso = character.bodyParts.find((bodyPart) => bodyPart.id === "torso");

    expect(torso?.promptTags).toMatchObject([
      {
        label: "Reflective jacket",
        prompt: "reflective yellow jacket",
        category: "outfit",
        subcategory: "outfit-upper",
        negative: true,
        weight: { enabled: true, value: 1.25 },
      },
    ]);
  });
});
