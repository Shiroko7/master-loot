import {
  DOC_FONT_META,
  STYLE_DEFAULT_FONT,
  defaultLayout,
  normalizeNewspaperLayout,
  type LootDocument,
  type NewspaperImage,
  type NewspaperLayout,
  type NewspaperPrintFilter,
} from "./types";
import { renderInlineMarkdown, normalizeImageUrl } from "./markdown";
import { fillNewspaperColumn } from "./newspaperPagination";
import { resolveNewspaperHeading } from "./newspaperHeading";
import { fillNewspaperWidePage } from "./newspaperWidePagination";

const BREAK_LINE = /^[^\S\n]*(?:[-–—―_*][^\S\n]*){3,}$/m;
const NOTE_BLOCK = /^\*([^*][\s\S]*)\*$/;

export interface RenderedDocument {
  paged: boolean;
  relayout(): void;
  next(): void;
  prev(): void;
  goTo(page: number): void;
  getPage(): number;
}

export type NewspaperFlowBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "quote"; text: string; author?: string; isBanner?: boolean }
  | { kind: "highlight"; text: string; label?: string }
  | { kind: "crosshead"; text: string }
  | { kind: "note"; text: string }
  | { kind: "image"; image: NewspaperImage };

export interface ParsedNewspaperPage {
  pageIndex: number;
  headline?: string;
  subhead?: string;
  paragraphs: string[];
  quotes: string[];
  notes: string[];
  blocks: NewspaperFlowBlock[];
  images: NewspaperImage[];
}

/** Smart Fit keeps a stable reading grid; saved retired presets map to their successors. */
export function resolveNewspaperLayout(preferred?: NewspaperLayout): Exclude<NewspaperLayout, "auto"> {
  const layout = normalizeNewspaperLayout(preferred);
  return layout === "auto" ? "split-lead" : layout;
}

/**
 * Parses raw document content and distributes images across pages.
 */
