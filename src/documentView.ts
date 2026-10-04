import OBR, { type Item, type Player } from "@owlbear-rodeo/sdk";
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
import "@fontsource/kaushan-script/400.css";
import "@fontsource/cinzel/600.css";
import "./styles/ui.css";
import "./styles/paper.css";
import { DOC_MODAL_ID, VIEWING_KEY } from "./constants";
import { closeWindow } from "./windowResizer";
import { getLoot, peerInventoryKey } from "./loot";
import { createDocumentReader } from "./documentReader";
import { LocalStorageAdapter } from "./storage/LocalStorageAdapter";
import { NetworkProtocol } from "./inventory/NetworkProtocol";
import {
  sanitizeInventoryState,
  userInventoryItemToLootItem,
  type UserInventoryState,
} from "./modules/inventory/UserInventoryModel";
import type { LootItem } from "./types";
import { createViewReporter } from "./viewPresence";
import { readViewingStatus } from "./viewPresenceState";
import type { DocumentViewer } from "./documentReader";

const params = new URLSearchParams(location.search);
const tokenId = params.get("token") ?? "";
const docId = params.get("doc") ?? "";
const userId = params.get("user") ?? "";

const app = document.getElementById("app")!;

let viewReporter: ReturnType<typeof createViewReporter> | undefined;
function close(): void {
  void (async () => {
    await viewReporter?.close();
    await closeWindow(DOC_MODAL_ID);
  })();
}

// The same reader the editor's quick preview embeds.
const reader = createDocumentReader({
  onClose: close,
  onReadingChange: ({ entry, position, atEnd }) => {
    if (!entry) { viewReporter?.show(null); return; }
    viewReporter?.show({
      kind: entry.document ? "document" : entry.kind === "idcard" ? "idcard" : "picture",
      id: entry.id,
      name: entry.document?.title || entry.name || "Untitled",
      sourceId: userId || tokenId,
      ...position,
      atEnd,
    });
  },
});
app.append(reader.el);

let myId = "";
let partyPlayers: Player[] = [];
/** Latest copy of another player's inventory (it lives in their browser). */
let peerState: UserInventoryState | undefined;

function readHandoff(): UserInventoryState | undefined {
  try {
    const raw = localStorage.getItem(peerInventoryKey(userId));
    return raw ? sanitizeInventoryState(JSON.parse(raw), userId) : undefined;
  } catch {
    return undefined;
  }
}

function findEntry(items: Item[]): LootItem | undefined {
  if (userId) {
    const inv =
      userId === myId
        ? LocalStorageAdapter.getInventory(userId)
        : (peerState ?? LocalStorageAdapter.getInventory(userId));
    const item = inv.items.find((i) => i.id === docId);
    return item ? userInventoryItemToLootItem(item) : undefined;
  }
  const token = items.find((i) => i.id === tokenId);
  const loot = token ? getLoot(token) : undefined;
  return loot?.items.find((i) => i.id === docId);
}

function render(items: Item[]): void {
  reader.show(findEntry(items));
  updateDocumentViewers();
}

function updateDocumentViewers(): void {
  const sourceId = userId || tokenId;
  const viewers: DocumentViewer[] = [];
  for (const player of partyPlayers) {
    if (player.id === myId) continue;
    const status = readViewingStatus(player.metadata?.[VIEWING_KEY]);
    const location = status?.location;
    if (!location || location.kind !== "document" || location.id !== docId) continue;
    if (location.sourceId && location.sourceId !== sourceId) continue;
    viewers.push({ id: player.id, name: player.name, location, hidden: status.hidden });
  }
  viewers.sort((a, b) => a.name.localeCompare(b.name));
  reader.setViewers(viewers);
}

async function refreshParty(): Promise<void> {
  try {
    partyPlayers = await OBR.party.getPlayers();
    updateDocumentViewers();
  } catch {
    // The reader can remain usable while the room connection reconnects.
  }
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") close();
  if (event.key === "ArrowRight" || event.key === "PageDown") {
    reader.next();
  }
  if (event.key === "ArrowLeft" || event.key === "PageUp") {
    reader.prev();
  }
});

OBR.onReady(async () => {
  viewReporter = createViewReporter();
  // Full-screen modal (see openReader in loot.ts): no window resizing.
  myId = await OBR.player.getId();
  partyPlayers = await OBR.party.getPlayers();
  OBR.party.onChange((players) => {
    partyPlayers = players;
    updateDocumentViewers();
  });
  // Party events are normally immediate, but a reconnect can deliver a stale
  // snapshot first. Polling keeps the list accurate without touching the
  // reader's content or page position.
  window.setInterval(() => void refreshParty(), 1_500);
  if (userId && userId !== myId) {
    peerState = readHandoff();
    // Follow the owner's inventory live, and ask for a fresh copy.
    NetworkProtocol.addListener(async (msg) => {
      const state =
        msg.action === "SYNC_INVENTORY" && msg.senderId === userId
          ? msg.state
          : msg.action === "GM_MODIFY_INVENTORY" && msg.targetUserId === userId
            ? msg.state
            : undefined;
      if (!state) return;
      peerState = state;
      render(await OBR.scene.items.getItems());
    });
    void NetworkProtocol.requestInventory(userId, myId);
  }
  render(await OBR.scene.items.getItems());
  OBR.scene.items.onChange(render);
  OBR.scene.onReadyChange((ready) => {
    if (ready) void OBR.scene.items.getItems().then(render);
    else reader.show(undefined);
  });
});
