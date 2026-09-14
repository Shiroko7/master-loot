import OBR from "@owlbear-rodeo/sdk";
import { INVENTORY_SOCKET_CHANNEL } from "../constants";
import type {
  LootLogEntry,
  UserInventoryItem,
  UserInventoryState,
} from "../modules/inventory/UserInventoryModel";

export type SocketMessage =
  | {
      action: "SYNC_INVENTORY";
      state: UserInventoryState;
      senderId: string;
      senderName: string;
    }
  | {
      action: "REQUEST_INVENTORY";
      targetUserId: string;
      requesterId: string;
    }
  | {
      action: "GM_MODIFY_INVENTORY";
      targetUserId: string;
      state: UserInventoryState;
      gmId: string;
    }
  | {
      action: "EXECUTE_TRANSFER";
      transferId: string;
      userId: string;
      userName: string;
      type: "TAKE" | "GIVE" | "TRANSFER";
      itemId: string;
      quantity: number;
      sourceType: "token_bag" | "user_inventory";
      sourceId: string;
      sourceName: string;
      targetType: "token_bag" | "user_inventory";
      targetId: string;
      targetName: string;
      itemPayload?: UserInventoryItem;
    }
  | {
      action: "TRANSFER_RESULT";
      transferId: string;
      success: boolean;
      error?: string;
      item?: UserInventoryItem;
      entry?: LootLogEntry;
    }
  | {
      action: "TRANSFER_ITEM";
      transferId: string;
      targetUserId: string;
      item: UserInventoryItem;
      fromUserId: string;
      fromUserName: string;
    }
  | {
      action: "APPEND_LOG";
      entry: LootLogEntry;
    }
  | {
      action: "UNDO_LOG_ENTRY";
      logId: string;
      requesterId: string;
    }
  | {
      action: "REDO_LOG_ENTRY";
      logId: string;
      requesterId: string;
    };

export class NetworkProtocol {
  private static registeredListeners = new Set<
    (msg: SocketMessage, connectionId: string) => void | Promise<void>
  >();
  private static unsubscribeBroadcast: (() => void) | null = null;

  public static initialize(): void {
    if (this.unsubscribeBroadcast) return;
    if (!OBR.isAvailable) return;

    try {
      this.unsubscribeBroadcast = OBR.broadcast.onMessage(
        INVENTORY_SOCKET_CHANNEL,
        async (event) => {
          const raw = event.data;
          if (!raw || typeof raw !== "object" || !("action" in raw)) return;

          const msg = raw as SocketMessage;
          // Process listeners in registration order. TransferManager updates
          // storage first; views then render the already-updated state.
          for (const listener of [...this.registeredListeners]) {
            try {
              await listener(msg, event.connectionId);
            } catch (e) {
              console.error("NetworkProtocol listener error", e);
            }
          }
        },
      );
    } catch (e) {
      console.warn("NetworkProtocol: Failed to bind broadcast listener", e);
    }
  }

  public static addListener(
    listener: (msg: SocketMessage, connectionId: string) => void | Promise<void>,
  ): () => void {
    this.initialize();
    this.registeredListeners.add(listener);
    return () => {
      this.registeredListeners.delete(listener);
    };
  }

  public static async broadcast(msg: SocketMessage): Promise<void> {
    if (!OBR.isAvailable) return;
    try {
      await OBR.broadcast.sendMessage(INVENTORY_SOCKET_CHANNEL, msg, {
        destination: "ALL",
      });
    } catch (e) {
      console.warn("NetworkProtocol: Failed to broadcast message", e);
    }
  }

  public static async broadcastRemote(msg: SocketMessage): Promise<void> {
    if (!OBR.isAvailable) return;
    try {
      await OBR.broadcast.sendMessage(INVENTORY_SOCKET_CHANNEL, msg, {
        destination: "REMOTE",
      });
    } catch (e) {
      console.warn("NetworkProtocol: Failed to broadcast remote message", e);
    }
  }

  public static async syncInventory(
    state: UserInventoryState,
    senderName: string,
  ): Promise<void> {
    await this.broadcast({
      action: "SYNC_INVENTORY",
      state,
      senderId: state.userId,
      senderName,
    });
  }

  public static async requestInventory(
    targetUserId: string,
    requesterId: string,
  ): Promise<void> {
    await this.broadcast({
      action: "REQUEST_INVENTORY",
      targetUserId,
      requesterId,
    });
  }

  public static async gmModifyInventory(
    targetUserId: string,
    state: UserInventoryState,
    gmId: string,
  ): Promise<void> {
    await this.broadcast({
      action: "GM_MODIFY_INVENTORY",
      targetUserId,
      state,
      gmId,
    });
  }

  public static async sendTransferItem(
    targetUserId: string,
    item: UserInventoryItem,
    fromUserId: string,
    fromUserName: string,
    transferId: string,
  ): Promise<void> {
    await this.broadcast({
      action: "TRANSFER_ITEM",
      transferId,
      targetUserId,
      item,
      fromUserId,
      fromUserName,
    });
  }

  public static async appendLog(entry: LootLogEntry): Promise<void> {
    await this.broadcast({
      action: "APPEND_LOG",
      entry,
    });
  }

  public static async requestUndo(logId: string, requesterId: string): Promise<void> {
    await this.broadcast({
      action: "UNDO_LOG_ENTRY",
      logId,
      requesterId,
    });
  }

  public static async requestRedo(logId: string, requesterId: string): Promise<void> {
    await this.broadcast({
      action: "REDO_LOG_ENTRY",
      logId,
      requesterId,
    });
  }
}
