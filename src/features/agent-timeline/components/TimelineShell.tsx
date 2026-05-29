"use client";

import { type FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Bot,
  Braces,
  CheckCircle2,
  CircleDot,
  Database,
  ImageIcon,
  LayoutDashboard,
  LockKeyhole,
  PencilLine,
  Play,
  RefreshCw,
  Settings,
  SlidersHorizontal,
  Tags,
  Terminal,
  Workflow,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getTimelineNodeDependencies } from "@/features/agent-timeline/dag";
import { createTimelineWorkflowState, setTimelineNodeManualResult } from "@/features/agent-timeline/state";
import {
  timelineNodeIds,
  type SceneInputTimelineResult,
  type TimelineNodeId,
  type TimelineNodeStatus,
  type TimelineWorkflowState,
} from "@/features/agent-timeline/types";
import { cn } from "@/shared/utils/cn";

import { TimelineNodeStatus as TimelineStatusChip } from "./TimelineNodeStatus";
import { getTimelineNodeOutputText, timelineNodeContent } from "./timeline-node-content";

type DraftMap = Partial<Record<TimelineNodeId, string>>;
type NoticeMap = Partial<Record<TimelineNodeId, string>>;

type StepDisplay = {
  agent: string;
  artifact: string;
  icon: LucideIcon;
  transform: string;
};

const stepDisplay: Record<TimelineNodeId, StepDisplay> = {
  "scene-input": {
    agent: "Intake agent",
    artifact: "Scene intent",
    icon: Terminal,
    transform: "Capture natural-language intent",
  },
  "scene-prompt": {
    agent: "Prompt agent",
    artifact: "Positive / negative prompt draft",
    icon: Bot,
    transform: "Expand scene intent into generation language",
  },
  "character-tags": {
    agent: "Tag agent",
    artifact: "Character and body-part tags",
    icon: Tags,
    transform: "Extract entities, clothing, expression, and body details",
  },
  "character-action": {
    agent: "Pose agent",
    artifact: "Action and pose plan",
    icon: Zap,
    transform: "Infer action, motion, and pose targets",
  },
  "canvas-binding": {
    agent: "Layout agent",
    artifact: "3D layout binding",
    icon: LayoutDashboard,
    transform: "Map prompt entities into editable scene structure",
  },
  "resource-recommendation": {
    agent: "Resource agent",
    artifact: "Checkpoint and LoRA plan",
    icon: Database,
    transform: "Select available local resources",
  },
  "parameter-recommendation": {
    agent: "Render agent",
    artifact: "Render prompt and parameters",
    icon: SlidersHorizontal,
    transform: "Assemble render-ready request details",
  },
  "generation-gate": {
    agent: "Review agent",
    artifact: "Generation approval packet",
    icon: CheckCircle2,
    transform: "Hold final request for explicit user confirmation",
  },
  "comfyui-execution": {
    agent: "ComfyUI agent",
    artifact: "Queue metadata",
    icon: Braces,
    transform: "Reserved execution handoff",
  },
  "result-display": {
    agent: "Artifact agent",
    artifact: "Generated image result",
    icon: ImageIcon,
    transform: "Reserved artifact display",
  },
};

const settingsLinkClassName =
  "inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400";

function createManualResult(nodeId: TimelineNodeId, value: string) {
  if (nodeId === "scene-input") {
    return {
      rawIntent: value,
    } satisfies SceneInputTimelineResult;
  }

  return {
    shellContent: value,
  };
}

function getCompactStatusLabel(status: TimelineNodeStatus) {
  if (status === "done" || status === "manual") {
    return "Done";
  }

  if (status === "ready") {
    return "Ready";
  }

  if (status === "running") {
    return "Running";
  }

  if (status === "blocked" || status === "error") {
    return "Blocked";
  }

  return "Pending";
}

