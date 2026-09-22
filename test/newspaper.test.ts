// Mock browser globals for Node testing
(globalThis as any).window = {
  location: { search: "", origin: "http://localhost:5173" },
  localStorage: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
};
// Deliberately no fake DOM or fake geometry: rendering is tested in Chromium.

import test from "node:test";
import assert from "node:assert/strict";

import {
  defaultLayout,
  DOC_STYLES,
  DOC_STYLE_META,
  STYLE_DEFAULT_FONT,
  NEWSPAPER_LAYOUTS,
  NEWSPAPER_LAYOUT_META,
  NEWSPAPER_PRINT_FILTERS,
  NEWSPAPER_PRINT_FILTER_META,
  NEWSPAPER_HEADER_STYLES,
  NEWSPAPER_HEADER_META,
  createLootDocument,
  type LootDocument,
  type NewspaperPrintFilter,
  type NewspaperHeaderStyle,
} from "../src/types";

import {
  resolveNewspaperLayout,
  parseNewspaperPages,
} from "../src/newspaperRender";

test("Newspaper theme: types and metadata registration", () => {
  assert.ok(DOC_STYLES.includes("newspaper"), "newspaper style should be in DOC_STYLES");
  assert.equal(DOC_STYLE_META.newspaper.label, "Newspaper");
  assert.equal(DOC_STYLE_META.newspaper.icon, "📰");
  assert.equal(STYLE_DEFAULT_FONT.newspaper, "im-fell-english");
  assert.equal(defaultLayout("newspaper"), "pages");

  assert.deepEqual(NEWSPAPER_LAYOUTS, ["auto", "hero", "column-inset", "gazette-mosaic"]);

  for (const layout of NEWSPAPER_LAYOUTS) {
    assert.ok(NEWSPAPER_LAYOUT_META[layout], `Meta exists for layout ${layout}`);
    assert.ok(NEWSPAPER_LAYOUT_META[layout].label.length > 0);
  }
});

test("Newspaper theme: createLootDocument initializes newspaper properties", () => {
  const item = createLootDocument("newspaper");
  assert.equal(item.kind, "document");
  assert.equal(item.name, "Newspaper edition");
  assert.equal(item.icon, "📰");
  assert.ok(item.document);
  assert.equal(item.document.style, "newspaper");
  assert.equal(item.document.title, "");
  assert.equal(item.document.font, "im-fell-english");
  assert.equal(item.document.newspaperLayout, "auto");
  assert.equal(item.document.newspaperIssue, undefined);
  assert.equal(item.document.newspaperSubtitle, undefined);
  assert.deepEqual(item.document.images, []);
});

test("Layout resolution: respects the four distinct compositions", () => {
  for (const layout of ["split-lead", "hero", "column-inset", "gazette-mosaic"] as const) {
    assert.equal(resolveNewspaperLayout(layout), layout);
  }
});

test("Smart Fit is stable and always uses two columns", () => {
  assert.equal(resolveNewspaperLayout("auto"), "split-lead");
  assert.equal(resolveNewspaperLayout(undefined), "split-lead");
});

test("Saved retired presets resolve to their supported successors", () => {
  assert.equal(resolveNewspaperLayout("editorial-dual"), "split-lead");
  assert.equal(resolveNewspaperLayout("broadsheet-3col"), "gazette-mosaic");
});

test("Content parsing: extracts headlines, subheads, pull-quotes and notes", () => {
  const doc: LootDocument = {
    style: "newspaper",
    title: "The Waterdeep Gazette",
    content: `# MIDNIGHT HEIST AT THE VAULT
## City Watch suspects Shadow Thieves involvement

Early this morning, bells rang across the Trades Ward as guards discovered the Vault of the Golden Hand breached.

> "We will leave no cobble unturned," proclaimed Captain Harbrek.

*Editor's Note: Citizens are urged to check their coin pouches for marked electrum.*

Further reports suggest high-level illusion magic was employed.`,
  };

  const pages = parseNewspaperPages(doc);
  assert.equal(pages.length, 1);
  const p = pages[0];
  assert.equal(p.headline, "MIDNIGHT HEIST AT THE VAULT");
  assert.equal(p.subhead, "City Watch suspects Shadow Thieves involvement");
  assert.equal(p.quotes.length, 1);
  assert.equal(p.quotes[0], '"We will leave no cobble unturned," proclaimed Captain Harbrek.');
  assert.equal(p.notes.length, 1);
  assert.equal(p.notes[0], "Editor's Note: Citizens are urged to check their coin pouches for marked electrum.");
  assert.equal(p.paragraphs.length, 2);
  assert.ok(p.paragraphs[0].includes("Early this morning"));
  assert.ok(p.paragraphs[1].includes("Further reports suggest"));
});

