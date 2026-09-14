import {
  COIN_KINDS,
  COIN_META,
  type CoinKind,
  type LootItem,
  type Rarity,
} from "../../types";

export const DEFAULT_INVENTORY_SECTIONS = [
  "Melee Weapons",
  "Ranged Weapons",
  "Armor & Shields",
  "Wondrous Items",
  "Potions & Consumables",
  "Documents & Lore",
  "Coins & Valuables",
  "Quest Items",
  "Other",
] as const;

export type DefaultInventorySection = (typeof DEFAULT_INVENTORY_SECTIONS)[number];

export const OTHER_INVENTORY_SECTION = "Other";
export const DOCUMENTS_INVENTORY_SECTION = "Documents & Lore";
export const CURRENCY_INVENTORY_SECTION = "Coins & Valuables";

const LEGACY_DEFAULT_SECTIONS = new Set(["Equipment", "Consumables", "Treasure"]);

export const CURRENCY_STACK_META: Record<
  CoinKind,
  { name: string; icon: string }
> = {
  pp: { name: "Platinum Coins", icon: "\u{1FA99}" },
  gp: { name: "Gold Coins", icon: "\u{1FA99}" },
  ep: { name: "Electrum Coins", icon: "\u{1FA99}" },
  sp: { name: "Silver Coins", icon: "\u{1FA99}" },
  cp: { name: "Copper Coins", icon: "\u{1FA99}" },
};

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

function positiveCoinKinds(coins: unknown): CoinKind[] {
  if (!coins || typeof coins !== "object") return [];
  return COIN_KINDS.filter((kind) => {
    const value = Number((coins as Record<string, unknown>)[kind]);
    return Number.isFinite(value) && value > 0;
  });
}

function inferredCurrencyKind(item: UserInventoryItem): CoinKind | undefined {
  const rawKind = item.data?.coinKind;
  if (typeof rawKind === "string" && COIN_KINDS.includes(rawKind as CoinKind)) {
    return rawKind as CoinKind;
  }

  const coinKinds = positiveCoinKinds(item.data?.coins);
  if (coinKinds.length === 1) return coinKinds[0];

  const name = item.name.toLowerCase();
  return COIN_KINDS.find((kind) => {
    const namePart = COIN_META[kind].name.toLowerCase();
    return name.includes(namePart) || name.includes(` ${kind}`) || name.startsWith(`${kind} `);
  });
}

export function defaultInventorySectionForKind(kind?: string): string {
  if (kind === "currency") return CURRENCY_INVENTORY_SECTION;
  if (kind === "document" || kind === "idcard") return DOCUMENTS_INVENTORY_SECTION;
  return OTHER_INVENTORY_SECTION;
}

export function isCurrencyStack(item: UserInventoryItem): boolean {
  return item.data?.kind === "currency" && !!inferredCurrencyKind(item);
}

export function getCurrencyStackKind(item: UserInventoryItem): CoinKind | undefined {
  return item.data?.kind === "currency" ? inferredCurrencyKind(item) : undefined;
}

/** Build one inventory item representing a single denomination stack. */
export function createCurrencyStackItem(
  kind: CoinKind,
  quantity: number,
  source?: Partial<UserInventoryItem>,
): UserInventoryItem {
  const amount = Math.max(1, Math.floor(quantity));
  const meta = CURRENCY_STACK_META[kind];
  return {
    id: source?.id || crypto.randomUUID(),
    name: meta.name,
    img: source?.img || meta.icon,
    quantity: amount,
    section: CURRENCY_INVENTORY_SECTION,
    tags: source?.tags || ["currency", kind],
    data: {
      ...(source?.data || {}),
      kind: "currency",
      coinKind: kind,
      coins: { [kind]: amount },
      section: CURRENCY_INVENTORY_SECTION,
      tags: source?.tags || ["currency", kind],
    },
  };
}

/**
 * Expand a legacy purse item into denomination stacks. Non-currency items and
 * currency items without enough information to identify a denomination are
 * returned unchanged so no user data is lost during migration.
 */
export function expandCurrencyInventoryItem(item: UserInventoryItem): UserInventoryItem[] {
  if (item.data?.kind !== "currency") return [item];

  const purse = item.data?.coins;
  const purseKinds = positiveCoinKinds(purse);
  if (item.data?.coinKind && COIN_KINDS.includes(item.data.coinKind as CoinKind)) {
    return [createCurrencyStackItem(item.data.coinKind as CoinKind, item.quantity, item)];
  }

  if (purseKinds.length > 0) {
    return purseKinds.map((coinKind, index) =>
      createCurrencyStackItem(
        coinKind,
        Number((purse as Record<string, unknown>)[coinKind]) * Math.max(1, item.quantity),
        {
          ...item,
          id: index === 0 ? item.id : `${item.id}:${coinKind}`,
        },
      ),
    );
  }

  const kind = inferredCurrencyKind(item);
  if (kind) return [createCurrencyStackItem(kind, item.quantity, item)];

  return [{
    ...item,
    section: item.section || CURRENCY_INVENTORY_SECTION,
    data: {
      ...item.data,
      section: item.section || CURRENCY_INVENTORY_SECTION,
    },
  }];
}

