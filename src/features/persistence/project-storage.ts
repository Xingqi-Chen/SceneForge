import type { ProjectSummary, SceneForgeProject } from "@/shared/types";

interface ApiErrorBody {
  error?: {
    message?: string;
  };
}

async function readErrorMessage(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) {
    return response.statusText || `请求失败 (${response.status})`;
  }

  try {
    const data = JSON.parse(text) as ApiErrorBody;
    const message = data.error?.message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  } catch {
    /* ignore */
  }

  return text;
}

async function assertOk(response: Response) {
  if (response.ok) {
    return;
  }

  throw new Error(await readErrorMessage(response));
}

export async function saveProject(project: SceneForgeProject) {
  const response = await fetch("/api/projects", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(project),
  });

  await assertOk(response);
}

export async function loadProject(projectId: string): Promise<SceneForgeProject | undefined> {
  const response = await fetch(`/api/projects/item?id=${encodeURIComponent(projectId)}`);

  if (response.status === 404) {
    return undefined;
  }

  await assertOk(response);

  return response.json() as Promise<SceneForgeProject>;
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const response = await fetch("/api/projects");
  await assertOk(response);
  return response.json() as Promise<ProjectSummary[]>;
}
