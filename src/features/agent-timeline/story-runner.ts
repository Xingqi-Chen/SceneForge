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
import { storyWorkflowDefinition } from "./story-workflow";
import type { StoryWorkflowNodeId } from "./story-types";
import { normalizeCommonWorkflowAdapterResult } from "./workflow-definition";

export type RunStoryPlanningRequest = {
  rawIntent: string;
  targetShotCount?: number;
  nsfwEnabled?: boolean;
  settingsSnapshot?: StoryGraphStartRequest["settingsSnapshot"];
};

export type RunStoryPlanningOptions = {
  adapters?: StoryNodeAdapters;
  completeChat?: StoryCompleteChat;
  now?: () => string;
  onWorkflowUpdate?: (workflow: StoryWorkflowState, nodeId: StoryWorkflowNodeId) => void;
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
    targetShotCount: request.targetShotCount,
    nsfwEnabled: request.nsfwEnabled,
    settingsSnapshot: request.settingsSnapshot,
    now: () => timestamp,
  });
  const workflow = createStoryWorkflowState({
    now: () => timestamp,
    storyId: input.storyId,
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
  const adapters = options.adapters ?? createStoryLlmNodeAdapters({
    completeChat: options.completeChat ?? createDefaultStoryCompleteChat(),
    now,
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
