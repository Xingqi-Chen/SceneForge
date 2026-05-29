"use client";

import { type FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Play, Settings, Workflow } from "lucide-react";

import { Button } from "@/components/ui/button";
import { createTimelineWorkflowState, setTimelineNodeManualResult } from "@/features/agent-timeline/state";
import {
  timelineNodeIds,
  type SceneInputTimelineResult,
  type TimelineNodeId,
  type TimelineWorkflowState,
} from "@/features/agent-timeline/types";
import { cn } from "@/shared/utils/cn";

import { TimelineNodeCard } from "./TimelineNodeCard";
import { getTimelineNodeOutputText } from "./timeline-node-content";

type DraftMap = Partial<Record<TimelineNodeId, string>>;
type NoticeMap = Partial<Record<TimelineNodeId, string>>;

const settingsLinkClassName =
  "inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400";

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

export function TimelineShell() {
  const [sceneRequest, setSceneRequest] = useState("");
  const [workflow, setWorkflow] = useState<TimelineWorkflowState | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<TimelineNodeId | null>(null);
  const [drafts, setDrafts] = useState<DraftMap>({});
  const [notices, setNotices] = useState<NoticeMap>({});

  const sceneRequestIsUsable = sceneRequest.trim().length > 0;
  const timelineNodes = useMemo(
    () => (workflow ? timelineNodeIds.map((nodeId) => workflow.nodes[nodeId]) : []),
    [workflow],
  );

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedSceneRequest = sceneRequest.trim();

    if (!trimmedSceneRequest) {
      return;
    }

    setWorkflow(createTimelineWorkflowState({ sceneRequest: trimmedSceneRequest }));
    setSceneRequest(trimmedSceneRequest);
    setEditingNodeId(null);
    setDrafts({});
    setNotices({});
  }

  function handleStartEdit(nodeId: TimelineNodeId) {
    if (!workflow) {
      return;
    }

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
    setNotices((current) => ({
      ...current,
      [nodeId]: "AI suggestion is reserved for a later timeline node.",
    }));
  }

  function handleNewScene() {
    setWorkflow(null);
    setSceneRequest("");
    setEditingNodeId(null);
    setDrafts({});
    setNotices({});
  }

  if (!workflow) {
    return (
      <main className="sf-app-shell flex min-h-0 flex-col overflow-hidden bg-slate-100 font-sans text-slate-950 selection:bg-blue-100 selection:text-blue-900">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 py-3 shadow-sm">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-700">
              <Workflow className="size-4" />
            </div>
            <h1 className="truncate text-sm font-bold text-slate-900">SceneForge timeline</h1>
          </div>
          <Link aria-label="Open settings" className={settingsLinkClassName} href="/settings" title="Open settings">
            <Settings className="size-4" />
            Settings
          </Link>
        </header>

        <form className="flex min-h-0 flex-1 items-center justify-center p-4 sm:p-6" onSubmit={handleSubmit}>
          <div className="w-full max-w-4xl overflow-hidden rounded-md border border-slate-200 bg-white shadow-xl shadow-slate-200/70">
            <div className="border-b border-slate-100 bg-slate-50 px-4 py-3 sm:px-5">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="scene-request">
                Scene request
              </label>
            </div>
            <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-end sm:p-5">
              <textarea
                className="min-h-40 w-full resize-y rounded-md border border-slate-200 bg-white p-4 text-sm leading-relaxed text-slate-900 shadow-inner shadow-slate-100 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 sm:flex-1"
                id="scene-request"
                onChange={(event) => setSceneRequest(event.target.value)}
                placeholder="Describe the scene request..."
                value={sceneRequest}
              />
              <Button
                className={cn(
                  "h-11 w-full px-4 shadow-sm sm:h-12 sm:w-auto sm:min-w-28",
                  !sceneRequestIsUsable && "bg-slate-400",
                )}
                disabled={!sceneRequestIsUsable}
                type="submit"
              >
                <Play className="size-4" />
                Start
              </Button>
            </div>
          </div>
        </form>
      </main>
    );
  }

  return (
    <main className="sf-app-shell flex min-h-0 flex-col overflow-hidden bg-slate-100 font-sans text-slate-950 selection:bg-blue-100 selection:text-blue-900">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 py-3 shadow-sm">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-700">
            <Workflow className="size-4" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-bold text-slate-900">SceneForge timeline</h1>
            <p className="mt-0.5 truncate text-xs text-slate-500">{sceneRequest}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button className="h-9 px-3 text-xs shadow-none" onClick={handleNewScene} type="button" variant="secondary">
            <ArrowLeft className="size-3.5" />
            New scene
          </Button>
          <Link aria-label="Open settings" className={settingsLinkClassName} href="/settings" title="Open settings">
            <Settings className="size-4" />
            Settings
          </Link>
        </div>
      </header>

      <div className="custom-scrollbar touch-scroll-region min-h-0 flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto w-full max-w-5xl">
          <div className="relative flex flex-col gap-5">
            <span
              aria-hidden="true"
              className="absolute bottom-4 left-5 top-4 w-px bg-slate-300 shadow-[0_0_0_1px_rgba(255,255,255,0.8)] sm:left-6"
            />
            {timelineNodes.map((node, index) => (
              <TimelineNodeCard
                draft={drafts[node.nodeId] ?? ""}
                index={index}
                isEditing={editingNodeId === node.nodeId}
                key={node.nodeId}
                node={node}
                onCancelEdit={handleCancelEdit}
                onDraftChange={handleDraftChange}
                onRequestAi={handleRequestAi}
                onSaveEdit={handleSaveEdit}
                onStartEdit={handleStartEdit}
                shellNotice={notices[node.nodeId]}
              />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