export function parseNewspaperPages(doc: LootDocument): ParsedNewspaperPage[] {
  const raw = doc.content.replace(/\r\n?/g, "\n");
  let rawSegments = raw
    .split(BREAK_LINE)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (rawSegments.length === 0) {
    rawSegments.push(raw.trim() || "(No news reported today.)");
  }

  // Parsing only honors author-requested breaks. Physical pagination happens
  // after fonts, images and the actual page dimensions can be measured.
  if (doc.layout !== "flow") {
    rawSegments = rawSegments.flatMap((segment) =>
      segment.split(/\n(?=# [^\n]+)/).map((part) => part.trim()).filter(Boolean),
    );
  }

  const explicitImages: NewspaperImage[] = Array.isArray(doc.images)
    ? doc.images
        .filter((img) => img && typeof img.url === "string" && img.url.trim().length > 0)
        .map((img) => ({
          url: normalizeImageUrl(img.url.trim()),
          caption: img.caption?.trim(),
          filter: img.filter,
          width: img.width,
        }))
    : [];

  const pages: ParsedNewspaperPage[] = [];

  rawSegments.forEach((segment, pageIndex) => {
    let headline: string | undefined;
    let subhead: string | undefined;
    const blocks: NewspaperFlowBlock[] = [];
    const paragraphs: string[] = [];
    const quotes: string[] = [];
    const notes: string[] = [];
    const pageImages: NewspaperImage[] = [];

    const lines = segment.split("\n");
    let currentParagraphLines: string[] = [];

    const flushParagraph = () => {
      if (currentParagraphLines.length > 0) {
        const text = currentParagraphLines.join("\n").trim();
        if (text) {
          const noteMatch = NOTE_BLOCK.exec(text);
          if (noteMatch) {
            const noteText = noteMatch[1].trim();
            notes.push(noteText);
            blocks.push({ kind: "note", text: noteText });
          } else {
            paragraphs.push(text);
            blocks.push({ kind: "paragraph", text });
          }
        }
        currentParagraphLines = [];
      }
    };

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        flushParagraph();
        continue;
      }
      if (line.includes("![") && /!\[([^\]]*)\]\(([^)]+)\)/.test(line)) {
        const parts = line.split(/(!\[[^\]]*\]\([^)]+\))/g);
        for (const part of parts) {
          const m = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(part.trim());
          if (m) {
            flushParagraph();
            let caption = m[1] ? m[1].trim() : undefined;
            const url = m[2].trim();
            let filter: NewspaperPrintFilter | undefined;
            let width: NewspaperImage["width"];
            if (caption && caption.includes("|")) {
              const parts = caption.split("|");
              while (parts.length > 1) {
                const candidate = parts[parts.length - 1].trim().toLowerCase();
                if (["halftone", "engraving", "sepia", "color-press", "raw"].includes(candidate)) {
                  filter = candidate as NewspaperPrintFilter;
                } else if (candidate === "page" || candidate === "column") {
                  width = candidate;
                } else break;
                parts.pop();
              }
              caption = parts.join("|").trim();
            }
            const imgObj: NewspaperImage = {
              url: normalizeImageUrl(url),
              caption: caption || undefined,
              filter,
              width,
            };
            pageImages.push(imgObj);
            blocks.push({ kind: "image", image: imgObj });
          } else if (part.trim()) {
            currentParagraphLines.push(part.trim());
          }
        }
        continue;
      }
      if (line.startsWith("# ") && !headline) {
        flushParagraph();
        headline = line.slice(2).trim();
        continue;
      }
      if (line.startsWith("## ") && !subhead) {
        flushParagraph();
        subhead = line.slice(3).trim();
        continue;
      }
      if (line.startsWith("### ") || line.startsWith("#### ")) {
        flushParagraph();
        const crossText = line.replace(/^#{3,4}\s*/, "").trim();
        if (crossText) {
          blocks.push({ kind: "crosshead", text: crossText });
        }
        continue;
      }
      // Standard GitHub Flavored Markdown alerts: > [!NOTE], > [!ALERT], > [!WARNING], etc.
      if (line.startsWith("> [!")) {
        flushParagraph();
        const alertMatch = /^>\s*\[!([A-Za-z0-9_-]+)\]\s*(.*)$/.exec(line);
        if (alertMatch) {
          const label = alertMatch[1].trim();
          const text = alertMatch[2].trim();
          blocks.push({ kind: "highlight", text, label });
          continue;
        }
      }
      if (line.startsWith(">> ") || line.startsWith("> ")) {
        flushParagraph();
        const isBanner = line.startsWith(">> ");
        const rawQuote = line.replace(/^>>?\s*/, "").trim();
        quotes.push(rawQuote);

        let quoteText = rawQuote;
        let author: string | undefined;
        // Match trailing — Author, – Author, or -- Author
        const dashIdx = rawQuote.search(/\s+(?:—|–|--)\s+[A-Za-z0-9]/);
        if (dashIdx !== -1) {
          quoteText = rawQuote.slice(0, dashIdx).trim();
          author = rawQuote.slice(dashIdx).replace(/^[\s—–-]+/, "").trim();
        }

        blocks.push({
          kind: "quote",
          text: quoteText,
          author,
          isBanner,
        });
        continue;
      }
      if (line.startsWith("! ")) {
        flushParagraph();
        const content = line.slice(2).trim();
        let label: string | undefined;
        let text = content;
        const bracketMatch = /^\[([^\]]+)\]\s*(.*)$/.exec(content);
        const colonMatch = /^([A-Za-z0-9\s]{2,18}):\s+(.*)$/.exec(content);
        if (bracketMatch) {
          label = bracketMatch[1].trim();
          text = bracketMatch[2].trim();
        } else if (colonMatch && !colonMatch[1].toLowerCase().startsWith("http")) {
          label = colonMatch[1].trim();
          text = colonMatch[2].trim();
        }
        blocks.push({ kind: "highlight", text, label });
        continue;
      }
      const noteMatch = NOTE_BLOCK.exec(line);
      if (noteMatch) {
        flushParagraph();
        const noteText = noteMatch[1].trim();
        notes.push(noteText);
        blocks.push({ kind: "note", text: noteText });
        continue;
      }
      currentParagraphLines.push(rawLine);
    }
    flushParagraph();

    if (paragraphs.length === 0 && blocks.length === 0) {
      paragraphs.push("(Story continues on the back page.)");
      blocks.push({ kind: "paragraph", text: "(Story continues on the back page.)" });
    } else if (paragraphs.length === 0 && blocks.length > 0) {
      const firstText = blocks.find((b): b is Exclude<NewspaperFlowBlock, { kind: "image" }> => b.kind !== "image");
      if (firstText) {
        paragraphs.push(firstText.text);
      }
    }

    pages.push({
      pageIndex,
      headline,
      subhead,
      paragraphs,
      quotes,
      notes,
      blocks,
      images: pageImages,
    });
  });

  // Keep attachment order across authored stories. Round-robin distribution
  // would print pictures 1, 3, 5 before 2, 4, 6 in a two-story edition.
  if (explicitImages.length > 0 && pages.length > 0) {
    const pagesNeedingImages = pages.filter((p) => p.images.length === 0);
    const targetPages = pagesNeedingImages.length > 0 ? pagesNeedingImages : pages;
    explicitImages.forEach((img, i) => {
      const targetPage = targetPages[Math.floor(i * targetPages.length / explicitImages.length)];
      targetPage.images.push(img);
    });
  }

  return pages;
}

