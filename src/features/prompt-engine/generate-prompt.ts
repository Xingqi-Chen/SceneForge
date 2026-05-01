import type { BodyPartId, CanvasConfig, PromptModelFormat, PromptTag, SceneForgeProject } from "@/shared/types";

import { formatPromptTag, formatPromptText } from "./formatters";
import { appendSpatialRelationHints, inferSpatialRelationHints } from "./spatial-relations";

export type GeneratedPrompt = {
  prompt: string;
  negativePrompt: string;
  parts: string[];
};

const bodyPartPromptScopes: Record<BodyPartId, string> = {
  head: "head",
  torso: "torso",
  leftUpperArm: "left upper arm",
  leftForearm: "left forearm",
  rightUpperArm: "right upper arm",
  rightForearm: "right forearm",
  leftThigh: "left thigh",
  leftShin: "left lower leg",
  rightThigh: "right thigh",
  rightShin: "right lower leg",
  leftHand: "left hand",
  rightHand: "right hand",
  leftFoot: "left foot",
  rightFoot: "right foot",
};

function formatCanvasForPrompt(canvas: CanvasConfig): string {
  return `${canvas.aspectRatio} aspect ratio, ${canvas.width}x${canvas.height} pixels`;
}

function uniquePrompts(prompts: string[]) {
  return Array.from(new Set(prompts.filter(Boolean)));
}

function collectTags(tags: PromptTag[], format: PromptModelFormat, negative = false) {
  return tags
    .filter((tag) => Boolean(tag.prompt.trim()) && Boolean(tag.negative) === negative)
    .map((tag) => formatPromptTag(tag, format));
}

function buildScopedPrompt(scopePrompt: string, scopedTags: string[]) {
  if (!scopePrompt) {
    return scopedTags;
  }

  if (scopedTags.length === 0) {
    return [scopePrompt];
  }

  return [`${scopePrompt} with ${scopedTags.join(", ")}`];
}

function buildBodyPartPrompt(bodyPartPrompt: string, bodyPartTags: string[]) {
  return bodyPartTags.map((tag) =>
    /^(holding|gripping|wearing|pointing|touching)\b/i.test(tag)
      ? `${bodyPartPrompt} ${tag}`
      : `${bodyPartPrompt} with ${tag}`,
  );
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

  parts.push(formatCanvasForPrompt(scene.canvas));

  for (const object of scene.objects) {
    if (!object.includeInPrompt) {
      continue;
    }

    const objectPrompt = object.description.trim() || object.name.trim();
    const objectPromptWithSpatialHints =
      settings.includeSpatialHints && objectPrompt
        ? appendSpatialRelationHints(
            objectPrompt,
            inferSpatialRelationHints(object, {
              canvas: scene.canvas,
              characters: scene.characters,
            }),
          )
        : objectPrompt;
    const formattedObjectPrompt = objectPrompt
      ? formatPromptText(objectPromptWithSpatialHints, object.weight, settings.modelFormat)
      : "";
    const objectTags = collectTags(object.promptTags, settings.modelFormat);

    parts.push(...buildScopedPrompt(formattedObjectPrompt, objectTags));
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
      const bodyPartTags = collectTags(bodyPart.promptTags, settings.modelFormat);

      if (bodyPartTags.length > 0) {
        parts.push(...buildBodyPartPrompt(bodyPartPromptScopes[bodyPart.id], bodyPartTags));
      }

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
