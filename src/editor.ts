import OBR from "@owlbear-rodeo/sdk";
import "@fontsource/caveat/400.css";
import "@fontsource/caveat/700.css";
import "@fontsource/shadows-into-light/400.css";
import "@fontsource/homemade-apple/400.css";
import "@fontsource/dancing-script/400.css";
import "@fontsource/dancing-script/700.css";
import "@fontsource/great-vibes/400.css";
import "@fontsource/im-fell-english/400.css";
import "@fontsource/medievalsharp/400.css";
import "@fontsource/uncial-antiqua/400.css";
import "@fontsource/pirata-one/400.css";
import "@fontsource/cinzel/600.css";
import "./styles/ui.css";
import "./styles/paper.css";
import { EDITOR_MODAL_ID, MAX_DOC_CHARS } from "./constants";
import { closeWindow, setupWindowResizer } from "./windowResizer";
import { fetchLootItem, parseItemLink, safeHttpUrl } from "./fiveETools";
import { getLoot, getToken, saveLoot } from "./loot";
import { renderIdCard } from "./idCard";
import { renderDocument } from "./paperRender";
import { createNewspaperLayoutPicker } from "./newspaperLayoutPicker";
import { createNewspaperHeaderFields } from "./newspaperHeaderFields";
import { createNewspaperImageManager } from "./newspaperImageManager";
import { getBackup } from "./storage";
import { buildCoinConverter } from "./coins";
import { renderMarkdownInto, isImgurAlbumUrl } from "./markdown";
import {
  COIN_KINDS,
  COIN_META,
  DOC_FONTS,
  DOC_FONT_META,
  DOC_LAYOUTS,
  DOC_LAYOUT_META,
  DOC_STYLES,
  DOC_STYLE_META,
  ID_ROW_FIELDS,
  NEWSPAPER_PRINT_FILTERS,
  NEWSPAPER_PRINT_FILTER_META,
  NEWSPAPER_HEADER_STYLES,
  NEWSPAPER_HEADER_META,
  PAPER_TEXTURES,
  PAPER_TEXTURE_META,
  defaultLayout,
  formatCoins,
  RARITIES,
  groupLootItems,
  RARITY_META,
  STYLE_DEFAULT_FONT,
  createContainer,
  createCurrencyItem,
  createIdCardItem,
  createLootDocument,
  createLootItem,
  type LootContainer,
  type LootDocument,
  type LootItem,
  type NewspaperPrintFilter,
  type NewspaperHeaderStyle,
} from "./types";

const app = document.getElementById("app")!;
const tokenId = new URLSearchParams(location.search).get("token") ?? "";

let loot: LootContainer;
let selectedId: string | null = null;
let detailTab: "write" | "style" = "write";
const collapsedFolders = new Set<string>();
/** Folder currently in inline-rename mode. */
let renamingFolder: string | null = null;
/** Item id being dragged between folders. */
let draggedId: string | null = null;
let dirty = false;
/** Item fetched from 5e.tools, awaiting Add/Cancel in the detail pane. */
let pendingImport: LootItem | null = null;

let statusEl: HTMLSpanElement;
let listEl: HTMLDivElement;
let detailEl: HTMLDivElement;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  return node;
}

function field(labelText: string, control: HTMLElement): HTMLLabelElement {
  const label = el("label", "field");
  const caption = el("span");
  caption.textContent = labelText;
  label.append(caption, control);
  return label;
}

function selected(): LootItem | undefined {
  return loot.items.find((i) => i.id === selectedId);
}

// --- persistence -----------------------------------------------------------

function markDirty(): void {
  dirty = true;
  statusEl.textContent = "Unsaved changes";
}

function errorText(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  return msg.slice(0, 140);
}

async function saveNow(): Promise<void> {
  if (!dirty) return;
  dirty = false;
  statusEl.textContent = "Saving…";
  statusEl.title = "";
  try {
    // Badge/sparkle attachments are managed solely by the GM background
    // script reacting to this metadata change — one writer, no duplicates.
    await saveLoot(tokenId, loot);
    statusEl.textContent = "Saved ✓";
  } catch (error) {
    console.error("Master Loot: failed to save", error);
    statusEl.textContent = `Save failed: ${errorText(error)}`;
    statusEl.title = String(error);
    dirty = true;
  }
}

async function closeEditor(): Promise<void> {
  if (
    dirty &&
    !window.confirm("You have unsaved changes. Close without saving?")
  ) {
    return;
  }
  dirty = false;
  await closeWindow(EDITOR_MODAL_ID);
}

// --- shell -----------------------------------------------------------------

