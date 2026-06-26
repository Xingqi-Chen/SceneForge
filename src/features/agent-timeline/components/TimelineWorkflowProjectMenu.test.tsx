import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTimelineWorkflowRecord, createTimelineWorkflowState } from "@/features/agent-timeline";

const storageMocks = vi.hoisted(() => ({
  deleteTimelineWorkflowRecord: vi.fn(),
  listTimelineWorkflowSummaries: vi.fn(),
  loadTimelineWorkflowRecord: vi.fn(),
  renameTimelineWorkflowRecord: vi.fn(),
  saveTimelineWorkflowRecord: vi.fn(),
}));

vi.mock("@/features/agent-timeline/timeline-workflow-storage", () => storageMocks);

import { TimelineWorkflowProjectMenu } from "./TimelineWorkflowProjectMenu";

let container: HTMLDivElement;
let root: Root;

function createRecord(name = "Renamed workflow") {
  return createTimelineWorkflowRecord({
    projectId: "workflow-current",
    name,
    workflow: createTimelineWorkflowState({
      workflowId: "timeline-menu-record",
      sceneRequest: "A project menu scene",
      now: () => "2026-06-05T00:00:00.000Z",
    }),
    sceneRequest: "A project menu scene",
    selectedPromptProfile: "illustrious",
    selectedImageCount: 1,
    selectedNodeId: "scene-input",
  });
}

async function flushAsyncWork() {
  await act(async () => {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  });
}

function getButtonByText(text: string) {
  const button = Array.from(container.querySelectorAll("button")).find((candidate) =>
    candidate.textContent?.includes(text),
  );
  expect(button).not.toBeUndefined();
  return button as HTMLButtonElement;
}

function setNativeInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

  if (!setter) {
    throw new Error("Unable to set input value.");
  }

  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
  Object.values(storageMocks).forEach((mock) => mock.mockReset());
});

describe("TimelineWorkflowProjectMenu", () => {
  it("shows loading and empty states while listing saved workflows", async () => {
    let resolveList: (value: never[]) => void = () => undefined;
    storageMocks.listTimelineWorkflowSummaries.mockReturnValue(
      new Promise((resolve) => {
        resolveList = resolve;
      }),
    );

    act(() => {
      root.render(
        <TimelineWorkflowProjectMenu
          currentProjectId={null}
          currentProjectName=""
          getCurrentRecordInput={() => null}
          onDeleteCurrentProject={vi.fn()}
          onRecordOpened={vi.fn()}
          onRecordSaved={vi.fn()}
        />,
      );
    });

    act(() => {
      getButtonByText("Unnamed draft").click();
    });
    await flushAsyncWork();

    expect(container.textContent).toContain("Loading workflows...");

    await act(async () => {
      resolveList([]);
      await Promise.resolve();
    });
    await flushAsyncWork();

    expect(container.textContent).toContain("No saved workflows yet.");
  });

  it("shows a redacted list error from the client storage boundary", async () => {
    storageMocks.listTimelineWorkflowSummaries.mockRejectedValue(new Error("Unable to list timeline workflows."));

    act(() => {
      root.render(
        <TimelineWorkflowProjectMenu
          currentProjectId={null}
          currentProjectName=""
          getCurrentRecordInput={() => null}
          onDeleteCurrentProject={vi.fn()}
          onRecordOpened={vi.fn()}
          onRecordSaved={vi.fn()}
        />,
      );
    });

    act(() => {
      getButtonByText("Unnamed draft").click();
    });
    await flushAsyncWork();

    expect(container.textContent).toContain("Unable to list timeline workflows.");
    expect(container.textContent).not.toContain("C:\\Users\\Brandon");
  });

  it("filters saved workflows to the requested workflow mode", async () => {
    storageMocks.listTimelineWorkflowSummaries.mockResolvedValue([
      {
        id: "workflow-run",
        name: "Run workflow",
        createdAt: "2026-06-05T00:00:00.000Z",
        updatedAt: "2026-06-05T00:01:00.000Z",
        workflowMode: "single-image",
      },
      {
        id: "workflow-story",
        name: "Story workflow",
        createdAt: "2026-06-15T00:00:00.000Z",
        updatedAt: "2026-06-15T00:01:00.000Z",
        workflowMode: "story-graph",
      },
    ]);

    act(() => {
      root.render(
        <TimelineWorkflowProjectMenu
          currentProjectId={null}
          currentProjectName=""
          getCurrentRecordInput={() => null}
          onDeleteCurrentProject={vi.fn()}
          onRecordOpened={vi.fn()}
          onRecordSaved={vi.fn()}
          workflowMode="story-graph"
        />,
      );
    });

    act(() => {
      getButtonByText("Unnamed draft").click();
    });
    await flushAsyncWork();

    expect(container.textContent).toContain("Story workflow");
    expect(container.textContent).not.toContain("Run workflow");
  });

  it("renames the active named workflow and refreshes the saved workflow list", async () => {
    const renamedRecord = createRecord("Renamed workflow");
    const onRecordSaved = vi.fn();
    storageMocks.listTimelineWorkflowSummaries.mockResolvedValue([
      {
        id: "workflow-current",
        name: "Renamed workflow",
        createdAt: "2026-06-05T00:00:00.000Z",
        updatedAt: "2026-06-05T00:01:00.000Z",
        workflowMode: "single-image",
      },
    ]);
    storageMocks.renameTimelineWorkflowRecord.mockResolvedValue(renamedRecord);

    act(() => {
      root.render(
        <TimelineWorkflowProjectMenu
          currentProjectId="workflow-current"
          currentProjectName="Original workflow"
          getCurrentRecordInput={() => ({
            workflow: renamedRecord.workflow,
            sceneRequest: renamedRecord.sceneRequest,
            selectedPromptProfile: renamedRecord.selectedPromptProfile,
            selectedImageCount: renamedRecord.selectedImageCount,
            selectedNodeId: renamedRecord.selectedNodeId,
            outputDisplayModes: renamedRecord.outputDisplayModes,
          })}
          onDeleteCurrentProject={vi.fn()}
          onRecordOpened={vi.fn()}
          onRecordSaved={onRecordSaved}
        />,
      );
    });

    act(() => {
      getButtonByText("Original workflow").click();
    });
    await flushAsyncWork();

    const nameInput = container.querySelector("#timeline-workflow-name") as HTMLInputElement | null;
    expect(nameInput).not.toBeNull();
    act(() => {
      setNativeInputValue(nameInput!, "Renamed workflow");
    });
    await flushAsyncWork();

    await act(async () => {
      getButtonByText("Rename").click();
      await Promise.resolve();
    });
    await flushAsyncWork();

    expect(storageMocks.renameTimelineWorkflowRecord).toHaveBeenCalledWith("workflow-current", "Renamed workflow");
    expect(onRecordSaved).toHaveBeenCalledWith(renamedRecord);
    expect(storageMocks.listTimelineWorkflowSummaries).toHaveBeenCalledTimes(2);
  });
});
