"use client";

import { type FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Play, Settings } from "lucide-react";

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
  "inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400";

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
      <main className="sf-app-shell flex min-h-0 flex-col overflow-hidden bg-slate-50 p-4 font-sans text-slate-950 selection:bg-blue-100 selection:text-blue-900">
        <div className="flex shrink-0 justify-end">
          <Link aria-label="Open settings" className={settingsLinkClassName} href="/settings" title="Open settings">
            <Settings className="size-4" />
            Settings
          </Link>
        </div>

        <form className="flex min-h-0 flex-1 items-center justify-center" onSubmit={handleSubmit}>
          <div className="grid w-full max-w-3xl gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <label className="sr-only" htmlFor="scene-request">
              Scene request
            </label>
            <textarea
              className="min-h-32 w-full resize-y rounded-md border border-slate-200 bg-white p-4 text-sm leading-relaxed text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              id="scene-request"
              onChange={(event) => setSceneRequest(event.target.value)}
              placeholder="Describe the scene request..."
              value={sceneRequest}
            />
            <Button
              className={cn("h-11 px-4 shadow-sm sm:h-12", !sceneRequestIsUsable && "bg-slate-400")}
              disabled={!sceneRequestIsUsable}
              type="submit"
            >
              <Play className="size-4" />
              Start
            </Button>
          </div>
        </form>
      </main>
    );
  }

  return (
    <main className="sf-app-shell flex min-h-0 flex-col overflow-hidden bg-slate-50 font-sans text-slate-950 selection:bg-blue-100 selection:text-blue-900">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-bold text-slate-900">SceneForge timeline</h1>
          <p className="mt-0.5 truncate text-xs text-slate-500">{sceneRequest}</p>
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

      <div className="custom-scrollbar touch-scroll-region min-h-0 flex-1 overflow-y-auto px-4 py-5">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
          <div className="flex flex-col gap-6">
            {timelineNodes.map((node, index) => (
              <TimelineNodeCard
                draft={drafts[node.nodeId] ?? ""}
                index={index}
                isEditing={editingNodeId === node.nodeId}
                isLast={index === timelineNodes.length - 1}
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