test("Content parsing: extracts markdown images and distributes across pages", () => {
  const doc: LootDocument = {
    style: "newspaper",
    title: "The Sword Coast Inquirer",
    content: `# BEAST SPOTTED NEAR PHANDALIN
![A shadow over the crags](https://example.com/dragon.jpg)
Villagers report sightings of a massive winged serpent.

---

# TOWN COUNCIL DECLARES BOUNTY
![The Townmaster speaking](https://example.com/council.jpg)
Harbin Wester has authorized a reward for brave adventurers.`,
  };

  const pages = parseNewspaperPages(doc);
  assert.equal(pages.length, 2, "Should parse 2 pages separated by ---");

  // Page 1
  assert.equal(pages[0].images.length, 1);
  assert.equal(pages[0].images[0].url, "https://example.com/dragon.jpg");
  assert.equal(pages[0].images[0].caption, "A shadow over the crags");
  // Raw markdown image should be removed from paragraph text
  assert.ok(!pages[0].paragraphs.some((text) => text.includes("![A shadow")));

  // Page 2
  assert.equal(pages[1].images.length, 1);
  assert.equal(pages[1].images[0].url, "https://example.com/council.jpg");
  assert.equal(pages[1].images[0].caption, "The Townmaster speaking");
  assert.ok(!pages[1].paragraphs.some((text) => text.includes("![The Townmaster")));
});

test("Content parsing: distributes explicit doc.images to pages that need them", () => {
  const doc: LootDocument = {
    style: "newspaper",
    title: "The Daily Inquirer",
    images: [
      { url: "https://example.com/photo1.jpg", caption: "Photo One" },
      { url: "https://example.com/photo2.jpg", caption: "Photo Two" },
    ],
    content: `Page one story text.

---

Page two story text.`,
  };

  const pages = parseNewspaperPages(doc);
  assert.equal(pages.length, 2);
  assert.equal(pages[0].images.length, 1);
  assert.equal(pages[0].images[0].url, "https://example.com/photo1.jpg");
  assert.equal(pages[1].images.length, 1);
  assert.equal(pages[1].images[0].url, "https://example.com/photo2.jpg");
});

test("Content parsing: handles empty or minimal content gracefully", () => {
  const doc: LootDocument = {
    style: "newspaper",
    title: "",
    content: "",
  };

  const pages = parseNewspaperPages(doc);
  assert.equal(pages.length, 1);
  assert.ok(pages[0].paragraphs.length > 0);
  assert.equal(pages[0].images.length, 0);
});

test("Newspaper print filter: types, metadata, and default document initialization", () => {
  assert.ok(NEWSPAPER_PRINT_FILTERS.includes("halftone"));
  assert.ok(NEWSPAPER_PRINT_FILTERS.includes("engraving"));
  assert.ok(NEWSPAPER_PRINT_FILTERS.includes("sepia"));
  assert.ok(NEWSPAPER_PRINT_FILTERS.includes("color-press"));
  assert.ok(NEWSPAPER_PRINT_FILTERS.includes("raw"));

  for (const filter of NEWSPAPER_PRINT_FILTERS) {
    assert.ok(NEWSPAPER_PRINT_FILTER_META[filter], `Metadata exists for filter ${filter}`);
    assert.ok(NEWSPAPER_PRINT_FILTER_META[filter].label.length > 0);
    assert.ok(NEWSPAPER_PRINT_FILTER_META[filter].description.length > 0);
  }

  const docItem = createLootDocument("newspaper");
  assert.equal(docItem.document?.newspaperFilter, "halftone", "Default print filter should be halftone");
});

test("Newspaper print filter: parses inline markdown image filter syntax", () => {
  const doc: LootDocument = {
    style: "newspaper",
    title: "Illustrated Gazette",
    content: `# PRINT SPECIMENS
![Archmage portrait|engraving](https://example.com/archmage.jpg)
An ancient woodcut illustration of the Archmage.

![City market scene|sepia](https://example.com/market.jpg)
A daguerreotype of the southern bazaar.

![Guild crest|color-press](https://example.com/crest.png)
Colored heraldic crest printed into the parchment.

![Original sketch|raw](https://example.com/sketch.png)
Raw digital image without filter.

![Standard photo](https://example.com/photo.png)
Standard photo using default newspaper filter.`,
  };

  const pages = parseNewspaperPages(doc);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].images.length, 5);

  assert.equal(pages[0].images[0].caption, "Archmage portrait");
  assert.equal(pages[0].images[0].filter, "engraving");

  assert.equal(pages[0].images[1].caption, "City market scene");
  assert.equal(pages[0].images[1].filter, "sepia");

  assert.equal(pages[0].images[2].caption, "Guild crest");
  assert.equal(pages[0].images[2].filter, "color-press");

  assert.equal(pages[0].images[3].caption, "Original sketch");
  assert.equal(pages[0].images[3].filter, "raw");

  assert.equal(pages[0].images[4].caption, "Standard photo");
  assert.equal(pages[0].images[4].filter, undefined);
});

