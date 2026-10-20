/** Browser-measured, left-to-right typesetting. No word-count capacity guesses. */
const FIT_EPSILON = 0.5;

function fits(node: HTMLElement, column: HTMLElement): boolean {
  return node.getBoundingClientRect().bottom <= column.getBoundingClientRect().bottom + FIT_EPSILON;
}

/**
 * Height of a picture slot's printed image: for side-by-side pictures, the
 * tallest picture of every row added up (captions excluded either way).
 */
export function pictureHeight(slot: HTMLElement): number {
  if (!slot.classList.contains("newspaper-gallery")) {
    return slot.querySelector("img")?.getBoundingClientRect().height ?? 0;
  }
  return Array.from(slot.querySelectorAll(".newspaper-gallery-row"), (row) =>
    Math.max(0, ...Array.from(row.querySelectorAll("img"), (img) => img.getBoundingClientRect().height)),
  ).reduce((sum, height) => sum + height, 0);
}

/**
 * The element whose --img-cap limits pictureHeight(): the picture itself, or
 * a whole side-by-side grid (whose rows share the cap).
 */
export function pictureCapTarget(slot: HTMLElement): HTMLElement | null {
  return slot.classList.contains("newspaper-gallery") ? slot : slot.querySelector("img");
}

/** Split the rendered DOM, preserving nested emphasis, links, punctuation and whitespace. */
function splitAt(source: HTMLElement, offset: number): [HTMLElement, HTMLElement] {
  const walker = document.createTreeWalker(source, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode()!;
  while (node && offset > (node.textContent?.length ?? 0)) {
    offset -= node.textContent?.length ?? 0;
    node = walker.nextNode()!;
  }
  const before = document.createRange();
  before.setStart(source, 0);
  before.setEnd(node, offset);
  const after = document.createRange();
  after.setStart(node, offset);
  after.setEnd(source, source.childNodes.length);
  const head = source.cloneNode(false) as HTMLElement;
  const tail = source.cloneNode(false) as HTMLElement;
  head.append(before.cloneContents());
  tail.append(after.cloneContents());
  head.classList.add("is-split-start");
  tail.classList.remove("has-drop-cap");
  tail.classList.add("is-continuation");
  return [head, tail];
}

/** Leave the largest fitting prefix in the column and return its continuation. */
function splitToFit(node: HTMLElement, column: HTMLElement): HTMLElement | undefined {
  const text = node.textContent ?? "";
  const boundaries = Array.from(text.matchAll(/\S+\s+/g), (match) => match.index! + match[0].length)
    .filter((offset) => offset < text.length);
  node.remove();

  function largestFit(offsets: number[]): number {
    let low = 0;
    let high = offsets.length - 1;
    let cut = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const [candidate] = splitAt(node, offsets[mid]);
      column.append(candidate);
      const doesFit = fits(candidate, column);
      candidate.remove();
      if (doesFit) { cut = offsets[mid]; low = mid + 1; }
      else high = mid - 1;
    }
    return cut;
  }

  let cut = largestFit(boundaries);
  const tokenStart = Math.max(0, cut);
  const token = /^\S+/.exec(text.slice(tokenStart))?.[0] ?? "";
  const probe = node.cloneNode(false) as HTMLElement;
  probe.classList.remove("has-drop-cap");
  probe.textContent = token;
  column.append(probe);
  const oversizedToken = probe.getBoundingClientRect().height > column.clientHeight;
  probe.remove();
  if (!boundaries.length || oversizedToken) {
    // A token taller than a column must split within the word, including when
    // normal words precede it. Keep Unicode surrogate pairs together.
    const characters: number[] = [];
    let offset = tokenStart;
    for (const character of token) {
      offset += character.length;
      if (offset < tokenStart + token.length) characters.push(offset);
    }
    cut = Math.max(cut, largestFit(characters));
  }
  if (cut < 0) return undefined;
  const [head, tail] = splitAt(node, cut);
  column.append(head);
  return tail;
}

/**
 * Consume a shared story queue. The caller creates another page only after all
 * its columns are full. Unattached pictures may float past following prose to
 * fill space; inline pictures retain their explicit narrative anchors.
 */
export function fillNewspaperColumn(column: HTMLElement, queue: HTMLElement[]): void {
  while (queue.length) {
    const node = queue[0];
    if (node.dataset.columnBreak) {
      // `\column`: end this column here. At the top of an empty column (the
      // text already overflowed into it) it would only leave a blank column.
      queue.shift();
      if (!column.children.length) continue;
      column.dataset.breakReason = "column";
      return;
    }
    column.append(node);
    const isPicture = node.classList.contains("newspaper-slot");
    const isCrosshead = node.classList.contains("newspaper-crosshead");
    const lineHeight = parseFloat(getComputedStyle(column).lineHeight);
    const room = column.getBoundingClientRect().bottom - node.getBoundingClientRect().bottom;
    if (fits(node, column) && (!isCrosshead || queue.length === 1 || room >= lineHeight * 2)) {
      queue.shift();
      continue;
    }

    if (isPicture) {
      // Prefer a smaller proportional illustration over an early column break.
      // Include its frame and caption; do not shrink it into an unreadable sliver.
      const image = pictureCapTarget(node);
      if (image) {
        const height = pictureHeight(node);
        const available = height + room;
        if (available >= Math.max(lineHeight * 3, height * .45) && available < height) {
          const previous = image.style.getPropertyValue("--img-cap");
          image.style.setProperty("--img-cap", `${Math.floor(available)}px`);
          if (fits(node, column)) {
            queue.shift();
            continue;
          }
          image.style.setProperty("--img-cap", previous);
        }
      }
    }

    // Framed documents (`:::` inserts) run on into the next column like
    // prose; the frame is drawn on both parts.
    const isInsert = node.classList.contains("md-insert");
    if (!isPicture && !isCrosshead && (node.tagName === "P" || isInsert || column.children.length === 1)) {
      const tail = splitToFit(node, column);
      if (tail) {
        queue[0] = tail;
        column.dataset.breakReason = "text";
        return;
      }
    }
    node.remove();

    // A photo should not strand usable lines at the bottom of a column.
    if (isPicture && !node.dataset.inlineImage && queue[1]?.tagName === "P") {
      const paragraph = queue[1];
      column.append(paragraph);
      if (fits(paragraph, column)) {
        queue.splice(1, 1);
        continue;
      }
      const tail = splitToFit(paragraph, column);
      if (tail) {
        queue[1] = tail;
        column.dataset.breakReason = "text";
        return;
      }
      paragraph.remove();
    }

    if (!column.children.length) {
      // Oversized unbreakable content must remain accessible, never disappear
      // or cause an endless sequence of empty pages. Normal images are capped
      // to the measured column height by CSS before reaching this fallback.
      column.append(node);
      column.style.height = `${node.getBoundingClientRect().height}px`;
      queue.shift();
    }
    column.dataset.breakReason = isPicture ? "image" : isCrosshead ? "crosshead" : "block";
    return;
  }
  column.dataset.breakReason = "end";
}
