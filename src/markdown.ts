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
    /`([^`]+)`|!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]+)\]\(([^)]+)\)|\*\*\*([^*]+)\*\*\*|___([^_]+)___|\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|==([^=\n]+)==|\*([^*\n]+)\*|_([^_\n]+)_|\{@([a-zA-Z]+)\s+([^}]+)\}/g;

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
    // 2 & 3: Image ![alt](url)
    else if (match[3] !== undefined) {
      const alt = match[2] || "";
      const url = match[3] || "";
      if (isSafeUrl(url)) {
        const img = document.createElement("img");
        img.className = "md-inline-img";
        img.referrerPolicy = "no-referrer";
        if (typeof img.setAttribute === "function") {
          img.setAttribute("referrerpolicy", "no-referrer");
        }
        img.src = normalizeImageUrl(url.trim());
        img.alt = alt;
        img.loading = "lazy";
        frag.append(img);
      } else {
        frag.append(document.createTextNode(`[Image: ${alt}]`));
      }
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

    // 2. Headings: #, ##, ###, ####, #####, ######
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

    // 8. Editorial note (*wrapped entirely in asterisks*)
    const noteMatch = NOTE_REGEX.exec(trimmed);
    if (noteMatch) {
      const noteP = document.createElement("p");
      noteP.className = "paper-note";
      noteP.append(renderInlineMarkdown(noteMatch[1].trim()));
      target.append(noteP);
      i++;
      continue;
    }

    // 9. Paragraph
    const paragraphLines: string[] = [];
    while (
      i < rawLines.length &&
      rawLines[i].trim().length > 0 &&
      !rawLines[i].trim().startsWith("```") &&
      !/^(#{1,6})\s+/.test(rawLines[i].trim()) &&
      !HR_REGEX.test(rawLines[i].trim()) &&
      !rawLines[i].trim().startsWith(">") &&
      !/^[-*+]\s+/.test(rawLines[i].trim()) &&
      !/^\d+\.\s+/.test(rawLines[i].trim()) &&
      !rawLines[i].trim().startsWith("|")
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
