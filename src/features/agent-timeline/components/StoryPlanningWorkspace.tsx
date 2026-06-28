"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, GitBranch, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import type {
  CharacterContinuityGraph,
  PlotStateGraph,
  ShotDependencyGraph,
  ShotDependencyGraphEdge,
  StorySafetyPlan,
  StoryShot,
  StoryWorkflowNodeId,
} from "@/features/agent-timeline/story-types";
import type {
  StoryManualEditScope,
  StoryWorkflowNodeResult,
} from "@/features/agent-timeline/story-state";
import { storyWorkflowDefinition } from "@/features/agent-timeline/story-workflow";

type StoryPlanningWorkspaceProps = {
  editable: boolean;
  emptyState: string;
  node: StoryWorkflowNodeResult;
  onSave: (
    nodeId: StoryWorkflowNodeId,
    result: unknown,
    scope: StoryManualEditScope,
  ) => void;
  storyId?: string;
};

type StoryWorkspaceSave = (result: unknown, scope: StoryManualEditScope) => void;

const shotDependencyReasonOptions: Array<{
  label: string;
  value: ShotDependencyGraphEdge["reason"];
}> = [
  { label: "Img2img source", value: "img2img-source" },
  { label: "Reference", value: "reference" },
  { label: "Continuity", value: "continuity" },
  { label: "Story order", value: "story-order" },
  { label: "Manual", value: "manual" },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function splitList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinList(value: readonly string[] | undefined) {
  return value?.join(", ") ?? "";
}

function tryFormatJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}

function parseJsonDraft(value: string) {
  try {
    return { ok: true as const, value: JSON.parse(value) as unknown };
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : "JSON could not be parsed.",
    };
  }
}

function getStoryId(result: unknown, fallback?: string) {
  return isRecord(result) && typeof result.storyId === "string" ? result.storyId : fallback;
}

function isStoryShotArray(value: unknown): value is StoryShot[] {
  return Array.isArray(value) && value.every((item) => isRecord(item) && typeof item.id === "string");
}

function isStorySafetyPlan(value: unknown): value is StorySafetyPlan {
  return isRecord(value) && Array.isArray(value.contentWarnings) && Array.isArray(value.perShotNotes);
}

function isShotDependencyGraph(value: unknown): value is ShotDependencyGraph {
  return isRecord(value) && Array.isArray(value.nodes) && Array.isArray(value.edges);
}

function isPlotStateGraph(value: unknown): value is PlotStateGraph {
  return isRecord(value) && Array.isArray(value.states) && Array.isArray(value.transitions);
}

function isCharacterContinuityGraph(value: unknown): value is CharacterContinuityGraph {
  return isRecord(value) && Array.isArray(value.characters) && Array.isArray(value.appearances);
}

function EmptyState({ emptyState, node }: { emptyState: string; node: StoryWorkflowNodeResult }) {
  return (
    <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-500">
      {node.error?.message ?? emptyState}
    </div>
  );
}

function StoryJsonWorkspace({
  editable,
  emptyState,
  node,
  onSave,
  storyId,
}: {
  editable: boolean;
  emptyState: string;
  node: StoryWorkflowNodeResult;
  onSave: StoryWorkspaceSave;
  storyId?: string;
}) {
  const [draft, setDraft] = useState(() => tryFormatJson(node.result));
  const [error, setError] = useState("");

  if (node.result === undefined) {
    return <EmptyState emptyState={emptyState} node={node} />;
  }

  function handleSave() {
    const parsed = parseJsonDraft(draft);

    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }

    setError("");
    onSave(parsed.value, {
      artifactType: node.nodeId,
      kind: "story",
      storyId: getStoryId(parsed.value, storyId),
    });
  }

  return (
    <div className="flex flex-col gap-3" data-testid="story-shared-json-workspace">
      <textarea
        className="min-h-64 rounded-md border border-slate-200 bg-white p-3 font-mono text-xs leading-relaxed text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
        disabled={!editable}
        onChange={(event) => setDraft(event.target.value)}
        value={draft}
      />
      {error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{error}</div>
      ) : null}
      <div className="flex justify-end">
        <Button className="h-8 px-3 text-xs shadow-none" disabled={!editable} onClick={handleSave} type="button">
          <Save className="size-3.5" />
          Save JSON
        </Button>
      </div>
    </div>
  );
}