function buildShell(): void {
  app.innerHTML = "";
  const panel = el("div", "panel");

  const header = el("div", "panel-header");
  const title = el("h1", "panel-title");
  title.textContent = "Loot";

  const nameInput = el("input");
  nameInput.value = loot.name;
  nameInput.placeholder = "Container name";
  nameInput.style.maxWidth = "220px";
  nameInput.oninput = () => {
    loot.name = nameInput.value;
    markDirty();
  };

  const enabledSwitch = el("label", "switch");
  const enabledInput = el("input");
  enabledInput.type = "checkbox";
  enabledInput.checked = loot.enabled;
  const track = el("span", "track");
  const switchText = el("span");
  switchText.textContent = "Lootable";
  enabledInput.onchange = () => {
    loot.enabled = enabledInput.checked;
    markDirty();
  };
  enabledSwitch.append(enabledInput, track, switchText);

  statusEl = el("span", "status");
  statusEl.textContent = "";

  const saveBtn = el("button", "btn btn-gold");
  saveBtn.textContent = "Save";
  saveBtn.onclick = () => void saveNow();

  const close = el("button", "btn-icon");
  close.textContent = "✕";
  close.ariaLabel = "Close";
  close.onclick = () => void closeEditor();

  header.append(title, nameInput, enabledSwitch, statusEl, saveBtn, close);

  const main = el("div", "editor-main");

  const listPane = el("div", "editor-list");
  listEl = el("div", "loot-list");
  // Dropping on the empty space below the slots un-files a dragged item.
  listEl.ondragover = (event) => {
    if (draggedId) event.preventDefault();
  };
  listEl.ondrop = (event) => {
    event.preventDefault();
    if (draggedId) dropOnRoot(draggedId);
  };
  const addRow = el("div", "add-row");
  const addItem = el("button", "btn");
  addItem.textContent = "+ Item";
  addItem.onclick = () => addLootItem(createLootItem());
  const addDoc = el("button", "btn btn-gold");
  addDoc.textContent = "+ Document";
  addDoc.onclick = () => addLootItem(createLootDocument());
  const addNews = el("button", "btn btn-gold");
  addNews.textContent = "+ Newspaper";
  addNews.onclick = () => addLootItem(createLootDocument("newspaper"));
  const addCoins = el("button", "btn");
  addCoins.textContent = "+ Coins";
  addCoins.onclick = () => addLootItem(createCurrencyItem());
  const addIdCard = el("button", "btn");
  addIdCard.textContent = "+ ID Card";
  addIdCard.onclick = () => addLootItem(createIdCardItem());
  const addFolderBtn = el("button", "btn");
  addFolderBtn.textContent = "+ Folder";
  addFolderBtn.onclick = () => addFolder();
  addRow.append(addItem, addDoc, addNews, addCoins, addIdCard, addFolderBtn);
  listPane.append(addRow, buildImportRow(), listEl);

  detailEl = el("div", "editor-detail");
  main.append(listPane, detailEl);

  panel.append(header, main);
  app.append(panel);
}

function addLootItem(item: LootItem): void {
  loot.items.push(item);
  selectedId = item.id;
  detailTab = "write";
  pendingImport = null;
  markDirty();
  renderList();
  renderDetail();
}

// --- 5e.tools import ---------------------------------------------------------

function buildImportRow(): HTMLElement {
  const wrap = el("div", "import-box");
  const row = el("div", "import-row");
  const input = el("input");
  input.placeholder = "Paste a 5e.tools item link…";
  const button = el("button", "btn");
  button.textContent = "Import";
  const status = el("div", "import-status");

  const run = async () => {
    const parsed = parseItemLink(input.value);
    if (!parsed) {
      status.textContent =
        "That doesn't look like a 5e.tools item link (…/items.html#…).";
      status.classList.add("error");
      return;
    }
    button.disabled = true;
    status.classList.remove("error");
    status.textContent = "Fetching item data…";
    try {
      pendingImport = await fetchLootItem(parsed);
      selectedId = null;
      input.value = "";
      status.textContent = "";
      renderList();
      renderDetail();
    } catch (error) {
      console.error("Master Loot: 5e.tools import failed", error);
      status.textContent =
        error instanceof Error ? error.message : "Import failed.";
      status.classList.add("error");
    } finally {
      button.disabled = false;
    }
  };

  button.onclick = () => void run();
  input.onkeydown = (event) => {
    if (event.key === "Enter") void run();
  };
  row.append(input, button);
  wrap.append(row, status);
  return wrap;
}

function renderImportPreview(item: LootItem): void {
  const label = el("div", "import-preview-label");
  label.textContent = "Import preview — nothing is added until you accept.";

  const card = el("div", "import-preview");
  card.style.setProperty("--rarity", RARITY_META[item.rarity].color);

  const head = el("div", "head");
  const icon = el("span", "slot-icon");
  icon.textContent = item.icon;
  const name = el("span", "slot-name");
  name.textContent = item.name;
  head.append(icon, name);
  card.append(head);

  if (item.description) {
    const desc = el("div", "import-desc");
    renderMarkdownInto(desc, item.description);
    card.append(desc);
  }

  const href = safeHttpUrl(item.link);
  if (href) {
    const link = el("a", "slot-link");
    link.href = href;
    link.target = "_blank";
    link.rel = "noreferrer noopener";
    link.textContent = `${new URL(href).hostname} ↗`;
    card.append(link);
  }

  const actions = el("div", "import-actions");
  const add = el("button", "btn btn-gold");
  add.textContent = "Add to loot";
  add.onclick = () => addLootItem(item);
  const cancel = el("button", "btn");
  cancel.textContent = "Cancel";
  cancel.onclick = () => {
    pendingImport = null;
    renderDetail();
  };
  actions.append(add, cancel);

  detailEl.append(label, card, actions);
}

// --- item list ---------------------------------------------------------------

// --- folders -----------------------------------------------------------------

function takeItem(id: string): LootItem | undefined {
  const index = loot.items.findIndex((i) => i.id === id);
  if (index < 0) return undefined;
  return loot.items.splice(index, 1)[0];
}

/** Drop onto a folder header: file the item at the end of that folder. */
function dropOnFolder(id: string, folder: string): void {
  const item = takeItem(id);
  if (!item) return;
  item.folder = folder;
  let last = -1;
  loot.items.forEach((other, index) => {
    if (other.folder?.trim() === folder) last = index;
  });
  loot.items.splice(last + 1, 0, item);
  markDirty();
  renderList();
}

/** Drop onto another item: insert before it and adopt its folder. */
function dropOnSlot(id: string, targetId: string): void {
  if (id === targetId) return;
  const item = takeItem(id);
  if (!item) return;
  const index = loot.items.findIndex((i) => i.id === targetId);
  item.folder = index >= 0 ? loot.items[index].folder : undefined;
  loot.items.splice(Math.max(index, 0), 0, item);
  markDirty();
  renderList();
}

