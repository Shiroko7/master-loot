import OBR from "@owlbear-rodeo/sdk";
import { CTX_EDIT_ID } from "./constants";
import {
  badgePosition,
  getBadgeCorner,
  getLoot,
  isBadge,
  isSparkle,
  openEditorModal,
  openLootPopover,
  syncBadge,
} from "./loot";
import { TransferManager } from "./inventory/TransferManager";
import { NetworkProtocol } from "./inventory/NetworkProtocol";
import { LocalStorageAdapter } from "./storage/LocalStorageAdapter";

async function setupLootContextMenu(): Promise<void> {
  // Keep a GM entry point for giving loot to tokens with no container yet.
  await OBR.contextMenu.create({
    id: CTX_EDIT_ID,
    icons: [
      {
        icon: "/icon.svg",
        label: "Loot",
        filter: {
          max: 1,
          roles: ["GM"],
          every: [{ key: "type", value: "IMAGE" }],
        },
      },
    ],
    onClick(context) {
      const token = context.items[0];
      if (token) void openEditorModal(token.id);
    },
  });
}

/**
 * Single-click looting: when a player selects a loot badge, immediately
 * deselect it and open the loot popover for the token it is attached to.
 */
function watchBadgeClicks(): void {
  let lastSelection: string[] = [];
  OBR.player.onChange((player) => {
    const selection = player.selection ?? [];
    const added = selection.filter((id) => !lastSelection.includes(id));
    lastSelection = selection;
    if (added.length !== 1) return;
    void handleSelected(added[0]);
  });
}

async function handleSelected(itemId: string): Promise<void> {
  if (!(await OBR.scene.isReady())) return;
  const [item] = await OBR.scene.items.getItems([itemId]);
  if (!item || !isBadge(item) || !item.attachedTo) return;
  await OBR.player.deselect();
  const bounds = await OBR.scene.items.getItemBounds([item.id]);
  const screen = await OBR.viewport.transformPoint(bounds.center);
  await openLootPopover(item.attachedTo, {
    position: { left: screen.x, top: screen.y },
  });
}

/**
 * GM-side owner of badge/sparkle attachments: they always mirror each
 * token's `enabled` flag (covers copied tokens, undo/redo, edits from
 * another GM window, ...). This is the ONLY place that creates them — the
 * editor just saves metadata — and passes are serialized so overlapping
 * onChange events can't race each other into duplicates. Any duplicates
 * that still slip in (e.g. from two GM windows) are deleted next pass.
 */
let cleanupRunning = false;
let cleanupQueued = false;

function requestCleanup(): void {
  void (async () => {
    if (cleanupRunning) {
      cleanupQueued = true;
      return;
    }
    cleanupRunning = true;
    try {
      if ((await OBR.player.getRole()) !== "GM") return;
      do {
        cleanupQueued = false;
        await cleanupPass();
      } while (cleanupQueued);
    } finally {
      cleanupRunning = false;
    }
  })();
}

function watchSceneForCleanup(): void {
  OBR.scene.items.onChange(() => requestCleanup());
  // Badge-corner setting lives in room metadata; re-snap when it changes.
  OBR.room.onMetadataChange(() => requestCleanup());
  OBR.scene.onReadyChange((ready) => {
    if (ready) requestCleanup();
  });
  // Initial pass: heal scenes that LOAD with stale state (badges in an old
  // corner, duplicates, orphans) instead of waiting for something to change.
  requestCleanup();
}

async function cleanupPass(): Promise<void> {
  if (!(await OBR.scene.isReady())) return;
  const items = await OBR.scene.items.getItems();
  const byId = new Map(items.map((i) => [i.id, i]));

  // Delete attachments that are orphaned (owner gone or not lootable) and
  // any duplicates beyond the first badge/sparkle per token.
  const removed = new Set<string>();
  for (const kind of [isBadge, isSparkle]) {
    const seen = new Set<string>();
    for (const attachment of items.filter(kind)) {
      const owner = attachment.attachedTo
        ? byId.get(attachment.attachedTo)
        : undefined;
      if (!owner || getLoot(owner)?.enabled !== true || seen.has(owner.id)) {
        removed.add(attachment.id);
      } else {
        seen.add(owner.id);
      }
    }
  }
  if (removed.size > 0) {
    await OBR.scene.items.deleteItems([...removed]);
  }

  const badgedOwners = new Set(
    items.filter((i) => isBadge(i) && !removed.has(i.id)).map((b) => b.attachedTo),
  );
  const sparkledOwners = new Set(
    items.filter((i) => isSparkle(i) && !removed.has(i.id)).map((s) => s.attachedTo),
  );
  const missing = items.filter(
    (item) =>
      !isBadge(item) &&
      !isSparkle(item) &&
      getLoot(item)?.enabled === true &&
      (!badgedOwners.has(item.id) || !sparkledOwners.has(item.id)),
  );
  for (const token of missing) {
    await syncBadge(token.id, true);
  }

  // Snap surviving badges into the configured corner (covers resized
  // tokens, corner-setting changes and badges from older versions).
  const corner = await getBadgeCorner();
  const moves = new Map<string, { x: number; y: number }>();
  for (const badge of items.filter(isBadge)) {
    if (removed.has(badge.id) || !badge.attachedTo) continue;
    const expected = await badgePosition(badge.attachedTo, corner);
    if (
      Math.abs(badge.position.x - expected.x) > 0.5 ||
      Math.abs(badge.position.y - expected.y) > 0.5
    ) {
      moves.set(badge.id, expected);
    }
  }
  if (moves.size > 0) {
    await OBR.scene.items.updateItems([...moves.keys()], (updates) => {
      for (const item of updates) {
        const pos = moves.get(item.id);
        if (pos) item.position = { x: pos.x, y: pos.y };
      }
    });
  }
}

OBR.onReady(async () => {
  TransferManager.initialize();
  NetworkProtocol.initialize();

  try {
    const myId = await OBR.player.getId();
    const myName = await OBR.player.getName();
    const myInv = LocalStorageAdapter.getInventory(myId);
    await NetworkProtocol.syncInventory(myInv, myName);
  } catch (err) {
    console.warn("Master Loot: background inventory initial sync failed", err);
  }

  void setupLootContextMenu();
  watchBadgeClicks();
  watchSceneForCleanup();
});
