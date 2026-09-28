import OBR, { type Item } from "@owlbear-rodeo/sdk";
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
import { DOC_MODAL_ID } from "./constants";
import { closeWindow } from "./windowResizer";
import { getLoot } from "./loot";
import { createDocumentReader } from "./documentReader";
import { LocalStorageAdapter } from "./storage/LocalStorageAdapter";
import { userInventoryItemToLootItem } from "./modules/inventory/UserInventoryModel";
import type { LootItem } from "./types";

const params = new URLSearchParams(location.search);
const tokenId = params.get("token") ?? "";
const docId = params.get("doc") ?? "";
const userId = params.get("user") ?? "";

const app = document.getElementById("app")!;

function close(): void {
  void closeWindow(DOC_MODAL_ID);
}

// The same reader the editor's quick preview embeds.
const reader = createDocumentReader({ onClose: close });
app.append(reader.el);

function findEntry(items: Item[]): LootItem | undefined {
  if (userId) {
    const inv = LocalStorageAdapter.getInventory(userId);
    const item = inv.items.find((i) => i.id === docId);
    return item ? userInventoryItemToLootItem(item) : undefined;
  }
  const token = items.find((i) => i.id === tokenId);
  const loot = token ? getLoot(token) : undefined;
  return loot?.items.find((i) => i.id === docId);
}

function render(items: Item[]): void {
  reader.show(findEntry(items));
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
  // Full-screen modal (see openReader in loot.ts): no window resizing.
  render(await OBR.scene.items.getItems());
  OBR.scene.items.onChange(render);
});