/** Drop onto the list background: move the item out of any folder. */
function dropOnRoot(id: string): void {
  const item = takeItem(id);
  if (!item) return;
  item.folder = undefined;
  loot.items.push(item);
  markDirty();
  renderList();
}

function addFolder(): void {
  const folders = (loot.folders ??= []);
  let name = "New folder";
  for (let n = 2; folders.includes(name); n++) name = `New folder ${n}`;
  folders.push(name);
  renamingFolder = name;
  markDirty();
  renderList();
}

function renameFolder(oldName: string, rawNext: string): void {
  renamingFolder = null;
  const next = rawNext.trim();
  if (!next || next === oldName) {
    renderList();
    return;
  }
  const folders = (loot.folders ??= []);
  const index = folders.indexOf(oldName);
  if (index >= 0) {
    // Renaming onto an existing folder merges the two.
    if (folders.includes(next)) folders.splice(index, 1);
    else folders[index] = next;
  } else if (!folders.includes(next)) {
    folders.push(next);
  }
  for (const item of loot.items) {
    if (item.folder?.trim() === oldName) item.folder = next;
  }
  if (collapsedFolders.delete(oldName)) collapsedFolders.add(next);
  markDirty();
  renderList();
}

/** Dissolve a folder; its items drop back to the ungrouped list. */
function removeFolder(folder: string): void {
  loot.folders = (loot.folders ?? []).filter((f) => f !== folder);
  for (const item of loot.items) {
    if (item.folder?.trim() === folder) item.folder = undefined;
  }
  collapsedFolders.delete(folder);
  markDirty();
  renderList();
}

// --- item list ---------------------------------------------------------------

function buildSlot(item: LootItem): HTMLElement {
  const slot = el("button", "slot");
  if (item.id === selectedId) slot.classList.add("selected");
  slot.style.setProperty("--rarity", RARITY_META[item.rarity].color);

  const icon = el("span", "slot-icon");
  icon.textContent = item.icon || "🪙";
  const name = el("span", "slot-name");
  name.textContent = item.name || "(unnamed)";
  if (item.kind === "document") {
    const sub = el("span", "slot-sub");
    sub.textContent = DOC_STYLE_META[item.document?.style ?? "letter"].label;
    name.append(sub);
  } else if (item.kind === "currency") {
    const sub = el("span", "slot-sub");
    sub.textContent = formatCoins(item.coins ?? {});
    name.append(sub);
  } else if (item.kind === "idcard") {
    const sub = el("span", "slot-sub");
    const who = item.profile?.name?.trim();
    sub.textContent = who ? `ID — ${who}` : "ID card";
    name.append(sub);
  }
  const qty = el("span", "slot-qty");
  qty.textContent = item.quantity > 1 ? `×${item.quantity}` : "";

  slot.append(icon, name, qty);
  slot.onclick = () => {
    selectedId = item.id;
    detailTab = "write";
    pendingImport = null;
    renderList();
    renderDetail();
  };

  slot.draggable = true;
  slot.ondragstart = (event) => {
    draggedId = item.id;
    event.dataTransfer?.setData("text/plain", item.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  };
  slot.ondragend = () => {
    draggedId = null;
  };
  slot.ondragover = (event) => {
    if (draggedId && draggedId !== item.id) {
      event.preventDefault();
      slot.classList.add("drag-over");
    }
  };
  slot.ondragleave = () => slot.classList.remove("drag-over");
  slot.ondrop = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (draggedId) dropOnSlot(draggedId, item.id);
  };
  return slot;
}

function buildFolderHead(folder: string, count: number): HTMLElement {
  const head = el("div", "folder-head");
  const chevron = el("span", "chev");
  chevron.textContent = collapsedFolders.has(folder) ? "▸" : "▾";
  head.append(chevron);

  if (renamingFolder === folder) {
    const input = el("input", "folder-rename");
    input.value = folder;
    input.onclick = (event) => event.stopPropagation();
    input.onkeydown = (event) => {
      if (event.key === "Enter") input.blur();
      if (event.key === "Escape") {
        renamingFolder = null;
        renderList();
      }
    };
    input.onblur = () => renameFolder(folder, input.value);
    head.append(input);
    queueMicrotask(() => {
      input.focus();
      input.select();
    });
    return head;
  }

  const label = el("span", "folder-label");
  label.textContent = folder;
  label.ondblclick = () => {
    renamingFolder = folder;
    renderList();
  };
  const countEl = el("span", "folder-count");
  countEl.textContent = String(count);

  const rename = el("button", "mini");
  rename.textContent = "✎";
  rename.title = "Rename folder";
  rename.onclick = (event) => {
    event.stopPropagation();
    renamingFolder = folder;
    renderList();
  };
  const dissolve = el("button", "mini");
  dissolve.textContent = "✕";
  dissolve.title = "Dissolve folder (items are kept)";
  dissolve.onclick = (event) => {
    event.stopPropagation();
    removeFolder(folder);
  };

  head.append(label, countEl, rename, dissolve);
  head.onclick = () => {
    if (collapsedFolders.has(folder)) collapsedFolders.delete(folder);
    else collapsedFolders.add(folder);
    renderList();
  };

  head.ondragover = (event) => {
    if (draggedId) {
      event.preventDefault();
      head.classList.add("drag-over");
    }
  };
  head.ondragleave = () => head.classList.remove("drag-over");
  head.ondrop = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (draggedId) dropOnFolder(draggedId, folder);
  };
  return head;
}

function renderList(): void {
  listEl.innerHTML = "";
  const hasFolders = (loot.folders ?? []).length > 0;
  if (loot.items.length === 0 && !hasFolders) {
    const note = el("div", "empty-note");
    note.textContent = "No loot yet. Add an item or a document.";
    listEl.append(note);
    return;
  }
  for (const group of groupLootItems(loot.items, loot.folders, true)) {
    if (group.folder) {
      listEl.append(buildFolderHead(group.folder, group.items.length));
      if (collapsedFolders.has(group.folder)) continue;
    }
    for (const item of group.items) {
      listEl.append(buildSlot(item));
    }
  }
}

