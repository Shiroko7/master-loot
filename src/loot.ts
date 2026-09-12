import OBR, { buildImage, type Image, type Item } from "@owlbear-rodeo/sdk";
import {
  BADGE_KEY,
  DOC_MODAL_ID,
  EDITOR_MODAL_ID,
  INVENTORY_MODAL_ID,
  LOOT_KEY,
  LOOT_LOG_MODAL_ID,
  LOOT_POPOVER_ID,
  SETTINGS_KEY,
  SPARKLE_KEY,
} from "./constants";
import { buildSparkle } from "./sparkle";
import { saveBackup } from "./storage";
import { isLootContainer, type LootContainer } from "./types";

export function getLoot(item: Item): LootContainer | undefined {
  const meta = item.metadata[LOOT_KEY];
  return isLootContainer(meta) ? meta : undefined;
}

export function isBadge(item: Item): boolean {
  return BADGE_KEY in item.metadata;
}

export function isSparkle(item: Item): boolean {
  return SPARKLE_KEY in item.metadata;
}

export async function getToken(tokenId: string): Promise<Item | undefined> {
  const items = await OBR.scene.items.getItems([tokenId]);
  return items[0];
}

export async function saveLoot(
  tokenId: string,
  loot: LootContainer,
): Promise<void> {
  loot.updatedAt = Date.now();
  // Write a detached copy: the SDK runs updates through immer, which
  // deep-freezes the produced state. Assigning `loot` itself would freeze
  // the caller's live object and silently break every edit after the
  // first save.
  const snapshot = structuredClone(loot);
  await OBR.scene.items.updateItems([tokenId], (items) => {
    for (const item of items) {
      item.metadata[LOOT_KEY] = snapshot;
    }
  });
  try {
    saveBackup(OBR.room.id, tokenId, loot);
  } catch (error) {
    // A full localStorage must never fail the real save above.
    console.warn("Master Loot: localStorage backup failed", error);
  }
}

// --- room settings ----------------------------------------------------------

interface RoomSettings {
  badgeCorner?: unknown;
  badgeImage?: unknown;
}

async function getSettings(): Promise<RoomSettings> {
  const metadata = await OBR.room.getMetadata();
  const settings = metadata[SETTINGS_KEY];
  return typeof settings === "object" && settings !== null
    ? (settings as RoomSettings)
    : {};
}

/** Merge into the settings object so one setting never clobbers another. */
async function patchSettings(patch: RoomSettings): Promise<void> {
  const current = await getSettings();
  await OBR.room.setMetadata({ [SETTINGS_KEY]: { ...current, ...patch } });
}

// Inlined so the default badge never depends on the extension's origin —
// no URL to go stale when the deployment moves (localhost -> Netlify, a
// custom domain, etc). Only a GM-entered override is ever a fetched URL.
const DEFAULT_BADGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <defs>
    <radialGradient id="glow" cx="50%" cy="55%" r="50%">
      <stop offset="0%" stop-color="#ffd66b" stop-opacity="0.85"/>
      <stop offset="45%" stop-color="#ffb62e" stop-opacity="0.4"/>
      <stop offset="100%" stop-color="#ffb62e" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="body" cx="36%" cy="30%" r="85%">
      <stop offset="0%" stop-color="#e2ad66"/>
      <stop offset="40%" stop-color="#bd8443"/>
      <stop offset="78%" stop-color="#84551f"/>
      <stop offset="100%" stop-color="#5f3a11"/>
    </radialGradient>
    <linearGradient id="flap" x1="0.2" y1="0" x2="0.7" y2="1">
      <stop offset="0%" stop-color="#d29a5a"/>
      <stop offset="60%" stop-color="#a0703a"/>
      <stop offset="100%" stop-color="#77501f"/>
    </linearGradient>
  </defs>
  <circle cx="64" cy="66" r="57" fill="url(#glow)"/>
  <g transform="rotate(-4 64 72)">
    <path d="M50 48 C34 54 25 70 25 86 C25 104 42 116 64 116 C86 116 103 104 103 86 C103 70 94 54 78 48 Q64 43 50 48 Z"
          fill="url(#body)" stroke="#251503" stroke-width="5" stroke-linejoin="round"/>
    <ellipse cx="47" cy="72" rx="14" ry="18" fill="#f4d194" opacity="0.4" transform="rotate(-20 47 72)"/>
    <path d="M92 58 C101 70 101 92 86 105 C97 92 98 72 92 58 Z" fill="#3f2409" opacity="0.35"/>
    <path d="M46 45 C40 30 50 17 63 17 C60 23 61 28 66 30 C72 20 90 22 93 34 C95 43 88 50 78 51 L55 52 Z"
          fill="url(#flap)" stroke="#251503" stroke-width="5" stroke-linejoin="round"/>
    <path d="M70 32 C76 27 85 28 88 34" fill="none" stroke="#4a2e0e" stroke-width="2.5" stroke-linecap="round" opacity="0.55"/>
    <path d="M52 44 C56 36 63 32 71 33" fill="none" stroke="#4a2e0e" stroke-width="2.5" stroke-linecap="round" opacity="0.45"/>
    <path d="M47 50 Q64 58 81 49" fill="none" stroke="#5c0e08" stroke-width="8" stroke-linecap="round"/>
    <path d="M47 50 Q64 58 81 49" fill="none" stroke="#a82214" stroke-width="4.5" stroke-linecap="round"/>
    <path d="M49 55 Q64 47 79 54" fill="none" stroke="#5c0e08" stroke-width="6" stroke-linecap="round" opacity="0.9"/>
    <path d="M49 55 Q64 47 79 54" fill="none" stroke="#c03322" stroke-width="3.2" stroke-linecap="round"/>
    <path d="M76 55 q8 8 5 18 M70 56 q1 9 -4 16" fill="none" stroke="#a82214" stroke-width="3.4" stroke-linecap="round"/>
    <path d="M76 55 q8 8 5 18 M70 56 q1 9 -4 16" fill="none" stroke="#5c0e08" stroke-width="1.2" stroke-linecap="round" opacity="0.5"/>
    <circle cx="81" cy="74" r="3" fill="#a82214" stroke="#3a0c05" stroke-width="1.6"/>
    <circle cx="66" cy="73" r="2.7" fill="#a82214" stroke="#3a0c05" stroke-width="1.6"/>
  </g>
