import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  StoryManualEditScope,
  StoryWorkflowNodeResult,
} from "@/features/agent-timeline/story-state";
import type {
  CharacterContinuityGraph,
  PlotStateGraph,
  ShotDependencyGraph,
  StorySafetyPlan,
  StoryShot,
  StoryWorkflowNodeId,
} from "@/features/agent-timeline/story-types";

import { StoryPlanningWorkspace } from "./StoryPlanningWorkspace";

let container: HTMLDivElement;
let root: Root;

const updatedAt = "2026-06-14T00:00:00.000Z";

const shots = [
  {
    id: "shot-1",
    storyId: "story-1",
    order: 1,
    title: "Arrival",
    description: "The hero enters the station.",
    characterIds: ["hero"],
    sourceShotIds: [],
    camera: "wide",
    promptIntent: "quiet station arrival",
    continuityNotes: [],
  },
  {
    id: "shot-2",
    storyId: "story-1",
    order: 2,
    title: "Signal",
    description: "The hero notices a signal.",
    characterIds: ["hero"],
    sourceShotIds: ["shot-1"],
    camera: "medium",
    promptIntent: "signal reflection",
    continuityNotes: ["Keep the coat consistent."],
  },
] satisfies StoryShot[];

function makeNode<T>(nodeId: StoryWorkflowNodeId, result: T): StoryWorkflowNodeResult<T> {
  return {
    nodeId,
    result,
    source: "ai",
    status: "done",
    updatedAt,
  };
}

function setNativeInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

  if (!setter) {
    throw new Error("Unable to set input value.");
  }

  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function setNativeTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;

  if (!setter) {
    throw new Error("Unable to set textarea value.");
  }

  setter.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

function clickButton(label: string) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.replace(/\s+/g, " ").trim() === label,
  );

  if (!button) {
    throw new Error(`Unable to find button "${label}".`);
  }

  act(() => {
    (button as HTMLButtonElement).click();
  });
}

function clickButtonAt(label: string, index: number) {
  const buttons = Array.from(container.querySelectorAll("button")).filter(
    (candidate) => candidate.textContent?.replace(/\s+/g, " ").trim() === label,
  );
  const button = buttons[index];

  if (!button) {
    throw new Error(`Unable to find button "${label}" at index ${index}.`);
  }

  act(() => {
    (button as HTMLButtonElement).click();
  });
}

function renderWorkspace({
  node,
  onSave = vi.fn(),
  storyId = "story-1",
}: {
  node: StoryWorkflowNodeResult;
  onSave?: (nodeId: StoryWorkflowNodeId, result: unknown, scope: StoryManualEditScope) => void;
  storyId?: string;
}) {
  act(() => {
    root.render(
      <StoryPlanningWorkspace
        editable
        emptyState="No story artifact."
        node={node}
        onSave={onSave}
        storyId={storyId}
      />,
    );
  });

  return onSave;
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
});