// --- detail pane -------------------------------------------------------------

function renderDetail(): void {
  detailEl.innerHTML = "";
  if (pendingImport) {
    renderImportPreview(pendingImport);
    return;
  }
  const item = selected();
  if (!item) {
    const note = el("div", "empty-note");
    note.textContent =
      "Select something on the left, or add an item or document.";
    detailEl.append(note);
    return;
  }

  if (item.kind === "document") {
    renderDocumentDetail(item);
  } else if (item.kind === "currency") {
    renderCurrencyDetail(item);
  } else if (item.kind === "idcard") {
    renderIdCardDetail(item);
  } else {
    renderItemDetail(item);
  }

  const remove = el("button", "btn btn-danger");
  remove.textContent = "Delete";
  remove.style.marginTop = "14px";
  remove.onclick = () => {
    loot.items = loot.items.filter((i) => i.id !== item.id);
    selectedId = null;
    markDirty();
    renderList();
    renderDetail();
  };
  detailEl.append(remove);
}

function commonFields(item: LootItem): HTMLElement {
  const row = el("div", "field-row");

  const iconInput = el("input");
  iconInput.value = item.icon;
  iconInput.maxLength = 4;
  iconInput.oninput = () => {
    item.icon = iconInput.value;
    markDirty();
    renderList();
  };

  const qtyInput = el("input");
  qtyInput.type = "number";
  qtyInput.min = "1";
  qtyInput.value = String(item.quantity);
  qtyInput.oninput = () => {
    item.quantity = Math.max(1, Number(qtyInput.value) || 1);
    markDirty();
    renderList();
  };

  const raritySelect = el("select");
  for (const rarity of RARITIES) {
    const option = el("option");
    option.value = rarity;
    option.textContent = RARITY_META[rarity].label;
    option.selected = rarity === item.rarity;
    raritySelect.append(option);
  }
  raritySelect.onchange = () => {
    item.rarity = raritySelect.value as LootItem["rarity"];
    markDirty();
    renderList();
  };

  row.append(
    field("Icon (emoji)", iconInput),
    field("Quantity", qtyInput),
    field("Rarity", raritySelect),
  );
  return row;
}

function renderItemDetail(item: LootItem): void {
  const nameInput = el("input");
  nameInput.value = item.name;
  nameInput.oninput = () => {
    item.name = nameInput.value;
    markDirty();
    renderList();
  };
  detailEl.append(field("Name", nameInput), commonFields(item));

  const descWrap = el("div");
  const descInput = el("textarea");
  descInput.value = item.description ?? "";
  descInput.placeholder =
    "Shown to players when they click the item. Full Markdown supported (**bold**, *italic*, - lists, | tables, > quotes).";

  const descPreview = el("div", "slot-desc");
  descPreview.style.marginTop = "6px";
  descPreview.style.padding = "6px 8px";
  descPreview.style.background = "rgba(0, 0, 0, 0.25)";
  descPreview.style.border = "1px solid var(--border-soft)";
  descPreview.style.borderRadius = "4px";

  const updateDescPreview = () => {
    descPreview.innerHTML = "";
    if (item.description?.trim()) {
      renderMarkdownInto(descPreview, item.description);
      descPreview.style.display = "block";
    } else {
      descPreview.style.display = "none";
    }
  };

  descInput.oninput = () => {
    item.description = descInput.value;
    updateDescPreview();
    markDirty();
  };
  updateDescPreview();

  descWrap.append(descInput, descPreview);
  detailEl.append(field("Description (Markdown supported)", descWrap));

  const linkInput = el("input");
  linkInput.value = item.link ?? "";
  linkInput.placeholder = "https://… shown to players under the description";
  linkInput.oninput = () => {
    item.link = linkInput.value.trim() || undefined;
    markDirty();
  };
  detailEl.append(field("Link (optional)", linkInput));
}

/** Currency detail: explicit coin counts + a live value converter. */
function renderCurrencyDetail(item: LootItem): void {
  const coins = (item.coins ??= {});

  const nameInput = el("input");
  nameInput.value = item.name;
  nameInput.oninput = () => {
    item.name = nameInput.value;
    markDirty();
    renderList();
  };

  const iconInput = el("input");
  iconInput.value = item.icon;
  iconInput.maxLength = 4;
  iconInput.oninput = () => {
    item.icon = iconInput.value;
    markDirty();
    renderList();
  };

  // Quantity is meaningless here — the coin counts *are* the amounts — and
  // rarity glow on a coin pouch reads as a magic item, so neither is shown.
  const topRow = el("div", "field-row");
  topRow.append(field("Name", nameInput), field("Icon (emoji)", iconInput));
  detailEl.append(topRow);

  const converter = buildCoinConverter(() => coins);

  const coinRow = el("div", "field-row");
  for (const kind of COIN_KINDS) {
    const input = el("input");
    input.type = "number";
    input.min = "0";
    input.value = String(coins[kind] ?? 0);
    input.oninput = () => {
      const count = Math.max(0, Math.floor(Number(input.value) || 0));
      if (count > 0) coins[kind] = count;
      else delete coins[kind];
      converter.update();
      markDirty();
      renderList();
    };
    coinRow.append(field(`${COIN_META[kind].name} (${kind})`, input));
  }
  detailEl.append(coinRow, converter.root);

  const descInput = el("textarea");
  descInput.value = item.description ?? "";
  descInput.placeholder =
    "Shown to players when they click the coins (e.g. “a ripped pouch, " +
    "still heavy”).";
  descInput.oninput = () => {
    item.description = descInput.value;
    markDirty();
  };
  detailEl.append(field("Description (optional)", descInput));
}

