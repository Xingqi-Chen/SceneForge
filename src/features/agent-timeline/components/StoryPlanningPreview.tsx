"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { Bot, CheckCircle2, CircleDot, GitBranch, ImageIcon, LoaderCircle, Play, RefreshCw, RotateCcw, Settings } from "lucide-react";

import {
  createStoryGraphInputWorkflow,
  type StoryGraphStartRequest,
} from "@/features/agent-timeline/story-input";
import type { StoryResultDisplay } from "@/features/agent-timeline/story-api";
import type { StoryShotGraphExecutionState } from "@/features/agent-timeline/story-execution";
import type { StoryLocalResource } from "@/features/agent-timeline/story-planning";
import {
  setStoryNodeManualResult,
  type StoryManualEditScope,
  type StoryWorkflowState,
} from "@/features/agent-timeline/story-state";
import {
  storyWorkflowDefinition,
} from "@/features/agent-timeline/story-workflow";
import type {
  StoryWorkflowNodeId,
} from "@/features/agent-timeline/story-types";
import {
  getLlmProxyErrorMessage,
  isLlmChatResponse,
  type LlmChatRequest,
} from "@/features/llm";
import type { CivitaiResourceListItem } from "@/features/civitai-lora-library";
import {
  getCivitaiModelStorageKind,
  makeCivitaiResourceTargetFileName,
} from "@/features/civitai-lora-library/resource-files";
import {
  defaultPromptProfileId,
  formatPromptProfileLabel,
  normalizePromptProfileId,
  promptProfileIds,
  type PromptProfileId,
} from "@/shared/prompt-profile";
import { cn } from "@/shared/utils/cn";

import { StoryPlanningWorkspace } from "./StoryPlanningWorkspace";

const headerLinkClassName =
  "inline-flex h-8 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-900 transition-colors hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400";

const planningNodeIds = storyWorkflowDefinition.nodeIds;

type StoryInputAiAction = "rewrite" | "suggest";

const fallbackRequest = {
  rawIntent: "A traveler in a blue raincoat enters a rain-washed elevated station, notices a red signal reflected in a puddle, then turns toward a shadowed stairwell.",
  targetShotCount: 3,
  workflowId: "story-planning-fallback",
  storyId: "story-fallback",
  nsfwEnabled: false,
  settingsSnapshot: {
    promptProfile: defaultPromptProfileId,
  },
} satisfies StoryGraphStartRequest;

function formatStatusLabel(status: string) {
  return status.replace(/-/g, " ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseStoryInputAiText(content: string) {
  const trimmed = content.trim();

  if (!trimmed) {
    return "";
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;

    if (isRecord(parsed)) {
      const storyRequest = parsed.storyRequest ?? parsed.sceneRequest ?? parsed.request;
      return typeof storyRequest === "string" ? storyRequest.trim() : "";
    }
  } catch {
    return trimmed;
  }

  return "";
}

function buildStoryInputAiRequest({
  action,
  nsfwEnabled,
  storyRequest,
}: {
  action: StoryInputAiAction;
  nsfwEnabled: boolean;
  storyRequest: string;
}): LlmChatRequest {
  const actionInstruction = action === "rewrite"
    ? [
        "Rewrite the provided story request into a clearer storyboard-generation command.",
        "Preserve the user's premise, characters, setting, mood, sequence intent, and constraints.",
        "Do not add title, content warning, model, LoRA, checkpoint, or render-parameter instructions.",
      ]
    : [
        storyRequest
          ? "Suggest one stronger alternate Story Graph request inspired by the current draft."
          : "Suggest one concise, visually rich Story Graph request for a short storyboard sequence.",
        "Make it specific enough to start story planning while leaving shot count optional.",
        "Do not include title, content warnings, model names, checkpoint names, LoRA names, or render parameters.",
      ];

  return {
    purpose: "comic-sequence-storyboard",
    nsfw: nsfwEnabled,
    messages: [
      {
        role: "system",
        content: [
          "You are SceneForge's Story Graph input agent.",
          "Return only valid JSON. No markdown, comments, or prose.",
          "All natural-language fields must be English.",
          "Keep the result as a story planning request, not a single-image prompt.",
          `NSFW setting: ${nsfwEnabled ? "enabled / explicit audience" : "disabled / safe audience"}.`,
          ...actionInstruction,
          'Required shape: {"storyRequest":"..."}',
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            action,
            currentStoryRequest: storyRequest,
            nsfwEnabled,
          },
          null,
          2,
        ),
      },
    ],
    temperature: action === "rewrite" ? 0.25 : 0.6,
    maxTokens: 400,
  };
}

