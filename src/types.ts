export type Rarity =
  | "none"
  | "poor"
  | "common"
  | "uncommon"
  | "rare"
  | "epic"
  | "legendary";

export type DocumentStyle =
  | "letter"
  | "scroll"
  | "book"
  | "journal"
  | "newspaper";

export type DocLayout = "flow" | "pages";

export type NewspaperPreset =
  | "hero"
  | "split-lead"
  | "column-inset"
  | "gazette-mosaic";

/** The two retired names remain readable in existing saved documents. */
export type NewspaperLayout = "auto" | NewspaperPreset | "broadsheet-3col" | "editorial-dual";

export function normalizeNewspaperLayout(layout?: NewspaperLayout): "auto" | NewspaperPreset {
  if (layout === "editorial-dual") return "split-lead";
  if (layout === "broadsheet-3col") return "gazette-mosaic";
  return layout ?? "auto";
}

export type NewspaperPrintFilter =
  | "halftone"
  | "engraving"
  | "sepia"
  | "color-press"
  | "raw";

export type NewspaperHeaderStyle =
  | "tabloid-splash"
  | "classic-masthead"
  | "modern-broadsheet"
  | "banner-screamer"
  | "minimal-chic";

export interface NewspaperImage {
  url: string;
  caption?: string;
  filter?: NewspaperPrintFilter;
  /** Undefined follows the saved layout; explicit widths override its picture slots. */
  width?: "column" | "page";
}

export type PaperTexture =
  | "aged"
  | "fancy"
  | "old"
  | "crumpled"
  | "rough"
  | "wet"
  | "stained"
  | "blood"
  | "burnt";

export type DocFont =
  | "caveat"
  | "shadows-into-light"
  | "homemade-apple"
  | "dancing-script"
  | "great-vibes"
  | "im-fell-english"
  | "medievalsharp"
  | "uncial-antiqua"
  | "pirata-one";

export interface LootDocument {
  style: DocumentStyle;
  /** Heading written on the paper itself; empty renders no heading. */
  title: string;
  content: string;
  /** Typeface for title and body; defaults per style for older documents. */
  font?: DocFont;
  /** Paper condition overlay; defaults to "aged" for older documents. */
  texture?: PaperTexture;
  /**
   * "pages" renders fixed pages you flip through (a line of `---` in the
   * content forces a break); "flow" is one continuous sheet. Defaults per
   * style: books and journals paginate, letters and scrolls flow.
   */
  layout?: DocLayout;
  /** Preset column & image slot layout for newspaper style. */
  newspaperLayout?: NewspaperLayout;
  /** Issue, dateline, or price line (e.g. "Vol. IV • Midsummer • 2 cp"). */
  newspaperIssue?: string;
  /** Main front-page story headline; separate from the publication name. */
  newspaperHeadline?: string;
  /** Supporting sentence printed below the front-page story headline. */
  newspaperDeck?: string;
  /** Legacy combined headline/deck field, retained for saved documents. */
  newspaperSubtitle?: string;
  /** Print ink filter applied to pictures in newspaper style. */
  newspaperFilter?: NewspaperPrintFilter;
  /** Front-page header presentation style (e.g. modern tabloid splash, classic masthead). */
  newspaperHeader?: NewspaperHeaderStyle;
  /** Images to slot into picture positions in the newspaper layout. */
  images?: NewspaperImage[];
}

/**
 * Profile written on an ID card. Every field is optional — the card only
 * shows what the DM filled in, so it fits western (guild papers) and
 * eastern (sect registries) settings alike.
 */
export interface IdProfile {
  /** Emoji likeness drawn in the portrait frame. */
  portrait?: string;
  /** Image URL for the portrait frame; when set it replaces the emoji. */
  portraitUrl?: string;
  name?: string;
  occupation?: string;
  rank?: string;
  affiliation?: string;
  ancestry?: string;
  sex?: string;
  age?: string;
  maritalStatus?: string;
  hometown?: string;
  /** Issuing authority; rendered as the card's letterhead. */
  issuedBy?: string;
  /** Clerk's remarks (distinguishing marks, warnings, stamps of renewal…). */
  notes?: string;
}

/** Profile fields rendered as label/value rows, in display order. */
export const ID_ROW_FIELDS: readonly {
  key:
    | "occupation"
    | "rank"
    | "affiliation"
    | "ancestry"
    | "sex"
    | "age"
    | "maritalStatus"
    | "hometown";
  label: string;
  hint: string;
}[] = [
  { key: "occupation", label: "Occupation", hint: "Caravan guard, court alchemist…" },
  { key: "rank", label: "Rank", hint: "Journeyman, outer disciple, captain…" },
  { key: "affiliation", label: "Affiliation", hint: "Guild, sect, order, noble house…" },
  { key: "ancestry", label: "Ancestry", hint: "Human, half-elf, mountain dwarf…" },
  { key: "sex", label: "Sex", hint: "Male, female…" },
  { key: "age", label: "Age", hint: "34 — or “looks about fifty”" },
  { key: "maritalStatus", label: "Marital status", hint: "Unwed, married, widowed…" },
  { key: "hometown", label: "Hometown", hint: "Village, city or province" },
];

