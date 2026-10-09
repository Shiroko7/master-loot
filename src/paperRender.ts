import {
  DOC_FONT_META,
  STYLE_DEFAULT_FONT,
  defaultLayout,
  type LootDocument,
} from "./types";
import { renderNewspaperDocument } from "./newspaperRender";
import { PAGE_BREAK_LINE, renderMarkdownInto, splitOutsideInserts } from "./markdown";
import { renderMusicInto, type MusicScore } from "./musicSheet";

/**
 * A line of 3+ dashes (`---`) forces a page/section break. Content often
 * arrives pasted from rich editors, so also accept en/em dashes, underscores
 * and asterisks, optionally spaced (`— — —`, `***`), and NBSP "blanks".
 */

/*
 * Every page starts exactly one paper-width (--paper-w, see .paper in
 * paper.css) after the previous one. The width and the column gap (the
 * paper's margins, --pad-x) are read back from CSS at layout time.
 */
const DEFAULT_PAPER_EM = 38;

export interface RenderedDocument {
  /** True when the document renders as flippable pages. */
  paged: boolean;
  /** Recount pages after layout-changing events (fonts loaded, font scale). */
  relayout(): void;
  next(): void;
  prev(): void;
  goTo(page: number): void;
  getPage(): number;
  /** Physical, one-based pages; newspapers and music show two per spread. */
  getPosition(): DocumentPagePosition | undefined;
}

export interface DocumentPagePosition {
  page: number;
  lastPage: number;
  pageCount: number;
}

const FLOW_HANDLE: RenderedDocument = {
  paged: false,
  relayout() {},
  next() {},
  prev() {},
  goTo() {},
  getPage: () => 0,
  getPosition: () => undefined,
};

/**
 * Render a document as an immersive piece of paper.
 * Built with textContent only — DM-authored text is never parsed as HTML.
 */
