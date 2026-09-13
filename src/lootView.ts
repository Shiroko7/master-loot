import OBR, { type Item } from "@owlbear-rodeo/sdk";
import "@fontsource/cinzel/600.css";
import "./styles/ui.css";
import { LOOT_POPOVER_ID } from "./constants";
import { setupWindowResizer } from "./windowResizer";
import { buildCoinChips, buildCoinConverter } from "./coins";
import { safeHttpUrl } from "./fiveETools";
import { getLoot, openDocumentModal, openInventoryModal, openLootLogModal, openUserDocumentModal } from "./loot";
import { TransferManager } from "./inventory/TransferManager";
import { LocalStorageAdapter } from "./storage/LocalStorageAdapter";
import { NetworkProtocol, type SocketMessage } from "./inventory/NetworkProtocol";
import type { UserInventoryItem } from "./modules/inventory/UserInventoryModel";
import {
  RARITY_META,
  formatCoins,
  groupLootItems,
  type CoinKind,
  type LootItem,
  type Rarity,
} from "./types";

const app = document.getElementById("app")!;
const tokenId = new URLSearchParams(location.search).get("token") ?? "";

let myId = "";
let myName = "Player";
let role: "GM" | "PLAYER" = "PLAYER";
let inventoryCollapsed = false; // Open and visible by default
const openDescriptions = new Set<string>();
const collapsedFolders = new Set<string>();
/** Conversion denomination each player picked per coin item. */
const coinTargets = new Map<string, CoinKind>();

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  return node;
}

function emptyNote(text: string): HTMLElement {
  const note = el("div", "empty-note");
  note.textContent = text;
  return note;
}

/**
 * Coin slot plus (when open) a converter panel.
 */
function renderCurrencySlot(item: LootItem, tokenName: string): HTMLElement[] {
  const coins = item.coins ?? {};
  const slot = el("div", "slot");
  slot.style.setProperty("--rarity", RARITY_META[item.rarity].color);
  slot.draggable = true;
  slot.ondragstart = (event) => {
    event.dataTransfer?.setData(
      "application/x-master-loot-item",
      JSON.stringify({ source: "token_bag", tokenId, tokenName, item }),
    );
    event.dataTransfer?.setData("text/plain", item.name);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  };

  const icon = el("span", "slot-icon");
  icon.textContent = item.icon || "🪙";
  const name = el("span", "slot-name");
  name.textContent = item.name;
  const sub = el("span", "slot-sub");
  sub.textContent = formatCoins(coins);
  name.append(sub);

  const controls = el("div", "slot-controls");
  const takeBtn = el("button", "btn btn-xs btn-gold");
  takeBtn.textContent = "Take";
  takeBtn.title = "Take coins to personal inventory";
  takeBtn.onclick = async (e) => {
    e.stopPropagation();
    takeBtn.disabled = true;
    takeBtn.textContent = "…";
    const res = await TransferManager.tokenToUser({
      tokenId,
      tokenName,
      itemId: item.id,
      quantity: item.quantity,
      targetUserId: myId,
      targetUserName: myName,
    });
    if (!res.success) {
      alert(res.error || "Failed to take coins.");
      takeBtn.disabled = false;
      takeBtn.textContent = "Take";
    }
  };
  controls.append(takeBtn);

  slot.append(icon, name, controls);

  slot.onclick = () => {
    if (openDescriptions.has(item.id)) openDescriptions.delete(item.id);
    else openDescriptions.add(item.id);
    void refresh();
  };
  if (!openDescriptions.has(item.id)) return [slot];

  const panel = el("div", "coin-panel");
  if (item.description) {
    const desc = el("div", "slot-desc");
    desc.textContent = item.description;
    panel.append(desc);
  }
  panel.append(buildCoinChips(coins));
  const converter = buildCoinConverter(
    () => coins,
    coinTargets.get(item.id) ?? "gp",
    (kind) => coinTargets.set(item.id, kind),
  );
  panel.append(converter.root);
  return [slot, panel];
}