/** D&D coin denominations, most to least valuable. */
export type CoinKind = "pp" | "gp" | "ep" | "sp" | "cp";

/** Explicit coin counts per denomination; absent means zero. */
export type CoinPurse = Partial<Record<CoinKind, number>>;

export interface LootItem {
  id: string;
  kind: "item" | "document" | "currency" | "idcard";
  name: string;
  quantity: number;
  rarity: Rarity;
  /** Emoji used as the slot icon. */
  icon: string;
  /** Folder name for grouping (e.g. "Official letters"); empty = ungrouped. */
  folder?: string;
  description?: string;
  /** Reference link shown to players (e.g. the 5e.tools page). */
  link?: string;
  document?: LootDocument;
  coins?: CoinPurse;
  profile?: IdProfile;
}

export interface LootGroup {
  /** Undefined for the ungrouped items shown before any folder. */
  folder?: string;
  items: LootItem[];
}

/**
 * Group items by folder, preserving item order. Ungrouped items come first,
 * then declared folders in order, then stray folder names still present on
 * items (older saves). Empty folders are only emitted with `includeEmpty`
 * (the editor shows them as drop targets; players never see them).
 */
export function groupLootItems(
  items: LootItem[],
  folders: string[] = [],
  includeEmpty = false,
): LootGroup[] {
  const root: LootItem[] = [];
  const byFolder = new Map<string, LootItem[]>();
  for (const name of folders) byFolder.set(name, []);
  for (const item of items) {
    const folder = item.folder?.trim();
    if (!folder) {
      root.push(item);
      continue;
    }
    const list = byFolder.get(folder) ?? [];
    list.push(item);
    byFolder.set(folder, list);
  }
  const groups: LootGroup[] = [];
  if (root.length > 0) groups.push({ items: root });
  for (const [folder, list] of byFolder) {
    if (list.length === 0 && !includeEmpty) continue;
    groups.push({ folder, items: list });
  }
  return groups;
}

export interface LootContainer {
  /** When true the token shows a badge and players can open the loot. */
  enabled: boolean;
  name: string;
  items: LootItem[];
  /** Ordered folder names; folders can exist empty (drop targets). */
  folders?: string[];
  updatedAt: number;
}

export const RARITIES: readonly Rarity[] = [
  "none",
  "poor",
  "common",
  "uncommon",
  "rare",
  "epic",
  "legendary",
];

export const RARITY_META: Record<Rarity, { label: string; color: string }> = {
  // Matches the plain panel border, so "none" slots show no rarity glow.
  none: { label: "None", color: "#6d5426" },
  poor: { label: "Poor", color: "#9d9d9d" },
  common: { label: "Common", color: "#eeeeee" },
  uncommon: { label: "Uncommon", color: "#1eff00" },
  rare: { label: "Rare", color: "#0091ff" },
  epic: { label: "Epic", color: "#b048f8" },
  legendary: { label: "Legendary", color: "#ff8000" },
};

export const COIN_KINDS: readonly CoinKind[] = ["pp", "gp", "ep", "sp", "cp"];

/**
 * D&D 5e exchange rates, expressed in copper pieces:
 * 1 pp = 10 gp, 1 gp = 10 sp, 1 ep = 5 sp, 1 sp = 10 cp.
 */
export const COIN_META: Record<
  CoinKind,
  { name: string; copper: number; color: string }
> = {
  pp: { name: "Platinum", copper: 1000, color: "#cfdde6" },
  gp: { name: "Gold", copper: 100, color: "#e8c15a" },
  ep: { name: "Electrum", copper: 50, color: "#c9c08a" },
  sp: { name: "Silver", copper: 10, color: "#c3c9d1" },
  cp: { name: "Copper", copper: 1, color: "#cd8a54" },
};

/** Total purse value in copper pieces (the integer base unit). */
export function coinsToCopper(coins: CoinPurse): number {
  return COIN_KINDS.reduce(
    (sum, kind) => sum + (coins[kind] ?? 0) * COIN_META[kind].copper,
    0,
  );
}

