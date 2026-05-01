import type { SceneForgeProject } from "@/shared/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function serializeProject(project: SceneForgeProject) {
  return JSON.stringify(project, null, 2);
}

export function isSceneForgeProject(value: unknown): value is SceneForgeProject {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    value.version === 1 &&
    isRecord(value.scene) &&
    isRecord(value.settings) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

export function parseProjectJson(json: string): SceneForgeProject {
  const parsed: unknown = JSON.parse(json);

  if (!isSceneForgeProject(parsed)) {
    throw new Error("Invalid SceneForge project data.");
  }

  return parsed;
}
