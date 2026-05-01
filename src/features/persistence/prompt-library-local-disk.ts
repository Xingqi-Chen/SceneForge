import fs from "node:fs/promises";
import path from "node:path";

import { sanitizeGlobalPromptLibraryPayload, type GlobalPromptLibraryState } from "./project-serialization";

/** Optional absolute path to the shared prompt library JSON file. */
export function getResolvedPromptLibraryFilePath(): string {
  const override = process.env.SCENEFORGE_PROMPT_LIBRARY_FILE?.trim();
  if (override) {
    return path.resolve(override);
  }

  return path.join(process.cwd(), "data", "prompt-library.json");
}

export async function loadPromptLibraryFromDisk(): Promise<GlobalPromptLibraryState> {
  const fullPath = getResolvedPromptLibraryFilePath();

  try {
    const text = await fs.readFile(fullPath, "utf8");
    const parsed: unknown = JSON.parse(text);
    return sanitizeGlobalPromptLibraryPayload(parsed);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return { promptLibraryTags: [], deletedBuiltInPromptLibraryTagIds: [] };
    }

    console.warn("[SceneForge] [persistence] failed to read prompt library file", { error });
    return { promptLibraryTags: [], deletedBuiltInPromptLibraryTagIds: [] };
  }
}

export async function savePromptLibraryToDisk(state: GlobalPromptLibraryState) {
  const normalized = sanitizeGlobalPromptLibraryPayload(state);
  const fullPath = getResolvedPromptLibraryFilePath();
  const dir = path.dirname(fullPath);

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(fullPath, JSON.stringify({ version: 1, ...normalized }, null, 2), "utf8");
  console.info("[SceneForge] [persistence] wrote shared prompt library file", {
    path: fullPath,
    tagCount: normalized.promptLibraryTags.length,
  });
}
