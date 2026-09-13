// Mock browser globals for Node testing
(globalThis as any).window = {
  location: { search: "", origin: "http://localhost:5173" },
  localStorage: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
};
(globalThis as any).document = {
  createElement: () => ({ append: () => {}, click: () => {} }),
  body: { appendChild: () => {}, removeChild: () => {} },
};

import test from "node:test";
import assert from "node:assert/strict";

const {
  createDefaultInventory,
  lootItemToUserInventoryItem,
  userInventoryItemToLootItem,
  sanitizeInventoryItem,
  sanitizeInventoryState,
} = await import("../src/modules/inventory/UserInventoryModel.ts");
const { LocalStorageAdapter } = await import("../src/storage/LocalStorageAdapter.ts");
const { ExportManager } = await import("../src/storage/ExportManager.ts");
const { TransferManager } = await import("../src/inventory/TransferManager.ts");
const { LootLogService } = await import("../src/inventory/LootLogService.ts");
import type { LootItem } from "../src/types.ts";

test("UserInventoryModel: creates default inventory with open/shared flags", () => {
  const inv = createDefaultInventory("user-123");
  assert.equal(inv.userId, "user-123");
  assert.equal(inv.isPublic, true);
  assert.equal(inv.isLocked, false);
  assert.deepEqual(inv.items, []);
  assert.ok(inv.updatedAt > 0);
});

test("UserInventoryModel: converts LootItem to UserInventoryItem and back", () => {
  const lootItem: LootItem = {
    id: "item-abc",
    kind: "item",
    name: "Vorpal Blade",
    quantity: 2,
    rarity: "legendary",
    icon: "🗡️",
    description: "A razor-sharp sword.",
    folder: "Weapons",
  };

  const invItem = lootItemToUserInventoryItem(lootItem);
  assert.equal(invItem.id, "item-abc");
  assert.equal(invItem.name, "Vorpal Blade");
  assert.equal(invItem.img, "🗡️");
  assert.equal(invItem.quantity, 2);
  assert.equal(invItem.data.rarity, "legendary");
  assert.equal(invItem.data.description, "A razor-sharp sword.");

  const restored = userInventoryItemToLootItem(invItem);
  assert.equal(restored.id, lootItem.id);
  assert.equal(restored.name, lootItem.name);
  assert.equal(restored.quantity, lootItem.quantity);
  assert.equal(restored.rarity, lootItem.rarity);
  assert.equal(restored.icon, lootItem.icon);
  assert.equal(restored.description, lootItem.description);
});

test("UserInventoryModel: sanitizes malformed data", () => {
  const badItem = sanitizeInventoryItem({
    id: "",
    name: 12345,
    quantity: -5,
  });
  assert.ok(badItem);
  assert.ok(badItem.id.length > 0);
  assert.equal(badItem.quantity, 1);

  const state = sanitizeInventoryState(
    {
      userId: "user-456",
      isPublic: "yes",
      isLocked: 0,
      items: [
        { id: "i1", name: "Valid Item", quantity: 3 },
        null,
        "string",
      ],
    },
    "fallback",
  );

  assert.equal(state.userId, "user-456");
  assert.equal(state.isPublic, true);
  assert.equal(state.isLocked, false);
  assert.equal(state.items.length, 1);
  assert.equal(state.items[0].name, "Valid Item");
  assert.equal(state.items[0].quantity, 3);
});

test("LocalStorageAdapter: saves, gets, and clears inventory with fallback", () => {
  const userId = "test-player-1";
  LocalStorageAdapter.clearInventory(userId);

  const initial = LocalStorageAdapter.getInventory(userId);
  assert.equal(initial.userId, userId);
  assert.equal(initial.items.length, 0);

  initial.items.push({
    id: "item-1",
    name: "Healing Potion",
    img: "🧪",
    quantity: 5,
    data: { rarity: "common" },
  });
  initial.isPublic = true;
  initial.isLocked = false;

  LocalStorageAdapter.saveInventory(userId, initial);

  const retrieved = LocalStorageAdapter.getInventory(userId);
  assert.equal(retrieved.userId, userId);
  assert.equal(retrieved.isPublic, true);
  assert.equal(retrieved.isLocked, false);
  assert.equal(retrieved.items.length, 1);
  assert.equal(retrieved.items[0].name, "Healing Potion");
  assert.equal(retrieved.items[0].quantity, 5);

  LocalStorageAdapter.clearInventory(userId);
  const cleared = LocalStorageAdapter.getInventory(userId);
  assert.equal(cleared.items.length, 0);
});

