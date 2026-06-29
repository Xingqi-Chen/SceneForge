import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StoryResourceCandidateLoadRequest } from "@/features/agent-timeline/story-llm-adapters";
import { TimelineNodeExecutionError } from "@/features/agent-timeline/types";

const runStoryPlanningMock = vi.hoisted(() => vi.fn());
const loadCivitaiRecommendationCandidatesMock = vi.hoisted(() => vi.fn());
const getCivitaiResourceDetailFromSqliteMock = vi.hoisted(() => vi.fn());
const loadCivitaiLibrarySettingsFromSqliteMock = vi.hoisted(() => vi.fn());
const openSceneForgeSqliteDatabaseMock = vi.hoisted(() => vi.fn());
const getCivitaiResourceDownloadStatusMock = vi.hoisted(() => vi.fn());
const dbCloseMock = vi.hoisted(() => vi.fn());

vi.mock("@/features/civitai-lora-library/ai-recommendation", () => ({
  loadCivitaiRecommendationCandidates: loadCivitaiRecommendationCandidatesMock,
}));

vi.mock("@/features/civitai-lora-library/download", () => ({
  getCivitaiResourceDownloadStatus: getCivitaiResourceDownloadStatusMock,
  isCivitaiResourceDownloadReady: (
    status: { status?: string; fileExists?: boolean } | null,
  ) => status?.status === "verified" || (status?.status === "unverified" && status.fileExists === true),
}));

vi.mock("@/features/civitai-lora-library/image-dimensions", () => ({
  extractCivitaiExampleImageDimensions: vi.fn(() => []),
}));

vi.mock("@/features/civitai-lora-library/resource-files", () => ({
  getCivitaiModelStorageKind: vi.fn(() => "checkpoint"),
  getCivitaiResourceConfiguredDownloadPath: vi.fn((
    resource: { resourceType: "lora" | "model" },
    settings: { checkpointDownloadPath: string; loraDownloadPath: string },
  ) => (resource.resourceType === "model" ? settings.checkpointDownloadPath : settings.loraDownloadPath)),
  makeCivitaiResourceFileNameAliases: vi.fn((resource: { id: string }) => [`${resource.id}.safetensors`]),
  makeCivitaiResourceTargetFileName: vi.fn((resource: { id: string }) => `${resource.id}.safetensors`),
}));

vi.mock("@/features/persistence/sqlite-storage", () => ({
  getCivitaiResourceDetailFromSqlite: getCivitaiResourceDetailFromSqliteMock,
  loadCivitaiLibrarySettingsFromSqlite: loadCivitaiLibrarySettingsFromSqliteMock,
  openSceneForgeSqliteDatabase: openSceneForgeSqliteDatabaseMock,
}));

vi.mock("@/features/agent-timeline/story-runner", () => ({
  loadStoryResourceCandidatesFromCivitai: vi.fn(),
  loadStorySamplerOptionsFromComfyUi: vi.fn(),
  runStoryPlanning: runStoryPlanningMock,
}));

import { POST } from "./route";

type CivitaiResourceDetailFixture = {
  id: string;
  resourceType: "lora" | "model";
  name: string;
  versionName: string | null;
  baseModel: string | null;
  creator: string | null;
  trainedWords: string[];
  tags: string[];
  categories: string[];
  usageGuide: string | null;
  description: string | null;
  averageWeight: number | null;
  minWeight: number | null;
  maxWeight: number | null;
  recommendations: unknown[];
  previewImage: string | null;
  importedImageCount: number;
  commonCheckpoints: Array<{ resourceId: string; name: string; count: number }>;
  commonLoras: Array<{ resourceId: string; name: string; count: number }>;
  usages: unknown[];
  officialImagesJson: unknown;
};

const db = { close: dbCloseMock };
const resourceDetails = new Map<string, CivitaiResourceDetailFixture>();
const downloadStatuses = new Map<string, ReturnType<typeof makeDownloadStatus>>();