function StoryboardShotsWorkspace({
  editable,
  emptyState,
  node,
  onSave,
  storyId,
}: {
  editable: boolean;
  emptyState: string;
  node: StoryWorkflowNodeResult;
  onSave: StoryWorkspaceSave;
  storyId?: string;
}) {
  const result = isStoryShotArray(node.result) ? node.result : null;
  const [shots, setShots] = useState<StoryShot[]>(() => result ?? []);

  if (!result) {
    return <EmptyState emptyState={emptyState} node={node} />;
  }

  function updateShot(shotId: string, patch: Partial<StoryShot>) {
    setShots((current) => current.map((shot) => (shot.id === shotId ? { ...shot, ...patch } : shot)));
  }

  function saveShot(shotId: string) {
    onSave(shots, {
      artifactType: "storyboard-shots",
      kind: "shot",
      shotId,
      storyId,
    });
  }

  return (
    <div className="flex flex-col gap-3" data-testid="storyboard-shots-workspace">
      {shots.map((shot) => (
        <section className="rounded-md border border-slate-200 bg-white p-3" key={shot.id}>
          <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[6rem_1fr_1fr]">
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
              Order
              <input
                className="h-9 rounded-md border border-slate-200 px-2 text-xs"
                disabled={!editable}
                onChange={(event) => updateShot(shot.id, { order: Number(event.target.value) || shot.order })}
                type="number"
                value={shot.order}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
              Title
              <input
                className="h-9 rounded-md border border-slate-200 px-2 text-xs"
                disabled={!editable}
                onChange={(event) => updateShot(shot.id, { title: event.target.value })}
                value={shot.title}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
              Camera
              <input
                className="h-9 rounded-md border border-slate-200 px-2 text-xs"
                disabled={!editable}
                onChange={(event) => updateShot(shot.id, { camera: event.target.value })}
                value={shot.camera}
              />
            </label>
          </div>
          <label className="mt-3 flex flex-col gap-1 text-xs font-medium text-slate-700">
            Description
            <textarea
              className="min-h-20 rounded-md border border-slate-200 px-2 py-2 text-xs leading-relaxed"
              disabled={!editable}
              onChange={(event) => updateShot(shot.id, { description: event.target.value })}
              value={shot.description}
            />
          </label>
          <label className="mt-3 flex flex-col gap-1 text-xs font-medium text-slate-700">
            Prompt intent
            <textarea
              className="min-h-20 rounded-md border border-slate-200 px-2 py-2 text-xs leading-relaxed"
              disabled={!editable}
              onChange={(event) => updateShot(shot.id, { promptIntent: event.target.value })}
              value={shot.promptIntent}
            />
          </label>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
              Characters
              <input
                className="h-9 rounded-md border border-slate-200 px-2 text-xs"
                disabled={!editable}
                onChange={(event) => updateShot(shot.id, { characterIds: splitList(event.target.value) })}
                value={joinList(shot.characterIds)}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
              Source shots
              <input
                className="h-9 rounded-md border border-slate-200 px-2 text-xs"
                disabled={!editable}
                onChange={(event) => updateShot(shot.id, { sourceShotIds: splitList(event.target.value) })}
                value={joinList(shot.sourceShotIds)}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
              Continuity notes
              <input
                className="h-9 rounded-md border border-slate-200 px-2 text-xs"
                disabled={!editable}
                onChange={(event) => updateShot(shot.id, { continuityNotes: splitList(event.target.value) })}
                value={joinList(shot.continuityNotes)}
              />
            </label>
          </div>
          <div className="mt-3 flex justify-end">
            <Button className="h-8 px-3 text-xs shadow-none" disabled={!editable} onClick={() => saveShot(shot.id)} type="button">
              Save shot
            </Button>
          </div>
        </section>
      ))}
    </div>
  );
}

