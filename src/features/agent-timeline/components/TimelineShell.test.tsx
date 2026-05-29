import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDefaultProject } from "@/features/editor/store/defaults";
import { useEditorStore } from "@/features/editor/store/editor-store";

vi.mock("@/features/editor/components/CanvasViewport", () => ({
  CanvasViewport: () => (
    <div data-testid="existing-editor-canvas-viewport">Existing editor 3D canvas viewport</div>
  ),
}));

vi.mock("@/features/editor/components/PromptTagPickerPanel", () => ({
  PromptTagPickerPanel: () => (
    <div data-testid="existing-prompt-tag-picker-panel">Existing prompt tag picker panel</div>
  ),
}));

import { TimelineShell } from "./TimelineShell";

const nodeTitles = [
  "Scene input",
  "Prompt generation",
  "Character tags",
  "Action planning",
  "Layout planning",
  "Model resources",
  "Render prompt",
  "Review / export",
  "Render execution",
  "Artifact result",
];

let container: HTMLDivElement;
let root: Root;

function createJsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

function createPoseResponse() {
  return JSON.stringify({
    characterDescription: "courier leaping across wet pavement",
    targets: {
      pelvis: { x: 0, y: 1.05, z: 0 },
      chest: { x: 0, y: 1.45, z: 0.08 },
      head: { x: 0, y: 1.72, z: 0.1 },
      leftHand: { x: -0.5, y: 1.25, z: 0.2 },
      rightHand: { x: 0.45, y: 1.36, z: -0.1 },
      leftFoot: { x: -0.2, y: 0.35, z: 0.22 },
      rightFoot: { x: 0.25, y: 0.04, z: -0.08 },
    },
    poles: {
      leftElbowPole: { x: -0.65, y: 1.2, z: 0.25 },
      rightElbowPole: { x: 0.65, y: 1.2, z: 0.15 },
      leftKneePole: { x: -0.28, y: 0.58, z: 0.8 },
      rightKneePole: { x: 0.28, y: 0.52, z: 0.2 },
    },
  });
}

function getFetchPurpose(init: RequestInit | undefined) {
  return typeof init?.body === "string" ? (JSON.parse(init.body) as { purpose?: string }).purpose : undefined;
}

function createT5ResponseForPurpose(purpose: string | undefined) {
  if (purpose === "stable-diffusion-prompt-generation") {
    return createJsonResponse({
      role: "assistant",
      content: JSON.stringify({
        positivePrompt: "neon market alley, sunrise, courier sprinting",
        negativeSuggestions: ["low detail"],
        style: [{ label: "Cinematic", prompt: "cinematic realism" }],
        camera: [{ label: "Wide", prompt: "wide angle tracking shot" }],
        lighting: [{ label: "Rim", prompt: "warm sunrise rim light" }],
      }),
    });
  }

  if (purpose === "prompt-tag-reverse") {
    return createJsonResponse({
      role: "assistant",
      content: JSON.stringify({
        primaryCharacter: {
          name: "Courier",
          description: "A focused courier in a reflective jacket",
        },
        tags: [
          {
            label: "Courier",
            prompt: "solo courier protagonist",
            category: "character",
            subcategory: "character-subject",
          },
          {
            label: "Jacket",
            prompt: "reflective yellow jacket",
            category: "outfit",
            subcategory: "outfit-upper",
            bodyPartId: "torso",
          },
        ],
        extraPeopleContext: ["distant shoppers are background context"],
      }),
    });
  }

  return createJsonResponse({
    role: "assistant",
    content: createPoseResponse(),
  });
}

function mockT5Fetch() {
  return vi.fn<typeof fetch>(async (_input, init) => createT5ResponseForPurpose(getFetchPurpose(init)));
}

function mockT5FetchWithDeferredPose() {
  const poseRequests: Array<{
    reject: (reason?: unknown) => void;
    resolve: (response: Response) => void;
  }> = [];

  const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
    const purpose = getFetchPurpose(init);

    if (purpose !== "stick-figure-pose-generation") {
      return createT5ResponseForPurpose(purpose);
    }

    return new Promise<Response>((resolve, reject) => {
      poseRequests.push({
        reject,
        resolve,
      });
    });
  });

  return { fetchMock, poseRequests };
}

