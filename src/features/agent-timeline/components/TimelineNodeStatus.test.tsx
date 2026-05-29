import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { timelineNodeStatuses, type TimelineNodeStatus as TimelineNodeStatusValue } from "@/features/agent-timeline/types";

import { TimelineNodeStatus } from "./TimelineNodeStatus";

const expectedLabels: Record<TimelineNodeStatusValue, string> = {
  blocked: "Blocked",
  ready: "Ready",
  running: "Running",
  done: "Done",
  stale: "Stale",
  error: "Error",
  manual: "Manual",
};

let container: HTMLDivElement;
let root: Root;

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

describe("TimelineNodeStatus", () => {
  it("renders every supported timeline status with a label and icon", () => {
    act(() => {
      root.render(
        <div>
          {timelineNodeStatuses.map((status) => (
            <TimelineNodeStatus key={status} status={status} />
          ))}
        </div>,
      );
    });

    const statusPills = Array.from(container.querySelectorAll("span"));

    expect(statusPills).toHaveLength(timelineNodeStatuses.length);

    for (const [index, status] of timelineNodeStatuses.entries()) {
      const pill = statusPills[index];
      const icon = pill.querySelector("svg");

      expect(pill.textContent).toContain(expectedLabels[status]);
      expect(icon).not.toBeNull();
      expect(icon?.classList.contains("animate-spin")).toBe(status === "running");
    }
  });
});
