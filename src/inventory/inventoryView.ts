import OBR, { type Player } from "@owlbear-rodeo/sdk";
import "@fontsource/cinzel/600.css";
import "../styles/ui.css";
import { INVENTORY_MODAL_ID } from "../constants";
import { closeWindow, setupWindowResizer } from "../windowResizer";
import { LocalStorageAdapter } from "../storage/LocalStorageAdapter";
import { ExportManager } from "../storage/ExportManager";
import {
  DEFAULT_INVENTORY_SECTIONS,
  OTHER_INVENTORY_SECTION,
  type DefaultInventorySection,
  type UserInventoryItem,
  type UserInventoryState,
} from "../modules/inventory/UserInventoryModel";
import { RARITY_META, type Rarity } from "../types";
import { TransferManager } from "./TransferManager";
import { NetworkProtocol, type SocketMessage } from "./NetworkProtocol";
import { getLoot, openLootLogModal, openUserDocumentModal } from "../loot";
import { buildCoinChips, buildCoinConverter } from "../coins";

const app = document.getElementById("app")!;

let myId = "";
let myName = "Player";
let myRole: "GM" | "PLAYER" = "PLAYER";
let activeUserId = "";
let onlinePlayers: Player[] = [];
const peerInventories = new Map<string, UserInventoryState>();
const openDescriptions = new Set<string>();
const collapsedSections = new Set<string>();

let searchQuery = "";
let activeTagFilter: string | null = null;

const COMMON_EMOJIS = [
  "⚔️", "🛡️", "🏹", "🪄", "🧪", "📜", "💎", "💍", "👑", "🗝️", "💰", "📦", "🎒", "🥩", "🍺", "🕯️", "🪓", "🔨"
];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  return node;
}

function showDialog(content: HTMLElement): () => void {
  const backdrop = el("div", "dialog-backdrop");
  const modal = el("div", "dialog-modal");
  modal.append(content);
  backdrop.append(modal);
  document.body.append(backdrop);

  const close = () => backdrop.remove();
  backdrop.onclick = (e) => {
    if (e.target === backdrop) close();
  };
  return close;
}

function getCurrentState(): UserInventoryState {
  if (activeUserId === myId) {
    return LocalStorageAdapter.getInventory(myId);
  }
  return peerInventories.get(activeUserId) ?? LocalStorageAdapter.getInventory(activeUserId);
}

function saveCurrentState(state: UserInventoryState): void {
  if (activeUserId === myId) {
    LocalStorageAdapter.saveInventory(myId, state);
    void NetworkProtocol.syncInventory(state, myName);
  } else if (myRole === "GM") {
    peerInventories.set(activeUserId, state);
    void NetworkProtocol.gmModifyInventory(activeUserId, state, myId);
  }
  render();
}

function getActiveUserName(): string {
  if (activeUserId === myId) return myName;
  const found = onlinePlayers.find((p) => p.id === activeUserId);
  return found?.name || "Player";
}

/**
 * Modal to create a new item or edit an existing one.
 */
