"use client";

import { useEffect, useMemo } from "react";
import { Box, CheckCircle2, CircleDashed } from "lucide-react";

import { CanvasViewport } from "@/features/editor/components/CanvasViewport";
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
  "canvas-binding",
]);

type TimelineEditorWorkspaceProps = {
  diagnosticsText: string;
  emptyDiagnostics: string;
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
    Array.isArray(value.items)
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
}: {
  action: CharacterActionTimelineResult | null;
  boundCharacter: CharacterSkeleton | undefined;
  binding: CanvasBindingTimelineResult | null;
  characterTags: CharacterTagsTimelineResult | null;
}) {
  const tagCount = getCharacterPromptTagCount(boundCharacter);
  const taggedBodyPartCount = getTaggedBodyPartCount(boundCharacter);
  const characterLabel =
    boundCharacter?.name ??
    binding?.primaryCharacter.name ??
    "Primary character";
  const pendingDetail =
    action && characterTags
      ? `${characterLabel}: ${characterTags.items.length} inferred tags and pose plan are ready for layout binding.`
      : "Run layout planning to bind the primary character into the editor canvas.";

  return {
    label: binding && boundCharacter ? "3D layout binding active" : "3D layout pending",
    detail:
      binding && boundCharacter
        ? `${binding.spatialSummary} ${tagCount} prompt tags across ${taggedBodyPartCount} body-part targets.`
        : pendingDetail,
  };
}

export function isTimelineEditorWorkspaceNode(nodeId: TimelineNodeId) {
  return visualWorkspaceNodeIds.has(nodeId);
}

export function TimelineEditorWorkspace({
  diagnosticsText,
  emptyDiagnostics,
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
  const summary = getBindingSummary({
    action,
    boundCharacter,
    binding,
    characterTags,
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
      <section className="min-h-[34rem] overflow-hidden rounded-md border border-slate-200 bg-slate-50">
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
        <div className="h-[34rem] min-h-[34rem] lg:h-[44rem]">
          <CanvasViewport />
        </div>
      </section>

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
