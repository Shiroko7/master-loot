import OBR, { type Item, type Metadata, type Player } from "@owlbear-rodeo/sdk";
import "@fontsource/cinzel/600.css";
import "./styles/ui.css";
import { GROUPS_KEY, ORDER_KEY, VIEWING_KEY } from "./constants";
import {
  UNGROUPED_ID,
  groupContainers,
  newGroupName,
  readGroups,
  type ContainerGroup,
} from "./containerGroups";
import { newItemId, type LootContainer } from "./types";
import { describeViewing, readViewingStatus, samePlayerRoster } from "./viewPresenceState";
import {
  BADGE_CORNERS,
  centerAnchor,
  getBadgeCorner,
  getBadgeImageSetting,
  getLoot,
  openEditorModal,
  openInventoryModal,
  openLootLogModal,
  openLootPopover,
  resnapBadges,
  resolveBadgeImage,
  restyleBadges,
  saveLoot,
  setBadgeCorner,
  setBadgeImage,
  type BadgeCorner,
} from "./loot";
import { getSavedWindowSize, setupWindowResizer } from "./windowResizer";
import { confirmDialog } from "./confirmDialog";
import { LootLogService } from "./inventory/LootLogService";
import {
  ROOM_METADATA_BUDGET_BYTES,
  SCENE_LOOT_BUDGET_BYTES,
  downloadArchive,
  downloadContainers,
  downloadLootLog,
  formatBytes,
  itemArchiveEntry,
  measureRoom,
  measureScene,
  parseArchive,
  removeContainers,
  removeItems,
  restoreContainers,
  usageLevel,
  type ArchivedContainer,
  type ContainerUsage,
  type ItemUsage,
  type StorageWarning,
  type UsageLevel,
  storageWarning,
  CONTAINER_BUDGET_BYTES,
} from "./metadataArchive";

const app = document.getElementById("app")!;
let role: "GM" | "PLAYER" = "PLAYER";
let badgeCorner: BadgeCorner = "top-right";
/** Badge image as typed by the GM; "" means the built-in sack. */
let badgeImage = "";
let unsubscribeItems: (() => void) | undefined;
let unsubscribeMeta: (() => void) | undefined;

/** Display order of containers (token ids), synced through scene metadata. */
let containerOrder: string[] = [];
let draggingRow: HTMLDivElement | null = null;
/** Item updates that arrive mid-drag or mid-rename are held until it ends. */
let deferredItems: Item[] | null = null;

/** GM-only groups of containers, synced through scene metadata. */
let containerGroups: ContainerGroup[] = [];
/** Group whose name is being typed, and its input while it has focus. */
let renamingGroupId: string | null = null;
let renameInput: HTMLInputElement | null = null;
/** Collapsed group the dragged row is hovering; it lands there on drop. */
let dropSection: HTMLElement | null = null;

/** Which groups are folded away is this GM's own view, kept per browser. */
const COLLAPSED_KEY = "master-loot:collapsed-groups";
const collapsedGroups = readCollapsed();

function readCollapsed(): Set<string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]");
    return new Set(Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function setCollapsed(ids: string[], collapsed: boolean): void {
  for (const id of ids) {
    if (collapsed) collapsedGroups.add(id);
    else collapsedGroups.delete(id);
  }
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsedGroups]));
  } catch {
    // Convenience only.
  }
  render(lastItems);
}

/** "loot": the scene's containers (NPCs, chests…); "players": inventories. */
type ActionTab = "loot" | "players";
const TAB_KEY = "master-loot:action-tab";
let activeTab: ActionTab = readTab();
let lastItems: Item[] = [];
let lastSceneMeta: Metadata = {};
let lastRoomMeta: Metadata = {};
let myId = "";
let myName = "You";
let myConnectionId = "";
let myMetadata: Metadata = {};
let partyPlayers: Player[] = [];

function readTab(): ActionTab {
  try {
    return localStorage.getItem(TAB_KEY) === "players" ? "players" : "loot";
  } catch {
    return "loot";
  }
}

function setTab(tab: ActionTab): void {
  activeTab = tab;
  try {
    localStorage.setItem(TAB_KEY, tab);
  } catch {
    // Convenience only.
  }
  render(lastItems);
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  return node;
}

/**
 * Scene changes re-render only this container; the settings overlay lives
 * beside it in #app so an open panel (and half-typed input) survives them.
 */
const mainEl = el("div", "action-main");
app.append(mainEl);

function readOrder(metadata: Metadata): string[] {
  const raw = metadata[ORDER_KEY];
  return Array.isArray(raw)
    ? raw.filter((id): id is string => typeof id === "string")
    : [];
}

function rowIds(parent: Element): string[] {
  return [...parent.querySelectorAll<HTMLElement>(".container-row")]
    .map((row) => row.dataset.tokenId)
    .filter((id): id is string => id !== undefined);
}

/** After a drag: the rows' order and group membership as they now sit. */
async function saveLayout(body: HTMLElement): Promise<void> {
  containerOrder = rowIds(body);
  containerGroups = containerGroups.map((group) => {
    const section = [...body.querySelectorAll<HTMLElement>(".container-group")].find(
      (candidate) => candidate.dataset.groupId === group.id,
    );
    return section ? { ...group, tokens: rowIds(section) } : group;
  });
  try {
    await OBR.scene.setMetadata({ [ORDER_KEY]: containerOrder, [GROUPS_KEY]: containerGroups });
  } catch (error) {
    console.error("Master Loot: failed to save container order", error);
  }
}