/** "3 pp, 12 gp, 5 cp" — skips empty denominations. */
export function formatCoins(coins: CoinPurse): string {
  const parts = COIN_KINDS.filter((kind) => (coins[kind] ?? 0) > 0).map(
    (kind) => `${(coins[kind] ?? 0).toLocaleString()} ${kind}`,
  );
  return parts.length > 0 ? parts.join(", ") : "empty";
}

/**
 * Value of `copper` expressed in `target` coins, e.g. 1250 cp → "12.5 gp".
 * Every rate divides cleanly within 3 decimals (1 cp = 0.001 pp).
 */
export function formatCoinValue(copper: number, target: CoinKind): string {
  const value = copper / COIN_META[target].copper;
  const text = value.toLocaleString(undefined, { maximumFractionDigits: 3 });
  return `${text} ${target}`;
}

export const DOC_STYLES: readonly DocumentStyle[] = [
  "letter",
  "scroll",
  "book",
  "journal",
  "newspaper",
];

export const DOC_STYLE_META: Record<
  DocumentStyle,
  { label: string; icon: string }
> = {
  letter: { label: "Letter", icon: "✉️" },
  scroll: { label: "Scroll", icon: "📜" },
  book: { label: "Book", icon: "📕" },
  journal: { label: "Journal", icon: "📖" },
  newspaper: { label: "Newspaper", icon: "📰" },
};

export const DOC_LAYOUTS: readonly DocLayout[] = ["flow", "pages"];

export const DOC_LAYOUT_META: Record<DocLayout, { label: string }> = {
  flow: { label: "Continuous" },
  pages: { label: "Paged" },
};

export const NEWSPAPER_LAYOUTS: readonly NewspaperLayout[] = [
  "auto",
  "hero",
  "column-inset",
  "gazette-mosaic",
];

export const NEWSPAPER_LAYOUT_META: Record<
  NewspaperLayout,
  { label: string; description: string }
> = {
  auto: {
    label: "Classic / Smart Fit",
    description: "Steady two-column reading, with pictures sized to fit. No layout changes between pages.",
  },
  hero: {
    label: "Front Page",
    description: "A prominent illustrated opening and a wide introduction above the columned report.",
  },
  "split-lead": {
    label: "Classic",
    description: "Two tall columns with pictures woven into the story. Compact, familiar newsprint.",
  },
  "column-inset": {
    label: "Feature",
    description: "One broad reading column, larger type and spacious illustrations for a long-form feature.",
  },
  "broadsheet-3col": {
    label: "Gazette Digest",
    description: "Former broadsheet preset, now the Gazette Digest composition.",
  },
  "editorial-dual": {
    label: "Classic",
    description: "Former editorial preset, now the Classic composition.",
  },
  "gazette-mosaic": {
    label: "Gazette Digest",
    description: "Two stacked bands of short columns, separated by a strong horizontal rule. Read across, then down.",
  },
};

export const NEWSPAPER_PRINT_FILTERS: readonly NewspaperPrintFilter[] = [
  "halftone",
  "engraving",
  "sepia",
  "color-press",
  "raw",
];

export const NEWSPAPER_PRINT_FILTER_META: Record<
  NewspaperPrintFilter,
  { label: string; description: string }
> = {
  halftone: {
    label: "Newsprint Halftone (Recommended)",
    description: "Authentic 45° halftone dot screen with paper ink absorption",
  },
  engraving: {
    label: "Woodcut / Engraving",
    description: "High-contrast line hatching etching style",
  },
  sepia: {
    label: "Sepia Press Photo",
    description: "Warm archival daguerreotype duotone with aged press softness",
  },
  "color-press": {
    label: "Color Lithograph",
    description: "Full-color inks blended directly into the newsprint paper",
  },
  raw: {
    label: "Original Image",
    description: "Standard digital photo without print filtering",
  },
};

export const NEWSPAPER_HEADER_STYLES: readonly NewspaperHeaderStyle[] = [
  "tabloid-splash",
  "classic-masthead",
  "modern-broadsheet",
  "banner-screamer",
  "minimal-chic",
];

export const NEWSPAPER_HEADER_META: Record<
  NewspaperHeaderStyle,
  { label: string; description: string }
> = {
  "tabloid-splash": {
    label: "Tabloid",
    description: "Compact newspaper name above a bold, centered, all-caps story headline.",
  },
  "classic-masthead": {
    label: "Traditional Gazette",
    description: "Centered serif newspaper name, double rules, and a title-case story headline.",
  },
  "modern-broadsheet": {
    label: "Daily Broadsheet",
    description: "Spaced publication lettering above a strong, left-aligned serif headline.",
  },
  "banner-screamer": {
    label: "Extra Edition",
    description: "An all-caps banner headline between heavy ink rules, with a small newspaper name.",
  },
  "minimal-chic": {
    label: "Literary Review",
    description: "A restrained nameplate and an italic, left-aligned feature headline with fine rules.",
  },
};

