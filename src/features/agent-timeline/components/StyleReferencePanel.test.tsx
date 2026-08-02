import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getStyleReferenceBlockingIssue,
  type StyleReferenceSnapshot,
} from "@/features/agent-timeline/style-reference";

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
        visualStyle="photoreal"
        workflowLabel="Run"
      />
    </div>
  );
}

function createKreaSnapshot(mode: "ipadapter" | "prompt-only" = "prompt-only"): StyleReferenceSnapshot {
  return {
    status: "ready",
    mode,
    ...(mode === "ipadapter"
      ? { ipAdapter: { endPercent: 1, startPercent: 0, weight: 0.45 } }
      : {}),
    metadata: {
      byteLength: 512,
      contentType: "image/png",
      filename: "style.png",
      storedFilename: "0123456789abcdef0123456789abcdef.png",
      uploadedAt: "2026-07-26T00:00:00.000Z",
      url: "/api/comfyui/sequence-references/0123456789abcdef0123456789abcdef.png",
    },
    analysis: {
      analyzedAt: "2026-07-26T00:00:01.000Z",
      stylePrompt: "soft gouache, cobalt shadows",
      summary: "Soft gouache.",
    },
    settingsSnapshot: {
      capturedAt: "2026-07-26T00:00:02.000Z",
      checkpointBaseModel: "Krea 2",
      checkpointId: "checkpoint-krea",
      modeReason: "Krea adapter preflight pending.",
      promptProfile: "krea2",
    },
  };
}