async function saveGroups(groups: ContainerGroup[]): Promise<void> {
  containerGroups = groups;
  render(lastItems);
  try {
    await OBR.scene.setMetadata({ [GROUPS_KEY]: groups });
  } catch (error) {
    console.error("Master Loot: failed to save container groups", error);
  }
}

function addGroup(): void {
  const group = { id: newItemId(), name: newGroupName(containerGroups), tokens: [] };
  renamingGroupId = group.id;
  void saveGroups([...containerGroups, group]);
}

/** Renders held back while the GM was dragging or typing a group name. */
function flushDeferred(): void {
  const pending = deferredItems;
  deferredItems = null;
  if (pending) render(pending);
}

const CORNER_LABELS: Record<BadgeCorner, string> = {
  "top-right": "↗ Top right",
  "top-left": "↖ Top left",
  "bottom-right": "↘ Bottom right",
  "bottom-left": "↙ Bottom left",
};

// --- settings overlay -------------------------------------------------------

let settingsEl: HTMLElement | null = null;

function toggleSettings(): void {
  if (settingsEl) {
    settingsEl.remove();
    settingsEl = null;
    return;
  }
  settingsEl = buildSettings();
  app.append(settingsEl);
}

function settingsField(labelText: string, control: HTMLElement): HTMLElement {
  const label = el("label", "field");
  const caption = el("span");
  caption.textContent = labelText;
  label.append(caption, control);
  return label;
}

function buildSettings(): HTMLElement {
  const overlay = el("div", "settings-overlay");
  const panel = el("div", "panel");
  const header = el("div", "panel-header");
  const title = el("h1", "panel-title");
  title.textContent = "Settings";
  const close = el("button", "btn-icon");
  close.textContent = "✕";
  close.ariaLabel = "Close settings";
  close.onclick = toggleSettings;
  header.append(title, close);

  const body = el("div", "panel-body settings-body");

  const cornerSelect = el("select");
  for (const corner of BADGE_CORNERS) {
    const option = el("option");
    option.value = corner;
    option.textContent = CORNER_LABELS[corner];
    option.selected = corner === badgeCorner;
    cornerSelect.append(option);
  }
  cornerSelect.onchange = () => {
    badgeCorner = cornerSelect.value as BadgeCorner;
    cornerSelect.disabled = true;
    void (async () => {
      try {
        // Move the badges ourselves — don't rely on the background
        // window observing the room-metadata change event.
        await setBadgeCorner(badgeCorner);
        await resnapBadges(badgeCorner);
      } catch (error) {
        console.error("Master Loot: failed to move badges", error);
      } finally {
        cornerSelect.disabled = false;
      }
    })();
  };
  const cornerHint = el("div", "setting-hint");
  cornerHint.textContent =
    "Corner of the token where loot badges sit — moves every badge in the scene.";
  body.append(settingsField("Badge corner", cornerSelect), cornerHint);

  const urlInput = el("input");
  urlInput.value = badgeImage;
  urlInput.placeholder = "https://… or /my-badge.png";
  const apply = el("button", "btn btn-gold");
  apply.textContent = "Apply";
  const reset = el("button", "btn");
  reset.textContent = "Default";
  const status = el("div", "setting-status");

  const saveImage = async (value: string): Promise<void> => {
    apply.disabled = reset.disabled = true;
    status.textContent = "Applying…";
    try {
      await setBadgeImage(value);
      badgeImage = value.trim();
      await restyleBadges(resolveBadgeImage(value));
      status.textContent = "Badges updated ✓";
    } catch (error) {
      console.error("Master Loot: failed to change badge image", error);
      status.textContent = "Failed to update badges.";
    } finally {
      apply.disabled = reset.disabled = false;
    }
  };
  apply.onclick = () => void saveImage(urlInput.value);
  reset.onclick = () => {
    urlInput.value = "";
    void saveImage("");
  };

  const urlRow = el("div", "setting-row");
  urlRow.append(urlInput, apply, reset);
  const urlHint = el("div", "setting-hint");
  urlHint.textContent =
    "Any image URL, or a file you drop in the extension's public folder " +
    "(e.g. /my-badge.png). Square images look best. Changes every badge, " +
    "current and future; empty means the built-in sack.";
  body.append(settingsField("Badge image", urlRow), urlHint, status);

  panel.append(header, body);
  overlay.append(panel);
  return overlay;
}

// --- storage overlay ----------------------------------------------------------

type StorageView = "containers" | "items";
type StorageSort = "size" | "date" | "name";

let storageEl: HTMLElement | null = null;
/** Survives re-renders so a result message isn't wiped by the next scene event. */
let storageStatus = "";
let storageView: StorageView = "containers";
let storageSort: StorageSort = "size";

const LEVEL_TEXT: Record<UsageLevel, string> = {
  ok: "",
  warn: "Getting full — consider archiving some loot.",
  over: "Over budget — archive some loot to free space.",
};

function toggleStorage(): void {
  if (storageEl) {
    storageEl.remove();
    storageEl = null;
    return;
  }
  storageStatus = "";
  storageEl = el("div", "settings-overlay");
  app.append(storageEl);
  void renderStorage();
}

function setStorageStatus(text: string): void {
  storageStatus = text;
  void renderStorage();
}

