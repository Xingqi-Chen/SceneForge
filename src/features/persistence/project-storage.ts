import { openDB, type DBSchema } from "idb";

import type { ProjectSummary, SceneForgeProject } from "@/shared/types";

const databaseName = "sceneforge-projects";
const databaseVersion = 1;
const projectStoreName = "projects";

interface SceneForgeDatabase extends DBSchema {
  projects: {
    key: string;
    value: SceneForgeProject;
    indexes: {
      "by-updated-at": string;
    };
  };
}

async function getDatabase() {
  return openDB<SceneForgeDatabase>(databaseName, databaseVersion, {
    upgrade(database) {
      const projectStore = database.createObjectStore(projectStoreName, {
        keyPath: "id",
      });

      projectStore.createIndex("by-updated-at", "updatedAt");
    },
  });
}

export async function saveProject(project: SceneForgeProject) {
  const database = await getDatabase();
  await database.put(projectStoreName, project);
}

export async function loadProject(projectId: string) {
  const database = await getDatabase();
  return database.get(projectStoreName, projectId);
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const database = await getDatabase();
  const projects = await database.getAll(projectStoreName);

  return projects
    .map((project) => ({
      id: project.id,
      name: project.name,
      updatedAt: project.updatedAt,
    }))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}
