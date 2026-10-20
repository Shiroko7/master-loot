import type { Item } from "@owlbear-rodeo/sdk";
import { LOOT_KEY } from "../../src/constants";
import { createContainer, createLootDocument } from "../../src/types";

// A local SDK host for the loot editor: one token holding a long letter,
// and an Owlbear image picker that hands back a fixed upload.
const loot = createContainer("Chest");
const letter = createLootDocument("letter");
letter.name = "Long letter";
letter.document!.content = Array.from({ length: 120 }, (_, i) => `Line ${i + 1} of the letter.`).join("\n");
loot.items.push(letter);
const token = { id: "chest", name: "Chest", type: "IMAGE", visible: true, metadata: { [LOOT_KEY]: loot } } as unknown as Item;
const room = document.querySelector("#room")!;
const frame = document.createElement("iframe");
frame.title = "editor";
frame.style.cssText = "width:980px;height:660px;border:0";

function send(id: string, data: unknown): void {
  frame.contentWindow?.postMessage({ id, data }, location.origin);
}

window.addEventListener("message", (event) => {
  if (event.origin !== location.origin || typeof event.data?.id !== "string") return;
  if (frame.contentWindow !== event.source) return;
  const { id, data, nonce } = event.data;
  let response: Record<string, unknown> = {};
  switch (id) {
    case "OBR_PLAYER_GET_ROLE": response = { role: "GM" }; break;
    case "OBR_PLAYER_GET_ID": response = { id: "gm" }; break;
    case "OBR_SCENE_ITEMS_GET_ITEMS": response = { items: [token] }; break;
    case "OBR_SCENE_ITEMS_GET_ALL_ITEMS": response = { items: [token] }; break;
    case "OBR_SCENE_GET_METADATA": response = { metadata: {} }; break;
    case "OBR_ASSETS_DOWNLOAD_IMAGES":
      response = { images: [{ image: { url: "https://example.com/upload.png" } }] };
      break;
    case "OBR_SCENE_ITEMS_UPDATE_ITEMS": void data; break;
  }
  if (nonce) send(`${id}_RESPONSE${nonce}`, response);
});

const url = new URL("/editor.html", location.origin);
url.searchParams.set("token", "chest");
url.searchParams.set("obrref", btoa(`${location.origin} test-room`));
frame.onload = () => send("OBR_READY", { ref: "editor", userId: "gm" });
frame.src = url.href;
room.append(frame);
Object.assign(window, { editorTest: { reload: () => frame.contentWindow?.location.reload() } });
