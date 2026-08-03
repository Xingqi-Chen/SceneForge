import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CharacterReferenceSnapshot } from "@/features/agent-timeline/style-reference";

import { CharacterReferencePanel } from "./CharacterReferencePanel";

let container: HTMLDivElement;
let root: Root;

const selectedCheckpoint = {
  id: "checkpoint-a",
  resourceType: "model" as const,
  name: "Illustrious checkpoint",
  versionName: "v1",
  baseModel: "Illustrious",
  creator: "creator",
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
  modelFileName: "illustrious.safetensors",
  modelStorageKind: "checkpoint" as const,
};

function readySnapshot(filename = "existing.png"): CharacterReferenceSnapshot {
  return {
    status: "ready",
    strength: 0.65,
    metadata: {
      byteLength: 3,
      contentType: "image/png",
      filename,
      storedFilename: "0123456789abcdef0123456789abcdef.png",
      uploadedAt: "2026-08-02T00:00:00.000Z",
      url: "/api/comfyui/sequence-references/0123456789abcdef0123456789abcdef.png",
    },
  };
}

function Harness({ initialSnapshot }: { initialSnapshot?: CharacterReferenceSnapshot }) {
  const [displayMode, setDisplayMode] = useState<"simple" | "detailed">("simple");
  const [snapshot, setSnapshot] = useState(initialSnapshot);

  return (
    <div>
      <output data-testid="display-mode">{displayMode}</output>
      <output data-testid="snapshot-status">{snapshot?.status ?? "none"}</output>
      <output data-testid="snapshot-strength">{snapshot?.strength ?? "none"}</output>
      <button
        onClick={() => setDisplayMode((current) => current === "simple" ? "detailed" : "simple")}
        type="button"
      >
        Switch mode
      </button>
      <CharacterReferencePanel
        kreaReferenceStrength={0.8}
        onChange={setSnapshot}
        onKreaReferenceStrengthChange={() => undefined}
        promptProfile="illustrious"
        selectedCheckpoint={selectedCheckpoint}
        snapshot={snapshot}
      />
    </div>
  );
}

function getFileInput() {
  return container.querySelector('input[type="file"]') as HTMLInputElement;
}