function meterEl(parts: { bytes: number; cls: string; label: string }[], budget: number): HTMLElement {
  const meter = el("div", "storage-meter");
  for (const part of parts) {
    const segment = el("div", `storage-segment ${part.cls}`);
    segment.style.width = `${Math.min(100, (part.bytes / budget) * 100)}%`;
    segment.title = `${part.label}: ${formatBytes(part.bytes)}`;
    meter.append(segment);
  }
  return meter;
}

function levelHint(text: string, level: UsageLevel): HTMLElement {
  const hint = el("div", `setting-hint storage-level-${level}`);
  hint.textContent = level === "ok" ? text : `${text} ${LEVEL_TEXT[level]}`;
  return hint;
}

function formatDate(time: number | undefined): string {
  return time ? new Date(time).toLocaleDateString() : "—";
}

function sortBy<T>(list: T[], key: (entry: T) => { bytes: number; date: number; name: string }): T[] {
  return [...list].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (storageSort === "size") return kb.bytes - ka.bytes;
    // Oldest first: those are the likeliest to be done with.
    if (storageSort === "date") return ka.date - kb.date;
    return ka.name.localeCompare(kb.name);
  });
}

async function renderStorage(): Promise<void> {
  const overlay = storageEl;
  if (!overlay) return;
  const ready = await OBR.scene.isReady();
  const [roomMeta, items, sceneMeta] = await Promise.all([
    OBR.room.getMetadata(),
    ready ? OBR.scene.items.getItems() : Promise.resolve([] as Item[]),
    ready ? OBR.scene.getMetadata() : Promise.resolve({} as Metadata),
  ]);
  if (overlay !== storageEl) return;
  const room = measureRoom(roomMeta);
  const scene = measureScene(items, sceneMeta);

  const panel = el("div", "panel");
  const header = el("div", "panel-header");
  const title = el("h1", "panel-title");
  title.textContent = "Storage";
  const close = el("button", "btn-icon");
  close.textContent = "✕";
  close.ariaLabel = "Close storage";
  close.onclick = toggleStorage;
  header.append(title, close);
  const body = el("div", "panel-body settings-body");

  const intro = el("div", "setting-hint");
  intro.textContent =
    "Loot is stored on its tokens in Owlbear's shared scene data, synced to everyone — " +
    "not on each player's computer — and that space is limited.";
  body.append(intro);

  // Scene: loot containers live on their tokens' item metadata.
  const sceneHeading = el("div", "storage-heading");
  sceneHeading.textContent = "Loot in this scene";
  const sceneLevel = usageLevel(scene.total, SCENE_LOOT_BUDGET_BYTES);
  body.append(
    sceneHeading,
    meterEl([{ bytes: scene.total, cls: `seg-loot seg-${sceneLevel}`, label: "Loot" }], SCENE_LOOT_BUDGET_BYTES),
    levelHint(
      `${formatBytes(scene.total)} of ${formatBytes(SCENE_LOOT_BUDGET_BYTES)} used by ` +
        `${scene.containers.length} container${scene.containers.length === 1 ? "" : "s"}.`,
      sceneLevel,
    ),
  );

  const controls = el("div", "setting-row storage-controls");
  const viewSelect = el("select");
  for (const [value, label] of [["containers", "Containers"], ["items", "Items"]] as const) {
    const option = el("option");
    option.value = value;
    option.textContent = label;
    option.selected = storageView === value;
    viewSelect.append(option);
  }
  viewSelect.onchange = () => {
    storageView = viewSelect.value as StorageView;
    void renderStorage();
  };
  const sortSelect = el("select");
  for (const [value, label] of [["size", "Largest first"], ["date", "Oldest first"], ["name", "By name"]] as const) {
    const option = el("option");
    option.value = value;
    option.textContent = label;
    option.selected = storageSort === value;
    sortSelect.append(option);
  }
  sortSelect.onchange = () => {
    storageSort = sortSelect.value as StorageSort;
    void renderStorage();
  };
  controls.append(viewSelect, sortSelect);
  body.append(controls);

  const list = el("div", "storage-list");
  if (storageView === "containers") {
    const sorted = sortBy(scene.containers, (c) => ({
      bytes: c.bytes,
      date: c.loot.updatedAt,
      name: c.loot.name || c.tokenName,
    }));
    for (const container of sorted) list.append(containerStorageRow(container));
  } else {
    const byToken = new Map(scene.containers.map((c) => [c.tokenId, c]));
    const sorted = sortBy(scene.items, (i) => ({
      bytes: i.bytes,
      date: i.item.addedAt ?? 0,
      name: i.item.name,
    }));
    for (const usage of sorted) list.append(itemStorageRow(usage, byToken.get(usage.tokenId)!));
  }
  if (scene.containers.length === 0) {
    const note = el("div", "setting-hint");
    note.textContent = "No loot containers in this scene.";
    list.append(note);
  }
  body.append(list);

  const bulk = el("div", "setting-row");
  const downloadAll = el("button", "btn");
  downloadAll.textContent = "Download all";
  downloadAll.disabled = scene.containers.length === 0;
  downloadAll.onclick = () => {
    downloadContainers(scene.containers);
    setStorageStatus(`Downloaded ${scene.containers.length} containers.`);
  };
  const upload = el("button", "btn btn-gold");
  upload.textContent = "Upload archive…";
  const fileInput = el("input");
  fileInput.type = "file";
  fileInput.accept = ".json,application/json";
  fileInput.hidden = true;
  fileInput.onchange = () => {
    const file = fileInput.files?.[0];
    if (file) void uploadArchive(file, items);
  };
  upload.onclick = () => fileInput.click();
  bulk.append(downloadAll, upload, fileInput);
  const uploadHint = el("div", "setting-hint");
  uploadHint.textContent =
    "Uploads go back onto their original token. If it's gone, select another " +
    "token first (one container per file).";
  body.append(bulk, uploadHint);

  // Room metadata: the shared ~16 kB budget.
  const roomHeading = el("div", "storage-heading");
  roomHeading.textContent = "Room data (shared by all extensions)";
  const roomLevel = usageLevel(room.total, ROOM_METADATA_BUDGET_BYTES);
  body.append(
    roomHeading,
    meterEl(
      [
        { bytes: room.lootLog, cls: "seg-log", label: "Loot log" },
        { bytes: room.settings, cls: "seg-settings", label: "Master Loot settings" },
        { bytes: room.others, cls: "seg-others", label: "Other extensions" },
      ],
      ROOM_METADATA_BUDGET_BYTES,
    ),
    levelHint(
      `${formatBytes(room.total)} of ${formatBytes(ROOM_METADATA_BUDGET_BYTES)} used — ` +
        `loot log ${formatBytes(room.lootLog)}, settings ${formatBytes(room.settings)}, ` +
        `other extensions ${formatBytes(room.others)}.`,
      roomLevel,
    ),
  );

  const logRow = el("div", "setting-row");
  const logDownload = el("button", "btn");
  logDownload.textContent = "Download log";
  logDownload.onclick = () =>
    void downloadLootLog().then((count) => setStorageStatus(`Downloaded ${count} log entries.`));
  const logClear = el("button", "btn btn-danger");
  logClear.textContent = "Download & clear log";
  logClear.disabled = room.lootLog <= 32;
  logClear.onclick = () =>
    void (async () => {
      const ok = await confirmDialog({
        title: "Clear the loot log?",
        message: "The log is downloaded as a file first, then removed from the room for everyone.",
        confirmLabel: "Download & clear",
      });
      if (!ok) return;
      try {
        const count = await downloadLootLog();
        await LootLogService.clearLogs();
        setStorageStatus(`Saved and cleared ${count} log entries.`);
      } catch (error) {
        console.error("Master Loot: failed to clear the loot log", error);
        setStorageStatus("Could not clear the loot log.");
      }
    })();
  logRow.append(logDownload, logClear);

  const status = el("div", "setting-status");
  status.textContent = storageStatus;
  body.append(logRow, status);

  panel.append(header, body);
  overlay.replaceChildren(panel);
}