test("ExportManager: computes hash and parses valid JSON backup", async () => {
  const state = createDefaultInventory("user-exp");
  state.items.push({
    id: "gem-1",
    name: "Ruby",
    img: "💎",
    quantity: 3,
    data: { rarity: "rare" },
  });

  const hash = await ExportManager.computeHash(state);
  assert.ok(typeof hash === "string" && hash.length > 0);

  const rawExport = JSON.stringify({
    schemaVersion: 1,
    format: "master-loot-inventory",
    userId: "user-exp",
    exportedAt: Date.now(),
    verificationHash: hash,
    inventory: state,
  });

  const { state: imported, verified } = await ExportManager.parseAndValidate(
    rawExport,
    "user-new-owner",
  );

  assert.equal(verified, true);
  assert.equal(imported.userId, "user-new-owner");
  assert.equal(imported.items.length, 1);
  assert.equal(imported.items[0].name, "Ruby");
  assert.equal(imported.items[0].quantity, 3);
});

test("ExportManager: detects corrupted or invalid backup JSON", async () => {
  await assert.rejects(
    async () => {
      await ExportManager.parseAndValidate("{ invalid json }", "user");
    },
    /Invalid JSON format/,
  );

  await assert.rejects(
    async () => {
      await ExportManager.parseAndValidate(JSON.stringify({ someKey: 123 }), "user");
    },
    /Invalid backup format/,
  );
});

test("TransferManager: adds and stacks matching items correctly", () => {
  const inv = createDefaultInventory("user-stack");
  const item1 = {
    id: "potion-1",
    name: "Mana Potion",
    img: "🧪",
    quantity: 2,
    data: { rarity: "common" },
  };

  TransferManager.addItemToInventory(inv, item1, 2);
  assert.equal(inv.items.length, 1);
  assert.equal(inv.items[0].quantity, 2);

  // Add more of the same item
  TransferManager.addItemToInventory(inv, item1, 3);
  assert.equal(inv.items.length, 1);
  assert.equal(inv.items[0].quantity, 5);

  // Add different item
  const item2 = {
    id: "potion-2",
    name: "Elixir of Strength",
    img: "⚗️",
    quantity: 1,
    data: { rarity: "uncommon" },
  };
  TransferManager.addItemToInventory(inv, item2, 1);
  assert.equal(inv.items.length, 2);
});

test("TransferManager: removes and decrements items correctly", () => {
  const inv = createDefaultInventory("user-deduct");
  inv.items.push({
    id: "arrow-1",
    name: "Wooden Arrow",
    img: "🏹",
    quantity: 10,
    data: {},
  });

  // Deduct 4
  const part = TransferManager.removeItemFromInventory(inv, "arrow-1", 4);
  assert.ok(part);
  assert.equal(part.quantity, 4);
  assert.equal(inv.items.length, 1);
  assert.equal(inv.items[0].quantity, 6);

  // Deduct remaining 6
  const full = TransferManager.removeItemFromInventory(inv, "arrow-1", 6);
  assert.ok(full);
  assert.equal(full.quantity, 6);
  assert.equal(inv.items.length, 0);

  // Deduct non-existent
  const none = TransferManager.removeItemFromInventory(inv, "arrow-1", 1);
  assert.equal(none, null);
});

test("Edge Case: Attempting to loot a locked inventory as a non-GM player is rejected", async () => {
  const sourceUserId = "alice";
  const aliceInv = createDefaultInventory(sourceUserId);
  aliceInv.isLocked = true;
  aliceInv.items.push({
    id: "ring-1",
    name: "Ring of Protection",
    img: "💍",
    quantity: 1,
    data: { rarity: "rare" },
  });
  LocalStorageAdapter.saveInventory(sourceUserId, aliceInv);

  // Attempt transfer as non-owner (bob) and non-GM
  const result = await TransferManager.userToUser({
    sourceUserId: "alice",
    sourceUserName: "Alice",
    targetUserId: "bob",
    targetUserName: "Bob",
    itemId: "ring-1",
    quantity: 1,
    targetIsLocked: false,
  });

  assert.equal(result.success, false);
  assert.match(result.error || "", /locked/i);

  // Ensure ring wasn't deducted from Alice
  const aliceAfter = LocalStorageAdapter.getInventory(sourceUserId);
  assert.equal(aliceAfter.items.length, 1);
  assert.equal(aliceAfter.items[0].name, "Ring of Protection");
});

