import {
  DOC_FONT_META,
  STYLE_DEFAULT_FONT,
  defaultLayout,
  type LootDocument,
} from "./types";
import { renderNewspaperDocument } from "./newspaperRender";
import { renderMarkdownInto } from "./markdown";

/**
 * A line of 3+ dashes (`---`) forces a page/section break. Content often
 * arrives pasted from rich editors, so also accept en/em dashes, underscores
 * and asterisks, optionally spaced (`— — —`, `***`), and NBSP "blanks".
 */
const BREAK_LINE = /^[^\S\n]*(?:[-–—―_*][^\S\n]*){3,}$/m;

/*
 * Page geometry, in the paper's own em units. Must stay in sync with
 * paper.css: the paper is 38em wide with 3.6em side padding, so one page
 * column is 30.8em and the gap between columns is the two paddings (7.2em),
 * making each page start exactly one paper-width (38em) apart.
 */
const PAGE_STEP_EM = 38;
const PAGE_GAP_EM = 7.2;

export interface RenderedDocument {
  /** True when the document renders as flippable pages. */
  paged: boolean;
  /** Recount pages after layout-changing events (fonts loaded, font scale). */
  relayout(): void;
  next(): void;
  prev(): void;
  goTo(page: number): void;
  getPage(): number;
}

const FLOW_HANDLE: RenderedDocument = {
  paged: false,
  relayout() {},
  next() {},
  prev() {},
  goTo() {},
  getPage: () => 0,
};

/**
 * Render a document as an immersive piece of paper.
 * Built with textContent only — DM-authored text is never parsed as HTML.
 */
export function renderDocument(
  root: HTMLElement,
  doc: LootDocument,
): RenderedDocument {
  if (doc.style === "newspaper") {
    return renderNewspaperDocument(root, doc);
  }

  root.innerHTML = "";

  const paper = document.createElement("article");
  const texture = doc.texture ?? "aged";
  const paged = (doc.layout ?? defaultLayout(doc.style)) === "pages";
  paper.className = `paper paper-${doc.style} paper-tex-${texture}`;
  if (paged) paper.classList.add("paper-paged");

  const font = DOC_FONT_META[doc.font ?? STYLE_DEFAULT_FONT[doc.style]];
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
  const content = raw.trim() ? raw : "(This page is blank.)";
  const segments = content
    .split(BREAK_LINE)
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

  let handle = FLOW_HANDLE;
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
    const setPage = (target: number): void => {
      page = Math.max(0, Math.min(count - 1, target));
      paper.style.setProperty("--page", String(page));
      label.textContent = `${page + 1} / ${count}`;
      prevBtn.disabled = page === 0;
      nextBtn.disabled = page === count - 1;
    };
    const relayout = (): void => {
      const em = parseFloat(getComputedStyle(paper).fontSize) || 16;
      count = Math.max(
        1,
        Math.round((clip.scrollWidth + PAGE_GAP_EM * em) / (PAGE_STEP_EM * em)),
      );
      nav.hidden = count <= 1;
      setPage(page);
    };
    prevBtn.onclick = () => setPage(page - 1);
    nextBtn.onclick = () => setPage(page + 1);

    // Measure once attached, and again when the web fonts finish loading
    // (their metrics change how much text fits on a page).
    requestAnimationFrame(relayout);
    void document.fonts?.ready.then(() => relayout());

    handle = {
      paged: true,
      relayout,
      next: () => setPage(page + 1),
      prev: () => setPage(page - 1),
      goTo: (target) => setPage(target),
      getPage: () => page,
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
