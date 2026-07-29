import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  FinalRepairTimelineResult,
  FinalReviewTimelineResult,
  RepairVerificationTimelineResult,
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

const repairTargets = [{ operation: "contact" as const, severity: "major" as const, description: "Hand misses cup." }];
const repairParent = {
  finalStoredImage: completedResult.storedImage,
  reviewUpdatedAt: "2026-07-22T00:00:00.000Z",
  reviewedFindings: reviewedPair.pairs[0]!.findings!,
  reviewedTargets: repairTargets,
};
const repairSourceImage = {
  filename: "repair-output.png",
  nodeId: "9",
  type: "output" as const,
};
const repairStoredImage = {
  byteLength: 64,
  contentType: "image/png",
  filename: "dddddddddddddddddddddddddddddddd.png",
  url: "/api/comfyui/generated-images/dddddddddddddddddddddddddddddddd.png",
};

const repairedResult: FinalRepairTimelineResult = {
  repairVersion: 1,
  authorized: true,
  completed: true,
  pairs: [{
    candidateId: "preview-1",
    rank: 1,
    seed: 100,
    status: "repaired",
    targets: repairTargets,
    parent: repairParent,
    mask: {
      provenance: "structured-diagnosis",
      refinement: { status: "skipped", reason: "sam2-unavailable" },
      coverageBeforeGrowth: 0.01,
      coverageAfterGrowth: 0.02,
      growMaskBy: 16,
      width: 1024,
      height: 1024,
      storedImage: {
        byteLength: 32,
        contentType: "image/png",
        filename: "cccccccccccccccccccccccccccccccc.png",
        url: "/api/comfyui/generated-images/cccccccccccccccccccccccccccccccc.png",
      },
    },
    promptId: "repair-prompt",
    sourceImage: repairSourceImage,
    storedImage: repairStoredImage,
    attempt: {
      attemptId: `sha256:${"a".repeat(64)}`,
      status: "stored",
      promptId: "repair-prompt",
      outputNodeId: "9",
      requestDigest: `sha256:${"b".repeat(64)}`,
      sourceImage: repairSourceImage,
      storedImage: repairStoredImage,
    },
  }],
};

