import OBR from "@owlbear-rodeo/sdk";
import { LOOT_LOG_KEY } from "../constants";
import type { LootLogEntry } from "../modules/inventory/UserInventoryModel";
import { NetworkProtocol } from "./NetworkProtocol";

export class LootLogService {
  private static localLogs: LootLogEntry[] = [];
  private static readonly subscribers = new Set<(logs: LootLogEntry[]) => void>();
  private static networkUnsubscribe: (() => void) | null = null;
  private static appendQueue: Promise<void> = Promise.resolve();

  private static ensureNetworkListener(): void {
    if (!OBR.isAvailable || this.networkUnsubscribe) return;

    this.networkUnsubscribe = NetworkProtocol.addListener(async (message) => {
      if (message.action !== "SYNC_LOOT_LOG") return;
      this.replaceCachedLogs(message.logs);
    });
  }

  private static replaceCachedLogs(logs: LootLogEntry[]): void {
    const seen = new Set<string>();
    this.localLogs = logs
      .filter((entry) => {
        if (!entry || typeof entry.id !== "string" || seen.has(entry.id)) return false;
        seen.add(entry.id);
        return true;
      })
      .slice(0, 500);

    const snapshot = [...this.localLogs];
    for (const subscriber of this.subscribers) {
      try {
        subscriber(snapshot);
      } catch (e) {
        console.error("LootLogService subscriber error", e);
      }
    }
  }

  private static queueAppend(task: () => Promise<void>): Promise<void> {
    const next = this.appendQueue.then(task, task);
    this.appendQueue = next.catch(() => undefined);
    return next;
  }

  /**
   * Retrieves all log entries stored in room metadata.
   */
  public static async getLogs(): Promise<LootLogEntry[]> {
    if (!OBR.isAvailable) {
      return [...this.localLogs];
    }
    this.ensureNetworkListener();
    try {
      const meta = await OBR.room.getMetadata();
      const raw = meta[LOOT_LOG_KEY];
      if (Array.isArray(raw)) {
        this.replaceCachedLogs(raw as LootLogEntry[]);
        return [...this.localLogs];
      }
    } catch (e) {
      console.warn("LootLogService: Failed to get logs from room metadata", e);
    }
    return [...this.localLogs];
  }

  /**
   * Appends an entry to the room metadata log history (GM authority).
   * Non-GM players delegate to GM via network broadcast.
   */
  public static async appendLog(entry: LootLogEntry): Promise<void> {
    if (!OBR.isAvailable) {
      if (!this.localLogs.some((existing) => existing.id === entry.id)) {
        this.replaceCachedLogs([entry, ...this.localLogs]);
      }
      return;
    }

    this.ensureNetworkListener();

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

    await this.queueAppend(async () => {
      try {
        const current = await this.getLogs();
        if (current.some((existing) => existing.id === entry.id)) return;

        // Keep most recent 500 entries to prevent metadata bloating.
        const updated = [entry, ...current].slice(0, 500);
        await OBR.room.setMetadata({ [LOOT_LOG_KEY]: updated });
        this.replaceCachedLogs(updated);
        await NetworkProtocol.syncLootLog(updated);
      } catch (e) {
        console.error("LootLogService: Failed to append log entry", e);
      }
    });
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
        this.replaceCachedLogs(this.localLogs);
      }
      return;
    }

    this.ensureNetworkListener();

    try {
      const current = await this.getLogs();
      const entry = current.find((l) => l.id === logId);
      if (entry) {
        entry.undone = true;
        entry.undoneAt = Date.now();
        await OBR.room.setMetadata({ [LOOT_LOG_KEY]: current });
        this.replaceCachedLogs(current);
        await NetworkProtocol.syncLootLog(current);
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
        this.replaceCachedLogs(this.localLogs);
      }
      return;
    }

    this.ensureNetworkListener();

    try {
      const current = await this.getLogs();
      const entry = current.find((l) => l.id === logId);
      if (entry) {
        entry.undone = false;
        entry.redoneAt = Date.now();
        await OBR.room.setMetadata({ [LOOT_LOG_KEY]: current });
        this.replaceCachedLogs(current);
        await NetworkProtocol.syncLootLog(current);
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
      this.replaceCachedLogs([]);
      return;
    }

    const role = await OBR.player.getRole();
    if (role !== "GM") {
      throw new Error("Only the GM can clear the loot audit log.");
    }

    this.ensureNetworkListener();
    await OBR.room.setMetadata({ [LOOT_LOG_KEY]: [] });
    this.replaceCachedLogs([]);
    await NetworkProtocol.syncLootLog([]);
  }

  /**
   * Listens for changes to the room loot log metadata.
   */
  public static onChange(callback: (logs: LootLogEntry[]) => void): () => void {
    if (!OBR.isAvailable) {
      return () => {};
    }
    this.ensureNetworkListener();
    this.subscribers.add(callback);

    const unsubscribeMetadata = OBR.room.onMetadataChange((meta) => {
      const raw = meta[LOOT_LOG_KEY];
      const logs = Array.isArray(raw) ? (raw as LootLogEntry[]) : [];
      this.replaceCachedLogs(logs);
    });

    return () => {
      this.subscribers.delete(callback);
      unsubscribeMetadata();
    };
  }
}