/**
 * Creates an authentic newspaper picture slot with engraving/photo filter.
 */
function createPictureSlot(
  img: NewspaperImage,
  docFilter: NewspaperPrintFilter = "halftone",
  extraClass = "",
  onSizeChange: () => void = () => {},
): HTMLElement {
  const filterType = img.filter || docFilter || "halftone";
  const slot = document.createElement("div");
  slot.className = `newspaper-slot ${extraClass}`.trim();
  if (img.width) slot.dataset.imageWidth = img.width;

  const figure = document.createElement("figure");
  figure.className = `newspaper-figure newspaper-print-${filterType} aspect-unknown`;

  const frame = document.createElement("div");
  frame.className = "newspaper-img-frame";

  const resolvedUrl = normalizeImageUrl(img.url);

  const imgEl = document.createElement("img");
  imgEl.className = "newspaper-img";
  imgEl.referrerPolicy = "no-referrer";
  if (typeof imgEl.setAttribute === "function") {
    imgEl.setAttribute("referrerpolicy", "no-referrer");
  }
  imgEl.src = resolvedUrl;
  imgEl.alt = img.caption || "Newspaper illustration";
  imgEl.loading = "eager";

  const applyAspect = () => {
    if (!imgEl.naturalWidth || !imgEl.naturalHeight) return;

    // Detect Imgur's famous removed.png (161 x 81)
    if (
      imgEl.src.includes("imgur") &&
      imgEl.naturalWidth === 161 &&
      imgEl.naturalHeight === 81
    ) {
      frame.style.display = "none";
      figure.classList.add("newspaper-img-broken");
      const placeholder = document.createElement("div");
      placeholder.className = "newspaper-img-placeholder";
      placeholder.innerHTML = `<span class="icon">⚠️</span><span>[Imgur image removed or expired. Please re-upload or use 📁 Upload.]</span>`;
      figure.prepend(placeholder);
      return;
    }

    const ratio = imgEl.naturalWidth / imgEl.naturalHeight;
    const aspect = ratio >= 1.35 ? "landscape" : ratio < 0.85 ? "portrait" : "square";
    figure.dataset.aspect = aspect;
    figure.classList.remove("aspect-unknown", "aspect-landscape", "aspect-portrait", "aspect-square");
    figure.classList.add(`aspect-${aspect}`);
    figure.style.setProperty("--img-ratio", String(ratio.toFixed(2)));
  };

  imgEl.onload = () => { applyAspect(); onSizeChange(); };
  if (imgEl.complete && imgEl.naturalWidth > 0) {
    applyAspect();
  }

  imgEl.onerror = () => {
    // If an Imgur .png failed, try .jpg as a fallback before declaring broken
    if (imgEl.src.endsWith(".png") && imgEl.src.includes("i.imgur.com")) {
      imgEl.src = imgEl.src.replace(/\.png$/, ".jpg");
      return;
    }
    frame.style.display = "none";
    figure.classList.add("newspaper-img-broken");
    const placeholder = document.createElement("div");
    placeholder.className = "newspaper-img-placeholder";
    placeholder.textContent = `📰 [Illustration: ${img.caption || "Archival print"}]`;
    figure.prepend(placeholder);
    onSizeChange();
  };

  frame.append(imgEl);
  figure.append(frame);

  if (img.caption && img.caption.trim()) {
    const caption = document.createElement("figcaption");
    caption.className = "newspaper-caption";
    caption.append(renderInlineMarkdown(img.caption.trim()));
    figure.append(caption);
  }

  slot.append(figure);
  return slot;
}

