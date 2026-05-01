import { describe, expect, it } from "vitest";

import { createDefaultProject } from "@/features/editor/store/defaults";

import {
  buildPromptExportV1,
  parsePromptImportJson,
  SCENEFORGE_PROMPT_EXPORT_KIND,
  SCENEFORGE_PROMPT_EXPORT_VERSION,
  serializePromptExport,
} from "./prompt-export-import";

describe("buildPromptExportV1", () => {
  it("uses engine positive when AI buffer is blank", () => {
    const project = createDefaultProject();
    const doc = buildPromptExportV1(project, "");
    expect(doc.kind).toBe(SCENEFORGE_PROMPT_EXPORT_KIND);
    expect(doc.version).toBe(SCENEFORGE_PROMPT_EXPORT_VERSION);
    expect(doc.aiPositive).toBe("");
    expect(doc.enginePositive).toBe(doc.positive);
  });

  it("prefers trimmed AI text as effective positive", () => {
    const project = createDefaultProject();
    const doc = buildPromptExportV1(project, "  anime, masterpiece  ");
    expect(doc.positive).toBe("anime, masterpiece");
    expect(doc.aiPositive).toBe("  anime, masterpiece  ");
  });
});

describe("parsePromptImportJson", () => {
  it("applies v1 export fields", () => {
    const project = createDefaultProject();
    const json = serializePromptExport(project, "restored");
    const apply = parsePromptImportJson(json);
    expect(apply.aiGeneratedPrompt).toBe("restored");
    expect(apply.applySettingsNegative).toBe(true);
    expect(apply.negativePrompt).toBe(project.settings.negativePrompt.trim());
  });

  it("accepts loose object with positive only", () => {
    const apply = parsePromptImportJson(JSON.stringify({ positive: "solo, sunset" }));
    expect(apply.aiGeneratedPrompt).toBe("solo, sunset");
    expect(apply.applySettingsNegative).toBe(false);
  });

  it("prefers aiPositive over positive in loose format", () => {
    const apply = parsePromptImportJson(
      JSON.stringify({ positive: "a", aiPositive: "b", settingsNegative: "bad" }),
    );
    expect(apply.aiGeneratedPrompt).toBe("b");
    expect(apply.applySettingsNegative).toBe(true);
    expect(apply.negativePrompt).toBe("bad");
  });

  it("throws on invalid JSON", () => {
    expect(() => parsePromptImportJson("{")).toThrow("JSON");
  });

  it("throws when no importable keys", () => {
    expect(() => parsePromptImportJson("{}")).toThrow("未找到");
  });
});
