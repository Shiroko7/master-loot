import OBR from "@owlbear-rodeo/sdk";
import { getLoot, getToken, saveLoot } from "../loot";
import { LocalStorageAdapter } from "../storage/LocalStorageAdapter";
import {
  CURRENCY_INVENTORY_SECTION,
  defaultInventorySectionForKind,
  currencyPurseForInventoryItem,
  expandCurrencyInventoryItem,
  getCurrencyStackKind,
  lootItemToUserInventoryItem,
  userInventoryItemToLootItem,
  type LootLogEntry,
  type UserInventoryItem,
  type UserInventoryState,
} from "../modules/inventory/UserInventoryModel";
import { LootLogService } from "./LootLogService";
import { NetworkProtocol, type SocketMessage } from "./NetworkProtocol";
import type { LootItem, Rarity } from "../types";

interface PendingTransferPromise {
  resolve: (value: { success: boolean; item?: UserInventoryItem; error?: string }) => void;
  reject: (reason?: any) => void;
  timeoutId: number;
}

export class TransferManager {
  private static pendingTransfers = new Map<string, PendingTransferPromise>();
  private static initialized = false;

  /**
   * Helper to merge or append an item into a UserInventoryState.
   */
  public static addItemToInventory(
    inventory: UserInventoryState,
    item: UserInventoryItem,
    quantityToAdd: number,
  ): void {
    if (item.data?.kind === "currency") {
      const currencyStacks = expandCurrencyInventoryItem(item).filter(
        (stack) => !!getCurrencyStackKind(stack),
      );

      if (currencyStacks.length > 0) {
        for (const stack of currencyStacks) {
          const coinKind = getCurrencyStackKind(stack);
          if (!coinKind) continue;

          const existing = inventory.items.find(
            (candidate) => getCurrencyStackKind(candidate) === coinKind,
          );
          if (existing) {
            existing.quantity += stack.quantity;
            existing.section = CURRENCY_INVENTORY_SECTION;
            existing.data = {
              ...existing.data,
              kind: "currency",
              coinKind,
              coins: { [coinKind]: existing.quantity },
              section: CURRENCY_INVENTORY_SECTION,
            };
          } else {
            inventory.items.push(stack);
          }
        }
        inventory.updatedAt = Date.now();
        return;
      }
    }

    const existing = inventory.items.find(
      (i) =>
        i.name === item.name &&
        i.img === item.img &&
        (i.section || "") === (item.section || "") &&
        JSON.stringify(i.data) === JSON.stringify(item.data),
    );

    if (existing) {
      existing.quantity += quantityToAdd;
    } else {
      inventory.items.push({
        ...item,
        id: item.id || crypto.randomUUID(),
        quantity: quantityToAdd,
        section: item.section || (item.data?.section as string | undefined),
        tags: item.tags || (item.data?.tags as string[] | undefined) || [],
      });
    }
    inventory.updatedAt = Date.now();
  }

  /**
   * Directly creates an item in a user's inventory.
   */
  public static async createItemInInventory(params: {
    userId: string;
    userName: string;
    item: {
      name: string;
      img?: string;
      quantity?: number;
      section?: string;
      tags?: string[];
      rarity?: Rarity;
      description?: string;
      link?: string;
      data?: Record<string, any>;
    };
  }): Promise<{ success: boolean; item?: UserInventoryItem; error?: string }> {
    this.initialize();
    let myId = params.userId || "local-user";
    let myName = params.userName || "Player";
    let myRole: "GM" | "PLAYER" = "GM";

    if (OBR.isAvailable) {
      myId = await OBR.player.getId();
      myName = await OBR.player.getName();
      myRole = await OBR.player.getRole();
    }

    if (myRole !== "GM" && params.userId !== myId) {
      return { success: false, error: "Cannot create items in another player's inventory." };
    }

    const inv = LocalStorageAdapter.getInventory(params.userId);
    const itemKind = params.item.data?.kind;
    const section =
      params.item.section?.trim() || defaultInventorySectionForKind(itemKind);
    const tags = Array.isArray(params.item.tags)
      ? params.item.tags.map((t) => t.trim()).filter((t) => t.length > 0)
      : [];

    const newItem: UserInventoryItem = {
      id: crypto.randomUUID(),
      name: params.item.name.trim() || "New Item",
      img: params.item.img?.trim() || "⚔️",
      quantity: Math.max(1, params.item.quantity || 1),
      section,
      tags,
      data: {
        ...(params.item.data || {}),
        description: params.item.description || "",
        link: params.item.link || "",
        rarity: params.item.rarity || "none",
        section,
        tags,
      },
    };

    // If item specifies a section not yet in inventory.sections, add it!
    if (section && (!inv.sections || !inv.sections.includes(section))) {
      inv.sections = [...(inv.sections || []), section];
    }

    this.addItemToInventory(inv, newItem, newItem.quantity);
    LocalStorageAdapter.saveInventory(params.userId, inv);

    if (params.userId === myId) {
      await NetworkProtocol.syncInventory(inv, params.userName);
    } else if (myRole === "GM") {
      await NetworkProtocol.gmModifyInventory(params.userId, inv, myId);
    }

    // Append to audit log
    const logEntry: LootLogEntry = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      userId: myId,
      userName: myName,
      action: "CREATE",
      itemId: newItem.id,
      itemName: newItem.name,
      quantity: newItem.quantity,
      sourceType: "user_inventory",
      sourceId: params.userId,
      sourceName: params.userName,
      targetType: "user_inventory",
      targetId: params.userId,
      targetName: params.userName,
      itemSnapshot: { ...newItem },
    };
    await LootLogService.appendLog(logEntry);