/** Bound papers and multi-column newspapers flip pages; loose sheets scroll. */
export function defaultLayout(style: DocumentStyle): DocLayout {
  return style === "book" || style === "journal" || style === "newspaper"
    ? "pages"
    : "flow";
}

export const PAPER_TEXTURES: readonly PaperTexture[] = [
  "aged",
  "fancy",
  "old",
  "crumpled",
  "rough",
  "wet",
  "stained",
  "blood",
  "burnt",
];

export const PAPER_TEXTURE_META: Record<PaperTexture, { label: string }> = {
  aged: { label: "Aged" },
  fancy: { label: "Fancy" },
  old: { label: "Old & yellowed" },
  crumpled: { label: "Crumpled" },
  rough: { label: "Rough" },
  wet: { label: "Water-damaged" },
  stained: { label: "Stained" },
  blood: { label: "Bloodstained" },
  burnt: { label: "Burnt" },
};

export const DOC_FONTS: readonly DocFont[] = [
  "caveat",
  "shadows-into-light",
  "homemade-apple",
  "dancing-script",
  "great-vibes",
  "im-fell-english",
  "medievalsharp",
  "uncial-antiqua",
  "pirata-one",
];

/**
 * `adjust` normalizes optical size — script faces have tiny x-heights and
 * need to render larger than print faces for the same readability.
 */
export const DOC_FONT_META: Record<
  DocFont,
  { label: string; family: string; adjust: number }
> = {
  caveat: { label: "Quick hand", family: '"Caveat", cursive', adjust: 1.5 },
  "shadows-into-light": {
    label: "Neat handwriting",
    family: '"Shadows Into Light", cursive',
    adjust: 1.3,
  },
  "homemade-apple": {
    label: "Messy quill",
    family: '"Homemade Apple", cursive',
    adjust: 1.1,
  },
  "dancing-script": {
    label: "Flowing cursive",
    family: '"Dancing Script", cursive',
    adjust: 1.4,
  },
  "great-vibes": {
    label: "Elegant calligraphy",
    family: '"Great Vibes", cursive',
    adjust: 1.5,
  },
  "im-fell-english": {
    label: "Old print",
    family: '"IM Fell English", serif',
    adjust: 1.05,
  },
  medievalsharp: {
    label: "Medieval",
    family: '"MedievalSharp", fantasy',
    adjust: 1.1,
  },
  "uncial-antiqua": {
    label: "Ancient uncial",
    family: '"Uncial Antiqua", fantasy',
    adjust: 1.0,
  },
  "pirata-one": {
    label: "Blackletter",
    family: '"Pirata One", fantasy',
    adjust: 1.15,
  },
};

export const STYLE_DEFAULT_FONT: Record<DocumentStyle, DocFont> = {
  letter: "caveat",
  journal: "caveat",
  scroll: "im-fell-english",
  book: "im-fell-english",
  newspaper: "im-fell-english",
};

export function isLootContainer(value: unknown): value is LootContainer {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as LootContainer).items)
  );
}

export function createContainer(name: string): LootContainer {
  return { enabled: false, name, items: [], folders: [], updatedAt: Date.now() };
}

export function createLootItem(): LootItem {
  return {
    id: crypto.randomUUID(),
    kind: "item",
    name: "New item",
    quantity: 1,
    rarity: "none",
    icon: "⚔️",
  };
}

export function createCurrencyItem(): LootItem {
  return {
    id: crypto.randomUUID(),
    kind: "currency",
    name: "Coins",
    quantity: 1,
    rarity: "none",
    icon: "🪙",
    coins: {},
  };
}

export function createIdCardItem(): LootItem {
  return {
    id: crypto.randomUUID(),
    kind: "idcard",
    name: "Identification papers",
    quantity: 1,
    rarity: "none",
    icon: "🪪",
    profile: {},
  };
}

export function createLootDocument(style: DocumentStyle = "letter"): LootItem {
  const isNewspaper = style === "newspaper";
  return {
    id: crypto.randomUUID(),
    kind: "document",
    name: isNewspaper ? "Newspaper edition" : "Crumpled letter",
    quantity: 1,
    rarity: "none",
    icon: DOC_STYLE_META[style].icon,
    document: {
      style,
      title: "",
      content: "",
      font: STYLE_DEFAULT_FONT[style],
      newspaperLayout: isNewspaper ? "auto" : undefined,
      newspaperHeader: isNewspaper ? "tabloid-splash" : undefined,
      newspaperIssue: undefined,
      newspaperSubtitle: undefined,
      newspaperFilter: isNewspaper ? "halftone" : undefined,
      images: isNewspaper ? [] : undefined,
    },
  };
}
