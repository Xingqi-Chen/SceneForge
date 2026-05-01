import fs from "node:fs/promises";
import path from "node:path";

import type { PromptBindingState } from "@/shared/types";

import { sanitizeGlobalPromptBindingsPayload } from "./project-serialization";

/** Optional absolute path to the shared prompt binding JSON file. */
export function getResolvedPromptBindingsFilePath(): string {
  const override = process.env.SCENEFORGE_PROMPT_BINDINGS_FILE?.trim();
  if (override) {
    return path.resolve(override);
  }

  return path.join(process.cwd(), "data", "prompt-bindings.json");
}

export async function loadPromptBindingsFromDisk(): Promise<PromptBindingState> {
  const fullPath = getResolvedPromptBindingsFilePath();

  try {
    const text = await fs.readFile(fullPath, "utf8");
    const parsed: unknown = JSON.parse(text);
    return sanitizeGlobalPromptBindingsPayload(parsed);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return sanitizeGlobalPromptBindingsPayload({});
    }

    console.warn("[SceneForge] [persistence] failed to read prompt bindings file", { error });
    return sanitizeGlobalPromptBindingsPayload({});
  }
}

export async function savePromptBindingsToDisk(state: PromptBindingState) {
  const normalized = sanitizeGlobalPromptBindingsPayload(state);
  const fullPath = getResolvedPromptBindingsFilePath();
  const dir = path.dirname(fullPath);

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(fullPath, JSON.stringify({ version: 1, ...normalized }, null, 2), "utf8");
  console.info("[SceneForge] [persistence] wrote shared prompt bindings file", {
    path: fullPath,
  });
}