function storageRow(
  nameText: string,
  metaText: string,
  onDownload: () => void,
  archive: { title: string; message: string; run: () => Promise<string> },
): HTMLElement {
  const row = el("div", "container-row");
  const info = el("div", "info");
  const name = el("div", "name");
  name.textContent = nameText;
  const meta = el("div", "meta");
  meta.textContent = metaText;
  info.append(name, meta);

  const download = el("button", "btn");
  download.textContent = "⬇";
  download.title = "Download a copy (keeps it in the scene)";
  download.ariaLabel = download.title;
  download.onclick = onDownload;

  const remove = el("button", "btn btn-danger");
  remove.textContent = "Archive";
  remove.title = "Download, then remove it from the scene to free space";
  remove.onclick = () =>
    void (async () => {
      const ok = await confirmDialog({
        title: archive.title,
        message: archive.message,
        confirmLabel: "Download & remove",
      });
      if (!ok) return;
      try {
        setStorageStatus(await archive.run());
      } catch (error) {
        console.error("Master Loot: failed to archive", error);
        setStorageStatus("Could not remove it from the scene.");
      }
    })();

  row.append(info, download, remove);
  return row;
}

function containerStorageRow(container: ContainerUsage): HTMLElement {
  const label = container.loot.name || container.tokenName;
  const count = container.loot.items.length;
  const level = usageLevel(container.bytes, CONTAINER_BUDGET_BYTES);
  const row = storageRow(
    label,
    `${formatBytes(container.bytes)} · ${count} item${count === 1 ? "" : "s"} · ` +
      `edited ${formatDate(container.loot.updatedAt)}` +
      (level === "ok" ? "" : level === "warn" ? " · large" : " · too large"),
    () => downloadContainers([container]),
    {
      title: `Archive “${label}”?`,
      message:
        "The whole container is downloaded as a file, then removed from its token " +
        "(players lose access). Upload the file later to restore it.",
      run: async () => {
        downloadContainers([container]);
        await removeContainers([container.tokenId]);
        return `Archived “${label}” — freed ${formatBytes(container.bytes)}.`;
      },
    },
  );
  row.classList.add(`storage-level-${level}`);
  return row;
}

function itemStorageRow(usage: ItemUsage, container: ContainerUsage): HTMLElement {
  const label = usage.item.name || "Untitled";
  const entry = itemArchiveEntry(usage, container);
  const fileLabel = `${usage.containerName}-${label}`;
  return storageRow(
    `${usage.item.icon} ${label}`,
    `${formatBytes(usage.bytes)} · in ${usage.containerName} · added ${formatDate(usage.item.addedAt)}`,
    () => downloadArchive([entry], fileLabel),
    {
      title: `Archive “${label}”?`,
      message:
        `The item is downloaded as a file, then removed from “${usage.containerName}”. ` +
        "Upload the file later to put it back.",
      run: async () => {
        downloadArchive([entry], fileLabel);
        await removeItems(usage.tokenId, [usage.item.id]);
        return `Archived “${label}” — freed ${formatBytes(usage.bytes)}.`;
      },
    },
  );
}

