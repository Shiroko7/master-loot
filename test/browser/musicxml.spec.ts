import { test, expect, type Page } from "@playwright/test";
import { strToU8, zipSync } from "fflate";
import type { LootDocument } from "../../src/types";
import type { MusicXmlImport } from "../../src/musicXml";
import { leadSheetAbc, leadSheetXml, longTuneXml, pianoAbc, pianoXml } from "../musicXmlFixtures";

type Converted = MusicXmlImport & { error?: string };

declare global {
  interface Window {
    musicTest: {
      render(doc: LootDocument): Promise<string[]>;
      settle(): Promise<void>;
      convert(xml: string, maxChars?: number): Converted;
      readFile(bytes: number[], name: string): Promise<string>;
      mountGuide(content: string): void;
      sampleTune: string;
    };
    importedTitles: string[];
  }
}

const convert = (page: Page, xml: string, maxChars?: number) =>
  page.evaluate(([xml, maxChars]) => window.musicTest.convert(xml as string, maxChars as number | undefined),
    [xml, maxChars] as const);

/** Engraves ABC on a continuous sheet; returns the engraver's warnings and what it drew. */
async function engrave(page: Page, abc: string) {
  const warnings = await page.evaluate(
    (content) => window.musicTest.render({ style: "music", title: "", content, layout: "flow" }), abc);
  await page.evaluate(() => window.musicTest.settle());
  return page.evaluate((warnings) => ({
    warnings,
    notes: document.querySelectorAll(".music-score .abcjs-note").length,
    staves: document.querySelectorAll(".music-score .abcjs-staff").length,
    text: document.querySelector(".music-score")!.textContent ?? "",
  }), warnings);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/test/browser/music.html");
  await page.waitForSelector(".music-score svg");
});

test("a lead sheet converts note for note, with chords, verses, repeats and ornaments", async ({ page }) => {
  const score = await convert(page, leadSheetXml);
  expect(score.abc).toBe(leadSheetAbc);
  expect(score).toMatchObject({ title: "The Ferryman's 'Round'", parts: 1, measures: 4, importedMeasures: 4, notes: [] });
  const drawn = await engrave(page, score.abc);
  expect(drawn.warnings).toEqual([]);
  // 11 notes and chords; the grace note is drawn but not counted as one.
  expect(drawn.notes).toBe(11);
  for (const shown of ["The Ferryman's 'Round'", "Anon.", "Em7/B", "Row", "Pull", "shore."]) {
    expect(drawn.text).toContain(shown);
  }
});

test("a piano part keeps both staves and its second voice", async ({ page }) => {
  const score = await convert(page, pianoXml);
  expect(score.abc).toBe(pianoAbc);
  const drawn = await engrave(page, score.abc);
  expect(drawn.warnings).toEqual([]);
  expect(drawn.staves).toBe(2);
  expect(drawn.notes).toBe(9);
});

test("files that are not usable scores are refused with a reason", async ({ page }) => {
  expect((await convert(page, "this is not xml <")).error).toContain("not valid XML");
  expect((await convert(page, "<html><body/></html>")).error).toContain("not a MusicXML score");
  expect((await convert(page, "<score-timewise/>")).error).toContain("timewise");
  expect((await convert(page, "<score-partwise><part id='P1'><measure/></part></score-partwise>")).error)
    .toContain("no notes");
});

test("a score too long for one document is cut at a measure and says so", async ({ page }) => {
  const whole = await convert(page, longTuneXml(60));
  expect(whole.importedMeasures).toBe(60);
  expect(whole.abc.endsWith("|]")).toBe(true);
  const cut = await convert(page, longTuneXml(60), 300);
  expect(cut.abc.length).toBeLessThanOrEqual(300);
  expect(cut.importedMeasures).toBeGreaterThan(15);
  expect(cut.importedMeasures).toBeLessThan(60);
  expect(cut.notes[0]).toContain(`measures 1–${cut.importedMeasures} of 60`);
  const drawn = await engrave(page, cut.abc);
  expect(drawn.warnings).toEqual([]);
  expect(drawn.notes).toBe(cut.importedMeasures * 4);
});

test("compressed .mxl and UTF-16 files are read like plain MusicXML", async ({ page }) => {
  const read = (bytes: Uint8Array, name: string) =>
    page.evaluate(([bytes, name]) => window.musicTest.readFile(bytes as number[], name as string),
      [Array.from(bytes), name] as const);
  const container = `<?xml version="1.0"?><container><rootfiles><rootfile full-path="score/piano.musicxml"/></rootfiles></container>`;
  const mxl = zipSync({
    "META-INF/container.xml": strToU8(container),
    "score/piano.musicxml": strToU8(pianoXml),
  });
  expect(await read(mxl, "piano.mxl")).toBe(pianoXml);
  // No container: the first score in the archive.
  expect(await read(zipSync({ "tune.xml": strToU8(leadSheetXml) }), "tune.mxl")).toBe(leadSheetXml);

  const utf16 = new Uint8Array(2 + pianoXml.length * 2);
  utf16.set([0xff, 0xfe]);
  for (let i = 0; i < pianoXml.length; i++) {
    utf16[2 + i * 2] = pianoXml.charCodeAt(i) & 0xff;
    utf16[3 + i * 2] = pianoXml.charCodeAt(i) >> 8;
  }
  expect((await convert(page, await read(utf16, "piano.xml"))).abc).toBe(pianoAbc);
  expect((await convert(page, `﻿${pianoXml}`)).abc).toBe(pianoAbc);
});

test("the editor's import button replaces the example, asks before replacing real work, and reports errors", async ({ page }) => {


  await page.evaluate(() => window.musicTest.mountGuide(""));
  const input = page.locator("#guide textarea");
  const status = page.locator("#guide .music-import-status");
  const choose = (name: string, body: string | Uint8Array) =>
    page.locator('#guide input[type="file"]').setInputFiles({
      name, mimeType: "application/octet-stream", buffer: Buffer.from(body),
    });
  await expect(page.locator("#guide").getByRole("button", { name: "📂 Import MusicXML…" })).toBeVisible();
  await expect(status).toBeHidden();

  await choose("ferryman.musicxml", leadSheetXml);
  await expect(input).toHaveValue(leadSheetAbc);
  await expect(status).toContainText("Imported “The Ferryman's 'Round'”: 4 measures, 1 part.");
  expect(await page.evaluate(() => window.importedTitles)).toEqual(["The Ferryman's 'Round'"]);

  // Real work is only replaced when the GM agrees.
  page.once("dialog", (dialog) => void dialog.dismiss());
  await choose("piano.mxl", zipSync({ "piano.xml": strToU8(pianoXml) }));
  await page.waitForTimeout(200);
  await expect(input).toHaveValue(leadSheetAbc);
  page.once("dialog", (dialog) => void dialog.accept());
  await choose("piano.mxl", zipSync({ "piano.xml": strToU8(pianoXml) }));
  await expect(input).toHaveValue(pianoAbc);

  // An untitled score is named after its file.
  page.once("dialog", (dialog) => void dialog.accept());
  await choose("tavern_song.xml", longTuneXml(2));
  await expect(input).toHaveValue(/^X:1\nT:tavern song\nM:4\/4/);

  page.once("dialog", (dialog) => { throw new Error(`unexpected dialog: ${dialog.message()}`); });
  await choose("notes.xml", "<notes>buy lute strings</notes>");
  await expect(status).toHaveClass(/error/);
  await expect(status).toContainText("not a MusicXML score");
  await expect(input).toHaveValue(/tavern song/);
});
