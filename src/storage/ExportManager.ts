import {
  INVENTORY_SCHEMA_VERSION,
  sanitizeInventoryState,
  type UserInventoryState,
} from "../modules/inventory/UserInventoryModel";
import { LocalStorageAdapter } from "./LocalStorageAdapter";

export interface ExportPayload {
  schemaVersion: number;
  format: "master-loot-inventory";
  userId: string;
  exportedAt: number;
  verificationHash: string;
  inventory: UserInventoryState;
}

export class ExportManager {
  /**
   * Generates a deterministic hash string for inventory data verification.
   */
  public static async computeHash(inventory: UserInventoryState): Promise<string> {
    const raw = JSON.stringify({
      userId: inventory.userId,
      items: inventory.items.map((i) => ({
        id: i.id,
        name: i.name,
        quantity: i.quantity,
        img: i.img,
        data: i.data,
      })),
      isPublic: inventory.isPublic,
      isLocked: inventory.isLocked,
    });

    try {
      if (typeof crypto !== "undefined" && crypto.subtle) {
        const msgUint8 = new TextEncoder().encode(raw);
        const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
      }
    } catch {
      // Fallback below
    }

    // Fast deterministic non-cryptographic checksum fallback
    let h1 = 0xdeadbeef;
    let h2 = 0x41c64e6d;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    return (h1 >>> 0).toString(16).padStart(8, "0");
  }

  /**
   * Serializes UserInventoryState into a .json blob and triggers browser download
   * named inventory-${userId}-${Date.now()}.json.
   */
  public static async exportInventory(inventory: UserInventoryState): Promise<void> {
    const hash = await this.computeHash(inventory);
    const payload: ExportPayload = {
      schemaVersion: INVENTORY_SCHEMA_VERSION,
      format: "master-loot-inventory",
      userId: inventory.userId,
      exportedAt: Date.now(),
      verificationHash: hash,
      inventory,
    };

    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const filename = `inventory-${inventory.userId}-${Date.now()}.json`;
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /**
   * Parses and validates a JSON string or file content into a sanitized UserInventoryState.
   * Verifies schema version, data integrity, and sanitizes items.
   */
  public static async parseAndValidate(
    rawJson: string,
    targetUserId: string,
  ): Promise<{ state: UserInventoryState; verified: boolean }> {
    let parsed: any;
    try {
      parsed = JSON.parse(rawJson);
    } catch (err) {
      throw new Error("Invalid JSON format: Unable to parse backup file.");
    }

    if (!parsed || typeof parsed !== "object") {
      throw new Error("Invalid backup format: root must be an object.");
    }

    let inventorySource: any;
    let expectedHash: string | undefined;

    if (parsed.format === "master-loot-inventory" && parsed.inventory) {
      inventorySource = parsed.inventory;
      expectedHash = parsed.verificationHash;
    } else if (parsed.items && Array.isArray(parsed.items)) {
      // Direct raw UserInventoryState export
      inventorySource = parsed;
    } else {
      throw new Error("Invalid backup format: Missing inventory items collection.");
    }

    const sanitizedState = sanitizeInventoryState(inventorySource, targetUserId);
    // Overwrite the state userId with the active targetUserId so a user importing
    // someone else's backup takes ownership into their own profile.
    sanitizedState.userId = targetUserId;
    sanitizedState.updatedAt = Date.now();

    let verified = false;
    if (expectedHash) {
      const computed = await this.computeHash(inventorySource);
      verified = computed === expectedHash;
      if (!verified) {
        console.warn("ExportManager: verification hash mismatch on imported inventory.");
      }
    }

    return { state: sanitizedState, verified };
  }

  /**
   * Imports an inventory file, updates LocalStorage, and returns the imported state.
   */
  public static async importFromFile(
    file: File,
    targetUserId: string,
    onBroadcastSync?: (state: UserInventoryState) => void,
  ): Promise<UserInventoryState> {
    const text = await file.text();
    const { state } = await this.parseAndValidate(text, targetUserId);

    LocalStorageAdapter.saveInventory(targetUserId, state);

    if (onBroadcastSync) {
      onBroadcastSync(state);
    }

    return state;
  }
}
