import { type LootItem, type Rarity } from "./types";

/**
 * Import items from pasted 5e.tools links.
 *
 * The 5e.tools site is a client-rendered app behind a Cloudflare challenge,
 * so the page itself cannot be fetched. Its URL hash, however, is a stable
 * `name_source` identifier, and the site's own data files are mirrored on
 * GitHub with permissive CORS — so links are resolved against those instead.
 */
const DATA_BASE =
  "https://raw.githubusercontent.com/5etools-mirror-3/5etools-src/main/data/";

/** Imported descriptions are trimmed to keep token metadata small. */
const MAX_IMPORT_CHARS = 4000;
const TRUNCATION_NOTE = "… (full text on 5e.tools)";

// --- link parsing ------------------------------------------------------------

export interface ParsedItemLink {
  /** Item name from the hash, lowercase. */
  name: string;
  /** Source book abbreviation from the hash, lowercase (e.g. "xdmg"). */
  source: string;
  /** Canonical page link, stripped of list-state sub-hashes. */
  url: string;
}

export function parseItemLink(raw: string): ParsedItemLink | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (!/(^|\.)5e\.tools$/i.test(url.hostname)) return null;
  if (!/(^|\/)items\.html$/.test(url.pathname)) return null;
  // Literal commas in names are %2C-encoded; bare commas separate the item
  // id from list-state sub-hashes, so split before decoding.
  const id = decodeURIComponent(url.hash.replace(/^#/, "").split(",")[0]);
  const cut = id.lastIndexOf("_");
  if (cut <= 0) return null;
  const name = id.slice(0, cut).trim().toLowerCase();
  const source = id.slice(cut + 1).trim().toLowerCase();
  if (!name || !source) return null;
  return {
    name,
    source,
    url: `https://5e.tools/items.html#${encodeURIComponent(name)}_${encodeURIComponent(source)}`,
  };
}

/** Returns the href if it is a well-formed http(s) URL, else null. */
export function safeHttpUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

// --- data fetching -----------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
type FiveEItem = Record<string, any>;

const cache = new Map<string, Promise<any>>();

function fetchData(file: string): Promise<any> {
  let pending = cache.get(file);
  if (!pending) {
    pending = fetch(DATA_BASE + file).then((response) => {
      if (!response.ok) {
        throw new Error(`could not load ${file} (HTTP ${response.status})`);
      }
      return response.json();
    });
    // Keep only successful fetches so a network hiccup can be retried.
    pending.catch(() => cache.delete(file));
    cache.set(file, pending);
  }
  return pending;
}

// --- item lookup -------------------------------------------------------------

function matches(item: FiveEItem, name: string, source?: string): boolean {
  return (
    typeof item.name === "string" &&
    item.name.toLowerCase() === name &&
    (source === undefined || String(item.source).toLowerCase() === source)
  );
}

/**
 * Generic variants ("+1 Weapon") exist only as templates; 5e.tools builds
 * pages like "+1 longsword" by applying them to a base item. Mirror that:
 * match a prefix/suffix around a known base item name and merge the two.
 */
async function resolveVariant(
  name: string,
  source: string,
  baseItems: FiveEItem[],
): Promise<FiveEItem | null> {
  const data = await fetchData("magicvariants.json");
  const variants: FiveEItem[] = data.magicvariant ?? [];

  const attempt = (requireSource: boolean): FiveEItem | null => {
    for (const variant of variants) {
      const inherits = variant.inherits ?? {};
      if (
        requireSource &&
        String(inherits.source ?? variant.source).toLowerCase() !== source
      ) {
        continue;
      }
      const prefix = String(inherits.namePrefix ?? "").toLowerCase();
      const suffix = String(inherits.nameSuffix ?? "").toLowerCase();
      if (!prefix && !suffix) continue;
      if (!name.startsWith(prefix) || !name.endsWith(suffix)) continue;
      const baseName = name.slice(prefix.length, name.length - suffix.length);
      const candidates = baseItems.filter((b) => matches(b, baseName));
      const base =
        candidates.find((b) => b.edition === variant.edition) ?? candidates[0];
      if (!base || !variantApplies(variant, base)) continue;
      return mergeVariant(variant, base);
    }
    return null;
  };

  return attempt(true) ?? attempt(false);
}

function variantApplies(variant: FiveEItem, base: FiveEItem): boolean {
  const propMatches = (key: string, value: unknown): boolean =>
    key === "type"
      ? String(base.type ?? "").split("|")[0] === String(value).split("|")[0]
      : base[key] === value;
  const requires: Record<string, unknown>[] = variant.requires ?? [];
  if (
    requires.length > 0 &&
    !requires.some((req) =>
      Object.entries(req).every(([k, v]) => propMatches(k, v)),
    )
  ) {
    return false;
  }
  const excludes: Record<string, unknown> = variant.excludes ?? {};
  return Object.entries(excludes).every(([k, v]) => !propMatches(k, v));
}

function mergeVariant(variant: FiveEItem, base: FiveEItem): FiveEItem {
  const inherits = variant.inherits ?? {};
  const merged: FiveEItem = { ...base };
  for (const [key, value] of Object.entries(inherits)) {
    if (["namePrefix", "nameSuffix", "entries"].includes(key)) continue;
    merged[key] = value;
  }
  merged.name =
    (inherits.namePrefix ?? "") + base.name + (inherits.nameSuffix ?? "");
  // Variant text uses {=key} placeholders filled from the variant itself,
  // e.g. "You have a {=bonusWeapon} bonus…".
  const fill = (entry: unknown): unknown =>
    typeof entry === "string"
      ? entry.replace(/\{=([^}/|]+)[^}]*\}/g, (_m, key: string) =>
          String(inherits[key] ?? ""),
        )
      : entry;
  merged.entries = [
    ...(inherits.entries ?? []).map(fill),
    ...(base.entries ?? []),
  ];
  return merged;
}

