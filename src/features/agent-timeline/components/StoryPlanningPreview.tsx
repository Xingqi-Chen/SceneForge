"use client";

import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { CheckCircle2, CircleDot, GitBranch, Play, RotateCcw, Settings } from "lucide-react";

import {
  startStoryGraphWorkflow,
  type StoryGraphStartRequest,
} from "@/features/agent-timeline/story-input";
import {
  setStoryNodeManualResult,
  type StoryManualEditScope,
  type StoryWorkflowState,
} from "@/features/agent-timeline/story-state";
import {
  storyWorkflowDefinition,
} from "@/features/agent-timeline/story-workflow";
import type {
  StoryAudienceRating,
  StoryWorkflowNodeId,
} from "@/features/agent-timeline/story-types";
import { cn } from "@/shared/utils/cn";

import { StoryPlanningWorkspace } from "./StoryPlanningWorkspace";

const headerLinkClassName =
  "inline-flex h-8 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-900 transition-colors hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400";

const planningNodeIds = storyWorkflowDefinition.nodeIds;

const fallbackRequest = {
  audienceRating: "safe",
  contentWarnings: ["night setting", "mild suspense"],
  rawIntent: "A traveler in a blue raincoat enters a rain-washed elevated station, notices a red signal reflected in a puddle, then turns toward a shadowed stairwell.",
  targetShotCount: 3,
  title: "Rain Station Signal",
  workflowId: "story-planning-fallback",
  storyId: "story-fallback",
} satisfies StoryGraphStartRequest;

function formatStatusLabel(status: string) {
  return status.replace(/-/g, " ");
}

function splitWarnings(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function createClientStartRequest({
  audienceRating,
  contentWarnings,
  nsfwRationale,
  rawIntent,
  targetShotCount,
  title,
}: {
  audienceRating: StoryAudienceRating;
  contentWarnings: string;
  nsfwRationale: string;
  rawIntent: string;
  targetShotCount: number;
  title: string;
}): StoryGraphStartRequest {
  const warnings = splitWarnings(contentWarnings);

  return {
    audienceRating,
    contentWarnings: warnings,
    nsfwEnabled: audienceRating === "explicit" || audienceRating === "mature" || nsfwRationale.trim().length > 0,
    nsfwRationale,
    rawIntent,
    targetShotCount,
    title,
    settingsSnapshot: {
      audienceRating,
      contentWarnings: warnings,
      nsfwEnabled: audienceRating === "explicit" || audienceRating === "mature" || nsfwRationale.trim().length > 0,
      targetShotCount,
    } as StoryGraphStartRequest["settingsSnapshot"],
  };
}

function StartPanel({
  onStart,
}: {
  onStart: (request: StoryGraphStartRequest) => void;
}) {
  const [rawIntent, setRawIntent] = useState("");
  const [title, setTitle] = useState("");
  const [targetShotCount, setTargetShotCount] = useState(3);
  const [audienceRating, setAudienceRating] = useState<StoryAudienceRating>("safe");
  const [contentWarnings, setContentWarnings] = useState("");
  const [nsfwRationale, setNsfwRationale] = useState("");
  const [error, setError] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!rawIntent.trim()) {
      setError("Story request is required.");
      return;
    }

    setError("");
    onStart(
      createClientStartRequest({
        audienceRating,
        contentWarnings,
        nsfwRationale,
        rawIntent,
        targetShotCount,
        title,
      }),
    );
  }

  return (
    <section className="mx-auto flex min-h-[calc(100vh-8rem)] w-full max-w-4xl items-center px-4 py-8">
      <form className="grid w-full gap-4 rounded-md border border-slate-200 bg-white p-4 shadow-sm" onSubmit={handleSubmit}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Start Story Graph</h2>
            <p className="mt-1 text-xs text-slate-500">Create an inspectable in-memory story planning workflow.</p>
          </div>
          <button
            className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100"
            onClick={() => onStart(fallbackRequest)}
            type="button"
          >
            <RotateCcw className="size-3.5" />
            Load fallback
          </button>
        </div>

        <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
          Story request
          <textarea
            className="min-h-36 rounded-md border border-slate-200 px-3 py-2 text-sm leading-relaxed outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            onChange={(event) => setRawIntent(event.target.value)}
            placeholder="A short comic scene, storyboard sequence, or visual story beat..."
            value={rawIntent}
          />
        </label>

        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_8rem_12rem]">
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
            Title
            <input
              className="h-9 rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              onChange={(event) => setTitle(event.target.value)}
              value={title}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
            Shots
            <input
              className="h-9 rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              min={1}
              max={24}
              onChange={(event) => setTargetShotCount(Number(event.target.value) || 1)}
              type="number"
              value={targetShotCount}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
            Audience rating
            <select
              className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              onChange={(event) => setAudienceRating(event.target.value as StoryAudienceRating)}
              value={audienceRating}
            >
              <option value="safe">Safe</option>
              <option value="suggestive">Suggestive</option>
              <option value="mature">Mature</option>
              <option value="explicit">Explicit</option>
            </select>
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
            Content warnings
            <input
              className="h-9 rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              onChange={(event) => setContentWarnings(event.target.value)}
              placeholder="comma-separated"
              value={contentWarnings}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
            NSFW context
            <input
              className="h-9 rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              onChange={(event) => setNsfwRationale(event.target.value)}
              placeholder="optional rationale"
              value={nsfwRationale}
            />
          </label>
        </div>

        {error ? <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{error}</div> : null}

        <div className="flex justify-end">
          <button
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-slate-950 px-4 text-xs font-semibold text-white transition-colors hover:bg-slate-800"
            type="submit"
          >
            <Play className="size-3.5" />
            Start planning
          </button>
        </div>
      </form>
    </section>
  );
}