/**
 * Puts archived loot back: onto its original token when it is in this
 * scene, otherwise (single-container archives) onto the selected token.
 */
async function uploadArchive(file: File, items: Item[]): Promise<void> {
  let archived: ArchivedContainer[];
  try {
    archived = parseArchive(await file.text());
  } catch (error) {
    setStorageStatus((error as Error).message);
    return;
  }
  const byId = new Map(items.map((item) => [item.id, item]));
  const selection = (await OBR.player.getSelection()) ?? [];
  const fallback = archived.length === 1 && selection.length === 1 ? selection[0] : undefined;
  const targets = new Map<string, ArchivedContainer>();
  let missing = 0;
  for (const entry of archived) {
    const tokenId = byId.has(entry.tokenId) ? entry.tokenId : fallback;
    if (!tokenId || !byId.has(tokenId)) {
      missing += 1;
      continue;
    }
    const existing = targets.get(tokenId);
    targets.set(
      tokenId,
      existing?.partial && entry.partial
        ? { ...existing, loot: { ...existing.loot, items: [...existing.loot.items, ...entry.loot.items] } }
        : entry,
    );
  }

  const overwrites = [...targets].filter(
    ([id, entry]) => !entry.partial && getLoot(byId.get(id)!),
  ).length;
  if (overwrites > 0) {
    const ok = await confirmDialog({
      title: "Replace existing loot?",
      message: `${overwrites} token${overwrites === 1 ? " already has" : "s already have"} loot. Restoring the archived container replaces it.`,
      confirmLabel: "Replace",
    });
    if (!ok) return;
  }

  try {
    await restoreContainers(targets);
  } catch (error) {
    console.error("Master Loot: failed to restore archive", error);
    setStorageStatus("Could not write the loot back — the scene may be out of space.");
    return;
  }
  const parts = [`Restored ${targets.size} upload${targets.size === 1 ? "" : "s"}.`];
  if (missing > 0) {
    parts.push(
      `${missing} skipped: token not in this scene` +
        (archived.length === 1 ? " — select a token and upload again." : "."),
    );
  }
  setStorageStatus(parts.join(" "));
}

function currentWarning(): StorageWarning {
  return storageWarning(measureRoom(lastRoomMeta), measureScene(lastItems, lastSceneMeta));
}

function shell(): { panel: HTMLElement; body: HTMLElement } {
  mainEl.innerHTML = "";
  const panel = el("div", "panel");
  const header = el("div", "panel-header");
  const title = el("h1", "panel-title");
  title.textContent = "Master Loot";
  header.append(title);

  const actions = el("div", "header-actions");

  const invBtn = el("button", "btn-icon");
  invBtn.textContent = "🎒";
  invBtn.title = "Personal Inventory";
  invBtn.ariaLabel = "Personal Inventory";
  invBtn.onclick = () => void openInventoryModal();

  const logBtn = el("button", "btn-icon");
  logBtn.textContent = "📜";
  logBtn.title = "Loot Activity Log";
  logBtn.ariaLabel = "Loot Activity Log";
  logBtn.onclick = () => void openLootLogModal();
  actions.append(invBtn, logBtn);

  if (role === "GM") {
    const gear = el("button", "btn-icon");
    gear.textContent = "⚙";
    gear.title = "Master Loot settings";
    gear.ariaLabel = "Master Loot settings";
    gear.onclick = toggleSettings;
    const warning = currentWarning();
    const level = warning.level;
    const disk = el("button", "btn-icon");
    disk.textContent = level === "ok" ? "💾" : "⚠";
    disk.classList.toggle("storage-alert", level !== "ok");
    disk.title = level === "ok" ? "Storage — free up space" : `Storage: ${warning.subject} — ${LEVEL_TEXT[level]}`;
    disk.ariaLabel = disk.title;
    disk.onclick = toggleStorage;
    actions.append(disk, gear);
  }
  header.append(actions);

  const body = el("div", "panel-body");
  panel.append(header, body);
  mainEl.append(panel);
  return { panel, body };
}

function renderNoScene(): void {
  const { body } = shell();
  const note = el("div", "empty-note");
  note.textContent = "Open a scene to use Master Loot.";
  body.append(note);
}

function buildTabs(): HTMLElement {
  const tabs = el("div", "tabs action-tabs");
  const tab = (id: ActionTab, label: string) => {
    const btn = el("button", "btn tab");
    btn.textContent = label;
    btn.classList.toggle("active", activeTab === id);
    btn.onclick = () => setTab(id);
    return btn;
  };
  tabs.append(tab("loot", "💰 Loot"), tab("players", "🎒 Players"));
  return tabs;
}