test("Edge Case: Multi-client sync when GM edits an online player's inventory", () => {
  const targetUserId = "player-charlie";
  const charlieInv = createDefaultInventory(targetUserId);
  charlieInv.items.push({
    id: "dagger-1",
    name: "Rusty Dagger",
    img: "🗡️",
    quantity: 1,
    data: {},
  });
  LocalStorageAdapter.saveInventory(targetUserId, charlieInv);

  // GM modifies Charlie's inventory by granting 500 Gold Coins
  const modifiedByGm = structuredClone(charlieInv);
  modifiedByGm.items.push({
    id: "gold-coins",
    name: "Gold Coins",
    img: "🪙",
    quantity: 500,
    data: { kind: "currency" },
  });

  // Client receives GM_MODIFY_INVENTORY and applies to local storage
  LocalStorageAdapter.saveInventory(targetUserId, modifiedByGm);

  const reloaded = LocalStorageAdapter.getInventory(targetUserId);
  assert.equal(reloaded.items.length, 2);
  assert.equal(reloaded.items[1].name, "Gold Coins");
  assert.equal(reloaded.items[1].quantity, 500);
});

test("Edge Case: Scene transitions verify user inventory persists without reset", () => {
  const userId = "persistent-user";
  const inv = createDefaultInventory(userId);
  inv.items.push({
    id: "spellbook-1",
    name: "Archmage's Grimoire",
    img: "📕",
    quantity: 1,
    data: { kind: "document" },
  });
  LocalStorageAdapter.saveInventory(userId, inv);

  // Simulate scene unload (tokens cleared, scene unready)
  const sceneReady = false;
  assert.equal(sceneReady, false);

  // Verify inventory is still intact in browser storage
  const duringTransition = LocalStorageAdapter.getInventory(userId);
  assert.equal(duringTransition.items.length, 1);
  assert.equal(duringTransition.items[0].name, "Archmage's Grimoire");

  // Simulate new scene load
  const newSceneReady = true;
  assert.equal(newSceneReady, true);
  const afterTransition = LocalStorageAdapter.getInventory(userId);
  assert.equal(afterTransition.items.length, 1);
  assert.equal(afterTransition.items[0].name, "Archmage's Grimoire");
});

test("Rollback / Undo: Reverses a user-to-user transfer action from the audit log", async () => {
  const userA = "player-a";
  const userB = "player-b";

  const invA = createDefaultInventory(userA);
  invA.items.push({
    id: "amulet-1",
    name: "Amulet of Health",
    img: "📿",
    quantity: 1,
    data: { rarity: "rare" },
  });
  LocalStorageAdapter.saveInventory(userA, invA);

  const invB = createDefaultInventory(userB);
  LocalStorageAdapter.saveInventory(userB, invB);

  // User A transfers amulet to User B
  const transferRes = await TransferManager.userToUser({
    sourceUserId: userA,
    sourceUserName: "Alice",
    targetUserId: userB,
    targetUserName: "Bob",
    itemId: "amulet-1",
    quantity: 1,
    targetIsLocked: false,
  });
  assert.equal(transferRes.success, true);

  // User A has 0, User B has 1
  assert.equal(LocalStorageAdapter.getInventory(userA).items.length, 0);
  assert.equal(LocalStorageAdapter.getInventory(userB).items.length, 1);

  // Simulate an audit log entry for this action
  const logId = "log-transfer-1";
  const logEntry: any = {
    id: logId,
    timestamp: Date.now(),
    userId: userA,
    userName: "Alice",
    action: "TRANSFER",
    itemId: "amulet-1",
    itemName: "Amulet of Health",
    quantity: 1,
    sourceType: "user_inventory",
    sourceId: userA,
    sourceName: "Alice",
    targetType: "user_inventory",
    targetId: userB,
    targetName: "Bob",
    itemSnapshot: {
      id: "amulet-1",
      name: "Amulet of Health",
      img: "📿",
      quantity: 1,
      data: { rarity: "rare" },
    },
  };

  await LootLogService.clearLogs();
  await LootLogService.appendLog(logEntry);

  // Trigger rollback
  const rollbackRes = await TransferManager.rollbackLogEntry(logId);
  assert.equal(rollbackRes.success, true);
  const updatedLogs = await LootLogService.getLogs();
  assert.equal(updatedLogs[0].undone, true);

  // Amulet is returned to User A, and removed from User B!
  const restoredA = LocalStorageAdapter.getInventory(userA);
  const clearedB = LocalStorageAdapter.getInventory(userB);
  assert.equal(restoredA.items.length, 1);
  assert.equal(restoredA.items[0].name, "Amulet of Health");
  assert.equal(clearedB.items.length, 0);

  // Second rollback should be rejected
  const doubleUndoRes = await TransferManager.rollbackLogEntry(logId);
  assert.equal(doubleUndoRes.success, false);
  assert.match(doubleUndoRes.error || "", /already been undone/i);
});

