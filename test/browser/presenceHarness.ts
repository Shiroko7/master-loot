import type { Player, Item } from "@owlbear-rodeo/sdk";
import { LOOT_KEY } from "../../src/constants";
import type { LootItem, LootContainer } from "../../src/types";

// A local SDK host: production iframes exchange actual SDK messages while the
// test room supplies players, scene items, and connection-scoped broadcasts.
const players: Player[] = [
  { id: "gm", connectionId: "gm-connection", name: "Morgan", role: "GM", color: "#d9aa33", syncView: false, metadata: {} },
  { id: "alice", connectionId: "alice-connection", name: "Alice", role: "PLAYER", color: "#6dcbd0", syncView: false, metadata: {} },
  { id: "bob", connectionId: "bob-connection", name: "Bob", role: "PLAYER", color: "#b49be8", syncView: false, metadata: {} },
];
const book: LootItem = {
  id: "book", name: "Captain's journal", kind: "document", icon: "📖", quantity: 1, rarity: "none",
  document: { style: "book", title: "Captain's journal", font: "im-fell-english",
    content: ["The captain writes of the northern road.", "The bridge is still open.", "The last entry is signed."].join("\n\n---\n\n") },
};
const newspaper: LootItem = {
  ...book, id: "news", name: "Gazette", document: {
    style: "newspaper", title: "Gazette", content: Array.from({ length: 5 }, (_, i) =>
      `# Dispatch ${i + 1}\n\nNews from the northern road. Merchants crossed the bridge safely.`).join("\n\n---\n\n"),
  },
};
const letter: LootItem = { ...book, id: "letter", name: "Long letter", document: {
  style: "letter", title: "Long letter", content: Array.from({ length: 50 }, (_, i) =>
    `Entry ${i + 1}: The captain writes of the northern road, the market, and the travelers who arrived at dusk.`).join("\n\n"),
} };
const longBook: LootItem = { ...letter, id: "long-book", name: "Travel notes",
  document: { ...letter.document!, style: "book", title: "Travel notes" } };
