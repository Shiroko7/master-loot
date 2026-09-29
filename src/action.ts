import OBR, { type Item, type Metadata, type Player } from "@owlbear-rodeo/sdk";
import "@fontsource/cinzel/600.css";
import "./styles/ui.css";
import { ORDER_KEY } from "./constants";
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
/** Item updates that arrive mid-drag are held until the drag finishes. */
let deferredItems: Item[] | null = null;

/** "loot": the scene's containers (NPCs, chests…); "players": inventories. */
type ActionTab = "loot" | "players";
const TAB_KEY = "master-loot:action-tab";
let activeTab: ActionTab = readTab();
let lastItems: Item[] = [];
let myId = "";
let myName = "You";
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

async function saveOrder(body: HTMLElement): Promise<void> {
  const order = [...body.querySelectorAll<HTMLElement>(".container-row")]
    .map((row) => row.dataset.tokenId)
    .filter((id): id is string => id !== undefined);
  containerOrder = order;
  try {
    await OBR.scene.setMetadata({ [ORDER_KEY]: order });
  } catch (error) {
    console.error("Master Loot: failed to save container order", error);
  }
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
    actions.append(gear);
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
    { id: myId, name: `${myName} (you)`, role, color: "" },
    ...[...partyPlayers]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => ({ id: p.id, name: p.name, role: p.role, color: p.color })),
  ];
  for (const player of everyone) {
    const row = el("div", "container-row");
    const dot = el("span", "player-dot");
    if (player.color) dot.style.background = player.color;
    const info = el("div", "info");
    const name = el("div", "name");
    name.textContent = player.name;
    const meta = el("div", "meta");
    meta.textContent = player.role === "GM" ? "Game master" : "Player";
    info.append(name, meta);
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
  footer.textContent = "Inventories load from each player's browser while they're online.";
  panel.append(footer);
}

async function toggleTakeLock(tokenId: string, takeable: boolean): Promise<void> {
  const token = lastItems.find((item) => item.id === tokenId);
  const loot = token ? getLoot(token) : undefined;
  if (!loot) return;
  await saveLoot(tokenId, { ...structuredClone(loot), takeable });
}

function render(items: Item[]): void {
  lastItems = items;
  if (draggingRow) {
    deferredItems = items;
    return;
  }
  const { panel, body } = shell();
  body.append(buildTabs());
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

  for (const { item, loot } of ordered) {
    const row = el("div", "container-row");
    row.dataset.tokenId = item.id;
    if (!loot!.enabled) row.classList.add("disabled");

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
        void saveOrder(body);
        if (deferredItems) {
          const pending = deferredItems;
          deferredItems = null;
          render(pending);
        }
      };
    }

    const icon = el("span");
    icon.textContent = loot!.enabled ? "💰" : "🔒";

    const info = el("div", "info");
    const name = el("div", "name");
    name.textContent = loot!.name || item.name;
    const meta = el("div", "meta");
    const count = loot!.items.length;
    const takeable = loot!.takeable !== false;
    meta.textContent =
      `${count} item${count === 1 ? "" : "s"}` +
      (role === "GM" && !loot!.enabled
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

    body.append(row);
  }

  if (role === "GM") {
    body.ondragover = (event) => {
      if (!draggingRow) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      const rows = [
        ...body.querySelectorAll<HTMLElement>(".container-row:not(.dragging)"),
      ];
      const next = rows.find((other) => {
        const rect = other.getBoundingClientRect();
        return event.clientY < rect.top + rect.height / 2;
      });
      if (next) body.insertBefore(draggingRow, next);
      else body.append(draggingRow);
    };
    body.ondrop = (event) => event.preventDefault();
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
    containerOrder = readOrder(await OBR.scene.getMetadata());
    render(await OBR.scene.items.getItems());
    unsubscribeItems = OBR.scene.items.onChange(render);
    unsubscribeMeta = OBR.scene.onMetadataChange((metadata) => {
      containerOrder = readOrder(metadata);
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
  partyPlayers = await OBR.party.getPlayers();
  OBR.party.onChange((players) => {
    partyPlayers = players;
    if (activeTab === "players") render(lastItems);
  });
  [badgeCorner, badgeImage] = await Promise.all([
    getBadgeCorner(),
    getBadgeImageSetting(),
  ]);
  // Keep the settings in sync if changed from another GM window.
  OBR.room.onMetadataChange(() => {
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