test("Newspaper tropes: parses pull-quotes with authors, banner quotes, highlights, and crossheads into flow blocks", () => {
  const doc: LootDocument = {
    style: "newspaper",
    title: "The Waterdeep Gazette",
    content: `# MIDNIGHT ASSAULT ON BLACKSTAFF TOWER
## Archmage Vajra Safahr Issues Warning to the Realm

WATERDEEP, Ches 14 — Early this morning arcane shockwaves shook the Castle Ward.

> "The wards held, but the wards were tested by ancient sorcery." — Archmage Vajra

The City Watch was immediately deployed across the perimeter.

! ALERT: Citizens are urged to stay indoors until bells chime thrice.

### THE INVESTIGATION EXPANDS

Watch investigators discovered runes etched into the cobblestones.

>> "NO ENEMY OF WATERDEEP SHALL ESCAPE JUSTICE" — Open Lord Laeral Silverhand

*Inquiries regarding damaged property should be directed to the City Clerk.*

Further bulletins will follow at dawn.`,
  };

  const pages = parseNewspaperPages(doc);
  assert.equal(pages.length, 1);
  const p = pages[0];

  assert.equal(p.headline, "MIDNIGHT ASSAULT ON BLACKSTAFF TOWER");
  assert.equal(p.subhead, "Archmage Vajra Safahr Issues Warning to the Realm");

  // Verify legacy fields are populated
  assert.equal(p.quotes.length, 2);
  assert.equal(p.notes.length, 1);
  assert.ok(p.paragraphs.length >= 3);

  // Verify flow blocks sequence
  const kinds = p.blocks.map((b) => b.kind);
  assert.deepEqual(kinds, [
    "paragraph",
    "quote",
    "paragraph",
    "highlight",
    "crosshead",
    "paragraph",
    "quote",
    "note",
    "paragraph",
  ]);

  // Check in-column pull quote with author attribution
  const q1 = p.blocks[1];
  assert.equal(q1.kind, "quote");
  if (q1.kind === "quote") {
    assert.equal(q1.text, '"The wards held, but the wards were tested by ancient sorcery."');
    assert.equal(q1.author, "Archmage Vajra");
    assert.equal(q1.isBanner, false);
  }

  // Check highlight callout bar with label
  const h = p.blocks[3];
  assert.equal(h.kind, "highlight");
  if (h.kind === "highlight") {
    assert.equal(h.label, "ALERT");
    assert.equal(h.text, "Citizens are urged to stay indoors until bells chime thrice.");
  }

  // Check crosshead
  const ch = p.blocks[4];
  assert.equal(ch.kind, "crosshead");
  if (ch.kind === "crosshead") {
    assert.equal(ch.text, "THE INVESTIGATION EXPANDS");
  }

  // Check breakout banner pull quote
  const q2 = p.blocks[6];
  assert.equal(q2.kind, "quote");
  if (q2.kind === "quote") {
    assert.equal(q2.text, '"NO ENEMY OF WATERDEEP SHALL ESCAPE JUSTICE"');
    assert.equal(q2.author, "Open Lord Laeral Silverhand");
    assert.equal(q2.isBanner, true);
  }
});

test("Newspaper tropes: supports GitHub-flavored alert syntax (> [!NOTE], > [!WARNING])", () => {
  const doc: LootDocument = {
    style: "newspaper",
    title: "Gazette",
    content: `Story paragraph.

> [!WARNING] Beware of counterfeit gold dragons circulating near the docks.

Continuation text.`,
  };

  const pages = parseNewspaperPages(doc);
  assert.equal(pages[0].blocks.length, 3);
  const block = pages[0].blocks[1];
  assert.equal(block.kind, "highlight");
  if (block.kind === "highlight") {
    assert.equal(block.label, "WARNING");
    assert.equal(block.text, "Beware of counterfeit gold dragons circulating near the docks.");
  }
});