const DATELINE_REGEX = /^([A-Z][A-Z0-9\s,.'-]{2,32})\s*(?:—|–|--)\s+(.+)$/s;

function createParagraph(text: string, isFirst = false): HTMLParagraphElement {
  const p = document.createElement("p");
  if (isFirst) p.classList.add("has-drop-cap");
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    if (i > 0) p.append(document.createElement("br"), document.createTextNode("\n"));

    if (i === 0) {
      const match = DATELINE_REGEX.exec(line);
      if (match && match[1] === match[1].toUpperCase()) {
        const place = match[1].trim();
        const remainder = match[2];
        const span = document.createElement("span");
        span.className = "newspaper-dateline";
        span.textContent = `${place} —`;
        p.append(span);
        p.append(document.createTextNode(" "));
        p.append(renderInlineMarkdown(remainder));
        return;
      }
    }

    p.append(renderInlineMarkdown(line));
  });
  return p;
}

function createQuote(
  text: string,
  author?: string,
  isBanner = false,
): HTMLElement {
  const q = document.createElement("blockquote");
  q.className = "newspaper-quote";
  if (isBanner) q.classList.add("is-banner");

  let cleanText = text.trim();
  if (
    (cleanText.startsWith('"') && cleanText.endsWith('"')) ||
    (cleanText.startsWith('“') && cleanText.endsWith('”'))
  ) {
    cleanText = cleanText.slice(1, -1).trim();
  }

  const leftMark = document.createElement("span");
  leftMark.className = "quote-mark";
  leftMark.textContent = "“";

  const rightMark = document.createElement("span");
  rightMark.className = "quote-mark";
  rightMark.textContent = "”";

  const body = document.createElement("span");
  body.className = "quote-body";
  body.append(renderInlineMarkdown(cleanText));

  q.append(leftMark, body, rightMark);

  if (author && author.trim()) {
    const cite = document.createElement("cite");
    cite.className = "newspaper-quote-author";
    cite.textContent = `— ${author.trim().replace(/^[—–-]+\s*/, "")}`;
    q.append(cite);
  }

  return q;
}

function createHighlight(text: string, label?: string): HTMLElement {
  const bar = document.createElement("div");
  bar.className = "newspaper-highlight-bar";

  if (label && label.trim()) {
    const badge = document.createElement("span");
    badge.className = "newspaper-highlight-badge";
    badge.textContent = label.trim().toUpperCase();
    bar.append(badge);
  }

  const span = document.createElement("span");
  span.className = "newspaper-highlight-text";
  span.append(renderInlineMarkdown(text));
  bar.append(span);

  return bar;
}

function createCrosshead(text: string): HTMLElement {
  const h = document.createElement("h3");
  h.className = "newspaper-crosshead";
  h.append(renderInlineMarkdown(text));
  return h;
}

function createNote(text: string): HTMLElement {
  const note = document.createElement("div");
  note.className = "paper-note";
  note.append(renderInlineMarkdown(text));
  return note;
}

