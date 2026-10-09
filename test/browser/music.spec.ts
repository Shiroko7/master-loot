import { test, expect, type Page } from "@playwright/test";
import type { LootDocument } from "../../src/types";
import type { DocumentPagePosition } from "../../src/paperRender";

declare global {
  interface Window {
    musicTest: {
      render(doc: LootDocument): Promise<string[]>;
      settle(): Promise<void>;
      prefs(fontScale?: number, zoom?: number): void;
      position(): DocumentPagePosition | undefined;
      next(): void;
      sampleTune: string;
      newSheet(): LootDocument;
    };
  }
}

const sheet = (content: string, extra: Partial<LootDocument> = {}): LootDocument =>
  ({ style: "music", title: "", content, ...extra });

async function render(page: Page, doc: LootDocument): Promise<string[]> {
  const warnings = await page.evaluate((doc) => window.musicTest.render(doc), doc);
  await page.evaluate(() => window.musicTest.settle());
  return warnings;
}

/** Each staff line is its own SVG; lines must stay inside the text area. */
async function measure(page: Page) {
  return page.evaluate(() => {
    const body = document.querySelector<HTMLElement>(".paper-body")!.getBoundingClientRect();
    const staves = Array.from(document.querySelectorAll<SVGSVGElement>(".music-score svg"));
    return {
      staves: staves.length,
      notes: document.querySelectorAll(".music-score .abcjs-note").length,
      insideBody: staves.every((svg) => {
        const box = svg.getBoundingClientRect();
        return box.height > 0 && box.left >= body.left - 1 && box.right <= body.right + 1;
      }),
      staffHeight: document.querySelector(".music-score .abcjs-staff")!.getBoundingClientRect().height,
      text: document.querySelector(".music-score")!.textContent ?? "",
      fonts: Array.from(new Set(Array.from(
        document.querySelectorAll(".music-score text"), (text) => text.getAttribute("font-family")))),
    };
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/test/browser/music.html");
  await page.waitForSelector(".music-score svg");
});

test("a new music sheet starts with a complete, readable example tune", async ({ page }) => {
  const doc = await page.evaluate(() => window.musicTest.newSheet());
  expect(await render(page, doc)).toEqual([]);
  const result = await measure(page);
  expect(result.text).toContain("Ode to Joy");
  expect(result.text).toContain("Ludwig van Beethoven");
  // 16 bars: the two bars with a slurred pair of eighths have five notes.
  expect(result.notes).toBe(62);
  expect(result.insideBody).toBe(true);
  // Every syllable found a note: a miscounted lyric line would drop its tail.
  for (const ending of ["um,", "tum!", "teilt;", "weilt."]) {
    expect(result.text).toContain(ending);
  }
  // Four different note lengths: eighth, quarter, dotted quarter, half.
  const lengths = await page.evaluate(() => Array.from(new Set(Array.from(
    document.querySelectorAll(".music-score .abcjs-note"),
    (note) => Array.from(note.classList).find((name) => /^abcjs-d\d/.test(name))))).sort());
  expect(lengths).toEqual(["abcjs-d0-125", "abcjs-d0-25", "abcjs-d0-375", "abcjs-d0-5"]);
});

test("engraves a tune with title, chords and lyrics in the document font", async ({ page }) => {
  const sample = await page.evaluate(() => window.musicTest.sampleTune);
  const warnings = await render(page, sheet(sample, { font: "caveat" }));
  expect(warnings).toEqual([]);
  const result = await measure(page);
  expect(result.notes).toBe(28);
  expect(result.staves).toBeGreaterThan(2);
  expect(result.insideBody).toBe(true);
  expect(result.text).toContain("The Miller's Lament");
  expect(result.text).toContain("Turn,");
  expect(result.fonts).toEqual(["Caveat"]);
});

test("bare notes need no header, and blank lines do not cut the tune short", async ({ page }) => {
  const warnings = await render(page, sheet("C D E F | G A B c |\n\nc B A G | F E D C |]"));
  expect(warnings).toEqual([]);
  expect((await measure(page)).notes).toBe(16);
});

test("reports unreadable notation without losing the rest of the tune", async ({ page }) => {
  const warnings = await render(page, sheet("K:G\nG A B | q c |]"));
  expect(warnings).toEqual(["Unknown character ignored: G A B | →q← c |]"]);
  expect((await measure(page)).notes).toBe(4);
});

test("never treats notation as HTML", async ({ page }) => {
  await render(page, sheet('T:<img src=x onerror="window.pwned=1">\nK:C\nC D E F |\nw: <b>la</b> la la la'));
  expect(await page.evaluate(() => document.querySelectorAll(".paper img, .paper b").length)).toBe(0);
  expect(await page.evaluate(() => (window as { pwned?: number }).pwned)).toBeUndefined();
  expect((await measure(page)).text).toContain("<img src=x");
});

test("several tunes share a sheet; an empty sheet says so", async ({ page }) => {
  await render(page, sheet("X:1\nT:One\nK:G\nGABc|\n\nX:2\nT:Two\nK:D\nDEFG|"));
  expect(await page.locator(".music-tune").count()).toBe(2);
  await page.evaluate(() => { void window.musicTest.render({ style: "music", title: "", content: "  \n" }); });
  await expect(page.locator(".music-score")).toHaveText("(The staves are empty.)");
});

test("text size enlarges the notes while lines still fit the paper", async ({ page }) => {
  const sample = await page.evaluate(() => window.musicTest.sampleTune);
  await render(page, sheet(sample));
  const before = await measure(page);
  await page.evaluate(() => window.musicTest.prefs(1.6, 1));
  await page.evaluate(() => window.musicTest.settle());
  const after = await measure(page);
  expect(after.staffHeight).toBeGreaterThan(before.staffHeight * 1.3);
  expect(after.staves).toBeGreaterThan(before.staves);
  expect(after.notes).toBe(before.notes);
  expect(after.insideBody).toBe(true);
});

/** Paper width in pages, and which staff lines are cut off or straddle a page edge. */
async function spreadState(page: Page) {
  return page.evaluate(() => {
    const paper = document.querySelector<HTMLElement>(".paper")!;
    const em = parseFloat(getComputedStyle(paper).fontSize);
    const clip = document.querySelector<HTMLElement>(".paper-clip")!.getBoundingClientRect();
    const pages = document.querySelector<HTMLElement>(".paper-pages")!.getBoundingClientRect();
    const lines = Array.from(document.querySelectorAll(".music-tune > div"), (line) => line.getBoundingClientRect());
    const visible = lines.filter((box) => box.right > clip.left && box.left < clip.right);
    return {
      spread: paper.classList.contains("paper-spread"),
      widthInPages: Math.round((paper.offsetWidth / em / 38) * 100) / 100,
      split: lines.filter((box) => box.top < pages.top - 1 || box.bottom > pages.bottom + 1).length,
      // Staff lines showing on the left and on the right page of the paper.
      left: visible.filter((box) => box.right <= clip.left + clip.width / 2 + 1).length,
      right: visible.filter((box) => box.left >= clip.left + clip.width / 2 - 1).length,
      cut: visible.filter((box) => box.left < clip.left - 1 || box.right > clip.right + 1).length,
      label: document.querySelector(".page-nav span")!.textContent,
      navHidden: document.querySelector<HTMLElement>(".page-nav")!.hidden,
    };
  });
}

const longTune = (lines: number) =>
  `T:Long Song\nM:4/4\nL:1/4\nK:C\n${Array.from({ length: lines }, () => "C D E F | G A B c | c B A G |").join("\n")}`;

test("a tune that fits on one page shows a single page", async ({ page }) => {
  await render(page, await page.evaluate(() => window.musicTest.newSheet()));
  const state = await spreadState(page);
  expect(state.spread).toBe(false);
  expect(state.widthInPages).toBe(1);
  expect(state.navHidden).toBe(true);
  expect(state.right).toBe(0);
  expect(await page.evaluate(() => window.musicTest.position())).toEqual({ page: 1, lastPage: 1, pageCount: 1 });
});

test("a longer tune opens as two pages side by side and turns two at a time", async ({ page }) => {
  await render(page, sheet(longTune(22)));
  const first = await spreadState(page);
  expect(first.spread).toBe(true);
  expect(first.widthInPages).toBe(2);
  expect(first.split).toBe(0);
  expect(first.cut).toBe(0);
  expect(first.left).toBeGreaterThan(3);
  expect(first.right).toBeGreaterThan(3);
  const count = (await page.evaluate(() => window.musicTest.position()))!.pageCount;
  expect(count).toBe(3);
  expect(first.label).toBe("1–2 / 3");
  expect(await page.evaluate(() => window.musicTest.position())).toEqual({ page: 1, lastPage: 2, pageCount: 3 });

  // The last spread holds the odd page on its left; the right stays blank.
  await page.evaluate(() => window.musicTest.next());
  await page.waitForTimeout(400);
  const last = await spreadState(page);
  expect(last.label).toBe("3 / 3");
  expect(last.left).toBeGreaterThan(0);
  expect(last.right).toBe(0);
  expect(last.cut).toBe(0);
  expect(await page.evaluate(() => window.musicTest.position())).toEqual({ page: 3, lastPage: 3, pageCount: 3 });
  await page.evaluate(() => window.musicTest.next());
  expect((await page.evaluate(() => window.musicTest.position()))?.page).toBe(3);
});

test("the spread follows the page count as text size changes, and Continuous stays one sheet", async ({ page }) => {
  await render(page, sheet(longTune(7)));
  expect((await spreadState(page)).spread).toBe(false);
  await page.evaluate(() => window.musicTest.prefs(1.8, 1));
  await page.evaluate(() => window.musicTest.settle());
  await expect.poll(async () => (await spreadState(page)).spread).toBe(true);
  expect((await spreadState(page)).cut).toBe(0);
  await page.evaluate(() => window.musicTest.prefs(1, 1));
  await page.evaluate(() => window.musicTest.settle());
  await expect.poll(async () => (await spreadState(page)).spread).toBe(false);

  await render(page, sheet(longTune(22), { layout: "flow" }));
  expect(await page.locator(".paper-clip").count()).toBe(0);
  expect(await page.evaluate(() => window.musicTest.position())).toBeUndefined();
});
