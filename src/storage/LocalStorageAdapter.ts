import {
  createDefaultInventory,
  INVENTORY_SCHEMA_VERSION,
  sanitizeInventoryState,
  type UserInventoryState,
} from "../modules/inventory/UserInventoryModel";

interface VersionedStoragePayload {
  version: number;
  state: UserInventoryState;
}

export class LocalStorageAdapter {
  private static memoryFallback = new Map<string, string>();

  /**
   * Claim a cross-window operation exactly once. Transfer messages are sent
   * to every open popover so all views can refresh, but only one popover may
   * apply an additive operation such as receiving an item.
   */
  public static claimOperation(operationId: string): boolean {
    if (!operationId) return true;

    const key = "master-loot:inventory:processed-operations";
    let processed: string[] = [];
    try {
      const raw = this.rawGet(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          processed = parsed.filter((value): value is string => typeof value === "string");
        }
      }
    } catch {
      processed = [];
    }

    if (processed.includes(operationId)) return false;

    processed.push(operationId);
    this.rawSet(key, JSON.stringify(processed.slice(-200)));
    return true;
  }

  public static storageKey(userId: string): string {
    return `master-loot:inventory:${userId}`;
  }

  private static rawGet(key: string): string | null {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        return window.localStorage.getItem(key);
      }
    } catch (e) {
      console.warn("LocalStorageAdapter: localStorage.getItem failed, using fallback", e);
    }
    return this.memoryFallback.get(key) ?? null;
  }

  private static rawSet(key: string, value: string): void {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem(key, value);
        return;
      }
    } catch (e) {
      console.warn("LocalStorageAdapter: localStorage.setItem failed, using fallback", e);
    }
    this.memoryFallback.set(key, value);
  }

  private static rawRemove(key: string): void {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.removeItem(key);
      }
    } catch (e) {
      console.warn("LocalStorageAdapter: localStorage.removeItem failed", e);
    }
    this.memoryFallback.delete(key);
  }

  /**
   * Enforces schema migrations if needed.
   */
  private static migrate(payload: any, userId: string): UserInventoryState {
    if (!payload || typeof payload !== "object") {
      return createDefaultInventory(userId);
    }

    // Direct UserInventoryState without version wrapper (legacy or raw import)
    if (!("version" in payload) && "userId" in payload) {
      return sanitizeInventoryState(payload, userId);
    }

    const version = payload.version ?? 0;
    let state = payload.state ?? payload;

    if (version < 1) {
      // Future migration logic hook:
      // v0 -> v1 adjustments if any
    }

    return sanitizeInventoryState(state, userId);
  }

  /**
   * Retrieves the inventory for a given userId from local storage.
   */
  public static getInventory(userId: string): UserInventoryState {
    if (!userId) return createDefaultInventory("unknown");

    const key = this.storageKey(userId);
    const raw = this.rawGet(key);

    if (!raw) {
      const defaultState = createDefaultInventory(userId);
      this.saveInventory(userId, defaultState);
      return defaultState;
    }

    try {
      const parsed = JSON.parse(raw);
      return this.migrate(parsed, userId);
    } catch (err) {
      console.error(`LocalStorageAdapter: Failed to parse inventory for ${userId}`, err);
      const defaultState = createDefaultInventory(userId);
      return defaultState;
    }
  }

  /**
   * Persists the user inventory state with schema versioning.
   */
  public static saveInventory(userId: string, data: UserInventoryState): void {
    if (!userId) return;

    const sanitized = sanitizeInventoryState(data, userId);
    sanitized.updatedAt = Date.now();

    const payload: VersionedStoragePayload = {
      version: INVENTORY_SCHEMA_VERSION,
      state: sanitized,
    };

    const key = this.storageKey(userId);
    try {
      this.rawSet(key, JSON.stringify(payload));
    } catch (err) {
      console.error(`LocalStorageAdapter: Failed to stringify/save inventory for ${userId}`, err);
    }
  }

  /**
   * Clears the inventory for a given user from local storage.
   */
  public static clearInventory(userId: string): void {
    if (!userId) return;
    const key = this.storageKey(userId);
    this.rawRemove(key);
  }
}
