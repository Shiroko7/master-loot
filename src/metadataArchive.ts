import OBR, { type Item, type Metadata } from "@owlbear-rodeo/sdk";
import { EXT_ID, LOOT_KEY, LOOT_LOG_KEY, ORDER_KEY, SETTINGS_KEY } from "./constants";
import { LootLogService } from "./inventory/LootLogService";
import { packLoot, unpackLoot } from "./metadataCodec";
import { isLootContainer, type LootContainer, type LootItem } from "./types";

/*
 * Everything here is Owlbear metadata: stored on Owlbear's servers and
 * shared with every player in the room — not per-client storage.
 */

/**
 * Owlbear docs: "In total the room metadata must be under 16kB", shared by
 * every extension in the room (our settings + loot log live there). Read as
 * 16,000 bytes so the meter never under-reports.
 */
export const ROOM_METADATA_BUDGET_BYTES = 16_000;

/*
 * Owlbear documents no cap for scene or item metadata, so these are soft
 * limits: past them, syncing loot to every player gets slow.
 */
/** Soft limit for all loot stored in one scene (containers + order). */
export const SCENE_LOOT_BUDGET_BYTES = 200_000;
/** Soft limit for a single container (one token's item metadata). */
export const CONTAINER_BUDGET_BYTES = 50_000;

/** Share of a budget at which users are warned to free up space. */
export const WARN_RATIO = 0.8;

export type UsageLevel = "ok" | "warn" | "over";

export function usageLevel(bytes: number, budget: number): UsageLevel {
  if (bytes > budget) return "over";
  return bytes >= budget * WARN_RATIO ? "warn" : "ok";
}

const encoder = new TextEncoder();

/** UTF-8 size of a value as Owlbear stores it (JSON). */
export function byteSize(value: unknown): number {
  return value === undefined ? 0 : encoder.encode(JSON.stringify(value)).length;
}

