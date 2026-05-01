import type { CanvasConfig, CharacterSkeleton, Scene, SceneObject } from "@/shared/types";

type Bounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
};

export type SpatialRelationContext = {
  canvas: CanvasConfig;
  characters: CharacterSkeleton[];
};

export type SpatialRelationOptions = {
  includeCanvasPositionHints?: boolean;
};

const skyObjectPattern = /\b(moon|sun|star|sky|cloud|clouds|bird|birds|airship|planet)\b/i;
const windowPattern = /\b(window|窗)\b/i;
const outdoorViewPattern =
  /\b(river|lake|sea|ocean|mountain|mountains|train|track|tracks|railway|road|street|city|sky|cloud|sunset|sunrise|forest|horizon|窗外|河|湖|海|山|火车|铁轨|天空|城市)\b/i;

function getObjectBounds(object: SceneObject): Bounds {
  const width = Math.max(0, object.size.width);
  const height = Math.max(0, object.size.height);

  return {
    left: object.position.x,
    top: object.position.y,
    right: object.position.x + width,
    bottom: object.position.y + height,
    width,
    height,
    centerX: object.position.x + width / 2,
    centerY: object.position.y + height / 2,
  };
}

function getCharacterBounds(character: CharacterSkeleton): Bounds | null {
  const points = Object.values(character.joints);

  if (points.length === 0) {
    return null;
  }

  const xs = points.map((point) => character.position.x + point.x);
  const ys = points.map((point) => character.position.y + point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  const width = right - left;
  const height = bottom - top;

  return {
    left,
    top,
    right,
    bottom,
    width,
    height,
    centerX: left + width / 2,
    centerY: top + height / 2,
  };
}

function getHorizontalRelation(bounds: Bounds, canvas: CanvasConfig) {
  const leftEdge = canvas.width / 3;
  const rightEdge = (canvas.width / 3) * 2;

  if (bounds.centerX < leftEdge) {
    return "left";
  }

  if (bounds.centerX > rightEdge) {
    return "right";
  }

  return null;
}

function getVerticalRelation(bounds: Bounds, canvas: CanvasConfig) {
  const upperEdge = canvas.height / 3;
  const lowerEdge = (canvas.height / 3) * 2;

  if (bounds.centerY < upperEdge) {
    return "upper";
  }

  if (bounds.centerY > lowerEdge) {
    return "lower";
  }

  return null;
}

function getPositionHint(object: SceneObject, bounds: Bounds, canvas: CanvasConfig) {
  const horizontal = getHorizontalRelation(bounds, canvas);
  const vertical = getVerticalRelation(bounds, canvas);
  const objectText = `${object.name} ${object.description}`;
  const skyObject = skyObjectPattern.test(objectText);

  if (skyObject && vertical === "upper") {
    if (horizontal === "left") {
      return "in the upper left sky";
    }

    if (horizontal === "right") {
      return "in the upper right sky";
    }

    return "in the upper sky";
  }

  if (vertical === "upper" && horizontal === "left") {
    return "in the upper left area";
  }

  if (vertical === "upper" && horizontal === "right") {
    return "in the upper right area";
  }

  if (vertical === "upper") {
    return "in the upper area";
  }

  if (vertical === "lower") {
    return "in the foreground";
  }

  if (horizontal === "left") {
    return "on the left";
  }

  if (horizontal === "right") {
    return "on the right";
  }

  return null;
}

function getScaleHint(bounds: Bounds, canvas: CanvasConfig) {
  const canvasArea = canvas.width * canvas.height;

  if (canvasArea <= 0) {
    return null;
  }

  const objectAreaRatio = (bounds.width * bounds.height) / canvasArea;

  if (objectAreaRatio >= 0.25) {
    return "dominant";
  }

  if (objectAreaRatio >= 0.12) {
    return "large";
  }

  return null;
}

function getDistanceBetweenBounds(left: Bounds, right: Bounds) {
  const dx = Math.max(right.left - left.right, left.left - right.right, 0);
  const dy = Math.max(right.top - left.bottom, left.top - right.bottom, 0);

  return Math.hypot(dx, dy);
}

function getCharacterRelationHint(bounds: Bounds, characters: CharacterSkeleton[]) {
  const characterBounds = characters
    .filter((character) => character.includeInPrompt)
    .map(getCharacterBounds)
    .filter((bounds): bounds is Bounds => bounds !== null);

  if (characterBounds.length === 0) {
    return null;
  }

  const nearestCharacter = characterBounds
    .map((character) => ({
      bounds: character,
      distance: getDistanceBetweenBounds(bounds, character),
    }))
    .sort((left, right) => left.distance - right.distance)[0];

  if (!nearestCharacter) {
    return null;
  }

  const proximityLimit =
    Math.max(bounds.width, bounds.height, nearestCharacter.bounds.width, nearestCharacter.bounds.height) *
    0.75;

  if (nearestCharacter.distance <= proximityLimit) {
    return "near the character";
  }

  if (bounds.bottom <= nearestCharacter.bounds.centerY) {
    return "behind the character";
  }

  if (bounds.top >= nearestCharacter.bounds.centerY) {
    return "in front of the character";
  }

  return null;
}

export function inferSpatialRelationHints(
  object: SceneObject,
  { canvas, characters }: SpatialRelationContext,
  options: SpatialRelationOptions = {},
) {
  const bounds = getObjectBounds(object);
  const includeCanvasPositionHints = options.includeCanvasPositionHints ?? true;
  const hints = [
    getScaleHint(bounds, canvas),
    includeCanvasPositionHints ? getPositionHint(object, bounds, canvas) : null,
    getCharacterRelationHint(bounds, characters),
  ];

  return hints.filter((hint): hint is string => Boolean(hint));
}

function getRegionLabel(bounds: Bounds, canvas: CanvasConfig) {
  const horizontal = getHorizontalRelation(bounds, canvas);
  const vertical = getVerticalRelation(bounds, canvas);

  if (vertical === "upper" && horizontal === "left") {
    return "upper left";
  }

  if (vertical === "upper" && horizontal === "right") {
    return "upper right";
  }

  if (vertical === "upper") {
    return "upper center";
  }

  if (vertical === "lower" && horizontal === "left") {
    return "lower left foreground";
  }

  if (vertical === "lower" && horizontal === "right") {
    return "lower right foreground";
  }

  if (vertical === "lower") {
    return "lower foreground";
  }

  if (horizontal === "left") {
    return "left side";
  }

  if (horizontal === "right") {
    return "right side";
  }

  return "center";
}

function getObjectPromptName(object: SceneObject) {
  return object.description.trim() || object.name.trim() || "object";
}

function getCharacterPromptName(character: CharacterSkeleton, index: number, total: number) {
  const text = character.description.trim() || character.name.trim();

  if (text) {
    return text;
  }

  return total > 1 ? `character ${index + 1}` : "character";
}

function getRelativeHorizontalRelation(left: Bounds, right: Bounds) {
  const minSeparation = Math.max(left.width, right.width) * 0.2;
  const delta = left.centerX - right.centerX;

  if (delta < -minSeparation) {
    return "left of";
  }

  if (delta > minSeparation) {
    return "right of";
  }

  return null;
}

function getDepthRelation(left: Bounds, right: Bounds) {
  const minSeparation = Math.max(left.height, right.height) * 0.2;
  const delta = left.centerY - right.centerY;

  if (delta < -minSeparation) {
    return "behind";
  }

  if (delta > minSeparation) {
    return "in front of";
  }

  return null;
}

function boundsOverlap(left: Bounds, right: Bounds) {
  return left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top;
}

function getObjectText(object: SceneObject) {
  return `${object.name} ${object.description}`;
}

function getWindowViewConstraints(objects: SceneObject[]) {
  const windows = objects.filter((object) => windowPattern.test(getObjectText(object)));
  if (windows.length === 0) {
    return [];
  }

  const windowBounds = windows.map(getObjectBounds);

  return objects
    .filter((object) => !windowPattern.test(getObjectText(object)) && outdoorViewPattern.test(getObjectText(object)))
    .filter((object) => {
      const bounds = getObjectBounds(object);
      return windowBounds.some((window) => boundsOverlap(bounds, window) || bounds.centerY <= window.centerY);
    })
    .map((object) => `${getObjectPromptName(object)} visible outside or through the window`);
}

export function inferSceneLayoutConstraints(scene: Scene) {
  const objects = scene.objects.filter((object) => object.includeInPrompt);
  const characters = scene.characters.filter((character) => character.includeInPrompt);

  if (objects.length === 0 && characters.length === 0) {
    return null;
  }

  const constraints: string[] = [
    "layout constraint: composition must follow the 2D canvas layout",
    "keep object placement and spatial separation from the canvas",
  ];

  objects.forEach((object) => {
    const bounds = getObjectBounds(object);
    constraints.push(`${getObjectPromptName(object)} placed in the ${getRegionLabel(bounds, scene.canvas)}`);
  });

  const characterEntries = characters
    .map((character, index) => ({
      bounds: getCharacterBounds(character),
      name: getCharacterPromptName(character, index, characters.length),
    }))
    .filter((entry): entry is { bounds: Bounds; name: string } => entry.bounds !== null);

  characterEntries.forEach((character) => {
    constraints.push(`${character.name} placed in the ${getRegionLabel(character.bounds, scene.canvas)}`);
  });

  for (const character of characterEntries) {
    const nearbyObjects = objects
      .map((object) => ({
        object,
        bounds: getObjectBounds(object),
      }))
      .map((entry) => ({
        ...entry,
        distance: getDistanceBetweenBounds(character.bounds, entry.bounds),
      }))
      .sort((left, right) => left.distance - right.distance)
      .slice(0, 4);

    for (const { object, bounds, distance } of nearbyObjects) {
      const objectName = getObjectPromptName(object);
      const proximityLimit = Math.max(character.bounds.width, character.bounds.height, bounds.width, bounds.height) * 0.9;
      const horizontal = getRelativeHorizontalRelation(bounds, character.bounds);
      const depth = getDepthRelation(bounds, character.bounds);

      if (distance <= proximityLimit) {
        constraints.push(`${objectName} close to ${character.name}`);
      }

      if (horizontal) {
        constraints.push(`${objectName} ${horizontal} ${character.name}`);
      }

      if (depth) {
        constraints.push(`${objectName} ${depth} ${character.name}`);
      }
    }
  }

  constraints.push(...getWindowViewConstraints(objects));

  return Array.from(new Set(constraints)).join(", ");
}

function promptAlreadyContainsHint(prompt: string, hint: string) {
  const normalizedPrompt = prompt.toLowerCase();

  if (hint.includes("foreground")) {
    return /\bforeground\b/.test(normalizedPrompt);
  }

  if (hint.includes("upper left")) {
    return /\bupper left\b|\bleft upper\b/.test(normalizedPrompt);
  }

  if (hint.includes("upper right")) {
    return /\bupper right\b|\bright upper\b/.test(normalizedPrompt);
  }

  if (hint.includes("upper")) {
    return /\bupper\b|\btop\b/.test(normalizedPrompt);
  }

  if (hint.includes("on the left")) {
    return /\bleft\b/.test(normalizedPrompt);
  }

  if (hint.includes("on the right")) {
    return /\bright\b/.test(normalizedPrompt);
  }

  if (hint.includes("near the character")) {
    return /\bnear the character\b|\bnear character\b/.test(normalizedPrompt);
  }

  if (hint.includes("behind the character")) {
    return /\bbehind the character\b|\bbehind character\b/.test(normalizedPrompt);
  }

  if (hint.includes("in front of the character")) {
    return /\bin front of the character\b|\bin front of character\b/.test(normalizedPrompt);
  }

  return normalizedPrompt.includes(hint.toLowerCase());
}

export function appendSpatialRelationHints(prompt: string, hints: string[]) {
  const nextHints = hints.filter((hint) => !promptAlreadyContainsHint(prompt, hint));

  if (nextHints.length === 0) {
    return prompt;
  }

  return [prompt, ...nextHints].join(" ");
}