</svg>`;

const DEFAULT_BADGE_URL = `data:image/svg+xml,${encodeURIComponent(DEFAULT_BADGE_SVG)}`;

function defaultBadgeUrl(): string {
  return DEFAULT_BADGE_URL;
}

/**
 * Resolve a GM-entered badge image (absolute URL or a path like
 * /my-badge.png served from the extension) to an absolute http(s) URL.
 * Anything empty or unusable falls back to the built-in sack.
 */
export function resolveBadgeImage(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return defaultBadgeUrl();
  try {
    const url = new URL(trimmed, window.location.origin);
    if (url.protocol === "http:" || url.protocol === "https:") return url.href;
  } catch {
    // fall through to the default
  }
  return defaultBadgeUrl();
}

function badgeMime(url: string): string {
  if (url.startsWith("data:")) {
    return /^data:([^;,]+)/.exec(url)?.[1] ?? "image/svg+xml";
  }
  const path = url.split("?")[0].toLowerCase();
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".webp")) return "image/webp";
  return "image/png";
}

/** Raw badge-image setting as the GM typed it; "" means the built-in sack. */
export async function getBadgeImageSetting(): Promise<string> {
  const { badgeImage } = await getSettings();
  return typeof badgeImage === "string" ? badgeImage : "";
}

export async function setBadgeImage(value: string): Promise<void> {
  await patchSettings({ badgeImage: value.trim() || undefined });
}

/** Immediately swap every badge in the scene to the given image. */
export async function restyleBadges(url: string): Promise<void> {
  if (!(await OBR.scene.isReady())) return;
  const items = await OBR.scene.items.getItems();
  const badges = items.filter(isBadge).map((badge) => badge.id);
  if (badges.length === 0) return;
  const mime = badgeMime(url);
  await OBR.scene.items.updateItems(badges, (updates) => {
    for (const item of updates) {
      const image = (item as Image).image;
      image.url = url;
      image.mime = mime;
    }
  });
}

export type BadgeCorner =
  | "top-right"
  | "top-left"
  | "bottom-right"
  | "bottom-left";

export const BADGE_CORNERS: readonly BadgeCorner[] = [
  "top-right",
  "top-left",
  "bottom-right",
  "bottom-left",
];

/** Room-wide badge corner preference; defaults to top-right. */
export async function getBadgeCorner(): Promise<BadgeCorner> {
  const { badgeCorner } = await getSettings();
  return BADGE_CORNERS.includes(badgeCorner as BadgeCorner)
    ? (badgeCorner as BadgeCorner)
    : "top-right";
}

export async function setBadgeCorner(corner: BadgeCorner): Promise<void> {
  await patchSettings({ badgeCorner: corner });
}

/** Immediately move every badge in the scene into the given corner. */
export async function resnapBadges(corner: BadgeCorner): Promise<void> {
  if (!(await OBR.scene.isReady())) return;
  const items = await OBR.scene.items.getItems();
  const moves = new Map<string, { x: number; y: number }>();
  for (const badge of items.filter(isBadge)) {
    if (!badge.attachedTo) continue;
    moves.set(badge.id, await badgePosition(badge.attachedTo, corner));
  }
  if (moves.size === 0) return;
  await OBR.scene.items.updateItems([...moves.keys()], (updates) => {
    for (const item of updates) {
      const pos = moves.get(item.id);
      if (pos) item.position = { x: pos.x, y: pos.y };
    }
  });
}

/** Expected badge anchor: just inside the chosen corner of the token. */
export async function badgePosition(
  tokenId: string,
  corner: BadgeCorner,
): Promise<{ x: number; y: number }> {
  const [bounds, dpi] = await Promise.all([
    OBR.scene.items.getItemBounds([tokenId]),
    OBR.scene.grid.getDpi(),
  ]);
  const inset = dpi * 0.18;
  return {
    x: corner.includes("right") ? bounds.max.x - inset : bounds.min.x + inset,
    y: corner.includes("bottom") ? bounds.max.y - inset : bounds.min.y + inset,
  };
}

async function attachBadge(tokenId: string): Promise<void> {
  const url = resolveBadgeImage(await getBadgeImageSetting());
  const badge = buildImage(
    // Rendered size is width/dpi grid cells, so 128/256 is half a cell.
    { url, mime: badgeMime(url), width: 128, height: 128 },
    { dpi: 256, offset: { x: 64, y: 64 } },
  )
    .attachedTo(tokenId)
    .layer("ATTACHMENT")
    .position(await badgePosition(tokenId, await getBadgeCorner()))
    .locked(false)
    .name("Loot")
    .metadata({ [BADGE_KEY]: true })
    .disableAttachmentBehavior(["SCALE", "ROTATION"])
    .build();
  await OBR.scene.items.addItems([badge]);
}

async function attachSparkle(tokenId: string): Promise<void> {
  const bounds = await OBR.scene.items.getItemBounds([tokenId]);
  await OBR.scene.items.addItems([buildSparkle(tokenId, bounds)]);
}

async function findAttachments(
  tokenId: string,
  match: (item: Item) => boolean,
): Promise<Item[]> {
  const attachments = await OBR.scene.items.getItemAttachments([tokenId]);
  return attachments.filter((a) => match(a) && a.attachedTo === tokenId);
}

/** Make the badge + sparkle attachments match the loot's enabled state. */
export async function syncBadge(
  tokenId: string,
  enabled: boolean,
): Promise<void> {
  const [badges, sparkles] = await Promise.all([
    findAttachments(tokenId, isBadge),
    findAttachments(tokenId, isSparkle),
  ]);
  if (enabled) {
    if (badges.length === 0) await attachBadge(tokenId);
    if (sparkles.length === 0) await attachSparkle(tokenId);
  } else {
    const stale = [...badges, ...sparkles];
    if (stale.length > 0) {
      await OBR.scene.items.deleteItems(stale.map((i) => i.id));
    }
  }
}

export interface PopoverAnchor {
  elementId?: string;
  position?: { left: number; top: number };
}

export async function openLootPopover(
  tokenId: string,
  anchor: PopoverAnchor = {},
): Promise<void> {
  await OBR.popover.open({
    id: LOOT_POPOVER_ID,
    url: `/loot.html?token=${encodeURIComponent(tokenId)}`,
    width: 360,
    height: 520,
    hidePaper: true,
    anchorElementId: anchor.elementId,
    anchorPosition: anchor.position,
    anchorReference: anchor.position ? "POSITION" : "ELEMENT",
    anchorOrigin: { horizontal: "CENTER", vertical: "BOTTOM" },
    transformOrigin: { horizontal: "CENTER", vertical: "TOP" },
  });
}

/** Anchor position roughly centered in the viewport. */
export async function centerAnchor(): Promise<{ left: number; top: number }> {
  const [width, height] = await Promise.all([
    OBR.viewport.getWidth(),
    OBR.viewport.getHeight(),
  ]);
  return { left: width / 2, top: height / 4 };
}

export async function openEditorModal(tokenId: string): Promise<void> {
  await OBR.modal.open({
    id: EDITOR_MODAL_ID,
    url: `/editor.html?token=${encodeURIComponent(tokenId)}`,
    width: 980,
    height: 660,
    hidePaper: true,
  });
}

export async function openDocumentModal(
  tokenId: string,
  docId: string,
  size: { width: number; height: number } = { width: 1100, height: 820 },
): Promise<void> {
  await OBR.modal.open({
    id: DOC_MODAL_ID,
    url: `/document.html?token=${encodeURIComponent(tokenId)}&doc=${encodeURIComponent(docId)}`,
    width: size.width,
    height: size.height,
    hidePaper: true,
  });
}

export async function openUserDocumentModal(
  userId: string,
  docId: string,
  size: { width: number; height: number } = { width: 1100, height: 820 },
): Promise<void> {
  await OBR.modal.open({
    id: DOC_MODAL_ID,
    url: `/document.html?user=${encodeURIComponent(userId)}&doc=${encodeURIComponent(docId)}`,
    width: size.width,
    height: size.height,
    hidePaper: true,
  });
}

export async function openInventoryModal(targetUserId?: string): Promise<void> {
  const url = targetUserId
    ? `/inventory.html?user=${encodeURIComponent(targetUserId)}`
    : `/inventory.html`;
  await OBR.modal.open({
    id: INVENTORY_MODAL_ID,
    url,
    width: 480,
    height: 620,
    hidePaper: true,
  });
}

export async function openLootLogModal(): Promise<void> {
  await OBR.modal.open({
    id: LOOT_LOG_MODAL_ID,
    url: `/loot-log.html`,
    width: 820,
    height: 600,
    hidePaper: true,
  });
}