// --- 5etools entry markup → plain text --------------------------------------

/** Tags whose display text sits in the 2nd pipe segment ({@dice 2d6|two d6}). */
const ROLL_TAGS = new Set([
  "dice",
  "damage",
  "hit",
  "d20",
  "dc",
  "chance",
  "scaledice",
  "scaledamage",
  "coinflip",
]);

/** Resolve {@tag body|…} markup to its display text, innermost first. */
function stripTags(text: string): string {
  let out = text;
  for (let pass = 0; pass < 10; pass++) {
    const next = out.replace(
      /\{@(\w+)(?: ([^{}]*))?\}/g,
      (_match, tag: string, body = "") => {
        const parts = body.split("|").map((p: string) => p.trim());
        if (ROLL_TAGS.has(tag)) return parts[1] || parts[0];
        // Most cross-reference tags are {@tag name|source|display}.
        return parts[2] || parts[0];
      },
    );
    if (next === out) break;
    out = next;
  }
  return out;
}

function cellToText(cell: unknown): string {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "string") return stripTags(cell);
  if (typeof cell === "number") return String(cell);
  const roll = (cell as FiveEItem).roll;
  if (roll) {
    return roll.exact !== undefined ? String(roll.exact) : `${roll.min}–${roll.max}`;
  }
  return entryToText(cell);
}

function tableToText(table: FiveEItem): string {
  const lines: string[] = [];
  if (table.caption) lines.push(stripTags(String(table.caption)));
  if (Array.isArray(table.colLabels)) {
    lines.push(table.colLabels.map((l: string) => stripTags(l)).join(" | "));
  }
  for (const row of table.rows ?? []) {
    const cells = Array.isArray(row) ? row : row?.row ?? [];
    lines.push(cells.map(cellToText).join(" | "));
  }
  return lines.join("\n");
}

function entryToText(entry: unknown): string {
  if (entry === null || entry === undefined) return "";
  if (typeof entry === "string") return stripTags(entry);
  if (typeof entry === "number") return String(entry);
  if (Array.isArray(entry)) {
    return entry.map(entryToText).filter(Boolean).join("\n\n");
  }
  const node = entry as FiveEItem;
  const children = () =>
    entryToText(node.entries ?? (node.entry !== undefined ? [node.entry] : []));
  switch (node.type) {
    case "list":
      return (node.items ?? [])
        .map((item: unknown) => `• ${entryToText(item)}`)
        .join("\n");
    case "table":
      return tableToText(node);
    case "quote":
      return `“${children()}”`;
    case "item":
    case "entries":
    case "section":
    case "inset":
    default: {
      const inner = children();
      const name = node.name ? stripTags(String(node.name)) : "";
      return name ? `${name}. ${inner}` : inner;
    }
  }
}

// --- LootItem conversion -----------------------------------------------------

const RARITY_MAP: Record<string, Rarity> = {
  common: "common",
  uncommon: "uncommon",
  rare: "rare",
  "very rare": "epic",
  legendary: "legendary",
  artifact: "legendary",
};

const TYPE_ICONS: Record<string, string> = {
  LA: "🛡️",
  MA: "🛡️",
  HA: "🛡️",
  S: "🛡️",
  M: "⚔️",
  R: "🏹",
  A: "🏹",
  AF: "🏹",
  P: "🧪",
  SC: "📜",
  RD: "🪄",
  WD: "🪄",
  ST: "🪄",
  RG: "💍",
  SCF: "🔮",
  G: "🎒",
  T: "🛠️",
  AT: "🛠️",
  INS: "🪕",
  GS: "🎲",
  FD: "🍖",
  TG: "💰",
  TB: "💰",
  $: "💰",
  $A: "💰",
  $C: "💰",
  $G: "💎",
  MNT: "🐴",
  TAH: "🐴",
  EXP: "💥",
  SHP: "⛵",
  AIR: "🎈",
};