describe("StoryPlanningWorkspace", () => {
  it("saves storyboard shot edits with the edited shot scope", () => {
    const onSave = renderWorkspace({
      node: makeNode("storyboard-shots", shots),
    });
    const titleInputs = Array.from(container.querySelectorAll("input")).filter(
      (input) => input.value === "Arrival" || input.value === "Signal",
    ) as HTMLInputElement[];

    expect(titleInputs).toHaveLength(2);

    act(() => {
      setNativeInputValue(titleInputs[1] as HTMLInputElement, "Signal close-up");
    });
    clickButtonAt("Save shot", 1);

    expect(onSave).toHaveBeenCalledWith(
      "storyboard-shots",
      expect.arrayContaining([
        expect.objectContaining({ id: "shot-2", title: "Signal close-up" }),
      ]),
      {
        artifactType: "storyboard-shots",
        kind: "shot",
        shotId: "shot-2",
        storyId: "story-1",
      },
    );
  });

  it("saves shot dependency graph edits against the target shot scope", () => {
    const graph = {
      storyId: "story-1",
      nodes: [
        { shotId: "shot-1", label: "Arrival" },
        { shotId: "shot-2", label: "Signal" },
        { shotId: "shot-3", label: "Cutaway" },
      ],
      edges: [{ fromShotId: "shot-1", toShotId: "shot-2", reason: "img2img-source" }],
    } satisfies ShotDependencyGraph;
    const onSave = renderWorkspace({
      node: makeNode("shot-dependency-graph", graph),
    });

    clickButton("Save edge");

    expect(onSave).toHaveBeenCalledWith("shot-dependency-graph", graph, {
      artifactType: "shot-dependency-graph",
      kind: "shot",
      shotId: "shot-2",
      storyId: "story-1",
    });
  });

  it("preserves saved shot dependency edge reasons and exposes all reason options", () => {
    const graph = {
      storyId: "story-1",
      nodes: [
        { shotId: "shot-1", label: "Arrival" },
        { shotId: "shot-2", label: "Signal" },
      ],
      edges: [{ fromShotId: "shot-1", toShotId: "shot-2", reason: "continuity" }],
    } satisfies ShotDependencyGraph;
    const onSave = renderWorkspace({
      node: makeNode("shot-dependency-graph", graph),
    });
    const reasonSelect = Array.from(container.querySelectorAll("select")).find(
      (select) => Array.from(select.options).some((option) => option.value === "img2img-source"),
    ) as HTMLSelectElement | undefined;

    expect(reasonSelect?.value).toBe("continuity");
    expect(Array.from(reasonSelect?.options ?? []).map((option) => option.value)).toEqual([
      "img2img-source",
      "reference",
      "continuity",
      "story-order",
      "manual",
    ]);

    act(() => {
      if (!reasonSelect) {
        throw new Error("Unable to find dependency reason select.");
      }
      reasonSelect.value = "story-order";
      reasonSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    clickButton("Save edge");

    expect(onSave).toHaveBeenCalledWith(
      "shot-dependency-graph",
      expect.objectContaining({
        edges: [{ fromShotId: "shot-1", toShotId: "shot-2", reason: "story-order" }],
      }),
      {
        artifactType: "shot-dependency-graph",
        kind: "shot",
        shotId: "shot-2",
        storyId: "story-1",
      },
    );
  });

  it("rejects invalid shared JSON drafts without saving", () => {
    const resourcePlan = {
      storyId: "story-1",
      resources: [],
    };
    const onSave = renderWorkspace({
      node: makeNode("resource-plan", resourcePlan),
    });
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement | null;

    expect(textarea).not.toBeNull();

    act(() => {
      setNativeTextareaValue(textarea as HTMLTextAreaElement, "{ invalid json");
    });
    clickButton("Save JSON");

    expect(onSave).not.toHaveBeenCalled();
    expect(container.textContent).toMatch(/JSON|Expected|Unexpected/i);
  });

  it("saves story safety edits with story-level scope", () => {
    const safetyPlan = {
      storyId: "story-1",
      audienceRating: "safe",
      contentWarnings: [],
      blockedContent: [],
      perShotNotes: [],
    } satisfies StorySafetyPlan;
    const onSave = renderWorkspace({
      node: makeNode("story-safety-plan", safetyPlan),
    });
    const warningsTextarea = container.querySelector("textarea") as HTMLTextAreaElement | null;

    expect(warningsTextarea).not.toBeNull();

    act(() => {
      setNativeTextareaValue(warningsTextarea as HTMLTextAreaElement, "flashing lights, peril");
    });
    clickButton("Save safety plan");

    expect(onSave).toHaveBeenCalledWith(
      "story-safety-plan",
      expect.objectContaining({
        contentWarnings: ["flashing lights", "peril"],
      }),
      {
        artifactType: "story-safety-plan",
        kind: "story",
        storyId: "story-1",
      },
    );
  });

  it("saves plot state and character continuity workspaces with story scope", () => {
    const plotState = {
      storyId: "story-1",
      states: [
        {
          id: "state-1",
          title: "Arrival established",
          summary: "The station is introduced.",
          shotIds: ["shot-1"],
        },
      ],
      transitions: [],
    } satisfies PlotStateGraph;
    const continuity = {
      storyId: "story-1",
      characters: [
        {
          characterId: "hero",
          name: "Hero",
          canonicalDescription: "A traveler in a blue coat.",
          visualAnchors: ["blue coat"],
        },
      ],
      appearances: [
        {
          shotId: "shot-1",
          characterId: "hero",
          wardrobe: ["blue coat"],
          poseOrAction: "walking",
          expression: "focused",
          continuityNotes: [],
        },
      ],
    } satisfies CharacterContinuityGraph;
    const onSave = vi.fn();

    renderWorkspace({
      node: makeNode("plot-state-graph", plotState),
      onSave,
    });
    clickButton("Save plot states");

    expect(onSave).toHaveBeenLastCalledWith("plot-state-graph", plotState, {
      artifactType: "plot-state-graph",
      kind: "story",
      storyId: "story-1",
    });

    act(() => {
      root.render(
        <StoryPlanningWorkspace
          editable
          emptyState="No story artifact."
          node={makeNode("character-continuity-graph", continuity)}
          onSave={onSave}
          storyId="story-1"
        />,
      );
    });
    clickButton("Save continuity");

    expect(onSave).toHaveBeenLastCalledWith("character-continuity-graph", continuity, {
      artifactType: "character-continuity-graph",
      kind: "story",
      storyId: "story-1",
    });
  });
});