function promptCreateOrEditItem(existingItem?: UserInventoryItem, defaultSection?: string): void {
  const state = getCurrentState();
  const isEditing = !!existingItem;

  const form = el("div");
  const title = el("h3");
  title.textContent = isEditing ? `Edit "${existingItem.name}"` : "Add Custom Item to Inventory";

  // Item Name
  const nameLabel = el("label", "field");
  const nameSpan = el("span");
  nameSpan.textContent = "Item Name:";
  const nameInput = el("input");
  nameInput.type = "text";
  nameInput.required = true;
  nameInput.placeholder = "e.g. Vorpal Sword, Healing Salve, Old Map";
  nameInput.value = existingItem?.name || "";
  nameLabel.append(nameSpan, nameInput);

  // Icon / Emoji
  const iconLabel = el("label", "field");
  const iconSpan = el("span");
  iconSpan.textContent = "Icon / Emoji:";
  const iconInput = el("input");
  iconInput.type = "text";
  iconInput.value = existingItem?.img || "⚔️";
  iconInput.style.maxWidth = "80px";

  const emojiBar = el("div", "emoji-suggestions");
  for (const emoji of COMMON_EMOJIS) {
    const btn = el("button", "emoji-btn");
    btn.type = "button";
    btn.textContent = emoji;
    btn.onclick = () => {
      iconInput.value = emoji;
    };
    emojiBar.append(btn);
  }
  iconLabel.append(iconSpan, iconInput, emojiBar);

  // Quantity
  const qtyLabel = el("label", "field");
  const qtySpan = el("span");
  qtySpan.textContent = "Quantity:";
  const qtyInput = el("input");
  qtyInput.type = "number";
  qtyInput.min = "1";
  qtyInput.value = String(existingItem?.quantity || 1);
  qtyLabel.append(qtySpan, qtyInput);

  // Section
  const sectionLabel = el("label", "field");
  const sectionSpan = el("span");
  sectionSpan.textContent = "Section / Category:";
  const sectionSelect = el("select");

  const knownSections = Array.from(new Set([
    ...(state.sections?.length ? state.sections : DEFAULT_INVENTORY_SECTIONS),
    OTHER_INVENTORY_SECTION,
  ]));
  for (const sec of knownSections) {
    const opt = el("option");
    opt.value = sec;
    opt.textContent = sec;
    if (
      existingItem?.section === sec ||
      (!!existingItem && !existingItem.section && sec === OTHER_INVENTORY_SECTION) ||
      (!existingItem && (defaultSection === sec || (!defaultSection && sec === OTHER_INVENTORY_SECTION)))
    ) {
      opt.selected = true;
    }
    sectionSelect.append(opt);
  }

  const newSecOpt = el("option");
  newSecOpt.value = "__new__";
  newSecOpt.textContent = "➕ Create New Section…";
  sectionSelect.append(newSecOpt);

  const newSectionInput = el("input");
  newSectionInput.type = "text";
  newSectionInput.placeholder = "Enter new section name…";
  newSectionInput.style.display = "none";
  newSectionInput.style.marginTop = "4px";

  sectionSelect.onchange = () => {
    newSectionInput.style.display = sectionSelect.value === "__new__" ? "block" : "none";
  };
  sectionLabel.append(sectionSpan, sectionSelect, newSectionInput);

  // Tags
  const tagsLabel = el("label", "field");
  const tagsSpan = el("span");
  tagsSpan.textContent = "Tags (comma-separated):";
  const tagsInput = el("input");
  tagsInput.type = "text";
  tagsInput.placeholder = "e.g. potion, consumable, magical, attuned, quest";
  tagsInput.value = (existingItem?.tags || []).join(", ");
  tagsLabel.append(tagsSpan, tagsInput);

  // Rarity
  const rarityLabel = el("label", "field");
  const raritySpan = el("span");
  raritySpan.textContent = "Rarity:";
  const raritySelect = el("select");
  const rarities: Rarity[] = ["none", "poor", "common", "uncommon", "rare", "epic", "legendary"];
  for (const r of rarities) {
    const opt = el("option");
    opt.value = r;
    opt.textContent = RARITY_META[r]?.label || r;
    if ((existingItem?.data?.rarity || "none") === r) {
      opt.selected = true;
    }
    raritySelect.append(opt);
  }
  rarityLabel.append(raritySpan, raritySelect);

  // Description / Notes
  const descLabel = el("label", "field");
  const descSpan = el("span");
  descSpan.textContent = "Description / Reference Notes:";
  const descInput = el("textarea");
  descInput.rows = 3;
  descInput.placeholder = "Add rules, damage dice, lore, or notes for this item…";
  descInput.value = existingItem?.data?.description || "";
  descLabel.append(descSpan, descInput);

  // Reference Link
  const linkLabel = el("label", "field");
  const linkSpan = el("span");
  linkSpan.textContent = "Reference Link (optional):";
  const linkInput = el("input");
  linkInput.type = "url";
  linkInput.placeholder = "https://...";
  linkInput.value = existingItem?.data?.link || "";
  linkLabel.append(linkSpan, linkInput);

  // Buttons
  const actions = el("div", "dialog-actions");
  const cancelBtn = el("button", "btn");
  cancelBtn.textContent = "Cancel";
  const submitBtn = el("button", "btn btn-gold");
  submitBtn.textContent = isEditing ? "Save Changes" : "Add Item";
  actions.append(cancelBtn, submitBtn);

  form.append(
    title,
    nameLabel,
    iconLabel,
    qtyLabel,
    sectionLabel,
    tagsLabel,
    rarityLabel,
    descLabel,
    linkLabel,
    actions,
  );

  const closeDialog = showDialog(form);
  cancelBtn.onclick = closeDialog;

  submitBtn.onclick = async () => {
    const name = nameInput.value.trim();
    if (!name) {
      alert("Please enter an item name.");
      return;
    }

    const img = iconInput.value.trim() || "⚔️";
    const qty = Math.max(1, parseInt(qtyInput.value, 10) || 1);

    let chosenSection: string = OTHER_INVENTORY_SECTION;
    if (sectionSelect.value === "__new__") {
      const customSec = newSectionInput.value.trim();
      if (customSec) {
        chosenSection = customSec;
        if (!state.sections) state.sections = [];
        if (!state.sections.includes(customSec)) {
          state.sections.push(customSec);
        }
      }
    } else if (sectionSelect.value) {
      chosenSection = sectionSelect.value || OTHER_INVENTORY_SECTION;
    }

    const rawTags = tagsInput.value
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0);
    const tags = Array.from(new Set(rawTags));

    const rarity = raritySelect.value as Rarity;
    const description = descInput.value.trim();
    const link = linkInput.value.trim();

    submitBtn.disabled = true;
    submitBtn.textContent = "Saving…";

    if (isEditing && existingItem) {
      // Update existing item
      const itemToUpdate = state.items.find((i) => i.id === existingItem.id);
      if (itemToUpdate) {
        itemToUpdate.name = name;
        itemToUpdate.img = img;
        itemToUpdate.quantity = qty;
        itemToUpdate.section = chosenSection;
        itemToUpdate.tags = tags;
        itemToUpdate.data = {
          ...(itemToUpdate.data || {}),
          rarity,
          description,
          link,
          section: chosenSection,
          tags,
        };
        saveCurrentState(state);
      }
    } else {
      // Create new item
      const res = await TransferManager.createItemInInventory({
        userId: activeUserId,
        userName: getActiveUserName(),
        item: {
          name,
          img,
          quantity: qty,
          section: chosenSection,
          tags,
          description,
          link,
          rarity,
        },
      });

      if (!res.success) {
        alert(res.error || "Failed to create item.");
      }
    }

    closeDialog();
    render();
  };
}

/**
 * Modal to create a new section.
 */
function promptAddSection(): void {
  const state = getCurrentState();
  const form = el("div");
  const title = el("h3");
  title.textContent = "Create Inventory Section";

  const label = el("label", "field");
  const span = el("span");
  span.textContent = "Section Name:";
  const input = el("input");
  input.type = "text";
  input.placeholder = "e.g. Weapons, Magic Items, Potions, Quest Items";
  label.append(span, input);

  const actions = el("div", "dialog-actions");
  const cancelBtn = el("button", "btn");
  cancelBtn.textContent = "Cancel";
  const submitBtn = el("button", "btn btn-gold");
  submitBtn.textContent = "Create Section";
  actions.append(cancelBtn, submitBtn);

  form.append(title, label, actions);

  const closeDialog = showDialog(form);
  cancelBtn.onclick = closeDialog;

  submitBtn.onclick = () => {
    const secName = input.value.trim();
    if (!secName) return;

    if (!state.sections) {
      state.sections = [...DEFAULT_INVENTORY_SECTIONS];
    }

    if (!state.sections.includes(secName)) {
      state.sections.push(secName);
      saveCurrentState(state);
    }
    closeDialog();
    render();
  };
}