function makeWorkflow(overrides: Record<string, unknown> = {}) {
  return {
    workflowId: "story-workflow-1",
    workflowMode: "story-graph",
    storyId: "story-1",
    nodes: {},
    createdAt: "2026-06-15T00:00:00.000Z",
    updatedAt: "2026-06-15T00:00:00.000Z",
    generationConfirmed: false,
    ...overrides,
  };
}

function makeDownloadStatus(
  resourceId: string,
  status: "not_downloaded" | "unverified" | "verified" = "verified",
) {
  return {
    resourceId,
    status,
    message: status === "verified" ? "Ready." : "File missing.",
    pathConfigured: true,
    directoryExists: true,
    targetFileName: `${resourceId}.safetensors`,
    targetPath: `C:/models/${resourceId}.safetensors`,
    fileExists: status !== "not_downloaded",
    checksumType: null,
    expectedSha256: null,
    actualSha256: null,
    checksumMatches: null,
    downloadUrl: null,
  };
}

function makeCivitaiResourceDetail(
  overrides: Partial<CivitaiResourceDetailFixture> & Pick<CivitaiResourceDetailFixture, "id" | "name" | "resourceType">,
): CivitaiResourceDetailFixture {
  return {
    versionName: "v1",
    baseModel: "Illustrious",
    creator: "Example Creator",
    trainedWords: [],
    tags: [],
    categories: [],
    usageGuide: null,
    description: null,
    averageWeight: null,
    minWeight: null,
    maxWeight: null,
    recommendations: [],
    previewImage: null,
    importedImageCount: 0,
    commonCheckpoints: [],
    commonLoras: [],
    usages: [],
    officialImagesJson: [],
    ...overrides,
  };
}

function makeRankedCandidate(
  overrides: {
    id: string;
    name: string;
    resourceType: "lora" | "model";
    score?: number;
  },
) {
  return {
    resource: {
      id: overrides.id,
      name: overrides.name,
      resourceType: overrides.resourceType,
      versionName: "ranked-v1",
      baseModel: "Illustrious",
      creator: "Ranked Creator",
      trainedWords: [],
      tags: [],
      categories: [],
      usageGuide: null,
      descriptionSnippet: null,
      averageWeight: null,
      minWeight: null,
      maxWeight: null,
      recommendations: [],
      previewImage: null,
      modelFileName: `${overrides.id}.safetensors`,
      modelFileNameAliases: [`${overrides.id}.safetensors`],
    },
    importedImageCount: 7,
    commonCheckpoints: [],
    commonLoras: [],
    score: overrides.score ?? 0.9,
  };
}

async function loadRouteResourceCandidates(request: StoryResourceCandidateLoadRequest) {
  let loadResourceCandidates:
    | ((candidateRequest: StoryResourceCandidateLoadRequest, context: never) => unknown)
    | undefined;

  runStoryPlanningMock.mockImplementation(async (_planningRequest, options) => {
    loadResourceCandidates = options.loadResourceCandidates;
    return makeWorkflow();
  });

  const response = await POST(new Request("http://localhost/api/agent-timeline/story/run-planning", {
    method: "POST",
    body: JSON.stringify({ rawIntent: "A story request." }),
  }));

  expect(response.status).toBe(200);
  expect(loadResourceCandidates).toBeDefined();

  return loadResourceCandidates!(request, {} as never);
}