function renderFlowBlock(
  block: NewspaperFlowBlock,
  docFilter: NewspaperPrintFilter = "halftone",
  isFirst = false,
): HTMLElement {
  switch (block.kind) {
    case "paragraph":
      return createParagraph(block.text, isFirst);
    case "quote":
      return createQuote(block.text, block.author, block.isBanner);
    case "highlight":
      return createHighlight(block.text, block.label);
    case "crosshead":
      return createCrosshead(block.text);
    case "note":
      return createNote(block.text);
    case "image":
      return createPictureSlot(block.image, docFilter, "newspaper-slot-col");
  }
}

function renderFrontPageHeader(
  doc: LootDocument,
  page: ParsedNewspaperPage,
): HTMLElement | undefined {
  const publisher = doc.title.trim();
  const issue = doc.newspaperIssue?.trim();
  const { headline, deck } = resolveNewspaperHeading(doc, page);
  if (!publisher && !issue && !headline && !deck) return undefined;

  const container = document.createElement("header");
  container.className = `newspaper-front-header newspaper-header-${doc.newspaperHeader ?? "tabloid-splash"}`;
  if (publisher) {
    const name = document.createElement("div");
    name.className = "newspaper-nameplate";
    name.textContent = publisher;
    container.append(name);
  }
  if (issue) {
    const dateline = document.createElement("div");
    dateline.className = "newspaper-edition-line";
    dateline.textContent = issue;
    container.append(dateline);
  }
  if (headline) {
    const h1 = document.createElement("h1");
    h1.className = "newspaper-front-headline";
    h1.textContent = headline;
    container.append(h1);
  }
  if (deck) {
    const sub = document.createElement("div");
    sub.className = "newspaper-front-deck";
    sub.append(renderInlineMarkdown(deck));
    container.append(sub);
  }
  return container;
}

function renderHeader(
  doc: LootDocument,
  page: ParsedNewspaperPage,
  totalPages: number,
): HTMLElement | undefined {
  if (page.pageIndex === 0) {
    return renderFrontPageHeader(doc, page);
  }

  // Inside-page running header
  const titleText = doc.title.trim();
  const issueText = doc.newspaperIssue?.trim();

  const running = document.createElement("header");
  running.className = "newspaper-running-header";

  const title = document.createElement("span");
  title.textContent = titleText;

  const pageNum = document.createElement("span");
  pageNum.className = "newspaper-page-number";
  pageNum.textContent = `— PAGE ${page.pageIndex + 1} OF ${totalPages} —`;

  const issue = document.createElement("span");
  issue.textContent = issueText || "";

  running.append(title, pageNum, issue);
  return running;
}

function renderHeadlineArea(
  page: ParsedNewspaperPage,
): HTMLElement | undefined {
  // Every front-page style renders the same explicit headline/deck fields.
  if (page.pageIndex === 0) {
    return undefined;
  }

  const headlineText = page.headline;
  const subheadText = page.subhead;
  if (!headlineText && !subheadText) return undefined;

  const wrap = document.createElement("div");
  wrap.className = "newspaper-headline-wrap";

  if (headlineText) {
    const h2 = document.createElement("h2");
    h2.className = "newspaper-headline";
    h2.textContent = headlineText;
    wrap.append(h2);
  }

  if (subheadText) {
    const sub = document.createElement("div");
    sub.className = "newspaper-subhead";
    sub.append(renderInlineMarkdown(subheadText));
    wrap.append(sub);
  }

  return wrap;
}

const activeRenderers = new WeakMap<HTMLElement, () => void>();

/** Add unattached pictures between story blocks; inline pictures keep their anchors. */
function storyBlocks(page: ParsedNewspaperPage): NewspaperFlowBlock[] {
  const inlineUrls = new Set(page.blocks.filter((block) => block.kind === "image").map((block) => block.image.url));
  const pictures = page.images.filter((img) => !inlineUrls.has(img.url));
  const blocks: NewspaperFlowBlock[] = [];
  for (let index = 0; index <= page.blocks.length; index++) {
    pictures.forEach((image, imageIndex) => {
      const anchor = Math.min(page.blocks.length, Math.max(1,
        Math.round(page.blocks.length * (imageIndex + 1) / (pictures.length + 1))));
      if (anchor === index) blocks.push({ kind: "image", image });
    });
    if (index < page.blocks.length) blocks.push(page.blocks[index]);
  }
  return blocks;
}