/**
 * Delete a section and reassign its items.
 */
function deleteSection(secName: string): void {
  const state = getCurrentState();
  if (!confirm(`Delete section "${secName}"? Items in it will move to Other.`)) {
    return;
  }

  // Clear section on any items
  for (const it of state.items) {
    if (it.section === secName) {
      it.section = OTHER_INVENTORY_SECTION;
      if (it.data) it.data.section = OTHER_INVENTORY_SECTION;
    }
  }

  if (state.sections) {
    state.sections = state.sections.filter((s) => s !== secName);
  }

  collapsedSections.delete(secName);
  saveCurrentState(state);
}

function promptTransferItem(item: UserInventoryItem): void {
  const form = el("div");
  const title = el("h3");
  title.textContent = `Transfer "${item.name}"`;

  const qtyLabel = el("label", "field");
  const qtySpan = el("span");
  qtySpan.textContent = `Quantity (max ${item.quantity}):`;
  const qtyInput = el("input");
  qtyInput.type = "number";
  qtyInput.min = "1";
  qtyInput.max = String(item.quantity);
  qtyInput.value = "1";
  qtyLabel.append(qtySpan, qtyInput);

  if (item.quantity > 1) {
    const halfBtn = el("button", "btn btn-xs");
    halfBtn.type = "button";
    halfBtn.textContent = "Half";
    halfBtn.title = "Transfer half of this stack";
    halfBtn.onclick = () => {
      qtyInput.value = String(Math.max(1, Math.floor(item.quantity / 2)));
    };
    qtyLabel.append(halfBtn);
  }

  const targetLabel = el("label", "field");
  const targetSpan = el("span");
  targetSpan.textContent = "Destination:";
  const targetSelect = el("select");

  // Add other online players as targets
  for (const p of onlinePlayers) {
    if (p.id !== activeUserId) {
      const opt = el("option");
      opt.value = `user:${p.id}`;
      opt.textContent = `👤 Player: ${p.name}`;
      targetSelect.append(opt);
    }
  }

  // Also query scene tokens to offer scene loot bags as targets!
  void OBR.scene.items.getItems().then((sceneItems) => {
    for (const itemDoc of sceneItems) {
      const loot = getLoot(itemDoc);
      if (loot) {
        const opt = el("option");
        opt.value = `token:${itemDoc.id}`;
        opt.textContent = `💰 Bag: ${loot.name || itemDoc.name}`;
        targetSelect.append(opt);
      }
    }
  });

  targetLabel.append(targetSpan, targetSelect);

  const actions = el("div", "dialog-actions");
  const cancelBtn = el("button", "btn");
  cancelBtn.textContent = "Cancel";
  const submitBtn = el("button", "btn btn-gold");
  submitBtn.textContent = "Transfer";

  actions.append(cancelBtn, submitBtn);
  form.append(title, qtyLabel, targetLabel, actions);

  const closeDialog = showDialog(form);
  cancelBtn.onclick = closeDialog;

  submitBtn.onclick = async () => {
    const qty = Math.min(item.quantity, Math.max(1, parseInt(qtyInput.value, 10) || 1));
    const targetVal = targetSelect.value;
    if (!targetVal) return;

    submitBtn.disabled = true;
    submitBtn.textContent = "Transferring…";

    if (targetVal.startsWith("user:")) {
      const targetId = targetVal.slice(5);
      const targetPlayer = onlinePlayers.find((p) => p.id === targetId);
      const targetName = targetPlayer?.name || "Player";
      const targetInv = peerInventories.get(targetId) || LocalStorageAdapter.getInventory(targetId);

      const res = await TransferManager.userToUser({
        sourceUserId: activeUserId,
        sourceUserName: getActiveUserName(),
        targetUserId: targetId,
        targetUserName: targetName,
        itemId: item.id,
        quantity: qty,
        targetIsLocked: targetInv.isLocked,
      });

      if (!res.success) {
        alert(res.error || "Failed to transfer item.");
      }
    } else if (targetVal.startsWith("token:")) {
      const tokenId = targetVal.slice(6);
      const tokens = await OBR.scene.items.getItems([tokenId]);
      const tokenName = tokens[0]?.name || "Loot Bag";

      const res = await TransferManager.userToToken({
        sourceUserId: activeUserId,
        sourceUserName: getActiveUserName(),
        itemId: item.id,
        quantity: qty,
        tokenId,
        tokenName,
      });

      if (!res.success) {
        alert(res.error || "Failed to deposit item to bag.");
      }
    }

    closeDialog();
    render();
  };
}