async function completeStoryInputAi({
  action,
  nsfwEnabled,
  storyRequest,
}: {
  action: StoryInputAiAction;
  nsfwEnabled: boolean;
  storyRequest: string;
}) {
  const response = await fetch("/api/llm/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(
      buildStoryInputAiRequest({
        action,
        nsfwEnabled,
        storyRequest,
      }),
    ),
  });
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(getLlmProxyErrorMessage(payload) ?? "Unable to update Story Graph request.");
  }

  if (!isLlmChatResponse(payload)) {
    throw new Error("Story input AI response did not include chat content.");
  }

  const nextStoryRequest = parseStoryInputAiText(payload.content);

  if (!nextStoryRequest) {
    throw new Error("Story input AI response did not include a usable story request.");
  }

  return nextStoryRequest;
}

function createClientStartRequest({
  nsfwEnabled,
  promptProfile,
  rawIntent,
  targetShotCount,
}: {
  nsfwEnabled: boolean;
  promptProfile: PromptProfileId;
  rawIntent: string;
  targetShotCount: string;
}): StoryGraphStartRequest {
  const normalizedShotCount = targetShotCount.trim() ? Number(targetShotCount) : undefined;
  const audienceRating = nsfwEnabled ? "explicit" : "safe";

  return {
    nsfwEnabled,
    rawIntent,
    targetShotCount: Number.isFinite(normalizedShotCount) ? normalizedShotCount : undefined,
    settingsSnapshot: {
      audienceRating,
      nsfwEnabled,
      promptProfile,
      targetShotCount: Number.isFinite(normalizedShotCount) ? normalizedShotCount : undefined,
    } as StoryGraphStartRequest["settingsSnapshot"],
  };
}

function getApiErrorMessage(payload: unknown, fallback: string) {
  return isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === "string"
    ? payload.error.message
    : fallback;
}

function toStoryLocalResource(resource: CivitaiResourceListItem): StoryLocalResource {
  const modelFileName = makeCivitaiResourceTargetFileName(resource);

  return {
    id: resource.id,
    name: resource.name,
    baseModel: resource.baseModel,
    modelBaseModel: resource.baseModel ?? undefined,
    modelFileName,
    modelStorageKind: resource.resourceType === "model" ? getCivitaiModelStorageKind(resource) : undefined,
    trainedWords: resource.trainedWords,
  };
}

async function loadStoryResourceItems(resourceType: "lora" | "model", promptProfile: PromptProfileId) {
  const params = new URLSearchParams({
    resourceType,
    category: "all",
    downloaded: "ready",
    promptProfile,
  });
  const response = await fetch(`/api/civitai-lora-library/resources?${params.toString()}`);
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(getApiErrorMessage(payload, "Unable to load local Civitai resources for Story Graph planning."));
  }

  if (!isRecord(payload) || !Array.isArray(payload.items)) {
    throw new Error("Civitai resource response did not include an item list.");
  }

  return payload.items as CivitaiResourceListItem[];
}

async function loadStoryResourceCandidates(promptProfile: PromptProfileId) {
  const [checkpoints, loras] = await Promise.all([
    loadStoryResourceItems("model", promptProfile),
    loadStoryResourceItems("lora", promptProfile),
  ]);
  const resourceCandidates = {
    checkpoints: checkpoints.map(toStoryLocalResource),
    loras: loras.map(toStoryLocalResource),
  };

  if (resourceCandidates.checkpoints.length === 0) {
    throw new Error(
      "Story Graph needs at least one downloaded local checkpoint before planning can reach generation. Import or download a compatible Civitai checkpoint first.",
    );
  }

  return resourceCandidates;
}

