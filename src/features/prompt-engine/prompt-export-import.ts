import type { PromptModelFormat, SceneForgeProject } from "@/shared/types";

import { generatePrompt } from "./generate-prompt";

export const SCENEFORGE_PROMPT_EXPORT_KIND = "sceneforge-prompt" as const;
export const SCENEFORGE_PROMPT_EXPORT_VERSION = 1 as const;

export type SceneForgePromptExportV1 = {
  kind: typeof SCENEFORGE_PROMPT_EXPORT_KIND;
  version: typeof SCENEFORGE_PROMPT_EXPORT_VERSION;
  exportedAt: string;
  modelFormat: PromptModelFormat;
  /** Effective positive: AI 文本优先，否则为引擎生成。 */
  positive: string;
  /** 引擎生成的正面 Prompt（不含 AI 覆盖）。 */
  enginePositive: string;
  /** AI Prompt 编辑区原文。 */
  aiPositive: string;
  /** 项目设置里的负面提示词（与标签负面合并前的用户配置）。 */
  settingsNegative: string;
  /** 预览中合并后的完整负面（含标签）。 */
  combinedNegative: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function buildPromptExportV1(
  project: SceneForgeProject,
  aiGeneratedPrompt: string,
): SceneForgePromptExportV1 {
  const generated = generatePrompt(project);
  const aiTrimmed = aiGeneratedPrompt.trim();
  const effectivePositive = aiTrimmed || generated.prompt;

  return {
    kind: SCENEFORGE_PROMPT_EXPORT_KIND,
    version: SCENEFORGE_PROMPT_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    modelFormat: project.settings.modelFormat,
    positive: effectivePositive,
    enginePositive: generated.prompt,
    aiPositive: aiGeneratedPrompt,
    settingsNegative: project.settings.negativePrompt.trim(),
    combinedNegative: generated.negativePrompt,
  };
}

export function serializePromptExport(project: SceneForgeProject, aiGeneratedPrompt: string): string {
  return JSON.stringify(buildPromptExportV1(project, aiGeneratedPrompt), null, 2);
}

/** 由 `parsePromptImportJson` 解析后用于写入编辑器的字段。 */
export type PromptImportApply = {
  /** 写入 AI Prompt 编辑区（含空字符串）。 */
  aiGeneratedPrompt: string;
  /** 为 true 时把 `negativePrompt` 写入项目设置。 */
  applySettingsNegative: boolean;
  negativePrompt: string;
};

function buildApplyFromV1(record: Record<string, unknown>): PromptImportApply {
  const aiRaw = record.aiPositive;
  const positive = record.positive;

  let aiGeneratedPrompt: string;
  if (typeof aiRaw === "string") {
    aiGeneratedPrompt = aiRaw;
  } else if (typeof positive === "string") {
    aiGeneratedPrompt = positive;
  } else {
    aiGeneratedPrompt = "";
  }

  const settingsNeg = record.settingsNegative;
  if (typeof settingsNeg === "string") {
    return {
      aiGeneratedPrompt,
      applySettingsNegative: true,
      negativePrompt: settingsNeg,
    };
  }

  return {
    aiGeneratedPrompt,
    applySettingsNegative: false,
    negativePrompt: "",
  };
}

/**
 * 从 JSON 文本解析可导入的 Prompt 片段。
 * 支持 SceneForge v1 导出，以及仅含 `positive` / `aiPositive` / `settingsNegative` 的宽松对象。
 */
export function parsePromptImportJson(json: string): PromptImportApply {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("文件不是有效的 JSON。");
  }

  if (!isRecord(parsed)) {
    throw new Error("JSON 根节点必须是对象。");
  }

  if (parsed.kind === SCENEFORGE_PROMPT_EXPORT_KIND && parsed.version === SCENEFORGE_PROMPT_EXPORT_VERSION) {
    return buildApplyFromV1(parsed);
  }

  const aiRaw = parsed.aiPositive;
  const positive = parsed.positive;
  const settingsNeg = parsed.settingsNegative;

  if (typeof aiRaw !== "string" && typeof positive !== "string" && typeof settingsNeg !== "string") {
    throw new Error("未找到可导入的字段（需要 positive、aiPositive 或 settingsNegative）。");
  }

  const aiGeneratedPrompt =
    typeof aiRaw === "string" ? aiRaw : typeof positive === "string" ? positive : "";

  if (typeof settingsNeg === "string") {
    return {
      aiGeneratedPrompt,
      applySettingsNegative: true,
      negativePrompt: settingsNeg,
    };
  }

  return {
    aiGeneratedPrompt,
    applySettingsNegative: false,
    negativePrompt: "",
  };
}
