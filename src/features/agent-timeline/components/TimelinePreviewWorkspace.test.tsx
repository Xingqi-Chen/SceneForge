import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  PreviewExecutionTimelineResult,
  PreviewScoringTimelineResult,
} from "@/features/agent-timeline/types";

import { TimelinePreviewWorkspace } from "./TimelinePreviewWorkspace";

let container: HTMLDivElement;
let root: Root;

const previews: PreviewExecutionTimelineResult = {
  baseSeed: 10,
  candidateCount: 4,
  finalCount: 2,
  previewHeight: 512,
  previewWidth: 512,
  previewSteps: 10,
  candidates: [1, 2, 3].map((number, index) => ({
    candidateId: `preview-${number}`,
    index,
    seed: 9 + number,
    status: "done" as const,
    storedImage: {
      byteLength: number,
      contentType: "image/png",
      filename: `preview-${number}.png`,
      url: `/api/comfyui/generated-images/preview-${number}.png`,
    },
  })),
  successfulCount: 3,
  warnings: [],
};

const scoring: PreviewScoringTimelineResult = {
  rubricVersion: 1,
  scores: [1, 2, 3].map((number) => ({
    candidateId: `preview-${number}`,
    adherence: 90 - number,
    composition: 80 - number,
    anatomy: 70 - number,
    style: 60 - number,
    technical: 50 - number,
    total: 79 - number,
    rank: number,
  })),
  selectedCandidateIds: ["preview-1", "preview-2"],
  selectionSource: "ai",
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

describe("TimelinePreviewWorkspace", () => {
  it("renders detailed ranking and all five score dimensions without mojibake", () => {
    act(() => root.render(
      <TimelinePreviewWorkspace previews={previews} scoring={scoring} />,
    ));

    expect(container.textContent).toContain("3/4 previews · choose exactly 2");
    expect(container.textContent).toContain("#1 · 78.00");
    expect(container.textContent).toContain("Adherence 89");
    expect(container.textContent).toContain("Composition 79");
    expect(container.textContent).toContain("Anatomy 69");
    expect(container.textContent).toContain("Style 59");
    expect(container.textContent).toContain("Technical 49");
    expect(container.textContent).not.toContain("路");
  });

  it("enables regeneration only after choosing exactly K successful candidates", () => {
    const onRegenerate = vi.fn();
    act(() => root.render(
      <TimelinePreviewWorkspace onRegenerate={onRegenerate} previews={previews} scoring={scoring} />,
    ));
    const candidates = Array.from(container.querySelectorAll("button")).filter((button) =>
      button.textContent?.includes("preview-"),
    );
    const regenerate = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent === "Regenerate selected finals",
    ) as HTMLButtonElement;

    expect(regenerate.disabled).toBe(true);
    act(() => candidates[1]!.click());
    expect(regenerate.disabled).toBe(true);
    act(() => candidates[2]!.click());
    expect(regenerate.disabled).toBe(false);
    act(() => regenerate.click());
    expect(onRegenerate).toHaveBeenCalledWith(["preview-1", "preview-3"]);
  });
});