/** Everyone in the room, you first, each opening their inventory. */
function renderPlayers(panel: HTMLElement, body: HTMLElement): void {
  const everyone = [
    { id: myId, connectionId: myConnectionId, name: `${myName} (you)`, role, color: "" },
    ...[...partyPlayers]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => ({ id: p.id, connectionId: p.connectionId, name: p.name, role: p.role, color: p.color })),
  ];
  for (const player of everyone) {
    const row = el("div", "container-row");
    row.dataset.playerConnectionId = player.connectionId;
    const dot = el("span", "player-dot");
    if (player.color) dot.style.background = player.color;
    const info = el("div", "info");
    const name = el("div", "name");
    name.textContent = player.name;
    const meta = el("div", "meta");
    meta.textContent = player.role === "GM" ? "Game master" : "Player";
    info.append(name, meta);
    const viewing = el("div", "player-viewing");
    const progress = el("div", "player-reading-progress");
    info.append(viewing, progress);
    const open = el("button", "btn");
    open.textContent = "Inventory";
    open.onclick = () => void openInventoryModal(player.id === myId ? undefined : player.id);
    row.append(dot, info, open);
    body.append(row);
  }
  if (partyPlayers.length === 0) {
    const note = el("div", "empty-note");
    note.textContent = "Nobody else is in the room right now.";
    body.append(note);
  }
  const footer = el("div", "panel-footer");
  footer.textContent = "Viewing status is live. Reaching the last page doesn't confirm reading is complete.";
  panel.append(footer);
  updatePlayerViewing();
}

function updatePlayerViewing(): void {
  for (const row of mainEl.querySelectorAll<HTMLElement>("[data-player-connection-id]")) {
    const connection = row.dataset.playerConnectionId;
    const metadata = connection === myConnectionId ? myMetadata :
      partyPlayers.find((player) => player.connectionId === connection)?.metadata;
    const status = readViewingStatus(metadata?.[VIEWING_KEY]);
    const { summary, progress } = describeViewing(status);
    const viewing = row.querySelector<HTMLElement>(".player-viewing")!;
    viewing.textContent = summary;
    viewing.classList.toggle("is-viewing", !!status);
    const progressEl = row.querySelector<HTMLElement>(".player-reading-progress")!;
    progressEl.textContent = progress;
    progressEl.hidden = !progress;
  }
}

async function toggleTakeLock(tokenId: string, takeable: boolean): Promise<void> {
  const token = lastItems.find((item) => item.id === tokenId);
  const loot = token ? getLoot(token) : undefined;
  if (!loot) return;
  await saveLoot(tokenId, { ...structuredClone(loot), takeable });
}

/** "+ Group" and, once there are groups, fold or unfold all of them. */
function buildGroupToolbar(sectionIds: string[]): HTMLElement {
  const bar = el("div", "group-toolbar");
  const add = el("button", "add-folder-link");
  add.type = "button";
  add.textContent = "📁 + Group";
  add.title = "Add a group to file containers under; drag them onto it";
  add.onclick = addGroup;
  bar.append(add);
  if (sectionIds.length > 0) {
    const allCollapsed = sectionIds.every((id) => collapsedGroups.has(id));
    const fold = el("button", "add-folder-link");
    fold.type = "button";
    fold.textContent = allCollapsed ? "▾ Expand all" : "▸ Collapse all";
    fold.onclick = () => setCollapsed(sectionIds, !allCollapsed);
    bar.append(fold);
  }
  return bar;
}

/**
 * Heading of a section: click folds it. `group` is absent for the
 * "Ungrouped" section, which cannot be renamed or dissolved.
 */
function buildGroupHead(
  id: string,
  label: string,
  count: number,
  group?: ContainerGroup,
): HTMLElement {
  const head = el("div", "folder-head");
  const chevron = el("span", "chev");
  chevron.textContent = collapsedGroups.has(id) ? "▸" : "▾";
  head.append(chevron);

  if (group && renamingGroupId === id) {
    const input = el("input", "folder-rename");
    input.value = label;
    input.maxLength = 60;
    let done = false;
    const finish = (commit: boolean) => {
      if (done) return;
      done = true;
      renamingGroupId = null;
      renameInput = null;
      const name = input.value.trim();
      if (commit && name && name !== group.name) {
        deferredItems = null;
        void saveGroups(containerGroups.map((g) => (g.id === id ? { ...g, name } : g)));
      } else {
        deferredItems ??= lastItems;
        flushDeferred();
      }
    };
    input.onclick = (event) => event.stopPropagation();
    input.onkeydown = (event) => {
      if (event.key === "Enter") finish(true);
      if (event.key === "Escape") finish(false);
    };
    input.onblur = () => finish(true);
    head.append(input);
    renameInput = input;
    queueMicrotask(() => {
      input.focus();
      input.select();
    });
    return head;
  }

  const name = el("span", "folder-label");
  name.textContent = label;
  const countEl = el("span", "folder-count");
  countEl.textContent = String(count);
  head.append(name, countEl);
  if (group) {
    const startRename = (event: Event) => {
      event.stopPropagation();
      renamingGroupId = id;
      render(lastItems);
    };
    name.ondblclick = startRename;
    const rename = el("button", "mini");
    rename.textContent = "✎";
    rename.title = "Rename group";
    rename.onclick = startRename;
    const dissolve = el("button", "mini");
    dissolve.textContent = "✕";
    dissolve.title = "Dissolve group (its containers are kept)";
    dissolve.onclick = (event) => {
      event.stopPropagation();
      void saveGroups(containerGroups.filter((g) => g.id !== id));
    };
    head.append(rename, dissolve);
  }
  head.onclick = () => setCollapsed([id], !collapsedGroups.has(id));
  return head;
}