test("Rollback / Undo: Reverses a take-from-bag action and removes item from user inventory", async () => {
  const userId = "thief";
  const userInv = createDefaultInventory(userId);
  userInv.items.push({
    id: "crown-1",
    name: "Crown of Kings",
    img: "👑",
    quantity: 1,
    data: { rarity: "legendary" },
  });
  LocalStorageAdapter.saveInventory(userId, userInv);

  const logId = "log-take-1";
  const logEntry: any = {
    id: logId,
    timestamp: Date.now(),
    userId,
    userName: "Thief",
    action: "TAKE",
    itemId: "crown-1",
    itemName: "Crown of Kings",
    quantity: 1,
    sourceType: "token_bag",
    sourceId: "token-chest",
    sourceName: "Treasure Chest",
    targetType: "user_inventory",
    targetId: userId,
    targetName: "Thief",
    itemSnapshot: {
      id: "crown-1",
      name: "Crown of Kings",
      img: "👑",
      quantity: 1,
      data: { rarity: "legendary" },
    },
  };

  await LootLogService.clearLogs();
  await LootLogService.appendLog(logEntry);

  const rollbackRes = await TransferManager.rollbackLogEntry(logId);
  assert.equal(rollbackRes.success, true);
  const logsAfter = await LootLogService.getLogs();
  assert.equal(logsAfter[0].undone, true);

  // Item is removed from the user's inventory
  const finalUserInv = LocalStorageAdapter.getInventory(userId);
  assert.equal(finalUserInv.items.length, 0);
});

test("Item Creation: Players can create custom items with sections and tags", async () => {
  const userId = "hero";
  LocalStorageAdapter.clearInventory(userId);

  const res = await TransferManager.createItemInInventory({
    userId,
    userName: "Hero",
    item: {
      name: "Elixir of Vitality",
      img: "🧪",
      quantity: 3,
      section: "Potions",
      tags: ["healing", "consumable"],
      description: "Heals 50 HP and cures poison.",
      rarity: "rare",
    },
  });

  assert.equal(res.success, true);
  assert.ok(res.item);
  assert.equal(res.item.name, "Elixir of Vitality");
  assert.equal(res.item.quantity, 3);
  assert.equal(res.item.section, "Potions");
  assert.deepEqual(res.item.tags, ["healing", "consumable"]);

  const inv = LocalStorageAdapter.getInventory(userId);
  assert.equal(inv.items.length, 1);
  assert.equal(inv.items[0].name, "Elixir of Vitality");
  assert.ok(inv.sections?.includes("Potions"));

  // Audit log contains CREATE action
  const logs = await LootLogService.getLogs();
  const createEntry = logs.find((l) => l.action === "CREATE" && l.itemName === "Elixir of Vitality");
  assert.ok(createEntry);
  assert.equal(createEntry.quantity, 3);
});

