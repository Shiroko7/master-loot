import { normalizeImageUrl, isImgurAlbumUrl } from "./markdown";
import { NEWSPAPER_PRINT_FILTERS, NEWSPAPER_PRINT_FILTER_META,
  type LootDocument, type NewspaperImage, type NewspaperPrintFilter } from "./types";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

export function createNewspaperImageManager(doc: LootDocument, onChange: () => void): HTMLElement {
  const wrap = el("div", "doc-image-manager");
  const refresh = () => wrap.replaceWith(createNewspaperImageManager(doc, onChange));
  const head = el("div", "doc-image-header");
  const title = el("span", "doc-image-title");
  title.textContent = "Pictures · reading order";

  const addBtn = el("button", "btn btn-gold");
  addBtn.textContent = "+ Add Picture";
  addBtn.onclick = () => {
    (doc.images ??= []).push({ url: "", caption: "", width: "column" });
    onChange();
    refresh();
  };
  head.append(title, addBtn);

  const hint = el("div", "doc-image-hint");
  hint.textContent =
    "Use the arrows to set picture order. Choose column width or the full width of one page. Pictures written directly in the story keep their positions.";

  const list = el("div", "doc-image-list");
  const images = (doc.images ??= []);

  images.forEach((img, idx) => {
    const row = el("div", "doc-image-row");
    row.dataset.imageIndex = String(idx);
    const order = el("div", "doc-image-order");
    const number = el("span");
    number.textContent = String(idx + 1);
    order.append(number);
    for (const [delta, label, symbol] of [[-1, "earlier", "↑"], [1, "later", "↓"]] as const) {
      const button = el("button", "btn-icon");
      button.type = "button";
      button.textContent = symbol;
      button.ariaLabel = `Move picture ${idx + 1} ${label}`;
      button.title = button.ariaLabel;
      button.disabled = idx + delta < 0 || idx + delta >= images.length;
      button.onclick = () => {
        const destination = idx + delta;
        [images[idx], images[destination]] = [images[destination], images[idx]];
        onChange();
        const parent = wrap.parentElement;
        refresh();
        parent?.querySelector<HTMLButtonElement>(`[aria-label="Move picture ${destination + 1} ${label}"]`)?.focus();
      };
      order.append(button);
    }

    const thumb = el("div", "doc-image-thumb");
    const resolvedThumb = normalizeImageUrl(img.url.trim());
    if (resolvedThumb) {
      const imgEl = el("img");
      imgEl.referrerPolicy = "no-referrer";
      imgEl.src = resolvedThumb;
      imgEl.onload = () => {
        if (imgEl.src.includes("imgur") && imgEl.naturalWidth === 161 && imgEl.naturalHeight === 81) {
          thumb.textContent = "⚠️";
          thumb.title = "Imgur image expired or album link (copy direct image address from Imgur)";
        }
      };
      imgEl.onerror = () => {
        if (imgEl.src.endsWith(".png") && imgEl.src.includes("i.imgur.com")) {
          imgEl.src = imgEl.src.replace(/\.png$/, ".jpg");
          return;
        }
        thumb.textContent = "⚠️";
      };
      thumb.append(imgEl);
    } else {
      thumb.textContent = "🖼️";
    }

    const inputs = el("div", "doc-image-inputs");

    const urlRow = el("div");
    urlRow.style.display = "flex";
    urlRow.style.gap = "6px";
    urlRow.style.alignItems = "center";

    const urlInput = el("input");
    urlInput.style.flex = "1";
    urlInput.ariaLabel = `Picture ${idx + 1} URL`;
    urlInput.value = img.url;
    urlInput.placeholder = "Paste direct image URL (e.g. https://i.imgur.com/Bnew4HG.jpeg)…";

    const warnEl = el("div");
    warnEl.style.color = "var(--gold-bright, #f59e0b)";
    warnEl.style.fontSize = "0.78em";
    warnEl.style.marginTop = "3px";
    warnEl.style.lineHeight = "1.3";
    warnEl.style.display = isImgurAlbumUrl(img.url) ? "block" : "none";
    warnEl.innerHTML =
      "⚠️ <strong>Imgur Album link detected:</strong> Imgur doesn't allow embedding album pages directly. Open the link on Imgur, right-click the picture itself, and click <em>Copy Image Address</em> (direct link: <code>https://i.imgur.com/Bnew4HG.jpeg</code>).";

    urlInput.oninput = () => {
      const normalized = normalizeImageUrl(urlInput.value.trim());
      img.url = normalized;
      warnEl.style.display = isImgurAlbumUrl(urlInput.value) ? "block" : "none";
      onChange();
    };
    urlInput.onchange = () => {
      const normalized = normalizeImageUrl(urlInput.value.trim());
      img.url = normalized;
      urlInput.value = normalized;
      onChange();
      refresh();
    };

    urlRow.append(urlInput);
    inputs.append(urlRow, warnEl);

    const subRow = el("div");
    subRow.style.display = "flex";
    subRow.style.gap = "6px";
    subRow.style.marginTop = "4px";

    const capInput = el("input");
    capInput.style.flex = "1";
    capInput.ariaLabel = `Picture ${idx + 1} caption`;
    capInput.value = img.caption ?? "";
    capInput.placeholder = "Caption under illustration…";
    capInput.oninput = () => {
      img.caption = capInput.value;
      onChange();
    };

    const filterSelect = el("select");
    filterSelect.ariaLabel = `Picture ${idx + 1} print filter`;
    filterSelect.style.fontSize = "0.8em";
    filterSelect.style.width = "auto";
    filterSelect.style.maxWidth = "150px";

    const defaultOpt = el("option");
    defaultOpt.value = "";
    const activeDocFilter = doc.newspaperFilter ?? "halftone";
    defaultOpt.textContent = `Default (${NEWSPAPER_PRINT_FILTER_META[activeDocFilter].label.split(" ")[0]})`;
    defaultOpt.selected = !img.filter;
    filterSelect.append(defaultOpt);

    for (const f of NEWSPAPER_PRINT_FILTERS) {
      const opt = el("option");
      opt.value = f;
      opt.textContent = NEWSPAPER_PRINT_FILTER_META[f].label;
      opt.selected = img.filter === f;
      filterSelect.append(opt);
    }
    filterSelect.onchange = () => {
      img.filter = filterSelect.value ? (filterSelect.value as NewspaperPrintFilter) : undefined;
      onChange();
    };

    subRow.append(capInput, filterSelect);
    inputs.append(subRow);
    const widthLabel = el("label", "doc-image-width");
    widthLabel.append("Picture width");
    const width = el("select");
    width.ariaLabel = `Picture ${idx + 1} width`;
    for (const [value, label] of [["", "Layout default"], ["column", "Column width"], ["page", "Full page width"]]) {
      const option = el("option");
      option.value = value;
      option.textContent = label;
      option.selected = value === (img.width ?? "");
      width.append(option);
    }
    width.onchange = () => {
      img.width = (width.value || undefined) as NewspaperImage["width"];
      onChange();
    };
    widthLabel.append(width);
    inputs.append(widthLabel);

    const remove = el("button", "btn-icon");
    remove.textContent = "✕";
    remove.title = "Remove picture";
    remove.ariaLabel = `Remove picture ${idx + 1}`;
    remove.onclick = () => {
      images.splice(idx, 1);
      onChange();
      refresh();
    };

    row.append(order, thumb, inputs, remove);
    list.append(row);
  });

  wrap.append(head, hint);
  if (images.length > 0) {
    wrap.append(list);
  }
  return wrap;
}
