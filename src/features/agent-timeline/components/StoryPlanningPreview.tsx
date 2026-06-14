"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, CircleDot, GitBranch, Settings } from "lucide-react";

import {
  createStoryWorkflowState,
  setStoryNodeManualResult,
  type StoryManualEditScope,
  type StoryWorkflowState,
} from "@/features/agent-timeline/story-state";
import {
  storyWorkflowDefinition,
} from "@/features/agent-timeline/story-workflow";
import type {
  CharacterContinuityGraph,
  PlotStateGraph,
  ShotDependencyGraph,
  StoryConsistencyCheck,
  StorySafetyPlan,
  StoryShot,
  StoryWorkflowNodeId,
} from "@/features/agent-timeline/story-types";
import { cn } from "@/shared/utils/cn";

import { StoryPlanningWorkspace } from "./StoryPlanningWorkspace";

const headerLinkClassName =
  "inline-flex h-8 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-900 transition-colors hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400";

const planningNodeIds = [
  "storyboard-shots",
  "story-safety-plan",
  "shot-dependency-graph",
  "plot-state-graph",
  "character-continuity-graph",
  "resource-plan",
  "parameter-plan",
  "story-render-plan",
  "story-consistency-check",
  "generation-gate",
  "story-result-display",
] as const satisfies readonly StoryWorkflowNodeId[];

type PlanningNodeId = (typeof planningNodeIds)[number];

const storyId = "story-preview";
const timestamp = "2026-06-14T00:00:00.000Z";

const sampleShots = [
  {
    id: "shot-1",
    storyId,
    order: 1,
    title: "Arrival",
    description: "A traveler enters a quiet elevated station after rain.",
    characterIds: ["traveler"],
    sourceShotIds: [],
    camera: "Wide establishing frame",
    promptIntent: "rain-washed platform, lone traveler, reflective puddles",
    continuityNotes: ["Keep the blue coat visible."],
  },
  {
    id: "shot-2",
    storyId,
    order: 2,
    title: "Signal",
    description: "The traveler notices a small red signal reflected in a puddle.",
    characterIds: ["traveler"],
    sourceShotIds: ["shot-1"],
    camera: "Low medium shot",
    promptIntent: "red signal reflection, tense pause, wet pavement",
    continuityNotes: ["The same blue coat and satchel remain in frame."],
  },
  {
    id: "shot-3",
    storyId,
    order: 3,
    title: "Departure",
    description: "The traveler turns toward the dark stairwell beyond the platform.",
    characterIds: ["traveler"],
    sourceShotIds: [],
    camera: "Over-the-shoulder frame",
    promptIntent: "shadowed stairwell, cautious turn, distant city lights",
    continuityNotes: ["Satchel strap crosses the right shoulder."],
  },
] satisfies StoryShot[];

const sampleSafetyPlan = {
  storyId,
  audienceRating: "safe",
  contentWarnings: ["night setting", "mild suspense"],
  blockedContent: [],
  perShotNotes: [
    {
      shotId: "shot-2",
      risks: ["Signal could imply danger."],
      mitigations: ["Keep threat abstract and non-graphic."],
    },
  ],
  nsfwContext: {
    enabled: false,
    rationale: "No explicit content requested.",
  },
} satisfies StorySafetyPlan;

const sampleDependencyGraph = {
  storyId,
  nodes: sampleShots.map((shot) => ({ shotId: shot.id, label: shot.title })),
  edges: [
    { fromShotId: "shot-1", toShotId: "shot-2", reason: "img2img-source" },
    { fromShotId: "shot-2", toShotId: "shot-3", reason: "continuity" },
  ],
} satisfies ShotDependencyGraph;

const samplePlotState = {
  storyId,
  states: [
    {
      id: "state-1",
      title: "Station established",
      summary: "The place, weather, and traveler silhouette are established.",
      shotIds: ["shot-1"],
    },
    {
      id: "state-2",
      title: "Signal discovered",
      summary: "The traveler receives a visual cue that changes the direction of the scene.",
      shotIds: ["shot-2", "shot-3"],
    },
  ],
  transitions: [{ fromStateId: "state-1", toStateId: "state-2", reason: "The reflected signal creates the next action." }],
} satisfies PlotStateGraph;