async function expectInvalidResourceSelection(
  request: StoryResourceCandidateLoadRequest,
  message: RegExp,
) {
  try {
    await loadRouteResourceCandidates(request);
    throw new Error("Expected selected resource loading to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(TimelineNodeExecutionError);
    expect(error).toMatchObject({
      code: "resource_selection_invalid",
      message: expect.stringMatching(message),
    });
  }
}

beforeEach(() => {
  resourceDetails.clear();
  downloadStatuses.clear();
  loadCivitaiRecommendationCandidatesMock.mockResolvedValue({
    checkpoints: [],
    loras: [],
  });
  loadCivitaiLibrarySettingsFromSqliteMock.mockReturnValue({
    loraDownloadPath: "C:/models/loras",
    checkpointDownloadPath: "C:/models/checkpoints",
    diffusionModelPath: "C:/models/diffusion",
    controlNetModelPath: "C:/models/controlnet",
  });
  openSceneForgeSqliteDatabaseMock.mockResolvedValue(db);
  getCivitaiResourceDetailFromSqliteMock.mockImplementation((_database, id: string) => (
    resourceDetails.get(id) ?? null
  ));
  getCivitaiResourceDownloadStatusMock.mockImplementation(async (resource: { id: string }) => (
    downloadStatuses.get(resource.id) ?? makeDownloadStatus(resource.id)
  ));
});

afterEach(() => {
  vi.restoreAllMocks();
  runStoryPlanningMock.mockReset();
  loadCivitaiRecommendationCandidatesMock.mockReset();
  getCivitaiResourceDetailFromSqliteMock.mockReset();
  loadCivitaiLibrarySettingsFromSqliteMock.mockReset();
  openSceneForgeSqliteDatabaseMock.mockReset();
  getCivitaiResourceDownloadStatusMock.mockReset();
  dbCloseMock.mockReset();
});

describe("POST /api/agent-timeline/story/run-planning", () => {
  it("returns a server-planned story workflow", async () => {
    runStoryPlanningMock.mockResolvedValue(makeWorkflow());

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
    expect(runStoryPlanningMock).toHaveBeenCalledWith(
      {
        rawIntent: "A courier follows a signal.",
        targetShotCount: 3,
        nsfwEnabled: false,
        settingsSnapshot: {},
      },
      expect.objectContaining({
        loadResourceCandidates: expect.any(Function),
        loadSamplerOptions: expect.any(Function),
      }),
    );
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

  it("preserves Story style settings while stripping inline resource candidates", async () => {
    runStoryPlanningMock.mockResolvedValue(makeWorkflow());

    const response = await POST(new Request("http://localhost/api/agent-timeline/story/run-planning", {
      method: "POST",
      body: JSON.stringify({
        rawIntent: "A courier follows a signal.",
        settingsSnapshot: {
          resourceCandidates: {
            checkpoints: [{ id: "checkpoint-local", name: "Local", modelFileName: "local.safetensors" }],
            loras: [],
          },
          stylePalette: {
            checkpointId: "checkpoint-local",
            loras: [{ id: "lora-local", enabled: true, strengthModel: 0.82, strengthClip: 0.44 }],
            parameters: {
              width: 832,
              height: 1216,
              steps: 31,
              cfg: 4.25,
              samplerName: "euler",
              scheduler: "normal",
              denoise: 0.88,
              seed: 12345,
            },
          },
        },
      }),
    }));

    expect(response.status).toBe(200);
    expect(runStoryPlanningMock).toHaveBeenCalledWith(
      expect.objectContaining({
        settingsSnapshot: {
          stylePalette: {
            checkpointId: "checkpoint-local",
            loras: [{ id: "lora-local", enabled: true, strengthModel: 0.82, strengthClip: 0.44 }],
            parameters: {
              width: 832,
              height: 1216,
              steps: 31,
              cfg: 4.25,
              samplerName: "euler",
              scheduler: "normal",
              denoise: 0.88,
              seed: 12345,
            },
          },
        },
      }),
      expect.objectContaining({
        loadResourceCandidates: expect.any(Function),
      }),
    );
  });

  it("loads selected Civitai checkpoint and LoRA IDs outside ranked Story candidates", async () => {
    resourceDetails.set("selected-checkpoint", makeCivitaiResourceDetail({
      id: "selected-checkpoint",
      name: "Selected Checkpoint",
      resourceType: "model",
      importedImageCount: 3,
    }));
    resourceDetails.set("selected-lora", makeCivitaiResourceDetail({
      id: "selected-lora",
      name: "Selected LoRA",
      resourceType: "lora",
      trainedWords: ["selected trigger"],
      importedImageCount: 5,
    }));
    loadCivitaiRecommendationCandidatesMock.mockResolvedValue({
      checkpoints: [makeRankedCandidate({
        id: "ranked-checkpoint",
        name: "Ranked Checkpoint",
        resourceType: "model",
      })],
      loras: [makeRankedCandidate({
        id: "ranked-lora",
        name: "Ranked LoRA",
        resourceType: "lora",
      })],
    });

    const candidates = await loadRouteResourceCandidates({
      desiredEffect: "cinematic neon chase",
      promptProfile: "illustrious",
      selectedCheckpointId: "selected-checkpoint",
      selectedLoraIds: ["selected-lora"],
    });

    expect(candidates).toMatchObject({
      checkpoints: [
        {
          id: "ranked-checkpoint",
          recommendationRank: 1,
        },
        {
          id: "selected-checkpoint",
          name: "Selected Checkpoint",
          modelFileName: "selected-checkpoint.safetensors",
          modelStorageKind: "checkpoint",
          importedImageCount: 3,
        },
      ],
      loras: [
        {
          id: "ranked-lora",
          recommendationRank: 1,
        },
        {
          id: "selected-lora",
          name: "Selected LoRA",
          modelFileName: "selected-lora.safetensors",
          trainedWords: ["selected trigger"],
          importedImageCount: 5,
        },
      ],
    });
    expect(loadCivitaiRecommendationCandidatesMock).toHaveBeenCalledWith(
      db,
      "cinematic neon chase",
      { promptProfile: "illustrious" },
    );
    expect(getCivitaiResourceDetailFromSqliteMock).toHaveBeenCalledWith(db, "selected-checkpoint");
    expect(getCivitaiResourceDetailFromSqliteMock).toHaveBeenCalledWith(db, "selected-lora");
    expect(dbCloseMock).toHaveBeenCalledTimes(1);
  });

  it("loads selected Story resources when ranked Civitai candidate loading fails", async () => {
    resourceDetails.set("selected-checkpoint", makeCivitaiResourceDetail({
      id: "selected-checkpoint",
      name: "Selected Checkpoint",
      resourceType: "model",
      importedImageCount: 3,
    }));
    loadCivitaiRecommendationCandidatesMock.mockRejectedValue(new Error("Embedding index unavailable."));

    const candidates = await loadRouteResourceCandidates({
      desiredEffect: "cinematic neon chase",
      promptProfile: "illustrious",
      selectedCheckpointId: "selected-checkpoint",
    });

    expect(candidates).toMatchObject({
      checkpoints: [
        {
          id: "selected-checkpoint",
          name: "Selected Checkpoint",
          modelFileName: "selected-checkpoint.safetensors",
          modelStorageKind: "checkpoint",
          importedImageCount: 3,
        },
      ],
      loras: [],
    });
    expect(loadCivitaiRecommendationCandidatesMock).toHaveBeenCalledWith(
      db,
      "cinematic neon chase",
      { promptProfile: "illustrious" },
    );
    expect(getCivitaiResourceDetailFromSqliteMock).toHaveBeenCalledWith(db, "selected-checkpoint");
    expect(dbCloseMock).toHaveBeenCalledTimes(1);
  });

  it("keeps ranked Civitai candidate loading required without selected Story resources", async () => {
    loadCivitaiRecommendationCandidatesMock.mockRejectedValue(new Error("Embedding index unavailable."));

    await expect(loadRouteResourceCandidates({
      desiredEffect: "cinematic neon chase",
      promptProfile: "illustrious",
    })).rejects.toThrow("Embedding index unavailable.");
    expect(getCivitaiResourceDetailFromSqliteMock).not.toHaveBeenCalled();
    expect(loadCivitaiLibrarySettingsFromSqliteMock).not.toHaveBeenCalled();
    expect(dbCloseMock).toHaveBeenCalledTimes(1);
  });

  it("rejects missing selected Story resource IDs", async () => {
    await expectInvalidResourceSelection(
      {
        desiredEffect: "cinematic neon chase",
        promptProfile: "illustrious",
        selectedCheckpointId: "missing-checkpoint",
      },
      /was not found in the local Civitai library/,
    );
    expect(dbCloseMock).toHaveBeenCalledTimes(1);
  });

  it("rejects selected Story resources with the wrong Civitai type", async () => {
    resourceDetails.set("selected-lora-as-checkpoint", makeCivitaiResourceDetail({
      id: "selected-lora-as-checkpoint",
      name: "Selected LoRA",
      resourceType: "lora",
    }));

    await expectInvalidResourceSelection(
      {
        desiredEffect: "cinematic neon chase",
        promptProfile: "illustrious",
        selectedCheckpointId: "selected-lora-as-checkpoint",
      },
      /has type "lora", not "model"/,
    );
    expect(dbCloseMock).toHaveBeenCalledTimes(1);
  });

  it("rejects selected Story LoRA resources with the wrong Civitai type", async () => {
    resourceDetails.set("selected-checkpoint-as-lora", makeCivitaiResourceDetail({
      id: "selected-checkpoint-as-lora",
      name: "Selected Checkpoint",
      resourceType: "model",
    }));

    await expectInvalidResourceSelection(
      {
        desiredEffect: "cinematic neon chase",
        promptProfile: "illustrious",
        selectedLoraIds: ["selected-checkpoint-as-lora"],
      },
      /has type "model", not "lora"/,
    );
    expect(dbCloseMock).toHaveBeenCalledTimes(1);
  });

  it("rejects selected Story resources that are unavailable to ComfyUI", async () => {
    resourceDetails.set("selected-lora", makeCivitaiResourceDetail({
      id: "selected-lora",
      name: "Selected LoRA",
      resourceType: "lora",
    }));
    downloadStatuses.set("selected-lora", makeDownloadStatus("selected-lora", "not_downloaded"));

    await expectInvalidResourceSelection(
      {
        desiredEffect: "cinematic neon chase",
        promptProfile: "illustrious",
        selectedLoraIds: ["selected-lora"],
      },
      /is not available to ComfyUI/,
    );
    expect(dbCloseMock).toHaveBeenCalledTimes(1);
  });

  it("streams workflow updates when requested", async () => {
    const runningWorkflow = {
      workflowId: "story-workflow-1",
      workflowMode: "story-graph",
      storyId: "story-1",
      nodes: {
        "story-bible": {
          nodeId: "story-bible",
          source: "ai",
          status: "running",
          updatedAt: "2026-06-15T00:00:01.000Z",
        },
      },
      createdAt: "2026-06-15T00:00:00.000Z",
      updatedAt: "2026-06-15T00:00:01.000Z",
      generationConfirmed: false,
    };
    const doneWorkflow = {
      ...runningWorkflow,
      nodes: {
        "story-bible": {
          nodeId: "story-bible",
          result: { title: "Story bible" },
          source: "ai",
          status: "done",
          updatedAt: "2026-06-15T00:00:02.000Z",
        },
      },
      updatedAt: "2026-06-15T00:00:02.000Z",
    };
    runStoryPlanningMock.mockImplementation(async (_request, options) => {
      options.onWorkflowUpdate(runningWorkflow, "story-bible");
      return doneWorkflow;
    });

    const response = await POST(new Request("http://localhost/api/agent-timeline/story/run-planning", {
      method: "POST",
      headers: {
        accept: "application/x-ndjson",
      },
      body: JSON.stringify({
        rawIntent: "A courier follows a signal.",
        storyId: "story-1",
        workflowId: "story-workflow-1",
      }),
    }));
    const lines = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));

    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    expect(lines).toEqual([
      {
        nodeId: "story-bible",
        type: "workflow",
        workflow: runningWorkflow,
      },
      {
        type: "done",
        workflow: doneWorkflow,
      },
    ]);
    expect(runStoryPlanningMock).toHaveBeenCalledWith(
      {
        rawIntent: "A courier follows a signal.",
        storyId: "story-1",
        targetShotCount: undefined,
        nsfwEnabled: undefined,
        settingsSnapshot: undefined,
        workflowId: "story-workflow-1",
      },
      expect.objectContaining({
        loadResourceCandidates: expect.any(Function),
        loadSamplerOptions: expect.any(Function),
        onWorkflowUpdate: expect.any(Function),
      }),
    );
  });
});
