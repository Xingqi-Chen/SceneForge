"use client";

import { useEffect, useMemo } from "react";
import { Box, CheckCircle2, CircleDashed, Tags } from "lucide-react";

import { CanvasViewport } from "@/features/editor/components/CanvasViewport";
import { PromptTagPickerPanel } from "@/features/editor/components/PromptTagPickerPanel";
import { useEditorStore } from "@/features/editor/store/editor-store";
import type {
  CanvasBindingTimelineResult,
  CharacterActionTimelineResult,
  CharacterTagsTimelineResult,
  TimelineNodeId,
  TimelineWorkflowState,
} from "@/features/agent-timeline";
import type { CharacterSkeleton } from "@/shared/types";

const visualWorkspaceNodeIds = new Set<TimelineNodeId>([
  "character-tags",
  "character-action",
  "canvas-binding",
]);

type TimelineEditorWorkspaceProps = {
  diagnosticsText: string;
  emptyDiagnostics: string;
  nodeId: TimelineNodeId;
  workflow: TimelineWorkflowState;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCanvasBindingResult(value: unknown): value is CanvasBindingTimelineResult {
  return (
    isRecord(value) &&
    isRecord(value.primaryCharacter) &&
    typeof value.primaryCharacter.id === "string" &&
    typeof value.primaryCharacter.name === "string" &&
    typeof value.spatialSummary === "string" &&
    isRecord(value.pose)
  );
}

function isCharacterTagsResult(value: unknown): value is CharacterTagsTimelineResult {
  return (
    isRecord(value) &&
    isRecord(value.primaryCharacter) &&
    typeof value.primaryCharacter.name === "string" &&
    typeof value.primaryCharacter.description === "string" &&
    Array.isArray(value.tags)
  );
}

function isCharacterActionResult(value: unknown): value is CharacterActionTimelineResult {
  return (
    isRecord(value) &&
    typeof value.action === "string" &&
    typeof value.poseSummary === "string" &&
    isRecord(value.pose)
  );
}

function getCharacterPromptTagCount(character: CharacterSkeleton | undefined) {
  if (!character) {
    return 0;
  }

  return (
    character.promptTags.length +
    character.bodyParts.reduce((total, bodyPart) => total + bodyPart.promptTags.length, 0)
  );
}

function getTaggedBodyPartCount(character: CharacterSkeleton | undefined) {
  if (!character) {
    return 0;
  }

  return character.bodyParts.filter((bodyPart) => bodyPart.promptTags.length > 0).length;
}

function getBindingSummary({
  action,
  boundCharacter,
  binding,
  characterTags,
  nodeId,
}: {
  action: CharacterActionTimelineResult | null;
  boundCharacter: CharacterSkeleton | undefined;
  binding: CanvasBindingTimelineResult | null;
  characterTags: CharacterTagsTimelineResult | null;
  nodeId: TimelineNodeId;
}) {
  const tagCount = getCharacterPromptTagCount(boundCharacter);
  const taggedBodyPartCount = getTaggedBodyPartCount(boundCharacter);
  const characterLabel =
    boundCharacter?.name ??
    binding?.primaryCharacter.name ??
    characterTags?.primaryCharacter.name ??
    "Primary character";

  if (nodeId === "character-tags") {
    return {
      label: tagCount > 0 ? "Prompt tags bound" : "Tag inference pending binding",
      detail:
        tagCount > 0
          ? `${characterLabel}: ${tagCount} prompt tags across ${taggedBodyPartCount} body-part targets.`
          : characterTags
            ? `${characterTags.tags.length} inferred tags are ready for layout binding.`
            : "Run character tag inference to populate the editor prompt surface.",
    };
  }

  if (nodeId === "character-action") {
    return {
      label: boundCharacter?.stickFigurePose3D ? "Pose bound to 3D character" : "Pose inference pending binding",
      detail:
        boundCharacter?.stickFigurePose3D
          ? `${characterLabel}: action pose is visible in the editor 3D canvas.`
          : action
            ? action.poseSummary
            : "Run action planning to populate the 3D pose surface.",
    };
  }

  return {
    label: binding && boundCharacter ? "3D layout binding active" : "3D layout pending",
    detail:
      binding && boundCharacter
        ? binding.spatialSummary
        : "Run layout planning to bind the primary character into the editor canvas.",
  };
}

export function isTimelineEditorWorkspaceNode(nodeId: TimelineNodeId) {
  return visualWorkspaceNodeIds.has(nodeId);
}

export function TimelineEditorWorkspace({
  diagnosticsText,
  emptyDiagnostics,
  nodeId,
  workflow,
}: TimelineEditorWorkspaceProps) {
  const project = useEditorStore((state) => state.project);
  const selectCharacter = useEditorStore((state) => state.selectCharacter);
  const setSceneMode = useEditorStore((state) => state.setSceneMode);
  const binding = useMemo(() => {
    const result = workflow.nodes["canvas-binding"].result;
    return isCanvasBindingResult(result) ? result : null;
  }, [workflow]);
  const characterTags = useMemo(() => {
    const result = workflow.nodes["character-tags"].result;
    return isCharacterTagsResult(result) ? result : null;
  }, [workflow]);
  const action = useMemo(() => {
    const result = workflow.nodes["character-action"].result;
    return isCharacterActionResult(result) ? result : null;
  }, [workflow]);
  const boundCharacter =
    (binding
      ? project.scene.characters.find((character) => character.id === binding.primaryCharacter.id)
      : undefined) ??
    project.scene.characters.find((character) => character.characterSpace === "3d") ??
    project.scene.characters[0];
  const tagCount = getCharacterPromptTagCount(boundCharacter);
  const summary = getBindingSummary({
    action,
    boundCharacter,
    binding,
    characterTags,
    nodeId,
  });

  useEffect(() => {
    if (!boundCharacter) {
      return;
    }

    if (useEditorStore.getState().project.scene.mode !== "3d") {
      setSceneMode("3d");
    }

    const selection = useEditorStore.getState().selection;
    const alreadyInCharacterScope =
      selection.kind === "character"
        ? selection.id === boundCharacter.id
        : selection.kind === "bodyPart"
          ? selection.characterId === boundCharacter.id
          : false;

    if (!alreadyInCharacterScope) {
      selectCharacter(boundCharacter.id);
    }
  }, [boundCharacter, selectCharacter, setSceneMode]);

  return (
    <div className="flex flex-col gap-3" data-testid="timeline-editor-workspace">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]">
        <section className="min-h-[28rem] overflow-hidden rounded-md border border-slate-200 bg-slate-50">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-3 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <Box className="size-4 shrink-0 text-indigo-600" />
              <div className="min-w-0">
                <h3 className="truncate text-xs font-semibold uppercase tracking-wide text-slate-500">
                  3D editor canvas
                </h3>
                <p className="truncate text-[11px] text-slate-500">{summary.label}</p>
              </div>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-600">
              {binding && boundCharacter ? (
                <CheckCircle2 className="size-3 text-emerald-600" />
              ) : (
                <CircleDashed className="size-3 text-amber-600" />
              )}
              {project.scene.mode.toUpperCase()}
            </span>
          </div>
          <div className="h-[25rem]">
            <CanvasViewport />
          </div>
        </section>

        <section className="min-h-[28rem] overflow-hidden rounded-md border border-slate-200 bg-white">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-3 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <Tags className="size-4 shrink-0 text-pink-600" />
              <div className="min-w-0">
                <h3 className="truncate text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Prompt tag binding
                </h3>
                <p className="truncate text-[11px] text-slate-500">{summary.detail}</p>
              </div>
            </div>
            <span className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-600">
              {tagCount} tags
            </span>
          </div>
          <div className="custom-scrollbar max-h-[25rem] overflow-y-auto p-3">
            <PromptTagPickerPanel />
          </div>
        </section>
      </div>

      <details className="rounded-md border border-slate-200 bg-slate-50">
        <summary className="cursor-pointer px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          JSON diagnostics
        </summary>
        {diagnosticsText ? (
          <pre className="whitespace-pre-wrap border-t border-slate-200 bg-white p-3 font-mono text-xs leading-relaxed text-slate-700">
            {diagnosticsText}
          </pre>
        ) : (
          <div className="border-t border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-500">
            {emptyDiagnostics}
          </div>
        )}
      </details>
    </div>
  );
}
