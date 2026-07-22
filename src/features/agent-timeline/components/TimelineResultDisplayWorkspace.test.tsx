import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ResultDisplayTimelineResult } from "@/features/agent-timeline/types";

import {
  getTimelineExecutionFallbacks,
  TimelineResultDisplayWorkspace,
  type TimelineFallbackDisplayItem,
} from "./TimelineResultDisplayWorkspace";

let container: HTMLDivElement;
let root: Root;

const fallback: TimelineFallbackDisplayItem = {
  candidateId: "preview-2",
  rank: 2,
  seed: 101,
  storedImage: {
    byteLength: 42,
    contentType: "image/png",
    filename: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png",
    url: "/api/comfyui/generated-images/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png",
  },
};

const completedResult: ResultDisplayTimelineResult = {
  completed: true,
  image: {
    filename: "final-output.png",
    nodeId: "9",
    type: "output",
    url: "/api/comfyui/generated-images/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png",
  },
  promptId: "final-prompt",
  sourceImage: { filename: "final-output.png", nodeId: "9", type: "output" },
  storedImage: {
    byteLength: 84,
    contentType: "image/png",
    filename: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png",
    url: "/api/comfyui/generated-images/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png",
  },
  warnings: [],
};

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("TimelineResultDisplayWorkspace fallbacks", () => {
  it("extracts managed fallbacks from both successful and failed Final records", () => {
    expect(getTimelineExecutionFallbacks({
      finals: [
        { candidateId: "preview-1", rank: 1, seed: 100, status: "done", previewUpscale: { storedImage: fallback.storedImage } },
        { candidateId: "preview-2", rank: 2, seed: 101, status: "error", previewUpscale: { storedImage: fallback.storedImage } },
      ],
    })).toHaveLength(2);
  });

  it("keeps a fallback-only partial result visible and directly openable", () => {
    act(() => root.render(
      <TimelineResultDisplayWorkspace
        draft={null}
        emptyState="No Final image yet."
        errorMessage="Final 2 failed."
        fallbacks={[fallback]}
        result={null}
        selectedResources={{ checkpoint: null, loras: [] }}
      />,
    ));

    const link = container.querySelector<HTMLAnchorElement>("[data-testid='timeline-fallback-gallery'] a");
    expect(link?.href).toContain(fallback.storedImage.url);
    expect(link?.target).toBe("_blank");
    expect(container.querySelector("img")?.getAttribute("alt")).toBe(
      "Formal-size Preview fallback for preview-2",
    );
    expect(container.textContent).toContain("Final 2 failed.");
  });

  it("keeps a completed Final first while exposing its fallback without auto-selecting it", () => {
    act(() => root.render(
      <TimelineResultDisplayWorkspace
        draft={null}
        emptyState="No Final image yet."
        fallbacks={[fallback]}
        result={completedResult}
        selectedResources={{ checkpoint: null, loras: [] }}
      />,
    ));

    const images = Array.from(container.querySelectorAll("img"));
    expect(images.map((image) => image.getAttribute("src"))).toEqual([
      completedResult.image.url,
      fallback.storedImage.url,
    ]);
    expect(images[0]?.getAttribute("alt")).toBe("Timeline generated ComfyUI result 1");
    expect(container.textContent).toContain("Finals remain the default result.");
  });
});
