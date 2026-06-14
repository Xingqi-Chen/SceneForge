import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

async function clickButtonAsync(label: string) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.replace(/\s+/g, " ").trim() === label,
  );

  if (!button) {
    throw new Error(`Unable to find button "${label}".`);
  }

  await act(async () => {
    (button as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();
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

describe("StoryPlanningPreview", () => {
  it("starts empty and initializes a user-started story graph workflow from request and optional shots", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          general: {
            nsfw: {
              supportsNsfw: true,
            },
          },
        }),
      }),
    );

    await act(async () => {
      root.render(<StoryPlanningPreview />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Story input / start workflow");
    expect(container.textContent).toContain("Start Story Graph");
    expect(container.textContent).not.toContain("Rain Station Signal");
    expect(container.textContent).not.toContain("Audience rating follows Settings NSFW");
    expect(container.textContent).not.toContain("Title");
    expect(container.textContent).not.toContain("Content warnings");
    expect(container.textContent).not.toContain("NSFW context");

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement | null;
    const shotsInput = Array.from(container.querySelectorAll("input")).find(
      (input) => input.getAttribute("type") === "number",
    ) as HTMLInputElement | undefined;

    expect(textarea).not.toBeNull();
    expect(shotsInput).toBeDefined();
    expect(container.querySelector("select")).toBeNull();

    act(() => {
      setNativeInputValue(textarea as HTMLTextAreaElement, "A detective follows a signal through a storm-lit city.");
      setNativeInputValue(shotsInput as HTMLInputElement, "4");
    });
    clickButton("Start planning");

    expect(container.textContent).toContain("User-started planning workflow");
    expect(container.textContent).toContain("15 steps");
    expect(container.textContent).toContain("story-input");
    expect(container.textContent).toContain("explicit");

    const executionButton = container.querySelector('button[data-node-id="shot-graph-execution"]') as HTMLButtonElement | null;

    expect(executionButton?.textContent).toContain("blocked");
  });

  it("keeps sample content behind a fallback start action", () => {
    act(() => {
      root.render(<StoryPlanningPreview />);
    });

    clickButton("Load fallback");

    expect(container.textContent).toContain("User-started planning workflow");
    expect(container.textContent).toContain("blue raincoat");

    const resourceButton = container.querySelector('button[data-node-id="resource-plan"]') as HTMLButtonElement | null;

    expect(resourceButton).not.toBeNull();

    act(() => {
      (resourceButton as HTMLButtonElement).click();
    });

    expect(container.textContent).toContain("Story planning fallback checkpoint");
  });

  it("supports Story request suggest and rewrite through the LLM chat boundary", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = typeof url === "string" ? url : url instanceof Request ? url.url : url.toString();

      if (target === "/api/settings") {
        return {
          ok: true,
          json: async () => ({
            general: {
              nsfw: {
                supportsNsfw: false,
              },
            },
          }),
        } as Response;
      }

      if (target === "/api/llm/chat") {
        const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: Array<{ content?: string }> };
        const userContent = body.messages?.[1]?.content ?? "{}";
        const payload = JSON.parse(userContent) as { action?: string };

        return {
          ok: true,
          json: async () => ({
            role: "assistant",
            content: JSON.stringify({
              storyRequest: payload.action === "rewrite"
                ? "A rewritten observatory story request with clearer continuity."
                : "A suggested observatory story request with three escalating visual beats.",
            }),
          }),
        } as Response;
      }

      throw new Error(`Unexpected fetch ${target}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<StoryPlanningPreview />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await clickButtonAsync("Suggest");

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement | null;

    expect(textarea?.value).toBe("A suggested observatory story request with three escalating visual beats.");

    await clickButtonAsync("Rewrite");

    expect(textarea?.value).toBe("A rewritten observatory story request with clearer continuity.");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/llm/chat",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("runs Story Graph planning and asks LLM for shot count when shots are omitted", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = typeof url === "string" ? url : url instanceof Request ? url.url : url.toString();

      if (target === "/api/settings") {
        return {
          ok: true,
          json: async () => ({
            general: {
              nsfw: {
                supportsNsfw: false,
              },
            },
          }),
        } as Response;
      }

      if (target === "/api/llm/chat") {
        const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: Array<{ content?: string }> };
        const userContent = body.messages?.[1]?.content ?? "{}";
        const payload = JSON.parse(userContent) as { storyRequest?: string };

        expect(payload.storyRequest).toBe("A courier finds an impossible doorway under the city.");

        return {
          ok: true,
          json: async () => ({
            role: "assistant",
            content: JSON.stringify({
              targetShotCount: 6,
            }),
          }),
        } as Response;
      }

      throw new Error(`Unexpected fetch ${target}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<StoryPlanningPreview />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement | null;

    act(() => {
      setNativeInputValue(textarea as HTMLTextAreaElement, "A courier finds an impossible doorway under the city.");
    });
    await clickButtonAsync("Start planning");

    expect(container.textContent).toContain("User-started planning workflow");
    expect(container.textContent).toContain('"targetShotCount": 6');
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/llm/chat",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });
});