/** Return the coin purse represented by an inventory stack and quantity. */
export function currencyPurseForInventoryItem(
  item: UserInventoryItem,
  quantity = item.quantity,
): Partial<Record<CoinKind, number>> {
  const explicitKind = item.data?.coinKind;
  if (typeof explicitKind === "string" && COIN_KINDS.includes(explicitKind as CoinKind)) {
    return { [explicitKind as CoinKind]: Math.max(0, Math.floor(quantity)) };
  }

  const purse = item.data?.coins;
  if (purse && typeof purse === "object") {
    return Object.fromEntries(
      COIN_KINDS.map((coinKind) => {
        const amount = Number((purse as Record<string, unknown>)[coinKind]) || 0;
        return [coinKind, amount * Math.max(0, Math.floor(quantity))];
      }).filter(([, amount]) => Number(amount) > 0),
    ) as Partial<Record<CoinKind, number>>;
  }

  const kind = getCurrencyStackKind(item);
  return kind ? { [kind]: Math.max(0, Math.floor(quantity)) } : {};
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

export const INVENTORY_SCHEMA_VERSION = 2;

/**
 * Creates a clean default inventory state for a user.
 * Defaults to open (public), shared (unlocked), and includes useful sections.
 */
export function createDefaultInventory(userId: string): UserInventoryState {
  return {
    userId,
    isPublic: true,
    isLocked: false,
    sections: [...DEFAULT_INVENTORY_SECTIONS],
    items: [],
    updatedAt: Date.now(),
  };
}

/**
 * Convert a scene LootItem to a persistent UserInventoryItem.
 */
export function lootItemToUserInventoryItem(lootItem: LootItem): UserInventoryItem {
  const kind = lootItem.kind || "item";
  const section =
    kind === "currency"
      ? CURRENCY_INVENTORY_SECTION
      : lootItem.folder || (lootItem as any).data?.section || defaultInventorySectionForKind(kind);
  const rawTags = (lootItem as any).tags || (lootItem as any).data?.tags;
  const tags: string[] = Array.isArray(rawTags)
    ? rawTags.map((t: any) => String(t).trim()).filter((t: string) => t.length > 0)
    : [];
  const rawQuantity = Math.max(1, lootItem.quantity || 1);
  const coinKinds = kind === "currency" ? positiveCoinKinds(lootItem.coins) : [];
  const singleCoinKind = coinKinds.length === 1 ? coinKinds[0] : undefined;
  const quantity = singleCoinKind
    ? Math.max(1, Math.floor(Number(lootItem.coins?.[singleCoinKind]) || 0) * rawQuantity)
    : rawQuantity;
  const coins = singleCoinKind
    ? { [singleCoinKind]: quantity }
    : lootItem.coins;

  return {
    id: lootItem.id || crypto.randomUUID(),
    name: lootItem.name || "Unnamed Item",
    img: lootItem.icon || "⚔️",
    quantity,
    section,
    tags,
    data: {
      kind,
      ...(kind === "currency" && lootItem.coins
        ? (() => {
            const kinds = positiveCoinKinds(lootItem.coins);
            return kinds.length === 1 ? { coinKind: kinds[0] } : {};
          })()
        : {}),
      rarity: lootItem.rarity || "none",
      folder: lootItem.folder || section,
      section,
      tags,
      description: lootItem.description,
      link: lootItem.link,
      document: lootItem.document,
      coins,
      profile: lootItem.profile,
    },
  };
}

/**
 * Convert a UserInventoryItem back to a scene LootItem.
 */
export function userInventoryItemToLootItem(invItem: UserInventoryItem): LootItem {
  const data = invItem.data || {};
  const isCurrency = data.kind === "currency";
  return {
    id: invItem.id || crypto.randomUUID(),
    kind: data.kind || "item",
    name: invItem.name || "Unnamed Item",
    // Loot bags store a purse as one item; the denomination count lives in
    // `coins`, rather than being interpreted as a quantity of purses.
    quantity: isCurrency ? 1 : Math.max(1, invItem.quantity || 1),
    rarity: (data.rarity as Rarity) || "none",
    icon: invItem.img || "⚔️",
    folder: invItem.section || data.folder || data.section,
    description: data.description,
    link: data.link,
    document: data.document,
    coins: isCurrency
      ? currencyPurseForInventoryItem(invItem)
      : data.coins,
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

  const explicitSection =
    typeof raw.section === "string" && raw.section.trim()
      ? raw.section.trim()
      : typeof data.section === "string" && data.section.trim()
      ? data.section.trim()
      : typeof data.folder === "string" && data.folder.trim()
      ? data.folder.trim()
      : undefined;

  const section = explicitSection || defaultInventorySectionForKind(data.kind);

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

  data.section = section;
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

  const configuredSections = Array.isArray(raw.sections)
    ? raw.sections
        .filter((s: any) => typeof s === "string" && s.trim().length > 0)
        .map((s: string) => s.trim())
    : [];
  const customSections = configuredSections.filter((section: string) => !LEGACY_DEFAULT_SECTIONS.has(section));
  const sections: string[] = Array.from(
    new Set([...DEFAULT_INVENTORY_SECTIONS, ...customSections]),
  );

  const rawItems = Array.isArray(raw.items) ? raw.items : [];
  const items: UserInventoryItem[] = [];

  for (const rawItem of rawItems) {
    const cleanItem = sanitizeInventoryItem(rawItem);
    if (cleanItem) {
      items.push(...expandCurrencyInventoryItem(cleanItem));
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