async function chooseFile(file?: File) {
  const input = getFileInput();
  await act(async () => {
    Object.defineProperty(input, "files", { configurable: true, value: file ? [file] : [] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await act(async () => root.unmount());
  container.remove();
});

describe("CharacterReferencePanel", () => {
  it("contains the native accessible file input inside a positioned upload label", async () => {
    const onChange = vi.fn();
    await act(async () => root.render(
      <CharacterReferencePanel
        kreaReferenceStrength={0.8}
        onChange={onChange}
        onKreaReferenceStrengthChange={() => undefined}
        promptProfile="illustrious"
        selectedCheckpoint={selectedCheckpoint}
      />,
    ));

    const input = getFileInput();
    const label = input.closest("label");
    expect(label).not.toBeNull();
    expect(label?.classList.contains("relative")).toBe(true);
    expect(label?.textContent).toContain("Upload");
    expect(input.classList.contains("sr-only")).toBe(true);
    expect(input.accept).toBe("image/png,image/jpeg,image/webp");
    expect(input.disabled).toBe(false);
    input.focus();
    expect(document.activeElement).toBe(input);

    await chooseFile();
    expect(onChange).not.toHaveBeenCalled();
    expect(document.body.contains(input)).toBe(true);
  });

  it("keeps the contained input stable through pending, ready, replacement, and failed states", async () => {
    const uploadResolvers: Array<(response: Response) => void> = [];
    const fetchMock = vi.fn<typeof fetch>(() => new Promise<Response>((resolve) => {
      uploadResolvers.push(resolve);
    }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<Harness />));
    expect(container.querySelector('[data-testid="display-mode"]')?.textContent).toBe("simple");

    await chooseFile(new File([new Uint8Array([1, 2, 3])], "first.png", { type: "image/png" }));
    expect(container.querySelector('[data-testid="snapshot-status"]')?.textContent).toBe("pending");
    expect(container.textContent).toContain("Preparing character reference...");
    expect(getFileInput().disabled).toBe(true);
    expect(getFileInput().closest("label")?.classList.contains("relative")).toBe(true);
    for (let index = 0; index < 6 && uploadResolvers.length < 1; index += 1) {
      await flush();
    }
    expect(uploadResolvers).toHaveLength(1);

    await act(async () => {
      uploadResolvers[0]?.(Response.json({
        byteLength: 3,
        contentType: "image/png",
        filename: "0123456789abcdef0123456789abcdef.png",
      }));
      await Promise.resolve();
    });
    for (let index = 0; index < 6 &&
        container.querySelector('[data-testid="snapshot-status"]')?.textContent !== "ready";
      index += 1) {
      await flush();
    }

    expect(container.querySelector('[data-testid="snapshot-status"]')?.textContent).toBe("ready");
    expect(container.textContent).toContain("first.png is ready for identity conditioning.");
    expect(getFileInput().closest("label")?.textContent).toContain("Replace");
    expect(getFileInput().closest("label")?.classList.contains("relative")).toBe(true);

    const switchMode = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Switch mode"));
    await act(async () => switchMode?.click());
    expect(container.querySelector('[data-testid="display-mode"]')?.textContent).toBe("detailed");
    expect(container.querySelector('[data-testid="snapshot-status"]')?.textContent).toBe("ready");

    await chooseFile(new File([new Uint8Array([4, 5, 6])], "replacement.webp", { type: "image/webp" }));
    expect(container.querySelector('[data-testid="snapshot-status"]')?.textContent).toBe("pending");
    expect(getFileInput().closest("label")?.classList.contains("relative")).toBe(true);
    for (let index = 0; index < 6 && uploadResolvers.length < 2; index += 1) {
      await flush();
    }
    expect(uploadResolvers).toHaveLength(2);
    await act(async () => {
      uploadResolvers[1]?.(Response.json({
        byteLength: 3,
        contentType: "image/webp",
        filename: "fedcba9876543210fedcba9876543210.webp",
      }));
      await Promise.resolve();
    });
    for (let index = 0; index < 6 && !container.textContent?.includes("replacement.webp is ready"); index += 1) {
      await flush();
    }
    expect(container.textContent).toContain("replacement.webp is ready for identity conditioning.");

    await chooseFile(new File(["not supported"], "replacement.gif", { type: "image/gif" }));
    expect(container.querySelector('[data-testid="snapshot-status"]')?.textContent).toBe("failed");
    expect(container.textContent).toContain("Run character reference must be a PNG, JPEG, or WEBP image.");
    expect(getFileInput().closest("label")?.classList.contains("relative")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("preserves replacement strength and reports upload failures without removing the native input", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => Response.json(
      { error: { message: "Reference storage unavailable." } },
      { status: 503 },
    )));
    await act(async () => root.render(<Harness initialSnapshot={readySnapshot()} />));

    await chooseFile(new File([new Uint8Array([1])], "replacement.jpg", { type: "image/jpeg" }));
    for (let index = 0; index < 6 && !container.textContent?.includes("Reference storage unavailable"); index += 1) {
      await flush();
    }

    expect(container.querySelector('[data-testid="snapshot-status"]')?.textContent).toBe("failed");
    expect(container.querySelector('[data-testid="snapshot-strength"]')?.textContent).toBe("0.65");
    expect(container.textContent).toContain("Reference storage unavailable.");
    expect(getFileInput().closest("label")?.classList.contains("relative")).toBe(true);
    expect(getFileInput().classList.contains("sr-only")).toBe(true);
  });

  it("fails Krea preflight before storage when no compatible checkpoint is selected", async () => {
    const onChange = vi.fn();
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(
      <CharacterReferencePanel
        kreaReferenceStrength={0.8}
        onChange={onChange}
        onKreaReferenceStrengthChange={() => undefined}
        promptProfile="krea2"
        selectedCheckpoint={null}
      />,
    ));

    await chooseFile(new File([new Uint8Array([1])], "character.png", { type: "image/png" }));
    await flush();

    expect(onChange).toHaveBeenNthCalledWith(1, { status: "pending", strength: 0.8 });
    expect(onChange).toHaveBeenLastCalledWith({
      error: "Select a compatible local Krea 2 Turbo diffusion checkpoint before uploading a character reference.",
      status: "failed",
      strength: 0.8,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getFileInput().closest("label")?.classList.contains("relative")).toBe(true);
  });
});
