import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { StoryPlanningPreview } from "./StoryPlanningPreview";

let container: HTMLDivElement;
let root: Root;

function setNativeInputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;

  if (!setter) {
    throw new Error("Unable to set input value.");
  }

  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function setNativeSelectValue(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;

  if (!setter) {
    throw new Error("Unable to set select value.");
  }

  setter.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
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
});

describe("StoryPlanningPreview", () => {
  it("starts empty and initializes a user-started story graph workflow", () => {
    act(() => {
      root.render(<StoryPlanningPreview />);
    });

    expect(container.textContent).toContain("Story input / start workflow");
    expect(container.textContent).toContain("Start Story Graph");
    expect(container.textContent).not.toContain("Rain Station Signal");

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement | null;
    const titleInput = Array.from(container.querySelectorAll("input")).find(
      (input) => input.closest("label")?.textContent?.includes("Title"),
    ) as HTMLInputElement | undefined;
    const shotsInput = Array.from(container.querySelectorAll("input")).find(
      (input) => input.getAttribute("type") === "number",
    ) as HTMLInputElement | undefined;
    const select = container.querySelector("select") as HTMLSelectElement | null;

    expect(textarea).not.toBeNull();
    expect(titleInput).toBeDefined();
    expect(shotsInput).toBeDefined();
    expect(select).not.toBeNull();

    act(() => {
      setNativeInputValue(textarea as HTMLTextAreaElement, "A detective follows a signal through a storm-lit city.");
      setNativeInputValue(titleInput as HTMLInputElement, "Storm Signal");
      setNativeInputValue(shotsInput as HTMLInputElement, "4");
      setNativeSelectValue(select as HTMLSelectElement, "mature");
    });
    clickButton("Start planning");

    expect(container.textContent).toContain("User-started planning workflow");
    expect(container.textContent).toContain("15 steps");
    expect(container.textContent).toContain("Storm Signal");
    expect(container.textContent).toContain("story-input");
    expect(container.textContent).toContain("mature");

    const executionButton = container.querySelector('button[data-node-id="shot-graph-execution"]') as HTMLButtonElement | null;

    expect(executionButton?.textContent).toContain("blocked");
  });

  it("keeps sample content behind a fallback start action", () => {
    act(() => {
      root.render(<StoryPlanningPreview />);
    });

    clickButton("Load fallback");

    expect(container.textContent).toContain("User-started planning workflow");
    expect(container.textContent).toContain("Rain Station Signal");

    const resourceButton = container.querySelector('button[data-node-id="resource-plan"]') as HTMLButtonElement | null;

    expect(resourceButton).not.toBeNull();

    act(() => {
      (resourceButton as HTMLButtonElement).click();
    });

    expect(container.textContent).toContain("Story planning fallback checkpoint");
  });
});
