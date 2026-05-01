import type { PromptModelFormat, PromptTag, SceneForgeProject } from "@/shared/types";

import { formatPromptTag, formatPromptText } from "./formatters";

export type GeneratedPrompt = {
  prompt: string;
  negativePrompt: string;
  parts: string[];
};

function uniquePrompts(prompts: string[]) {
  return Array.from(new Set(prompts.filter(Boolean)));
}

function collectTags(tags: PromptTag[], format: PromptModelFormat, negative = false) {
  return tags
    .filter((tag) => Boolean(tag.prompt.trim()) && Boolean(tag.negative) === negative)
    .map((tag) => formatPromptTag(tag, format));
}

export function generatePrompt(project: SceneForgeProject): GeneratedPrompt {
  const { scene, settings } = project;
  const parts: string[] = [];
  const negativeParts: string[] = [];

  if (scene.description.trim()) {
    parts.push(scene.description.trim());
  }

  parts.push(...collectTags(scene.promptTags, settings.modelFormat));
  negativeParts.push(...collectTags(scene.promptTags, settings.modelFormat, true));

  for (const object of scene.objects) {
    if (!object.includeInPrompt) {
      continue;
    }

    if (object.description.trim()) {
      parts.push(formatPromptText(object.description, object.weight, settings.modelFormat));
    } else if (object.name.trim()) {
      parts.push(formatPromptText(object.name, object.weight, settings.modelFormat));
    }

    parts.push(...collectTags(object.promptTags, settings.modelFormat));
    negativeParts.push(...collectTags(object.promptTags, settings.modelFormat, true));
  }

  for (const character of scene.characters) {
    if (!character.includeInPrompt) {
      continue;
    }

    if (character.description.trim()) {
      parts.push(character.description.trim());
    }

    parts.push(...collectTags(character.promptTags, settings.modelFormat));
    negativeParts.push(...collectTags(character.promptTags, settings.modelFormat, true));

    for (const bodyPart of character.bodyParts) {
      parts.push(...collectTags(bodyPart.promptTags, settings.modelFormat));
      negativeParts.push(...collectTags(bodyPart.promptTags, settings.modelFormat, true));
    }
  }

  if (settings.negativePrompt.trim()) {
    negativeParts.push(settings.negativePrompt.trim());
  }

  const uniqueParts = uniquePrompts(parts);

  return {
    prompt: uniqueParts.join(", "),
    negativePrompt: uniquePrompts(negativeParts).join(", "),
    parts: uniqueParts,
  };
}