const portrait: LootItem = { id: "portrait", name: "Captain's portrait", kind: "picture", icon: "🖼️", quantity: 1, rarity: "none",
  imageUrl: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="tan"/></svg>')}` };
const idCard: LootItem = { id: "card", name: "Guild papers", kind: "idcard", icon: "🪪", quantity: 1, rarity: "none",
  profile: { name: "Captain", occupation: "Merchant" } };
const loot: LootContainer = { enabled: true, takeable: false, name: "Captain's chest",
  items: [book, newspaper, letter, longBook, portrait, idCard], updatedAt: 1 };
const items = [{ id: "chest", name: "Chest", type: "IMAGE", metadata: { [LOOT_KEY]: loot } }] as Item[];
const frames = new Map<string, { el: HTMLIFrameElement; player: Player }>();
let frameNumber = 0;
const room = document.querySelector("#room")!;
function send(frame: HTMLIFrameElement, id: string, data: unknown): void {
  frame.contentWindow?.postMessage({ id, data }, location.origin);
}
function partyChanged(): void {
  for (const { el, player } of frames.values()) {
    send(el, "OBR_PLAYER_EVENT_CHANGE", { player });
    send(el, "OBR_PARTY_EVENT_CHANGE", { players: players.filter((p) => p.connectionId !== player.connectionId) });
  }
}
function mount(user: string, path: string, label: string): void {
  const player = players.find((p) => p.id === user)!;
  const el = document.createElement("iframe");
  const key = `frame-${++frameNumber}`;
  el.title = label;
  el.dataset.frameKey = key;
  el.style.cssText = path.includes("Background") ? "width:1px;height:1px;border:0;position:absolute;left:-10px" :
    path.startsWith("/action") ? "width:340px;height:650px;border:0" : "width:1000px;height:850px;border:0";
  frames.set(key, { el, player });
  const url = new URL(path, location.origin);
  url.searchParams.set("obrref", btoa(`${location.origin} test-room`));
  el.onload = () => send(el, "OBR_READY", { ref: key, userId: player.id });
  el.src = url.href;
  room.append(el);
}
function remove(label: string): void {
  for (const [key, frame] of frames) {
    if (frame.el.title !== label) continue;
    frame.el.remove();
    frames.delete(key);
  }
}

window.addEventListener("message", (event) => {
  if (event.origin !== location.origin || typeof event.data?.id !== "string") return;
  const frame = frames.get(event.data.ref);
  if (!frame || frame.el.contentWindow !== event.source) return;
  const { id, data, nonce } = event.data;
  const { player } = frame;
  let response: Record<string, unknown> = {};
  switch (id) {
    case "OBR_PLAYER_GET_ID": response = { id: player.id }; break;
    case "OBR_PLAYER_GET_NAME": response = { name: player.name }; break;
    case "OBR_PLAYER_GET_ROLE": response = { role: player.role }; break;
    case "OBR_PLAYER_GET_CONNECTION_ID": response = { connectionId: player.connectionId }; break;
    case "OBR_PLAYER_GET_METADATA": response = { metadata: player.metadata }; break;
    case "OBR_PLAYER_SET_METADATA": Object.assign(player.metadata, data.update); partyChanged(); break;
    case "OBR_PARTY_GET_PLAYERS": response = { players: players.filter((p) => p !== player) }; break;
    case "OBR_SCENE_IS_READY": response = { ready: true }; break;
    case "OBR_SCENE_GET_METADATA": case "OBR_ROOM_GET_METADATA": response = { metadata: {} }; break;
    case "OBR_SCENE_ITEMS_GET_ALL_ITEMS": response = { items }; break;
    case "OBR_SCENE_ITEMS_GET_ITEMS": response = { items: items.filter((item) => data.ids.includes(item.id)) }; break;
    case "OBR_VIEWPORT_GET_WIDTH": response = { width: 1280 }; break;
    case "OBR_VIEWPORT_GET_HEIGHT": response = { height: 1100 }; break;
    case "OBR_BROADCAST_SEND_MESSAGE":
      for (const target of frames.values()) {
        const local = target.player.connectionId === player.connectionId;
        const destination = data.options?.destination ?? "REMOTE";
        if ((destination === "LOCAL" && !local) || (destination === "REMOTE" && local)) continue;
        send(target.el, `OBR_BROADCAST_MESSAGE_${data.channel}`, { data: data.data, connectionId: player.connectionId });
      }
      break;
    case "OBR_MODAL_CLOSE": if (data.id.endsWith("document-modal")) remove(`${player.id} reader`); break;
  }
  if (nonce) send(frame.el, `${id}_RESPONSE${nonce}`, response);
});

Object.assign(window, { presenceTest: {
  open(user: string, doc = "book") { mount(user, `/document.html?token=chest&doc=${doc}`, `${user} reader`); },
  loot(user: string) { mount(user, "/loot.html?token=chest", `${user} loot`); },
  inventory(user: string) { mount(user, "/inventory.html", `${user} inventory`); },
  inventoryReader(user: string, owner: string, doc: string) {
    mount(user, `/document.html?user=${owner}&doc=${doc}`, `${user} reader`);
  },
  action(user: string) { mount(user, "/action.html", `${user} panel`); },
  remove,
  changeScene() {
    for (const { el } of frames.values()) send(el, "OBR_SCENE_ITEMS_EVENT_CHANGE", { items });
  },
  removeDocument(doc: string) {
    loot.items = loot.items.filter((item) => item.id !== doc);
    for (const { el } of frames.values()) send(el, "OBR_SCENE_ITEMS_EVENT_CHANGE", { items });
  },
  disconnect(user: string) {
    const index = players.findIndex((player) => player.id === user);
    if (index >= 0) players.splice(index, 1);
    for (const frame of [...frames.values()]) if (frame.player.id === user) remove(frame.el.title);
    partyChanged();
  },
  players,
} });
for (const player of players) mount(player.id, "/test/browser/presenceBackground.html", `${player.id} background`);
mount("gm", "/action.html", "gm panel");