const sampleContinuity = {
  storyId,
  characters: [
    {
      characterId: "traveler",
      name: "Traveler",
      canonicalDescription: "A young traveler in a blue raincoat with a small canvas satchel.",
      visualAnchors: ["blue raincoat", "canvas satchel", "short dark hair"],
    },
  ],
  appearances: sampleShots.map((shot) => ({
    shotId: shot.id,
    characterId: "traveler",
    wardrobe: ["blue raincoat", "canvas satchel"],
    poseOrAction: shot.id === "shot-1" ? "entering platform" : shot.id === "shot-2" ? "looking down" : "turning away",
    expression: shot.id === "shot-2" ? "alert" : "quiet focus",
    continuityNotes: shot.continuityNotes,
  })),
} satisfies CharacterContinuityGraph;

const sampleConsistency = {
  storyId,
  passed: true,
  checkedAt: timestamp,
  issues: [],
  warnings: ["Shot 3 should preserve the satchel shoulder direction from Shot 2."],
} satisfies StoryConsistencyCheck;

const sampleResults: Partial<Record<StoryWorkflowNodeId, unknown>> = {
  "storyboard-shots": sampleShots,
  "story-safety-plan": sampleSafetyPlan,
  "shot-dependency-graph": sampleDependencyGraph,
  "plot-state-graph": samplePlotState,
  "character-continuity-graph": sampleContinuity,
  "resource-plan": {
    storyId,
    checkpoints: [{ id: "local-checkpoint", name: "Local illustrative checkpoint", reason: "Matches rainy cinematic framing." }],
    loras: [{ id: "local-lora", name: "Rain atmosphere LoRA", weight: 0.6 }],
  },
  "parameter-plan": {
    storyId,
    defaults: { width: 1024, height: 768, steps: 28, cfg: 5.5, sampler: "dpmpp_2m", scheduler: "karras" },
    perShotOverrides: [{ shotId: "shot-2", cfg: 6 }],
  },
  "story-render-plan": {
    storyId,
    shots: sampleShots.map((shot) => ({
      shotId: shot.id,
      promptIntent: shot.promptIntent,
      sourceShotIds: shot.sourceShotIds,
    })),
  },
  "story-consistency-check": sampleConsistency,
  "generation-gate": {
    storyId,
    ready: false,
    reason: "Preview only. Story execution is intentionally out of scope for T19.",
  },
  "story-result-display": {
    storyId,
    status: "pending",
    previewReferences: [],
    finalReferences: [],
  },
};

function createPreviewWorkflow(): StoryWorkflowState {
  const workflow = createStoryWorkflowState({
    now: () => timestamp,
    storyId,
    workflowId: "story-planning-preview",
  });

  return {
    ...workflow,
    nodes: {
      ...workflow.nodes,
      ...Object.fromEntries(
        Object.entries(sampleResults).map(([nodeId, result]) => [
          nodeId,
          {
            nodeId,
            result,
            source: "ai",
            status: "done",
            updatedAt: timestamp,
          },
        ]),
      ),
    } as StoryWorkflowState["nodes"],
  };
}

function formatStatusLabel(status: string) {
  return status.replace(/-/g, " ");
}

