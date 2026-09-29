/**
 * Safe, dependency-free Markdown parser and DOM renderer.
 * Converts markdown text directly to sanitized DOM nodes without innerHTML risks.
 */

export interface MarkdownOptions {
  /** If true, add class has-drop-cap to the first paragraph */
  dropCapFirstParagraph?: boolean;
  /** Custom base CSS class for paragraphs */
  paragraphClass?: string;
}

/**
 * Validates that a link or image URL uses a safe protocol.
 * Rejects javascript:, data:, vbscript:, etc.
 */
export function isSafeUrl(url: string): boolean {
  try {
    const trimmed = url.trim().toLowerCase();
    if (
      trimmed.startsWith("javascript:") ||
      trimmed.startsWith("vbscript:") ||
      (trimmed.startsWith("data:") && !trimmed.startsWith("data:image/"))
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalizes common image hosting page URLs (Imgur, Google Drive, Dropbox)
 * into direct raw image URLs so that <img> elements can load them directly.
 */
/**
 * Detects whether an Imgur link points to an album/gallery webpage rather than a single image.
 * Imgur albums (e.g. imgur.com/a/slug-id) cannot be embedded directly via i.imgur.com/<album-id>
 * because the album hash is distinct from the image hashes inside it.
 */
export function isImgurAlbumUrl(raw: string): boolean {
  if (!raw || typeof raw !== "string") return false;
  return /^(?:https?:)?\/\/(?:[a-z0-9.-]+\.)?imgur\.com\/(?:a\/|gallery\/)/i.test(raw.trim());
}

/**
 * Normalizes common image hosting page URLs (Imgur, Google Drive, Dropbox)
 * into direct raw image URLs so that <img> elements can load them directly.
 */
export function normalizeImageUrl(raw: string): string {
  if (!raw || typeof raw !== "string") return "";
  let url = raw.trim();

  // 1. Imgur page/gallery/album links -> direct raw image URL
  // Handles:
  //   https://imgur.com/Bnew4HG -> https://i.imgur.com/Bnew4HG.png
  //   https://m.imgur.com/Bnew4HG -> https://i.imgur.com/Bnew4HG.png
  //   https://imgur.com/slug-Bnew4HG -> https://i.imgur.com/Bnew4HG.png
  //   https://imgur.com/a/Bnew4HG -> https://i.imgur.com/Bnew4HG.png
  //   https://imgur.com/gallery/Bnew4HG -> https://i.imgur.com/Bnew4HG.png
  //   https://i.imgur.com/Bnew4HG (without ext) -> https://i.imgur.com/Bnew4HG.png
  const imgurMatch = /^(?:https?:)?\/\/(?:[a-z0-9.-]+\.)?imgur\.com\/(?:(?:a\/|gallery\/|r\/[^/]+\/)?(?:[a-zA-Z0-9_-]+-)?([a-zA-Z0-9]+))(\.[a-zA-Z]{3,4})?(?:\?.*)?$/i.exec(url);
  if (imgurMatch) {
    const id = imgurMatch[1];
    const ext = imgurMatch[2] || ".png";
    return `https://i.imgur.com/${id}${ext}`;
  }

  // 2. Google Drive share links -> direct image stream
  const gdriveMatch = /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/i.exec(url);
  if (gdriveMatch) {
    return `https://lh3.googleusercontent.com/d/${gdriveMatch[1]}`;
  }
  const gdriveIdMatch = /drive\.google\.com\/(?:open|uc)\?(?:.*&)?id=([a-zA-Z0-9_-]+)/i.exec(url);
  if (gdriveIdMatch) {
    return `https://lh3.googleusercontent.com/d/${gdriveIdMatch[1]}`;
  }

  // 3. Dropbox share links -> direct download link (raw=1)
  if (/dropbox\.com\//i.test(url)) {
    if (url.includes("dl=0")) return url.replace("dl=0", "raw=1");
    if (!url.includes("raw=1") && !url.includes("dl=1")) {
      return url.includes("?") ? `${url}&raw=1` : `${url}?raw=1`;
    }
  }

  return url;
}

/**
 * Renders inline markdown tokens (bold, italic, strike, code, links, images, tags)
 * into a DocumentFragment.
 */
export function renderInlineMarkdown(text: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  if (!text) return frag;

  // 1: code `...`
  // 2: image alt, 3: image url
  // 4: link text, 5: link url
  // 6, 7: bold-italic ***...*** or ___...___
  // 8, 9: bold **...** or __...__
  // 10: strike ~~...~~
  // 11: highlight ==...==
  // 12, 13: italic *...* or _..._
  // 14: tag type, 15: tag value {@tag value}
  const tokenRegex =
    /`([^`]+)`|!\[([^\]]*)\]\(((?:[^()]|\([^()]*\))+)\)|\[([^\]]+)\]\(([^)]+)\)|\*\*\*([^*]+)\*\*\*|___([^_]+)___|\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|==([^=\n]+)==|\*([^*\n]+)\*|_([^_\n]+)_|\{@([a-zA-Z]+)\s+([^}]+)\}/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(text)) !== null) {
    const matchStart = match.index;
    if (matchStart > lastIndex) {
      frag.append(document.createTextNode(text.slice(lastIndex, matchStart)));
    }
    lastIndex = tokenRegex.lastIndex;

    // 1: Code `...`
    if (match[1] !== undefined) {
      const code = document.createElement("code");
      code.className = "md-inline-code";
      code.textContent = match[1];
      frag.append(code);
    }
    // 2 & 3: Image ![caption|options](url)
    else if (match[3] !== undefined) {
      frag.append(createFigure(match[2] || "", match[3] || "", "inline"));
    }
    // 4 & 5: Link [text](url)
    else if (match[5] !== undefined) {
      const linkText = match[4] || "";
      const url = match[5] || "";
      if (isSafeUrl(url)) {
        const a = document.createElement("a");
        a.className = "md-link";
        a.href = url.trim();
        a.target = "_blank";
        a.rel = "noreferrer noopener";
        a.append(renderInlineMarkdown(linkText));
        a.onclick = (e) => e.stopPropagation();
        frag.append(a);
      } else {
        frag.append(renderInlineMarkdown(linkText));
      }
    }
    // 6 or 7: Bold-Italic ***...*** or ___...___
    else if (match[6] !== undefined || match[7] !== undefined) {
      const content = match[6] ?? match[7] ?? "";
      const strong = document.createElement("strong");
      const em = document.createElement("em");
      em.append(renderInlineMarkdown(content));
      strong.append(em);
      frag.append(strong);
    }
    // 8 or 9: Bold **...** or __...__
    else if (match[8] !== undefined || match[9] !== undefined) {
      const content = match[8] ?? match[9] ?? "";
      const strong = document.createElement("strong");
      strong.append(renderInlineMarkdown(content));
      frag.append(strong);
    }
    // 10: Strikethrough ~~...~~
    else if (match[10] !== undefined) {
      const del = document.createElement("del");
      del.append(renderInlineMarkdown(match[10]));
      frag.append(del);
    }
    // 11: Highlight ==...==
    else if (match[11] !== undefined) {
      const mark = document.createElement("mark");
      mark.className = "md-highlight";
      mark.append(renderInlineMarkdown(match[11]));
      frag.append(mark);
    }
    // 12 or 13: Italic *...* or _..._
    else if (match[12] !== undefined || match[13] !== undefined) {
      const content = match[12] ?? match[13] ?? "";
      const em = document.createElement("em");
      em.append(renderInlineMarkdown(content));
      frag.append(em);
    }
    // 14 & 15: D&D tag {@type value}
    else if (match[14] !== undefined) {
      const tagType = match[14];
      const tagValue = match[15];
      const span = document.createElement("span");
      span.className = `md-tag md-tag-${tagType.toLowerCase()}`;
      span.textContent = tagValue;
      span.title = tagType;
      frag.append(span);
    }
  }

  if (lastIndex < text.length) {
    frag.append(document.createTextNode(text.slice(lastIndex)));
  }

  return frag;
}

export type FigurePlacement = "left" | "right" | "center";
export type FigureSize = "small" | "medium" | "large" | "full";
export type FigureLook = "ink" | "photo" | "plain";

export interface FigureSpec {
  caption: string;
  placement: FigurePlacement;
  size: FigureSize;
  look: FigureLook;
  /**
   * `|60%`: exact width as a share of the text width, like LaTeX's
   * `width=0.6\textwidth`. Overrides `size`, and may enlarge a picture
   * past the size keywords' height caps.
   */
  widthPercent?: number;
  /** `|fit`: scale down, keeping proportions, until it fits one page. */
  fit: boolean;
  /**
   * `|page`: the picture is a page of its own and fills all of it (cropping
   * the edges if the proportions differ; with `|fit` it shows whole instead).
   */
  page: boolean;
}

const PLACEMENTS: readonly string[] = ["left", "right", "center"];
const SIZES: readonly string[] = ["small", "medium", "large", "full"];
const LOOK_ALIASES: Record<string, FigureLook> = {
  ink: "ink",
  sepia: "ink",
  engraving: "ink",
  sketch: "ink",
  photo: "photo",
  polaroid: "photo",
  plain: "plain",
  raw: "plain",
};

/**
 * Parses the `caption|option|option` part of `![...](url)`. Options come in
 * any order: placement (left/right/center), size (small/medium/large/full)
 * and look (ink/photo/plain). Unknown words stay part of the caption.
 *
 * A standalone picture (alone on its line) defaults to a large centered
 * plate; one written inside a sentence defaults to a small picture floated
 * left so the text wraps around it.
 */
export function parseFigureSpec(alt: string, standalone: boolean): FigureSpec {
  const spec: FigureSpec = {
    caption: "",
    placement: standalone ? "center" : "left",
    size: standalone ? "large" : "small",
    look: "ink",
    fit: false,
    page: false,
  };
  const [first, ...options] = alt.split("|");
  const captionParts = [first];
  let sizeSet = false;
  for (const option of options) {
    const word = option.trim().toLowerCase();
    if (PLACEMENTS.includes(word)) {
      spec.placement = word as FigurePlacement;
    } else if (SIZES.includes(word)) {
      spec.size = word as FigureSize;
      sizeSet = true;
    } else if (word in LOOK_ALIASES) {
      spec.look = LOOK_ALIASES[word];
    } else if (word === "fit") {
      spec.fit = true;
    } else if (word === "page") {
      spec.page = true;
    } else if (/^\d{1,3}(?:\.\d+)?\s*%$/.test(word)) {
      spec.widthPercent = Math.min(100, Math.max(5, parseFloat(word)));
      sizeSet = true;
    } else if (word) {
      captionParts.push(option);
    }
  }
  // A centered picture inside a sentence reads best a bit bigger than a
  // margin sketch; a floated one can never take the full width.
  if (!sizeSet && !standalone && spec.placement === "center") spec.size = "medium";
  if (spec.placement !== "center" && spec.size === "full") spec.size = "large";
  // A full-page picture is never floated or narrowed.
  if (spec.page) {
    spec.placement = "center";
    spec.size = "full";
    spec.widthPercent = undefined;
  }
  spec.caption = captionParts.join("|").trim();
  return spec;
}

/**
 * Builds a picture that sits in the text exactly where it was written.
 * Inline figures are spans (valid inside a paragraph); standalone ones are
 * real <figure> blocks. Never uses innerHTML.
 */
export function createFigure(
  alt: string,
  rawUrl: string,
  mode: "inline" | "block",
): HTMLElement {
  const spec = parseFigureSpec(alt, mode === "block");
  const url = rawUrl.trim();
  const wrap = document.createElement(mode === "block" ? "figure" : "span");
  wrap.className = `md-figure md-figure-${spec.placement} md-figure-${spec.size} md-look-${spec.look}`;
  if (spec.widthPercent !== undefined) {
    wrap.classList.add("md-figure-custom");
    wrap.style.width = `${spec.widthPercent}%`;
  }
  if (spec.fit) wrap.classList.add("md-figure-fit");
  if (spec.page) wrap.classList.add("md-figure-page");

  const frame = document.createElement("span");
  frame.className = "md-figure-frame";
  if (isSafeUrl(url)) {
    const img = document.createElement("img");
    img.className = "md-inline-img";
    img.referrerPolicy = "no-referrer";
    if (typeof img.setAttribute === "function") {
      img.setAttribute("referrerpolicy", "no-referrer");
    }
    img.src = normalizeImageUrl(url);
    img.alt = spec.caption;
    // Lets CSS shrink the frame to the picture's proportions when a height
    // cap applies, instead of letterboxing it inside a full-width frame.
    img.onload = () => {
      if (img.naturalWidth && img.naturalHeight) {
        wrap.style.setProperty("--ratio", (img.naturalWidth / img.naturalHeight).toFixed(4));
      }
    };
    img.onerror = () => {
      wrap.classList.add("md-figure-broken");
      frame.textContent = isImgurAlbumUrl(url)
        ? "Picture unavailable: Imgur album links can't be embedded. Use the image's own link."
        : "Picture unavailable";
    };
    frame.append(img);
  } else {
    wrap.classList.add("md-figure-broken");
    frame.textContent = "Picture unavailable";
  }
  wrap.append(frame);

  if (spec.caption) {
    const caption = document.createElement(mode === "block" ? "figcaption" : "span");
    caption.className = "md-figure-caption";
    caption.append(renderInlineMarkdown(spec.caption));
    // A full-page picture carries its caption inside the frame so it can
    // sit over the picture instead of spilling onto the next page.
    (spec.page ? frame : wrap).append(caption);
  }
  return wrap;
}

/**
 * A line holding nothing but one `![...](url)` picture. URLs may contain one
 * level of balanced parentheses (Wikipedia links, `url(#id)` in SVG data).
 */
const STANDALONE_IMAGE = /^!\[([^\]]*)\]\(((?:[^()]|\([^()]*\))+)\)$/;

export type InsertLook = "print" | "typed" | "official" | "note";
const INSERT_LOOKS: readonly string[] = ["print", "typed", "official", "note"];

/** `:::` alone closes an insert; `::: Title|look` (or bare `:::`) opens one. */
export const INSERT_FENCE = /^:::(?!:)\s*(.*)$/;

/**
 * Splits a document on page-break lines, except inside `:::` inserts: a
 * `---` there is a divider line of the inserted document, not a new page.
 * With `keepBreak` the break line starts the next segment instead of being
 * dropped (newspapers start a new story at each `# Headline`).
 */
export function splitOutsideInserts(
  text: string,
  isBreak: (line: string) => boolean,
  keepBreak = false,
): string[] {
  const segments: string[] = [];
  let current: string[] = [];
  let inInsert = false;
  for (const line of text.split("\n")) {
    const fence = INSERT_FENCE.exec(line.trim());
    // Inside an insert only a bare `:::` closes it.
    if (fence) inInsert = inInsert ? fence[1].trim() !== "" : true;
    if (!inInsert && !fence && isBreak(line)) {
      segments.push(current.join("\n"));
      current = keepBreak ? [line] : [];
    } else current.push(line);
  }
  segments.push(current.join("\n"));
  return segments;
}

/**
 * A framed document shown inside the page (a printed notice, a typed
 * report, an official decree, a slip of paper): its own sheet, typeface and
 * margins, set apart from the surrounding handwriting. Unlike a quote it
 * holds whole blocks: paragraphs, lists, headings, pictures.
 */
export function createInsert(header: string, body: string): HTMLElement {
  const parts = header.split("|");
  let look: InsertLook = "print";
  while (parts.length > 1 && INSERT_LOOKS.includes(parts[parts.length - 1].trim().toLowerCase())) {
    look = parts.pop()!.trim().toLowerCase() as InsertLook;
  }
  // `::: typed` alone sets the look with no title; a capitalised `::: Note`
  // stays a title.
  if (parts.length === 1 && INSERT_LOOKS.includes(parts[0].trim())) {
    look = parts.pop()!.trim() as InsertLook;
  }
  const title = parts.join("|").trim();
  const insert = document.createElement("section");
  insert.className = `md-insert md-insert-${look}`;
  if (title) {
    const heading = document.createElement("header");
    heading.className = "md-insert-title";
    heading.append(renderInlineMarkdown(title));
    insert.append(heading);
  }
  renderMarkdownInto(insert, body);
  return insert;
}

function parseMarkdownTable(lines: string[]): HTMLElement | null {
  if (lines.length < 2) return null;

  const headerLine = lines[0];
  const delimLine = lines[1];

  if (!delimLine.includes("-")) return null;

  const splitRow = (line: string): string[] => {
    let trimmed = line.trim();
    if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
    if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
    return trimmed.split("|").map((c) => c.trim());
  };

  const headers = splitRow(headerLine);
  const delims = splitRow(delimLine);

  if (headers.length === 0 || delims.length !== headers.length) return null;

  const alignments: ("left" | "center" | "right")[] = delims.map((d) => {
    const start = d.startsWith(":");
    const end = d.endsWith(":");
    if (start && end) return "center";
    if (end) return "right";
    return "left";
  });

  const table = document.createElement("table");
  table.className = "md-table";

  const thead = document.createElement("thead");
  const headerTr = document.createElement("tr");
  headers.forEach((h, i) => {
    const th = document.createElement("th");
    th.style.textAlign = alignments[i] || "left";
    th.append(renderInlineMarkdown(h));
    headerTr.append(th);
  });
  thead.append(headerTr);
  table.append(thead);

  const tbody = document.createElement("tbody");
  for (let r = 2; r < lines.length; r++) {
    const rowCells = splitRow(lines[r]);
    const tr = document.createElement("tr");
    headers.forEach((_, i) => {
      const td = document.createElement("td");
      td.style.textAlign = alignments[i] || "left";
      const cellText = rowCells[i] ?? "";
      td.append(renderInlineMarkdown(cellText));
      tr.append(td);
    });
    tbody.append(tr);
  }
  table.append(tbody);

  return table;
}

/**
 * Parses markdown text and appends rendered DOM blocks directly into the target container.
 */
export function renderMarkdownInto(
  target: HTMLElement,
  markdown: string,
  options: MarkdownOptions = {},
): void {
  const normalized = markdown.replace(/\r\n?/g, "\n");
  const rawLines = normalized.split("\n");

  let i = 0;
  let firstParagraphRendered = false;

  const HR_REGEX = /^[^\S\n]*(?:[-–—―_*][^\S\n]*){3,}$/;
  const NOTE_REGEX = /^\*([^*][\s\S]*)\*$/;

  while (i < rawLines.length) {
    const line = rawLines[i];
    const trimmed = line.trim();

    // Blank line
    if (!trimmed) {
      i++;
      continue;
    }

    // 1. Fenced Code Block: ```lang
    if (trimmed.startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < rawLines.length && !rawLines[i].trim().startsWith("```")) {
        codeLines.push(rawLines[i]);
        i++;
      }
      i++; // skip closing ```
      const pre = document.createElement("pre");
      pre.className = "md-code-block";
      const code = document.createElement("code");
      code.textContent = codeLines.join("\n");
      pre.append(code);
      target.append(pre);
      continue;
    }

    // 2. Framed document insert: ::: Title|look … :::
    const insertMatch = INSERT_FENCE.exec(trimmed);
    if (insertMatch) {
      const bodyLines: string[] = [];
      i++;
      while (i < rawLines.length && rawLines[i].trim() !== ":::") {
        bodyLines.push(rawLines[i]);
        i++;
      }
      i++; // skip closing ::: (an unclosed insert runs to the end)
      target.append(createInsert(insertMatch[1], bodyLines.join("\n")));
      continue;
    }

    // 2b. Headings: #, ##, ###, ####, #####, ######
    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();
      const h = document.createElement(`h${Math.min(6, level + 1)}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6");
      h.className = `md-heading md-h${level}`;
      h.append(renderInlineMarkdown(text));
      target.append(h);
      i++;
      continue;
    }

    // 3. Horizontal Rule: ---, ***, ___
    if (HR_REGEX.test(trimmed)) {
      const hr = document.createElement("hr");
      hr.className = "md-hr text-divider";
      target.append(hr);
      i++;
      continue;
    }

    // 4. Blockquotes: > line
    if (trimmed.startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < rawLines.length && rawLines[i].trim().startsWith(">")) {
        quoteLines.push(rawLines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      const bq = document.createElement("blockquote");
      bq.className = "md-quote";
      quoteLines.forEach((qLine, qIdx) => {
        if (qIdx > 0) bq.append(document.createElement("br"));
        bq.append(renderInlineMarkdown(qLine));
      });
      target.append(bq);
      continue;
    }

    // 5. Tables: | Header | Header |
    if (trimmed.startsWith("|") && i + 1 < rawLines.length && rawLines[i + 1].trim().startsWith("|")) {
      const tableLines: string[] = [];
      while (i < rawLines.length && rawLines[i].trim().startsWith("|")) {
        tableLines.push(rawLines[i]);
        i++;
      }
      const tableEl = parseMarkdownTable(tableLines);
      if (tableEl) {
        target.append(tableEl);
        continue;
      }
      // If table parsing failed, roll back i and proceed as paragraph
      i -= tableLines.length;
    }

    // 6. Unordered List: - item, * item, + item
    if (/^[-*+]\s+/.test(trimmed)) {
      const ul = document.createElement("ul");
      ul.className = "md-list md-ul";
      while (i < rawLines.length && /^[-*+]\s+/.test(rawLines[i].trim())) {
        const itemText = rawLines[i].trim().replace(/^[-*+]\s+/, "");
        const li = document.createElement("li");

        // Check for task checkbox: [ ] or [x]
        const taskMatch = /^\[([ xX])\]\s+(.*)$/.exec(itemText);
        if (taskMatch) {
          li.className = "md-task-item";
          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.disabled = true;
          checkbox.checked = taskMatch[1].toLowerCase() === "x";
          checkbox.className = "md-task-checkbox";
          li.append(checkbox, renderInlineMarkdown(taskMatch[2]));
        } else {
          li.append(renderInlineMarkdown(itemText));
        }
        ul.append(li);
        i++;
      }
      target.append(ul);
      continue;
    }

    // 7. Ordered List: 1. item
    if (/^\d+\.\s+/.test(trimmed)) {
      const ol = document.createElement("ol");
      ol.className = "md-list md-ol";
      while (i < rawLines.length && /^\d+\.\s+/.test(rawLines[i].trim())) {
        const itemText = rawLines[i].trim().replace(/^\d+\.\s+/, "");
        const li = document.createElement("li");
        li.append(renderInlineMarkdown(itemText));
        ol.append(li);
        i++;
      }
      target.append(ol);
      continue;
    }

    // 8. Standalone picture: a line holding only ![caption|options](url)
    const imageMatch = STANDALONE_IMAGE.exec(trimmed);
    if (imageMatch) {
      target.append(createFigure(imageMatch[1], imageMatch[2], "block"));
      i++;
      continue;
    }

    // 9. Editorial note (*wrapped entirely in asterisks*)
    const noteMatch = NOTE_REGEX.exec(trimmed);
    if (noteMatch) {
      const noteP = document.createElement("p");
      noteP.className = "paper-note";
      noteP.append(renderInlineMarkdown(noteMatch[1].trim()));
      target.append(noteP);
      i++;
      continue;
    }

    // 10. Paragraph
    const paragraphLines: string[] = [];
    while (
      i < rawLines.length &&
      rawLines[i].trim().length > 0 &&
      !rawLines[i].trim().startsWith("```") &&
      !INSERT_FENCE.test(rawLines[i].trim()) &&
      !/^(#{1,6})\s+/.test(rawLines[i].trim()) &&
      !HR_REGEX.test(rawLines[i].trim()) &&
      !rawLines[i].trim().startsWith(">") &&
      !/^[-*+]\s+/.test(rawLines[i].trim()) &&
      !/^\d+\.\s+/.test(rawLines[i].trim()) &&
      !rawLines[i].trim().startsWith("|") &&
      !STANDALONE_IMAGE.test(rawLines[i].trim())
    ) {
      paragraphLines.push(rawLines[i]);
      i++;
    }

    if (paragraphLines.length > 0) {
      const p = document.createElement("p");
      if (options.paragraphClass) {
        p.className = options.paragraphClass;
      }
      if (options.dropCapFirstParagraph && !firstParagraphRendered) {
        p.classList.add("has-drop-cap");
        firstParagraphRendered = true;
      }
      paragraphLines.forEach((pLine, pIdx) => {
        if (pIdx > 0) p.append(document.createElement("br"));
        p.append(renderInlineMarkdown(pLine));
      });
      target.append(p);
    }
  }
}

/**
 * Returns a wrapper element containing the rendered markdown.
 */
export function renderMarkdown(
  markdown: string,
  options: MarkdownOptions = {},
): HTMLElement {
  const container = document.createElement("div");
  container.className = "md-container";
  renderMarkdownInto(container, markdown, options);
  return container;
}
