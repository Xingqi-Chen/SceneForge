import type { CharacterSkeleton, SceneObject } from "@/shared/types";

export type AxisBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export function normalizeMarqueeRect(x1: number, y1: number, x2: number, y2: number): AxisBounds {
  return {
    left: Math.min(x1, x2),
    top: Math.min(y1, y2),
    right: Math.max(x1, x2),
    bottom: Math.max(y1, y2),
  };
}

export function boundsIntersect(a: AxisBounds, b: AxisBounds): boolean {
  return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
}

const DEG2RAD = Math.PI / 180;

function rotateLocalPoint(x: number, y: number, rotationDeg: number) {
  const rad = rotationDeg * DEG2RAD;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: x * cos - y * sin,
    y: x * sin + y * cos,
  };
}

/** Axis-aligned bounds in scene space for a rotated rectangle object. */
export function getObjectWorldBounds(object: SceneObject): AxisBounds {
  const w = object.size.width;
  const h = object.size.height;
  const corners = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
  const ox = object.position.x;
  const oy = object.position.y;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const corner of corners) {
    const r = rotateLocalPoint(corner.x, corner.y, object.rotation);
    minX = Math.min(minX, ox + r.x);
    maxX = Math.max(maxX, ox + r.x);
    minY = Math.min(minY, oy + r.y);
    maxY = Math.max(maxY, oy + r.y);
  }

  return { left: minX, top: minY, right: maxX, bottom: maxY };
}

function getCharacterLocalBounds(character: CharacterSkeleton): AxisBounds {
  const joints = Object.values(character.joints);
  let minX = Math.min(...joints.map((j) => j.x));
  let maxX = Math.max(...joints.map((j) => j.x));
  let minY = Math.min(...joints.map((j) => j.y));
  let maxY = Math.max(...joints.map((j) => j.y));

  const { neck } = character.joints;
  minX = Math.min(minX, neck.x - 30);
  maxX = Math.max(maxX, neck.x + 30);
  minY = Math.min(minY, neck.y - 34 - 30);

  const labelY = maxY + 40;
  maxY = Math.max(maxY, labelY + 30);

  minX -= 10;
  maxX += 10;
  minY -= 10;
  maxY += 10;

  return { left: minX, top: minY, right: maxX, bottom: maxY };
}

export function getCharacterWorldBounds(character: CharacterSkeleton): AxisBounds {
  const local = getCharacterLocalBounds(character);
  const px = character.position.x;
  const py = character.position.y;

  return {
    left: local.left + px,
    top: local.top + py,
    right: local.right + px,
    bottom: local.bottom + py,
  };
}

export function collectMarqueeSelection(
  objects: SceneObject[],
  characters: CharacterSkeleton[],
  marquee: AxisBounds,
): { objectIds: string[]; characterIds: string[] } {
  const objectIds = [...objects]
    .sort((a, b) => a.layer - b.layer)
    .filter((object) => boundsIntersect(getObjectWorldBounds(object), marquee))
    .map((object) => object.id);

  const characterIds = characters
    .filter((character) => boundsIntersect(getCharacterWorldBounds(character), marquee))
    .map((character) => character.id);

  return { objectIds, characterIds };
}