    return { success: true, item: newItem };
  }

  /**
   * Deletes an item from a user's inventory and records it in the GM Loot Audit Log.
   */
  public static async deleteItemFromInventory(params: {
    userId: string;
    userName: string;
    itemId: string;
    quantity?: number;
  }): Promise<{ success: boolean; error?: string }> {
    this.initialize();
    let myId = params.userId || "local-user";
    let myName = params.userName || "Player";
    let myRole: "GM" | "PLAYER" = "GM";

    if (OBR.isAvailable) {
      myId = await OBR.player.getId();
      myName = await OBR.player.getName();
      myRole = await OBR.player.getRole();
    }

    if (myRole !== "GM" && params.userId !== myId) {
      return { success: false, error: "Cannot delete items from another player's inventory." };
    }

    const inv = LocalStorageAdapter.getInventory(params.userId);
    const targetItem = inv.items.find((i) => i.id === params.itemId);
    if (!targetItem) {
      return { success: false, error: "Item not found in inventory." };
    }

    const requestedQuantity = Number.isFinite(params.quantity)
      ? Math.max(1, Math.floor(params.quantity || targetItem.quantity))
      : targetItem.quantity;
    const qtyToDelete = Math.min(requestedQuantity, targetItem.quantity);
    const deducted = this.removeItemFromInventory(inv, params.itemId, qtyToDelete);
    if (!deducted) {
      return { success: false, error: "Failed to remove item." };
    }

    LocalStorageAdapter.saveInventory(params.userId, inv);

    if (params.userId === myId) {
      await NetworkProtocol.syncInventory(inv, params.userName);
    } else if (myRole === "GM") {
      await NetworkProtocol.gmModifyInventory(params.userId, inv, myId);
    }

    // Record DELETE action in audit log
    const logEntry: LootLogEntry = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      userId: myId,
      userName: myName,
      action: "DELETE",
      itemId: params.itemId,
      itemName: deducted.name,
      quantity: qtyToDelete,
      sourceType: "user_inventory",
      sourceId: params.userId,
      sourceName: params.userName,
      targetType: "user_inventory",
      targetId: "",
      targetName: "Deleted",
      itemSnapshot: { ...deducted, quantity: qtyToDelete },
    };
    await LootLogService.appendLog(logEntry);

    return { success: true };
  }

  /**
   * Helper to deduct or remove an item from a UserInventoryState.
   */
  public static removeItemFromInventory(
    inventory: UserInventoryState,
    itemId: string,
    quantityToRemove: number,
  ): UserInventoryItem | null {
    const idx = inventory.items.findIndex((i) => i.id === itemId);
    if (idx === -1) return null;

    const current = inventory.items[idx];
    const qty = Math.max(1, Math.floor(quantityToRemove));
    const makeSnapshot = (quantity: number): UserInventoryItem => {
      const snapshot: UserInventoryItem = {
        ...current,
        quantity,
        tags: current.tags ? [...current.tags] : current.tags,
        data: { ...current.data },
      };
      const coinKind = getCurrencyStackKind(current);
      if (coinKind) {
        snapshot.section = CURRENCY_INVENTORY_SECTION;
        snapshot.data = {
          ...snapshot.data,
          kind: "currency",
          coinKind,
          coins: { [coinKind]: quantity },
          section: CURRENCY_INVENTORY_SECTION,
        };
      }
      return snapshot;
    };

    if (current.quantity <= qty) {
      inventory.items.splice(idx, 1);
      inventory.updatedAt = Date.now();
      return makeSnapshot(current.quantity);
    } else {
      current.quantity -= qty;
      const coinKind = getCurrencyStackKind(current);
      if (coinKind) {
        current.section = CURRENCY_INVENTORY_SECTION;
        current.data = {
          ...current.data,
          kind: "currency",
          coinKind,
          coins: { [coinKind]: current.quantity },
          section: CURRENCY_INVENTORY_SECTION,
        };
      }
      inventory.updatedAt = Date.now();
      return makeSnapshot(qty);
    }
  }

  /** Remove the exact item represented by an audit snapshot. */
  private static removeLoggedItemFromInventory(
    inventory: UserInventoryState,
    entry: LootLogEntry,
  ): UserInventoryItem | null {
    const snapshot = entry.itemSnapshot;
    if (snapshot?.data?.kind !== "currency") {
      return this.removeItemFromInventory(inventory, entry.itemId, entry.quantity);
    }

    const purse = currencyPurseForInventoryItem(snapshot);
    const amounts = Object.entries(purse).filter(([, amount]) => amount > 0) as [string, number][];
    if (amounts.length === 0) {
      return this.removeItemFromInventory(inventory, entry.itemId, entry.quantity);
    }

    const stacks = amounts.map(([kind, amount]) => {
      const stack = inventory.items.find((item) => getCurrencyStackKind(item) === kind);
      return { stack, amount };
    });
    if (stacks.some(({ stack, amount }) => !stack || stack.quantity < amount)) {
      return null;
    }

    let firstRemoved: UserInventoryItem | null = null;
    for (const { stack, amount } of stacks) {
      if (!stack) continue;
      const removed = this.removeItemFromInventory(inventory, stack.id, amount);
      if (removed && !firstRemoved) firstRemoved = removed;
    }
    return firstRemoved;
  }

  private static addItemToLoot(items: LootItem[], item: LootItem): void {
    const existing = items.find((candidate) =>
      candidate.name === item.name && candidate.kind === item.kind,
    );

    if (!existing) {
      items.push(item);
      return;
    }

    if (item.kind === "currency") {
      existing.coins = { ...(existing.coins || {}) };
      for (const [kind, amount] of Object.entries(item.coins || {})) {
        const value = Number(amount) || 0;
        if (value > 0) {
          const coinKind = kind as keyof typeof existing.coins;
          existing.coins[coinKind] = (existing.coins[coinKind] || 0) + value;
        }
      }
      existing.quantity = 1;
    } else {
      existing.quantity += item.quantity;
    }
  }

  private static removeItemFromLoot(
    items: LootItem[],
    itemId: string,
    itemName: string,
    snapshot?: UserInventoryItem,
    quantity = 1,
  ): void {
    if (snapshot?.data?.kind === "currency") {
      const remaining = { ...currencyPurseForInventoryItem(snapshot) };
      const candidates = items.filter(
        (item) => item.kind === "currency" && (item.id === itemId || item.name === itemName),
      );

      for (const candidate of candidates) {
        for (const [kind, amount] of Object.entries(remaining)) {
          const needed = Number(amount) || 0;
          const available = Number(candidate.coins?.[kind as keyof typeof candidate.coins]) || 0;
          if (needed <= 0 || available <= 0) continue;
          const taken = Math.min(needed, available);
          candidate.coins = { ...(candidate.coins || {}) };
          const coinKind = kind as keyof typeof candidate.coins;
          candidate.coins[coinKind] = available - taken;
          remaining[kind as keyof typeof remaining] = needed - taken;
        }

        if (Object.values(remaining).every((amount) => (Number(amount) || 0) <= 0)) {
          break;
        }
      }

      for (let index = items.length - 1; index >= 0; index -= 1) {
        const item = items[index];
        if (item.kind === "currency" && Object.values(item.coins || {}).every((amount) => !amount || amount <= 0)) {
          items.splice(index, 1);
        }
      }
      return;
    }

    const index = items.findIndex((item) => item.id === itemId || item.name === itemName);
    if (index === -1) return;
    if (items[index].quantity <= quantity) items.splice(index, 1);
    else items[index].quantity -= quantity;
  }

  /**
   * Initialize transfer network listeners (for both GM authority and player clients).
   */
  public static initialize(): void {
    if (this.initialized) return;
    this.initialized = true;
    if (!OBR.isAvailable) return;

    NetworkProtocol.addListener(async (msg: SocketMessage) => {
      const myId = await OBR.player.getId();
      const myRole = await OBR.player.getRole();

      switch (msg.action) {
        case "EXECUTE_TRANSFER": {
          // GM-as-Authority Rule: Process scene token manipulations
          if (myRole === "GM") {
            await this.handleGmExecuteTransfer(msg);
          }
          break;
        }

        case "TRANSFER_RESULT": {
          const pending = this.pendingTransfers.get(msg.transferId);
          if (pending) {
            clearTimeout(pending.timeoutId);
            this.pendingTransfers.delete(msg.transferId);
            if (msg.success) {
              pending.resolve({ success: true, item: msg.item });
            } else {
              pending.resolve({ success: false, error: msg.error });
            }
          }
          break;
        }

        case "TRANSFER_ITEM": {
          if (msg.targetUserId === myId) {
            if (!LocalStorageAdapter.claimOperation(msg.transferId)) break;
            const current = LocalStorageAdapter.getInventory(myId);
            this.addItemToInventory(current, msg.item, msg.item.quantity);
            LocalStorageAdapter.saveInventory(myId, current);
            const myName = await OBR.player.getName();
            await NetworkProtocol.syncInventory(current, myName);
          }
          break;
        }

        case "GM_MODIFY_INVENTORY": {
          if (msg.targetUserId === myId) {
            LocalStorageAdapter.saveInventory(myId, msg.state);
            const myName = await OBR.player.getName();
            await NetworkProtocol.syncInventory(msg.state, myName);
          }
          break;
        }

        case "REQUEST_INVENTORY": {
          if (msg.targetUserId === myId) {
            const current = LocalStorageAdapter.getInventory(myId);
            const myName = await OBR.player.getName();
            await NetworkProtocol.syncInventory(current, myName);
          }
          break;
        }

        case "APPEND_LOG": {
          if (myRole === "GM") {
            await LootLogService.appendLog(msg.entry);
          }
          break;
        }

        case "UNDO_LOG_ENTRY": {
          if (myRole === "GM") {
            await this.rollbackLogEntry(msg.logId);
          }
          break;
        }

        case "REDO_LOG_ENTRY": {
          if (myRole === "GM") {
            await this.redoLogEntry(msg.logId);
          }
          break;
        }
      }
    });
  }

  /**
   * Authority handler executed on the GM client to process EXECUTE_TRANSFER messages.
   */
  private static async handleGmExecuteTransfer(msg: Extract<SocketMessage, { action: "EXECUTE_TRANSFER" }>): Promise<void> {
    try {
      if (msg.sourceType === "token_bag") {
        const token = await getToken(msg.sourceId);
        if (!token) {
          await NetworkProtocol.broadcast({
            action: "TRANSFER_RESULT",
            transferId: msg.transferId,
            success: false,
            error: "Token not found in scene.",
          });
          return;
        }

        const loot = getLoot(token);
        if (!loot) {
          await NetworkProtocol.broadcast({
            action: "TRANSFER_RESULT",
            transferId: msg.transferId,
            success: false,
            error: "Loot container missing on token.",
          });
          return;
        }

        const itemIdx = loot.items.findIndex((i) => i.id === msg.itemId);
        if (itemIdx === -1) {
          await NetworkProtocol.broadcast({
            action: "TRANSFER_RESULT",
            transferId: msg.transferId,
            success: false,
            error: "Item not found in loot container.",
          });
          return;
        }

        const sourceItem = loot.items[itemIdx];
        const qtyToTake = Math.min(msg.quantity, sourceItem.quantity);

        if (sourceItem.quantity <= qtyToTake) {
          loot.items.splice(itemIdx, 1);
        } else {
          sourceItem.quantity -= qtyToTake;
        }
        await saveLoot(token.id, loot);

        const transferredInvItem = lootItemToUserInventoryItem({
          ...sourceItem,
          quantity: qtyToTake,
        });

        const logEntry: LootLogEntry = {
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          userId: msg.userId,
          userName: msg.userName,
          action: msg.type,
          itemId: msg.itemId,
          itemName: sourceItem.name,
          quantity: qtyToTake,
          sourceType: "token_bag",
          sourceId: msg.sourceId,
          sourceName: msg.sourceName || loot.name || token.name,
          targetType: msg.targetType,
          targetId: msg.targetId,
          targetName: msg.targetName,
          itemSnapshot: transferredInvItem,
        };

        await LootLogService.appendLog(logEntry);

        // If target was not the requesting user (e.g. taking directly to a peer), dispatch TRANSFER_ITEM to peer
        if (msg.targetType === "user_inventory" && msg.targetId !== msg.userId) {
          await NetworkProtocol.sendTransferItem(
            msg.targetId,
            transferredInvItem,
            msg.userId,
            msg.userName,
            msg.transferId,
          );
        }

        await NetworkProtocol.broadcast({
          action: "TRANSFER_RESULT",
          transferId: msg.transferId,
          success: true,
          item: transferredInvItem,
          entry: logEntry,
        });
      } else if (msg.targetType === "token_bag") {
        const token = await getToken(msg.targetId);
        if (!token) {
          await NetworkProtocol.broadcast({
            action: "TRANSFER_RESULT",
            transferId: msg.transferId,
            success: false,
            error: "Target token not found in scene.",
          });
          return;
        }

        const loot = getLoot(token);
        if (!loot) {
          await NetworkProtocol.broadcast({
            action: "TRANSFER_RESULT",
            transferId: msg.transferId,
            success: false,
            error: "Target token is not a loot container.",
          });
          return;
        }

        if (!msg.itemPayload) {
          await NetworkProtocol.broadcast({
            action: "TRANSFER_RESULT",
            transferId: msg.transferId,
            success: false,
            error: "Item data missing for deposit.",
          });
          return;
        }

        const lootItemToAdd = userInventoryItemToLootItem({
          ...msg.itemPayload,
          quantity: msg.quantity,
        });

        this.addItemToLoot(loot.items, lootItemToAdd);
        await saveLoot(token.id, loot);

        const logEntry: LootLogEntry = {
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          userId: msg.userId,
          userName: msg.userName,
          action: msg.type,
          itemId: msg.itemId,
          itemName: msg.itemPayload.name,
          quantity: msg.quantity,
          sourceType: "user_inventory",
          sourceId: msg.sourceId,
          sourceName: msg.sourceName,
          targetType: "token_bag",
          targetId: msg.targetId,
          targetName: msg.targetName || loot.name || token.name,
          itemSnapshot: { ...msg.itemPayload, quantity: msg.quantity },
        };

        await LootLogService.appendLog(logEntry);

        await NetworkProtocol.broadcast({
          action: "TRANSFER_RESULT",
          transferId: msg.transferId,
          success: true,
          entry: logEntry,
        });
      }
    } catch (e: any) {
      console.error("handleGmExecuteTransfer error", e);
      await NetworkProtocol.broadcast({
        action: "TRANSFER_RESULT",
        transferId: msg.transferId,
        success: false,
        error: e.message || "Failed to execute transfer.",
      });
    }
  }

  /**
   * Transfer item from a Scene Loot Bag Token to a User Inventory.
   */
  public static async tokenToUser(params: {
    tokenId: string;
    tokenName: string;
    itemId: string;
    quantity: number;
    targetUserId: string;
    targetUserName: string;
  }): Promise<{ success: boolean; error?: string }> {
    this.initialize();
    let myId = "local-user";
    let myName = "Player";
    let myRole: "GM" | "PLAYER" = "PLAYER";

    if (OBR.isAvailable) {
      myId = await OBR.player.getId();
      myName = await OBR.player.getName();
      myRole = await OBR.player.getRole();
    }

    // If I am GM, we can execute immediately
    if (myRole === "GM") {
      const token = await getToken(params.tokenId);
      if (!token) return { success: false, error: "Token not found" };
      const loot = getLoot(token);
      if (!loot) return { success: false, error: "Token is not a loot bag" };

      const itemIdx = loot.items.findIndex((i) => i.id === params.itemId);
      if (itemIdx === -1) return { success: false, error: "Item not found in token" };

      const srcItem = loot.items[itemIdx];
      const qty = Math.min(params.quantity, srcItem.quantity);
      if (srcItem.quantity <= qty) {
        loot.items.splice(itemIdx, 1);
      } else {
        srcItem.quantity -= qty;
      }
      await saveLoot(token.id, loot);

      const invItem = lootItemToUserInventoryItem({ ...srcItem, quantity: qty });

      if (params.targetUserId === myId) {
        const myInv = LocalStorageAdapter.getInventory(myId);
        this.addItemToInventory(myInv, invItem, qty);
        LocalStorageAdapter.saveInventory(myId, myInv);
        await NetworkProtocol.syncInventory(myInv, myName);
      } else {
        await NetworkProtocol.sendTransferItem(
          params.targetUserId,
          invItem,
          myId,
          myName,
          crypto.randomUUID(),
        );
      }

      const logEntry: LootLogEntry = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        userId: myId,
        userName: myName,
        action: "TAKE",
        itemId: params.itemId,
        itemName: srcItem.name,
        quantity: qty,
        sourceType: "token_bag",
        sourceId: params.tokenId,
        sourceName: params.tokenName || loot.name || token.name,
        targetType: "user_inventory",
        targetId: params.targetUserId,
        targetName: params.targetUserName,
        itemSnapshot: invItem,
      };
      await LootLogService.appendLog(logEntry);

      return { success: true };
    }

    // Otherwise, dispatch EXECUTE_TRANSFER to GM
    const transferId = crypto.randomUUID();
    const promise = new Promise<{ success: boolean; item?: UserInventoryItem; error?: string }>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        this.pendingTransfers.delete(transferId);
        resolve({ success: false, error: "Transfer timed out waiting for GM authorization." });
      }, 7000);

      this.pendingTransfers.set(transferId, { resolve, reject, timeoutId });
    });

    await NetworkProtocol.broadcast({
      action: "EXECUTE_TRANSFER",
      transferId,
      userId: myId,
      userName: myName,
      type: "TAKE",
      itemId: params.itemId,
      quantity: params.quantity,
      sourceType: "token_bag",
      sourceId: params.tokenId,
      sourceName: params.tokenName,
      targetType: "user_inventory",
      targetId: params.targetUserId,
      targetName: params.targetUserName,
    });

    const result = await promise;
    if (result.success && result.item && params.targetUserId === myId) {
      const myInv = LocalStorageAdapter.getInventory(myId);
      this.addItemToInventory(myInv, result.item, result.item.quantity);
      LocalStorageAdapter.saveInventory(myId, myInv);
      await NetworkProtocol.syncInventory(myInv, myName);
    }
    return result;
  }

  /**
   * Transfer item from a User Inventory to a Scene Loot Bag Token.
   */
  public static async userToToken(params: {
    sourceUserId: string;
    sourceUserName: string;
    itemId: string;
    quantity: number;
    tokenId: string;
    tokenName: string;
  }): Promise<{ success: boolean; error?: string }> {
    this.initialize();
    let myId = "local-user";
    let myName = "Player";
    let myRole: "GM" | "PLAYER" = "PLAYER";

    if (OBR.isAvailable) {
      myId = await OBR.player.getId();
      myName = await OBR.player.getName();
      myRole = await OBR.player.getRole();
    }

    const isOwner = params.sourceUserId === myId;
    const isGM = myRole === "GM";

    const sourceInv = LocalStorageAdapter.getInventory(params.sourceUserId);
    if (!isOwner && !isGM && sourceInv.isLocked) {
      return { success: false, error: "Source inventory is locked." };
    }

    const item = sourceInv.items.find((i) => i.id === params.itemId);
    if (!item || item.quantity < params.quantity) {
      return { success: false, error: "Insufficient item quantity in source inventory." };
    }

    // Deduct from source
    const deducted = this.removeItemFromInventory(sourceInv, params.itemId, params.quantity);
    if (!deducted) return { success: false, error: "Item not found in inventory." };

    LocalStorageAdapter.saveInventory(params.sourceUserId, sourceInv);
    await NetworkProtocol.syncInventory(sourceInv, params.sourceUserName);

    if (isGM) {
      const token = await getToken(params.tokenId);
      if (!token) return { success: false, error: "Token not found." };
      const loot = getLoot(token);
      if (!loot) return { success: false, error: "Token is not a loot container." };

      const lootItemToAdd = userInventoryItemToLootItem({ ...deducted, quantity: params.quantity });
      this.addItemToLoot(loot.items, lootItemToAdd);
      await saveLoot(token.id, loot);

      const logEntry: LootLogEntry = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        userId: myId,
        userName: myName,
        action: "GIVE",
        itemId: params.itemId,
        itemName: deducted.name,
        quantity: params.quantity,
        sourceType: "user_inventory",
        sourceId: params.sourceUserId,
        sourceName: params.sourceUserName,
        targetType: "token_bag",
        targetId: params.tokenId,
        targetName: params.tokenName || loot.name || token.name,
        itemSnapshot: { ...deducted, quantity: params.quantity },
      };
      await LootLogService.appendLog(logEntry);
      return { success: true };
    }

    // Player sending item to token: dispatch EXECUTE_TRANSFER to GM
    const transferId = crypto.randomUUID();
    const promise = new Promise<{ success: boolean; error?: string }>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        this.pendingTransfers.delete(transferId);
        // Rollback deducted item on timeout
        this.addItemToInventory(sourceInv, deducted, params.quantity);
        LocalStorageAdapter.saveInventory(params.sourceUserId, sourceInv);
        void NetworkProtocol.syncInventory(sourceInv, params.sourceUserName);
        resolve({ success: false, error: "Transfer timed out waiting for GM." });
      }, 7000);

      this.pendingTransfers.set(transferId, { resolve, reject, timeoutId });
    });

    await NetworkProtocol.broadcast({
      action: "EXECUTE_TRANSFER",
      transferId,
      userId: myId,
      userName: myName,
      type: "GIVE",
      itemId: params.itemId,
      quantity: params.quantity,
      sourceType: "user_inventory",
      sourceId: params.sourceUserId,
      sourceName: params.sourceUserName,
      targetType: "token_bag",
      targetId: params.tokenId,
      targetName: params.tokenName,
      itemPayload: deducted,
    });

    const result = await promise;
    if (!result.success) {
      // Rollback on failure
      this.addItemToInventory(sourceInv, deducted, params.quantity);
      LocalStorageAdapter.saveInventory(params.sourceUserId, sourceInv);
      await NetworkProtocol.syncInventory(sourceInv, params.sourceUserName);
    }
    return result;
  }

  /**
   * Transfer item between two User Inventories.
   */
  public static async userToUser(params: {
    sourceUserId: string;
    sourceUserName: string;
    targetUserId: string;
    targetUserName: string;
    itemId: string;
    quantity: number;
    targetIsLocked: boolean;
  }): Promise<{ success: boolean; error?: string }> {
    this.initialize();
    let myId = "local-user";
    let myName = "Player";
    let myRole: "GM" | "PLAYER" = "PLAYER";

    if (OBR.isAvailable) {
      myId = await OBR.player.getId();
      myName = await OBR.player.getName();
      myRole = await OBR.player.getRole();
    }

    const isOwner = params.sourceUserId === myId;
    const isGM = myRole === "GM";

    // Source validation
    const sourceInv = LocalStorageAdapter.getInventory(params.sourceUserId);
    if (!isOwner && !isGM && sourceInv.isLocked) {
      return { success: false, error: "Source user inventory is locked." };
    }

    // Target validation
    if (!isGM && params.targetIsLocked) {
      return { success: false, error: "Target peer inventory is locked." };
    }

    const item = sourceInv.items.find((i) => i.id === params.itemId);
    if (!item || item.quantity < params.quantity) {
      return { success: false, error: "Insufficient item quantity in inventory." };
    }

    // Deduct from source
    const deducted = this.removeItemFromInventory(sourceInv, params.itemId, params.quantity);
    if (!deducted) return { success: false, error: "Item not found in inventory." };

    LocalStorageAdapter.saveInventory(params.sourceUserId, sourceInv);
    await NetworkProtocol.syncInventory(sourceInv, params.sourceUserName);

    const transferId = crypto.randomUUID();

    // If target is self (e.g. transfer between tabs / sub-accounts)
    if (params.targetUserId === myId) {
      this.addItemToInventory(sourceInv, deducted, params.quantity);
      LocalStorageAdapter.saveInventory(myId, sourceInv);
      await NetworkProtocol.syncInventory(sourceInv, myName);
    } else {
      // Send item to target peer
      await NetworkProtocol.sendTransferItem(
        params.targetUserId,
        { ...deducted, quantity: params.quantity },
        myId,
        myName,
        transferId,
      );
      if (!OBR.isAvailable) {
        const targetInv = LocalStorageAdapter.getInventory(params.targetUserId);
        this.addItemToInventory(targetInv, deducted, params.quantity);
        LocalStorageAdapter.saveInventory(params.targetUserId, targetInv);
      }
    }

    // Construct LootLogEntry and append
    const logEntry: LootLogEntry = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      userId: myId,
      userName: myName,
      action: "TRANSFER",
      itemId: params.itemId,
      itemName: deducted.name,
      quantity: params.quantity,
      sourceType: "user_inventory",
      sourceId: params.sourceUserId,
      sourceName: params.sourceUserName,
      targetType: "user_inventory",
      targetId: params.targetUserId,
      targetName: params.targetUserName,
      itemSnapshot: { ...deducted, quantity: params.quantity },
    };

    if (isGM) {
      await LootLogService.appendLog(logEntry);
    } else {
      await NetworkProtocol.appendLog(logEntry);
    }

    return { success: true };
  }

  /**
   * Rollback / undo a logged action, returning items to their original container.
   */
  public static async rollbackLogEntry(logId: string): Promise<{ success: boolean; error?: string }> {
    this.initialize();
    let myId = "local-user";
    let myRole: "GM" | "PLAYER" = "GM";

    if (OBR.isAvailable) {
      myId = await OBR.player.getId();
      myRole = await OBR.player.getRole();
    }

    const logs = await LootLogService.getLogs();
    const entry = logs.find((l) => l.id === logId);
    if (!entry) return { success: false, error: "Log entry not found." };
    if (entry.undone) return { success: false, error: "This action has already been undone." };

    // Players can only request undo for their own actions; GMs can undo any action
    if (myRole !== "GM") {
      if (entry.userId !== myId) {
        return { success: false, error: "Only the GM or initiator can undo this action." };
      }
      // Delegate to GM via socket
      await NetworkProtocol.requestUndo(logId, myId);
      return { success: true };
    }

    // Execute rollback logic under GM authority
    try {
      if (entry.action === "TAKE") {
        // Original: token_bag (sourceId) -> user_inventory (targetId)
        // Reversal: user_inventory (targetId) -> token_bag (sourceId)
        const targetInv = LocalStorageAdapter.getInventory(entry.targetId);
        const deducted = this.removeLoggedItemFromInventory(targetInv, entry);
        LocalStorageAdapter.saveInventory(entry.targetId, targetInv);
        void NetworkProtocol.syncInventory(targetInv, entry.targetName);

        if (OBR.isAvailable) {
          const token = await getToken(entry.sourceId);
          if (token) {
            const loot = getLoot(token);
            if (loot) {
              const itemToRestore = entry.itemSnapshot || deducted || {
                id: entry.itemId,
                name: entry.itemName,
                img: "⚔️",
                quantity: entry.quantity,
                data: {},
              };
              const lootItemToAdd = userInventoryItemToLootItem({
                ...itemToRestore,
                quantity: entry.quantity,
              });

              this.addItemToLoot(loot.items, lootItemToAdd);
              await saveLoot(token.id, loot);
            }
          }
        }
      } else if (entry.action === "GIVE") {
        // Original: user_inventory (sourceId) -> token_bag (targetId)
        // Reversal: token_bag (targetId) -> user_inventory (sourceId)
        if (OBR.isAvailable) {
          const token = await getToken(entry.targetId);
          if (token) {
            const loot = getLoot(token);
            if (loot) {
              this.removeItemFromLoot(
                loot.items,
                entry.itemId,
                entry.itemName,
                entry.itemSnapshot,
                entry.quantity,
              );
              await saveLoot(token.id, loot);
            }
          }
        }

        const srcInv = LocalStorageAdapter.getInventory(entry.sourceId);
        const itemToRestore = entry.itemSnapshot || {
          id: entry.itemId,
          name: entry.itemName,
          img: "⚔️",
          quantity: entry.quantity,
          data: {},
        };
        this.addItemToInventory(srcInv, itemToRestore, entry.quantity);
        LocalStorageAdapter.saveInventory(entry.sourceId, srcInv);
        void NetworkProtocol.syncInventory(srcInv, entry.sourceName);
      } else if (entry.action === "TRANSFER") {
        // Original: user_inventory (sourceId) -> user_inventory (targetId)
        // Reversal: user_inventory (targetId) -> user_inventory (sourceId)
        const targetInv = LocalStorageAdapter.getInventory(entry.targetId);
        const deducted = this.removeLoggedItemFromInventory(targetInv, entry);
        LocalStorageAdapter.saveInventory(entry.targetId, targetInv);
        void NetworkProtocol.syncInventory(targetInv, entry.targetName);

        const srcInv = LocalStorageAdapter.getInventory(entry.sourceId);
        const itemToRestore = entry.itemSnapshot || deducted || {
          id: entry.itemId,
          name: entry.itemName,
          img: "⚔️",
          quantity: entry.quantity,
          data: {},
        };
        this.addItemToInventory(srcInv, itemToRestore, entry.quantity);
        LocalStorageAdapter.saveInventory(entry.sourceId, srcInv);
        void NetworkProtocol.syncInventory(srcInv, entry.sourceName);
      } else if (entry.action === "DELETE") {
        // Original: item was deleted from user_inventory (sourceId)
        // Reversal: restore item back to user_inventory (sourceId)
        const srcInv = LocalStorageAdapter.getInventory(entry.sourceId);
        const itemToRestore = entry.itemSnapshot || {
          id: entry.itemId,
          name: entry.itemName,
          img: "⚔️",
          quantity: entry.quantity,
          data: {},
        };
        this.addItemToInventory(srcInv, itemToRestore, entry.quantity);
        LocalStorageAdapter.saveInventory(entry.sourceId, srcInv);
        void NetworkProtocol.syncInventory(srcInv, entry.sourceName);
      } else if (entry.action === "CREATE") {
        // Original: item was created in user_inventory (sourceId)
        // Reversal: remove created item from user_inventory (sourceId)
        const srcInv = LocalStorageAdapter.getInventory(entry.sourceId);
        this.removeLoggedItemFromInventory(srcInv, entry);
        LocalStorageAdapter.saveInventory(entry.sourceId, srcInv);
        void NetworkProtocol.syncInventory(srcInv, entry.sourceName);
      }

      await LootLogService.markUndone(logId);
      return { success: true };
    } catch (e: any) {
      console.error("Failed to rollback log entry", e);
      return { success: false, error: e.message || "Rollback failed." };
    }
  }

  /**
   * Redo an undone logged action, reapplying the action that was rolled back.
   */
  public static async redoLogEntry(logId: string): Promise<{ success: boolean; error?: string }> {
    this.initialize();
    let myId = "local-user";
    let myRole: "GM" | "PLAYER" = "GM";

    if (OBR.isAvailable) {
      myId = await OBR.player.getId();
      myRole = await OBR.player.getRole();
    }

    const logs = await LootLogService.getLogs();
    const entry = logs.find((l) => l.id === logId);
    if (!entry) return { success: false, error: "Log entry not found." };
    if (!entry.undone) return { success: false, error: "This action has not been undone." };

    // Players can only request redo for their own actions; GMs can redo any action
    if (myRole !== "GM") {
      if (entry.userId !== myId) {
        return { success: false, error: "Only the GM or initiator can redo this action." };
      }
      // Delegate to GM via socket
      await NetworkProtocol.requestRedo(logId, myId);
      return { success: true };
    }

    // Execute redo logic under GM authority
    try {
      if (entry.action === "TAKE") {
        // Original: token_bag (sourceId) -> user_inventory (targetId)
        // Redo: deduct from token_bag, add to user_inventory
        if (OBR.isAvailable) {
          const token = await getToken(entry.sourceId);
          if (token) {
            const loot = getLoot(token);
            if (loot) {
              this.removeItemFromLoot(
                loot.items,
                entry.itemId,
                entry.itemName,
                entry.itemSnapshot,
                entry.quantity,
              );
              await saveLoot(token.id, loot);
            }
          }
        }

        const targetInv = LocalStorageAdapter.getInventory(entry.targetId);
        const itemToRestore = entry.itemSnapshot || {
          id: entry.itemId,
          name: entry.itemName,
          img: "⚔️",
          quantity: entry.quantity,
          data: {},
        };
        this.addItemToInventory(targetInv, itemToRestore, entry.quantity);
        LocalStorageAdapter.saveInventory(entry.targetId, targetInv);
        void NetworkProtocol.syncInventory(targetInv, entry.targetName);
      } else if (entry.action === "GIVE") {
        // Original: user_inventory (sourceId) -> token_bag (targetId)
        // Redo: deduct from user_inventory, add to token_bag
        const srcInv = LocalStorageAdapter.getInventory(entry.sourceId);
        const deducted = this.removeLoggedItemFromInventory(srcInv, entry);
        LocalStorageAdapter.saveInventory(entry.sourceId, srcInv);
        void NetworkProtocol.syncInventory(srcInv, entry.sourceName);

        if (OBR.isAvailable) {
          const token = await getToken(entry.targetId);
          if (token) {
            const loot = getLoot(token);
            if (loot) {
              const itemToRestore = entry.itemSnapshot || deducted || {
                id: entry.itemId,
                name: entry.itemName,
                img: "⚔️",
                quantity: entry.quantity,
                data: {},
              };
              const lootItemToAdd = userInventoryItemToLootItem({
                ...itemToRestore,
                quantity: entry.quantity,
              });

              this.addItemToLoot(loot.items, lootItemToAdd);
              await saveLoot(token.id, loot);
            }
          }
        }
      } else if (entry.action === "TRANSFER") {
        // Original: user_inventory (sourceId) -> user_inventory (targetId)
        // Redo: deduct from sourceId, add to targetId
        const srcInv = LocalStorageAdapter.getInventory(entry.sourceId);
        const deducted = this.removeLoggedItemFromInventory(srcInv, entry);
        LocalStorageAdapter.saveInventory(entry.sourceId, srcInv);
        void NetworkProtocol.syncInventory(srcInv, entry.sourceName);

        const targetInv = LocalStorageAdapter.getInventory(entry.targetId);
        const itemToRestore = entry.itemSnapshot || deducted || {
          id: entry.itemId,
          name: entry.itemName,
          img: "⚔️",
          quantity: entry.quantity,
          data: {},
        };
        this.addItemToInventory(targetInv, itemToRestore, entry.quantity);
        LocalStorageAdapter.saveInventory(entry.targetId, targetInv);
        void NetworkProtocol.syncInventory(targetInv, entry.targetName);
      } else if (entry.action === "DELETE") {
        // Original: delete from user_inventory (sourceId)
        // Redo: remove from user_inventory (sourceId) again
        const srcInv = LocalStorageAdapter.getInventory(entry.sourceId);
        this.removeLoggedItemFromInventory(srcInv, entry);
        LocalStorageAdapter.saveInventory(entry.sourceId, srcInv);
        void NetworkProtocol.syncInventory(srcInv, entry.sourceName);
      } else if (entry.action === "CREATE") {
        // Original: create in user_inventory (sourceId)
        // Redo: re-add created item to user_inventory (sourceId)
        const srcInv = LocalStorageAdapter.getInventory(entry.sourceId);
        const itemToRestore = entry.itemSnapshot || {
          id: entry.itemId,
          name: entry.itemName,
          img: "✨",
          quantity: entry.quantity,
          data: {},
        };
        this.addItemToInventory(srcInv, itemToRestore, entry.quantity);
        LocalStorageAdapter.saveInventory(entry.sourceId, srcInv);
        void NetworkProtocol.syncInventory(srcInv, entry.sourceName);
      }

      await LootLogService.markRedone(logId);
      return { success: true };
    } catch (e: any) {
      console.error("Failed to redo log entry", e);
      return { success: false, error: e.message || "Redo failed." };
    }
  }

  /**
   * Helper: Undo the most recent action eligible for the current user or GM.
   */
  public static async undoMostRecent(userId?: string): Promise<{ success: boolean; entry?: LootLogEntry; error?: string }> {
    const logs = await LootLogService.getLogs();
    const entry = logs.find(
      (l) => !l.undone && (!userId || l.userId === userId || l.sourceId === userId || l.targetId === userId),
    );
    if (!entry) {
      return { success: false, error: "No actions available to undo." };
    }
    const res = await this.rollbackLogEntry(entry.id);
    return { ...res, entry };
  }

  /**
   * Helper: Redo the most recently undone action eligible for the current user or GM.
   */
  public static async redoMostRecent(userId?: string): Promise<{ success: boolean; entry?: LootLogEntry; error?: string }> {
    const logs = await LootLogService.getLogs();
    const undoneLogs = logs
      .filter(
        (l) => l.undone && (!userId || l.userId === userId || l.sourceId === userId || l.targetId === userId),
      )
      .sort((a, b) => (b.undoneAt || 0) - (a.undoneAt || 0));
    const entry = undoneLogs[0];
    if (!entry) {
      return { success: false, error: "No actions available to redo." };
    }
    const res = await this.redoLogEntry(entry.id);
    return { ...res, entry };
  }
}