async function flushAsyncWork(cycles = 6) {
  for (let index = 0; index < cycles; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function getButtonByText(label: string) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.replace(/\s+/g, " ").trim() === label,
  );

  if (!button) {
    throw new Error(`Unable to find button "${label}".`);
  }

  return button as HTMLButtonElement;
}

function getSectionByHeading(headingText: string) {
  const heading = Array.from(container.querySelectorAll("h2")).find(
    (candidate) => candidate.textContent?.trim() === headingText,
  );
  const section = heading?.closest("section");

  if (!section) {
    throw new Error(`Unable to find section "${headingText}".`);
  }

  return section as HTMLElement;
}

function getWorkflowStepTitles() {
  return Array.from(container.querySelectorAll("button[data-node-id]"))
    .map((button) => button.textContent?.replace(/\s+/g, " ").trim() ?? "")
    .map((text) => nodeTitles.find((title) => text.includes(title)))
    .filter((title): title is string => Boolean(title));
}

function setNativeTextAreaValue(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;

  if (!setter) {
    throw new Error("Unable to set textarea value.");
  }

  setter.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

async function submitInitialScene(sceneRequest: string) {
  const textarea = container.querySelector("#scene-request") as HTMLTextAreaElement | null;
  const form = container.querySelector("form");

  if (!textarea || !form) {
    throw new Error("Initial scene form is not rendered.");
  }

  act(() => {
    setNativeTextAreaValue(textarea, sceneRequest);
  });

  act(() => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });

  await flushAsyncWork();
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useEditorStore.getState().setProject(createDefaultProject());
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

describe("TimelineShell", () => {
  it("starts with the workbench, workflow steps, scene composer, and disabled run actions for blank input", () => {
    act(() => {
      root.render(<TimelineShell />);
    });

    const sceneInput = container.querySelector("#scene-request") as HTMLTextAreaElement | null;
    const startButton = getButtonByText("Start workflow");
    const settingsLink = container.querySelector('a[href="/settings"]');

    expect(sceneInput).not.toBeNull();
    expect(startButton.disabled).toBe(true);
    expect(settingsLink?.textContent).toContain("Settings");
    expect(getWorkflowStepTitles()).toEqual(nodeTitles);
    expect(container.textContent).toContain("Inspector");
    expect(container.textContent).toContain("Agent activity");
    expect(container.textContent).toContain("Tool calls");
    expect(container.textContent).toContain("Generated artifacts");

    const workbench = container.querySelector(".sf-agent-workbench");
    const nav = container.querySelector(".sf-agent-workbench__nav");
    const main = container.querySelector(".sf-agent-workbench__main");
    const inspector = container.querySelector(".sf-agent-workbench__inspector");

    expect(workbench?.className).toContain("lg:flex-row");
    expect(nav?.className).toContain("order-2");
    expect(nav?.className).toContain("lg:order-1");
    expect(main?.className).toContain("order-1");
    expect(main?.className).toContain("lg:order-2");
    expect(inspector?.className).toContain("order-3");

    const form = container.querySelector("form");
    expect(form).not.toBeNull();

    act(() => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(container.textContent).toContain("Waiting for scene command.");

    act(() => {
      setNativeTextAreaValue(sceneInput as HTMLTextAreaElement, "   ");
    });

    expect(getButtonByText("Start workflow").disabled).toBe(true);
  });

  it("submits a usable scene request into the LangGraph T5 timeline without persistence or reserved service calls", async () => {
    const storageSpy = vi.spyOn(Storage.prototype, "setItem");
    const originalFetch = globalThis.fetch;
    const fetchMock = mockT5Fetch();
    globalThis.fetch = fetchMock;

    try {
      act(() => {
        root.render(<TimelineShell />);
      });

      await submitInitialScene("  A neon market alley with a courier at sunrise  ");

      expect(getWorkflowStepTitles()).toEqual(nodeTitles);
      expect(container.textContent).toContain("A neon market alley with a courier at sunrise");

      const sceneInputSection = getSectionByHeading("Scene input");
      expect(sceneInputSection.textContent).toContain("Done");
      expect(sceneInputSection.textContent).toContain("A neon market alley with a courier at sunrise");
      expect(sceneInputSection.textContent).toContain("Rewrite");

      const promptStepButton = container.querySelector('button[data-node-id="scene-prompt"]') as HTMLButtonElement | null;
      expect(promptStepButton).not.toBeNull();

      act(() => {
        promptStepButton?.click();
      });

      const scenePromptSection = getSectionByHeading("Prompt generation");
      expect(scenePromptSection.textContent).toContain("Done");
      expect(scenePromptSection.textContent).toContain("neon market alley, sunrise, courier sprinting");
      expect(scenePromptSection.textContent).toContain("Edit");
      expect(scenePromptSection.textContent).toContain("Regenerate");

      const characterTagsButton = container.querySelector('button[data-node-id="character-tags"]') as HTMLButtonElement | null;
      act(() => {
        characterTagsButton?.click();
      });

      const characterTagsSection = getSectionByHeading("Character tags");
      expect(characterTagsSection.textContent).toContain("Existing editor 3D canvas viewport");
      expect(characterTagsSection.textContent).toContain("Existing prompt tag picker panel");
      expect(characterTagsSection.textContent).toContain("Prompt tags bound");
      expect(characterTagsSection.textContent).toContain("JSON diagnostics");
      expect(characterTagsSection.textContent).toContain("reflective yellow jacket");

      const actionButton = container.querySelector('button[data-node-id="character-action"]') as HTMLButtonElement | null;
      act(() => {
        actionButton?.click();
      });

      const characterActionSection = getSectionByHeading("Action planning");
      expect(characterActionSection.textContent).toContain("Existing editor 3D canvas viewport");
      expect(characterActionSection.textContent).toContain("Existing prompt tag picker panel");
      expect(characterActionSection.textContent).toContain("Pose bound to 3D character");
      expect(characterActionSection.textContent).toContain("JSON diagnostics");

      const canvasButton = container.querySelector('button[data-node-id="canvas-binding"]') as HTMLButtonElement | null;
      act(() => {
        canvasButton?.click();
      });

      const canvasSection = getSectionByHeading("Layout planning");
      expect(canvasSection.textContent).toContain("Existing editor 3D canvas viewport");
      expect(canvasSection.textContent).toContain("Existing prompt tag picker panel");
      expect(canvasSection.textContent).toContain("3D layout binding active");
      expect(canvasSection.textContent).toContain("JSON diagnostics");
      expect(canvasSection.textContent).toContain("editable 3D character");
      expect(canvasSection.textContent).toContain("Courier");

      const generationGateButton = container.querySelector('button[data-node-id="generation-gate"]') as HTMLButtonElement | null;
      act(() => {
        generationGateButton?.click();
      });

      const generationGateSection = getSectionByHeading("Review / export");
      expect(generationGateSection.textContent).toContain(
        "ComfyUI execution requires explicit future confirmation. This shell stops at the gate and never starts generation.",
      );

      const comfyButton = container.querySelector('button[data-node-id="comfyui-execution"]') as HTMLButtonElement | null;
      act(() => {
        comfyButton?.click();
      });

      const comfyExecutionSection = getSectionByHeading("Render execution");
      expect(comfyExecutionSection.textContent).toContain("Reserved");
      expect(comfyExecutionSection.textContent).toContain(
        "ComfyUI remains blocked until a future explicit confirmation flow starts generation.",
      );

      const resultButton = container.querySelector('button[data-node-id="result-display"]') as HTMLButtonElement | null;
      act(() => {
        resultButton?.click();
      });

      const resultSection = getSectionByHeading("Artifact result");
      expect(resultSection.textContent).toContain("Reserved");
      expect(resultSection.textContent).toContain(
        "Result display remains empty until confirmed ComfyUI execution returns an image.",
      );

      expect(storageSpy).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(
        fetchMock.mock.calls.map(([input]) => String(input)),
      ).toEqual(["/api/llm/chat", "/api/llm/chat", "/api/llm/chat"]);
      expect(window.localStorage.length).toBe(0);
      expect(window.sessionStorage.length).toBe(0);
      expect(container.textContent).not.toMatch(/C:\\|SCENEFORGE_|API_KEY|generated-images|data\//);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("ignores stale graph results and canvas binding after starting a new scene", async () => {
    const originalFetch = globalThis.fetch;
    const { fetchMock, poseRequests } = mockT5FetchWithDeferredPose();
    globalThis.fetch = fetchMock;

    try {
      act(() => {
        root.render(<TimelineShell />);
      });

      await submitInitialScene("A stale neon market courier scene");

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(poseRequests).toHaveLength(1);
      expect(container.textContent).toContain("A stale neon market courier scene");

      act(() => {
        getButtonByText("New scene").click();
      });

      expect((container.querySelector("#scene-request") as HTMLTextAreaElement | null)?.value).toBe("");
      expect(container.textContent).toContain("Waiting for scene command.");
      expect(container.textContent).not.toContain("A stale neon market courier scene");

      await act(async () => {
        poseRequests[0]?.resolve(createT5ResponseForPurpose("stick-figure-pose-generation"));
        await Promise.resolve();
      });
      await flushAsyncWork();

      const editorState = useEditorStore.getState();

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect((container.querySelector("#scene-request") as HTMLTextAreaElement | null)?.value).toBe("");
      expect(container.textContent).toContain("Waiting for scene command.");
      expect(container.textContent).not.toContain("A stale neon market courier scene");
      expect(container.textContent).not.toContain("neon market alley, sunrise, courier sprinting");
      expect(container.textContent).not.toContain("Courier");
      expect(editorState.project.scene.mode).toBe("2d");
      expect(editorState.project.scene.characters).toHaveLength(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("surfaces downstream stale status after a manual scene prompt edit", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockT5Fetch();

    try {
      act(() => {
        root.render(<TimelineShell />);
      });

      await submitInitialScene("A glass greenhouse control room");

      const promptStepButton = container.querySelector('button[data-node-id="scene-prompt"]') as HTMLButtonElement | null;

      act(() => {
        promptStepButton?.click();
      });

      const scenePromptSection = getSectionByHeading("Prompt generation");
      const editButton = Array.from(scenePromptSection.querySelectorAll("button")).find(
        (button) => button.textContent?.replace(/\s+/g, " ").trim() === "Edit",
      ) as HTMLButtonElement | undefined;

      expect(editButton).not.toBeUndefined();

      act(() => {
        editButton?.click();
      });

      let draft = scenePromptSection.querySelector("textarea") as HTMLTextAreaElement | null;
      expect(draft).not.toBeNull();

      act(() => {
        setNativeTextAreaValue(draft as HTMLTextAreaElement, "discarded prompt draft");
      });

      const cancelButton = Array.from(scenePromptSection.querySelectorAll("button")).find((button) =>
        button.textContent?.includes("Cancel"),
      ) as HTMLButtonElement | undefined;

      act(() => {
        cancelButton?.click();
      });

      act(() => {
        editButton?.click();
      });

      draft = scenePromptSection.querySelector("textarea") as HTMLTextAreaElement | null;
      expect(draft?.value).toContain("neon market alley, sunrise, courier sprinting");

      act(() => {
        setNativeTextAreaValue(draft as HTMLTextAreaElement, "wide lens greenhouse command deck");
      });

      const saveButton = Array.from(scenePromptSection.querySelectorAll("button")).find((button) =>
        button.textContent?.includes("Save manual"),
      ) as HTMLButtonElement | undefined;

      expect(saveButton?.disabled).toBe(false);

      act(() => {
        saveButton?.click();
      });

      expect(getSectionByHeading("Prompt generation").textContent).toContain("Done");
      expect(getSectionByHeading("Prompt generation").textContent).toContain("wide lens greenhouse command deck");

      for (const title of nodeTitles.slice(2)) {
        const stepButton = Array.from(container.querySelectorAll("button[data-node-id]")).find((button) =>
          button.textContent?.includes(title),
        );

        expect(stepButton?.textContent).toContain("Pending");
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