const verifiedRepair: RepairVerificationTimelineResult = {
  verificationVersion: 1,
  status: "verified",
  pairs: [{
    candidateId: "preview-1",
    repairParent,
    repairStoredImage: repairedResult.pairs[0]!.storedImage!,
    scores: {
      final: { adherence: 80, composition: 80, anatomy: 80, style: 80, technical: 80, total: 80 },
      repair: { adherence: 82, composition: 82, anatomy: 82, style: 82, technical: 82, total: 82 },
    },
    targetedDefectsResolved: true,
    newMajorOrBlockingIssue: false,
    findings: [
      { operation: "pose", severity: "none", scope: "pair", introducedByFinal: false, description: "Stable after repair." },
      { operation: "contact", severity: "none", scope: "pair", introducedByFinal: false, description: "Contact resolved after repair." },
      { operation: "object-count", severity: "none", scope: "pair", introducedByFinal: false, description: "Object count stable after repair." },
      { operation: "composition-consistency", severity: "none", scope: "pair", introducedByFinal: false, description: "Composition stable after repair." },
    ],
    recommended: true,
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

  it("labels completed historical output as style-unassessed", () => {
    act(() => root.render(
      <TimelineResultDisplayWorkspace
        draft={null}
        emptyState="No Final image yet."
        result={{ ...completedResult, visualStyleAssessment: "style-unassessed" }}
        selectedResources={{ checkpoint: null, loras: [] }}
      />,
    ));

    expect(container.querySelector("[data-testid='timeline-visual-style-unassessed']"))
      .not.toBeNull();
    expect(container.textContent).toContain("completed legacy result");
  });

  it("removes a mismatched Final and selects its verified Preview fallback", () => {
    const mismatchedReview: FinalReviewTimelineResult = {
      ...reviewedPair,
      visualStyle: "anime",
      pairs: reviewedPair.pairs.map((pair) => ({
        ...pair,
        defaultVariant: "final",
        recommendedVariant: null,
        visualStyleMatch: { final: false, previewUpscale: true },
      })),
    };
    const onSelectVariant = vi.fn();
    act(() => root.render(
      <TimelineResultDisplayWorkspace
        draft={null}
        emptyState="No Final image yet."
        finalReview={mismatchedReview}
        onSelectVariant={onSelectVariant}
        result={{ ...completedResult, visualStyleAssessment: "verified" }}
        selectedResources={{ checkpoint: null, loras: [] }}
      />,
    ));

    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>("[data-testid='timeline-final-review'] button"),
    );
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.textContent).toContain("Preview fallback");
    expect(buttons[0]?.getAttribute("aria-pressed")).toBe("true");
    expect(container.textContent).toContain("Final is unavailable because its visual style");
    expect(Array.from(container.querySelectorAll("img")).at(-1)?.getAttribute("src"))
      .toBe(fallback.storedImage.url);
  });

  it("makes forged prior-style result props non-actionable and omits manual Inpaint", () => {
    const onSelectVariant = vi.fn();
    const fetchMock = vi.fn<typeof fetch>();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;
    const priorStyleReview: FinalReviewTimelineResult = {
      ...reviewedPair,
      visualStyle: "anime",
      pairs: reviewedPair.pairs.map((pair) => ({
        ...pair,
        defaultVariant: "final",
        userSelectedVariant: "final",
        visualStyleMatch: { final: true, previewUpscale: true },
      })),
    };

    try {
      act(() => root.render(
        <TimelineResultDisplayWorkspace
          actionsAllowed
          draft={null}
          emptyState="No Final image yet."
          finalReview={priorStyleReview}
          inpaintAllowed
          onSelectVariant={onSelectVariant}
          result={{
            ...completedResult,
            visualStyle: "anime",
            visualStyleAssessment: "verified",
          }}
          selectedResources={{ checkpoint: null, loras: [] }}
          visualStyle="photoreal"
        />,
      ));

      const variantButtons = Array.from(
        container.querySelectorAll<HTMLButtonElement>("[data-testid='timeline-final-review'] button"),
      );
      expect(variantButtons).toHaveLength(2);
      expect(variantButtons.every((button) => button.disabled)).toBe(true);
      act(() => {
        variantButtons.forEach((button) => button.click());
      });
      expect(onSelectVariant).not.toHaveBeenCalled();
      expect(Array.from(container.querySelectorAll("button")).some(
        (button) => button.textContent?.includes("Inpaint"),
      )).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
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

  it("shows a verified Repair in Simple mode and promotes it only through explicit selection", () => {
    const onSelectVariant = vi.fn();
    act(() => root.render(
      <TimelineResultDisplayWorkspace
        draft={null}
        emptyState="No Final image yet."
        finalRepair={repairedResult}
        finalReview={reviewedPair}
        onSelectVariant={onSelectVariant}
        repairVerification={verifiedRepair}
        result={completedResult}
        selectedResources={{ checkpoint: null, loras: [] }}
      />,
    ));

    expect(container.textContent).toContain("Repair: repaired");
    expect(container.textContent).toContain("recommended");
    expect(container.textContent).not.toContain("Mask: structured-diagnosis");
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>("[data-testid='timeline-final-review'] button"));
    expect(buttons).toHaveLength(3);
    expect(buttons[2]?.textContent).toContain("Repair");
    expect(buttons[2]?.getAttribute("aria-pressed")).toBe("false");

    act(() => buttons[2]?.click());
    expect(onSelectVariant).toHaveBeenCalledWith("preview-1", "repair");
  });

  it("shows normalized Repair targets, mask metadata, and verification findings in Detailed mode", () => {
    act(() => root.render(
      <TimelineResultDisplayWorkspace
        detailedReview
        draft={null}
        emptyState="No Final image yet."
        finalRepair={repairedResult}
        finalReview={reviewedPair}
        onSelectVariant={() => undefined}
        repairVerification={verifiedRepair}
        result={completedResult}
        selectedResources={{ checkpoint: null, loras: [] }}
      />,
    ));

    expect(container.textContent).toContain("Targets: contact (major)");
    expect(container.textContent).toContain("Mask: structured-diagnosis, 1.00% before / 2.00% after, grow 16px");
    expect(container.textContent).toContain("Verification findings");
    expect(container.textContent).toContain("contact: none");
    expect(container.textContent).toContain("Contact resolved after repair.");
  });

  it("shows the recoverable retry stage for a failed Repair in Detailed mode", () => {
    const failedRepair: FinalRepairTimelineResult = {
      ...repairedResult,
      pairs: [{
        ...repairedResult.pairs[0]!,
        status: "failed",
        storedImage: undefined,
        retryStage: "comfyui",
        skipReason: "repair-failed",
        error: { code: "comfyui_execution_failed", message: "Repair failed.", details: { recoverable: true } },
      }],
    };
    act(() => root.render(
      <TimelineResultDisplayWorkspace
        detailedReview
        draft={null}
        emptyState="No Final image yet."
        finalRepair={failedRepair}
        finalReview={reviewedPair}
        onSelectVariant={() => undefined}
        result={completedResult}
        selectedResources={{ checkpoint: null, loras: [] }}
      />,
    ));

    expect(container.textContent).toContain("Repair: failed");
    expect(container.textContent).toContain("Reason: repair-failed");
    expect(container.textContent).toContain("Retry stage: comfyui");
    expect(container.querySelectorAll("[data-testid='timeline-final-review'] button")).toHaveLength(2);
  });

  it.each([false, true])("shows closed queue-outcome guidance in %s detailed mode", (detailedReview) => {
    const failedRepair: FinalRepairTimelineResult = {
      ...repairedResult,
      pairs: [{
        ...repairedResult.pairs[0]!,
        status: "failed",
        promptId: undefined,
        sourceImage: undefined,
        storedImage: undefined,
        requestPolicy: undefined,
        retryStage: undefined,
        skipReason: "queue-outcome-unknown",
        attempt: {
          attemptId: `sha256:${"a".repeat(64)}`,
          status: "queue-started",
          outputNodeId: "9",
        },
        error: {
          code: "comfyui_execution_failed",
          message: "Repair queue acceptance is uncertain. Manual recovery is required before another Repair can be queued.",
        },
      }],
    };
    act(() => root.render(
      <TimelineResultDisplayWorkspace
        detailedReview={detailedReview}
        draft={null}
        emptyState="No Final image yet."
        finalRepair={failedRepair}
        finalReview={reviewedPair}
        onSelectVariant={() => undefined}
        result={completedResult}
        selectedResources={{ checkpoint: null, loras: [] }}
      />,
    ));

    expect(container.textContent).toContain("Repair: queue outcome unknown · closed");
    expect(container.textContent).toContain("Reason: queue-outcome-unknown");
    expect(container.textContent).toContain("Do not retry it.");
    expect(container.textContent).toContain("keep using the preserved Preview or Final");
    expect(container.textContent).not.toContain("Retry stage:");
  });

  it("keeps closed queue-outcome guidance visible before result display completes", () => {
    const failedRepair: FinalRepairTimelineResult = {
      ...repairedResult,
      pairs: [{
        ...repairedResult.pairs[0]!,
        status: "failed",
        promptId: undefined,
        sourceImage: undefined,
        storedImage: undefined,
        requestPolicy: undefined,
        retryStage: undefined,
        skipReason: "queue-outcome-unknown",
        attempt: {
          attemptId: `sha256:${"a".repeat(64)}`,
          status: "queue-started",
          outputNodeId: "9",
        },
        error: {
          code: "comfyui_execution_failed",
          message: "Repair queue acceptance is uncertain. Manual recovery is required before another Repair can be queued.",
        },
      }],
    };
    act(() => root.render(
      <TimelineResultDisplayWorkspace
        detailedReview
        draft={null}
        emptyState="No Final image yet."
        finalRepair={failedRepair}
        finalReview={reviewedPair}
        onSelectVariant={() => undefined}
        result={null}
        selectedResources={{ checkpoint: null, loras: [] }}
      />,
    ));

    expect(container.textContent).toContain("Repair: queue outcome unknown · closed");
    expect(container.textContent).toContain("Reason: queue-outcome-unknown");
    expect(container.textContent).toContain("Do not retry it.");
    expect(container.textContent).toContain("keep using the preserved Preview or Final");
  });
});