function buildContainerRow(item: Item, loot: LootContainer, body: HTMLElement): HTMLElement {
  const row = el("div", "container-row");
  row.dataset.tokenId = item.id;
  if (!loot.enabled) row.classList.add("disabled");

  if (role === "GM") {
    const grip = el("span", "drag-handle");
    grip.textContent = "⠿";
    grip.title = "Drag to reorder";
    // Only grabs that start on the handle may drag the row, so the
    // buttons and text stay clickable/selectable.
    grip.onpointerdown = () => {
      row.draggable = true;
      window.addEventListener(
        "pointerup",
        () => {
          row.draggable = false;
        },
        { once: true },
      );
    };
    row.append(grip);

    row.ondragstart = (event) => {
      draggingRow = row;
      row.classList.add("dragging");
      event.dataTransfer?.setData("text/plain", item.id);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    };
    row.ondragend = () => {
      row.classList.remove("dragging");
      row.draggable = false;
      draggingRow = null;
      dropSection?.querySelector(".folder-head")?.classList.remove("drag-over");
      dropSection = null;
      // Render even with nothing held back: counts and collapsed groups
      // only catch up with the moved row on a fresh render.
      deferredItems ??= lastItems;
      void saveLayout(body);
      flushDeferred();
    };
  }

  const icon = el("span");
  icon.textContent = loot.enabled ? "💰" : "🔒";

  const info = el("div", "info");
  const name = el("div", "name");
  name.textContent = loot.name || item.name;
  const meta = el("div", "meta");
  const count = loot.items.length;
  const takeable = loot.takeable !== false;
  meta.textContent =
    `${count} item${count === 1 ? "" : "s"}` +
    (role === "GM" && !loot.enabled
      ? " · hidden from players"
      : !takeable
        ? " · look only"
        : "");
  info.append(name, meta);

  row.append(icon, info);

  if (role === "GM") {
    const lock = el("button", "btn-icon take-lock");
    lock.textContent = takeable ? "🔓" : "🔒";
    lock.classList.toggle("locked", !takeable);
    lock.title = takeable
      ? "Players can take items — click to let them only look"
      : "Players can only look — click to let them take items";
    lock.ariaLabel = lock.title;
    lock.onclick = () => {
      lock.disabled = true;
      void toggleTakeLock(item.id, !takeable).catch((error) => {
        console.error("Master Loot: failed to change the take lock", error);
        lock.disabled = false;
      });
    };
    row.append(lock);
  }

  const open = el("button", "btn");
  open.textContent = "Open";
  open.onclick = () => {
    void (async () => {
      await openLootPopover(item.id, { position: await centerAnchor() });
    })();
  };
  row.append(open);

  if (role === "GM") {
    const edit = el("button", "btn btn-gold");
    edit.textContent = "Edit";
    edit.onclick = () => void openEditorModal(item.id);
    row.append(edit);
  }

  return row;
}


function render(items: Item[]): void {
  lastItems = items;
  void renderStorage();
  if (draggingRow || (renameInput?.isConnected && document.activeElement === renameInput)) {
    deferredItems = items;
    return;
  }
  const { panel, body } = shell();
  body.append(buildTabs());
  const warning = role === "GM" ? currentWarning() : undefined;
  if (warning && warning.level !== "ok") {
    const banner = el("div", `storage-banner storage-level-${warning.level}`);
    const text = el("span");
    text.textContent = `Storage: ${warning.subject}. ${LEVEL_TEXT[warning.level]}`;
    const open = el("button", "btn btn-gold");
    open.textContent = "Free up space";
    open.onclick = toggleStorage;
    banner.append(text, open);
    body.append(banner);
  }
  if (activeTab === "players") {
    renderPlayers(panel, body);
    return;
  }

  const containers = items
    .map((item) => ({ item, loot: getLoot(item) }))
    .filter((entry) => entry.loot !== undefined)
    .filter((entry) => role === "GM" || entry.loot!.enabled);

  const position = new Map(containerOrder.map((id, index) => [id, index]));
  const ordered = containers
    .map((entry, index) => ({
      entry,
      rank: position.get(entry.item.id) ?? containerOrder.length + index,
    }))
    .sort((a, b) => a.rank - b.rank)
    .map(({ entry }) => entry);

  if (ordered.length === 0) {
    const note = el("div", "empty-note");
    note.textContent =
      role === "GM"
        ? "No loot in this scene yet."
        : "Nothing lootable in sight…";
    body.append(note);
  }

  const byId = new Map(ordered.map((entry) => [entry.item.id, entry]));
  const rowFor = (id: string): HTMLElement => {
    const { item, loot } = byId.get(id)!;
    return buildContainerRow(item, loot!, body);
  };
  const ids = ordered.map((entry) => entry.item.id);

  if (role !== "GM") {
    // Groups are the GM's filing system; players get the plain list.
    body.append(...ids.map(rowFor));
  } else {
    const layout = groupContainers(ids, containerGroups);
    const hasGroups = layout.groups.length > 0;
    const sectionIds = [UNGROUPED_ID, ...layout.groups.map(({ group }) => group.id)];
    body.append(buildGroupToolbar(hasGroups ? sectionIds : []));

    const section = (id: string, tokens: string[], head?: HTMLElement): void => {
      const wrap = el("div", "container-group");
      wrap.dataset.groupId = id;
      const rows = el("div", "group-rows");
      rows.hidden = !!head && collapsedGroups.has(id);
      rows.append(...tokens.map(rowFor));
      if (head) wrap.append(head);
      wrap.append(rows);
      body.append(wrap);
    };
    // Without groups the list looks as it always did: no headings at all.
    section(
      UNGROUPED_ID,
      layout.ungrouped,
      hasGroups ? buildGroupHead(UNGROUPED_ID, "Ungrouped", layout.ungrouped.length) : undefined,
    );
    for (const { group, tokens } of layout.groups) {
      section(group.id, tokens, buildGroupHead(group.id, group.name, tokens.length, group));
    }

    const clearDropSection = () => {
      dropSection?.querySelector(".folder-head")?.classList.remove("drag-over");
      dropSection = null;
    };
    body.ondragover = (event) => {
      if (!draggingRow) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      clearDropSection();
      const sections = [...body.querySelectorAll<HTMLElement>(".container-group")];
      const last = sections[sections.length - 1];
      // The section under the pointer; below the whole list means the last.
      const target =
        (event.target as HTMLElement).closest<HTMLElement>(".container-group") ??
        (last && event.clientY > last.getBoundingClientRect().bottom ? last : undefined);
      const zone = target?.querySelector<HTMLElement>(".group-rows");
      if (!target || !zone) return;
      if (zone.hidden) {
        // A collapsed group takes the row when it is dropped on its heading.
        dropSection = target;
        target.querySelector(".folder-head")?.classList.add("drag-over");
        return;
      }
      const rows = [...zone.querySelectorAll<HTMLElement>(".container-row:not(.dragging)")];
      const next = rows.find((other) => {
        const rect = other.getBoundingClientRect();
        return event.clientY < rect.top + rect.height / 2;
      });
      if (next) zone.insertBefore(draggingRow, next);
      else zone.append(draggingRow);
    };
    body.ondrop = (event) => {
      event.preventDefault();
      if (draggingRow && dropSection) {
        dropSection.querySelector(".group-rows")?.append(draggingRow);
      }
      clearDropSection();
    };
  }

  const footer = el("div", "panel-footer");
  footer.textContent =
    role === "GM"
      ? "Right-click a token and choose “Loot” to fill and enable it."
      : "Click a glowing coin bag on the map to open its loot.";
  panel.append(footer);
}