test("Newspaper pictures: parses markdown images into flow blocks between paragraphs in narrative order", () => {
  const doc: LootDocument = {
    style: "newspaper",
    title: "The Sword Coast Inquirer",
    content: `# DRAGON SPOTTED OVER PHANDALIN

Villagers report sightings of a massive winged serpent.

![The shadow over the crags|engraving](https://example.com/dragon.jpg)

The Townmaster has convened an emergency council meeting.`,
  };

  const pages = parseNewspaperPages(doc);
  assert.equal(pages.length, 1);
  const p = pages[0];

  assert.equal(p.blocks.length, 3);
  assert.equal(p.blocks[0].kind, "paragraph");
  assert.equal(p.blocks[1].kind, "image");
  assert.equal(p.blocks[2].kind, "paragraph");

  const imgBlock = p.blocks[1];
  if (imgBlock.kind === "image") {
    assert.equal(imgBlock.image.caption, "The shadow over the crags");
    assert.equal(imgBlock.image.url, "https://example.com/dragon.jpg");
    assert.equal(imgBlock.image.filter, "engraving");
  }
});

test("Newspaper header styles: registration, metadata, and default initialization", () => {
  assert.ok(NEWSPAPER_HEADER_STYLES.length >= 5);
  assert.ok(NEWSPAPER_HEADER_STYLES.includes("tabloid-splash"));
  assert.ok(NEWSPAPER_HEADER_STYLES.includes("classic-masthead"));
  assert.ok(NEWSPAPER_HEADER_STYLES.includes("modern-broadsheet"));
  assert.ok(NEWSPAPER_HEADER_STYLES.includes("banner-screamer"));
  assert.ok(NEWSPAPER_HEADER_STYLES.includes("minimal-chic"));

  for (const style of NEWSPAPER_HEADER_STYLES) {
    assert.ok(NEWSPAPER_HEADER_META[style], `Metadata exists for ${style}`);
    assert.ok(NEWSPAPER_HEADER_META[style].label.length > 0);
    assert.ok(NEWSPAPER_HEADER_META[style].description.length > 0);
  }

  const doc = createLootDocument("newspaper");
  assert.equal(doc.document?.newspaperHeader, "tabloid-splash");
});

test("Newspaper auto-pagination: automatically splits multi-story headings (# Heading) into separate pages", () => {
  const doc: LootDocument = {
    style: "newspaper",
    title: "The Sirius Chronicle",
    content: `# FIRST STORY: ANOMALY DETECTED IN THE SECTOR
Explorers uncovered a strange radiant obelisk.

# SECOND STORY: SECT ELDERS GATHER
Council members held a confidential hearing today.`,
  };

  const pages = parseNewspaperPages(doc);
  assert.equal(pages.length, 2, "Multiple top-level headings should auto-paginate into separate pages");
  assert.equal(pages[0].headline, "FIRST STORY: ANOMALY DETECTED IN THE SECTOR");
  assert.equal(pages[1].headline, "SECOND STORY: SECT ELDERS GATHER");
});

test("Parsing never guesses physical page breaks from word counts", () => {
  const content = Array.from({ length: 50 }, (_, i) => `Paragraph ${i}: ${"The dispatch continues. ".repeat(20)}`).join("\n\n");
  for (const layout of ["pages", "flow"] as const) {
    const pages = parseNewspaperPages({ style: "newspaper", title: "Gazette", layout, content });
    assert.equal(pages.length, 1);
    assert.equal(pages[0].paragraphs.join("\n\n"), content.split("\n\n").map((paragraph) => paragraph.trim()).join("\n\n"));
  }
});

test("Attachment order and requested widths survive distribution across authored stories", () => {
  const images = Array.from({ length: 7 }, (_, i) => ({
    url: `https://example.com/${i}.png`, caption: `Picture ${i}`, width: i % 2 ? "page" as const : "column" as const,
  }));
  const pages = parseNewspaperPages({ style: "newspaper", title: "Gazette", images,
    content: "First story.\n\n---\n\nSecond story.\n\n---\n\nThird story." });
  assert.deepEqual(pages.flatMap(page => page.images).map(({ url, caption, width }) => ({ url, caption, width })), images);
});

test("Inline picture widths coexist with print filters without changing captions", () => {
  const pages = parseNewspaperPages({ style: "newspaper", title: "Gazette",
    content: "![Wide caption|page|engraving](https://example.com/wide.png)\n\n![A | literal caption|raw|column](https://example.com/column.png)" });
  assert.equal(pages[0].images[0].width, "page");
  assert.equal(pages[0].images[0].filter, "engraving");
  assert.equal(pages[0].images[0].caption, "Wide caption");
  assert.equal(pages[0].images[1].width, "column");
  assert.equal(pages[0].images[1].filter, "raw");
  assert.equal(pages[0].images[1].caption, "A | literal caption");
});
