import { describe, expect, it } from "vitest";

import { createDefaultProject } from "@/features/editor/store/defaults";

import { isSceneForgeProject, parseProjectJson, serializeProject } from "./project-serialization";

describe("project serialization", () => {
  it("round-trips valid project data", () => {
    const project = createDefaultProject();
    const serialized = serializeProject(project);

    expect(parseProjectJson(serialized)).toEqual(project);
  });

  it("rejects invalid imported data", () => {
    expect(isSceneForgeProject({ version: 1 })).toBe(false);
    expect(() => parseProjectJson(JSON.stringify({ version: 1 }))).toThrow(
      "Invalid SceneForge project data.",
    );
  });
});
