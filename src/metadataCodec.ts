import { deflateSync, inflateSync, strFromU8, strToU8 } from "fflate";
import { isLootContainer, type LootContainer, type LootItem } from "./types";

/*
 * Compact storage format for Owlbear metadata. Metadata is shared room
 * state with limited space, so values are written as:
 *
 *   "z1" + Z85(deflate(JSON))   when that is smaller, else
 *   the plain JSON value
 *
 * Readers accept both, plus anything written before this format existed.
 * Loot is additionally stripped of empty fields and defaults first.
 */

const PREFIX = "z1";

/*
 * Z85 (ZeroMQ base-85): 5 characters per 4 bytes (+25%) against base64's
 * 4 per 3 (+33%), and none of its characters need escaping in JSON. The
 * first character records how many zero bytes padded the last group.
 */
const Z85 =
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-:+=^!/*?&<>()[]{}@%$#";
const Z85_INDEX = new Map([...Z85].map((char, index) => [char, index]));

function toZ85(bytes: Uint8Array): string {
  const pad = (4 - (bytes.length % 4)) % 4;
  const padded = new Uint8Array(bytes.length + pad);
  padded.set(bytes);
  let out = String(pad);
  for (let i = 0; i < padded.length; i += 4) {
    let value =
      ((padded[i] << 24) | (padded[i + 1] << 16) | (padded[i + 2] << 8) | padded[i + 3]) >>> 0;
    let group = "";
    for (let j = 0; j < 5; j++) {
      group = Z85[value % 85] + group;
      value = Math.floor(value / 85);
    }
    out += group;
  }
  return out;
}

function fromZ85(text: string): Uint8Array {
  const pad = Number(text[0]);
  const body = text.slice(1);
  if (!(pad >= 0 && pad <= 3) || body.length % 5 !== 0) throw new Error("bad Z85");
  const bytes = new Uint8Array((body.length / 5) * 4);
  for (let i = 0, o = 0; i < body.length; i += 5, o += 4) {
    let value = 0;
    for (let j = 0; j < 5; j++) {
      const digit = Z85_INDEX.get(body[i + j]);
      if (digit === undefined) throw new Error("bad Z85");
      value = value * 85 + digit;
    }
    bytes[o] = value >>> 24;
    bytes[o + 1] = (value >>> 16) & 0xff;
    bytes[o + 2] = (value >>> 8) & 0xff;
    bytes[o + 3] = value & 0xff;
  }
  return bytes.subarray(0, bytes.length - pad);
}

/** Smallest stored form of a JSON value. */
export function packValue(value: unknown): unknown {
  const json = JSON.stringify(value);
  const packed = PREFIX + toZ85(deflateSync(strToU8(json), { level: 9 }));
  // Compare as stored: the packed string gains two quotes in JSON.
  return packed.length + 2 < strToU8(json).length ? packed : value;
}

const cache = new Map<string, unknown>();
const CACHE_LIMIT = 200;

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/**
 * Reverses packValue. Decoded values are cached and frozen — like the
 * metadata objects the SDK hands out, callers must clone before editing.
 */
export function unpackValue(raw: unknown): unknown {
  if (typeof raw !== "string" || !raw.startsWith(PREFIX)) return raw;
  const hit = cache.get(raw);
  if (hit !== undefined) return hit;
  let value: unknown;
  try {
    value = JSON.parse(strFromU8(inflateSync(fromZ85(raw.slice(PREFIX.length)))));
  } catch {
    return undefined;
  }
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(raw, deepFreeze(value));
  return value;
}

// --- loot -------------------------------------------------------------------------

/** Drops undefined, null, "", [] and {} recursively. */
function prune(value: unknown): unknown {
  if (Array.isArray(value)) {
    const list = value.map(prune).filter((entry) => entry !== undefined);
    return list.length > 0 ? list : undefined;
  }
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      const kept = prune(child);
      if (kept !== undefined) out[key] = kept;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }
  return value === null || value === "" ? undefined : value;
}

const ITEM_DEFAULTS = { kind: "item", quantity: 1, rarity: "none" } as const;

function minifyItem(item: LootItem): unknown {
  const out: Record<string, unknown> = { ...item };
  for (const [key, fallback] of Object.entries(ITEM_DEFAULTS)) {
    if (out[key] === fallback) delete out[key];
  }
  return prune(out) ?? {};
}

function expandItem(raw: Record<string, unknown>): LootItem {
  const item = { ...ITEM_DEFAULTS, name: "", icon: "", ...raw } as LootItem;
  if (item.document) item.document = Object.assign({ title: "", content: "" }, item.document);
  if (item.kind === "currency") item.coins ??= {};
  if (item.kind === "idcard") item.profile ??= {};
  return item;
}

/** Stored form of a loot container. */
export function packLoot(loot: LootContainer): unknown {
  const { items, enabled, ...rest } = loot;
  const minified = {
    ...(prune(rest) as object),
    ...(enabled ? { enabled } : {}),
    items: items.map(minifyItem),
  };
  return packValue(minified);
}

const expandedStrings = new Map<string, LootContainer>();
const expandedObjects = new WeakMap<object, LootContainer>();

function expandLoot(value: LootContainer): LootContainer {
  const defaults = { enabled: false, name: "", folders: [] as string[], updatedAt: 0 };
  return deepFreeze({
    ...defaults,
    ...value,
    items: value.items.map((item) => expandItem(item as unknown as Record<string, unknown>)),
  });
}

/**
 * Reads a container in any stored form (packed, minified or legacy).
 * Returns a fresh, editable copy each call; decoding itself is cached.
 */
export function unpackLoot(raw: unknown): LootContainer | undefined {
  const loot = decodeLoot(raw);
  return loot && structuredClone(loot);
}

function decodeLoot(raw: unknown): LootContainer | undefined {
  if (typeof raw === "object" && raw !== null) {
    const hit = expandedObjects.get(raw);
    if (hit) return hit;
  } else if (typeof raw === "string") {
    const hit = expandedStrings.get(raw);
    if (hit) return hit;
  }
  const value = unpackValue(raw);
  if (!isLootContainer(value)) return undefined;
  const loot = expandLoot(value);
  if (typeof raw === "string") {
    if (expandedStrings.size >= CACHE_LIMIT) expandedStrings.delete(expandedStrings.keys().next().value!);
    expandedStrings.set(raw, loot);
  } else {
    expandedObjects.set(raw as object, loot);
  }
  return loot;
}
