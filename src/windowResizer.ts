import OBR from "@owlbear-rodeo/sdk";

export type WindowType = "modal" | "popover" | "action";
export type CenteringMode = boolean | "horizontal" | "vertical";

export interface WindowResizerConfig {
  windowKey: string;
  type: WindowType;
  modalId?: string;
  popoverId?: string;
  defaultWidth: number;
  defaultHeight: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  centered?: CenteringMode;
}

export interface WindowDimensions {
  width: number;
  height: number;
}

const STORAGE_PREFIX = "master-loot:window-size:";

/**
 * Cleanly close a window whether it was opened as a popover or modal.
 */
export async function closeWindow(id: string): Promise<void> {
  if (!OBR.isAvailable) return;
  await Promise.allSettled([
    OBR.popover.close(id),
    OBR.modal.close(id),
  ]);
}

/**
 * Retrieve saved window dimensions from localStorage.
 */
export function getSavedWindowSize(
  key: string,
  defaults: WindowDimensions,
): WindowDimensions {
  try {
    if (typeof localStorage === "undefined" || !localStorage) return defaults;
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${key}`);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.width === "number" &&
      typeof parsed?.height === "number" &&
      parsed.width > 100 &&
      parsed.height > 100
    ) {
      return {
        width: Math.round(parsed.width),
        height: Math.round(parsed.height),
      };
    }
  } catch {
    // Ignore localStorage read errors
  }
  return defaults;
}

/**
 * Persist window dimensions to localStorage.
 */
export function saveWindowSize(key: string, size: WindowDimensions): void {
  try {
    if (typeof localStorage === "undefined" || !localStorage) return;
    localStorage.setItem(
      `${STORAGE_PREFIX}${key}`,
      JSON.stringify({
        width: Math.round(size.width),
        height: Math.round(size.height),
      }),
    );
  } catch {
    // Ignore localStorage write errors
  }
}

/**
 * Setup seamless drag-to-resize on any window (popover, modal, or action).
 * Attaches edge and corner drag handles directly to document.body so they persist
 * across inner view re-renders.
 */
export function setupWindowResizer(config: WindowResizerConfig): () => void {
  if (typeof window === "undefined" || !document?.body) {
    return () => {};
  }

  // Prevent duplicate resizer initialization on same page
  const existingContainer = document.querySelector(".window-resize-overlay");
  if (existingContainer) {
    existingContainer.remove();
  }

  const minW = config.minWidth ?? 280;
  const minH = config.minHeight ?? 280;
  const maxW = config.maxWidth ?? 1600;
  const maxH = config.maxHeight ?? 1400;

  const overlay = document.createElement("div");
  overlay.className = "window-resize-overlay";

  // Create handles: right, bottom, bottom-right corner, left, bottom-left corner
  const handlesConfig: Array<{
    dir: "e" | "s" | "se" | "w" | "sw";
    className: string;
    cursor: string;
    hasGrip?: boolean;
  }> = [
    { dir: "e", className: "window-resize-handle window-resize-e", cursor: "ew-resize" },
    { dir: "s", className: "window-resize-handle window-resize-s", cursor: "ns-resize" },
    { dir: "se", className: "window-resize-handle window-resize-se", cursor: "nwse-resize", hasGrip: true },
    { dir: "w", className: "window-resize-handle window-resize-w", cursor: "ew-resize" },
    { dir: "sw", className: "window-resize-handle window-resize-sw", cursor: "nesw-resize" },
  ];

  let isDragging = false;
  let activeDir: "e" | "s" | "se" | "w" | "sw" | null = null;
  let useScreenCoords = false;
  let startScreenX = 0;
  let startScreenY = 0;
  let startWidth = 0;
  let startHeight = 0;
  let rafId: number | null = null;
  let pendingWidth: number | null = null;
  let pendingHeight: number | null = null;
  let isSending = false;

  async function applySize(w: number, h: number): Promise<void> {
    if (!OBR.isAvailable) {
      document.documentElement.style.width = `${w}px`;
      document.documentElement.style.height = `${h}px`;
      return;
    }

    try {
      if (config.type === "action") {
        await Promise.all([
          OBR.action.setWidth(w),
          OBR.action.setHeight(h),
        ]);
      } else {
        const popoverId = config.popoverId || config.modalId;
        if (popoverId) {
          await Promise.all([
            OBR.popover.setWidth(popoverId, w),
            OBR.popover.setHeight(popoverId, h),
          ]);
        }
      }
    } catch (err) {
      // Tolerate transient SDK communication errors during fast resize
      console.debug("Window resize update:", err);
    }
  }

  function queueUpdate(w: number, h: number): void {
    pendingWidth = w;
    pendingHeight = h;

    if (rafId !== null) return;

    rafId = requestAnimationFrame(async () => {
      rafId = null;
      if (isSending || pendingWidth === null || pendingHeight === null) return;
      isSending = true;
      const targetW = pendingWidth;
      const targetH = pendingHeight;
      pendingWidth = null;
      pendingHeight = null;
      try {
        await applySize(targetW, targetH);
      } finally {
        isSending = false;
        // If another update arrived while sending, schedule it
        if (pendingWidth !== null && pendingHeight !== null) {
          queueUpdate(pendingWidth, pendingHeight);
        }
      }
    });
  }

  function clampDimensions(w: number, h: number): { width: number; height: number } {
    const screenLimitW = typeof window.screen !== "undefined" && window.screen.availWidth
      ? window.screen.availWidth - 20
      : maxW;
    const screenLimitH = typeof window.screen !== "undefined" && window.screen.availHeight
      ? window.screen.availHeight - 40
      : maxH;

    const clampedW = Math.round(
      Math.max(minW, Math.min(Math.min(maxW, screenLimitW), w)),
    );
    const clampedH = Math.round(
      Math.max(minH, Math.min(Math.min(maxH, screenLimitH), h)),
    );
    return { width: clampedW, height: clampedH };
  }

  for (const hInfo of handlesConfig) {
    const handle = document.createElement("div");
    handle.className = hInfo.className;
    handle.dataset.dir = hInfo.dir;
    handle.title = hInfo.hasGrip
      ? "Drag to resize window (Double-click to reset size)"
      : "Drag to resize window";

    if (hInfo.hasGrip) {
      // Classic decorative diagonal grip icon
      handle.innerHTML = `
        <svg class="window-resize-grip" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <line x1="11" y1="3" x2="3" y2="11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <line x1="11" y1="7" x2="7" y2="11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <circle cx="10.5" cy="10.5" r="0.8" fill="currentColor"/>
        </svg>
      `;

      handle.ondblclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const resetW = config.defaultWidth;
        const resetH = config.defaultHeight;
        void applySize(resetW, resetH);
        saveWindowSize(config.windowKey, { width: resetW, height: resetH });
      };
    }

    handle.onpointerdown = (e) => {
      // Only handle primary button
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      isDragging = true;
      activeDir = hInfo.dir;
      useScreenCoords =
        typeof e.screenX === "number" &&
        typeof e.screenY === "number" &&
        (e.screenX !== 0 || e.screenY !== 0);
      startScreenX = useScreenCoords ? e.screenX : e.clientX;
      startScreenY = useScreenCoords ? e.screenY : e.clientY;
      startWidth = window.innerWidth;
      startHeight = window.innerHeight;

      try {
        handle.setPointerCapture(e.pointerId);
      } catch {
        // Pointer capture may fail in mock environments
      }

      document.body.classList.add("window-resizing");
      document.body.style.cursor = hInfo.cursor;
      handle.classList.add("active");
    };

    handle.onpointermove = (e) => {
      if (!isDragging || activeDir !== hInfo.dir) return;
      e.preventDefault();

      const screenX = useScreenCoords ? e.screenX : e.clientX;
      const screenY = useScreenCoords ? e.screenY : e.clientY;
      const deltaX = screenX - startScreenX;
      const deltaY = screenY - startScreenY;

      const isHorizCentered =
        config.centered === true || config.centered === "horizontal";
      const isVertCentered =
        config.centered === true || config.centered === "vertical";

      let targetW = startWidth;
      let targetH = startHeight;

      if (activeDir === "e" || activeDir === "se") {
        targetW = isHorizCentered
          ? startWidth + 2 * deltaX
          : startWidth + deltaX;
      } else if (activeDir === "w" || activeDir === "sw") {
        targetW = isHorizCentered
          ? startWidth - 2 * deltaX
          : startWidth - deltaX;
      }

      if (activeDir === "s" || activeDir === "se" || activeDir === "sw") {
        targetH = isVertCentered
          ? startHeight + 2 * deltaY
          : startHeight + deltaY;
      }

      const clamped = clampDimensions(targetW, targetH);
      queueUpdate(clamped.width, clamped.height);
    };

    const finishDrag = (e: PointerEvent) => {
      if (!isDragging || activeDir !== hInfo.dir) return;
      isDragging = false;
      activeDir = null;

      try {
        handle.releasePointerCapture(e.pointerId);
      } catch {
        // Ignored
      }

      document.body.classList.remove("window-resizing");
      document.body.style.cursor = "";
      handle.classList.remove("active");

      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }

      // Compute final dimensions
      const screenX = useScreenCoords ? e.screenX : e.clientX;
      const screenY = useScreenCoords ? e.screenY : e.clientY;
      const deltaX = screenX - startScreenX;
      const deltaY = screenY - startScreenY;

      const isHorizCentered =
        config.centered === true || config.centered === "horizontal";
      const isVertCentered =
        config.centered === true || config.centered === "vertical";

      let finalW = startWidth;
      let finalH = startHeight;

      if (hInfo.dir === "e" || hInfo.dir === "se") {
        finalW = isHorizCentered
          ? startWidth + 2 * deltaX
          : startWidth + deltaX;
      } else if (hInfo.dir === "w" || hInfo.dir === "sw") {
        finalW = isHorizCentered
          ? startWidth - 2 * deltaX
          : startWidth - deltaX;
      }

      if (hInfo.dir === "s" || hInfo.dir === "se" || hInfo.dir === "sw") {
        finalH = isVertCentered
          ? startHeight + 2 * deltaY
          : startHeight + deltaY;
      }

      const clamped = clampDimensions(finalW, finalH);
      void applySize(clamped.width, clamped.height);
      saveWindowSize(config.windowKey, {
        width: clamped.width,
        height: clamped.height,
      });
    };

    handle.onpointerup = finishDrag;
    handle.onpointercancel = finishDrag;

    overlay.append(handle);
  }

  document.body.append(overlay);

  return () => {
    overlay.remove();
  };
}
