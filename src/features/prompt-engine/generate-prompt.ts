import type { BodyPartId, CanvasConfig, PromptModelFormat, PromptTag, SceneForgeProject } from "@/shared/types";

import { formatPromptTag, formatPromptText } from "./formatters";
import {
  appendSpatialRelationHints,
  inferSceneLayoutConstraints,
  inferSpatialRelationHints,
} from "./spatial-relations";
import {
  characterAppearsInThreeViewport,
  characterAppearsOn2dCanvas,
} from "@/shared/utils/character-space";

export type GeneratedPrompt = {
  prompt: string;
  negativePrompt: string;
  parts: string[];
};

export type GeneratePromptOptions = {
  includeLayoutConstraints?: boolean;
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

function shouldSkipPlainObjectPrompt({
  formattedObjectPrompt,
  objectPrompt,
  objectTags,
  usesGlobalLayoutConstraints,
}: {
  formattedObjectPrompt: string;
  objectPrompt: string;
  objectTags: string[];
  usesGlobalLayoutConstraints: boolean;
}) {
  return (
    usesGlobalLayoutConstraints &&
    objectTags.length === 0 &&
    formattedObjectPrompt.trim() === objectPrompt.trim()
  );
}

export function generatePrompt(project: SceneForgeProject, options: GeneratePromptOptions = {}): GeneratedPrompt {
  const { scene, settings } = project;
  const parts: string[] = [];
  const negativeParts: string[] = [];
  const includeLayoutConstraints = options.includeLayoutConstraints ?? true;
  const includeObjectCanvasPositionHints = !includeLayoutConstraints;
  const usesGlobalLayoutConstraints = settings.includeSpatialHints && includeLayoutConstraints;
  const charactersForSpatialHints =
    scene.mode === "3d"
      ? scene.characters.filter(characterAppearsInThreeViewport)
      : scene.characters.filter(characterAppearsOn2dCanvas);

  if (scene.description.trim()) {
    parts.push(scene.description.trim());
  }

  parts.push(...collectTags(scene.promptTags, settings.modelFormat));
  negativeParts.push(...collectTags(scene.promptTags, settings.modelFormat, true));

  parts.push(formatCanvasForPrompt(scene.canvas));

  if (usesGlobalLayoutConstraints) {
    const layoutConstraints = inferSceneLayoutConstraints(scene);
    if (layoutConstraints) {
      parts.push(layoutConstraints);
    }
  }

  for (const object of scene.objects) {
    if (!object.includeInPrompt) {
      continue;
    }

    const objectPrompt = object.description.trim() || object.name.trim();
    const objectPromptWithSpatialHints =
      settings.includeSpatialHints && objectPrompt
        ? appendSpatialRelationHints(
            objectPrompt,
            inferSpatialRelationHints(
              object,
              {
                canvas: scene.canvas,
                characters: charactersForSpatialHints,
              },
              {
                includeCanvasPositionHints: includeObjectCanvasPositionHints,
              },
            ),
          )
        : objectPrompt;
    const formattedObjectPrompt = objectPrompt
      ? formatPromptText(objectPromptWithSpatialHints, object.weight, settings.modelFormat)
      : "";
    const objectTags = collectTags(object.promptTags, settings.modelFormat);

    if (
      !shouldSkipPlainObjectPrompt({
        formattedObjectPrompt,
        objectPrompt,
        objectTags,
        usesGlobalLayoutConstraints,
      })
    ) {
      parts.push(...buildScopedPrompt(formattedObjectPrompt, objectTags));
    }

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
