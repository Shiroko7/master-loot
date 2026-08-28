import OBR, { type Item } from "@owlbear-rodeo/sdk";
import "@fontsource/cinzel/600.css";
import "./styles/ui.css";
import { LOOT_POPOVER_ID } from "./constants";
import { buildCoinChips, buildCoinConverter } from "./coins";
import { safeHttpUrl } from "./fiveETools";
import { getLoot, openDocumentModal } from "./loot";
import {
  RARITY_META,
  formatCoins,
  groupLootItems,
  type CoinKind,
  type LootItem,
} from "./types";

const app = document.getElementById("app")!;
const tokenId = new URLSearchParams(location.search).get("token") ?? "";

let role: "GM" | "PLAYER" = "PLAYER";
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
 * Coin slot plus (when open) a converter panel. The panel is a sibling of
 * the slot button — a <select> can't live inside a <button>.
 */
function renderCurrencySlot(item: LootItem): HTMLElement[] {
  const coins = item.coins ?? {};
  const slot = el("button", "slot");
  slot.style.setProperty("--rarity", RARITY_META[item.rarity].color);

  const icon = el("span", "slot-icon");
  icon.textContent = item.icon || "🪙";
  const name = el("span", "slot-name");
  name.textContent = item.name;
  const sub = el("span", "slot-sub");
  sub.textContent = formatCoins(coins);
  name.append(sub);
  slot.append(icon, name, el("span", "slot-qty"));

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

function renderSlot(item: LootItem): HTMLElement {
  const slot = el("button", "slot");
  slot.style.setProperty("--rarity", RARITY_META[item.rarity].color);

  const icon = el("span", "slot-icon");
  icon.textContent =
    item.icon ||
    (item.kind === "document" ? "📜" : item.kind === "idcard" ? "🪪" : "🪙");

  const name = el("span", "slot-name");
  name.textContent = item.name;
  if (item.kind === "document" || item.kind === "idcard") {
    const sub = el("span", "slot-sub");
    sub.textContent = item.kind === "document" ? "Click to read" : "Click to inspect";
    name.append(sub);
  }

  const qty = el("span", "slot-qty");
  qty.textContent = item.quantity > 1 ? `×${item.quantity}` : "";

  slot.append(icon, name, qty);

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

function render(items: Item[]): void {
  const token = items.find((i) => i.id === tokenId);
  const loot = token ? getLoot(token) : undefined;

  app.innerHTML = "";
  const panel = el("div", "panel");

  const header = el("div", "panel-header");
  const title = el("h1", "panel-title");
  title.textContent = loot?.name || token?.name || "Loot";
  const close = el("button", "btn-icon");
  close.textContent = "✕";
  close.ariaLabel = "Close";
  close.onclick = () => void OBR.popover.close(LOOT_POPOVER_ID);
  header.append(title, close);
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
        if (item.kind === "currency") body.append(...renderCurrencySlot(item));
        else body.append(renderSlot(item));
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
  role = await OBR.player.getRole();
  await refresh();
  OBR.scene.items.onChange(render);
});
