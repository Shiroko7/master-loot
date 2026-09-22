import { fillNewspaperColumn } from "./newspaperPagination";
import type { NewspaperLayout } from "./types";

/** Full-width pictures divide a page into measured reading regions. */
export function fillNewspaperWidePage(
  content: HTMLElement, queue: HTMLElement[], layout: NewspaperLayout, pageHeight: number, firstInSection: boolean,
): void {
  content.replaceChildren();
  content.classList.add("has-wide-pictures");
  const contentStyle = getComputedStyle(content);
  let remaining = content.clientHeight - parseFloat(contentStyle.paddingTop) - parseFloat(contentStyle.paddingBottom);

  if (layout === "hero" && firstInSection && queue[0]?.tagName === "P") {
    const intro = document.createElement("div");
    intro.className = "newspaper-text newspaper-lead-band";
    const column = document.createElement("div");
    column.className = "newspaper-column";
    intro.append(column);
    content.append(intro);
    const line = parseFloat(getComputedStyle(column).lineHeight);
    column.style.height = `${Math.max(line * 2.5, Math.min(remaining * .25, pageHeight * .14))}px`;
    const style = getComputedStyle(intro);
    const outerHeight = intro.offsetHeight + parseFloat(style.marginBottom);
    if (remaining - outerHeight >= line * 4) {
      const lead = [queue.shift()!];
      fillNewspaperColumn(column, lead);
      queue.unshift(...lead);
      if (!lead.length && column.lastElementChild) {
        column.style.height = `${column.lastElementChild.getBoundingClientRect().bottom - column.getBoundingClientRect().top}px`;
      }
      remaining -= intro.offsetHeight + parseFloat(style.marginBottom);
    } else intro.remove();
  }

  function readingRegion(height: number) {
    const region = document.createElement("div");
    region.className = "newspaper-reading-region";
    region.style.height = `${height}px`;
    const columns: HTMLElement[] = [];
    for (let band = 0; band < (layout === "gazette-mosaic" ? 2 : 1); band++) {
      const grid = document.createElement("div");
      grid.className = "newspaper-text newspaper-column-grid";
      if (layout === "column-inset") grid.classList.add("newspaper-feature-grid");
      if (layout === "gazette-mosaic") grid.classList.add("newspaper-digest-band");
      for (let i = 0; i < (layout === "column-inset" ? 1 : 2); i++) {
        const column = document.createElement("div");
        column.className = "newspaper-column";
        columns.push(column);
        grid.append(column);
      }
      region.append(grid);
    }
    content.append(region);
    return { region, columns };
  }

  function fill(columns: HTMLElement[], pending: HTMLElement[]) {
    for (const column of columns) {
      column.style.setProperty("--newspaper-image-height", `${Math.max(32, column.clientHeight * .42)}px`);
      fillNewspaperColumn(column, pending);
    }
  }

  function widePicture(source: HTMLElement) {
    const picture = source.cloneNode(true) as HTMLElement;
    picture.classList.replace("newspaper-slot-col", "newspaper-slot-page");
    picture.style.setProperty("--newspaper-wide-image-height", `${pageHeight * .45}px`);
    content.append(picture);
    return picture;
  }

  while (queue.length && remaining > 0) {
    const wideIndex = queue.findIndex(node => node.dataset.imageWidth === "page");
    if (wideIndex === 0) {
      const picture = widePicture(queue[0]);
      if (picture.offsetHeight > remaining) {
        const image = picture.querySelector<HTMLImageElement>("img");
        const available = image ? remaining - (picture.offsetHeight - image.clientHeight) : 0;
        if (image && available >= Math.min(64, image.clientHeight * .5)) {
          image.style.maxHeight = `${Math.floor(available)}px`;
        }
      }
      if (picture.offsetHeight > remaining + .5 && content.children.length > 1) {
        picture.remove();
        break;
      }
      remaining -= picture.offsetHeight;
      queue.shift();
      continue;
    }

    const { region, columns } = readingRegion(remaining);
    const line = parseFloat(getComputedStyle(columns[0]).lineHeight);
    const minimum = Math.max(51, line * 3) * (layout === "gazette-mosaic" ? 2 : 1) +
      (layout === "gazette-mosaic" ? line * 1.5 : 0);
    if (remaining < minimum && content.children.length > 1) {
      region.remove();
      break;
    }
    if (wideIndex < 0) {
      fill(columns, queue);
      break;
    }

    const prefix = queue.slice(0, wideIndex);
    // Probe clones only: trial pagination must never consume the real story.
    const fits = (height: number) => {
      region.style.height = `${height}px`;
      columns.forEach(column => { column.replaceChildren(); column.style.removeProperty("height"); });
      const probe = prefix.map(node => node.cloneNode(true) as HTMLElement);
      fill(columns, probe);
      return probe.length === 0 && columns.every(column => {
        const bottom = Math.min(column.getBoundingClientRect().bottom, region.getBoundingClientRect().bottom);
        return Array.from(column.children).every(child => child.getBoundingClientRect().bottom <= bottom + .5);
      });
    };
    let chosenHeight = remaining;
    let sharesPage = false;
    if (fits(remaining)) {
      const picture = widePicture(queue[wideIndex]);
      const imageHeight = picture.offsetHeight;
      picture.remove();
      const upper = remaining - imageHeight;
      if (upper >= minimum && fits(upper)) {
        let low = minimum;
        let high = upper;
        while (high - low > 1) {
          const mid = (low + high) / 2;
          if (fits(mid)) high = mid;
          else low = mid;
        }
        chosenHeight = Math.ceil(high);
        sharesPage = true;
      }
    }
    region.style.height = `${chosenHeight}px`;
    columns.forEach(column => { column.replaceChildren(); column.style.removeProperty("height"); });
    const beforePicture = queue.splice(0, wideIndex);
    fill(columns, beforePicture);
    queue.unshift(...beforePicture);
    remaining -= chosenHeight;
    if (sharesPage) continue;

    // An unattached picture can move to the next page while following prose
    // uses the remaining lines. Picture order stays fixed, even when there are
    // several attachments before the next paragraph. Inline anchors stay fixed.
    if (!beforePicture.length && !queue[0]?.dataset.inlineImage) {
      for (let index = 1; index < queue.length;) {
        const node = queue[index];
        if (node.dataset.inlineImage) break;
        if (node.classList.contains("newspaper-slot")) { index++; continue; }
        if (node.tagName !== "P") break;
        const prose = [node];
        fill(columns, prose);
        if (prose.length) { queue[index] = prose[0]; break; }
        queue.splice(index, 1);
      }
    }
    break;
  }
}