async function postStoryWorkflow(
  url: string,
  body: unknown,
  fallbackMessage: string,
): Promise<StoryWorkflowState> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const message = isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === "string"
      ? payload.error.message
      : fallbackMessage;
    throw new Error(message);
  }

  if (!isRecord(payload) || !isRecord(payload.workflow)) {
    throw new Error(fallbackMessage);
  }

  return payload.workflow as unknown as StoryWorkflowState;
}

type StoryPlanningStreamEvent =
  | {
      nodeId?: StoryWorkflowNodeId;
      type: "workflow";
      workflow: StoryWorkflowState;
    }
  | {
      type: "done";
      workflow: StoryWorkflowState;
    }
  | {
      error?: {
        message?: string;
      };
      type: "error";
    };

async function postStoryWorkflowStream({
  body,
  fallbackMessage,
  onUpdate,
  url,
}: {
  body: unknown;
  fallbackMessage: string;
  onUpdate: (workflow: StoryWorkflowState, nodeId?: StoryWorkflowNodeId) => void;
  url: string;
}): Promise<StoryWorkflowState> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/x-ndjson",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    throw new Error(getApiErrorMessage(payload, fallbackMessage));
  }

  const contentType = response.headers?.get("content-type") ?? "";
  if (!response.body || !contentType.includes("application/x-ndjson")) {
    const payload: unknown = await response.json().catch(() => null);
    if (!isRecord(payload) || !isRecord(payload.workflow)) {
      throw new Error(fallbackMessage);
    }

    return payload.workflow as unknown as StoryWorkflowState;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let latestWorkflow: StoryWorkflowState | null = null;

  function handleLine(line: string) {
    if (!line.trim()) {
      return;
    }

    const event = JSON.parse(line) as StoryPlanningStreamEvent;
    if (event.type === "error") {
      throw new Error(event.error?.message ?? fallbackMessage);
    }

    latestWorkflow = event.workflow;
    if (event.type === "workflow") {
      onUpdate(event.workflow, event.nodeId);
    } else {
      onUpdate(event.workflow);
    }
  }

  while (true) {
    const { done, value } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        handleLine(line);
      }
    }

    if (done) {
      break;
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    handleLine(buffer);
  }

  if (!latestWorkflow) {
    throw new Error(fallbackMessage);
  }

  return latestWorkflow;
}

function isStoryExecutionState(value: unknown): value is StoryShotGraphExecutionState {
  return isRecord(value) && Array.isArray(value.shots) && typeof value.status === "string";
}

function isStoryResultDisplay(value: unknown): value is StoryResultDisplay {
  return isRecord(value) && Array.isArray(value.finalReferences) && typeof value.status === "string";
}

function getStoryResultImageUrl(reference: StoryResultDisplay["finalReferences"][number]) {
  return reference.storedImage?.url ?? reference.image?.url ?? "";
}

function getStoryExecutionImageUrl(reference: StoryShotGraphExecutionState["shots"][number]["resultReference"]) {
  return reference?.storedImage?.url ?? reference?.image?.url ?? "";
}

function getGenerationGateReady(workflow: StoryWorkflowState | null) {
  const gate = workflow?.nodes["generation-gate"];
  return gate?.status === "done" && isRecord(gate.result) && gate.result.ready === true;
}