/** ID card detail: optional profile fields over a live card preview. */
function renderIdCardDetail(item: LootItem): void {
  const profile = (item.profile ??= {});

  const nameInput = el("input");
  nameInput.value = item.name;
  nameInput.oninput = () => {
    item.name = nameInput.value;
    markDirty();
    renderList();
  };

  const iconInput = el("input");
  iconInput.value = item.icon;
  iconInput.maxLength = 4;
  iconInput.oninput = () => {
    item.icon = iconInput.value;
    markDirty();
    renderList();
  };

  // A card is a single object, so no quantity; rarity still tints the slot.
  const raritySelect = el("select");
  for (const rarity of RARITIES) {
    const option = el("option");
    option.value = rarity;
    option.textContent = RARITY_META[rarity].label;
    option.selected = rarity === item.rarity;
    raritySelect.append(option);
  }
  raritySelect.onchange = () => {
    item.rarity = raritySelect.value as LootItem["rarity"];
    markDirty();
    renderList();
  };

  const topRow = el("div", "field-row");
  topRow.append(
    field("Name", nameInput),
    field("Icon (emoji)", iconInput),
    field("Rarity", raritySelect),
  );
  detailEl.append(topRow);

  const wrap = el("div", "preview-wrap");
  const stage = el("div", "paper-stage");
  stage.style.setProperty("--zoom", "0.68");
  const refreshPreview = () => renderIdCard(stage, item);
  wrap.append(stage);

  const profileInput = (
    key: keyof typeof profile,
    hint: string,
    emoji = false,
  ): HTMLInputElement => {
    const input = el("input");
    input.value = profile[key] ?? "";
    input.placeholder = hint;
    if (emoji) input.maxLength = 4;
    input.oninput = () => {
      const value = input.value.trim();
      if (value) profile[key] = input.value;
      else delete profile[key];
      markDirty();
      refreshPreview();
      renderList();
    };
    return input;
  };

  const note = el("div", "empty-note");
  note.textContent = "Every field is optional — only what you fill in appears.";
  detailEl.append(note);

  const identityRow = el("div", "field-row");
  identityRow.append(
    field("Portrait (emoji)", profileInput("portrait", "🧝", true)),
    field("Full name", profileInput("name", "As written on the card")),
    field("Issued by", profileInput("issuedBy", "Guild, sect, court, magistrate…")),
  );
  detailEl.append(identityRow);

  const portraitUrlRow = el("div", "field-row");
  const portraitUrlInput = profileInput("portraitUrl", "Paste direct image URL (https://…)");
  portraitUrlRow.append(
    field("Portrait image URL (replaces the emoji)", portraitUrlInput),
  );
  detailEl.append(portraitUrlRow);

  const albumWarning = el("div");
  albumWarning.style.color = "var(--gold-bright, #f59e0b)";
  albumWarning.style.fontSize = "0.78em";
  albumWarning.style.marginTop = "2px";
  albumWarning.style.marginBottom = "6px";
  albumWarning.style.display = "none";
  albumWarning.innerHTML =
    "⚠️ <strong>Imgur Album link detected:</strong> Imgur doesn't allow embedding album pages directly. Open the link on Imgur, right-click the picture itself, and click <em>Copy Image Address</em> (direct link looks like <code>https://i.imgur.com/...jpeg</code>).";

  const checkPortraitWarning = () => {
    albumWarning.style.display = isImgurAlbumUrl(portraitUrlInput.value) ? "block" : "none";
  };
  portraitUrlInput.addEventListener("input", checkPortraitWarning);
  checkPortraitWarning();
  detailEl.append(albumWarning);

  // Two label/value fields per row keeps the pane compact.
  for (let i = 0; i < ID_ROW_FIELDS.length; i += 2) {
    const row = el("div", "field-row");
    for (const { key, label, hint } of ID_ROW_FIELDS.slice(i, i + 2)) {
      row.append(field(label, profileInput(key, hint)));
    }
    detailEl.append(row);
  }

  const notesInput = el("textarea");
  notesInput.value = profile.notes ?? "";
  notesInput.rows = 2;
  notesInput.placeholder =
    "Clerk's remarks — “scar over the left eye”, “dues unpaid since spring”…";
  notesInput.oninput = () => {
    const value = notesInput.value.trim();
    if (value) profile.notes = notesInput.value;
    else delete profile.notes;
    markDirty();
    refreshPreview();
  };
  detailEl.append(field("Notes (optional)", notesInput));

  refreshPreview();
  detailEl.append(wrap);
}


