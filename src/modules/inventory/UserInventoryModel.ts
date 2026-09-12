import type { LootItem, Rarity } from "../../types";

export interface UserInventoryItem {
  id: string; // Unique identifier
  name: string;
  img: string;
  quantity: number;
  section?: string; // Custom section/category created by player
  tags?: string[]; // Custom or item tags for filtering
  data: Record<string, any>; // Item system data/attributes
}

export interface UserInventoryState {
  userId: string;
  isPublic: boolean; // Can other non-GM players view? Default: true
  isLocked: boolean; // Can other non-GM players transfer to/from? Default: false
  sections?: string[]; // Player-defined sections/categories
  items: UserInventoryItem[];
  updatedAt: number;
}

export interface LootLogEntry {
  id: string;
  timestamp: number;
  userId: string; // User who initiated the action
  userName: string;
  action: "TAKE" | "GIVE" | "TRANSFER" | "CREATE" | "DELETE";
  itemId: string;
  itemName: string;
  quantity: number;
  sourceType: "token_bag" | "user_inventory";
  sourceId: string; // Token ID or User ID
  sourceName: string;
  targetType: "token_bag" | "user_inventory";
  targetId: string;
  targetName: string;
  undone?: boolean;
  undoneAt?: number;
  redoneAt?: number;
  itemSnapshot?: UserInventoryItem;
}

export const INVENTORY_SCHEMA_VERSION = 1;

/**
 * Creates a clean default inventory state for a user.
 * Defaults to open (public), shared (unlocked), and includes basic sections.
 */
export function createDefaultInventory(userId: string): UserInventoryState {
  return {
    userId,
    isPublic: true,
    isLocked: false,
    sections: ["Equipment", "Consumables", "Treasure"],
    items: [],
    updatedAt: Date.now(),
  };
}

/**
 * Convert a scene LootItem to a persistent UserInventoryItem.
 */
export function lootItemToUserInventoryItem(lootItem: LootItem): UserInventoryItem {
  const section = lootItem.folder || (lootItem as any).data?.section || undefined;
  const rawTags = (lootItem as any).tags || (lootItem as any).data?.tags;
  const tags: string[] = Array.isArray(rawTags)
    ? rawTags.map((t: any) => String(t).trim()).filter((t: string) => t.length > 0)
    : [];

  return {
    id: lootItem.id || crypto.randomUUID(),
    name: lootItem.name || "Unnamed Item",
    img: lootItem.icon || "⚔️",
    quantity: Math.max(1, lootItem.quantity || 1),
    section,
    tags,
    data: {
      kind: lootItem.kind || "item",
      rarity: lootItem.rarity || "none",
      folder: lootItem.folder || section,
      section,
      tags,
      description: lootItem.description,
      link: lootItem.link,
      document: lootItem.document,
      coins: lootItem.coins,
      profile: lootItem.profile,
    },
  };
}

/**
 * Convert a UserInventoryItem back to a scene LootItem.
 */
export function userInventoryItemToLootItem(invItem: UserInventoryItem): LootItem {
  const data = invItem.data || {};
  return {
    id: invItem.id || crypto.randomUUID(),
    kind: data.kind || "item",
    name: invItem.name || "Unnamed Item",
    quantity: Math.max(1, invItem.quantity || 1),
    rarity: (data.rarity as Rarity) || "none",
    icon: invItem.img || "⚔️",
    folder: invItem.section || data.folder || data.section,
    description: data.description,
    link: data.link,
    document: data.document,
    coins: data.coins,
    profile: data.profile,
    tags: invItem.tags || data.tags,
    data: {
      ...data,
      section: invItem.section,
      tags: invItem.tags,
    },
  } as any;
}

/**
 * Sanitize a user inventory item, ensuring safe types and valid fields.
 */
export function sanitizeInventoryItem(raw: any): UserInventoryItem | null {
  if (!raw || typeof raw !== "object") return null;

  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : crypto.randomUUID();
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "Unknown Item";
  const img = typeof raw.img === "string" && raw.img.trim() ? raw.img.trim() : "⚔️";
  const rawQty = Number(raw.quantity);
  const quantity = Number.isFinite(rawQty) && rawQty > 0 ? Math.floor(rawQty) : 1;
  const data = typeof raw.data === "object" && raw.data !== null ? { ...raw.data } : {};

  const section =
    typeof raw.section === "string" && raw.section.trim()
      ? raw.section.trim()
      : typeof data.section === "string" && data.section.trim()
      ? data.section.trim()
      : typeof data.folder === "string" && data.folder.trim()
      ? data.folder.trim()
      : undefined;

  let tags: string[] = [];
  if (Array.isArray(raw.tags)) {
    tags = raw.tags
      .filter((t: any) => typeof t === "string" && t.trim().length > 0)
      .map((t: string) => t.trim());
  } else if (Array.isArray(data.tags)) {
    tags = data.tags
      .filter((t: any) => typeof t === "string" && t.trim().length > 0)
      .map((t: string) => t.trim());
  }

  if (section) data.section = section;
  if (tags.length > 0) data.tags = tags;

  return { id, name, img, quantity, section, tags, data };
}

/**
 * Validates and sanitizes a complete UserInventoryState object.
 */
export function sanitizeInventoryState(raw: any, fallbackUserId: string): UserInventoryState {
  if (!raw || typeof raw !== "object") {
    return createDefaultInventory(fallbackUserId);
  }

  const userId =
    typeof raw.userId === "string" && raw.userId.trim() ? raw.userId.trim() : fallbackUserId;
  const isPublic = raw.isPublic !== undefined ? Boolean(raw.isPublic) : true;
  const isLocked = raw.isLocked !== undefined ? Boolean(raw.isLocked) : false;
  const updatedAt = typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now();

  const sections: string[] = Array.isArray(raw.sections)
    ? raw.sections
        .filter((s: any) => typeof s === "string" && s.trim().length > 0)
        .map((s: string) => s.trim())
    : ["Equipment", "Consumables", "Treasure"];

  const rawItems = Array.isArray(raw.items) ? raw.items : [];
  const items: UserInventoryItem[] = [];

  for (const rawItem of rawItems) {
    const cleanItem = sanitizeInventoryItem(rawItem);
    if (cleanItem) {
      items.push(cleanItem);
    }
  }

  return {
    userId,
    isPublic,
    isLocked,
    sections,
    items,
    updatedAt,
  };
}