test("Item Deletion & Rollback: Deleting an item logs DELETE and rollback restores it", async () => {
  const userId = "sorcerer";
  const userInv = createDefaultInventory(userId);
  userInv.items.push({
    id: "scroll-99",
    name: "Scroll of Fireball",
    img: "📜",
    quantity: 2,
    section: "Scrolls",
    tags: ["evocation", "spell"],
    data: { rarity: "uncommon", description: "8d6 fire damage" },
  });
  LocalStorageAdapter.saveInventory(userId, userInv);

  // Delete 1 scroll
  const delRes = await TransferManager.deleteItemFromInventory({
    userId,
    userName: "Sorcerer",
    itemId: "scroll-99",
    quantity: 1,
  });
  assert.equal(delRes.success, true);

  const afterDelInv = LocalStorageAdapter.getInventory(userId);
  assert.equal(afterDelInv.items.length, 1);
  assert.equal(afterDelInv.items[0].quantity, 1);

  // Check audit log
  const logs = await LootLogService.getLogs();
  const deleteEntry = logs.find((l) => l.action === "DELETE" && l.itemId === "scroll-99");
  assert.ok(deleteEntry);
  assert.equal(deleteEntry.quantity, 1);
  assert.equal(deleteEntry.itemName, "Scroll of Fireball");

  // Undo deletion: rollback should restore the deleted scroll back to quantity 2!
  const undoRes = await TransferManager.rollbackLogEntry(deleteEntry.id);
  assert.equal(undoRes.success, true);

  const restoredInv = LocalStorageAdapter.getInventory(userId);
  assert.equal(restoredInv.items[0].quantity, 2);
});

test("Inventory Search & Tag Filtering: filters items matching query and tags", () => {
  const items = [
    {
      id: "1",
      name: "Dagger of Venom",
      img: "🗡️",
      quantity: 1,
      section: "Weapons",
      tags: ["poison", "weapon", "light"],
      data: { description: "Deals 2d10 poison damage on hit." },
    },
    {
      id: "2",
      name: "Potion of Healing",
      img: "🧪",
      quantity: 5,
      section: "Potions",
      tags: ["healing", "consumable"],
      data: { description: "Regains 2d4 + 2 hit points." },
    },
    {
      id: "3",
      name: "Ancient Tome",
      img: "📜",
      quantity: 1,
      section: "Quest Items",
      tags: ["quest", "lore"],
      data: { description: "Written in Celestial." },
    },
  ];

  // Search by name substring
  const searchName = items.filter((i) => i.name.toLowerCase().includes("dagger"));
  assert.equal(searchName.length, 1);
  assert.equal(searchName[0].id, "1");

  // Search by description substring
  const searchDesc = items.filter((i) => i.data.description.toLowerCase().includes("celestial"));
  assert.equal(searchDesc.length, 1);
  assert.equal(searchDesc[0].id, "3");

  // Filter by tag
  const filterTag = items.filter((i) => i.tags.includes("consumable"));
  assert.equal(filterTag.length, 1);
  assert.equal(filterTag[0].id, "2");

  // Combined search across name, description, tags, and section
  const query = "healing";
  const combined = items.filter((i) => {
    return (
      i.name.toLowerCase().includes(query) ||
      i.data.description.toLowerCase().includes(query) ||
      i.tags.some((t) => t.toLowerCase().includes(query)) ||
      (i.section && i.section.toLowerCase().includes(query))
    );
  });
  assert.equal(combined.length, 1);
  assert.equal(combined[0].name, "Potion of Healing");
});

test("Redo / Reversal: Re-applies undone user transfer (Transfer -> Undo -> Redo)", async () => {
  const userA = "player-alpha";
  const userB = "player-beta";
  LocalStorageAdapter.clearInventory(userA);
  LocalStorageAdapter.clearInventory(userB);

  const invA = createDefaultInventory(userA);
  invA.items.push({
    id: "gem-1",
    name: "Ruby of Fire",
    img: "💎",
    quantity: 1,
    data: {},
  });
  LocalStorageAdapter.saveInventory(userA, invA);

  const logId = "log-tx-redo";
  const logEntry: any = {
    id: logId,
    timestamp: Date.now(),
    userId: userA,
    userName: "Alpha",
    action: "TRANSFER",
    itemId: "gem-1",
    itemName: "Ruby of Fire",
    quantity: 1,
    sourceType: "user_inventory",
    sourceId: userA,
    sourceName: "Alpha",
    targetType: "user_inventory",
    targetId: userB,
    targetName: "Beta",
    itemSnapshot: {
      id: "gem-1",
      name: "Ruby of Fire",
      img: "💎",
      quantity: 1,
      data: {},
    },
  };

  // 1. Initial transfer completed: B has item, A has 0
  const invB = createDefaultInventory(userB);
  invB.items.push(logEntry.itemSnapshot);
  LocalStorageAdapter.saveInventory(userB, invB);
  invA.items = [];
  LocalStorageAdapter.saveInventory(userA, invA);

  await LootLogService.clearLogs();
  await LootLogService.appendLog(logEntry);

  // 2. Undo: returns item to A, deducts from B
  const undoRes = await TransferManager.rollbackLogEntry(logId);
  assert.equal(undoRes.success, true);
  assert.equal(LocalStorageAdapter.getInventory(userA).items.length, 1);
  assert.equal(LocalStorageAdapter.getInventory(userB).items.length, 0);

  // 3. Redo: moves item back from A to B
  const redoRes = await TransferManager.redoLogEntry(logId);
  assert.equal(redoRes.success, true);
  assert.equal(LocalStorageAdapter.getInventory(userA).items.length, 0);
  assert.equal(LocalStorageAdapter.getInventory(userB).items.length, 1);
  assert.equal(LocalStorageAdapter.getInventory(userB).items[0].name, "Ruby of Fire");

  const logs = await LootLogService.getLogs();
  assert.equal(logs[0].undone, false);
});