function renderSlot(item: LootItem, tokenName: string): HTMLElement {
  const slot = el("div", "slot");
  slot.style.setProperty("--rarity", RARITY_META[item.rarity].color);
  slot.draggable = true;
  slot.ondragstart = (event) => {
    event.dataTransfer?.setData(
      "application/x-master-loot-item",
      JSON.stringify({ source: "token_bag", tokenId, tokenName, item }),
    );
    event.dataTransfer?.setData("text/plain", item.name);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  };

  const icon = el("span", "slot-icon");
  icon.textContent =
    item.icon ||
    (item.kind === "document" ? "📜" : item.kind === "idcard" ? "🪪" : "⚔️");

  const name = el("span", "slot-name");
  name.textContent = item.name;
  if (item.kind === "document" || item.kind === "idcard") {
    const sub = el("span", "slot-sub");
    sub.textContent = item.kind === "document" ? "Click to read" : "Click to inspect";
    name.append(sub);
  }

  const controls = el("div", "slot-controls");
  const qty = el("span", "slot-qty");
  qty.textContent = item.quantity > 1 ? `×${item.quantity}` : "";
  controls.append(qty);

  const takeBtn = el("button", "btn btn-xs btn-gold");
  takeBtn.textContent = "Take";
  takeBtn.title = "Take to personal inventory";
  takeBtn.onclick = async (e) => {
    e.stopPropagation();
    takeBtn.disabled = true;
    takeBtn.textContent = "…";
    const res = await TransferManager.tokenToUser({
      tokenId,
      tokenName,
      itemId: item.id,
      quantity: 1,
      targetUserId: myId,
      targetUserName: myName,
    });
    if (!res.success) {
      alert(res.error || "Failed to take item.");
      takeBtn.disabled = false;
      takeBtn.textContent = "Take";
    }
  };
  controls.append(takeBtn);

  slot.append(icon, name, controls);

  const href = safeHttpUrl(item.link);
  if (item.kind === "document") {
    slot.onclick = () => void openDocumentModal(tokenId, item.id);
  } else if (item.kind === "idcard") {
    // A card is far smaller than a full sheet of paper; shrink the modal.
    slot.onclick = () =>
      void openDocumentModal(tokenId, item.id, { width: 720, height: 600 });
  } else if (item.description || href) {
    if (openDescriptions.has(item.id)) {
      const desc = el("span", "slot-desc");
      desc.textContent = item.description ?? "";
      if (href) {
        const link = el("a", "slot-link");
        link.href = href;
        link.target = "_blank";
        link.rel = "noreferrer noopener";
        link.textContent = `${new URL(href).hostname} ↗`;
        // Follow the link without also toggling the slot closed.
        link.onclick = (event) => event.stopPropagation();
        if (item.description) desc.append(el("br"));
        desc.append(link);
      }
      slot.append(desc);
    }
    slot.onclick = () => {
      if (openDescriptions.has(item.id)) {
        openDescriptions.delete(item.id);
      } else {
        openDescriptions.add(item.id);
      }
      void refresh();
    };
  }
  return slot;
}

function renderInventorySlot(item: UserInventoryItem, tokenName: string): HTMLElement {
  const rarity = (item.data?.rarity as Rarity) || "none";
  const slot = el("div", "slot");
  slot.style.setProperty("--rarity", RARITY_META[rarity]?.color || "#6d5426");

  const icon = el("span", "slot-icon");
  icon.textContent = item.img || "⚔️";

  const nameWrapper = el("div", "slot-name-col");
  nameWrapper.style.display = "flex";
  nameWrapper.style.flexDirection = "column";
  nameWrapper.style.overflow = "hidden";
  nameWrapper.style.flex = "1";

  const name = el("span", "slot-name");
  name.textContent = item.name;
  nameWrapper.append(name);

  // Tags display
  const tags = item.tags || item.data?.tags;
  if (Array.isArray(tags) && tags.length > 0) {
    const tagsWrapper = el("div", "slot-tags");
    for (const tag of tags) {
      const tagPill = el("span", "slot-tag-pill");
      tagPill.textContent = `#${tag}`;
      tagsWrapper.append(tagPill);
    }
    nameWrapper.append(tagsWrapper);
  }

  if (item.data?.kind === "document" || item.data?.kind === "idcard") {
    const sub = el("span", "slot-sub");
    sub.textContent = item.data.kind === "document" ? "Click to read" : "Click to inspect";
    nameWrapper.append(sub);
  }

  const controls = el("div", "slot-controls");
  const qty = el("span", "slot-qty");
  qty.textContent = item.quantity > 1 ? `×${item.quantity}` : "";
  controls.append(qty);

  const returnBtn = el("button", "btn btn-xs");
  returnBtn.textContent = "Return";
  returnBtn.title = "Return item to this loot bag";
  returnBtn.onclick = async (e) => {
    e.stopPropagation();
    returnBtn.disabled = true;
    returnBtn.textContent = "…";
    const res = await TransferManager.userToToken({
      sourceUserId: myId,
      sourceUserName: myName,
      itemId: item.id,
      quantity: 1,
      tokenId,
      tokenName,
    });
    if (!res.success) {
      alert(res.error || "Failed to return item.");
      returnBtn.disabled = false;
      returnBtn.textContent = "Return";
    } else {
      void refresh();
    }
  };
  controls.append(returnBtn);

  const delBtn = el("button", "btn btn-xs btn-danger");
  delBtn.textContent = "🗑️";
  delBtn.title = "Delete Item (Logged)";
  delBtn.onclick = async (e) => {
    e.stopPropagation();
    if (confirm(`Delete "${item.name}" from personal inventory?`)) {
      delBtn.disabled = true;
      const res = await TransferManager.deleteItemFromInventory({
        userId: myId,
        userName: myName,
        itemId: item.id,
      });
      if (!res.success) {
        alert(res.error || "Failed to delete item.");
      } else {
        void refresh();
      }
    }
  };
  controls.append(delBtn);

  slot.append(icon, nameWrapper, controls);

  slot.onclick = () => {
    if (item.data?.kind === "document") {
      void openUserDocumentModal(myId, item.id);
    } else if (item.data?.kind === "idcard") {
      void openUserDocumentModal(myId, item.id, { width: 720, height: 600 });
    }
  };

  return slot;
}

