"use client";

import { useSyncExternalStore } from "react";

const tabletEditorMediaQuery =
  "(min-width: 768px) and (max-width: 1400px) and (pointer: coarse), (min-width: 768px) and (max-width: 1400px) and (hover: none)";

function getTabletEditorSnapshot() {
  if (typeof window === "undefined") {
    return false;
  }

  const hasTouch = window.navigator.maxTouchPoints > 0 || "ontouchstart" in window;
  const tabletSizedViewport = window.innerWidth >= 768 && window.innerWidth <= 1400;
  const viewportKey = `${window.innerWidth}x${window.innerHeight}`;
  const iPadProSizedViewport = new Set([
    "834x1194",
    "1024x1366",
    "1194x834",
    "1366x1024",
  ]).has(viewportKey);

  return (
    window.matchMedia(tabletEditorMediaQuery).matches ||
    (hasTouch && tabletSizedViewport) ||
    iPadProSizedViewport
  );
}

function subscribeToTabletEditorChanges(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const media = window.matchMedia(tabletEditorMediaQuery);
  media.addEventListener("change", onStoreChange);
  window.addEventListener("resize", onStoreChange);
  window.addEventListener("orientationchange", onStoreChange);

  return () => {
    media.removeEventListener("change", onStoreChange);
    window.removeEventListener("resize", onStoreChange);
    window.removeEventListener("orientationchange", onStoreChange);
  };
}

export function useTabletEditorLayout() {
  return useSyncExternalStore(
    subscribeToTabletEditorChanges,
    getTabletEditorSnapshot,
    () => false,
  );
}