function buildDocumentSyntaxGuide(
  contentInput: HTMLTextAreaElement,
  isNewspaper: boolean,
): HTMLElement {
  const details = el("details", "doc-syntax-guide");
  if (isNewspaper) {
    details.setAttribute("open", "");
  }

  const summary = el("summary", "doc-syntax-summary");
  const titleSpan = el("span", "doc-syntax-title");
  titleSpan.innerHTML = `<span>📝</span> <span>${
    isNewspaper ? "Newspaper Tropes & Markdown Guide" : "Formatting & Markdown Guide"
  }</span>`;
  const badge = el("span", "doc-syntax-badge");
  badge.textContent = isNewspaper ? "Newspaper Tropes Active" : "Markdown Enabled";
  summary.append(titleSpan, badge);
  details.append(summary);

  const body = el("div", "doc-syntax-body");

  // Quick-insert toolbar
  const toolbar = el("div", "doc-syntax-toolbar");
  const toolbarLabel = el("span", "doc-syntax-toolbar-label");
  toolbarLabel.textContent = "Quick Insert:";
  toolbar.append(toolbarLabel);

  const insertSnippet = (prefix: string, suffix = "", defaultText = "") => {
    const start = contentInput.selectionStart ?? contentInput.value.length;
    const end = contentInput.selectionEnd ?? contentInput.value.length;
    const current = contentInput.value;
    const selected = current.substring(start, end);
    const middle = selected || defaultText;
    const replacement = `${prefix}${middle}${suffix}`;
    contentInput.value = current.substring(0, start) + replacement + current.substring(end);
    contentInput.focus();
    contentInput.selectionStart = start + prefix.length;
    contentInput.selectionEnd = start + prefix.length + middle.length;
    contentInput.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const createChip = (label: string, title: string, onClick: () => void) => {
    const chip = el("button", "doc-syntax-chip");
    chip.type = "button";
    chip.textContent = label;
    chip.title = title;
    chip.onclick = (e) => {
      e.preventDefault();
      onClick();
    };
    return chip;
  };

  if (isNewspaper) {
    toolbar.append(
      createChip('> Quote', 'Insert In-Column Pull-Quote', () =>
        insertSnippet('\n> "', '" — Speaker Name\n', 'Important quote from an official or witness')
      ),
      createChip('>> Banner', 'Insert Breakout Banner Pull-Quote across columns', () =>
        insertSnippet('\n>> "', '" — Speaker Name\n', 'BREAKOUT HEADLINE QUOTE')
      ),
      createChip('! Alert', 'Insert Highlight Callout Bar', () =>
        insertSnippet('\n! ALERT: ', '\n', 'Crucial bulletin or breaking warning for citizens')
      ),
      createChip('### Subhead', 'Insert Section Crosshead Divider', () =>
        insertSnippet('\n### ', '\n', 'SECTION SUBHEADING')
      ),
      createChip('City —', 'Insert City Dateline Lead', () =>
        insertSnippet('WATERDEEP, Ches 14 — ', '', 'Early this morning...')
      ),
      createChip('==Mark==', 'Highlight text with printed ink', () =>
        insertSnippet('==', '==', 'highlighted text')
      ),
      createChip('**Bold**', 'Bold text', () =>
        insertSnippet('**', '**', 'bold text')
      ),
      createChip('*Italic*', 'Italic text', () =>
        insertSnippet('*', '*', 'italic text')
      ),
      createChip('--- Page', 'Start a new newspaper page with new layout', () =>
        insertSnippet('\n\n---\n\n', '', '# NEXT STORY HEADLINE')
      ),
    );
  } else {
    toolbar.append(
      createChip('**Bold**', 'Bold text', () =>
        insertSnippet('**', '**', 'bold text')
      ),
      createChip('*Italic*', 'Italic text', () =>
        insertSnippet('*', '*', 'italic text')
      ),
      createChip('~~Strike~~', 'Strikethrough', () =>
        insertSnippet('~~', '~~', 'strikethrough')
      ),
      createChip('==Mark==', 'Highlight text', () =>
        insertSnippet('==', '==', 'highlighted text')
      ),
      createChip('# Heading', 'Heading 1', () =>
        insertSnippet('\n# ', '\n', 'Heading')
      ),
      createChip('## Subhead', 'Heading 2', () =>
        insertSnippet('\n## ', '\n', 'Subheading')
      ),
      createChip('> Quote', 'Blockquote', () =>
        insertSnippet('\n> ', '\n', 'Quote text')
      ),
      createChip('- List', 'Bullet list item', () =>
        insertSnippet('\n- ', '\n', 'List item')
      ),
      createChip('--- Page', 'Start a new page', () =>
        insertSnippet('\n\n---\n\n', '', '')
      ),
      createChip('🎲 Dice', 'Interactive rollable dice tag', () =>
        insertSnippet('{@dice ', '}', '1d20+5')
      ),
    );
  }

  body.append(toolbar);

  // Cheat sheet table
  const table = el("div", "doc-syntax-grid");
  const addRow = (syntax: string, meaning: string, example: string) => {
    const row = el("div", "doc-syntax-row");
    const synEl = el("code", "doc-syntax-code");
    synEl.textContent = syntax;
    const descEl = el("span", "doc-syntax-desc");
    descEl.textContent = meaning;
    const exEl = el("span", "doc-syntax-example");
    exEl.textContent = example;
    row.append(synEl, descEl, exEl);
    table.append(row);
  };

  if (isNewspaper) {
    addRow('# Headline', 'Front-page main article headline', '# MIDNIGHT HEIST');
    addRow('## Subhead', 'Italic story dek / subtitle', '## Watch suspects guild');
    addRow('CITY, Date —', 'Opening story dateline (bold small-caps)', 'WATERDEEP, Ches 14 — ...');
    addRow('> "Quote" — Author', 'In-column pull-quote (enlarged, double-ruled)', '> "The wards held." — Vajra');
    addRow('>> "Banner" — Author', 'Breakout pull-quote across both columns', '>> "A SHADOW HAS FALLEN"');
    addRow('! ALERT: Callout', 'Highlighted callout bar with ink border & badge', '! ALERT: Gates closed');
    addRow('### Crosshead', 'Centered in-column section divider', '### NEW WITNESSES');
    addRow('==text==', 'Printed yellow ink marker highlighting', '==ancient sorcery==');
    addRow('*Note / Bulletin*', 'Framed public notice / reward inquiry box', '*Report to the Watch.*');
    addRow('---', 'Manual page break (long articles also auto-paginate)', '---');
    addRow('![Caption|filter](url)', 'Illustration with halftone / engraving / sepia', '![Dragon|engraving](https://...)');
    addRow('![Caption|page](url)', 'Picture spanning one page, at this point in the story', '![City panorama|page|engraving](https://...)');
    addRow('![Caption|column](url)', 'Picture kept inside its reading column', '![Witness|column](https://...)');
  } else {
    addRow('# Heading', 'Large document header', '# Chapter I');
    addRow('## Subheading', 'Section header', '## The Journey');
    addRow('**text**', 'Bold text', '**secret message**');
    addRow('*text*', 'Italic / cursive text', '*whispered words*');
    addRow('~~text~~', 'Strikethrough text', '~~crossed out~~');
    addRow('==text==', 'Highlighted text', '==vital clue==');
    addRow('> text', 'Indented quote / excerpt', '> A hero never yields.');
    addRow('- item', 'Bullet list', '- 3 torches');
    addRow('1. item', 'Numbered list', '1. First step');
    addRow('---', 'Page break (in Pages mode) or divider line', '---');
    addRow('{@dice 1d20+3}', 'Interactive rollable dice tag', '{@dice 2d6+4 fire}');
    addRow('[Link](url)', 'Clickable player hyperlink', '[Map](https://...)');
  }

  body.append(table);
  details.append(body);
  return details;
}

function renderDocumentDetail(item: LootItem): void {
  const doc = item.document!;

  const tabs = el("div", "tabs");
  const writeTab = el("button", "btn tab");
  writeTab.textContent = "Write";
  const styleTab = el("button", "btn tab");
  styleTab.textContent = "Style";
  (detailTab === "write" ? writeTab : styleTab).classList.add("active");
  writeTab.onclick = () => {
    detailTab = "write";
    renderDetail();
  };
  styleTab.onclick = () => {
    detailTab = "style";
    renderDetail();
  };
  tabs.append(writeTab, styleTab);
  detailEl.append(tabs);

  if (detailTab === "style") {
    renderStyleTab(item, doc);
    return;
  }

  const nameInput = el("input");
  nameInput.value = item.name;
  nameInput.oninput = () => {
    item.name = nameInput.value;
    markDirty();
    renderList();
  };

  const isNewspaper = doc.style === "newspaper";

  detailEl.append(field(isNewspaper ? "Item name (inventory only)" : "Name", nameInput));
  if (isNewspaper) {
    detailEl.append(createNewspaperHeaderFields(doc, markDirty));
  } else {
    const titleInput = el("input");
    titleInput.value = doc.title;
    titleInput.placeholder = "Written on the paper; leave empty for none.";
    titleInput.oninput = () => {
      doc.title = titleInput.value;
      markDirty();
    };
    detailEl.append(field("Title (optional)", titleInput));
  }

  detailEl.append(commonFields(item));

  if (isNewspaper) {
    detailEl.append(createNewspaperImageManager(doc, markDirty));
  }

  const contentInput = el("textarea");
  contentInput.value = doc.content;
  contentInput.maxLength = MAX_DOC_CHARS;
  contentInput.rows = 12;
  contentInput.placeholder = isNewspaper
    ? "Write the newspaper story here.\n\n" +
      "Authentic newspaper tropes & syntax:\n" +
      "# Story headline (used when the headline field is blank)\n" +
      "## Story subheading (used when the subheading field is blank)\n" +
      "CITY, Date — Starts the lead story with an authentic dateline\n" +
      "> \"Pull-quote from an official\" — Speaker Name\n" +
      ">> \"BANNER PULL QUOTE\" — Emphasized quote within the story\n" +
      "! ALERT: Highlight callout bar in the middle of the text\n" +
      "### Section Crosshead (centered uppercase story divider)\n" +
      "==highlighted printed text== inside paragraphs\n" +
      "*Notice or inquiry text*\n" +
      "--- Starts a new page\n" +
      "![Caption|halftone](https://...) inline markdown illustration"
    : "Write the letter, page or diary entry here.\n\n" +
      "Blank lines start a new paragraph.\n" +
      "A line with only --- starts a new page.\n" +
      "*A paragraph in asterisks* becomes an editor's note " +
      "(not in the document's handwriting).";

  const counter = el("div", "char-counter");
  const updateCounter = () => {
    counter.textContent = `${doc.content.length} / ${MAX_DOC_CHARS}`;
  };
  contentInput.oninput = () => {
    doc.content = contentInput.value;
    updateCounter();
    markDirty();
  };
  const syntaxGuide = buildDocumentSyntaxGuide(contentInput, isNewspaper);
  detailEl.append(syntaxGuide, field("Content", contentInput), counter);
}

/** Style tab: paper style / condition / font pickers over a live preview. */
function renderStyleTab(item: LootItem, doc: LootDocument): void {
  const styleSelect = el("select");
  for (const style of DOC_STYLES) {
    const option = el("option");
    option.value = style;
    option.textContent = DOC_STYLE_META[style].label;
    option.selected = style === doc.style;
    styleSelect.append(option);
  }
  styleSelect.onchange = () => {
    const previousDefaultIcon = DOC_STYLE_META[doc.style].icon;
    const previousDefaultFont = STYLE_DEFAULT_FONT[doc.style];
    doc.style = styleSelect.value as typeof doc.style;
    if (item.icon === previousDefaultIcon) {
      item.icon = DOC_STYLE_META[doc.style].icon;
    }
    // Follow the new style's default font unless the DM picked one manually.
    if ((doc.font ?? previousDefaultFont) === previousDefaultFont) {
      doc.font = STYLE_DEFAULT_FONT[doc.style];
    }
    markDirty();
    renderList();
    renderDetail();
  };

  const textureSelect = el("select");
  for (const texture of PAPER_TEXTURES) {
    const option = el("option");
    option.value = texture;
    option.textContent = PAPER_TEXTURE_META[texture].label;
    option.selected = texture === (doc.texture ?? "aged");
    textureSelect.append(option);
  }
  textureSelect.onchange = () => {
    doc.texture = textureSelect.value as (typeof PAPER_TEXTURES)[number];
    markDirty();
    renderDetail();
  };

  const layoutSelect = el("select");
  const currentLayout = doc.layout ?? defaultLayout(doc.style);
  for (const layout of DOC_LAYOUTS) {
    const option = el("option");
    option.value = layout;
    option.textContent = DOC_LAYOUT_META[layout].label;
    option.selected = layout === currentLayout;
    layoutSelect.append(option);
  }
  layoutSelect.title =
    "Paged: fixed pages to flip through (a --- line in the content forces a " +
    "page break). Continuous: one long sheet.";
  layoutSelect.onchange = () => {
    doc.layout = layoutSelect.value as (typeof DOC_LAYOUTS)[number];
    markDirty();
    renderDetail();
  };

  const fontSelect = el("select", "font-select");
  const currentFont = doc.font ?? STYLE_DEFAULT_FONT[doc.style];
  for (const font of DOC_FONTS) {
    const meta = DOC_FONT_META[font];
    const option = el("option");
    option.value = font;
    option.textContent = meta.label;
    option.style.fontFamily = meta.family;
    option.style.fontSize = `${Math.round(meta.adjust * 15)}px`;
    option.selected = font === currentFont;
    fontSelect.append(option);
  }
  fontSelect.style.fontFamily = DOC_FONT_META[currentFont].family;
  fontSelect.onchange = () => {
    doc.font = fontSelect.value as (typeof DOC_FONTS)[number];
    markDirty();
    renderDetail();
  };

  const row = el("div", "field-row");
  row.append(
    field("Style", styleSelect),
    field("Paper", textureSelect),
    field("Layout", layoutSelect),
  );

  if (doc.style === "newspaper") {
    const filterSelect = el("select");
    for (const filter of NEWSPAPER_PRINT_FILTERS) {
      const option = el("option");
      option.value = filter;
      option.textContent = NEWSPAPER_PRINT_FILTER_META[filter].label;
      option.title = NEWSPAPER_PRINT_FILTER_META[filter].description;
      option.selected = filter === (doc.newspaperFilter ?? "halftone");
      filterSelect.append(option);
    }
    filterSelect.onchange = () => {
      doc.newspaperFilter = filterSelect.value as NewspaperPrintFilter;
      markDirty();
      renderDetail();
    };
    row.append(field("Print Ink Filter", filterSelect));

    const headerSelect = el("select");
    for (const headerStyle of NEWSPAPER_HEADER_STYLES) {
      const option = el("option");
      option.value = headerStyle;
      option.textContent = NEWSPAPER_HEADER_META[headerStyle].label;
      option.title = NEWSPAPER_HEADER_META[headerStyle].description;
      option.selected = headerStyle === (doc.newspaperHeader ?? "tabloid-splash");
      headerSelect.append(option);
    }
    headerSelect.onchange = () => {
      doc.newspaperHeader = headerSelect.value as NewspaperHeaderStyle;
      markDirty();
      renderDetail();
    };
    row.append(field("Print headline style", headerSelect));
  }

  row.append(field("Font", fontSelect));

  const wrap = el("div", "preview-wrap");
  const stage = el("div", "paper-stage");
  stage.style.setProperty("--zoom", "0.95");
  renderDocument(stage, doc);
  wrap.append(stage);
  detailEl.append(row);
  if (doc.style === "newspaper") {
    const headerHint = el("p", "hint newspaper-header-style-hint");
    headerHint.textContent = NEWSPAPER_HEADER_META[doc.newspaperHeader ?? "tabloid-splash"].description;
    detailEl.append(headerHint);
    detailEl.append(createNewspaperLayoutPicker(doc.newspaperLayout, (layout) => {
      doc.newspaperLayout = layout;
      markDirty();
      renderDetail();
    }));
  }
  detailEl.append(wrap);
}

// --- restore banner ----------------------------------------------------------

function maybeShowRestore(hadLoot: boolean): void {
  if (hadLoot) return;
  const backup = getBackup(OBR.room.id, tokenId);
  if (!backup) return;

  const banner = el("div", "restore-banner");
  const text = el("span");
  text.textContent = `This browser has loot saved for this token (${new Date(
    backup.savedAt,
  ).toLocaleString()}).`;
  const restore = el("button", "btn btn-gold");
  restore.textContent = "Restore";
  restore.onclick = () => {
    loot = structuredClone(backup.loot);
    selectedId = null;
    banner.remove();
    buildShell();
    renderList();
    renderDetail();
    markDirty();
  };
  banner.append(text, restore);
  const main = app.querySelector(".editor-main");
  main?.parentElement?.insertBefore(banner, main);
}

// Safety net: if the modal is torn down without going through the ✕ button
// (Escape, clicking the backdrop), save rather than silently lose work.
// Choosing "Close without saving" on ✕ clears `dirty` first, so an explicit
// discard is still respected.
window.addEventListener("pagehide", () => {
  if (dirty) void saveNow();
});

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    void saveNow();
  }
});

// --- init --------------------------------------------------------------------

OBR.onReady(async () => {
  setupWindowResizer({
    windowKey: "editor",
    type: "popover",
    popoverId: EDITOR_MODAL_ID,
    defaultWidth: 980,
    defaultHeight: 660,
    minWidth: 550,
    minHeight: 450,
    maxWidth: 1600,
    maxHeight: 1200,
    centered: true,
  });

  const token = await getToken(tokenId);
  if (!token) {
    app.innerHTML = "";
    const note = el("div", "empty-note");
    note.textContent = "This token no longer exists.";
    app.append(note);
    return;
  }
  const existing = getLoot(token);
  loot = existing
    ? structuredClone(existing)
    : createContainer(token.name || "Loot");
  buildShell();
  renderList();
  renderDetail();
  maybeShowRestore(existing !== undefined);
});