export function StoryPlanningPreview() {
  const [workflow, setWorkflow] = useState<StoryWorkflowState | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<StoryWorkflowNodeId>("story-input");
  const selectedNode = workflow?.nodes[selectedNodeId];
  const metadata = storyWorkflowDefinition.metadata[selectedNodeId];
  const rawJson = useMemo(
    () => JSON.stringify(selectedNode?.result ?? selectedNode?.error ?? {}, null, 2),
    [selectedNode],
  );
  const selectedIndex = planningNodeIds.indexOf(selectedNodeId) + 1;
  const selectedDependencies = storyWorkflowDefinition.dependencyDag[selectedNodeId];

  function handleStart(request: StoryGraphStartRequest) {
    const started = startStoryGraphWorkflow(request);
    setWorkflow(started);
    setSelectedNodeId("story-input");
  }

  function handleSave(nodeId: StoryWorkflowNodeId, result: unknown, scope: StoryManualEditScope) {
    setWorkflow((current) =>
      current
        ? setStoryNodeManualResult(current, nodeId, result, {
            scope,
          })
        : current,
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
            <p className="truncate text-[11px] text-slate-500">
              {workflow ? "User-started planning workflow" : "Story input / start workflow"}
            </p>
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
          {workflow ? (
            <button className={headerLinkClassName} onClick={() => setWorkflow(null)} type="button">
              <RotateCcw className="size-3.5" />
              New
            </button>
          ) : null}
          <Link className={headerLinkClassName} href="/">Run</Link>
          <Link className={headerLinkClassName} href="/settings">
            <Settings className="size-3.5" />
            Settings
          </Link>
        </div>
      </header>

      {!workflow || !selectedNode ? (
        <StartPanel onStart={handleStart} />
      ) : (
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
                    data-node-id={nodeId}
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
                            : node.status === "blocked"
                              ? "border-slate-200 bg-slate-50 text-slate-500"
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
                      <p className="mt-2 text-xs leading-relaxed text-slate-700">Story Graph planning action</p>
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
                  Story planning is local and in-memory. It does not call LLM, ComfyUI, persistence, or old sequence APIs.
                </div>
              </section>
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}