function getStepTone(status: TimelineNodeStatus) {
  if (status === "done" || status === "manual") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  if (status === "ready") {
    return "border-blue-200 bg-blue-50 text-blue-700";
  }

  if (status === "running") {
    return "border-indigo-200 bg-indigo-50 text-indigo-700";
  }

  if (status === "stale") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }

  if (status === "error") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }

  return "border-slate-200 bg-white text-slate-500";
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function buildDependencyText(nodeId: TimelineNodeId) {
  const dependencies = getTimelineNodeDependencies(nodeId);

  if (dependencies.length === 0) {
    return "User command";
  }

  return dependencies.map((dependencyId) => timelineNodeContent[dependencyId].title).join(", ");
}

export function TimelineShell() {
  const [sceneRequest, setSceneRequest] = useState("");
  const [workflow, setWorkflow] = useState<TimelineWorkflowState | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<TimelineNodeId>("scene-input");
  const [editingNodeId, setEditingNodeId] = useState<TimelineNodeId | null>(null);
  const [drafts, setDrafts] = useState<DraftMap>({});
  const [notices, setNotices] = useState<NoticeMap>({});

  const previewWorkflow = useMemo(() => createTimelineWorkflowState({ workflowId: "draft-workflow" }), []);
  const activeWorkflow = workflow ?? previewWorkflow;
  const selectedNode = activeWorkflow.nodes[selectedNodeId];
  const selectedContent = timelineNodeContent[selectedNodeId];
  const selectedDisplay = stepDisplay[selectedNodeId];
  const SelectedIcon = selectedDisplay.icon;
  const selectedOutput = getTimelineNodeOutputText(selectedNode);
  const sceneRequestIsUsable = sceneRequest.trim().length > 0;
  const selectedNodeAiDisabled =
    selectedContent.reserved || selectedNode.status === "blocked" || selectedNode.status === "running";
  const workflowTitle = workflow ? sceneRequest : "Untitled workflow";
  const workflowMode = workflow ? "Run shell" : "Draft setup";

  function startWorkflow() {
    const trimmedSceneRequest = sceneRequest.trim();

    if (!trimmedSceneRequest) {
      return;
    }

    setWorkflow(createTimelineWorkflowState({ sceneRequest: trimmedSceneRequest }));
    setSceneRequest(trimmedSceneRequest);
    setSelectedNodeId("scene-input");
    setEditingNodeId(null);
    setDrafts({});
    setNotices({});
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startWorkflow();
  }

  function handleStartEdit(nodeId: TimelineNodeId) {
    if (!workflow) {
      return;
    }

    setSelectedNodeId(nodeId);
    setEditingNodeId(nodeId);
    setDrafts((current) => ({
      ...current,
      [nodeId]: current[nodeId] ?? getTimelineNodeOutputText(workflow.nodes[nodeId]),
    }));
  }

  function handleCancelEdit() {
    if (workflow && editingNodeId) {
      setDrafts((current) => ({
        ...current,
        [editingNodeId]: getTimelineNodeOutputText(workflow.nodes[editingNodeId]),
      }));
    }

    setEditingNodeId(null);
  }

  function handleDraftChange(nodeId: TimelineNodeId, value: string) {
    setDrafts((current) => ({
      ...current,
      [nodeId]: value,
    }));
  }

  function handleSaveEdit(nodeId: TimelineNodeId) {
    if (!workflow) {
      return;
    }

    const draft = drafts[nodeId]?.trim() ?? "";

    if (!draft) {
      return;
    }

    setWorkflow(setTimelineNodeManualResult(workflow, nodeId, createManualResult(nodeId, draft)));
    setEditingNodeId(null);
    setDrafts((current) => ({
      ...current,
      [nodeId]: draft,
    }));

    if (nodeId === "scene-input") {
      setSceneRequest(draft);
    }
  }

  function handleRequestAi(nodeId: TimelineNodeId) {
    setSelectedNodeId(nodeId);
    setNotices((current) => ({
      ...current,
      [nodeId]: "AI suggestion is reserved for a later timeline node.",
    }));
  }

  function handleNewScene() {
    setWorkflow(null);
    setSceneRequest("");
    setSelectedNodeId("scene-input");
    setEditingNodeId(null);
    setDrafts({});
    setNotices({});
  }

  function selectNode(nodeId: TimelineNodeId) {
    setSelectedNodeId(nodeId);
    setEditingNodeId(null);
  }

  return (
    <main className="sf-app-shell flex min-h-0 flex-col overflow-hidden bg-slate-100 font-sans text-slate-950 selection:bg-blue-100 selection:text-blue-900">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-700">
            <Workflow className="size-4" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-bold text-slate-900">SceneForge</h1>
            <p className="truncate text-[11px] text-slate-500">{workflowTitle}</p>
          </div>
        </div>

        <div className="hidden min-w-0 flex-1 justify-center px-4 md:flex">
          <div className="flex min-w-0 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600">
            <CircleDot className="size-3.5 text-blue-600" />
            <span className="truncate">{workflowMode}</span>
            <span className="text-slate-300">/</span>
            <span className="truncate">{selectedContent.title}</span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button className="h-9 px-3 text-xs shadow-none" onClick={handleNewScene} type="button" variant="secondary">
            New scene
          </Button>
          <Button
            className="h-9 px-3 text-xs shadow-none"
            disabled={workflow ? selectedNodeAiDisabled : !sceneRequestIsUsable}
            onClick={workflow ? () => handleRequestAi(selectedNodeId) : startWorkflow}
            type="button"
          >
            <Play className="size-3.5" />
            Run
          </Button>
          <Link aria-label="Open settings" className={settingsLinkClassName} href="/settings" title="Open settings">
            <Settings className="size-3.5" />
            Settings
          </Link>
        </div>
      </header>

      <div className="sf-agent-workbench">
        <aside className="sf-agent-workbench__nav custom-scrollbar touch-scroll-region overflow-y-auto bg-white p-3">
          <div className="mb-3 flex items-center justify-between px-1">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Workflow</h2>
            <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-500">
              {timelineNodeIds.length} steps
            </span>
          </div>

          <div className="relative flex flex-col gap-1.5">
            <span aria-hidden="true" className="absolute bottom-4 left-4 top-4 w-px bg-slate-200" />
            {timelineNodeIds.map((nodeId, index) => {
              const node = activeWorkflow.nodes[nodeId];
              const content = timelineNodeContent[nodeId];
              const display = stepDisplay[nodeId];
              const StepIcon = display.icon;
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
                  onClick={() => selectNode(nodeId)}
                  type="button"
                >
                  <span
                    className={cn(
                      "relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold ring-4 ring-white",
                      getStepTone(node.status),
                    )}
                  >
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <StepIcon className="size-3.5 shrink-0 text-slate-400" />
                      <span className="truncate text-xs font-semibold text-slate-900">{content.title}</span>
                    </span>
                    <span className="mt-0.5 flex items-center justify-between gap-2">
                      <span className="truncate text-[11px] text-slate-500">{content.shellState}</span>
                      <span className="shrink-0 text-[10px] font-medium uppercase text-slate-400">
                        {getCompactStatusLabel(node.status)}
                      </span>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="sf-agent-workbench__main custom-scrollbar touch-scroll-region overflow-y-auto bg-slate-100 p-4">
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
            <article className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
              <header className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-blue-100 bg-blue-50 text-blue-700">
                    <SelectedIcon className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-bold text-slate-900">{selectedContent.title}</h2>
                      {selectedContent.reserved ? (
                        <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold uppercase text-slate-500">
                          Reserved
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{selectedContent.shellState}</p>
                  </div>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <TimelineStatusChip status={selectedNode.status} />
                  <Button
                    className="h-8 px-2.5 text-xs shadow-none"
                    disabled={!workflow || selectedNodeAiDisabled}
                    onClick={() => handleRequestAi(selectedNodeId)}
                    type="button"
                    variant="secondary"
                  >
                    <RefreshCw className="size-3.5" />
                    Regenerate
                  </Button>
                </div>
              </header>

              <div className="flex flex-col gap-4 p-4">
                {selectedNodeId === "scene-input" ? (
                  <form className="rounded-md border border-slate-200 bg-slate-50" id="scene-composer-form" onSubmit={handleSubmit}>
                    <div className="border-b border-slate-200 px-3 py-2">
                      <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500" htmlFor="scene-request">
                        Command composer
                      </label>
                    </div>
                    <textarea
                      className="min-h-28 w-full resize-none border-0 bg-white px-3 py-3 text-sm leading-relaxed text-slate-900 outline-none placeholder:text-slate-400"
                      id="scene-request"
                      onChange={(event) => setSceneRequest(event.target.value)}
                      placeholder="Describe the scene, characters, mood, camera, and constraints..."
                      value={sceneRequest}
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-3 py-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Button
                          className="h-7 px-2 text-[11px] shadow-none"
                          disabled={!workflow}
                          onClick={() => handleRequestAi("scene-input")}
                          type="button"
                          variant="secondary"
                        >
                          Rewrite
                        </Button>
                        <Button
                          className="h-7 px-2 text-[11px] shadow-none"
                          disabled={!workflow}
                          onClick={() => handleRequestAi("scene-input")}
                          type="button"
                          variant="secondary"
                        >
                          Suggest
                        </Button>
                        <Button className="h-7 px-2 text-[11px] shadow-none" disabled type="button" variant="secondary">
                          <LockKeyhole className="size-3" />
                          Lock
                        </Button>
                      </div>
                      <Button className="h-8 px-3 text-xs shadow-none" disabled={!sceneRequestIsUsable} type="submit">
                        <Play className="size-3.5" />
                        Start workflow
                      </Button>
                    </div>
                  </form>
                ) : null}

                <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr] md:items-stretch">
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Input</p>
                    <p className="mt-2 text-xs leading-relaxed text-slate-700">{buildDependencyText(selectedNodeId)}</p>
                  </div>
                  <div className="hidden items-center justify-center text-slate-300 md:flex">
                    <ArrowRight className="size-4" />
                  </div>
                  <div className="rounded-md border border-slate-200 bg-white p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Transform</p>
                    <p className="mt-2 text-xs leading-relaxed text-slate-700">{selectedDisplay.transform}</p>
                  </div>
                  <div className="hidden items-center justify-center text-slate-300 md:flex">
                    <ArrowRight className="size-4" />
                  </div>
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Output</p>
                    <p className="mt-2 text-xs leading-relaxed text-slate-700">{selectedDisplay.artifact}</p>
                  </div>
                </div>

                {selectedNodeId === "generation-gate" ? (
                  <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
                    <LockKeyhole className="mt-0.5 size-4 shrink-0" />
                    <p>
                      ComfyUI execution requires explicit future confirmation. This shell stops at the gate and never
                      starts generation.
                    </p>
                  </div>
                ) : null}

                {notices[selectedNodeId] ? (
                  <div className="flex gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-xs leading-relaxed text-blue-700">
                    <Bot className="mt-0.5 size-4 shrink-0" />
                    <p>{notices[selectedNodeId]}</p>
                  </div>
                ) : null}

                <div className="rounded-md border border-slate-200 bg-white p-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Step output</p>
                    <div className="flex items-center gap-1.5">
                      <Button
                        className="h-7 px-2 text-[11px] shadow-none"
                        disabled={!workflow || selectedContent.reserved}
                        onClick={() => handleStartEdit(selectedNodeId)}
                        type="button"
                        variant="secondary"
                      >
                        <PencilLine className="size-3" />
                        Edit
                      </Button>
                    </div>
                  </div>

                  {editingNodeId === selectedNodeId ? (
                    <div className="flex flex-col gap-2">
                      <textarea
                        className="min-h-28 w-full resize-y rounded-md border border-slate-200 bg-white p-3 font-mono text-xs leading-relaxed text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                        onChange={(event) => handleDraftChange(selectedNodeId, event.target.value)}
                        value={drafts[selectedNodeId] ?? ""}
                      />
                      <div className="flex justify-end gap-2">
                        <Button
                          className="h-8 px-2.5 text-xs shadow-none"
                          onClick={handleCancelEdit}
                          type="button"
                          variant="secondary"
                        >
                          Cancel
                        </Button>
                        <Button
                          className="h-8 px-2.5 text-xs shadow-none"
                          disabled={!(drafts[selectedNodeId] ?? "").trim()}
                          onClick={() => handleSaveEdit(selectedNodeId)}
                          type="button"
                        >
                          Save manual
                        </Button>
                      </div>
                    </div>
                  ) : selectedOutput ? (
                    <pre className="whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-xs leading-relaxed text-slate-700">
                      {selectedOutput}
                    </pre>
                  ) : (
                    <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-500">
                      {selectedContent.emptyState}
                    </div>
                  )}
                </div>
              </div>

              <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50 px-4 py-2 text-[11px] text-slate-500">
                <span>Source: {selectedNode.source}</span>
                <span>Agent: {selectedDisplay.agent}</span>
                <span>Updated: {formatTime(selectedNode.updatedAt)}</span>
              </footer>
            </article>
          </div>
        </section>

        <aside className="sf-agent-workbench__inspector custom-scrollbar touch-scroll-region overflow-y-auto bg-white p-3">
          <div className="flex flex-col gap-3">
            <section className="rounded-md border border-slate-200 bg-white">
              <header className="border-b border-slate-100 px-3 py-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Inspector</h2>
              </header>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 p-3 text-xs">
                <dt className="text-slate-500">Status</dt>
                <dd className="text-right font-medium text-slate-800">{getCompactStatusLabel(selectedNode.status)}</dd>
                <dt className="text-slate-500">Source</dt>
                <dd className="text-right font-medium text-slate-800">{selectedNode.source}</dd>
                <dt className="text-slate-500">Workflow</dt>
                <dd className="truncate text-right font-medium text-slate-800">{activeWorkflow.workflowId}</dd>
                <dt className="text-slate-500">Tokens</dt>
                <dd className="text-right font-medium text-slate-800">Reserved</dd>
              </dl>
            </section>

            <section className="rounded-md border border-slate-200 bg-white">
              <header className="border-b border-slate-100 px-3 py-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Agent activity</h2>
              </header>
              <div className="flex flex-col gap-2 p-3 text-xs">
                <div className="flex gap-2">
                  <span className={cn("mt-1 size-2 shrink-0 rounded-full", workflow ? "bg-emerald-500" : "bg-slate-300")} />
                  <p className="leading-relaxed text-slate-600">
                    {workflow ? "Scene command captured and graph state initialized." : "Waiting for scene command."}
                  </p>
                </div>
                <div className="flex gap-2">
                  <span className={cn("mt-1 size-2 shrink-0 rounded-full", selectedNode.status === "ready" ? "bg-blue-500" : "bg-slate-300")} />
                  <p className="leading-relaxed text-slate-600">
                    {selectedContent.title} is {getCompactStatusLabel(selectedNode.status).toLowerCase()}.
                  </p>
                </div>
                <div className="flex gap-2">
                  <span className="mt-1 size-2 shrink-0 rounded-full bg-slate-300" />
                  <p className="leading-relaxed text-slate-600">Tool calls are reserved for later graph adapters.</p>
                </div>
              </div>
            </section>

            <section className="rounded-md border border-slate-200 bg-white">
              <header className="border-b border-slate-100 px-3 py-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tool calls</h2>
              </header>
              <div className="p-3 text-xs leading-relaxed text-slate-500">
                No external tools have been called by this shell.
              </div>
            </section>

            <section className="rounded-md border border-slate-200 bg-white">
              <header className="border-b border-slate-100 px-3 py-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Generated artifacts</h2>
              </header>
              <div className="p-3">
                <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-500">
                  Artifact preview will appear after confirmed render execution.
                </div>
              </div>
            </section>
          </div>
        </aside>
      </div>
    </main>
  );
}