function promptDeleteItem(item: UserInventoryItem): void {
  if (item.quantity <= 1) {
    if (!confirm(`Delete "${item.name}" from inventory?`)) return;
    void TransferManager.deleteItemFromInventory({
      userId: activeUserId,
      userName: getActiveUserName(),
      itemId: item.id,
      quantity: 1,
    }).then((res) => {
      if (!res.success) alert(res.error || "Failed to delete item.");
      render();
    });
    return;
  }

  const form = el("div");
  const title = el("h3");
  title.textContent = `Delete from "${item.name}"`;

  const qtyLabel = el("label", "field");
  const qtySpan = el("span");
  qtySpan.textContent = `Amount to delete (max ${item.quantity}):`;
  const qtyInput = el("input");
  qtyInput.type = "number";
  qtyInput.min = "1";
  qtyInput.max = String(item.quantity);
  qtyInput.value = "1";
  qtyLabel.append(qtySpan, qtyInput);

  const halfBtn = el("button", "btn btn-xs");
  halfBtn.type = "button";
  halfBtn.textContent = "Half";
  halfBtn.title = "Delete half of this stack";
  halfBtn.onclick = () => {
    qtyInput.value = String(Math.max(1, Math.floor(item.quantity / 2)));
  };
  qtyLabel.append(halfBtn);

  const actions = el("div", "dialog-actions");
  const cancelBtn = el("button", "btn");
  cancelBtn.textContent = "Cancel";
  const submitBtn = el("button", "btn btn-danger");
  submitBtn.textContent = "Delete";
  actions.append(cancelBtn, submitBtn);
  form.append(title, qtyLabel, actions);

  const closeDialog = showDialog(form);
  cancelBtn.onclick = closeDialog;
  submitBtn.onclick = async () => {
    const quantity = Math.min(
      item.quantity,
      Math.max(1, parseInt(qtyInput.value, 10) || 1),
    );
    submitBtn.disabled = true;
    const res = await TransferManager.deleteItemFromInventory({
      userId: activeUserId,
      userName: getActiveUserName(),
      itemId: item.id,
      quantity,
    });
    if (!res.success) alert(res.error || "Failed to delete item.");
    closeDialog();
    render();
  };
}

function renderItemSlot(
  item: UserInventoryItem,
  canManage: boolean,
  canInteract: boolean,
): HTMLElement[] {
  const rarity = (item.data?.rarity as Rarity) || "none";
  const rarityColor = RARITY_META[rarity]?.color || "#6d5426";

  const slot = el("div", "slot");
  slot.style.setProperty("--rarity", rarityColor);

  if (canInteract) {
    slot.draggable = true;
    slot.ondragstart = (e) => {
      e.dataTransfer?.setData(
        "application/x-master-loot-item",
        JSON.stringify({
          source: "user_inventory",
          userId: activeUserId,
          userName: getActiveUserName(),
          item,
        }),
      );
      e.dataTransfer?.setData("text/plain", item.name);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    };
  }

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

  // Render tags
  const tags = item.tags || item.data?.tags;
  if (Array.isArray(tags) && tags.length > 0) {
    const tagsWrapper = el("div", "slot-tags");
    for (const tag of tags) {
      const tagPill = el("span", "slot-tag-pill");
      tagPill.textContent = `#${tag}`;
      tagPill.onclick = (e) => {
        e.stopPropagation();
        activeTagFilter = activeTagFilter === tag ? null : tag;
        render();
      };
      tagsWrapper.append(tagPill);
    }
    nameWrapper.append(tagsWrapper);
  }

  if (item.data?.kind === "document") {
    const sub = el("span", "slot-sub");
    sub.textContent = "Click to read";
    nameWrapper.append(sub);
  } else if (item.data?.kind === "idcard") {
    const sub = el("span", "slot-sub");
    sub.textContent = "Click to inspect";
    nameWrapper.append(sub);
  }

  const controls = el("div", "slot-controls");
  const qty = el("span", "slot-qty");
  qty.textContent = item.quantity > 1 ? `×${item.quantity}` : "";
  controls.append(qty);

  if (canInteract) {
    const giveBtn = el("button", "btn btn-xs");
    giveBtn.textContent = "Give";
    giveBtn.title = "Transfer to player or bag";
    giveBtn.onclick = (e) => {
      e.stopPropagation();
      promptTransferItem(item);
    };
    controls.append(giveBtn);
  }

  if (canManage) {
    // Edit item button
    const editBtn = el("button", "btn btn-xs");
    editBtn.textContent = "✎";
    editBtn.title = "Edit Item";
    editBtn.onclick = (e) => {
      e.stopPropagation();
      promptCreateOrEditItem(item);
    };

    // Delete item button with audit log entry
    const delBtn = el("button", "btn btn-xs btn-danger");
    delBtn.textContent = "🗑️";
    delBtn.title = "Delete Item (Logged)";
    delBtn.onclick = async (e) => {
      e.stopPropagation();
      delBtn.disabled = true;
      promptDeleteItem(item);
      delBtn.disabled = false;
    };

    controls.append(editBtn, delBtn);
  }

  slot.append(icon, nameWrapper, controls);

  slot.onclick = () => {
    if (item.data?.kind === "document") {
      void openUserDocumentModal(activeUserId, item.id);
      return;
    }
    if (item.data?.kind === "idcard") {
      void openUserDocumentModal(activeUserId, item.id, { width: 720, height: 600 });
      return;
    }

    if (openDescriptions.has(item.id)) {
      openDescriptions.delete(item.id);
    } else {
      openDescriptions.add(item.id);
    }
    render();
  };

  if (!openDescriptions.has(item.id)) {
    return [slot];
  }

  // Expanded panel
  const panel = el("div", "coin-panel");
  if (item.data?.description) {
    const desc = el("div", "slot-desc");
    desc.textContent = item.data.description;
    panel.append(desc);
  }
  if (item.data?.coins) {
    panel.append(buildCoinChips(item.data.coins));
    const converter = buildCoinConverter(() => item.data.coins, "gp", () => {});
    panel.append(converter.root);
  }
  if (item.data?.link) {
    const link = el("a", "slot-link");
    link.href = item.data.link;
    link.target = "_blank";
    link.rel = "noreferrer noopener";
    link.textContent = "Reference link ↗";
    panel.append(link);
  }

  return [slot, panel];
}

