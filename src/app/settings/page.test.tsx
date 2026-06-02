import { act, type AnchorHTMLAttributes, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CentralSettingsPayload } from "@/features/settings/types";

import SettingsPage from "./page";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: ReactNode;
    href: string;
  } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

type FetchResponse = {
  ok: boolean;
  statusText: string;
  json: () => Promise<unknown>;
};

function jsonResponse(payload: unknown, ok = true, statusText = "OK"): FetchResponse {
  return {
    ok,
    statusText,
    json: async () => payload,
  };
}

function defer<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });

  return { promise, resolve };
}

function createSettingsPayload(paths: CentralSettingsPayload["civitai"]["paths"]): CentralSettingsPayload {
  return {
    general: {
      nsfw: {
        enabled: false,
        supportsNsfw: false,
        source: "default",
        detail: "NSFW UI mode is disabled unless SCENEFORGE_SHOW_NSFW_BUTTON=true.",
      },
    },
    workflow: {
      characterTagNewTermDefaultOption: "ask",
      autoReview: false,
    },
    storage: {
      paths: [
        {
          id: "projects",
          label: "Project storage",
          value: "C:/SceneForge/data/projects",
          source: "default",
          editable: false,
          state: "default",
          detail: "Using the built-in default path.",
        },
      ],
    },
    civitai: {
      paths,
      pathStatuses: [
        {
          id: "loraDownloadPath",
          label: "LoRA download path",
          value: paths.loraDownloadPath || null,
          source: "sqlite",
          editable: true,
          state: paths.loraDownloadPath ? "configured" : "missing",
          detail: "Saved in SceneForge's local SQLite settings.",
        },
      ],
    },
    integrations: [
      {
        id: "civitai",
        label: "Civitai",
        state: paths.loraDownloadPath ? "configured" : "missing",
        detail: paths.loraDownloadPath ? "1 resource path configured." : "No resource paths are configured yet.",
        config: [
          { label: "API key", configured: false, redacted: true },
          { label: "Editable resource paths", value: paths.loraDownloadPath ? "1/4 configured" : "0/4 configured" },
        ],
      },
    ],
  };
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function changeInputValue(input: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  valueSetter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("SettingsPage", () => {
  let container: HTMLDivElement;
  let root: Root;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("shows the loading state and then renders fetched settings", async () => {
    const load = defer<FetchResponse>();
    fetchMock.mockReturnValueOnce(load.promise);

    act(() => {
      root.render(<SettingsPage />);
    });
    act(() => {
      vi.runOnlyPendingTimers();
    });

    expect(container.textContent).toContain("Loading settings");
    expect(fetchMock).toHaveBeenCalledWith("/api/settings", undefined);

    load.resolve(
      jsonResponse(
        createSettingsPayload({
          loraDownloadPath: "D:/models/loras",
          checkpointDownloadPath: "",
          diffusionModelPath: "/mnt/models/diffusion",
          controlNetModelPath: "",
        }),
      ),
    );
    await flushPromises();

    expect(container.textContent).toContain("Civitai Resource Paths");
    expect(container.textContent).toContain("Workflow Defaults");
    const inputValues = Array.from(container.querySelectorAll("input")).map((input) => input.value);
    expect(inputValues).toContain("D:/models/loras");
    expect(inputValues).toContain("/mnt/models/diffusion");
  });

  it("saves trimmed Civitai paths and reports field validation errors", async () => {
    const initialPayload = createSettingsPayload({
      loraDownloadPath: "",
      checkpointDownloadPath: "",
      diffusionModelPath: "",
      controlNetModelPath: "",
    });
    const savedPayload = createSettingsPayload({
      loraDownloadPath: "D:/models/loras",
      checkpointDownloadPath: "",
      diffusionModelPath: "",
      controlNetModelPath: "",
    });

    fetchMock
      .mockResolvedValueOnce(jsonResponse(initialPayload))
      .mockResolvedValueOnce(jsonResponse(savedPayload))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              message: "One or more Civitai paths are invalid.",
              details: {
                loraDownloadPath: "LoRA download path must be an absolute local path.",
              },
            },
          },
          false,
          "Bad Request",
        ),
      );

    act(() => {
      root.render(<SettingsPage />);
    });
    act(() => {
      vi.runOnlyPendingTimers();
    });
    await flushPromises();

    const loraInput = container.querySelector(
      'input[placeholder="D:/StableDiffusion/models/Lora"]',
    ) as HTMLInputElement;
    const saveButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Save Civitai Paths"),
    );

    expect(saveButton?.hasAttribute("disabled")).toBe(true);

    act(() => {
      changeInputValue(loraInput, "  D:/models/loras  ");
    });

    expect(saveButton?.hasAttribute("disabled")).toBe(false);

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushPromises();

    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/settings",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          civitai: {
            paths: {
              loraDownloadPath: "D:/models/loras",
              checkpointDownloadPath: "",
              diffusionModelPath: "",
              controlNetModelPath: "",
            },
          },
        }),
      }),
    );
    expect(container.textContent).toContain("Civitai paths saved.");

    act(() => {
      changeInputValue(loraInput, "relative/path");
    });
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushPromises();

    expect(container.textContent).toContain("One or more Civitai paths are invalid.");
    expect(container.textContent).toContain("LoRA download path must be an absolute local path.");
  });

  it("shows the NSFW button only when NSFW UI is enabled and saves workflow defaults", async () => {
    const initialPayload = createSettingsPayload({
      loraDownloadPath: "",
      checkpointDownloadPath: "",
      diffusionModelPath: "",
      controlNetModelPath: "",
    });
    const nsfwPayload: CentralSettingsPayload = {
      ...initialPayload,
      general: {
        nsfw: {
          ...initialPayload.general.nsfw,
          enabled: true,
        },
      },
    };
    const savedNsfwPayload: CentralSettingsPayload = {
      ...nsfwPayload,
      general: {
        nsfw: {
          ...nsfwPayload.general.nsfw,
          supportsNsfw: true,
        },
      },
    };
    const savedTagDefaultPayload: CentralSettingsPayload = {
      ...savedNsfwPayload,
      workflow: {
        characterTagNewTermDefaultOption: "import",
        autoReview: false,
      },
    };
    const savedWorkflowPayload: CentralSettingsPayload = {
      ...savedTagDefaultPayload,
      workflow: {
        characterTagNewTermDefaultOption: "import",
        autoReview: true,
      },
    };

    fetchMock
      .mockResolvedValueOnce(jsonResponse(initialPayload))
      .mockResolvedValueOnce(jsonResponse(nsfwPayload))
      .mockResolvedValueOnce(jsonResponse(savedNsfwPayload))
      .mockResolvedValueOnce(jsonResponse(savedTagDefaultPayload))
      .mockResolvedValueOnce(jsonResponse(savedWorkflowPayload))

    act(() => {
      root.render(<SettingsPage />);
    });
    act(() => {
      vi.runOnlyPendingTimers();
    });
    await flushPromises();

    expect(container.textContent).not.toContain("NSFW recommendations");

    await act(async () => {
      const refreshButton = Array.from(container.querySelectorAll("button")).find((button) =>
        button.textContent?.includes("Refresh"),
      );
      refreshButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushPromises();

    const nsfwButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Disabled"),
    );
    expect(nsfwButton).toBeDefined();

    await act(async () => {
      nsfwButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushPromises();

    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/settings",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          general: {
            nsfw: {
              supportsNsfw: true,
            },
          },
        }),
      }),
    );

    const select = container.querySelector("select") as HTMLSelectElement;
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
      valueSetter?.call(select, "import");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flushPromises();

    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/settings",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          workflow: {
            characterTagNewTermDefaultOption: "import",
          },
        }),
      }),
    );

    const autoReviewCheckbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await act(async () => {
      autoReviewCheckbox.click();
    });
    await flushPromises();

    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/settings",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          workflow: {
            autoReview: true,
          },
        }),
      }),
    );
    expect(container.textContent).not.toContain("NSFW UI mode");
  });
});
