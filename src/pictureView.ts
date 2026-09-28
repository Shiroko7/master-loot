import { isImgurAlbumUrl, isSafeUrl, normalizeImageUrl, renderMarkdownInto } from "./markdown";
import type { LootItem } from "./types";

/**
 * Thumbnail of an item's picture for an expanded loot/inventory slot, shown
 * above the description. Clicking it calls `onOpen` (the full-size view)
 * without collapsing the slot. Returns null when there is no usable image.
 */
export function buildSlotPicture(
  rawUrl: string | undefined,
  alt: string,
  onOpen?: () => void,
): HTMLElement | null {
  const url = rawUrl?.trim() ?? "";
  if (!url || !isSafeUrl(url)) return null;
  const wrap = document.createElement("div");
  wrap.className = "slot-picture";
  const img = document.createElement("img");
  img.referrerPolicy = "no-referrer";
  img.src = normalizeImageUrl(url);
  img.alt = alt;
  img.onerror = () => {
    wrap.textContent = "Picture unavailable";
    wrap.classList.add("slot-picture-missing");
  };
  wrap.append(img);
  if (onOpen) {
    wrap.classList.add("slot-picture-open");
    wrap.title = "View larger";
    wrap.onclick = (event) => {
      event.stopPropagation();
      onOpen();
    };
  }
  return wrap;
}

/**
 * Render a `picture` item: the image as a mounted print, with the item's
 * description (Markdown) on a parchment strip underneath. Built with DOM
 * APIs only — DM-authored text is never parsed as HTML.
 */
export function renderPicture(root: HTMLElement, item: LootItem): void {
  root.innerHTML = "";

  const card = document.createElement("article");
  card.className = "picture-card";

  const mount = document.createElement("div");
  mount.className = "picture-mount";
  const url = item.imageUrl?.trim() ?? "";

  const placeholder = (text: string) => {
    mount.textContent = "";
    mount.classList.add("picture-missing");
    const note = document.createElement("span");
    note.textContent = text;
    mount.append(note);
  };

  if (!url) {
    placeholder("No picture chosen yet.");
  } else if (!isSafeUrl(url)) {
    placeholder("Picture unavailable");
  } else {
    const img = document.createElement("img");
    img.className = "picture-img";
    img.referrerPolicy = "no-referrer";
    img.src = normalizeImageUrl(url);
    img.alt = item.name;
    img.onerror = () =>
      placeholder(
        isImgurAlbumUrl(url)
          ? "Picture unavailable: Imgur album links can't be embedded. Use the image's own link."
          : "Picture unavailable",
      );
    mount.append(img);
  }
  card.append(mount);

  if (item.description?.trim()) {
    const text = document.createElement("div");
    text.className = "picture-text";
    renderMarkdownInto(text, item.description);
    card.append(text);
  }

  root.append(card);
}