export function renderDocument(
  root: HTMLElement,
  doc: LootDocument,
  onPageChange?: () => void,
): RenderedDocument {
  if (doc.style === "newspaper") {
    return renderNewspaperDocument(root, doc, onPageChange);
  }

  root.innerHTML = "";

  const paper = document.createElement("article");
  const texture = doc.texture ?? "aged";
  const paged = (doc.layout ?? defaultLayout(doc.style)) === "pages";
  paper.className = `paper paper-${doc.style} paper-tex-${texture}`;
  if (paged) paper.classList.add("paper-paged");

  const fontKey = doc.font ?? STYLE_DEFAULT_FONT[doc.style];
  const font = DOC_FONT_META[fontKey];
  paper.dataset.font = fontKey;
  paper.style.setProperty("--doc-font", font.family);
  paper.style.setProperty("--font-adjust", String(font.adjust));

  if (doc.style === "scroll") {
    for (const cls of ["roll roll-top", "roll roll-bottom"]) {
      const roll = document.createElement("div");
      roll.className = cls;
      paper.append(roll);
    }
  }

  let title: HTMLElement | undefined;
  if (doc.title.trim()) {
    title = document.createElement("h1");
    title.className = "paper-title";
    title.textContent = doc.title;
  }

  const body = document.createElement("div");
  body.className = "paper-body";
  // Normalize Windows/old-Mac line endings so line-anchored parsing works
  // on content pasted from anywhere.
  const raw = doc.content.replace(/\r\n?/g, "\n");
  // Sheet music is ABC notation, engraved as staves instead of set as text.
  let score: MusicScore | undefined;
  if (doc.style === "music") {
    score = renderMusicInto(body, raw, font);
  } else {
    const content = raw.trim() ? raw : "(This page is blank.)";
    const segments = splitOutsideInserts(content, (line) => PAGE_BREAK_LINE.test(line))
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0);
    if (segments.length === 0) segments.push("(This page is blank.)");
    segments.forEach((segment, index) => {
      if (index > 0) {
        // Between segments: a hard page break, or a section divider when
        // the document is one continuous sheet.
        const divider = document.createElement("div");
        divider.className = paged ? "page-break" : "text-divider";
        body.append(divider);
      }
      renderMarkdownInto(body, segment, {
        dropCapFirstParagraph: doc.style === "book" && index === 0,
      });
    });
  }

  let handle = score ? { ...FLOW_HANDLE, relayout: score.relayout } : FLOW_HANDLE;
  if (paged) {
    // Multi-column layout does the real work: the browser flows text into
    // page-sized columns (honoring `break-before` for manual breaks) and
    // the clip window shows one column at a time via a horizontal shift.
    const clip = document.createElement("div");
    clip.className = "paper-clip";
    const pages = document.createElement("div");
    pages.className = "paper-pages";
    if (title) pages.append(title); // heading lives on the first page only
    pages.append(body);
    // Sheet music opens like a folder on a music stand: two pages side by
    // side, unless the tune fits on one. The marker ends the content, so its
    // column is the last page (the pages box itself is two pages wide then,
    // which makes its scroll width useless for counting).
    const spread = doc.style === "music";
    const endMark = document.createElement("div");
    if (spread) pages.append(endMark);
    clip.append(pages);
    paper.append(clip);

    const nav = document.createElement("div");
    nav.className = "page-nav";
    const prevBtn = document.createElement("button");
    prevBtn.textContent = "‹";
    prevBtn.ariaLabel = "Previous page";
    const label = document.createElement("span");
    const nextBtn = document.createElement("button");
    nextBtn.textContent = "›";
    nextBtn.ariaLabel = "Next page";
    nav.append(prevBtn, label, nextBtn);
    paper.append(nav);

    let page = 0;
    let count = 1;
    // Pages turned at once, and the last page showing: a spread starts on
    // an even index and may end the document on its left page.
    const step = spread ? 2 : 1;
    const lastShown = (): number => Math.min(page + step, count) - 1;
    const setPage = (target: number): void => {
      page = Math.max(0, Math.min(count - 1, target));
      page -= page % step;
      paper.style.setProperty("--page", String(page));
      label.textContent = lastShown() > page
        ? `${page + 1}–${lastShown() + 1} / ${count}`
        : `${page + 1} / ${count}`;
      prevBtn.disabled = page === 0;
      nextBtn.disabled = lastShown() === count - 1;
      if (paper.isConnected) onPageChange?.();
    };
    const relayout = (): void => {
      score?.relayout();
      // Pictures size themselves against the real page height (see the
      // md-figure rules in paper.css); set it before counting pages.
      // (The pages box, not the clip: the clip also spans the margins.)
      paper.style.setProperty("--page-px", `${pages.clientHeight}px`);
      const paperStyle = getComputedStyle(paper);
      const em = parseFloat(paperStyle.fontSize) || 16;
      const stepEm = parseFloat(paperStyle.getPropertyValue("--paper-w")) || DEFAULT_PAPER_EM;
      const gap = parseFloat(getComputedStyle(pages).columnGap) || 0;
      if (spread) {
        const offset = endMark.getBoundingClientRect().left - pages.getBoundingClientRect().left;
        count = Math.max(1, Math.floor(offset / (stepEm * em) + 0.5) + 1);
        paper.classList.toggle("paper-spread", count > 1);
      } else {
        count = Math.max(
          1,
          Math.round((pages.scrollWidth + gap) / (stepEm * em)),
        );
      }
      nav.hidden = count <= 1;
      setPage(page);
    };
    prevBtn.onclick = () => setPage(page - step);
    nextBtn.onclick = () => setPage(page + step);

    // Measure once attached, then again whenever the text's size really
    // changes: web fonts arriving (their metrics change how much fits on a
    // page), pictures loading, zoom. `document.fonts.ready` alone isn't
    // enough — right after rendering no font download has started yet, so
    // it resolves immediately and measures the fallback font.
    requestAnimationFrame(relayout);
    void document.fonts?.ready.then(() => relayout());
    let queued = false;
    const observer = new ResizeObserver(() => {
      if (!paper.isConnected) {
        observer.disconnect();
        return;
      }
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        relayout();
      });
    });
    observer.observe(body);
    observer.observe(clip);

    handle = {
      paged: true,
      relayout,
      next: () => setPage(page + step),
      prev: () => setPage(page - step),
      goTo: (target) => setPage(target),
      getPage: () => page,
      getPosition: () => ({ page: page + 1, lastPage: lastShown() + 1, pageCount: count }),
    };
  } else {
    if (title) paper.append(title);
    paper.append(body);
  }

  // Last child so stains, creases and char paint on top of the ink.
  if (texture !== "aged") {
    const overlay = document.createElement("div");
    overlay.className = "paper-texture";
    paper.append(overlay);
  }

  root.append(paper);
  return handle;
}