function StorySafetyWorkspace({
  editable,
  emptyState,
  node,
  onSave,
  storyId,
}: {
  editable: boolean;
  emptyState: string;
  node: StoryWorkflowNodeResult;
  onSave: StoryWorkspaceSave;
  storyId?: string;
}) {
  const result = isStorySafetyPlan(node.result) ? node.result : null;
  const [draft, setDraft] = useState(() => result);

  if (!result || !draft) {
    return <EmptyState emptyState={emptyState} node={node} />;
  }

  const currentDraft = draft;

  function savePlan() {
    onSave(currentDraft, {
      artifactType: "story-safety-plan",
      kind: "story",
      storyId: currentDraft.storyId || storyId,
    });
  }

  return (
    <div className="flex flex-col gap-3" data-testid="story-safety-workspace">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
          Audience rating
          <select
            className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs"
            disabled={!editable}
            onChange={(event) => setDraft({ ...currentDraft, audienceRating: event.target.value as StorySafetyPlan["audienceRating"] })}
            value={currentDraft.audienceRating}
          >
            <option value="safe">Safe</option>
            <option value="suggestive">Suggestive</option>
            <option value="mature">Mature</option>
            <option value="explicit">Explicit</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
          NSFW context
          <input
            className="h-9 rounded-md border border-slate-200 px-2 text-xs"
            disabled={!editable}
            onChange={(event) =>
              setDraft({
                ...currentDraft,
                nsfwContext: {
                  enabled: currentDraft.nsfwContext?.enabled ?? currentDraft.audienceRating === "explicit",
                  rationale: event.target.value,
                },
              })
            }
            value={currentDraft.nsfwContext?.rationale ?? ""}
          />
        </label>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
          Content warnings
          <textarea
            className="min-h-24 rounded-md border border-slate-200 px-2 py-2 text-xs"
            disabled={!editable}
            onChange={(event) => setDraft({ ...currentDraft, contentWarnings: splitList(event.target.value) })}
            value={joinList(currentDraft.contentWarnings)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
          Blocked content
          <textarea
            className="min-h-24 rounded-md border border-slate-200 px-2 py-2 text-xs"
            disabled={!editable}
            onChange={(event) => setDraft({ ...currentDraft, blockedContent: splitList(event.target.value) })}
            value={joinList(currentDraft.blockedContent)}
          />
        </label>
      </div>
      <div className="flex justify-end">
        <Button className="h-8 px-3 text-xs shadow-none" disabled={!editable} onClick={savePlan} type="button">
          Save safety plan
        </Button>
      </div>
    </div>
  );
}

function ShotDependencyWorkspace({
  editable,
  emptyState,
  node,
  onSave,
  storyId,
}: {
  editable: boolean;
  emptyState: string;
  node: StoryWorkflowNodeResult;
  onSave: StoryWorkspaceSave;
  storyId?: string;
}) {
  const result = isShotDependencyGraph(node.result) ? node.result : null;
  const [graph, setGraph] = useState(() => result);

  if (!result || !graph) {
    return <EmptyState emptyState={emptyState} node={node} />;
  }

  const currentGraph = graph;

  function updateEdge(index: number, patch: Partial<ShotDependencyGraphEdge>) {
    setGraph({
      ...currentGraph,
      edges: currentGraph.edges.map((edge, edgeIndex) => (edgeIndex === index ? { ...edge, ...patch } : edge)),
    });
  }

  function saveGraph(shotId: string) {
    onSave(currentGraph, {
      artifactType: "shot-dependency-graph",
      kind: "shot",
      shotId,
      storyId: currentGraph.storyId || storyId,
    });
  }

  return (
    <div className="flex flex-col gap-3" data-testid="shot-dependency-workspace">
      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
        <GitBranch className="mr-1 inline size-3.5" />
        Edits are saved against the target shot, and downstream shot ids are derived from graph edges.
      </div>
      {currentGraph.edges.map((edge, index) => (
        <section className="grid gap-3 rounded-md border border-slate-200 bg-white p-3 md:grid-cols-[1fr_1fr_1fr_auto]" key={`${edge.fromShotId}:${edge.toShotId}:${index}`}>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
            From
            <select
              className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs"
              disabled={!editable}
              onChange={(event) => updateEdge(index, { fromShotId: event.target.value })}
              value={edge.fromShotId}
            >
              {currentGraph.nodes.map((graphNode) => (
                <option key={graphNode.shotId} value={graphNode.shotId}>{graphNode.label ?? graphNode.shotId}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
            To
            <select
              className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs"
              disabled={!editable}
              onChange={(event) => updateEdge(index, { toShotId: event.target.value })}
              value={edge.toShotId}
            >
              {currentGraph.nodes.map((graphNode) => (
                <option key={graphNode.shotId} value={graphNode.shotId}>{graphNode.label ?? graphNode.shotId}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
            Reason
            <select
              className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs"
              disabled={!editable}
              onChange={(event) => updateEdge(index, { reason: event.target.value as ShotDependencyGraphEdge["reason"] })}
              value={edge.reason}
            >
              {shotDependencyReasonOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <div className="flex items-end justify-end">
            <Button className="h-8 px-3 text-xs shadow-none" disabled={!editable} onClick={() => saveGraph(edge.toShotId)} type="button">
              Save edge
            </Button>
          </div>
        </section>
      ))}
    </div>
  );
}

function PlotStateWorkspace({
  editable,
  emptyState,
  node,
  onSave,
  storyId,
}: {
  editable: boolean;
  emptyState: string;
  node: StoryWorkflowNodeResult;
  onSave: StoryWorkspaceSave;
  storyId?: string;
}) {
  const result = isPlotStateGraph(node.result) ? node.result : null;
  const [graph, setGraph] = useState(() => result);

  if (!result || !graph) {
    return <EmptyState emptyState={emptyState} node={node} />;
  }

  const currentGraph = graph;

  function updateState(id: string, patch: Partial<PlotStateGraph["states"][number]>) {
    setGraph({
      ...currentGraph,
      states: currentGraph.states.map((state) => (state.id === id ? { ...state, ...patch } : state)),
    });
  }

  return (
    <div className="flex flex-col gap-3" data-testid="plot-state-workspace">
      {currentGraph.states.map((state) => (
        <section className="rounded-md border border-slate-200 bg-white p-3" key={state.id}>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
              State title
              <input
                className="h-9 rounded-md border border-slate-200 px-2 text-xs"
                disabled={!editable}
                onChange={(event) => updateState(state.id, { title: event.target.value })}
                value={state.title}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
              Shot ids
              <input
                className="h-9 rounded-md border border-slate-200 px-2 text-xs"
                disabled={!editable}
                onChange={(event) => updateState(state.id, { shotIds: splitList(event.target.value) })}
                value={joinList(state.shotIds)}
              />
            </label>
          </div>
          <label className="mt-3 flex flex-col gap-1 text-xs font-medium text-slate-700">
            Summary
            <textarea
              className="min-h-20 rounded-md border border-slate-200 px-2 py-2 text-xs"
              disabled={!editable}
              onChange={(event) => updateState(state.id, { summary: event.target.value })}
              value={state.summary}
            />
          </label>
        </section>
      ))}
      <div className="flex justify-end">
        <Button
          className="h-8 px-3 text-xs shadow-none"
          disabled={!editable}
          onClick={() => onSave(currentGraph, { artifactType: "plot-state-graph", kind: "story", storyId: currentGraph.storyId || storyId })}
          type="button"
        >
          Save plot states
        </Button>
      </div>
    </div>
  );
}

function CharacterContinuityWorkspace({
  editable,
  emptyState,
  node,
  onSave,
  storyId,
}: {
  editable: boolean;
  emptyState: string;
  node: StoryWorkflowNodeResult;
  onSave: StoryWorkspaceSave;
  storyId?: string;
}) {
  const result = isCharacterContinuityGraph(node.result) ? node.result : null;
  const [graph, setGraph] = useState(() => result);

  if (!result || !graph) {
    return <EmptyState emptyState={emptyState} node={node} />;
  }

  const currentGraph = graph;

  function updateAppearance(index: number, patch: Partial<CharacterContinuityGraph["appearances"][number]>) {
    setGraph({
      ...currentGraph,
      appearances: currentGraph.appearances.map((appearance, appearanceIndex) =>
        appearanceIndex === index ? { ...appearance, ...patch } : appearance,
      ),
    });
  }

  return (
    <div className="flex flex-col gap-3" data-testid="character-continuity-workspace">
      <div className="grid gap-2 md:grid-cols-2">
        {currentGraph.characters.map((character) => (
          <section className="rounded-md border border-slate-200 bg-slate-50 p-3" key={character.characterId}>
            <p className="text-xs font-semibold text-slate-900">{character.name}</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">{character.canonicalDescription}</p>
            <p className="mt-2 text-[11px] text-slate-500">{joinList(character.visualAnchors)}</p>
          </section>
        ))}
      </div>
      {currentGraph.appearances.map((appearance, index) => (
        <section className="rounded-md border border-slate-200 bg-white p-3" key={`${appearance.shotId}:${appearance.characterId}:${index}`}>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
              Wardrobe
              <input
                className="h-9 rounded-md border border-slate-200 px-2 text-xs"
                disabled={!editable}
                onChange={(event) => updateAppearance(index, { wardrobe: splitList(event.target.value) })}
                value={joinList(appearance.wardrobe)}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
              Pose/action
              <input
                className="h-9 rounded-md border border-slate-200 px-2 text-xs"
                disabled={!editable}
                onChange={(event) => updateAppearance(index, { poseOrAction: event.target.value })}
                value={appearance.poseOrAction}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
              Expression
              <input
                className="h-9 rounded-md border border-slate-200 px-2 text-xs"
                disabled={!editable}
                onChange={(event) => updateAppearance(index, { expression: event.target.value })}
                value={appearance.expression}
              />
            </label>
          </div>
          <label className="mt-3 flex flex-col gap-1 text-xs font-medium text-slate-700">
            Continuity notes
            <input
              className="h-9 rounded-md border border-slate-200 px-2 text-xs"
              disabled={!editable}
              onChange={(event) => updateAppearance(index, { continuityNotes: splitList(event.target.value) })}
              value={joinList(appearance.continuityNotes)}
            />
          </label>
        </section>
      ))}
      <div className="flex justify-end">
        <Button
          className="h-8 px-3 text-xs shadow-none"
          disabled={!editable}
          onClick={() => onSave(currentGraph, { artifactType: "character-continuity-graph", kind: "story", storyId: currentGraph.storyId || storyId })}
          type="button"
        >
          Save continuity
        </Button>
      </div>
    </div>
  );
}

export function StoryPlanningWorkspace({
  editable,
  emptyState,
  node,
  onSave,
  storyId,
}: StoryPlanningWorkspaceProps) {
  const nodeId = node.nodeId;
  const metadata = storyWorkflowDefinition.metadata[nodeId];
  const canEdit = editable && metadata.manualEdit.enabled;
  const save = useMemo<StoryWorkspaceSave>(
    () => (result, scope) => onSave(nodeId, result, scope),
    [nodeId, onSave],
  );

  if (!metadata.rawJson.enabled) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
        <AlertTriangle className="mr-1 inline size-3.5" />
        This story workspace is not inspectable yet.
      </div>
    );
  }

  switch (nodeId) {
    case "storyboard-shots":
      return <StoryboardShotsWorkspace editable={canEdit} emptyState={emptyState} node={node} onSave={save} storyId={storyId} />;
    case "story-safety-plan":
      return <StorySafetyWorkspace editable={canEdit} emptyState={emptyState} node={node} onSave={save} storyId={storyId} />;
    case "shot-dependency-graph":
      return <ShotDependencyWorkspace editable={canEdit} emptyState={emptyState} node={node} onSave={save} storyId={storyId} />;
    case "plot-state-graph":
      return <PlotStateWorkspace editable={canEdit} emptyState={emptyState} node={node} onSave={save} storyId={storyId} />;
    case "character-continuity-graph":
      return <CharacterContinuityWorkspace editable={canEdit} emptyState={emptyState} node={node} onSave={save} storyId={storyId} />;
    default:
      return <StoryJsonWorkspace editable={canEdit} emptyState={emptyState} node={node} onSave={save} storyId={storyId} />;
  }
}