export function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} kB`;
}

function keyedSize(key: string, value: unknown): number {
  return value === undefined ? 0 : byteSize({ [key]: value });
}

export interface RoomUsage {
  total: number;
  settings: number;
  lootLog: number;
  /** Everything outside Master Loot's own keys (other extensions). */
  others: number;
}

export function measureRoom(metadata: Metadata): RoomUsage {
  const ours = Object.keys(metadata)
    .filter((key) => key.startsWith(`${EXT_ID}/`))
    .reduce((sum, key) => sum + keyedSize(key, metadata[key]), 0);
  const total = byteSize(metadata);
  return {
    total,
    settings: keyedSize(SETTINGS_KEY, metadata[SETTINGS_KEY]),
    lootLog: keyedSize(LOOT_LOG_KEY, metadata[LOOT_LOG_KEY]),
    others: Math.max(0, total - ours),
  };
}

export interface ContainerUsage {
  tokenId: string;
  tokenName: string;
  loot: LootContainer;
  bytes: number;
}

export interface ItemUsage {
  tokenId: string;
  containerName: string;
  item: LootItem;
  bytes: number;
}

export interface SceneUsage {
  total: number;
  containers: ContainerUsage[];
  items: ItemUsage[];
}

export function measureScene(items: Item[], sceneMetadata: Metadata): SceneUsage {
  const containers: ContainerUsage[] = [];
  const lootItems: ItemUsage[] = [];
  for (const token of items) {
    const stored = token.metadata[LOOT_KEY];
    const loot = unpackLoot(stored);
    if (!loot) continue;
    const containerName = loot.name || token.name;
    const bytes = keyedSize(LOOT_KEY, stored);
    containers.push({ tokenId: token.id, tokenName: token.name, loot, bytes });
    // Stored loot is compressed as a whole, so an item's cost is its share
    // of the container's stored size.
    const raw = loot.items.map((item) => byteSize(item));
    const rawTotal = raw.reduce((sum, size) => sum + size, 0) || 1;
    loot.items.forEach((item, index) => {
      lootItems.push({
        tokenId: token.id,
        containerName,
        item,
        bytes: Math.max(1, Math.round((bytes * raw[index]) / rawTotal)),
      });
    });
  }
  const total =
    containers.reduce((sum, c) => sum + c.bytes, 0) +
    keyedSize(ORDER_KEY, sceneMetadata[ORDER_KEY]);
  return { total, containers, items: lootItems };
}

// --- archive files -------------------------------------------------------------

const ARCHIVE_FORMAT = "master-loot-archive";
const ARCHIVE_VERSION = 1;

export interface ArchivedContainer {
  tokenId: string;
  tokenName: string;
  loot: LootContainer;
  /**
   * Only some of the container's items were archived: restoring merges them
   * back into the token's loot instead of replacing it.
   */
  partial?: boolean;
}

interface ArchiveFile {
  format: typeof ARCHIVE_FORMAT;
  version: number;
  exportedAt: number;
  roomId: string;
  containers: ArchivedContainer[];
}

function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "loot";
}

function stamp(): string {
  return new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
}

export function downloadArchive(entries: ArchivedContainer[], label: string): void {
  const file: ArchiveFile = {
    format: ARCHIVE_FORMAT,
    version: ARCHIVE_VERSION,
    exportedAt: Date.now(),
    roomId: OBR.room.id,
    containers: entries,
  };
  downloadJson(`master-loot-${slug(label)}-${stamp()}.json`, file);
}

export function downloadContainers(containers: ContainerUsage[]): void {
  downloadArchive(
    containers.map(({ tokenId, tokenName, loot }) => ({ tokenId, tokenName, loot })),
    containers.length === 1
      ? containers[0].loot.name || containers[0].tokenName
      : `${containers.length}-containers`,
  );
}

/** Archive entry holding just `item`, restorable into its container. */
export function itemArchiveEntry(usage: ItemUsage, token: ContainerUsage): ArchivedContainer {
  return {
    tokenId: usage.tokenId,
    tokenName: token.tokenName,
    loot: { ...token.loot, items: [usage.item] },
    partial: true,
  };
}

export function parseArchive(text: string): ArchivedContainer[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  const file = parsed as Partial<ArchiveFile>;
  if (file?.format !== ARCHIVE_FORMAT || !Array.isArray(file.containers)) {
    throw new Error("That file isn't a Master Loot archive.");
  }
  const containers = file.containers.filter(
    (entry): entry is ArchivedContainer =>
      typeof entry?.tokenId === "string" && isLootContainer(entry.loot),
  );
  if (containers.length === 0) throw new Error("The archive holds no loot containers.");
  return containers.map((entry) => ({
    tokenId: entry.tokenId,
    tokenName: typeof entry.tokenName === "string" ? entry.tokenName : "",
    loot: entry.loot,
    partial: entry.partial === true,
  }));
}

/**
 * Strips the loot containers off their tokens. The background script then
 * removes their badges and sparkles, like for any token without loot.
 */
export async function removeContainers(tokenIds: string[]): Promise<void> {
  if (tokenIds.length === 0) return;
  await OBR.scene.items.updateItems(tokenIds, (items) => {
    for (const item of items) delete item.metadata[LOOT_KEY];
  });
  const metadata = await OBR.scene.getMetadata();
  const order = metadata[ORDER_KEY];
  if (Array.isArray(order)) {
    const removed = new Set(tokenIds);
    await OBR.scene.setMetadata({
      [ORDER_KEY]: order.filter((id) => !removed.has(id as string)),
    });
  }
}

/** Removes single items from a token's container. */
export async function removeItems(tokenId: string, itemIds: string[]): Promise<void> {
  const removed = new Set(itemIds);
  await OBR.scene.items.updateItems([tokenId], (items) => {
    for (const item of items) {
      const loot = unpackLoot(item.metadata[LOOT_KEY]);
      if (!loot) continue;
      item.metadata[LOOT_KEY] = packLoot({
        ...structuredClone(loot),
        items: structuredClone(loot.items.filter((entry) => !removed.has(entry.id))),
        updatedAt: Date.now(),
      });
    }
  });
}

/**
 * Writes archived loot onto tokens. Full containers replace the token's
 * loot; partial ones merge their items (and folders) into it.
 */
export async function restoreContainers(
  targets: Map<string, ArchivedContainer>,
): Promise<void> {
  if (targets.size === 0) return;
  // Detached copies: the SDK freezes whatever we assign into metadata.
  const archived = new Map([...targets].map(([id, entry]) => [id, structuredClone(entry)]));
  await OBR.scene.items.updateItems([...archived.keys()], (items) => {
    for (const item of items) {
      const entry = archived.get(item.id)!;
      const current = unpackLoot(item.metadata[LOOT_KEY]);
      if (!entry.partial || !current) {
        item.metadata[LOOT_KEY] = packLoot({ ...entry.loot, updatedAt: Date.now() });
        continue;
      }
      const base = structuredClone(current);
      const ids = new Set(base.items.map((existing) => existing.id));
      const folders = [...(base.folders ?? [])];
      for (const folder of entry.loot.folders ?? []) {
        if (!folders.includes(folder)) folders.push(folder);
      }
      item.metadata[LOOT_KEY] = packLoot({
        ...base,
        folders,
        items: [...base.items, ...entry.loot.items.filter((e) => !ids.has(e.id))],
        updatedAt: Date.now(),
      });
    }
  });
}

// --- loot log --------------------------------------------------------------------

export async function downloadLootLog(): Promise<number> {
  const logs = await LootLogService.getLogs();
  downloadJson(`master-loot-log-${stamp()}.json`, {
    format: "master-loot-log",
    exportedAt: Date.now(),
    roomId: OBR.room.id,
    logs,
  });
  return logs.length;
}

// --- warnings --------------------------------------------------------------------

const LEVEL_RANK: Record<UsageLevel, number> = { ok: 0, warn: 1, over: 2 };

export interface StorageWarning {
  level: UsageLevel;
  /** What is heavy, e.g. "the room data (13.2 kB of 16.0 kB)". */
  subject: string;
}

/** The most urgent of the room, scene and largest-container budgets. */
export function storageWarning(room: RoomUsage, scene: SceneUsage): StorageWarning {
  const largest = scene.containers.reduce<ContainerUsage | undefined>(
    (max, c) => (!max || c.bytes > max.bytes ? c : max),
    undefined,
  );
  const candidates: StorageWarning[] = [
    {
      level: usageLevel(room.total, ROOM_METADATA_BUDGET_BYTES),
      subject: `the room data (${formatBytes(room.total)} of ${formatBytes(ROOM_METADATA_BUDGET_BYTES)})`,
    },
    {
      level: usageLevel(scene.total, SCENE_LOOT_BUDGET_BYTES),
      subject: `this scene's loot (${formatBytes(scene.total)} of ${formatBytes(SCENE_LOOT_BUDGET_BYTES)})`,
    },
  ];
  if (largest) {
    candidates.push({
      level: usageLevel(largest.bytes, CONTAINER_BUDGET_BYTES),
      subject: `“${largest.loot.name || largest.tokenName}” (${formatBytes(largest.bytes)} of ${formatBytes(CONTAINER_BUDGET_BYTES)})`,
    });
  }
  return candidates.reduce((worst, c) => (LEVEL_RANK[c.level] > LEVEL_RANK[worst.level] ? c : worst));
}

let lastWarned: UsageLevel = "ok";

/**
 * Called after every loot save: notifies the GM once each time storage
 * crosses into the warning or over-budget zone.
 */
export async function warnIfLootHeavy(): Promise<void> {
  if ((await OBR.player.getRole()) !== "GM") return;
  const [items, sceneMeta, roomMeta] = await Promise.all([
    OBR.scene.items.getItems(),
    OBR.scene.getMetadata(),
    OBR.room.getMetadata(),
  ]);
  const warning = storageWarning(measureRoom(roomMeta), measureScene(items, sceneMeta));
  const escalated = LEVEL_RANK[warning.level] > LEVEL_RANK[lastWarned];
  lastWarned = warning.level;
  if (!escalated) return;
  await OBR.notification.show(
    warning.level === "over"
      ? `Master Loot: ${warning.subject} is over its storage limit. Open 💾 Storage to archive some loot.`
      : `Master Loot: ${warning.subject} is getting full. Consider archiving old loot in 💾 Storage.`,
    warning.level === "over" ? "ERROR" : "WARNING",
  );
}
