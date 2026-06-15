import { describe, expect, it, vi, afterEach } from "vitest";

const runStoryPlanningMock = vi.hoisted(() => vi.fn());

vi.mock("@/features/agent-timeline/story-runner", () => ({
  runStoryPlanning: runStoryPlanningMock,
}));

import { POST } from "./route";

afterEach(() => {
  vi.restoreAllMocks();
  runStoryPlanningMock.mockReset();
});

describe("POST /api/agent-timeline/story/run-planning", () => {
  it("returns a server-planned story workflow", async () => {
    runStoryPlanningMock.mockResolvedValue({
      workflowId: "story-workflow-1",
      workflowMode: "story-graph",
      storyId: "story-1",
      nodes: {},
      createdAt: "2026-06-15T00:00:00.000Z",
      updatedAt: "2026-06-15T00:00:00.000Z",
      generationConfirmed: false,
    });

    const response = await POST(new Request("http://localhost/api/agent-timeline/story/run-planning", {
      method: "POST",
      body: JSON.stringify({
        rawIntent: "A courier follows a signal.",
        targetShotCount: 3,
        nsfwEnabled: false,
        settingsSnapshot: {
          resourceCandidates: {
            checkpoints: [{ id: "checkpoint-local", name: "Local", modelFileName: "local.safetensors" }],
            loras: [],
          },
        },
      }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.workflow.workflowMode).toBe("story-graph");
    expect(runStoryPlanningMock).toHaveBeenCalledWith({
      rawIntent: "A courier follows a signal.",
      targetShotCount: 3,
      nsfwEnabled: false,
      settingsSnapshot: {
        resourceCandidates: {
          checkpoints: [{ id: "checkpoint-local", name: "Local", modelFileName: "local.safetensors" }],
          loras: [],
        },
      },
    });
  });

  it("returns bad request for invalid input and server failure for planner errors", async () => {
    const badRequest = await POST(new Request("http://localhost/api/agent-timeline/story/run-planning", {
      method: "POST",
      body: JSON.stringify({ targetShotCount: 3 }),
    }));

    expect(badRequest.status).toBe(400);

    runStoryPlanningMock.mockRejectedValue(new Error("LiteLLM unavailable."));
    const failure = await POST(new Request("http://localhost/api/agent-timeline/story/run-planning", {
      method: "POST",
      body: JSON.stringify({ rawIntent: "A story request." }),
    }));
    const payload = await failure.json();

    expect(failure.status).toBe(500);
    expect(payload.error.message).toBe("LiteLLM unavailable.");
  });
});
