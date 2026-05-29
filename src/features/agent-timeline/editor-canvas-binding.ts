"use client";

import { getCharacterStickFigurePose } from "@/features/editor/stick-figure-3d/get-character-stick-pose";
import { createDefaultStickFigurePoseV1 } from "@/features/editor/store/defaults";
import { useEditorStore } from "@/features/editor/store/editor-store";
import type { BodyPartId, PromptTag } from "@/shared/types";
import type { StickFigurePoseV1 } from "@/shared/types/stick-figure-pose";

import type {
  CanvasBindingTimelineResult,
  CharacterPromptTag,
  TimelineCanvasBindingInput,
} from "@/features/agent-timeline";

const timelineTagIdPrefix = "timeline-t5";

function slug(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);

  return normalized || "tag";
}

function removePriorTimelineTags(tags: PromptTag[]) {
  return tags.filter((tag) => !tag.id.startsWith(timelineTagIdPrefix));
}

function toPromptTag(tag: CharacterPromptTag, index: number, target: string): PromptTag {
  return {
    id: `${timelineTagIdPrefix}-${target}-${index}-${slug(tag.label || tag.prompt)}`,
    label: tag.label,
    prompt: tag.prompt,
    category: tag.category,
    ...(tag.subcategory ? { subcategory: tag.subcategory } : {}),
    weight: {
      value: 1,
      enabled: false,
    },
  };
}

function splitPromptTags(tags: CharacterPromptTag[]) {
  const characterTags: PromptTag[] = [];
  const bodyPartTags = new Map<BodyPartId, PromptTag[]>();

  tags.forEach((tag, index) => {
    if (tag.bodyPartId) {
      const nextTag = toPromptTag(tag, index, tag.bodyPartId);
      bodyPartTags.set(tag.bodyPartId, [...(bodyPartTags.get(tag.bodyPartId) ?? []), nextTag]);
      return;
    }

    characterTags.push(toPromptTag(tag, index, "character"));
  });

  return { bodyPartTags, characterTags };
}

function getOrCreatePrimaryCharacterId() {
  let state = useEditorStore.getState();

  if (state.project.scene.mode !== "3d") {
    state.setSceneMode("3d");
    state = useEditorStore.getState();
  }

  const existingCharacter =
    state.project.scene.characters.find((character) => character.characterSpace === "3d") ??
    state.project.scene.characters[0];

  if (existingCharacter) {
    return existingCharacter.id;
  }

  state.addCharacter();
  state = useEditorStore.getState();

  if (state.selection.kind === "character") {
    return state.selection.id;
  }

  const createdCharacter = state.project.scene.characters.at(-1);
  if (!createdCharacter) {
    throw new Error("Unable to create a primary 3D character for timeline binding.");
  }

  return createdCharacter.id;
}

export function getPrimaryTimelineCharacterPoseFromEditorStore(): StickFigurePoseV1 {
  const state = useEditorStore.getState();
  const existingCharacter =
    state.project.scene.characters.find((character) => character.characterSpace === "3d") ??
    state.project.scene.characters[0];

  return existingCharacter
    ? getCharacterStickFigurePose(existingCharacter)
    : createDefaultStickFigurePoseV1();
}

export function bindPrimaryTimelineCharacterToEditorStore(
  input: TimelineCanvasBindingInput,
): CanvasBindingTimelineResult {
  const characterId = getOrCreatePrimaryCharacterId();
  let state = useEditorStore.getState();
  const currentCharacter = state.project.scene.characters.find((character) => character.id === characterId);

  if (!currentCharacter) {
    throw new Error("Primary character was not found after timeline binding setup.");
  }

  const { bodyPartTags, characterTags } = splitPromptTags(input.characterTags);

  state.updateCharacter(characterId, {
    name: input.primaryCharacter.name,
    description: input.primaryCharacter.description,
    characterSpace: "3d",
    includeInPrompt: true,
    promptTags: [...removePriorTimelineTags(currentCharacter.promptTags), ...characterTags],
    bodyParts: currentCharacter.bodyParts.map((bodyPart) => ({
      ...bodyPart,
      promptTags: [
        ...removePriorTimelineTags(bodyPart.promptTags),
        ...(bodyPartTags.get(bodyPart.id) ?? []),
      ],
    })),
  });
  state.setCharacter3DTransform(characterId, input.transform);
  state.applyCharacter3DPose(characterId, input.pose);
  state.selectCharacter(characterId);

  state = useEditorStore.getState();
  const boundCharacter = state.project.scene.characters.find((character) => character.id === characterId);

  if (!boundCharacter) {
    throw new Error("Primary character was not found after timeline binding.");
  }

  return {
    primaryCharacter: {
      id: boundCharacter.id,
      name: boundCharacter.name,
      description: boundCharacter.description,
    },
    characterTags: input.characterTags,
    action: input.action,
    transform: boundCharacter.transform3D ?? input.transform,
    pose: getCharacterStickFigurePose(boundCharacter),
    spatialSummary: input.spatialSummary,
  };
}