async function refresh(ready: boolean): Promise<void> {
  unsubscribeItems?.();
  unsubscribeItems = undefined;
  unsubscribeMeta?.();
  unsubscribeMeta = undefined;
  if (ready) {
    lastSceneMeta = await OBR.scene.getMetadata();
    containerOrder = readOrder(lastSceneMeta);
    containerGroups = readGroups(lastSceneMeta[GROUPS_KEY]);
    render(await OBR.scene.items.getItems());
    unsubscribeItems = OBR.scene.items.onChange(render);
    unsubscribeMeta = OBR.scene.onMetadataChange((metadata) => {
      lastSceneMeta = metadata;
      containerOrder = readOrder(metadata);
      containerGroups = readGroups(metadata[GROUPS_KEY]);
      void OBR.scene.items.getItems().then(render);
    });
  } else {
    renderNoScene();
  }
}

OBR.onReady(async () => {
  const savedSize = getSavedWindowSize("action", { width: 340, height: 460 });
  if (savedSize.width !== 340 || savedSize.height !== 460) {
    void OBR.action.setWidth(savedSize.width);
    void OBR.action.setHeight(savedSize.height);
  }
  setupWindowResizer({
    windowKey: "action",
    type: "action",
    defaultWidth: 340,
    defaultHeight: 460,
    minWidth: 280,
    minHeight: 340,
    maxWidth: 800,
    maxHeight: 1000,
    centered: false,
  });

  role = await OBR.player.getRole();
  myId = await OBR.player.getId();
  myName = await OBR.player.getName();
  myConnectionId = await OBR.player.getConnectionId();
  myMetadata = await OBR.player.getMetadata();
  OBR.player.onChange((player) => {
    const changed = myName !== player.name || role !== player.role;
    myMetadata = player.metadata;
    myName = player.name;
    role = player.role;
    if (changed) render(lastItems);
    else updatePlayerViewing();
  });
  window.setInterval(updatePlayerViewing, 5_000);
  partyPlayers = await OBR.party.getPlayers();
  OBR.party.onChange((players) => {
    const changed = !samePlayerRoster(partyPlayers, players);
    partyPlayers = players;
    if (activeTab === "players") {
      if (changed) render(lastItems);
      else updatePlayerViewing();
    }
  });
  [badgeCorner, badgeImage] = await Promise.all([
    getBadgeCorner(),
    getBadgeImageSetting(),
  ]);
  // Keep the settings in sync if changed from another GM window.
  lastRoomMeta = await OBR.room.getMetadata();
  OBR.room.onMetadataChange((metadata) => {
    const warnedBefore = currentWarning().level;
    lastRoomMeta = metadata;
    if (currentWarning().level !== warnedBefore) render(lastItems);
    void renderStorage();
    void getBadgeImageSetting().then((image) => {
      badgeImage = image;
    });
    void getBadgeCorner().then((corner) => {
      if (corner !== badgeCorner) {
        badgeCorner = corner;
        void OBR.scene.isReady().then((ready) => refresh(ready));
      }
    });
  });
  await refresh(await OBR.scene.isReady());
  OBR.scene.onReadyChange((ready) => void refresh(ready));
});
