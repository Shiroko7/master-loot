/**
 * Full-size picture viewer. Clicking a picture on a document (newspaper
 * prints, Markdown figures, picture items) opens the original image over
 * the reader, without the paper's print filters: first fitted to the
 * window, then, on click, at its real resolution (1 pixel per pixel) to
 * pan around by dragging. Escape, ✕ or a click beside the picture closes it.
 *
 * Listens on the root instead of on each picture: newspapers clone their
 * rendered blocks on every reflow, and clones don't keep listeners.
 */

const FIGURE = ".newspaper-figure, .md-figure, .picture-mount";
/** Pointer travel (px) that turns a click into a drag. */
const DRAG_SLOP = 4;

export function enableImageLightbox(root: HTMLElement): void {
  root.addEventListener("click", (event) => {
    const target = event.target as Element | null;
    const figure = target?.closest?.(FIGURE);
    if (!figure || !root.contains(figure)) return;
    const img = figure.querySelector<HTMLImageElement>("img");
    // Broken or still-loading pictures have nothing more to show.
    if (!img || !img.naturalWidth || img.closest("[style*='display: none']")) return;
    event.preventDefault();
    event.stopPropagation();
    const caption = figure.querySelector("figcaption, .md-figure-caption")?.textContent?.trim();
    openImageLightbox(img.currentSrc || img.src, caption || img.alt);
  });
}

export function openImageLightbox(src: string, caption = ""): void {
  document.querySelector(".lightbox")?.remove();
  const returnFocus = document.activeElement;

  const overlay = document.createElement("div");
  overlay.className = "lightbox is-fit";
  overlay.role = "dialog";
  overlay.ariaModal = "true";
  overlay.ariaLabel = caption || "Picture";

  const stage = document.createElement("div");
  stage.className = "lightbox-stage";
  // Focused, so arrow keys scroll the picture at full resolution.
  stage.tabIndex = -1;
  const img = document.createElement("img");
  img.className = "lightbox-img";
  img.referrerPolicy = "no-referrer";
  img.alt = caption;
  img.draggable = false;
  img.src = src;
  stage.append(img);

  const bar = document.createElement("div");
  bar.className = "lightbox-bar";
  const text = document.createElement("span");
  text.className = "lightbox-caption";
  text.textContent = caption;
  const size = document.createElement("span");
  size.className = "lightbox-size";
  const toggle = document.createElement("button");
  toggle.className = "btn-icon lightbox-toggle";
  const open = document.createElement("a");
  open.className = "btn-icon";
  open.href = src;
  open.target = "_blank";
  open.rel = "noreferrer noopener";
  open.textContent = "↗";
  open.title = "Open the original in a new tab";
  open.ariaLabel = open.title;
  const close = document.createElement("button");
  close.className = "btn-icon";
  close.textContent = "✕";
  close.title = "Close (Esc)";
  close.ariaLabel = "Close";
  bar.append(text, size, toggle, open, close);
  overlay.append(stage, bar);

  let actual = false;
  /** Does the picture already show 1:1 when fitted? Then there is no zoom. */
  const fitsWhole = () =>
    img.naturalWidth <= stage.clientWidth && img.naturalHeight <= stage.clientHeight;

  function update(): void {
    const zoomable = img.naturalWidth > 0 && !fitsWhole();
    overlay.classList.toggle("is-fit", !actual);
    overlay.classList.toggle("is-actual", actual);
    overlay.classList.toggle("is-zoomable", zoomable);
    toggle.hidden = !zoomable;
    toggle.textContent = actual ? "Fit" : "1:1";
    toggle.title = actual ? "Fit to the window" : "Show at full resolution";
    toggle.ariaLabel = toggle.title;
  }

  /** Switch modes, keeping the point under (clientX, clientY) in place. */
  function setActual(next: boolean, clientX?: number, clientY?: number): void {
    if (next === actual || (next && fitsWhole())) return;
    const before = img.getBoundingClientRect();
    const fx = clientX === undefined ? 0.5 : (clientX - before.left) / before.width;
    const fy = clientY === undefined ? 0.5 : (clientY - before.top) / before.height;
    actual = next;
    update();
    if (actual) {
      const box = stage.getBoundingClientRect();
      const px = clientX ?? box.left + box.width / 2;
      const py = clientY ?? box.top + box.height / 2;
      stage.scrollLeft = img.offsetLeft + fx * img.naturalWidth - (px - box.left);
      stage.scrollTop = img.offsetTop + fy * img.naturalHeight - (py - box.top);
    }
  }

  img.onload = () => {
    size.textContent = `${img.naturalWidth} × ${img.naturalHeight} px`;
    update();
  };
  img.onerror = () => {
    size.textContent = "Picture unavailable";
  };
  toggle.onclick = () => setActual(!actual);
  close.onclick = () => dismiss();

  // Drag to pan at full resolution; a click without travel toggles the zoom.
  let drag: { x: number; y: number; left: number; top: number; moved: boolean } | undefined;
  stage.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    drag = { x: event.clientX, y: event.clientY, left: stage.scrollLeft, top: stage.scrollTop, moved: false };
  });
  stage.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
    if (!drag.moved) stage.setPointerCapture(event.pointerId);
    drag.moved = true;
    if (actual) {
      stage.scrollLeft = drag.left - dx;
      stage.scrollTop = drag.top - dy;
    }
  });
  stage.addEventListener("pointerup", (event) => {
    const wasDrag = drag?.moved;
    drag = undefined;
    if (wasDrag) return;
    if (event.target === img) setActual(!actual, event.clientX, event.clientY);
    else dismiss();
  });
  stage.addEventListener("pointercancel", () => { drag = undefined; });

  // Capture on window runs before the reader's and editor's own shortcuts:
  // Escape closes only this, and arrows don't turn pages underneath.
  function onKey(event: KeyboardEvent): void {
    if (event.key === "Escape") dismiss();
    else if (event.key === " " || event.key === "Enter") {
      if (event.target instanceof HTMLButtonElement || event.target instanceof HTMLAnchorElement) return;
      setActual(!actual);
    } else if (!event.key.startsWith("Arrow") && event.key !== "PageUp" && event.key !== "PageDown") return;
    // Arrows still scroll the stage at full resolution (the default action).
    if (!event.key.startsWith("Arrow") || !actual) event.preventDefault();
    event.stopImmediatePropagation();
  }
  const onResize = () => update();
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("resize", onResize);

  function dismiss(): void {
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", onResize);
    overlay.remove();
    if (returnFocus instanceof HTMLElement) returnFocus.focus();
  }

  update();
  document.body.append(overlay);
  stage.focus();
}
