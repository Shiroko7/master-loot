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
import "@fontsource/cinzel/600.css";
import "./styles/ui.css";
import "./styles/paper.css";
import { DOC_MODAL_ID } from "./constants";
import { closeWindow, setupWindowResizer } from "./windowResizer";
import { getLoot } from "./loot";
import { renderIdCard } from "./idCard";
import { renderDocument, type RenderedDocument } from "./paperRender";
import {
  DEFAULT_PREFS,
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  ZOOM_MAX,
  ZOOM_MIN,
  getPrefs,
  savePrefs,
  type ReadingPrefs,
} from "./storage";
import { LocalStorageAdapter } from "./storage/LocalStorageAdapter";
import { userInventoryItemToLootItem } from "./modules/inventory/UserInventoryModel";
import type { LootItem } from "./types";

const params = new URLSearchParams(location.search);
const tokenId = params.get("token") ?? "";
const docId = params.get("doc") ?? "";
const userId = params.get("user") ?? "";

const app = document.getElementById("app")!;
let prefs: ReadingPrefs = getPrefs();
let rendered: RenderedDocument | undefined;

// --- static shell ---------------------------------------------------------

const page = document.createElement("div");
page.className = "doc-page";

const toolbar = document.createElement("div");
toolbar.className = "doc-toolbar";

const titleEl = document.createElement("span");
titleEl.className = "doc-toolbar-title";

const fontValue = document.createElement("span");
fontValue.className = "value";
const zoomValue = document.createElement("span");
zoomValue.className = "value";

function toolButton(
  label: string,
  ariaLabel: string,
  onClick: () => void,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = "btn-icon";
  btn.textContent = label;
  btn.ariaLabel = ariaLabel;
  btn.title = ariaLabel;
  btn.onclick = onClick;
  return btn;
}

function sep(): HTMLElement {
  const s = document.createElement("span");
  s.className = "sep";
  return s;
}

const scroll = document.createElement("div");
scroll.className = "doc-scroll";
const stage = document.createElement("div");
stage.className = "paper-stage";
scroll.append(stage);

toolbar.append(
  titleEl,
  toolButton("A−", "Smaller text", () => adjustFont(-0.1)),
  fontValue,
  toolButton("A+", "Larger text", () => adjustFont(0.1)),
  sep(),
  toolButton("−", "Zoom out", () => adjustZoom(-0.1)),
  zoomValue,
  toolButton("+", "Zoom in", () => adjustZoom(0.1)),
  sep(),
  toolButton("↺", "Reset text size and zoom", resetPrefs),
  toolButton("✕", "Close", close),
);

page.append(toolbar, scroll);
app.append(page);

// --- behavior --------------------------------------------------------------

function clampRound(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value * 10) / 10));
}

function applyPrefs(): void {
  stage.style.setProperty("--font-scale", String(prefs.fontScale));
  stage.style.setProperty("--zoom", String(prefs.zoom));
  fontValue.textContent = `${Math.round(prefs.fontScale * 100)}%`;
  zoomValue.textContent = `${Math.round(prefs.zoom * 100)}%`;
  savePrefs(prefs);
  // Larger text fits fewer words per page — recount after reflow.
  requestAnimationFrame(() => rendered?.relayout());
}

function adjustFont(delta: number): void {
  prefs.fontScale = clampRound(
    prefs.fontScale + delta,
    FONT_SCALE_MIN,
    FONT_SCALE_MAX,
  );
  applyPrefs();
}

function adjustZoom(delta: number): void {
  prefs.zoom = clampRound(prefs.zoom + delta, ZOOM_MIN, ZOOM_MAX);
  applyPrefs();
}

function resetPrefs(): void {
  prefs = { ...DEFAULT_PREFS };
  applyPrefs();
}

function close(): void {
  void closeWindow(DOC_MODAL_ID);
}

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
  const entry = findEntry(items);
  if (entry?.kind === "idcard") {
    titleEl.textContent = entry.name || "Identification";
    rendered = undefined;
    renderIdCard(stage, entry);
    return;
  }
  const doc = entry?.document;
  if (!entry || !doc) {
    titleEl.textContent = "Document";
    stage.innerHTML = "";
    const note = document.createElement("div");
    note.className = "empty-note";
    note.textContent = "This document is gone.";
    stage.append(note);
    return;
  }
  // The toolbar shows the item's name; untitled papers still have one.
  titleEl.textContent = doc.title || entry.name || "Untitled";
  console.info(
    `Master Loot: rendering "${doc.title}" (style=${doc.style}, texture=${
      doc.texture ?? "(none saved)"
    })`,
  );
  // Re-renders arrive for unrelated scene changes (any token move); keep
  // the reader's place instead of resetting to the top / first page.
  const scrollTop = scroll.scrollTop;
  const page = rendered?.getPage() ?? 0;
  rendered = renderDocument(stage, doc);
  scroll.scrollTop = scrollTop;
  requestAnimationFrame(() => {
    rendered?.relayout();
    rendered?.goTo(page);
  });
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") close();
  if (event.key === "ArrowRight" || event.key === "PageDown") {
    rendered?.next();
  }
  if (event.key === "ArrowLeft" || event.key === "PageUp") {
    rendered?.prev();
  }
});

applyPrefs();

OBR.onReady(async () => {
  setupWindowResizer({
    windowKey: "document",
    type: "popover",
    popoverId: DOC_MODAL_ID,
    defaultWidth: 1100,
    defaultHeight: 820,
    minWidth: 500,
    minHeight: 400,
    maxWidth: 1600,
    maxHeight: 1200,
    centered: true,
  });

  render(await OBR.scene.items.getItems());
  OBR.scene.items.onChange(render);
});
