import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDefaultProject } from "@/features/editor/store/defaults";
import { useEditorStore } from "@/features/editor/store/editor-store";

vi.mock("next/dynamic", () => ({
  default: () => function MockDynamicViewport() {
    return <div data-testid="mock-canvas-renderer" />;
  },
}));

vi.mock("./useTabletEditorLayout", () => ({
  useTabletEditorLayout: () => false,
}));

import { CanvasViewport } from "./CanvasViewport";

let container: HTMLDivElement;
let root: Root;

function getExactButton(label: string) {
  return Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === label,
  ) as HTMLButtonElement | undefined;
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useEditorStore.getState().setProject(createDefaultProject());
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

describe("CanvasViewport", () => {
  it("keeps the normal editor scene mode switch visible and interactive by default", () => {
    act(() => {
      root.render(<CanvasViewport />);
    });

    expect(getExactButton("2D")).not.toBeUndefined();
    expect(getExactButton("3D")).not.toBeUndefined();
    expect(useEditorStore.getState().project.scene.mode).toBe("2d");

    act(() => {
      getExactButton("3D")?.click();
    });

    expect(useEditorStore.getState().project.scene.mode).toBe("3d");
  });

  it("can lock the viewport to 3D and hide the scene mode switch", () => {
    act(() => {
      root.render(<CanvasViewport lockedSceneMode="3d" showSceneModeSwitcher={false} />);
    });

    expect(getExactButton("2D")).toBeUndefined();
    expect(getExactButton("3D")).toBeUndefined();
    expect(useEditorStore.getState().project.scene.mode).toBe("3d");
  });

  it("hides the scene mode switch whenever the scene mode is locked", () => {
    act(() => {
      root.render(<CanvasViewport lockedSceneMode="3d" />);
    });

    expect(getExactButton("2D")).toBeUndefined();
    expect(getExactButton("3D")).toBeUndefined();
    expect(useEditorStore.getState().project.scene.mode).toBe("3d");
  });
});
