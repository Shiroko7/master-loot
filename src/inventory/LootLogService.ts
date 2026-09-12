import OBR from "@owlbear-rodeo/sdk";
import { LOOT_LOG_KEY } from "../constants";
import type { LootLogEntry } from "../modules/inventory/UserInventoryModel";
import { NetworkProtocol } from "./NetworkProtocol";

export class LootLogService {
  private static localLogs: LootLogEntry[] = [];

  /**
   * Retrieves all log entries stored in room metadata.
   */
  public static async getLogs(): Promise<LootLogEntry[]> {
    if (!OBR.isAvailable) {
      return this.localLogs;
    }
    try {
      const meta = await OBR.room.getMetadata();
      const raw = meta[LOOT_LOG_KEY];
      if (Array.isArray(raw)) {
        return raw as LootLogEntry[];
      }
    } catch (e) {
      console.warn("LootLogService: Failed to get logs from room metadata", e);
    }
    return [];
  }

  /**
   * Appends an entry to the room metadata log history (GM authority).
   * Non-GM players delegate to GM via network broadcast.
   */
  public static async appendLog(entry: LootLogEntry): Promise<void> {
    if (!OBR.isAvailable) {
      this.localLogs = [entry, ...this.localLogs].slice(0, 500);
      return;
    }

    let role = "PLAYER";
    try {
      role = await OBR.player.getRole();
    } catch {
      role = "GM";
    }

    if (role !== "GM") {
      // Non-GM delegates to GM via broadcast
      await NetworkProtocol.appendLog(entry);
      return;
    }

    try {
      const current = await this.getLogs();
      // Keep most recent 500 entries to prevent metadata bloating
      const updated = [entry, ...current].slice(0, 500);
      await OBR.room.setMetadata({ [LOOT_LOG_KEY]: updated });
    } catch (e) {
      console.error("LootLogService: Failed to append log entry", e);
    }
  }

  /**
   * Marks a log entry as undone in room metadata (GM authority).
   */
  public static async markUndone(logId: string): Promise<void> {
    if (!OBR.isAvailable) {
      const entry = this.localLogs.find((l) => l.id === logId);
      if (entry) {
        entry.undone = true;
        entry.undoneAt = Date.now();
      }
      return;
    }

    try {
      const current = await this.getLogs();
      const entry = current.find((l) => l.id === logId);
      if (entry) {
        entry.undone = true;
        entry.undoneAt = Date.now();
        await OBR.room.setMetadata({ [LOOT_LOG_KEY]: current });
      }
    } catch (e) {
      console.error("LootLogService: Failed to mark entry as undone", e);
    }
  }

  /**
   * Marks a log entry as redone (undone: false) in room metadata (GM authority).
   */
  public static async markRedone(logId: string): Promise<void> {
    if (!OBR.isAvailable) {
      const entry = this.localLogs.find((l) => l.id === logId);
      if (entry) {
        entry.undone = false;
        entry.redoneAt = Date.now();
      }
      return;
    }

    try {
      const current = await this.getLogs();
      const entry = current.find((l) => l.id === logId);
      if (entry) {
        entry.undone = false;
        entry.redoneAt = Date.now();
        await OBR.room.setMetadata({ [LOOT_LOG_KEY]: current });
      }
    } catch (e) {
      console.error("LootLogService: Failed to mark entry as redone", e);
    }
  }

  /**
   * Clears all log entries from the room metadata (GM authority).
   */
  public static async clearLogs(): Promise<void> {
    if (!OBR.isAvailable) {
      this.localLogs = [];
      return;
    }

    const role = await OBR.player.getRole();
    if (role !== "GM") {
      throw new Error("Only the GM can clear the loot audit log.");
    }

    await OBR.room.setMetadata({ [LOOT_LOG_KEY]: [] });
  }

  /**
   * Listens for changes to the room loot log metadata.
   */
  public static onChange(callback: (logs: LootLogEntry[]) => void): () => void {
    if (!OBR.isAvailable) {
      return () => {};
    }
    return OBR.room.onMetadataChange((meta) => {
      const raw = meta[LOOT_LOG_KEY];
      const logs = Array.isArray(raw) ? (raw as LootLogEntry[]) : [];
      callback(logs);
    });
  }
}
