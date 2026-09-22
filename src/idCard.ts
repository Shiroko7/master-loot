import { ID_ROW_FIELDS, type LootItem } from "./types";
import { normalizeImageUrl } from "./markdown";

/**
 * Render an ID card as a parchment credential: portrait frame, name,
 * label/value rows and a red seal stamp. Only filled-in profile fields
 * appear. Built with textContent only — DM-authored text is never HTML.
 */
function buildLikeness(profile: NonNullable<LootItem["profile"]>): HTMLSpanElement {
  const likeness = document.createElement("span");
  if (profile.portrait?.trim()) {
    likeness.className = "likeness";
    likeness.textContent = profile.portrait;
  } else {
    likeness.className = "likeness-empty";
    likeness.textContent = "👤";
  }
  return likeness;
}

export function renderIdCard(root: HTMLElement, item: LootItem): void {
  root.innerHTML = "";
  const profile = item.profile ?? {};

  const card = document.createElement("article");
  card.className = "id-card";

  // Letterhead: the issuing authority between rule lines; just an ornament
  // when no authority is given.
  const head = document.createElement("div");
  head.className = "id-head";
  head.textContent = profile.issuedBy?.trim() || "✦";
  card.append(head);

  const main = document.createElement("div");
  main.className = "id-main";

  const frame = document.createElement("div");
  frame.className = "id-portrait";
  const url = profile.portraitUrl?.trim();
  if (url) {
    const photo = document.createElement("img");
    photo.className = "likeness-photo";
    photo.alt = "";
    photo.draggable = false;
    photo.referrerPolicy = "no-referrer";
    // A dead link falls back to the drawn likeness instead of a broken image.
    photo.onerror = () => {
      photo.remove();
      frame.append(buildLikeness(profile));
    };
    photo.src = normalizeImageUrl(url);
    frame.append(photo);
  } else {
    frame.append(buildLikeness(profile));
  }
  main.append(frame);

  const info = document.createElement("div");
  info.className = "id-info";
  if (profile.name?.trim()) {
    const name = document.createElement("div");
    name.className = "id-name";
    name.textContent = profile.name;
    info.append(name);
  }
  const rows = document.createElement("div");
  rows.className = "id-rows";
  for (const { key, label } of ID_ROW_FIELDS) {
    const value = profile[key]?.trim();
    if (!value) continue;
    const labelEl = document.createElement("span");
    labelEl.className = "id-label";
    labelEl.textContent = label;
    const valueEl = document.createElement("span");
    valueEl.className = "id-value";
    valueEl.textContent = value;
    rows.append(labelEl, valueEl);
  }
  if (rows.childElementCount > 0) {
    info.append(rows);
  } else if (!profile.name?.trim() && !profile.notes?.trim()) {
    const blank = document.createElement("div");
    blank.className = "id-blank";
    blank.textContent = "(Nothing is filled in.)";
    info.append(blank);
  }
  main.append(info);
  card.append(main);

  if (profile.notes?.trim()) {
    const notes = document.createElement("div");
    notes.className = "id-notes";
    notes.textContent = profile.notes;
    card.append(notes);
  }

  const seal = document.createElement("div");
  seal.className = "id-seal";
  const glyph = document.createElement("span");
  glyph.textContent = "❖";
  seal.append(glyph);
  card.append(seal);

  root.append(card);
}
