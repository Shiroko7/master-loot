import { renderIdCard } from "./idCard";
import { renderPicture } from "./pictureView";
import { renderDocument, type RenderedDocument, type DocumentPagePosition } from "./paperRender";
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
import { describeViewingProgress, type ViewLocation } from "./viewPresenceState";

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
  /** Update the small live list of other players reading this same document. */
  setViewers(viewers: DocumentViewer[]): void;
}

export interface DocumentViewer {
  id: string;
  name: string;
  location: ViewLocation;
  hidden: boolean;
}

export interface DocumentReadingState {
  entry: LootItem | undefined;
  position: DocumentPagePosition | undefined;
  atEnd: boolean;
}

export function createDocumentReader(options: {
  onClose: () => void;
  onReadingChange?: (state: DocumentReadingState) => void;
}): DocumentReader {
  let prefs: ReadingPrefs = getPrefs();
  let rendered: RenderedDocument | undefined;
  let currentEntry: LootItem | undefined;
  let lastEntrySignature: string | undefined;
  let restoring = false;
  let generation = 0;

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

  const viewersEl = document.createElement("div");
  viewersEl.className = "doc-viewers";
  viewersEl.hidden = true;

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

  function setViewers(viewers: DocumentViewer[]): void {
    viewersEl.replaceChildren();
    if (viewers.length === 0) {
      viewersEl.hidden = true;
      return;
    }
    viewersEl.hidden = false;
    const label = document.createElement("span");
    label.className = "doc-viewers-label";
    label.textContent = "Also viewing:";
    viewersEl.append(label);
    for (const viewer of viewers) {
      const row = document.createElement("span");
      row.className = "doc-viewer";
      row.dataset.viewerId = viewer.id;
      const name = document.createElement("strong");
      name.textContent = viewer.name;
      row.append(name);
      const progress = describeViewingProgress(viewer.location);
      if (progress) {
        const detail = document.createElement("span");
        detail.className = "doc-viewer-progress";
        detail.textContent = progress;
        row.append(" · ", detail);
      }
      if (viewer.hidden) {
        const background = document.createElement("span");
        background.className = "doc-viewer-background";
        background.textContent = " · background tab";
        row.append(background);
      }
      viewersEl.append(row);
    }
  }

  const scroll = document.createElement("div");
  scroll.className = "doc-scroll";
  const stage = document.createElement("div");
  stage.className = "paper-stage";
  scroll.append(stage);
  function reportPosition(): void {
    if (restoring) return;
    const position = rendered?.getPosition();
    if (position && position.pageCount < 1) return;
    options.onReadingChange?.({
      entry: currentEntry,
      position,
      atEnd: position ? position.lastPage === position.pageCount :
        scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight <= 8,
    });
  }
  scroll.addEventListener("scroll", reportPosition, { passive: true });
  if (options.onReadingChange) {
    const scrollObserver = new ResizeObserver(reportPosition);
    scrollObserver.observe(scroll);
    scrollObserver.observe(stage);
  }

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

  page.append(toolbar, viewersEl, scroll);

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
    const signature = JSON.stringify(entry ?? null);
    if (signature === lastEntrySignature) return;
    lastEntrySignature = signature;
    const sameEntry = entry?.id === currentEntry?.id;
    currentEntry = entry;
    const thisGeneration = ++generation;
    restoring = false;
    if (entry?.kind === "idcard") {
      titleEl.textContent = entry.name || "Identification";
      rendered = undefined;
      renderIdCard(stage, entry);
      reportPosition();
      return;
    }
    // Picture items, and regular items opened through their picture.
    if (entry?.kind === "picture" || (entry && !entry.document && entry.imageUrl?.trim())) {
      titleEl.textContent = entry.name || "Picture";
      rendered = undefined;
      renderPicture(stage, entry);
      reportPosition();
      return;
    }
    const doc = entry?.document;
    if (!entry || !doc) {
      currentEntry = undefined;
      titleEl.textContent = "Document";
      rendered = undefined;
      stage.innerHTML = "";
      const note = document.createElement("div");
      note.className = "empty-note";
      note.textContent = "This document is gone.";
      stage.append(note);
      reportPosition();
      return;
    }
    // The toolbar shows the item's name; untitled papers still have one.
    titleEl.textContent = doc.title || entry.name || "Untitled";
    // Re-renders arrive for unrelated scene changes (any token move); keep
    // the reader's place instead of resetting to the top / first page.
    const scrollTop = sameEntry ? scroll.scrollTop : 0;
    const current = sameEntry ? rendered?.getPage() ?? 0 : 0;
    restoring = true;
    rendered = renderDocument(stage, doc, () => {
      if (thisGeneration === generation) reportPosition();
    });
    scroll.scrollTop = scrollTop;
    requestAnimationFrame(() => {
      if (thisGeneration !== generation) return;
      rendered?.relayout();
      rendered?.goTo(current);
      restoring = false;
      reportPosition();
    });
  }

  applyPrefs();

  return {
    el: page,
    show,
    next: () => rendered?.next(),
    prev: () => rendered?.prev(),
    setViewers,
  };
}
