import {
  createComfyUiClient,
  readComfyUiKSamplerOptions,
} from "@/features/comfyui";
import { createLiteLlmClient } from "@/features/llm";

import {
  canRunStoryNode,
  completeStoryNode,
  createStoryWorkflowState,
  failStoryNode,
  markStoryNodeRunning,
  refreshStoryWorkflowReadiness,
  type StoryWorkflowState,
} from "./story-state";
import {
  createStoryInputFromStartRequest,
  type StoryGraphStartRequest,
} from "./story-input";
import {
  createStoryLlmNodeAdapters,
  type StoryCompleteChat,
  type StoryNodeAdapters,
} from "./story-llm-adapters";
import type { TimelineSamplerOptions } from "./timeline-sampler-options";
import { storyWorkflowDefinition } from "./story-workflow";
import type { StoryWorkflowNodeId } from "./story-types";
import { normalizeCommonWorkflowAdapterResult } from "./workflow-definition";

const STORY_SAMPLER_OPTIONS_TIMEOUT_MS = 2500;

export type RunStoryPlanningRequest = {
  rawIntent: string;
  storyId?: string;
  targetShotCount?: number;
  nsfwEnabled?: boolean;
  settingsSnapshot?: StoryGraphStartRequest["settingsSnapshot"];
  workflowId?: string;
};

export type RunStoryPlanningOptions = {
  adapters?: StoryNodeAdapters;
  completeChat?: StoryCompleteChat;
  loadSamplerOptions?: () => Promise<TimelineSamplerOptions> | TimelineSamplerOptions;
  now?: () => string;
  onWorkflowUpdate?: (workflow: StoryWorkflowState, nodeId: StoryWorkflowNodeId) => void;
  samplerOptions?: TimelineSamplerOptions;
};

function defaultNow() {
  return new Date().toISOString();
}

export function createDefaultStoryCompleteChat(): StoryCompleteChat {
  const client = createLiteLlmClient({
    baseUrl: process.env.LITELLM_BASE_URL ?? "",
    apiKey: process.env.LITELLM_API_KEY || undefined,
    defaultModel: process.env.LITELLM_DEFAULT_MODEL,
  });

  return client.completeChat;
}

export async function loadStorySamplerOptionsFromComfyUi(): Promise<TimelineSamplerOptions> {
  try {
    const client = createComfyUiClient({
      baseUrl: process.env.COMFYUI_BASE_URL ?? "http://127.0.0.1:8188",
      apiKey: process.env.COMFYUI_API_KEY || undefined,
      fetcher: (input, init) =>
        fetch(input, {
          ...init,
          signal: AbortSignal.timeout(STORY_SAMPLER_OPTIONS_TIMEOUT_MS),
        }),
    });
    const objectInfo = await client.getObjectInfo();

    return readComfyUiKSamplerOptions(objectInfo);
  } catch (error) {
    console.warn("[SceneForge] [agent-timeline] failed to load Story KSampler options; using defaults", { error });
    return {
      samplers: [],
      schedulers: [],
    };
  }
}

function createInitialStoryPlanningWorkflow({
  now,
  request,
}: {
  now: () => string;
  request: RunStoryPlanningRequest;
}) {
  const timestamp = now();
  const input = createStoryInputFromStartRequest({
    rawIntent: request.rawIntent,
    storyId: request.storyId,
    targetShotCount: request.targetShotCount,
    nsfwEnabled: request.nsfwEnabled,
    settingsSnapshot: request.settingsSnapshot,
    now: () => timestamp,
  });
  const workflow = createStoryWorkflowState({
    now: () => timestamp,
    storyId: input.storyId,
    workflowId: request.workflowId,
  });

  return refreshStoryWorkflowReadiness({
    ...workflow,
    nodes: {
      ...workflow.nodes,
      "story-input": {
        nodeId: "story-input",
        result: input,
        source: "manual",
        status: "manual",
        updatedAt: timestamp,
      },
    },
    updatedAt: timestamp,
  });
}

export async function runStoryPlanning(
  request: RunStoryPlanningRequest,
  options: RunStoryPlanningOptions = {},
): Promise<StoryWorkflowState> {
  const now = options.now ?? defaultNow;
  let workflow = createInitialStoryPlanningWorkflow({ now, request });
  const samplerOptions = options.samplerOptions
    ?? (options.loadSamplerOptions ? await options.loadSamplerOptions() : undefined);
  const adapters = options.adapters ?? createStoryLlmNodeAdapters({
    completeChat: options.completeChat ?? createDefaultStoryCompleteChat(),
    now,
    resourceCandidates: request.settingsSnapshot?.resourceCandidates,
    samplerOptions,
  });
  let progressed = true;

  while (progressed) {
    progressed = false;
    workflow = refreshStoryWorkflowReadiness(workflow);

    for (const nodeId of storyWorkflowDefinition.nodeIds) {
      if (!canRunStoryNode(workflow, nodeId)) {
        continue;
      }

      const adapter = adapters[nodeId];
      if (!adapter) {
        continue;
      }

      progressed = true;
      workflow = markStoryNodeRunning(workflow, nodeId, { now });
      options.onWorkflowUpdate?.(workflow, nodeId);

      try {
        const adapterResult = normalizeCommonWorkflowAdapterResult(await adapter({
          nodeId,
          workflow,
          dependencies: storyWorkflowDefinition.dependencyDag[nodeId].map((dependencyId) => workflow.nodes[dependencyId]),
        }));
        workflow = completeStoryNode(
          workflow,
          nodeId,
          adapterResult.value,
          adapterResult.source ?? "ai",
          { now },
        );
        options.onWorkflowUpdate?.(workflow, nodeId);
      } catch (error) {
        workflow = failStoryNode(workflow, nodeId, error, { now });
        options.onWorkflowUpdate?.(workflow, nodeId);
      }
    }
  }

  return refreshStoryWorkflowReadiness(workflow);
}