function KreaHarness({
  initialMode = "prompt-only",
  withSnapshot = true,
}: {
  initialMode?: "ipadapter" | "prompt-only";
  withSnapshot?: boolean;
}) {
  const [snapshot, setSnapshot] = useState<StyleReferenceSnapshot | undefined>(
    withSnapshot ? createKreaSnapshot(initialMode) : undefined,
  );

  return <>
    <output data-testid="krea-snapshot-state">
      {snapshot ? `${snapshot.status}:${snapshot.mode}` : "none"}
    </output>
    <output data-testid="krea-blocking-issue">
      {getStyleReferenceBlockingIssue(snapshot, "Run")}
    </output>
    <StyleReferencePanel
      checkpointId="checkpoint-krea"
      nsfwEnabled={false}
      onChange={setSnapshot}
      promptProfile="krea2"
      selectedCheckpoint={{
        id: "checkpoint-krea", resourceType: "model", name: "Krea 2 Turbo", versionName: "v1",
        baseModel: "Krea 2", creator: "creator", trainedWords: [], tags: [], categories: [],
        usageGuide: null, descriptionSnippet: null, averageWeight: null, minWeight: null, maxWeight: null,
        recommendations: [], previewImage: null, modelFileName: "krea-2-turbo-unet.safetensors",
        modelStorageKind: "diffusion",
      }}
      snapshot={snapshot}
      workflowLabel="Run"
    />
  </>;
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

function getIpAdapterCheckbox() {
  return Array.from(container.querySelectorAll('input[type="checkbox"]')).find((input) =>
    input.parentElement?.textContent?.includes("Use IPAdapter in addition to the style prompt"),
  ) as HTMLInputElement | undefined;
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
        const body = JSON.parse(String(init?.body)) as {
          purpose?: string;
          messages?: Array<{ content?: unknown }>;
        };
        expect(body.purpose).toBe("story-style-reference-analysis");
        expect(JSON.stringify(body.messages)).toContain("image_url");
        expect(String(body.messages?.[0]?.content)).toContain(
          "Selected visual style: Photoreal (photoreal)",
        );
        expect(JSON.stringify(body.messages)).toContain("photoreal");
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

  it("enables the Krea adapter only after its local preflight verifies the selected checkpoint", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      expect(input).toBe("/api/comfyui/krea2-style-reference-capability");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        checkpointName: "krea-2-turbo-unet.safetensors",
        modelBaseModel: "Krea 2",
        modelStorageKind: "diffusion",
        hasCharacterReference: false,
      });
      return Response.json({
        available: true,
        reason: "Krea style-reference adapter verified for this local Krea 2 Turbo checkpoint.",
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<KreaHarness />));
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Krea style-reference adapter verified");
    expect(container.textContent).toContain("Use IPAdapter in addition to the style prompt");
    const adapterCheckbox = getIpAdapterCheckbox();
    await act(async () => {
      adapterCheckbox?.click();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Krea timing is fixed to start_at 0 and end_at 1");
    expect(Array.from(container.querySelectorAll('input[type="number"]'))).toHaveLength(0);
  });

  it("preserves a restored Krea adapter selection while preflight is pending and restores readiness on success", async () => {
    let resolvePreflight: ((response: Response) => void) | undefined;
    const preflightResponse = new Promise<Response>((resolve) => {
      resolvePreflight = resolve;
    });
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(() => preflightResponse));

    await act(async () => root.render(<KreaHarness initialMode="ipadapter" />));
    await flush();

    expect(container.querySelector('[data-testid="krea-snapshot-state"]')?.textContent).toBe("pending:ipadapter");
    expect(container.querySelector('[data-testid="krea-blocking-issue"]')?.textContent)
      .toContain("generation remains blocked");
    expect(container.textContent).toContain("explicit adapter selection is preserved");
    expect(container.textContent).toContain("generation remains blocked");
    expect(getIpAdapterCheckbox()?.checked).toBe(true);

    await act(async () => {
      resolvePreflight?.(Response.json({
        available: true,
        reason: "Krea style-reference adapter verified for this local Krea 2 Turbo checkpoint.",
      }));
      await Promise.resolve();
    });
    for (let index = 0; index < 6 &&
        container.querySelector('[data-testid="krea-snapshot-state"]')?.textContent !== "ready:ipadapter";
      index += 1) {
      await flush();
    }

    expect(container.querySelector('[data-testid="krea-snapshot-state"]')?.textContent).toBe("ready:ipadapter");
    expect(container.querySelector('[data-testid="krea-blocking-issue"]')?.textContent).toBe("");
    expect(container.textContent).not.toContain("generation remains blocked");
    expect(getIpAdapterCheckbox()?.checked).toBe(true);
  });

  it("keeps an unavailable restored Krea adapter selected and requires explicit prompt-only opt-out", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => Response.json({
      available: false,
      reason: "The verified Krea adapter file is not installed.",
    })));

    await act(async () => root.render(<KreaHarness initialMode="ipadapter" />));
    for (let index = 0; index < 6 &&
        container.querySelector('[data-testid="krea-snapshot-state"]')?.textContent !== "mismatch:ipadapter";
      index += 1) {
      await flush();
    }

    expect(container.querySelector('[data-testid="krea-snapshot-state"]')?.textContent).toBe("mismatch:ipadapter");
    expect(container.querySelector('[data-testid="krea-blocking-issue"]')?.textContent)
      .toContain("Disable IPAdapter explicitly");
    expect(container.textContent).toContain("The verified Krea adapter file is not installed.");
    expect(container.textContent).toContain("Disable IPAdapter explicitly");
    const adapterCheckbox = getIpAdapterCheckbox();
    expect(adapterCheckbox?.checked).toBe(true);

    await act(async () => {
      adapterCheckbox?.click();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="krea-snapshot-state"]')?.textContent).toBe("ready:prompt-only");
    expect(container.querySelector('[data-testid="krea-blocking-issue"]')?.textContent).toBe("");
    expect(container.textContent).not.toContain("Krea adapter preflight blocks generation");
    expect(container.textContent).toContain("Prompt-only");
  });

  it("requests a faithful natural-language Krea style clause instead of Illustrious tags", async () => {
    let analysisSystemPrompt = "";
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const target = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
      if (target === "/api/comfyui/krea2-style-reference-capability") {
        return Response.json({
          available: true,
          reason: "Krea style-reference adapter verified.",
        });
      }
      if (target === "/api/comfyui/sequence-references") {
        return Response.json({
          byteLength: 3,
          contentType: "image/png",
          filename: "0123456789abcdef0123456789abcdef.png",
        });
      }
      if (target === "/api/llm/chat") {
        const body = JSON.parse(String(init?.body)) as {
          messages?: Array<{ content?: unknown; role?: string }>;
        };
        analysisSystemPrompt = String(body.messages?.find((message) => message.role === "system")?.content ?? "");
        return Response.json({
          role: "assistant",
          model: "vision-model",
          content: JSON.stringify({
            summary: "Soft gouache with cobalt shadows.",
            stylePrompt: "Render the scene in soft gouache with cobalt shadows and diffused gallery light.",
          }),
        });
      }
      throw new Error(`Unexpected fetch: ${target}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<KreaHarness withSnapshot={false} />));
    await flush();
    await chooseFile(new File([new Uint8Array([1, 2, 3])], "krea-style.png", { type: "image/png" }));
    for (let index = 0; index < 8 && !container.textContent?.includes("Soft gouache with cobalt shadows.");
      index += 1) {
      await flush();
    }

    expect(analysisSystemPrompt).toContain("Krea 2-compatible stylePrompt");
    expect(analysisSystemPrompt).toContain("one faithful natural-language visual style clause");
    expect(analysisSystemPrompt).toContain("Do not use Danbooru tags");
    expect(analysisSystemPrompt).not.toContain("Illustrious-compatible stylePrompt");
  });
});
