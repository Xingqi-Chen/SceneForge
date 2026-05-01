import type { ProjectSummary, PromptBindingState, SceneForgeProject } from "@/shared/types";
import { createDefaultPromptBindingState } from "@/features/editor/store/defaults";

import type { GlobalPromptLibraryState } from "./project-serialization";
import {
  applyPromptBindingsToProject,
  mergePromptLibraryIntoProject,
} from "./project-serialization";

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

export async function loadPromptLibrary(): Promise<GlobalPromptLibraryState> {
  const response = await fetch("/api/prompt-library");

  if (!response.ok) {
    return { promptLibraryTags: [], deletedBuiltInPromptLibraryTagIds: [] };
  }

  return response.json() as Promise<GlobalPromptLibraryState>;
}

export async function savePromptLibrary(state: GlobalPromptLibraryState): Promise<void> {
  const response = await fetch("/api/prompt-library", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state),
  });

  await assertOk(response);
}

export async function loadPromptBindings(): Promise<PromptBindingState> {
  const response = await fetch("/api/prompt-bindings");

  if (!response.ok) {
    return createDefaultPromptBindingState();
  }

  return response.json() as Promise<PromptBindingState>;
}

export async function savePromptBindings(state: PromptBindingState): Promise<void> {
  const response = await fetch("/api/prompt-bindings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state),
  });

  await assertOk(response);
}

export async function loadProject(projectId: string): Promise<SceneForgeProject | undefined> {
  const [projectResponse, libResponse, bindingsResponse] = await Promise.all([
    fetch(`/api/projects/item?id=${encodeURIComponent(projectId)}`),
    fetch("/api/prompt-library"),
    fetch("/api/prompt-bindings"),
  ]);

  if (projectResponse.status === 404) {
    return undefined;
  }

  await assertOk(projectResponse);

  const project = (await projectResponse.json()) as SceneForgeProject;

  let library: GlobalPromptLibraryState = { promptLibraryTags: [], deletedBuiltInPromptLibraryTagIds: [] };
  if (libResponse.ok) {
    library = (await libResponse.json()) as GlobalPromptLibraryState;
  }

  const bindings = bindingsResponse.ok
    ? ((await bindingsResponse.json()) as PromptBindingState)
    : createDefaultPromptBindingState();

  const embeddedTags = project.settings.promptLibraryTags ?? [];
  const embeddedHidden = project.settings.deletedBuiltInPromptLibraryTagIds ?? [];
  const globalEmpty =
    (library.promptLibraryTags?.length ?? 0) === 0 && (library.deletedBuiltInPromptLibraryTagIds?.length ?? 0) === 0;

  if (globalEmpty && (embeddedTags.length > 0 || embeddedHidden.length > 0)) {
    await savePromptLibrary({
      promptLibraryTags: embeddedTags,
      deletedBuiltInPromptLibraryTagIds: embeddedHidden,
    });
    library = await loadPromptLibrary();
  }

  return applyPromptBindingsToProject(mergePromptLibraryIntoProject(project, library), bindings);
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const response = await fetch("/api/projects");
  await assertOk(response);
  return response.json() as Promise<ProjectSummary[]>;
}

export async function deleteProject(projectId: string): Promise<void> {
  const response = await fetch(`/api/projects/item?id=${encodeURIComponent(projectId)}`, {
    method: "DELETE",
  });

  if (response.status === 404) {
    throw new Error("未找到该项目。");
  }

  await assertOk(response);
}
