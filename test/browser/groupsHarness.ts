import type { Player, Item, Metadata } from "@owlbear-rodeo/sdk";
import { LOOT_KEY } from "../../src/constants";
import type { LootContainer } from "../../src/types";

// A local SDK host for the action panel: a busy scene of loot containers and
// scene metadata that is stored and echoed back, as Owlbear does.
const players: Player[] = [
  { id: "gm", connectionId: "gm-connection", name: "Morgan", role: "GM", color: "#d9aa33", syncView: false, metadata: {} },
  { id: "alice", connectionId: "alice-connection", name: "Alice", role: "PLAYER", color: "#6dcbd0", syncView: false, metadata: {} },
];
const container = (name: string, enabled: boolean): LootContainer =>
  ({ enabled, name, items: [], folders: [], updatedAt: 1 });
const scene: [string, string, boolean][] = [
  ["crow", "Messagercrow", true], ["fat", "Fat Crow", false], ["lee", "Lee Ji-Woo", true],
  ["ye", "Ye Rin", true], ["chun", "Chun Hua", false], ["zhao", "Zhao Feng", false],
];
const items = scene.map(([id, name, enabled]) =>
  ({ id, name, type: "IMAGE", metadata: { [LOOT_KEY]: container(name, enabled) } })) as unknown as Item[];
const sceneMetadata: Metadata = {};
const frames = new Map<string, { el: HTMLIFrameElement; player: Player }>();
const room = document.querySelector("#room")!;

function send(frame: HTMLIFrameElement, id: string, data: unknown): void {
  frame.contentWindow?.postMessage({ id, data }, location.origin);
}
function mount(user: string): void {
  const player = players.find((p) => p.id === user)!;
  const el = document.createElement("iframe");
  const key = `frame-${user}`;
  el.title = `${user} panel`;
  el.style.cssText = "width:340px;height:760px;border:0";
  frames.set(key, { el, player });
  const url = new URL("/action.html", location.origin);
  url.searchParams.set("obrref", btoa(`${location.origin} test-room`));
  el.onload = () => send(el, "OBR_READY", { ref: key, userId: player.id });
  el.src = url.href;
  room.append(el);
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
    case "OBR_PARTY_GET_PLAYERS": response = { players: players.filter((p) => p !== player) }; break;
    case "OBR_SCENE_IS_READY": response = { ready: true }; break;
    case "OBR_ROOM_GET_METADATA": response = { metadata: {} }; break;
    case "OBR_SCENE_GET_METADATA": response = { metadata: structuredClone(sceneMetadata) }; break;
    case "OBR_SCENE_SET_METADATA":
      Object.assign(sceneMetadata, structuredClone(data.update));
      for (const target of frames.values()) {
        send(target.el, "OBR_SCENE_METADATA_EVENT_CHANGE", { metadata: structuredClone(sceneMetadata) });
      }
      break;
    case "OBR_SCENE_ITEMS_GET_ALL_ITEMS": response = { items }; break;
  }
  if (nonce) send(frame.el, `${id}_RESPONSE${nonce}`, response);
});

Object.assign(window, { groupsTest: {
  metadata: () => structuredClone(sceneMetadata),
  /** Any scene change (a token moved) re-sends the items to every panel. */
  changeScene() {
    for (const { el } of frames.values()) send(el, "OBR_SCENE_ITEMS_EVENT_CHANGE", { items });
  },
  /** Closes and reopens a panel; the scene (and its metadata) stays. */
  reopen(user: string) {
    const frame = frames.get(`frame-${user}`)!.el;
    frame.contentWindow?.location.reload();
  },
} });
mount("gm");
mount("alice");