function render(items: Item[]): void {
  const token = items.find((i) => i.id === tokenId);
  const loot = token ? getLoot(token) : undefined;
  const tokenName = loot?.name || token?.name || "Loot";

  app.innerHTML = "";
  const panel = el("div", "panel");

  const header = el("div", "panel-header");
  const title = el("h1", "panel-title");
  title.textContent = tokenName;

  const actions = el("div", "header-actions");
  const logBtn = el("button", "btn-icon");
  logBtn.textContent = "📜";
  logBtn.title = "Loot Activity Log";
  logBtn.ariaLabel = "Loot Activity Log";
  logBtn.onclick = () => void openLootLogModal();

  const invBtn = el("button", "btn-icon");
  invBtn.textContent = "🎒";
  invBtn.title = "Open Personal Inventory";
  invBtn.ariaLabel = "Personal Inventory";
  invBtn.onclick = () => void openInventoryModal();

  const close = el("button", "btn-icon");
  close.textContent = "✕";
  close.ariaLabel = "Close";
  close.onclick = () => void OBR.popover.close(LOOT_POPOVER_ID);
  actions.append(logBtn, invBtn, close);

  header.append(title, actions);
  panel.append(header);

  const body = el("div", "panel-body");
  const visible = loot && (loot.enabled || role === "GM");
  if (!token || !visible) {
    body.append(emptyNote("There is nothing to loot here."));
  } else if (loot.items.length === 0) {
    body.append(emptyNote("Nothing of value remains…"));
  } else {
    for (const group of groupLootItems(loot.items, loot.folders)) {
      if (group.folder) {
        const folder = group.folder;
        const head = el("button", "folder-head");
        const chevron = el("span", "chev");
        chevron.textContent = collapsedFolders.has(folder) ? "▸" : "▾";
        const label = el("span", "folder-label");
        label.textContent = folder;
        const count = el("span", "folder-count");
        count.textContent = String(group.items.length);
        head.append(chevron, label, count);
        head.onclick = () => {
          if (collapsedFolders.has(folder)) {
            collapsedFolders.delete(folder);
          } else {
            collapsedFolders.add(folder);
          }
          void refresh();
        };
        body.append(head);
        if (collapsedFolders.has(folder)) continue;
      }
      for (const item of group.items) {
        if (item.kind === "currency") body.append(...renderCurrencySlot(item, tokenName));
        else body.append(renderSlot(item, tokenName));
      }
    }
  }

  // --- Personal Inventory Drawer (open by default) ---
  if (myId) {
    const myInv = LocalStorageAdapter.getInventory(myId);
    const invHead = el("button", "folder-head inventory-head");
    const invChev = el("span", "chev");
    invChev.textContent = inventoryCollapsed ? "▸" : "▾";
    const invLabel = el("span", "folder-label");
    invLabel.textContent = "🎒 Personal Inventory";
    const invCount = el("span", "folder-count");
    invCount.textContent = String(myInv.items.length);

    invHead.append(invChev, invLabel, invCount);

    const addBtn = el("button", "btn btn-xs");
    addBtn.textContent = "+ Add";
    addBtn.title = "Open inventory to create or manage items";
    addBtn.style.marginLeft = "auto";
    addBtn.onclick = (e) => {
      e.stopPropagation();
      void openInventoryModal();
    };
    invHead.append(addBtn);

    invHead.onclick = () => {
      inventoryCollapsed = !inventoryCollapsed;
      void refresh();
    };
    body.append(invHead);

    if (!inventoryCollapsed) {
      if (myInv.items.length === 0) {
        body.append(emptyNote("Your inventory is empty. Click 'Take' on an item above to claim it."));
      } else {
        for (const item of myInv.items) {
          body.append(renderInventorySlot(item, tokenName));
        }
      }
    }
  }

  panel.append(body);

  if (visible && loot.items.some((i) => i.kind === "document")) {
    const footer = el("div", "panel-footer");
    footer.textContent = "Click a written item to read it.";
    panel.append(footer);
  }

  app.append(panel);
}

async function refresh(): Promise<void> {
  render(await OBR.scene.items.getItems());
}

OBR.onReady(async () => {
  setupWindowResizer({
    windowKey: "loot",
    type: "popover",
    popoverId: LOOT_POPOVER_ID,
    defaultWidth: 360,
    defaultHeight: 520,
    minWidth: 300,
    minHeight: 340,
    maxWidth: 900,
    maxHeight: 1200,
    centered: "horizontal",
  });

  myId = await OBR.player.getId();
  myName = await OBR.player.getName();
  role = await OBR.player.getRole();
  TransferManager.initialize();
  NetworkProtocol.initialize();

  NetworkProtocol.addListener((msg: SocketMessage) => {
    if (
      msg.action === "SYNC_INVENTORY" ||
      msg.action === "TRANSFER_ITEM" ||
      msg.action === "TRANSFER_RESULT" ||
      msg.action === "GM_MODIFY_INVENTORY"
    ) {
      void refresh();
    }
  });

  await refresh();
  OBR.scene.items.onChange(render);
});
