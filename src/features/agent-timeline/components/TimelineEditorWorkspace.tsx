"use client";

import { useEffect, useMemo, useState } from "react";
import { Box, CheckCircle2, CircleDashed, Tags } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CanvasViewport } from "@/features/editor/components/CanvasViewport";
import { useEditorStore } from "@/features/editor/store/editor-store";
import type {
  CanvasBindingTimelineResult,
  CharacterActionTimelineResult,
  CharacterTagsTimelineResult,
  TimelineNodeId,
  TimelineWorkflowState,
} from "@/features/agent-timeline";
import { singleImageWorkflowDefinition } from "@/features/agent-timeline/workflow-definitions";
import type { CharacterSkeleton } from "@/shared/types";
import { TimelinePromptLibraryDrawer } from "./TimelinePromptLibraryDrawer";

type TimelineEditorWorkspaceProps = {
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
  return singleImageWorkflowDefinition.metadata[nodeId].workspace.key === "canvas-binding";
}

export function TimelineEditorWorkspace({
  workflow,
}: TimelineEditorWorkspaceProps) {
  const project = useEditorStore((state) => state.project);
  const selectCharacter = useEditorStore((state) => state.selectCharacter);
  const setSceneMode = useEditorStore((state) => state.setSceneMode);
  const [promptLibraryOpen, setPromptLibraryOpen] = useState(true);
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
    <div className="flex min-h-0 flex-col" data-testid="timeline-editor-workspace">
      <section className="min-h-[34rem] overflow-hidden rounded-md border border-slate-200 bg-slate-50">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <Box className="size-4 shrink-0 text-indigo-600" />
            <div className="min-w-0">
              <h3 className="truncate text-xs font-semibold uppercase tracking-wide text-slate-500">
                3D editor canvas
              </h3>
              <p className="truncate text-[11px] text-slate-500">{summary.label}</p>
              <p className="truncate text-[11px] text-slate-400">{summary.detail}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              aria-pressed={promptLibraryOpen}
              className="h-8 gap-1.5 rounded-md border-slate-200 bg-white px-2.5 text-xs text-slate-700 shadow-none hover:bg-slate-50"
              data-testid="timeline-prompt-library-toggle"
              onClick={() => setPromptLibraryOpen((open) => !open)}
              size="sm"
              type="button"
              variant="secondary"
            >
              <Tags className="size-3.5" />
              Prompt library
            </Button>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-600">
              {binding && boundCharacter ? (
                <CheckCircle2 className="size-3 text-emerald-600" />
              ) : (
                <CircleDashed className="size-3 text-amber-600" />
              )}
              {project.scene.mode.toUpperCase()}
            </span>
          </div>
        </div>
        <div className="relative h-[34rem] min-h-[34rem] overflow-hidden lg:h-[44rem]">
          <CanvasViewport lockedSceneMode="3d" showSceneModeSwitcher={false} />

          {promptLibraryOpen ? (
            <aside
              className="absolute inset-x-3 bottom-3 z-30 flex max-h-[20rem] flex-col overflow-hidden rounded-md border border-slate-200 bg-white shadow-xl md:inset-x-auto md:bottom-3 md:right-3 md:top-[5.5rem] md:max-h-none md:w-[22rem]"
            >
              <TimelinePromptLibraryDrawer />
            </aside>
          ) : null}
        </div>
      </section>
    </div>
  );
}
