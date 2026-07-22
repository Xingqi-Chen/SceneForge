import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  FinalReviewTimelineResult,
  ResultDisplayTimelineResult,
} from "@/features/agent-timeline/types";

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
  finalLinks: [{ candidateId: "preview-1", promptId: "final-prompt", rank: 1, seed: 100 }],
  warnings: [],
};

const reviewedPair: FinalReviewTimelineResult = {
  reviewVersion: 1,
  status: "reviewed",
  pairs: [{
    candidateId: "preview-1",
    rank: 1,
    seed: 100,
    variants: {
      final: completedResult.storedImage,
      previewUpscale: fallback.storedImage,
    },
    scores: {
      final: { adherence: 80, composition: 80, anatomy: 60, style: 80, technical: 80, total: 76 },
      previewUpscale: { adherence: 80, composition: 80, anatomy: 90, style: 80, technical: 80, total: 82 },
    },
    findings: [
      { operation: "pose", severity: "major", scope: "final", introducedByFinal: true, description: "Final changed the hand pose." },
      { operation: "contact", severity: "none", scope: "pair", introducedByFinal: false, description: "Contact is stable." },
      { operation: "object-count", severity: "none", scope: "pair", introducedByFinal: false, description: "Object count is stable." },
      { operation: "composition-consistency", severity: "none", scope: "pair", introducedByFinal: false, description: "Composition is stable." },
    ],
    rationale: "Preview preserves the intended pose.",
    recommendedVariant: "preview-upscale",
    defaultVariant: "preview-upscale",
  }],
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

  it("shows a concise Simple selector and keeps both variants selectable when review is unavailable", () => {
    const onSelectVariant = vi.fn();
    const failedReview: FinalReviewTimelineResult = {
      reviewVersion: 1,
      status: "failed",
      pairs: [{
        ...reviewedPair.pairs[0]!,
        scores: undefined,
        findings: undefined,
        rationale: undefined,
        recommendedVariant: null,
        defaultVariant: "final",
      }],
      error: {
        code: "llm_upstream",
        message: "Review unavailable. Both variants remain selectable.",
        details: { recoverable: true },
      },
    };

    act(() => root.render(
      <TimelineResultDisplayWorkspace
        draft={null}
        emptyState="No Final image yet."
        finalReview={failedReview}
        onSelectVariant={onSelectVariant}
        result={completedResult}
        selectedResources={{ checkpoint: null, loras: [] }}
      />,
    ));

    expect(container.textContent).toContain("Review recommendation unavailable");
    expect(container.textContent).toContain("No recommendation");
    expect(container.textContent).not.toContain("adherence 80");
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>("[data-testid='timeline-final-review'] button"));
    expect(buttons).toHaveLength(2);
    expect(buttons[0]?.getAttribute("aria-pressed")).toBe("true");
    expect(buttons[1]?.getAttribute("aria-pressed")).toBe("false");

    act(() => buttons[1]?.click());
    expect(onSelectVariant).toHaveBeenCalledWith("preview-1", "preview-upscale");
    const images = Array.from(container.querySelectorAll("img"));
    expect(images.at(-1)?.getAttribute("src")).toBe(completedResult.image.url);
  });

  it("shows Detailed scores/issues and gives explicit user selection precedence over the local default", () => {
    act(() => root.render(
      <TimelineResultDisplayWorkspace
        detailedReview
        draft={null}
        emptyState="No Final image yet."
        finalReview={reviewedPair}
        onSelectVariant={() => undefined}
        result={completedResult}
        selectedResources={{ checkpoint: null, loras: [] }}
      />,
    ));

    expect(container.textContent).toContain("Recommended: Preview fallback");
    expect(container.textContent).toContain("Final: adherence 80");
    expect(container.textContent).toContain("pose: major · final · introduced by Final yes");
    expect(Array.from(container.querySelectorAll("img")).at(-1)?.getAttribute("src")).toBe(fallback.storedImage.url);

    const explicitFinal: FinalReviewTimelineResult = {
      ...reviewedPair,
      pairs: reviewedPair.pairs.map((pair) => ({ ...pair, userSelectedVariant: "final" })),
    };
    act(() => root.render(
      <TimelineResultDisplayWorkspace
        detailedReview
        draft={null}
        emptyState="No Final image yet."
        finalReview={explicitFinal}
        onSelectVariant={() => undefined}
        result={completedResult}
        selectedResources={{ checkpoint: null, loras: [] }}
      />,
    ));

    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>("[data-testid='timeline-final-review'] button"));
    expect(buttons[0]?.getAttribute("aria-pressed")).toBe("true");
    expect(Array.from(container.querySelectorAll("img")).at(-1)?.getAttribute("src")).toBe(completedResult.image.url);
  });
});
