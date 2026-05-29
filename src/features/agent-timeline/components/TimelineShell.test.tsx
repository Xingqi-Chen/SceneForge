import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

function submitInitialScene(sceneRequest: string) {
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

  it("submits a usable scene request into the vertical MVP timeline shell without persistence or API calls", () => {
    const storageSpy = vi.spyOn(Storage.prototype, "setItem");
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn<typeof fetch>();
    globalThis.fetch = fetchMock;

    try {
      act(() => {
        root.render(<TimelineShell />);
      });

      submitInitialScene("  A neon market alley with a courier at sunrise  ");

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
      expect(scenePromptSection.textContent).toContain("Ready");
      expect(scenePromptSection.textContent).toContain("Ready for scene prompt inference.");
      expect(scenePromptSection.textContent).toContain("Edit");
      expect(scenePromptSection.textContent).toContain("Regenerate");

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
      expect(fetchMock).not.toHaveBeenCalled();
      expect(window.localStorage.length).toBe(0);
      expect(window.sessionStorage.length).toBe(0);
      expect(container.textContent).not.toMatch(/C:\\|SCENEFORGE_|API_KEY|generated-images|data\//);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("surfaces downstream stale status after a manual scene prompt edit", () => {
    act(() => {
      root.render(<TimelineShell />);
    });

    submitInitialScene("A glass greenhouse control room");

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
    expect(draft?.value).toBe("");

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
  });
});
