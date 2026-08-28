import { BACKUP_STORAGE_PREFIX, PREFS_STORAGE_KEY } from "./constants";
import type { LootContainer } from "./types";

/** Reading accessibility preferences, persisted per browser. */
export interface ReadingPrefs {
  /** Multiplier applied to the document text size. */
  fontScale: number;
  /** Multiplier applied to the whole page (paper and text). */
  zoom: number;
}

export const DEFAULT_PREFS: ReadingPrefs = { fontScale: 1, zoom: 1 };

export const FONT_SCALE_MIN = 0.7;
export const FONT_SCALE_MAX = 2.2;
export const ZOOM_MIN = 0.6;
export const ZOOM_MAX = 2;

function read<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage may be unavailable (private browsing, blocked cookies); the
    // extension still works, prefs and backups just won't persist.
  }
}

export function getPrefs(): ReadingPrefs {
  return { ...DEFAULT_PREFS, ...read<Partial<ReadingPrefs>>(PREFS_STORAGE_KEY) };
}

export function savePrefs(prefs: ReadingPrefs): void {
  write(PREFS_STORAGE_KEY, prefs);
}

interface BackupEntry {
  loot: LootContainer;
  savedAt: number;
}

type RoomBackup = Record<string, BackupEntry>;

function backupKey(roomId: string): string {
  return `${BACKUP_STORAGE_PREFIX}${roomId}`;
}

/**
 * Mirror of every loot container the GM saved in this room, kept in this
 * browser's localStorage as a safety net (e.g. a token gets deleted or the
 * scene metadata is lost).
 */
export function saveBackup(
  roomId: string,
  tokenId: string,
  loot: LootContainer,
): void {
  const room = read<RoomBackup>(backupKey(roomId)) ?? {};
  room[tokenId] = { loot, savedAt: Date.now() };
  write(backupKey(roomId), room);
}

export function getBackup(
  roomId: string,
  tokenId: string,
): BackupEntry | undefined {
  return read<RoomBackup>(backupKey(roomId))?.[tokenId];
}