function render(): void {
  const state = getCurrentState();
  const isOwner = activeUserId === myId;
  const isGM = myRole === "GM";
  const canManage = isOwner || isGM;
  const canView = isOwner || isGM || state.isPublic;
  const canInteract = isOwner || isGM || !state.isLocked;

  app.innerHTML = "";
  const panel = el("div", "panel");

  // Header
  const header = el("div", "panel-header");

  const userSelectWrapper = el("div", "header-user-select");
  const userSelect = el("select", "user-select");

  // Populate players
  const myOpt = el("option");
  myOpt.value = myId;
  myOpt.textContent = `🎒 My Inventory`;
  myOpt.selected = activeUserId === myId;
  userSelect.append(myOpt);

  for (const player of onlinePlayers) {
    if (player.id !== myId) {
      const peerState = peerInventories.get(player.id);
      const isPublic = peerState ? peerState.isPublic : true;
      const isLocked = peerState ? peerState.isLocked : false;

      const opt = el("option");
      opt.value = player.id;
      opt.textContent = `${player.name} (${isPublic ? "Public" : "Private"}${isLocked ? " 🔒" : ""})`;
      opt.selected = activeUserId === player.id;
      userSelect.append(opt);
    }
  }

  userSelect.onchange = () => {
    activeUserId = userSelect.value;
    if (activeUserId !== myId && !peerInventories.has(activeUserId)) {
      void NetworkProtocol.requestInventory(activeUserId, myId);
    }
    render();
  };
  userSelectWrapper.append(userSelect);

  // Status badges next to user select
  if (state.isLocked) {
    const lockBadge = el("span", "badge-status badge-locked");
    lockBadge.title = "Inventory is locked against peer transfers";
    lockBadge.textContent = "🔒 Locked";
    userSelectWrapper.append(lockBadge);
  }
  if (!state.isPublic) {
    const privBadge = el("span", "badge-status badge-private");
    privBadge.title = "Inventory is private to owner & GM";
    privBadge.textContent = "🕶️ Private";
    userSelectWrapper.append(privBadge);
  }

  header.append(userSelectWrapper);

  const actions = el("div", "header-actions");

  // 1. History Controls Group (Undo & Redo)
  const historyGroup = el("div", "header-btn-group");

  const undoBtn = el("button", "btn-icon");
  undoBtn.textContent = "↩️";
  undoBtn.title = "Undo Last Action (Ctrl+Z)";
  undoBtn.onclick = async () => {
    undoBtn.disabled = true;
    const res = await TransferManager.undoMostRecent(myRole === "GM" ? undefined : myId);
    undoBtn.disabled = false;
    if (!res.success) {
      alert(res.error || "No action available to undo.");
    } else {
      render();
    }
  };

  const redoBtn = el("button", "btn-icon");
  redoBtn.textContent = "↪️";
  redoBtn.title = "Redo Last Undone Action (Ctrl+Y)";
  redoBtn.onclick = async () => {
    redoBtn.disabled = true;
    const res = await TransferManager.redoMostRecent(myRole === "GM" ? undefined : myId);
    redoBtn.disabled = false;
    if (!res.success) {
      alert(res.error || "No action available to redo.");
    } else {
      render();
    }
  };

  historyGroup.append(undoBtn, redoBtn);
  actions.append(historyGroup);

  // Hidden file input for backup import
  let fileInput: HTMLInputElement | undefined;
  if (canManage) {
    fileInput = el("input");
    fileInput.type = "file";
    fileInput.accept = ".json";
    fileInput.style.display = "none";
    fileInput.onchange = async () => {
      const file = fileInput?.files?.[0];
      if (!file) return;
      try {
        const imported = await ExportManager.importFromFile(
          file,
          activeUserId,
          (s) => void NetworkProtocol.syncInventory(s, myName),
        );
        peerInventories.set(activeUserId, imported);
        alert(`Successfully imported ${imported.items.length} items.`);
        render();
      } catch (err: any) {
        alert(err.message || "Failed to import inventory.");
      }
    };
    actions.append(fileInput);
  }

  // 2. Options Dropdown Menu (Gear Icon)
  const menuWrap = el("div", "header-menu-wrap");
  const menuTrigger = el("button", "btn-icon header-menu-trigger");
  menuTrigger.textContent = "⚙";
  menuTrigger.title = "Inventory Options & Tools";
  menuTrigger.ariaLabel = "Inventory Options";

  let isMenuOpen = false;
  const menuDropdown = el("div", "header-menu-dropdown");
  menuDropdown.style.display = "none";

  function closeMenu() {
    isMenuOpen = false;
    menuDropdown.style.display = "none";
    menuTrigger.classList.remove("active");
  }

  function toggleMenu(e: MouseEvent) {
    e.stopPropagation();
    isMenuOpen = !isMenuOpen;
    menuDropdown.style.display = isMenuOpen ? "flex" : "none";
    if (isMenuOpen) {
      menuTrigger.classList.add("active");
    } else {
      menuTrigger.classList.remove("active");
    }
  }

  menuTrigger.onclick = toggleMenu;

  if (canManage) {
    const permTitle = el("div", "menu-section-title");
    permTitle.textContent = "Permissions & Privacy";
    menuDropdown.append(permTitle);

    // Toggle Visibility
    const visItem = el("button", "menu-item");
    const visIcon = el("span", "menu-item-icon");
    visIcon.textContent = state.isPublic ? "👁️" : "🕶️";
    const visText = el("div", "menu-item-text");
    const visLabel = el("span", "menu-item-label");
    visLabel.textContent = state.isPublic ? "Make Private" : "Make Public";
    const visDesc = el("span", "menu-item-desc");
    visDesc.textContent = state.isPublic ? "Currently visible to party" : "Currently hidden from party";
    visText.append(visLabel, visDesc);
    visItem.append(visIcon, visText);
    visItem.onclick = () => {
      closeMenu();
      state.isPublic = !state.isPublic;
      saveCurrentState(state);
    };

    // Toggle Lock
    const lockItem = el("button", "menu-item");
    const lockIcon = el("span", "menu-item-icon");
    lockIcon.textContent = state.isLocked ? "🔒" : "🔓";
    const lockText = el("div", "menu-item-text");
    const lockLabel = el("span", "menu-item-label");
    lockLabel.textContent = state.isLocked ? "Unlock Inventory" : "Lock Inventory";
    const lockDesc = el("span", "menu-item-desc");
    lockDesc.textContent = state.isLocked ? "Block peer transfers" : "Allow peer transfers";
    lockText.append(lockLabel, lockDesc);
    lockItem.append(lockIcon, lockText);
    lockItem.onclick = () => {
      closeMenu();
      state.isLocked = !state.isLocked;
      saveCurrentState(state);
    };

    menuDropdown.append(visItem, lockItem);

    const div1 = el("div", "menu-divider");
    menuDropdown.append(div1);
  }

  // Activity Log
  const logTitle = el("div", "menu-section-title");
  logTitle.textContent = "Logs & History";
  menuDropdown.append(logTitle);

  const logItem = el("button", "menu-item");
  const logIcon = el("span", "menu-item-icon");
  logIcon.textContent = "📜";
  const logText = el("div", "menu-item-text");
  const logLabel = el("span", "menu-item-label");
  logLabel.textContent = "Loot Activity Log";
  const logDesc = el("span", "menu-item-desc");
  logDesc.textContent = "Audit trail of claims & transfers";
  logText.append(logLabel, logDesc);
  logItem.append(logIcon, logText);
  logItem.onclick = () => {
    closeMenu();
    void openLootLogModal();
  };
  menuDropdown.append(logItem);

  // Backup & Restore
  const div2 = el("div", "menu-divider");
  menuDropdown.append(div2);

  const backupTitle = el("div", "menu-section-title");
  backupTitle.textContent = "Backup & Data";
  menuDropdown.append(backupTitle);

  const exportItem = el("button", "menu-item");
  const exportIcon = el("span", "menu-item-icon");
  exportIcon.textContent = "📥";
  const exportText = el("div", "menu-item-text");
  const exportLabel = el("span", "menu-item-label");
  exportLabel.textContent = "Export JSON Backup";
  const exportDesc = el("span", "menu-item-desc");
  exportDesc.textContent = "Save full inventory to file";
  exportText.append(exportLabel, exportDesc);
  exportItem.append(exportIcon, exportText);
  exportItem.onclick = () => {
    closeMenu();
    void ExportManager.exportInventory(state);
  };
  menuDropdown.append(exportItem);

  if (canManage && fileInput) {
    const importItem = el("button", "menu-item");
    const importIcon = el("span", "menu-item-icon");
    importIcon.textContent = "📤";
    const importText = el("div", "menu-item-text");
    const importLabel = el("span", "menu-item-label");
    importLabel.textContent = "Import JSON Backup";
    const importDesc = el("span", "menu-item-desc");
    importDesc.textContent = "Restore inventory from file";
    importText.append(importLabel, importDesc);
    importItem.append(importIcon, importText);
    importItem.onclick = () => {
      closeMenu();
      fileInput?.click();
    };
    menuDropdown.append(importItem);
  }

  // Dismiss dropdown on window click
  window.addEventListener("click", (e) => {
    if (isMenuOpen && !menuWrap.contains(e.target as Node)) {
      closeMenu();
    }
  });

  menuWrap.append(menuTrigger, menuDropdown);
  actions.append(menuWrap);

  // 3. Close button
  const closeBtn = el("button", "btn-icon");
  closeBtn.textContent = "✕";
  closeBtn.title = "Close";
  closeBtn.onclick = () => void closeWindow(INVENTORY_MODAL_ID);
  actions.append(closeBtn);

  header.append(actions);
  panel.append(header);

  // Status banners
  if (state.isLocked) {
    const banner = el("div", "status-banner locked-banner");
    banner.textContent = "🔒 Inventory is locked against peer transfers.";
    panel.append(banner);
  }

  // Inventory Toolbar: Search, Add Item, Add Section, and Tag Filter
  if (canView) {
    const toolbar = el("div", "inventory-toolbar");

    const searchRow = el("div", "inventory-search-row");
    const inputWrap = el("div", "inventory-search-input-wrap");

    const searchInput = el("input", "inventory-search-input");
    searchInput.type = "text";
    searchInput.placeholder = "🔍 Search items, tags, notes…";
    searchInput.value = searchQuery;
    searchInput.oninput = () => {
      searchQuery = searchInput.value.toLowerCase().trim();
      renderItems();
    };
    inputWrap.append(searchInput);

    if (searchQuery) {
      const clearBtn = el("button", "inventory-search-clear");
      clearBtn.textContent = "✕";
      clearBtn.title = "Clear search";
      clearBtn.onclick = () => {
        searchQuery = "";
        searchInput.value = "";
        renderItems();
      };
      inputWrap.append(clearBtn);
    }
    searchRow.append(inputWrap);

    if (canManage) {
      const addItemBtn = el("button", "btn btn-sm btn-gold");
      addItemBtn.textContent = "+ Add Item";
      addItemBtn.title = "Create a custom item in this inventory";
      addItemBtn.onclick = () => promptCreateOrEditItem();
      searchRow.append(addItemBtn);

      const addSecBtn = el("button", "btn btn-sm");
      addSecBtn.textContent = "+ Section";
      addSecBtn.title = "Create a new inventory section";
      addSecBtn.onclick = () => promptAddSection();
      searchRow.append(addSecBtn);
    }

    toolbar.append(searchRow);

    // Collect all unique tags across items
    const allTags = new Set<string>();
    for (const item of state.items) {
      const tags = item.tags || item.data?.tags;
      if (Array.isArray(tags)) {
        for (const t of tags) {
          if (t && typeof t === "string") allTags.add(t.toLowerCase().trim());
        }
      }
    }

    if (allTags.size > 0) {
      const tagsRow = el("div", "inventory-tags-row");

      const allPill = el("span", `tag-pill ${!activeTagFilter ? "active" : ""}`);
      allPill.textContent = "All";
      allPill.onclick = () => {
        activeTagFilter = null;
        render();
      };
      tagsRow.append(allPill);

      for (const tag of Array.from(allTags).sort()) {
        const pill = el("span", `tag-pill ${activeTagFilter === tag ? "active" : ""}`);
        pill.textContent = `#${tag}`;
        pill.onclick = () => {
          activeTagFilter = activeTagFilter === tag ? null : tag;
          render();
        };
        tagsRow.append(pill);
      }
      toolbar.append(tagsRow);
    }

    panel.append(toolbar);
  }

  // Body: Sections and Item Grid
  const body = el("div", "panel-body inventory-drop-zone");
  panel.append(body);

  function renderItems(): void {
    body.innerHTML = "";

    if (!canView) {
      const note = el("div", "empty-note");
      note.textContent = "This player's inventory is private.";
      body.append(note);
      return;
    }

    // Filter items according to search query and active tag
    const filteredItems = state.items.filter((item) => {
      if (activeTagFilter) {
        const tags = item.tags || item.data?.tags;
        if (!Array.isArray(tags) || !tags.map((t) => String(t).toLowerCase()).includes(activeTagFilter)) {
          return false;
        }
      }

      if (searchQuery) {
        const matchName = item.name.toLowerCase().includes(searchQuery);
        const matchDesc = item.data?.description && String(item.data.description).toLowerCase().includes(searchQuery);
        const matchSec = item.section && item.section.toLowerCase().includes(searchQuery);
        const tags = item.tags || item.data?.tags;
        const matchTag = Array.isArray(tags) && tags.some((t) => String(t).toLowerCase().includes(searchQuery));
        if (!matchName && !matchDesc && !matchSec && !matchTag) return false;
      }

      return true;
    });

    if (state.items.length === 0) {
      const note = el("div", "empty-note");
      note.textContent = "Inventory is empty.";
      const hint = el("div", "empty-hint");
      hint.textContent = canManage ? "Click '+ Add Item' to create an item or drag from a scene loot bag." : "";
      note.append(hint);
      body.append(note);
      return;
    }

    if (filteredItems.length === 0) {
      const note = el("div", "empty-note");
      note.textContent = "No items match your search filter.";
      body.append(note);
      return;
    }

    // Determine sections to show
    const configuredSections = state.sections && state.sections.length > 0
      ? [...state.sections]
      : [...DEFAULT_INVENTORY_SECTIONS];

    // Find any section assigned to an item that isn't in configuredSections
    for (const item of state.items) {
      if (item.section && !configuredSections.includes(item.section)) {
        configuredSections.push(item.section);
      }
    }

    // Older or external clients may still send an item without a section;
    // show it in Other. Empty sections stay available in the selector without
    // cluttering the player-facing inventory.
    const sectionsToRender = configuredSections;

    for (const sec of sectionsToRender) {
      const secItems = filteredItems.filter(
        (i) => (i.section || OTHER_INVENTORY_SECTION) === sec,
      );

      const isDefaultSection = DEFAULT_INVENTORY_SECTIONS.includes(
        sec as DefaultInventorySection,
      );
      if (secItems.length === 0 && (isDefaultSection || searchQuery || activeTagFilter)) {
        continue;
      }

      const secWrapper = el("div", "section-wrapper");
      const secHead = el("button", "section-head");
      secHead.type = "button";

      // Drop target on section header to move dragged item into this section
      if (canManage) {
        secHead.ondragover = (e) => {
          e.preventDefault();
          secHead.style.background = "rgba(212, 175, 55, 0.3)";
        };
        secHead.ondragleave = () => {
          secHead.style.background = "";
        };
        secHead.ondrop = (e) => {
          e.preventDefault();
          secHead.style.background = "";
          const raw = e.dataTransfer?.getData("application/x-master-loot-item");
          if (!raw) return;
          try {
            const payload = JSON.parse(raw);
            if (payload.item?.id) {
              const target = state.items.find((i) => i.id === payload.item.id);
              if (target) {
                target.section = sec;
                if (target.data) target.data.section = target.section;
                saveCurrentState(state);
              }
            }
          } catch (err) {
            console.error("Drop onto section failed", err);
          }
        };
      }

      const left = el("div", "section-head-left");
      const isCollapsed = collapsedSections.has(sec);
      const chev = el("span", "chev");
      chev.textContent = isCollapsed ? "▸" : "▾";

      const titleSpan = el("span", "section-head-title");
      titleSpan.textContent = `📁 ${sec}`;

      const countSpan = el("span", "section-head-count");
      countSpan.textContent = String(secItems.length);

      left.append(chev, titleSpan, countSpan);
      secHead.append(left);

      const right = el("div", "section-head-actions");

      if (canManage) {
        // Quick add item to this section
        const quickAddBtn = el("button", "btn btn-xs");
        quickAddBtn.textContent = "+ Item";
        quickAddBtn.title = `Add item to ${sec}`;
        quickAddBtn.onclick = (e) => {
          e.stopPropagation();
          promptCreateOrEditItem(undefined, sec);
        };
        right.append(quickAddBtn);

        // Delete section button (only for user-defined named sections)
        if (!DEFAULT_INVENTORY_SECTIONS.includes(sec as DefaultInventorySection)) {
          const delSecBtn = el("button", "btn btn-xs btn-danger");
          delSecBtn.textContent = "✕";
          delSecBtn.title = `Delete section "${sec}"`;
          delSecBtn.onclick = (e) => {
            e.stopPropagation();
            deleteSection(sec);
          };
          right.append(delSecBtn);
        }
      }

      secHead.append(right);

      secHead.onclick = () => {
        if (collapsedSections.has(sec)) {
          collapsedSections.delete(sec);
        } else {
          collapsedSections.add(sec);
        }
        renderItems();
      };

      secWrapper.append(secHead);

      if (!isCollapsed) {
        const secBody = el("div", "section-body");
        if (secItems.length === 0) {
          const empty = el("div", "section-empty");
          empty.textContent = "No items in this section.";
          secBody.append(empty);
        } else {
          for (const item of secItems) {
            secBody.append(...renderItemSlot(item, canManage, canInteract));
          }
        }
        secWrapper.append(secBody);
      }

      body.append(secWrapper);
    }
  }

  renderItems();

  // Drag and drop listener on the inventory window
  if (canInteract) {
    body.ondragover = (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      body.classList.add("drag-over");
    };

    body.ondragleave = () => {
      body.classList.remove("drag-over");
    };

    body.ondrop = async (e) => {
      e.preventDefault();
      body.classList.remove("drag-over");
      const raw = e.dataTransfer?.getData("application/x-master-loot-item");
      if (!raw) return;

      try {
        const payload = JSON.parse(raw);
        if (payload.source === "token_bag") {
          // Dropped from token loot container
          const targetPlayer = onlinePlayers.find((p) => p.id === activeUserId);
          const targetName = activeUserId === myId ? myName : (targetPlayer?.name || "Player");

          const res = await TransferManager.tokenToUser({
            tokenId: payload.tokenId,
            tokenName: payload.tokenName || "Loot Bag",
            itemId: payload.item.id,
            quantity: payload.item.quantity || 1,
            targetUserId: activeUserId,
            targetUserName: targetName,
          });

          if (!res.success) {
            alert(res.error || "Failed to transfer item.");
          }
          render();
        } else if (payload.source === "user_inventory" && payload.userId !== activeUserId) {
          // Dropped from another user's inventory
          const targetPlayer = onlinePlayers.find((p) => p.id === activeUserId);
          const targetName = activeUserId === myId ? myName : (targetPlayer?.name || "Player");

          const res = await TransferManager.userToUser({
            sourceUserId: payload.userId,
            sourceUserName: payload.userName || "Player",
            targetUserId: activeUserId,
            targetUserName: targetName,
            itemId: payload.item.id,
            quantity: payload.item.quantity || 1,
            targetIsLocked: state.isLocked,
          });

          if (!res.success) {
            alert(res.error || "Failed to transfer item.");
          }
          render();
        }
      } catch (err) {
        console.error("Failed to parse dropped item", err);
      }
    };
  }

  const footer = el("div", "panel-footer");
  const timeStr = new Date(state.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  footer.textContent = `${state.items.length} item${state.items.length === 1 ? "" : "s"} · Last synced ${timeStr}`;
  panel.append(footer);

  app.append(panel);
}

OBR.onReady(async () => {
  setupWindowResizer({
    windowKey: "inventory",
    type: "popover",
    popoverId: INVENTORY_MODAL_ID,
    defaultWidth: 480,
    defaultHeight: 620,
    minWidth: 360,
    minHeight: 400,
    maxWidth: 1100,
    maxHeight: 1200,
    centered: true,
  });

  myId = await OBR.player.getId();
  myName = await OBR.player.getName();
  myRole = await OBR.player.getRole();

  const urlParams = new URLSearchParams(location.search);
  activeUserId = urlParams.get("user") || myId;

  TransferManager.initialize();
  NetworkProtocol.initialize();

  // Load online players
  onlinePlayers = await OBR.party.getPlayers();
  OBR.party.onChange((players) => {
    onlinePlayers = players;
    render();
  });

  // Listen to network inventory changes
  NetworkProtocol.addListener((msg: SocketMessage) => {
    if (msg.action === "SYNC_INVENTORY") {
      peerInventories.set(msg.senderId, msg.state);
      if (activeUserId === msg.senderId) {
        render();
      }
    } else if (msg.action === "GM_MODIFY_INVENTORY") {
      // This also updates another GM inventory window editing the same
      // player's inventory. The GM's local peer cache is not shared between
      // popover documents, so carry the complete state in the message.
      peerInventories.set(msg.targetUserId, msg.state);
      if (activeUserId === msg.targetUserId) render();
    } else if (msg.action === "TRANSFER_RESULT" || msg.action === "TRANSFER_ITEM") {
      render();
    }
  });

  // Broadcast initial inventory state
  const myState = LocalStorageAdapter.getInventory(myId);
  void NetworkProtocol.syncInventory(myState, myName);

  // Global undo/redo keyboard shortcuts (Ctrl+Z and Ctrl+Y)
  window.addEventListener("keydown", async (e) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) {
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
      e.preventDefault();
      const res = await TransferManager.undoMostRecent(myRole === "GM" ? undefined : myId);
      if (res.success) {
        render();
      } else {
        console.warn(res.error);
      }
    } else if (
      ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") ||
      ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "z")
    ) {
      e.preventDefault();
      const res = await TransferManager.redoMostRecent(myRole === "GM" ? undefined : myId);
      if (res.success) {
        render();
      } else {
        console.warn(res.error);
      }
    }
  });

  render();
});
