import { LocalStorageAdapter } from "../../storage/LocalStorageAdapter";
import type { UserInventoryState } from "../inventory/UserInventoryModel";

export class LocalInventoryStorage {
  public static get(userId: string): UserInventoryState {
    return LocalStorageAdapter.getInventory(userId);
  }

  public static set(userId: string, data: UserInventoryState): void {
    LocalStorageAdapter.saveInventory(userId, data);
  }

  public static clear(userId: string): void {
    LocalStorageAdapter.clearInventory(userId);
  }
}

export { LocalStorageAdapter };