function StartPanel({
  nsfwEnabled,
  onStart,
}: {
  nsfwEnabled: boolean;
  onStart: (request: StoryGraphStartRequest) => void;
}) {
  const [rawIntent, setRawIntent] = useState("");
  const [targetShotCount, setTargetShotCount] = useState("");
  const [promptProfile, setPromptProfile] = useState<PromptProfileId>(defaultPromptProfileId);
  const [aiStatus, setAiStatus] = useState<StoryInputAiAction | null>(null);
  const [error, setError] = useState("");

  async function handleStoryInputAi(action: StoryInputAiAction) {
    const currentStoryRequest = rawIntent.trim();

    if (action === "rewrite" && !currentStoryRequest) {
      setError("Add a story request before asking AI to rewrite it.");
      return;
    }

    setError("");
    setAiStatus(action);

    try {
      const nextStoryRequest = await completeStoryInputAi({
        action,
        nsfwEnabled,
        storyRequest: currentStoryRequest,
      });
      setRawIntent(nextStoryRequest);
    } catch (inputError) {
      setError(inputError instanceof Error ? inputError.message : "Story input AI request failed.");
    } finally {
      setAiStatus(null);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!rawIntent.trim()) {
      setError("Story request is required.");
      return;
    }

    setError("");
    onStart(
      createClientStartRequest({
        nsfwEnabled,
        promptProfile,
        rawIntent,
        targetShotCount,
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
            onClick={() =>
              onStart({
                ...fallbackRequest,
                settingsSnapshot: {
                  ...fallbackRequest.settingsSnapshot,
                  promptProfile,
                },
              })
            }
            type="button"
          >
            <RotateCcw className="size-3.5" />
            Load fallback
          </button>
        </div>

        <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
          <span className="flex items-center justify-between gap-3">
            Story request
            <span className="flex shrink-0 items-center gap-2">
              <button
                className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={aiStatus !== null || !rawIntent.trim()}
                onClick={() => void handleStoryInputAi("rewrite")}
                type="button"
              >
                <RefreshCw className="size-3.5" />
                Rewrite
              </button>
              <button
                className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={aiStatus !== null}
                onClick={() => void handleStoryInputAi("suggest")}
                type="button"
              >
                <Bot className="size-3.5" />
                Suggest
              </button>
            </span>
          </span>
          <textarea
            className="min-h-36 rounded-md border border-slate-200 px-3 py-2 text-sm leading-relaxed outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            onChange={(event) => setRawIntent(event.target.value)}
            placeholder="A short comic scene, storyboard sequence, or visual story beat..."
            value={rawIntent}
          />
        </label>

        <div className="grid gap-3 md:grid-cols-[minmax(0,12rem)_8rem]">
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
            Base model
            <select
              className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              onChange={(event) => setPromptProfile(normalizePromptProfileId(event.target.value))}
              value={promptProfile}
            >
              {promptProfileIds.map((profile) => (
                <option key={profile} value={profile}>
                  {formatPromptProfileLabel(profile)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
            Shots
            <input
              className="h-9 rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              min={1}
              max={24}
              onChange={(event) => setTargetShotCount(event.target.value)}
              placeholder="Auto"
              type="number"
              value={targetShotCount}
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

function StoryExecutionPanel({
  busy,
  execution,
  onRegenerateShot,
}: {
  busy: boolean;
  execution: StoryShotGraphExecutionState;
  onRegenerateShot: (shotId: string) => void;
}) {
  return (
    <section className="rounded-md border border-slate-200 bg-slate-50 p-3" data-testid="story-execution-panel">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Shot execution</h3>
          <p className="mt-1 text-xs text-slate-600">
            {execution.status} / {execution.shots.length} shots
          </p>
        </div>
        <span className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium uppercase text-slate-500">
          {execution.updatedAt ?? "not run"}
        </span>
      </div>
      <div className="grid gap-2">
        {execution.shots.map((shot) => (
          <article className="rounded-md border border-slate-200 bg-white p-3" key={shot.shotId}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-900">{shot.shotId}</p>
                <p className="mt-1 text-[11px] text-slate-500">
                  Sources: {shot.sourceShotIds.join(", ") || "none"}
                </p>
              </div>
              <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium uppercase text-slate-500">
                {shot.status}
              </span>
            </div>
            {shot.queueMetadata?.promptId || shot.resultReference?.promptId ? (
              <p className="mt-2 break-all text-[11px] text-slate-500">
                Prompt: {shot.resultReference?.promptId ?? shot.queueMetadata?.promptId}
              </p>
            ) : null}
            {shot.resultReference?.image ? (
              <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-600">
                <ImageIcon className="size-3.5" />
                <a className="break-all text-blue-700 underline-offset-2 hover:underline" href={getStoryExecutionImageUrl(shot.resultReference)} target="_blank" rel="noreferrer">
                  {shot.resultReference.image.filename}
                </a>
              </div>
            ) : null}
            {shot.error ? (
              <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 p-2 text-[11px] text-rose-700">
                {shot.error.message}
              </div>
            ) : null}
            <div className="mt-3 flex justify-end">
              <button
                className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={busy}
                onClick={() => onRegenerateShot(shot.shotId)}
                type="button"
              >
                <RefreshCw className="size-3.5" />
                Regenerate shot
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function StoryResultGrid({ result }: { result: StoryResultDisplay }) {
  return (
    <section className="rounded-md border border-slate-200 bg-slate-50 p-3" data-testid="story-result-grid">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Final result grid</h3>
          <p className="mt-1 text-xs text-slate-600">
            {result.status} / {result.finalReferences.length} rendered references
          </p>
        </div>
        <span className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium uppercase text-slate-500">
          {result.nsfwContext.enabled ? "nsfw enabled" : "safe context"}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {result.finalReferences.map((reference) => {
          const imageUrl = getStoryResultImageUrl(reference);

          return (
            <article className="rounded-md border border-slate-200 bg-white p-2" key={reference.shotId}>
              {imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
                <img alt={`Generated ${reference.shotId}`} className="aspect-video w-full rounded object-cover" src={imageUrl} />
              ) : (
                <div className="flex aspect-video items-center justify-center rounded bg-slate-100 text-xs text-slate-500">
                  No image
                </div>
              )}
              <p className="mt-2 text-xs font-semibold text-slate-900">{reference.shotId}</p>
              <p className="mt-1 break-all text-[11px] text-slate-500">{reference.promptId}</p>
            </article>
          );
        })}
      </div>
      {result.errors.length > 0 ? (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-800">
          {result.errors.map((error) => error.message).join(" ")}
        </div>
      ) : null}
    </section>
  );
}

export function StoryPlanningPreview() {
  const [workflow, setWorkflow] = useState<StoryWorkflowState | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<StoryWorkflowNodeId>("story-input");
  const [settingsNsfwEnabled, setSettingsNsfwEnabled] = useState(false);
  const [planningError, setPlanningError] = useState("");
  const [planningStatus, setPlanningStatus] = useState<"idle" | "planning" | "generating" | "regenerating">("idle");
  const selectedNode = workflow?.nodes[selectedNodeId];
  const metadata = storyWorkflowDefinition.metadata[selectedNodeId];
  const rawJson = useMemo(
    () => JSON.stringify(selectedNode?.result ?? selectedNode?.error ?? {}, null, 2),
    [selectedNode],
  );
  const selectedIndex = planningNodeIds.indexOf(selectedNodeId) + 1;
  const selectedDependencies = storyWorkflowDefinition.dependencyDag[selectedNodeId];

  useEffect(() => {
    if (typeof fetch !== "function") {
      return;
    }

    let active = true;

    void fetch("/api/settings")
      .then((response) => (response.ok ? response.json() as Promise<unknown> : null))
      .then((payload) => {
        if (!active || !payload || typeof payload !== "object") {
          return;
        }

        const nsfw = (payload as { general?: { nsfw?: { supportsNsfw?: boolean } } }).general?.nsfw;
        setSettingsNsfwEnabled(nsfw?.supportsNsfw === true);
      })
      .catch(() => {
        if (active) {
          setSettingsNsfwEnabled(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  async function handleStart(request: StoryGraphStartRequest) {
    setPlanningError("");
    setSelectedNodeId("story-input");
    setPlanningStatus("planning");

    try {
      const initialStart = createStoryGraphInputWorkflow(request);
      setWorkflow(initialStart.workflow);
      const promptProfile = normalizePromptProfileId(request.settingsSnapshot?.promptProfile);
      const resourceCandidates = await loadStoryResourceCandidates(promptProfile);
      const settingsSnapshot = {
        ...(isRecord(request.settingsSnapshot) ? request.settingsSnapshot : {}),
        promptProfile,
        resourceCandidates,
      };
      const planned = await postStoryWorkflowStream({
        url: "/api/agent-timeline/story/run-planning",
        body: {
          rawIntent: request.rawIntent,
          storyId: initialStart.input.storyId,
          targetShotCount: request.targetShotCount,
          nsfwEnabled: request.nsfwEnabled,
          settingsSnapshot,
          workflowId: initialStart.workflow.workflowId,
        },
        fallbackMessage: "Story Graph planning failed.",
        onUpdate: (updatedWorkflow, nodeId) => {
          setWorkflow(updatedWorkflow);
          if (nodeId) {
            setSelectedNodeId(nodeId);
          }
        },
      });
      setWorkflow(planned);
    } catch (error) {
      setPlanningError(error instanceof Error ? error.message : "Story Graph planning failed.");
    } finally {
      setPlanningStatus("idle");
    }
  }

  async function handleConfirmGeneration() {
    if (!workflow) {
      return;
    }

    setPlanningError("");
    setPlanningStatus("generating");

    try {
      const generated = await postStoryWorkflow("/api/agent-timeline/story/confirm-generation", {
        workflow,
      }, "Story Graph generation failed.");
      setWorkflow(generated);
      setSelectedNodeId("shot-graph-execution");
    } catch (error) {
      setPlanningError(error instanceof Error ? error.message : "Story Graph generation failed.");
    } finally {
      setPlanningStatus("idle");
    }
  }

  async function handleRegenerateShot(shotId: string) {
    if (!workflow) {
      return;
    }

    setPlanningError("");
    setPlanningStatus("regenerating");

    try {
      const regenerated = await postStoryWorkflow("/api/agent-timeline/story/regenerate-shot", {
        workflow,
        shotId,
      }, "Story Graph shot regeneration failed.");
      setWorkflow(regenerated);
      setSelectedNodeId("shot-graph-execution");
    } catch (error) {
      setPlanningError(error instanceof Error ? error.message : "Story Graph shot regeneration failed.");
    } finally {
      setPlanningStatus("idle");
    }
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

  const generationReady = getGenerationGateReady(workflow);
  const executionResult = isStoryExecutionState(workflow?.nodes["shot-graph-execution"].result)
    ? workflow?.nodes["shot-graph-execution"].result
    : null;
  const storyResult = isStoryResultDisplay(workflow?.nodes["story-result-display"].result)
    ? workflow?.nodes["story-result-display"].result
    : null;
  const actionBusy = planningStatus !== "idle";

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
          {workflow && generationReady ? (
            <button
              className={headerLinkClassName}
              disabled={actionBusy}
              onClick={() => void handleConfirmGeneration()}
              type="button"
            >
              <Play className="size-3.5" />
              {planningStatus === "generating" ? "Generating" : "Start shot generation"}
            </button>
          ) : null}
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
        <>
          {planningError ? (
            <div className="mx-auto mt-4 w-full max-w-4xl rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
              {planningError}
            </div>
          ) : null}
          <StartPanel nsfwEnabled={settingsNsfwEnabled} onStart={(request) => void handleStart(request)} />
        </>
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
                            : node.status === "running"
                              ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                            : node.status === "blocked"
                              ? "border-slate-200 bg-slate-50 text-slate-500"
                              : "border-emerald-200 bg-emerald-50 text-emerald-700",
                      )}
                    >
                      {node.status === "running" ? (
                        <LoaderCircle className="size-3.5 animate-spin" />
                      ) : (
                        planningNodeIds.indexOf(nodeId) + 1
                      )}
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
                      {selectedNode.status === "running" ? (
                        <LoaderCircle className="size-3.5 animate-spin text-indigo-500" />
                      ) : selectedNode.status === "manual" ? (
                        <CheckCircle2 className="size-3.5 text-violet-500" />
                      ) : (
                        <CircleDot className="size-3.5" />
                      )}
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
                    {planningError ? (
                      <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
                        {planningError}
                      </div>
                    ) : null}
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
                    {selectedNodeId === "shot-graph-execution" && executionResult ? (
                      <div className="mt-4">
                        <StoryExecutionPanel
                          busy={actionBusy}
                          execution={executionResult}
                          onRegenerateShot={(shotId) => void handleRegenerateShot(shotId)}
                        />
                      </div>
                    ) : null}
                    {selectedNodeId === "story-result-display" && storyResult ? (
                      <div className="mt-4">
                        <StoryResultGrid result={storyResult} />
                      </div>
                    ) : null}
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
                  Story planning runs through the server Story Graph LiteLLM adapters. Shot generation is confirmation-gated and uses the Story ComfyUI shot graph scheduler.
                </div>
              </section>
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}