const DAMAGE_TYPES: Record<string, string> = {
  A: "acid",
  B: "bludgeoning",
  C: "cold",
  F: "fire",
  O: "force",
  L: "lightning",
  N: "necrotic",
  P: "piercing",
  I: "poison",
  Y: "psychic",
  R: "radiant",
  S: "slashing",
  T: "thunder",
};

function typeCode(item: FiveEItem): string {
  return String(item.type ?? "").split("|")[0];
}

function guessIcon(item: FiveEItem): string {
  if (item.staff) return "🪄";
  return (
    TYPE_ICONS[typeCode(item)] ?? (RARITY_MAP[item.rarity ?? ""] ? "✨" : "🪙")
  );
}

function formatValue(cp: number): string {
  if (cp >= 100) return `${cp / 100} gp`;
  if (cp >= 10) return `${cp / 10} sp`;
  return `${cp} cp`;
}

function headerLine(item: FiveEItem, typeNames: Map<string, string>): string {
  const parts: string[] = [];
  const type = typeNames.get(typeCode(item));
  if (type) parts.push(type);
  else if (item.wondrous) parts.push("Wondrous item");
  const rarity = RARITY_MAP[item.rarity ?? ""];
  if (rarity) {
    parts.push(String(item.rarity).replace(/^\w/, (c) => c.toUpperCase()));
  }
  if (item.reqAttune === true) parts.push("Requires attunement");
  else if (typeof item.reqAttune === "string") {
    parts.push(`Requires attunement ${stripTags(item.reqAttune)}`);
  }
  return parts.join(" • ");
}

function statsLine(item: FiveEItem): string {
  const parts: string[] = [];
  if (item.ac) parts.push(`AC ${item.ac}`);
  if (item.dmg1) {
    const type = DAMAGE_TYPES[String(item.dmgType)] ?? "";
    parts.push(`${item.dmg1}${type ? ` ${type}` : ""}`.trim());
  }
  if (item.dmg2) parts.push(`versatile ${item.dmg2}`);
  if (item.range) parts.push(`range ${item.range} ft.`);
  if (typeof item.value === "number") parts.push(formatValue(item.value));
  if (typeof item.weight === "number") parts.push(`${item.weight} lb.`);
  return parts.join(" • ");
}

function toLootItem(
  item: FiveEItem,
  link: ParsedItemLink,
  typeNames: Map<string, string>,
): LootItem {
  const sections = [
    headerLine(item, typeNames),
    statsLine(item),
    entryToText(item.entries ?? []),
  ].filter(Boolean);
  let description = sections.join("\n\n");
  if (description.length > MAX_IMPORT_CHARS) {
    description =
      description.slice(0, MAX_IMPORT_CHARS - TRUNCATION_NOTE.length) +
      TRUNCATION_NOTE;
  }
  return {
    id: crypto.randomUUID(),
    kind: "item",
    name: String(item.name),
    quantity: 1,
    // Mundane gear ("none", "varies", …) gets no rarity highlight.
    rarity: RARITY_MAP[item.rarity ?? ""] ?? "none",
    icon: guessIcon(item),
    description: description || undefined,
    link: link.url,
  };
}

// --- public entry point ------------------------------------------------------

export async function fetchLootItem(link: ParsedItemLink): Promise<LootItem> {
  const [items, base] = await Promise.all([
    fetchData("items.json"),
    fetchData("items-base.json"),
  ]);
  const baseItems: FiveEItem[] = base.baseitem ?? [];
  const pools: FiveEItem[][] = [
    items.item ?? [],
    items.itemGroup ?? [],
    baseItems,
  ];

  let found: FiveEItem | undefined;
  for (const pool of pools) {
    found = pool.find((i) => matches(i, link.name, link.source));
    if (found) break;
  }
  if (!found) {
    found = (await resolveVariant(link.name, link.source, baseItems)) ?? undefined;
  }
  if (!found) {
    // Source didn't line up (renamed book abbreviations etc.) — take any
    // printing with the right name rather than failing outright.
    for (const pool of pools) {
      found = pool.find((i) => matches(i, link.name));
      if (found) break;
    }
  }
  if (!found) {
    throw new Error(`"${link.name}" was not found in the 5e.tools item data.`);
  }

  const typeNames = new Map<string, string>();
  for (const t of base.itemType ?? []) {
    if (t.abbreviation && t.name && !typeNames.has(t.abbreviation)) {
      typeNames.set(t.abbreviation, t.name);
    }
  }
  return toLootItem(found, link, typeNames);
}