export function StoryPlanningPreview() {
  const [workflow, setWorkflow] = useState(createPreviewWorkflow);
  const [selectedNodeId, setSelectedNodeId] = useState<PlanningNodeId>("storyboard-shots");
  const selectedNode = workflow.nodes[selectedNodeId];
  const metadata = storyWorkflowDefinition.metadata[selectedNodeId];
  const rawJson = useMemo(() => JSON.stringify(selectedNode.result ?? selectedNode.error ?? {}, null, 2), [selectedNode]);
  const selectedIndex = planningNodeIds.indexOf(selectedNodeId) + 1;
  const selectedDependencies = storyWorkflowDefinition.dependencyDag[selectedNodeId];

  function handleSave(nodeId: StoryWorkflowNodeId, result: unknown, scope: StoryManualEditScope) {
    setWorkflow((current) =>
      setStoryNodeManualResult(current, nodeId, result, {
        scope,
      }),
    );
  }

  return (
    <main className="flex h-screen min-h-screen flex-col overflow-hidden bg-slate-50 text-slate-950">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-600">
            <GitBranch className="size-4" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-slate-950">Story Graph planning</h1>
            <p className="truncate text-[11px] text-slate-500">Inactive planning preview / manual editors</p>
          </div>
        </div>

        <div className="hidden min-w-0 flex-1 justify-center px-4 xl:flex">
          <div className="grid h-8 w-96 max-w-full grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 text-xs text-slate-600">
            <CircleDot className="size-3.5 text-blue-600" />
            <span className="truncate text-right">story-graph</span>
            <span className="text-slate-300">/</span>
            <span className="truncate">{metadata.title}</span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Link className={headerLinkClassName} href="/">Run</Link>
          <Link className={headerLinkClassName} href="/settings">
            <Settings className="size-3.5" />
            Settings
          </Link>
        </div>
      </header>

      <div className="sf-agent-workbench flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        <aside className="sf-agent-workbench__nav custom-scrollbar touch-scroll-region order-2 min-h-0 overflow-y-auto border-b border-slate-200 bg-white p-3 lg:order-1 lg:w-72 lg:flex-[0_0_18rem] lg:border-b-0 lg:border-r">
          <div className="mb-3 flex items-center justify-between px-1">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Workflow</h2>
            <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-500">
              {planningNodeIds.length} steps
            </span>
          </div>
          <nav className="relative flex flex-col gap-1.5">
            <span aria-hidden="true" className="absolute bottom-4 left-4 top-4 w-px bg-slate-200" />
            {planningNodeIds.map((nodeId) => {
              const node = workflow.nodes[nodeId];
              const nodeMetadata = storyWorkflowDefinition.metadata[nodeId];
              const selected = selectedNodeId === nodeId;

              return (
                <button
                  className={cn(
                    "group relative flex w-full items-start gap-3 rounded-md border px-2 py-2 text-left transition-colors",
                    selected
                      ? "border-slate-300 bg-slate-50"
                      : "border-transparent bg-white hover:border-slate-200 hover:bg-slate-50",
                  )}
                  key={nodeId}
                  onClick={() => setSelectedNodeId(nodeId)}
                  type="button"
                >
                  <span
                    className={cn(
                      "relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold ring-4 ring-white",
                      node.status === "manual"
                        ? "border-violet-200 bg-violet-50 text-violet-700"
                        : node.status === "stale"
                          ? "border-amber-200 bg-amber-50 text-amber-700"
                          : "border-emerald-200 bg-emerald-50 text-emerald-700",
                    )}
                  >
                    {planningNodeIds.indexOf(nodeId) + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <GitBranch className="size-3.5 shrink-0 text-slate-400" />
                      <span className="truncate text-xs font-semibold text-slate-900">{nodeMetadata.title}</span>
                    </span>
                    <span className="mt-0.5 flex items-center justify-between gap-2">
                      <span className="truncate text-[11px] text-slate-500">{nodeMetadata.manualEdit.label}</span>
                      <span className="shrink-0 text-[10px] font-medium uppercase text-slate-400">
                        {formatStatusLabel(node.status)}
                      </span>
                    </span>
                  </span>
                </button>
              );
            })}
          </nav>
        </aside>

        <section className="sf-agent-workbench__workspace custom-scrollbar touch-scroll-region order-1 min-h-0 flex-1 overflow-y-auto bg-slate-50 p-4 lg:order-2">
          <div className="mx-auto flex max-w-5xl flex-col gap-4">
            <article className="flex min-h-[calc(100vh-6rem)] flex-col overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
              <header className="border-b border-slate-100 bg-white px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Step {selectedIndex} / {planningNodeIds.length}
                    </p>
                    <h2 className="mt-1 text-base font-semibold text-slate-950">{metadata.title}</h2>
                    <p className="mt-1 text-xs leading-relaxed text-slate-500">{metadata.manualEdit.label}</p>
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-600">
                    {selectedNode.status === "manual" ? <CheckCircle2 className="size-3.5 text-violet-500" /> : <CircleDot className="size-3.5" />}
                    {formatStatusLabel(selectedNode.status)}
                  </span>
                </div>
              </header>

              <div className="flex flex-1 flex-col gap-4 p-4">
                <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr] md:items-stretch">
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Input</p>
                    <p className="mt-2 text-xs leading-relaxed text-slate-700">
                      {selectedDependencies.length > 0 ? selectedDependencies.join(", ") : "Story request"}
                    </p>
                  </div>
                  <div className="hidden items-center justify-center text-slate-300 md:flex">/</div>
                  <div className="rounded-md border border-slate-200 bg-white p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Transform</p>
                    <p className="mt-2 text-xs leading-relaxed text-slate-700">Manual planning review and scoped edits</p>
                  </div>
                  <div className="hidden items-center justify-center text-slate-300 md:flex">/</div>
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Output</p>
                    <p className="mt-2 text-xs leading-relaxed text-slate-700">{metadata.workspace.key}</p>
                  </div>
                </div>

                <div className="flex min-h-[36rem] flex-1 flex-col rounded-md border border-slate-200 bg-white p-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Step output</p>
                    <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium uppercase text-slate-500">
                      Visual + Raw JSON
                    </span>
                  </div>
                  <StoryPlanningWorkspace
                    editable
                    emptyState="This story artifact has not been generated yet."
                    key={`${selectedNodeId}:${selectedNode.updatedAt}`}
                    node={selectedNode}
                    onSave={handleSave}
                    storyId={workflow.storyId}
                  />
                </div>
              </div>

              <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50 px-4 py-2 text-[11px] text-slate-500">
                <span>Source: {selectedNode.source}</span>
                <span>Workspace: {metadata.workspace.key}</span>
                <span>Updated: {selectedNode.updatedAt}</span>
              </footer>
            </article>
          </div>
        </section>

        <aside className="sf-agent-workbench__inspector custom-scrollbar touch-scroll-region order-3 min-h-0 overflow-y-auto border-t border-slate-200 bg-white p-3 lg:order-3 lg:w-80 lg:flex-[0_0_20rem] lg:border-l lg:border-t-0">
          <div className="flex flex-col gap-3">
            <section className="rounded-md border border-slate-200 bg-white">
              <header className="border-b border-slate-100 px-3 py-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Inspector</h2>
              </header>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 p-3 text-xs">
                <dt className="text-slate-500">Status</dt>
                <dd className="text-right font-medium text-slate-800">{formatStatusLabel(selectedNode.status)}</dd>
                <dt className="text-slate-500">Source</dt>
                <dd className="text-right font-medium text-slate-800">{selectedNode.source}</dd>
                <dt className="text-slate-500">Workflow</dt>
                <dd className="truncate text-right font-medium text-slate-800">{workflow.workflowId}</dd>
                <dt className="text-slate-500">Mode</dt>
                <dd className="text-right font-medium text-slate-800">{workflow.workflowMode}</dd>
              </dl>
            </section>

            <section className="rounded-md border border-slate-200 bg-white">
              <header className="border-b border-slate-100 px-3 py-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Raw JSON</h2>
              </header>
              <div className="p-3">
                <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-xs leading-relaxed text-slate-700">
                  {rawJson}
                </pre>
              </div>
            </section>

            <section className="rounded-md border border-slate-200 bg-white">
              <header className="border-b border-slate-100 px-3 py-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Manual scope</h2>
              </header>
              <div className="p-3 text-xs leading-relaxed text-slate-600">
                {selectedNode.manualEdit ? (
                  <>
                    <p>Scope: {selectedNode.manualEdit.scope.kind}</p>
                    {"shotId" in selectedNode.manualEdit.scope ? <p>Shot: {selectedNode.manualEdit.scope.shotId}</p> : null}
                    <p>Stale nodes: {selectedNode.manualEdit.staleNodeIds.join(", ") || "none"}</p>
                    <p>Stale shots: {selectedNode.manualEdit.staleShotIds.join(", ") || "none"}</p>
                  </>
                ) : (
                  "No manual edit has been saved for this node."
                )}
              </div>
            </section>

            <section className="rounded-md border border-slate-200 bg-white">
              <header className="border-b border-slate-100 px-3 py-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tool calls</h2>
              </header>
              <div className="p-3 text-xs leading-relaxed text-slate-500">
                Story planning preview is local and in-memory. It does not call LLM, ComfyUI, persistence, or old sequence APIs.
              </div>
            </section>
          </div>
        </aside>
      </div>
    </main>
  );
}
