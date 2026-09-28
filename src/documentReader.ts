import { renderIdCard } from "./idCard";
import { renderPicture } from "./pictureView";
import { renderDocument, type RenderedDocument } from "./paperRender";
import {
  DEFAULT_PREFS,
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  ZOOM_MAX,
  ZOOM_MIN,
  getPrefs,
  savePrefs,
  type ReadingPrefs,
} from "./storage";
import type { LootItem } from "./types";

/**
 * The document reader: toolbar (text size, zoom, reset, close) over the
 * rendered paper. Players read documents in it, and the editor's quick
 * preview embeds the very same component, so what the GM previews is
 * exactly what players get — same zoom, same text size, same spacing.
 * Zoom and text size are the viewer's own reading preferences, shared by
 * every reader on this browser.
 */
export interface DocumentReader {
  /** Root element to mount. */
  el: HTMLElement;
  /** Render an entry; keeps scroll position and page across re-renders. */
  show(entry: LootItem | undefined): void;
  next(): void;
  prev(): void;
}

export function createDocumentReader(options: { onClose: () => void }): DocumentReader {
  let prefs: ReadingPrefs = getPrefs();
  let rendered: RenderedDocument | undefined;

  const page = document.createElement("div");
  page.className = "doc-page";

  const toolbar = document.createElement("div");
  toolbar.className = "doc-toolbar";

  const titleEl = document.createElement("span");
  titleEl.className = "doc-toolbar-title";

  const fontValue = document.createElement("span");
  fontValue.className = "value";
  const zoomValue = document.createElement("span");
  zoomValue.className = "value";

  function toolButton(
    label: string,
    ariaLabel: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.className = "btn-icon";
    btn.textContent = label;
    btn.ariaLabel = ariaLabel;
    btn.title = ariaLabel;
    btn.onclick = onClick;
    return btn;
  }

  function sep(): HTMLElement {
    const s = document.createElement("span");
    s.className = "sep";
    return s;
  }

  const scroll = document.createElement("div");
  scroll.className = "doc-scroll";
  const stage = document.createElement("div");
  stage.className = "paper-stage";
  scroll.append(stage);

  toolbar.append(
    titleEl,
    toolButton("A−", "Smaller text", () => adjustFont(-0.1)),
    fontValue,
    toolButton("A+", "Larger text", () => adjustFont(0.1)),
    sep(),
    toolButton("−", "Zoom out", () => adjustZoom(-0.1)),
    zoomValue,
    toolButton("+", "Zoom in", () => adjustZoom(0.1)),
    sep(),
    toolButton("↺", "Reset text size and zoom", resetPrefs),
    toolButton("✕", "Close", options.onClose),
  );

  page.append(toolbar, scroll);

  function clampRound(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, Math.round(value * 10) / 10));
  }

  function applyPrefs(): void {
    stage.style.setProperty("--font-scale", String(prefs.fontScale));
    stage.style.setProperty("--zoom", String(prefs.zoom));
    fontValue.textContent = `${Math.round(prefs.fontScale * 100)}%`;
    zoomValue.textContent = `${Math.round(prefs.zoom * 100)}%`;
    savePrefs(prefs);
    // Larger text fits fewer words per page — recount after reflow.
    requestAnimationFrame(() => rendered?.relayout());
  }

  function adjustFont(delta: number): void {
    prefs.fontScale = clampRound(
      prefs.fontScale + delta,
      FONT_SCALE_MIN,
      FONT_SCALE_MAX,
    );
    applyPrefs();
  }

  function adjustZoom(delta: number): void {
    prefs.zoom = clampRound(prefs.zoom + delta, ZOOM_MIN, ZOOM_MAX);
    applyPrefs();
  }

  function resetPrefs(): void {
    prefs = { ...DEFAULT_PREFS };
    applyPrefs();
  }

  function show(entry: LootItem | undefined): void {
    if (entry?.kind === "idcard") {
      titleEl.textContent = entry.name || "Identification";
      rendered = undefined;
      renderIdCard(stage, entry);
      return;
    }
    // Picture items, and regular items opened through their picture.
    if (entry?.kind === "picture" || (entry && !entry.document && entry.imageUrl?.trim())) {
      titleEl.textContent = entry.name || "Picture";
      rendered = undefined;
      renderPicture(stage, entry);
      return;
    }
    const doc = entry?.document;
    if (!entry || !doc) {
      titleEl.textContent = "Document";
      rendered = undefined;
      stage.innerHTML = "";
      const note = document.createElement("div");
      note.className = "empty-note";
      note.textContent = "This document is gone.";
      stage.append(note);
      return;
    }
    // The toolbar shows the item's name; untitled papers still have one.
    titleEl.textContent = doc.title || entry.name || "Untitled";
    // Re-renders arrive for unrelated scene changes (any token move); keep
    // the reader's place instead of resetting to the top / first page.
    const scrollTop = scroll.scrollTop;
    const current = rendered?.getPage() ?? 0;
    rendered = renderDocument(stage, doc);
    scroll.scrollTop = scrollTop;
    requestAnimationFrame(() => {
      rendered?.relayout();
      rendered?.goTo(current);
    });
  }

  applyPrefs();

  return {
    el: page,
    show,
    next: () => rendered?.next(),
    prev: () => rendered?.prev(),
  };
}
