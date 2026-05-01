import fs from "node:fs/promises";
import path from "node:path";

import type { ProjectSummary, SceneForgeProject } from "@/shared/types";

import { getProjectContentFingerprint, sanitizeImportedProject } from "./project-serialization";

const FILE_SUFFIX = ".json";

/** Optional absolute path; defaults to `<cwd>/data/projects`. */
export function getResolvedProjectsDir(): string {
  const override = process.env.SCENEFORGE_PROJECTS_DIR?.trim();
  if (override) {
    return path.resolve(override);
  }

  return path.join(process.cwd(), "data", "projects");
}

export function projectFileName(projectId: string): string {
  return `${encodeURIComponent(projectId)}${FILE_SUFFIX}`;
}

export function parseProjectIdFromFileName(name: string): string | null {
  if (!name.endsWith(FILE_SUFFIX)) {
    return null;
  }

  try {
    return decodeURIComponent(name.slice(0, -FILE_SUFFIX.length));
  } catch {
    return null;
  }
}

async function ensureProjectsDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

async function readProjectFromJson(text: string): Promise<SceneForgeProject | null> {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    return sanitizeImportedProject(parsed as SceneForgeProject);
  } catch (error) {
    console.warn("[SceneForge] [persistence] skipped invalid project file", { error });
    return null;
  }
}

async function loadAllProjects(dir: string): Promise<SceneForgeProject[]> {
  await ensureProjectsDir(dir);

  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (error) {
    console.warn("[SceneForge] [persistence] failed to read projects directory", { error });
    return [];
  }

  const projects: SceneForgeProject[] = [];

  for (const entry of entries) {
    const id = parseProjectIdFromFileName(entry);
    if (!id) {
      continue;
    }

    const fullPath = path.join(dir, entry);
    try {
      const text = await fs.readFile(fullPath, "utf8");
      const project = await readProjectFromJson(text);
      if (project) {
        projects.push(project);
      }
    } catch (error) {
      console.warn("[SceneForge] [persistence] skipped unreadable project file", { entry, error });
    }
  }

  return projects;
}

export async function saveProjectToDisk(project: SceneForgeProject) {
  const dir = getResolvedProjectsDir();
  const normalized = sanitizeImportedProject(project);
  const fingerprint = getProjectContentFingerprint(normalized);
  const existing = await loadAllProjects(dir);

  const duplicateIds = existing
    .filter((entry) => {
      if (entry.id === normalized.id) {
        return false;
      }

      return getProjectContentFingerprint(sanitizeImportedProject(entry)) === fingerprint;
    })
    .map((entry) => entry.id);

  await ensureProjectsDir(dir);

  const fileName = projectFileName(normalized.id);
  const fullPath = path.join(dir, fileName);
  await fs.writeFile(fullPath, JSON.stringify(normalized), "utf8");

  for (const id of duplicateIds) {
    try {
      await fs.unlink(path.join(dir, projectFileName(id)));
    } catch (error) {
      console.warn("[SceneForge] [persistence] failed to remove duplicate project file", { id, error });
    }
  }

  if (duplicateIds.length > 0) {
    console.info("[SceneForge] [persistence] removed duplicate projects by content fingerprint", {
      keptId: normalized.id,
      removedIds: duplicateIds,
    });
  }
}

export async function loadProjectFromDisk(projectId: string): Promise<SceneForgeProject | undefined> {
  const dir = getResolvedProjectsDir();
  const fileName = projectFileName(projectId);
  const fullPath = path.join(dir, fileName);

  try {
    const text = await fs.readFile(fullPath, "utf8");
    const project = await readProjectFromJson(text);
    return project ?? undefined;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

export async function listProjectSummariesFromDisk(): Promise<ProjectSummary[]> {
  const dir = getResolvedProjectsDir();
  const projects = await loadAllProjects(dir);

  return projects
    .map((project) => ({
      id: project.id,
      name: project.name,
      updatedAt: project.updatedAt,
    }))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}