export function renderNewspaperDocument(root: HTMLElement, doc: LootDocument): RenderedDocument {
  activeRenderers.get(root)?.();
  root.replaceChildren();
  const paged = (doc.layout ?? defaultLayout(doc.style)) === "pages";
  const paper = document.createElement("article");
  paper.className = `paper paper-newspaper paper-tex-${doc.texture ?? "aged"} is-spread`;
  const font = DOC_FONT_META[doc.font ?? STYLE_DEFAULT_FONT.newspaper];
  paper.style.setProperty("--doc-font", font.family);
  paper.style.setProperty("--font-adjust", String(font.adjust));
  const container = document.createElement("div");
  container.className = "newspaper-spreads-container";
  paper.append(container);
  root.append(paper);

  let frame = 0;
  let disposed = false;
  let currentSpread = 0;
  let spreads: HTMLElement[] = [];
  let pages: HTMLElement[] = [];
  let observer: ResizeObserver | undefined;
  let lastWidth = 0;
  const nav = document.createElement("div");
  nav.className = "page-nav";
  const prev = document.createElement("button");
  prev.textContent = "‹";
  prev.ariaLabel = "Previous spread";
  const label = document.createElement("span");
  const next = document.createElement("button");
  next.textContent = "›";
  next.ariaLabel = "Next spread";
  nav.append(prev, label, next);
  paper.append(nav);

  function setSpread(target: number): void {
    currentSpread = Math.max(0, Math.min(spreads.length - 1, Math.trunc(target) || 0));
    spreads.forEach((spread, index) => { spread.hidden = paged && index !== currentSpread; });
    nav.hidden = !paged || spreads.length <= 1;
    label.textContent = `SPREAD ${currentSpread + 1} OF ${spreads.length} (PAGES ${currentSpread * 2 + 1}–${Math.min(pages.length, currentSpread * 2 + 2)})`;
    prev.disabled = currentSpread === 0;
    next.disabled = currentSpread >= spreads.length - 1;
  }
  prev.onclick = () => setSpread(currentSpread - 1);
  next.onclick = () => setSpread(currentSpread + 1);

  function dispose(): void {
    disposed = true;
    cancelAnimationFrame(frame);
    observer?.disconnect();
    window.removeEventListener("resize", schedule);
    document.fonts?.removeEventListener("loadingdone", schedule);
  }
  function schedule(): void {
    if (disposed || frame) return;
    frame = requestAnimationFrame(() => { frame = 0; relayout(); });
  }
  activeRenderers.set(root, dispose);

  const sections = parseNewspaperPages(doc);
  const layout = resolveNewspaperLayout(doc.newspaperLayout);
  let leadUsed = false;
  // Keep immutable source DOM (including image load/error handlers), so reflow
  // always starts from complete paragraphs instead of previously split text.
  const sources = sections.map((section, sectionIndex) => storyBlocks(section).map((block, blockIndex) => {
    const isLead = sectionIndex === 0 && block.kind === "paragraph" && !leadUsed;
    if (isLead) leadUsed = true;
    const element = block.kind === "image"
      ? createPictureSlot(block.image, doc.newspaperFilter, "newspaper-slot-col", schedule)
      : renderFlowBlock(block, doc.newspaperFilter, isLead);
    element.dataset.storyBlock = `${sectionIndex}-${blockIndex}`;
    if (block.kind === "image" && section.blocks.includes(block)) element.dataset.inlineImage = "true";
    return element;
  }));

  function relayout(): void {
    if (disposed) return;
    if (!root.contains(paper)) { dispose(); return; }
    if (!paper.isConnected || !root.getClientRects().length) return;
    cancelAnimationFrame(frame);
    frame = 0;
    paper.classList.remove("is-single");
    paper.classList.add("is-spread");
    paper.style.removeProperty("width");
    container.replaceChildren();
    pages = [];
    spreads = [];
    const style = getComputedStyle(paper);
    const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const gutter = parseFloat(style.fontSize) * 3;
    const pageWidth = (paper.clientWidth - padding - gutter) / 2;
    if (pageWidth <= 0) return;
    const pageHeight = Math.max(pageWidth * 1.25, parseFloat(style.fontSize) * 24);
    paper.style.setProperty("--newspaper-page-width", `${pageWidth}px`);
    paper.style.setProperty("--newspaper-page-height", `${pageHeight}px`);

    const addPage = (section: ParsedNewspaperPage, firstInSection: boolean): HTMLElement[] => {
      const pageIndex = pages.length;
      const data = { ...section, pageIndex, headline: firstInSection ? section.headline : undefined,
        subhead: firstInSection ? section.subhead : undefined };
      const page = document.createElement("section");
      page.className = `newspaper-page-slide layout-${layout}`;
      const header = renderHeader(doc, data, 0);
      const headline = renderHeadlineArea(data);
      if (header) page.append(header);
      if (headline) page.append(headline);
      const content = document.createElement("div");
      content.className = "newspaper-content-area";
      const columns: HTMLElement[] = [];
      // Digest pages read left-to-right within each horizontal band, then down.
      // Features have one broad reading measure instead of a second text column.
      for (let band = 0; band < (layout === "gazette-mosaic" ? 2 : 1); band++) {
        const grid = document.createElement("div");
        grid.className = "newspaper-text newspaper-column-grid";
        if (layout === "column-inset") grid.classList.add("newspaper-feature-grid");
        if (layout === "gazette-mosaic") grid.classList.add("newspaper-digest-band");
        for (let index = 0; index < (layout === "column-inset" ? 1 : 2); index++) {
          const column = document.createElement("div");
          column.className = "newspaper-column";
          grid.append(column);
          columns.push(column);
        }
        content.append(grid);
      }
      page.append(content);
      // Measure in the live DOM at exactly the width used in the final spread.
      container.append(page);
      // Long headlines must share the sheet with the report, even when the
      // reader enlarges body text. Fit the whole typographic hierarchy together.
      const headingArea = page.querySelector<HTMLElement>(".newspaper-front-header, .newspaper-headline-wrap");
      if (headingArea) {
        let headingSize = parseFloat(getComputedStyle(headingArea).fontSize);
        while (headingArea.offsetHeight > pageHeight * .5 && headingSize > 8) {
          headingSize = Math.max(8, headingSize - .5);
          headingArea.style.fontSize = `${headingSize}px`;
        }
      }
      pages.push(page);
      return columns;
    };

    sections.forEach((section, index) => {
      const queue = sources[index].map((source) => source.cloneNode(true) as HTMLElement);
      let firstInSection = true;
      while (queue.length) {
        const columns = addPage(section, firstInSection);
        const page = pages[pages.length - 1];
        if (pages.length > 1) queue.forEach((node) => node.classList.remove("has-drop-cap"));
        if (sources[index].some(node => node.dataset.imageWidth === "page")) {
          fillNewspaperWidePage(page.querySelector<HTMLElement>(".newspaper-content-area")!, queue, layout, pageHeight, firstInSection);
          firstInSection = false;
          continue;
        }
        if (page.classList.contains("layout-hero") && firstInSection) {
          // Only unattached photos may become a lead picture. Markdown photos
          // stay at their explicit position in the story.
          const inlineUrls = new Set(section.blocks.filter((block) => block.kind === "image").map((block) => block.image.url));
          const firstPicture = queue.findIndex(element => element.querySelector("img"));
          // A later default picture must never jump ahead of an earlier
          // column-width or inline picture just to fill the hero slot.
          const candidate = queue[firstPicture];
          const heroIndex = candidate && !candidate.dataset.imageWidth &&
            !inlineUrls.has(candidate.querySelector("img")!.getAttribute("src") ?? "") ? firstPicture : -1;
          if (heroIndex >= 0) {
            const hero = queue[heroIndex];
            hero.classList.replace("newspaper-slot-col", "newspaper-slot-hero");
            page.insertBefore(hero, page.querySelector(".newspaper-content-area"));
            const image = hero.querySelector<HTMLImageElement>("img")!;
            const bodyLine = parseFloat(getComputedStyle(columns[0]).lineHeight);
            const reserve = bodyLine * 4;
            const available = image.clientHeight + columns[0].clientHeight - reserve;
            if (available >= bodyLine * 2) {
              image.style.maxHeight = `${Math.min(image.clientHeight, available)}px`;
              queue.splice(heroIndex, 1);
            } else {
              // A tall heading leaves no room for a useful lead photo. Keep
              // that photo in the article flow, at its original story position.
              hero.remove();
              hero.classList.replace("newspaper-slot-hero", "newspaper-slot-col");
            }
          }
          // A wide introduction gives Front Page a distinct opening even with
          // no photo. Measure and split it just like any other reading region.
          if (queue[0]?.tagName === "P") {
            const intro = document.createElement("div");
            intro.className = "newspaper-text newspaper-lead-band";
            const introColumn = document.createElement("div");
            introColumn.className = "newspaper-column";
            const available = columns[0].clientHeight;
            introColumn.style.height = `${Math.min(available * .25, pageHeight * .14)}px`;
            intro.append(introColumn);
            page.insertBefore(intro, page.querySelector(".newspaper-content-area"));
            const introLine = parseFloat(getComputedStyle(introColumn).lineHeight);
            introColumn.style.height = `${Math.max(introColumn.clientHeight, introLine * 2.5)}px`;
            const bodyLine = parseFloat(getComputedStyle(columns[0]).lineHeight);
            if (columns[0].clientHeight < bodyLine * 3) {
              // At large reading sizes on small pages, prioritize the report.
              // The lead photo still gives this opening its front-page shape.
              intro.remove();
            } else {
              const leadQueue = [queue.shift()!];
              fillNewspaperColumn(introColumn, leadQueue);
              queue.unshift(...leadQueue);
              if (!leadQueue.length && introColumn.lastElementChild) {
                introColumn.style.height = `${introColumn.lastElementChild.getBoundingClientRect().bottom - introColumn.getBoundingClientRect().top}px`;
              }
            }
          }
        }
        for (const column of columns) {
          // The image cap includes its actual caption/frame in the measured
          // block. This variable also limits portrait photographs on short pages.
          column.style.setProperty("--newspaper-image-height", `${Math.max(32, column.clientHeight * 0.42)}px`);
          fillNewspaperColumn(column, queue);
        }
        firstInSection = false;
      }
    });

    pages.forEach((page, index) => {
      const pageNumber = page.querySelector(".newspaper-page-number");
      if (pageNumber) pageNumber.textContent = `— PAGE ${index + 1} OF ${pages.length} —`;
    });
    container.replaceChildren();
    for (let index = 0; index < pages.length; index += 2) {
      const spread = document.createElement("div");
      spread.className = "newspaper-spread";
      spread.append(pages[index]);
      if (pages[index + 1]) spread.append(pages[index + 1]);
      spreads.push(spread);
      container.append(spread);
    }
    if (pages.length === 1) {
      paper.classList.replace("is-spread", "is-single");
      paper.style.width = `${pageWidth + padding}px`;
    }
    setSpread(currentSpread);
    paper.dataset.pageCount = String(pages.length);
    paper.dataset.layoutVersion = String(Number(paper.dataset.layoutVersion ?? 0) + 1);
    lastWidth = root.clientWidth;
  }

  if (doc.texture && doc.texture !== "aged") {
    const overlay = document.createElement("div");
    overlay.className = "paper-texture";
    paper.append(overlay);
  }
  observer = new ResizeObserver(() => {
    if (!root.contains(paper)) { dispose(); return; }
    if (root.clientWidth !== lastWidth || !pages.length) schedule();
  });
  observer.observe(root);
  window.addEventListener("resize", schedule);
  document.fonts?.addEventListener("loadingdone", schedule);
  void document.fonts?.ready.then(schedule);
  relayout();
  schedule(); // Editors can attach the preview after this function returns.
  return { paged, relayout, next: () => setSpread(currentSpread + 1),
    prev: () => setSpread(currentSpread - 1), goTo: setSpread, getPage: () => currentSpread };
}
