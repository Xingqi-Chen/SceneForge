import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StyleReferenceSnapshot } from "@/features/agent-timeline/style-reference";

import { StyleReferencePanel } from "./StyleReferencePanel";

let container: HTMLDivElement;
let root: Root;

function Harness() {
  const [displayMode, setDisplayMode] = useState<"simple" | "detailed">("simple");
  const [snapshot, setSnapshot] = useState<StyleReferenceSnapshot>();

  return (
    <div>
      <p>Mode: {displayMode}</p>
      <button onClick={() => setDisplayMode((current) => current === "simple" ? "detailed" : "simple")} type="button">
        Switch mode
      </button>
      <StyleReferencePanel
        checkpointId="checkpoint-a"
        nsfwEnabled={false}
        onChange={setSnapshot}
        promptProfile="illustrious"
        selectedCheckpoint={{
          id: "checkpoint-a",
          resourceType: "model",
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
          modelStorageKind: "checkpoint",
        }}
        snapshot={snapshot}
        workflowLabel="Run"
      />
    </div>
  );
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function chooseFile(file: File) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  await act(async () => {
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
  });
}

async function click(label: string) {
  const button = Array.from(container.querySelectorAll("button")).find((entry) =>
    entry.textContent?.includes(label));
  expect(button).toBeDefined();
  await act(async () => {
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
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

describe("StyleReferencePanel", () => {
  it("shares upload, failed-analysis retry, replace, remove, and ready state across Composer modes", async () => {
    let uploadCount = 0;
    let analysisCount = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const target = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
      if (target === "/api/comfyui/sequence-references") {
        uploadCount += 1;
        expect(String(init?.body)).toContain("data:image/");
        return new Response(JSON.stringify({
          byteLength: 3,
          contentType: "image/png",
          filename: uploadCount === 1
            ? "0123456789abcdef0123456789abcdef.png"
            : "fedcba9876543210fedcba9876543210.png",
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (target === "/api/llm/chat") {
        analysisCount += 1;
        const body = JSON.parse(String(init?.body)) as { purpose?: string; messages?: unknown };
        expect(body.purpose).toBe("story-style-reference-analysis");
        expect(JSON.stringify(body.messages)).toContain("image_url");
        if (analysisCount === 1) {
          return new Response(JSON.stringify({ error: { message: "Vision model unavailable." } }), {
            status: 503,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({
          role: "assistant",
          model: "vision-model",
          content: JSON.stringify({
            summary: analysisCount === 2 ? "Recovered watercolor style." : "Replacement ink style.",
            stylePrompt: analysisCount === 2 ? "watercolor wash, paper grain" : "ink wash, cobalt accents",
          }),
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`Unexpected fetch: ${target}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<Harness />));
    expect(container.textContent).toContain("Mode: simple");
    expect(container.textContent).toContain("No Run style reference selected.");

    await chooseFile(new File([new Uint8Array([1, 2, 3])], "first.png", { type: "image/png" }));
    for (let index = 0; index < 8 && !container.textContent?.includes("Vision model unavailable"); index += 1) {
      await flush();
    }
    expect(container.textContent).toContain("Vision model unavailable.");
    expect(container.textContent).toContain("Retry analysis");

    await click("Retry analysis");
    for (let index = 0; index < 8 && !container.textContent?.includes("Recovered watercolor style"); index += 1) {
      await flush();
    }
    expect(container.textContent).toContain("Recovered watercolor style.");
    expect((container.querySelector('textarea[aria-label="Style prompt"]') as HTMLTextAreaElement).value)
      .toBe("watercolor wash, paper grain");
    expect(Array.from(container.querySelectorAll('input[type="number"]')).map((input) => (input as HTMLInputElement).value))
      .toEqual(["0.45", "0", "1"]);

    await click("Switch mode");
    expect(container.textContent).toContain("Mode: detailed");
    expect(container.textContent).toContain("Recovered watercolor style.");

    await chooseFile(new File([new Uint8Array([4, 5, 6])], "replacement.webp", { type: "image/webp" }));
    for (let index = 0; index < 8 && !container.textContent?.includes("Replacement ink style"); index += 1) {
      await flush();
    }
    expect(container.textContent).toContain("replacement.webp analyzed");
    expect(container.textContent).toContain("Replacement ink style.");

    await click("Remove");
    expect(container.textContent).toContain("No Run style reference selected.");
    expect(uploadCount).toBe(2);
    expect(analysisCount).toBe(3);
  });

  it("rejects unsupported file types before storage or analysis", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<Harness />));

    await chooseFile(new File(["not an image"], "style.gif", { type: "image/gif" }));

    expect(container.textContent).toContain("Run style reference must be a PNG, JPEG, or WEBP image.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