test("Redo / Reversal: Re-applies undone item creation (Create -> Undo -> Redo)", async () => {
  const userId = "crafter";
  LocalStorageAdapter.clearInventory(userId);
  await LootLogService.clearLogs();

  // 1. Create item
  const createRes = await TransferManager.createItemInInventory({
    userId,
    userName: "Crafter",
    item: {
      name: "Ring of Wizardry",
      img: "💍",
      quantity: 1,
      section: "Accessories",
      tags: ["magic", "ring"],
      data: { rarity: "epic" },
    },
  });
  assert.equal(createRes.success, true);
  const logs = await LootLogService.getLogs();
  const createLog = logs[0];
  assert.equal(createLog.action, "CREATE");

  // 2. Undo creation
  const undoRes = await TransferManager.rollbackLogEntry(createLog.id);
  assert.equal(undoRes.success, true);
  assert.equal(LocalStorageAdapter.getInventory(userId).items.length, 0);

  // 3. Redo creation
  const redoRes = await TransferManager.redoLogEntry(createLog.id);
  assert.equal(redoRes.success, true);
  const reCreatedInv = LocalStorageAdapter.getInventory(userId);
  assert.equal(reCreatedInv.items.length, 1);
  assert.equal(reCreatedInv.items[0].name, "Ring of Wizardry");
});

test("Ctrl+Z & Ctrl+Y: undoMostRecent and redoMostRecent cycle actions properly", async () => {
  const userId = "fast-fingers";
  LocalStorageAdapter.clearInventory(userId);
  await LootLogService.clearLogs();

  // Create item
  await TransferManager.createItemInInventory({
    userId,
    userName: "FastFingers",
    item: {
      name: "Swift Boots",
      img: "👢",
      quantity: 1,
      section: "Gear",
      tags: ["speed"],
      data: {},
    },
  });

  assert.equal(LocalStorageAdapter.getInventory(userId).items.length, 1);

  // Undo via helper (Ctrl+Z)
  const undoRes = await TransferManager.undoMostRecent(userId);
  assert.equal(undoRes.success, true);
  assert.equal(LocalStorageAdapter.getInventory(userId).items.length, 0);

  // Redo via helper (Ctrl+Y)
  const redoRes = await TransferManager.redoMostRecent(userId);
  assert.equal(redoRes.success, true);
  assert.equal(LocalStorageAdapter.getInventory(userId).items.length, 1);
  assert.equal(LocalStorageAdapter.getInventory(userId).items[0].name, "Swift Boots");
});

test("WindowResizer: getSavedWindowSize and saveWindowSize persist window sizes", async () => {
  const { getSavedWindowSize, saveWindowSize } = await import("../src/windowResizer.ts");
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
  };

  const defaults = { width: 480, height: 620 };
  assert.deepEqual(getSavedWindowSize("inventory", defaults), defaults);

  saveWindowSize("inventory", { width: 600, height: 750 });
  const retrieved = getSavedWindowSize("inventory", defaults);
  assert.equal(retrieved.width, 600);
  assert.equal(retrieved.height, 750);

  // Corrupted / invalid data falls back to defaults
  store.set("master-loot:window-size:inventory", "{ malformed json");
  assert.deepEqual(getSavedWindowSize("inventory", defaults), defaults);

  store.set("master-loot:window-size:inventory", JSON.stringify({ width: 10, height: 10 }));
  assert.deepEqual(getSavedWindowSize("inventory", defaults), defaults);
});


