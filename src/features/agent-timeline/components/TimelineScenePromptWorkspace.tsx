"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, TableProperties } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ScenePromptTimelineResult, TimelineNodeResult } from "@/features/agent-timeline";
import { formatPromptProfileLabel, normalizePromptProfileId, type PromptProfileId } from "@/shared/prompt-profile";

type TimelineScenePromptWorkspaceProps = {
  editable: boolean;
  emptyState: string;
  node: TimelineNodeResult;
  onSave: (result: ScenePromptTimelineResult) => void;
  promptProfile: PromptProfileId;
};

type ScenePromptDraft = {
  primaryCharacterName: string;
  primaryCharacterIdentity: string;
  publicFacts: string;
  sceneIntent: string;
  styleTone: string;
  setting: string;
  sharedFacts: string;
  positivePrompt: string;
  negativeSuggestions: string;
  style: string;
  camera: string;
  lighting: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isScenePromptResult(value: unknown): value is ScenePromptTimelineResult {
  return (
    isRecord(value) &&
    isRecord(value.primaryCharacter) &&
    typeof value.primaryCharacter.name === "string" &&
    typeof value.primaryCharacter.identity === "string" &&
    isStringArray(value.primaryCharacter.publicFacts) &&
    typeof value.sceneIntent === "string" &&
    typeof value.styleTone === "string" &&
    typeof value.setting === "string" &&
    isStringArray(value.sharedFacts) &&
    typeof value.positivePrompt === "string" &&
    isStringArray(value.negativeSuggestions) &&
    Array.isArray(value.style) &&
    Array.isArray(value.camera) &&
    Array.isArray(value.lighting)
  );
}

function getManualText(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  if (isRecord(value) && typeof value.shellContent === "string") {
    return value.shellContent;
  }

  return "";
}

function createMinimalScenePromptResult(value: string, promptProfile: PromptProfileId): ScenePromptTimelineResult {
  return {
    promptProfile,
    primaryCharacter: {
      name: "Primary character",
      identity: value,
      publicFacts: [],
    },
    sceneIntent: value,
    styleTone: "",
    setting: "",
    sharedFacts: [],
    positivePrompt: value,
    negativeSuggestions: [],
    style: [],
    camera: [],
    lighting: [],
  };
}

function linesToList(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function fragmentsToLines(value: ScenePromptTimelineResult["style"]) {
  return value.map((fragment) => fragment.prompt).join("\n");
}

function linesToFragments(value: string) {
  return linesToList(value).map((prompt) => ({
    label: prompt.slice(0, 48),
    prompt,
  }));
}

function createDraftFromResult(result: ScenePromptTimelineResult | null): ScenePromptDraft {
  return {
    primaryCharacterName: result?.primaryCharacter.name ?? "",
    primaryCharacterIdentity: result?.primaryCharacter.identity ?? "",
    publicFacts: result?.primaryCharacter.publicFacts.join("\n") ?? "",
    sceneIntent: result?.sceneIntent ?? "",
    styleTone: result?.styleTone ?? "",
    setting: result?.setting ?? "",
    sharedFacts: result?.sharedFacts.join("\n") ?? "",
    positivePrompt: result?.positivePrompt ?? "",
    negativeSuggestions: result?.negativeSuggestions.join("\n") ?? "",
    style: result ? fragmentsToLines(result.style) : "",
    camera: result ? fragmentsToLines(result.camera) : "",
    lighting: result ? fragmentsToLines(result.lighting) : "",
  };
}

function createResultFromDraft(
  draft: ScenePromptDraft,
  previousResult: ScenePromptTimelineResult | null,
): ScenePromptTimelineResult {
  const positivePrompt = draft.positivePrompt.trim() || draft.sceneIntent.trim();
  const sceneIntent = draft.sceneIntent.trim() || positivePrompt;
  const primaryCharacterIdentity = draft.primaryCharacterIdentity.trim() || positivePrompt;

  return {
    promptProfile: normalizePromptProfileId(previousResult?.promptProfile),
    primaryCharacter: {
      name: draft.primaryCharacterName.trim() || "Primary character",
      identity: primaryCharacterIdentity,
      publicFacts: linesToList(draft.publicFacts),
    },
    sceneIntent,
    styleTone: draft.styleTone.trim(),
    setting: draft.setting.trim(),
    sharedFacts: linesToList(draft.sharedFacts),
    positivePrompt,
    negativeSuggestions: linesToList(draft.negativeSuggestions),
    style: linesToFragments(draft.style),
    camera: linesToFragments(draft.camera),
    lighting: linesToFragments(draft.lighting),
    ...(previousResult?.illustriousSections ? { illustriousSections: previousResult.illustriousSections } : {}),
    ...(previousResult?.animaSections ? { animaSections: previousResult.animaSections } : {}),
  };
}

function DraftTextArea({
  disabled,
  label,
  onChange,
  rows = 3,
  value,
}: {
  disabled: boolean;
  label: string;
  onChange: (value: string) => void;
  rows?: number;
  value: string;
}) {
  return (
    <textarea
      aria-label={label}
      className="min-h-20 w-full resize-y rounded-md border border-slate-200 bg-white px-3 py-2 text-xs leading-relaxed text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50 disabled:text-slate-500"
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      rows={rows}
      value={value}
    />
  );
}

export function TimelineScenePromptWorkspace({
  editable,
  emptyState,
  node,
  onSave,
  promptProfile,
}: TimelineScenePromptWorkspaceProps) {
  const scenePrompt = useMemo(
    () => {
      if (isScenePromptResult(node.result)) {
        return node.result;
      }

      const manualText = getManualText(node.result).trim();
      return manualText ? createMinimalScenePromptResult(manualText, promptProfile) : null;
    },
    [node.result, promptProfile],
  );
  const [draft, setDraft] = useState(() => createDraftFromResult(scenePrompt));
  const saveDisabled = !editable || !createResultFromDraft(draft, scenePrompt).positivePrompt.trim();

  function updateDraft<Key extends keyof ScenePromptDraft>(key: Key, value: ScenePromptDraft[Key]) {
    setDraft((current) => ({
      ...current,
      [key]: value,
    }));
  }

  return (
    <div className="flex flex-col gap-3" data-testid="timeline-scene-prompt-workspace">
      <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
        <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <TableProperties className="size-4 shrink-0 text-blue-600" />
            <div className="min-w-0">
              <h3 className="truncate text-xs font-semibold uppercase tracking-wide text-slate-500">
                Scene context table
              </h3>
              <p className="truncate text-[11px] text-slate-500">
                Canonical shared context for tags, action, and layout.
              </p>
            </div>
          </div>
          <Button
            className="h-8 px-2.5 text-xs shadow-none"
            disabled={saveDisabled}
            onClick={() => onSave(createResultFromDraft(draft, scenePrompt))}
            type="button"
          >
            <CheckCircle2 className="size-3.5" />
            Save context
          </Button>
        </div>

        {!scenePrompt ? (
          <div className="border-b border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-500">
            {emptyState}
          </div>
        ) : null}

        <table className="w-full border-collapse text-left text-xs">
          <tbody className="divide-y divide-slate-100">
            <tr>
              <th className="w-44 align-top bg-slate-50 px-3 py-3 font-semibold text-slate-600">
                Prompt profile
              </th>
              <td className="px-3 py-3">
                <div className="h-9 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                  {formatPromptProfileLabel(normalizePromptProfileId(scenePrompt?.promptProfile))}
                </div>
              </td>
            </tr>
            <tr>
              <th className="w-44 align-top bg-slate-50 px-3 py-3 font-semibold text-slate-600">
                Primary character
              </th>
              <td className="px-3 py-3">
                <input
                  aria-label="Primary character name"
                  className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                  disabled={!editable}
                  onChange={(event) => updateDraft("primaryCharacterName", event.target.value)}
                  value={draft.primaryCharacterName}
                />
              </td>
            </tr>
            <tr>
              <th className="w-44 align-top bg-slate-50 px-3 py-3 font-semibold text-slate-600">
                Character identity
              </th>
              <td className="px-3 py-3">
                <DraftTextArea
                  label="Character identity"
                  disabled={!editable}
                  onChange={(value) => updateDraft("primaryCharacterIdentity", value)}
                  value={draft.primaryCharacterIdentity}
                />
              </td>
            </tr>
            <tr>
              <th className="w-44 align-top bg-slate-50 px-3 py-3 font-semibold text-slate-600">
                Public character facts
              </th>
              <td className="px-3 py-3">
                <DraftTextArea
                  label="Public character facts"
                  disabled={!editable}
                  onChange={(value) => updateDraft("publicFacts", value)}
                  value={draft.publicFacts}
                />
              </td>
            </tr>
            <tr>
              <th className="w-44 align-top bg-slate-50 px-3 py-3 font-semibold text-slate-600">
                Scene intent
              </th>
              <td className="px-3 py-3">
                <DraftTextArea
                  label="Scene intent"
                  disabled={!editable}
                  onChange={(value) => updateDraft("sceneIntent", value)}
                  value={draft.sceneIntent}
                />
              </td>
            </tr>
            <tr>
              <th className="w-44 align-top bg-slate-50 px-3 py-3 font-semibold text-slate-600">
                Style / tone
              </th>
              <td className="px-3 py-3">
                <input
                  aria-label="Style tone"
                  className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                  disabled={!editable}
                  onChange={(event) => updateDraft("styleTone", event.target.value)}
                  value={draft.styleTone}
                />
              </td>
            </tr>
            <tr>
              <th className="w-44 align-top bg-slate-50 px-3 py-3 font-semibold text-slate-600">Setting</th>
              <td className="px-3 py-3">
                <input
                  aria-label="Setting"
                  className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                  disabled={!editable}
                  onChange={(event) => updateDraft("setting", event.target.value)}
                  value={draft.setting}
                />
              </td>
            </tr>
            <tr>
              <th className="w-44 align-top bg-slate-50 px-3 py-3 font-semibold text-slate-600">
                Shared facts
              </th>
              <td className="px-3 py-3">
                <DraftTextArea
                  label="Shared facts"
                  disabled={!editable}
                  onChange={(value) => updateDraft("sharedFacts", value)}
                  value={draft.sharedFacts}
                />
              </td>
            </tr>
            <tr>
              <th className="w-44 align-top bg-slate-50 px-3 py-3 font-semibold text-slate-600">
                Positive prompt
              </th>
              <td className="px-3 py-3">
                <DraftTextArea
                  label="Positive prompt"
                  disabled={!editable}
                  onChange={(value) => updateDraft("positivePrompt", value)}
                  rows={5}
                  value={draft.positivePrompt}
                />
              </td>
            </tr>
            <tr>
              <th className="w-44 align-top bg-slate-50 px-3 py-3 font-semibold text-slate-600">
                Negative suggestions
              </th>
              <td className="px-3 py-3">
                <DraftTextArea
                  label="Negative suggestions"
                  disabled={!editable}
                  onChange={(value) => updateDraft("negativeSuggestions", value)}
                  value={draft.negativeSuggestions}
                />
              </td>
            </tr>
            <tr>
              <th className="w-44 align-top bg-slate-50 px-3 py-3 font-semibold text-slate-600">
                Style tags
              </th>
              <td className="px-3 py-3">
                <DraftTextArea
                  label="Style tags"
                  disabled={!editable}
                  onChange={(value) => updateDraft("style", value)}
                  value={draft.style}
                />
              </td>
            </tr>
            <tr>
              <th className="w-44 align-top bg-slate-50 px-3 py-3 font-semibold text-slate-600">
                Camera tags
              </th>
              <td className="px-3 py-3">
                <DraftTextArea
                  label="Camera tags"
                  disabled={!editable}
                  onChange={(value) => updateDraft("camera", value)}
                  value={draft.camera}
                />
              </td>
            </tr>
            <tr>
              <th className="w-44 align-top bg-slate-50 px-3 py-3 font-semibold text-slate-600">
                Lighting tags
              </th>
              <td className="px-3 py-3">
                <DraftTextArea
                  label="Lighting tags"
                  disabled={!editable}
                  onChange={(value) => updateDraft("lighting", value)}
                  value={draft.lighting}
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
