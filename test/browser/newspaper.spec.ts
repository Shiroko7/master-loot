import { test, expect, type Page } from "@playwright/test";
import type { LootDocument, NewspaperLayout } from "../../src/types";
import { NEWSPAPER_HEADER_STYLES, NEWSPAPER_HEADER_META } from "../../src/types";

declare global {
  interface Window {
    newspaperTest: {
      render(doc: LootDocument): void;
      settle(): Promise<void>;
      prefs(fontScale?: number, zoom?: number): void;
      goTo(index: number): void;
      next(): void;
      prev(): void;
      regression(): LootDocument;
    };
  }
}

// Current presets + Smart Fit + both saved legacy names.
const layouts: NewspaperLayout[] = ["auto", "hero", "split-lead", "column-inset", "broadsheet-3col", "editorial-dual", "gazette-mosaic"];
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
const paragraphs = Array.from({ length: 22 }, (_, index) =>
  `Dispatch ${index + 1}. ` + Array.from({ length: 7 }, (_, sentence) =>
    `Witness ${index}-${sentence} said, “The northern road remains open!” Traders’ wagons crossed the bridge; every record survived.`).join(" "));
const content = paragraphs.join("\n\n");

function picture(index: number) {
  const [width, height] = [[720, 960], [1200, 600], [640, 640], [48, 32]][index % 4];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#b6a786"/><path d="M0 ${height} L${width / 2} 0 L${width} ${height}" fill="#3c3b34"/><circle cx="${width * .25}" cy="${height * .25}" r="${width * .09}" fill="#ede6d4"/></svg>`;
  return { url: `data:image/svg+xml,${encodeURIComponent(svg)}`, caption: `Archive illustration ${index + 1}` };
}

async function render(page: Page, doc: LootDocument) {
  await page.evaluate((doc) => window.newspaperTest.render(doc), doc);
  await page.evaluate(() => window.newspaperTest.settle());
}

async function measure(page: Page) {
  return page.evaluate(() => {
    // Inspect every physical page at its real spread width, including later spreads.
    document.querySelectorAll<HTMLElement>(".newspaper-spread").forEach((spread) => { spread.hidden = false; });
    const columns = Array.from(document.querySelectorAll<HTMLElement>(".newspaper-column"), (column) => {
      const rect = column.getBoundingClientRect();
      const children = Array.from(column.children, (node) => node.getBoundingClientRect());
      const last = children.at(-1);
      return {
        reason: column.dataset.breakReason,
        intro: column.parentElement?.classList.contains("newspaper-lead-band"),
        gap: rect.bottom - (last?.bottom ?? rect.top),
        line: parseFloat(getComputedStyle(column).lineHeight),
        height: rect.height,
        // The intentional divider rule sits in the gutter outside the column.
        overflow: Math.max(0, ...Array.from(column.children, (node) => {
          const range = document.createRange();
          range.selectNodeContents(node);
          return range.getBoundingClientRect().right - rect.right;
        })),
        count: children.length,
      };
    });
    return {
      columns,
      text: Array.from(document.querySelectorAll(".newspaper-column > p"), (p) => p.textContent).join(" "),
      images: Array.from(document.querySelectorAll<HTMLImageElement>(".newspaper-page-slide img"), (img) => {
        const rect = img.getBoundingClientRect();
        return { width: rect.width, height: rect.height, ratio: img.naturalWidth / img.naturalHeight };
      }),
      pageCount: document.querySelectorAll(".newspaper-page-slide").length,
      // All pages share a bottom baseline; content must stay inside it.
      pageOverflow: Array.from(document.querySelectorAll<HTMLElement>(".newspaper-page-slide"), (page) => {
        const bottom = page.getBoundingClientRect().bottom;
        return Math.max(0, ...Array.from(page.querySelectorAll(".newspaper-column > *, .newspaper-slot-page, .newspaper-slot-hero"), (node) => node.getBoundingClientRect().bottom - bottom));
      }),
      dropCaps: Array.from(document.querySelectorAll(".newspaper-page-slide"), (page) => page.querySelectorAll(".has-drop-cap").length),
    };
  });
}

function checkGeometry(result: Awaited<ReturnType<typeof measure>>) {
  expect(Math.max(...result.pageOverflow)).toBeLessThanOrEqual(1);
  for (const [index, column] of result.columns.entries()) {
    // A short front-page introduction shrinks to its content; main reading
    // regions must still provide enough capacity for multiple lines.
    expect(column.height, `column ${index} has physical capacity`).toBeGreaterThan(column.intro ? 0 : 50);
    expect(column.gap, `column ${index} must not overflow vertically`).toBeGreaterThanOrEqual(-1);
    expect(column.overflow, `column ${index} must not overflow horizontally`).toBeLessThanOrEqual(1);
    if (column.reason === "text") {
      expect(column.gap, `column ${index} abandoned ${column.gap}px before continuing text`).toBeLessThan(column.line + 1);
    }
  }
  expect(result.dropCaps[0]).toBe(1);
  expect(result.dropCaps.slice(1).every((count) => count === 0)).toBeTruthy();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/test/browser/newspaper.html");
  await page.waitForFunction(() => Boolean(window.newspaperTest));
});

for (const layout of layouts) {
  for (let count = 0; count <= 10; count++) {
    test(`${layout}: ${count} images, complete text and measured capacity`, async ({ page }, info) => {
      await render(page, { style: "newspaper", title: "The Northern Gazette", newspaperSubtitle: "The road stays open",
        newspaperLayout: layout, content, images: Array.from({ length: count }, (_, i) => picture(i)) });
      const result = await measure(page);
      checkGeometry(result);
      expect(normalize(result.text)).toBe(normalize(content));
      expect(result.images).toHaveLength(count);
      expect(result.pageCount).toBeGreaterThan(2);
      for (const image of result.images) {
        expect(image.width / image.height).toBeCloseTo(image.ratio, 1);
      }
      if (count === 10) {
        await page.evaluate(() => window.newspaperTest.goTo(0));
        await page.locator(".paper").screenshot({ path: info.outputPath(`${layout}.png`) });
      }
    });
  }
}

test("reported article fills Page 1 before flowing to Page 2", async ({ page }, info) => {
  const doc = await page.evaluate(() => window.newspaperTest.regression());
  // The author has not requested a break: pagination must follow physical capacity.
  doc.content = doc.content.replace(/\n\n---\n\n/g, "\n\n");
  doc.images = [picture(0), picture(2)];
  await render(page, doc);
  const result = await measure(page);
  checkGeometry(result);
  expect(normalize(result.text)).toBe(normalize(doc.content));
  await page.evaluate(() => window.newspaperTest.goTo(0));
  await page.screenshot({ path: info.outputPath("reported-article.png"), fullPage: true });
});

test("inline pictures keep narrative order and repeated URLs are not swallowed", async ({ page }) => {
  const image = picture(0);
  const paragraphs = ["Before the first photograph.", "Between the two photographs.", "After the last photograph."];
  await render(page, { style: "newspaper", title: "Photographs", newspaperLayout: "hero",
    content: `${paragraphs[0]}\n\n![First caption](${image.url})\n\n${paragraphs[1]}\n\n![Second caption](${image.url})\n\n${paragraphs[2]}` });
  const result = await measure(page);
  checkGeometry(result);
  expect(result.images).toHaveLength(2);
  expect(normalize(result.text)).toBe(paragraphs.join(" "));
  const blocks = await page.locator("[data-story-block]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-story-block")));
  expect(blocks).toEqual(["0-0", "0-1", "0-2", "0-3", "0-4"]);
});

test("pull-quotes, banners, crossheads, highlights and notes survive pagination exactly once", async ({ page }, info) => {
  await render(page, { style: "newspaper", title: "The Chronicle", newspaperSubtitle: "A city wakes to the news", newspaperLayout: "gazette-mosaic",
    content: `${paragraphs[0]}\n\n> “Every voice matters.” — The Editor\n\n${paragraphs[1]}\n\n### Across the northern road\n\n${paragraphs[2]}\n\n>> “The bridge remains open!”\n\n! [BREAKING] The watch confirms safe passage.\n\n*An editorial note for our readers.*\n\n${paragraphs[3]}`,
    images: [picture(1)] });
  const result = await measure(page);
  checkGeometry(result);
  await expect(page.locator(".newspaper-quote")).toHaveCount(2);
  await expect(page.locator(".newspaper-quote.is-banner")).toHaveCount(1);
  await expect(page.locator(".newspaper-highlight-bar")).toHaveCount(1);
  await expect(page.locator(".newspaper-crosshead")).toHaveCount(1);
  await expect(page.locator(".paper-note")).toHaveCount(1);
  await page.evaluate(() => window.newspaperTest.goTo(0));
  await page.screenshot({ path: info.outputPath("newspaper-tropes.png"), fullPage: true });
});

test("image load and error events automatically repaginate without a manual relayout", async ({ page }) => {
  let release!: () => void;
  const imageReady = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/delayed-newspaper.svg", async (route) => {
    await imageReady;
    await route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="600" height="900" fill="gray"/></svg>' });
  });
  await page.evaluate((content) => window.newspaperTest.render({ style: "newspaper", title: "Late pictures", content,
    images: [{ url: "/delayed-newspaper.svg", caption: "The arriving illustration" }] }), content);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const before = await page.locator(".paper").getAttribute("data-layout-version");
  release();
  await expect.poll(async () => Number(await page.locator(".paper").getAttribute("data-layout-version"))).toBeGreaterThan(Number(before));
  await expect(page.locator(".newspaper-figure.aspect-portrait")).toHaveCount(1);
  checkGeometry(await measure(page));

  await page.route("**/broken-newspaper.png", (route) => route.abort());
  await page.evaluate((content) => window.newspaperTest.render({ style: "newspaper", title: "Archive", content,
    images: [{ url: "/broken-newspaper.png", caption: "Lost <b>print</b>" }] }), content);
  await expect(page.locator(".newspaper-img-placeholder")).toHaveCount(1);
  await expect(page.locator(".newspaper-img-placeholder")).toContainText("Lost <b>print</b>");
  await expect(page.locator(".newspaper-img-placeholder b")).toHaveCount(0);
  const result = await measure(page);
  checkGeometry(result);
  expect(normalize(result.text)).toBe(normalize(content));
});

test("all images fit even with almost no story text", async ({ page }) => {
  for (const layout of layouts) {
    await render(page, { style: "newspaper", title: "Pictures", newspaperLayout: layout,
      content: "A brief account from the archives.", images: Array.from({ length: 10 }, (_, index) => picture(index)) });
    const result = await measure(page);
    checkGeometry(result);
    expect(result.images).toHaveLength(10);
    expect(normalize(result.text)).toBe("A brief account from the archives.");
  }
});

test("late fonts trigger reflow and keep every word", async ({ page }) => {
  let release!: () => void;
  const fontReady = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/*caveat*woff2", async (route) => { await fontReady; await route.continue(); });
  await page.evaluate((content) => window.newspaperTest.render({ style: "newspaper", title: "Handwritten dispatch", content, font: "caveat" }), content);
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const before = await page.locator(".paper").getAttribute("data-layout-version");
  release();
  await page.evaluate(() => document.fonts.ready);
  await expect.poll(async () => Number(await page.locator(".paper").getAttribute("data-layout-version"))).toBeGreaterThan(Number(before));
  const result = await measure(page);
  checkGeometry(result);
  expect(normalize(result.text)).toBe(normalize(content));
});

test("a token taller than a page remains complete without overflowing the sheet", async ({ page }) => {
  const content = "Archive " + "abcdefghij".repeat(400) + " final words.";
  await render(page, { style: "newspaper", title: "Archive", content });
  const result = await measure(page);
  checkGeometry(result);
  // Character-boundary continuations do not insert spaces into the original token.
  const actual = await page.locator(".newspaper-column > p").allTextContents();
  expect(actual.join("")).toBe(content);
});

test("detached editor preview and continuous reading render after attachment", async ({ page }) => {
  await page.evaluate(async (content) => {
    const { renderNewspaperDocument } = await import("../../src/newspaperRender.ts");
    const stage = document.createElement("div");
    stage.className = "paper-stage";
    renderNewspaperDocument(stage, { style: "newspaper", title: "Preview", content, layout: "flow" });
    document.body.replaceChildren(stage);
  }, content);
  await expect(page.locator(".newspaper-page-slide")).not.toHaveCount(0);
  await expect(page.locator(".page-nav")).toBeHidden();
  const result = await measure(page);
  checkGeometry(result);
  expect(normalize(result.text)).toBe(normalize(content));
});

test("short article fills only the first column and shows no page controls or end marker", async ({ page }) => {
  await render(page, { style: "newspaper", title: "Brief", content: "A quiet morning at the harbor.", newspaperLayout: "split-lead" });
  expect(await page.locator(".newspaper-page-slide").count()).toBe(1);
  await expect(page.locator(".newspaper-column").nth(0)).toContainText("quiet morning");
  await expect(page.locator(".newspaper-column").nth(1)).toBeEmpty();
  await expect(page.locator(".page-nav")).toBeHidden();
  await expect(page.locator(".paper")).not.toContainText("- 30 -");
});

test("explicit page breaks, two-page spreads and keyboard-facing navigation API stay synchronized", async ({ page }) => {
  await render(page, { style: "newspaper", title: "Dispatch", content: ["First story.", "Second story.", "Third story."].join("\n\n---\n\n") });
  await expect(page.locator(".newspaper-page-slide:visible")).toHaveCount(2);
  await page.evaluate(() => window.newspaperTest.next());
  await expect(page.locator(".page-nav")).toContainText("SPREAD 2 OF 2");
  await expect(page.getByRole("button", { name: "Next spread" })).toBeDisabled();
  await expect(page.locator(".newspaper-page-slide:visible")).toHaveCount(1);
  await page.getByRole("button", { name: "Previous spread" }).click();
  await expect(page.locator(".page-nav")).toContainText("SPREAD 1 OF 2");
});

test("one long formatted paragraph crosses columns and pages without losing punctuation or links", async ({ page }) => {
  const sentence = '“Still here?” **Every bold word** survives; *every italic word* survives. [The full report](https://example.com/report) said, “Yes!”';
  const expected = sentence.replaceAll("**", "").replaceAll("*", "").replace("[The full report](https://example.com/report)", "The full report");
  await render(page, { style: "newspaper", title: "Report", content: Array(100).fill(sentence).join(" "), newspaperLayout: "broadsheet-3col" });
  const result = await measure(page);
  checkGeometry(result);
  expect(normalize(result.text)).toBe(Array(100).fill(expected).join(" "));
  expect(normalize(await page.locator(".newspaper-column strong").allTextContents().then((text) => text.join(" ")))).toBe(Array(100).fill("Every bold word").join(" "));
  expect(normalize(await page.locator(".newspaper-column a").allTextContents().then((text) => text.join(" ")))).toBe(Array(100).fill("The full report").join(" "));
});

test("resizing, font changes and zoom repaginate without losing text", async ({ page }) => {
  await render(page, { style: "newspaper", title: "Dispatch", content, images: [picture(0)], newspaperLayout: "editorial-dual" });
  for (const [width, scale, zoom] of [[1000, 1, 1], [1440, 1.4, 1], [880, 1.2, .8], [1280, 1, 1]]) {
    await page.setViewportSize({ width, height: 1100 });
    await page.evaluate(([scale, zoom]) => window.newspaperTest.prefs(scale, zoom), [scale, zoom]);
    await page.evaluate(() => window.newspaperTest.settle());
    const result = await measure(page);
    checkGeometry(result);
    expect(normalize(result.text)).toBe(normalize(content));
  }
});

test("the four compositions have distinct physical reading structures", async ({ page }, info) => {
  const compositions: NewspaperLayout[] = ["split-lead", "hero", "column-inset", "gazette-mosaic"];
  const specimens: { layout: string; html: string; style: string; width: number; height: number }[] = [];
  for (const layout of compositions) {
    await render(page, { style: "newspaper", title: "The Northern Gazette", newspaperSubtitle: "A new dawn at the harbor",
      newspaperLayout: layout, content, images: [picture(1), picture(0)] });
    const firstPage = page.locator(".newspaper-page-slide").first();
    const grids = firstPage.locator(".newspaper-column-grid");
    await expect(grids).toHaveCount(layout === "gazette-mosaic" ? 2 : 1);
    for (const grid of await grids.all()) {
      await expect(grid.locator(":scope > .newspaper-column")).toHaveCount(layout === "column-inset" ? 1 : 2);
    }
    await expect(firstPage.locator(".newspaper-lead-band")).toHaveCount(layout === "hero" ? 1 : 0);
    await expect(firstPage.locator(".newspaper-slot-hero")).toHaveCount(layout === "hero" ? 1 : 0);
    if (layout === "gazette-mosaic") {
      const upper = (await grids.nth(0).boundingBox())!;
      const lower = (await grids.nth(1).boundingBox())!;
      expect(lower.y).toBeGreaterThan(upper.y + upper.height);
    }
    if (layout === "column-inset") {
      const column = (await grids.first().boundingBox())!;
      const sheet = (await firstPage.boundingBox())!;
      expect(column.width / sheet.width).toBeGreaterThan(.95);
    }
    await firstPage.screenshot({ path: info.outputPath(`${layout}-composition.png`) });
    specimens.push(await page.evaluate((layout) => {
      const paper = document.querySelector<HTMLElement>(".paper")!;
      const sheet = paper.querySelector<HTMLElement>(".newspaper-page-slide")!;
      const style = getComputedStyle(paper);
      return { layout, html: sheet.outerHTML, style: paper.getAttribute("style") ?? "",
        width: sheet.offsetWidth + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight),
        height: sheet.offsetHeight + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) };
    }, layout));
  }
  // Compose the actual rendered DOM into a comparison sheet; no image editing.
  await page.evaluate((specimens) => {
    const names: Record<string, string> = { "split-lead": "Classic / Smart Fit", hero: "Front Page", "column-inset": "Feature", "gazette-mosaic": "Gazette Digest" };
    const gallery = document.createElement("main");
    gallery.style.cssText = "display:grid;grid-template-columns:repeat(2,max-content);gap:28px;padding:24px;justify-content:center";
    for (const specimen of specimens) {
      const card = document.createElement("section");
      const title = document.createElement("h2");
      title.textContent = names[specimen.layout];
      title.style.cssText = "font:600 18px 'Segoe UI';color:#ece3c9;margin:0 0 12px";
      const frame = document.createElement("div");
      frame.style.cssText = `width:${specimen.width * .85}px;height:${specimen.height * .85}px`;
      const paper = document.createElement("article");
      paper.className = "paper paper-newspaper is-single";
      paper.setAttribute("style", specimen.style);
      paper.style.width = `${specimen.width}px`;
      paper.style.transform = "scale(.85)";
      paper.style.transformOrigin = "top left";
      paper.innerHTML = specimen.html;
      frame.append(paper);
      card.append(title, frame);
      gallery.append(card);
    }
    document.body.replaceChildren(gallery);
  }, specimens);
  await page.screenshot({ path: info.outputPath("layout-comparison.png"), fullPage: true });
});

test("Smart Fit never switches column count when articles, pictures or pages change", async ({ page }) => {
  for (const images of [[], [picture(0)], [picture(1), picture(2)]]) {
    await render(page, { style: "newspaper", title: "An edited title", content: content + " Extra words.", images, newspaperLayout: "auto" });
    await expect(page.locator(".newspaper-page-slide:not(.layout-split-lead)")).toHaveCount(0);
    for (const grid of await page.locator(".newspaper-column-grid").all()) {
      await expect(grid.locator(":scope > .newspaper-column")).toHaveCount(2);
    }
    const result = await measure(page);
    checkGeometry(result);
    expect(normalize(result.text)).toBe(normalize(content + " Extra words."));
  }
});

for (const layout of ["hero", "column-inset", "gazette-mosaic"] as const) {
  test(`${layout} keeps its composition and fits at larger text sizes on narrow pages`, async ({ page }) => {
    await page.setViewportSize({ width: 880, height: 1100 });
    await render(page, { style: "newspaper", title: "Gazette", newspaperSubtitle: "The harbor opens", content, newspaperLayout: layout,
      images: [picture(0), picture(1), picture(2)] });
    await page.evaluate(() => window.newspaperTest.prefs(1.4, 1));
    await page.evaluate(() => window.newspaperTest.settle());
    const result = await measure(page);
    checkGeometry(result);
    expect(normalize(result.text)).toBe(normalize(content));
    expect(result.images).toHaveLength(3);
  });
}

test("visual picker has four distinct choices and supports saved legacy presets", async ({ page }, info) => {
  await page.evaluate(async () => {
    const { createNewspaperLayoutPicker } = await import("../../src/newspaperLayoutPicker.ts");
    const wrap = document.createElement("div");
    wrap.style.cssText = "width:540px;padding:12px;background:#1d150c";
    const show = (layout: NewspaperLayout) => wrap.replaceChildren(createNewspaperLayoutPicker(layout, show));
    show("editorial-dual");
    document.body.replaceChildren(wrap);
  });
  await expect(page.getByRole("button")).toHaveCount(4);
  await expect(page.getByRole("button", { name: "Classic / Smart Fit", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Feature", exact: true }).click();
  await expect(page.getByRole("button", { name: "Feature", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".newspaper-layout-description")).toContainText("One broad reading column");
  await page.locator(".newspaper-layout-picker").screenshot({ path: info.outputPath("layout-picker.png") });
});

for (const newspaperHeader of NEWSPAPER_HEADER_STYLES) {
  test(`print header ${newspaperHeader} preserves field roles, optional blanks, and narrow-page capacity`, async ({ page }, info) => {
    const doc: LootDocument = { style: "newspaper", title: "The Hidden Light", newspaperHeader,
      newspaperHeadline: "Sect leader exposed as witnesses break their silence",
      newspaperDeck: "An inquiry opens after the guard uncovers a secret correspondence.",
      newspaperIssue: "Vol. IV • 21 Midsummer • 2 cp", content, images: [picture(0)] };
    await render(page, doc);
    const header = page.locator(".newspaper-front-header");
    await expect(header.locator(".newspaper-nameplate")).toHaveText(doc.title);
    await expect(header.locator("h1")).toHaveText(doc.newspaperHeadline!);
    await expect(header.locator(".newspaper-front-deck")).toHaveText(doc.newspaperDeck!);
    await expect(header.locator(".newspaper-edition-line")).toHaveText(doc.newspaperIssue!);
    expect(await header.evaluate(node => {
      const size = (selector: string) => parseFloat(getComputedStyle(node.querySelector(selector)!).fontSize);
      return size("h1") / size(".newspaper-nameplate");
    })).toBeGreaterThan(1.2);
    await page.locator(".paper").screenshot({ path: info.outputPath("print-header.png") });
    await page.setViewportSize({ width: 880, height: 1100 });
    await page.evaluate(() => window.newspaperTest.prefs(1.4, 1));
    for (const newspaperLayout of ["auto", "hero", "column-inset", "gazette-mosaic"] as const) {
      await render(page, { ...doc, newspaperLayout });
      const result = await measure(page);
      checkGeometry(result);
      expect(normalize(result.text)).toBe(normalize(content));
      expect(result.images).toHaveLength(1);
      if (newspaperLayout === "auto" || newspaperLayout === "hero") {
        await page.evaluate(() => window.newspaperTest.goTo(0));
        await page.locator(".paper").screenshot({ path: info.outputPath(`narrow-${newspaperLayout}-header.png`) });
      }
    }
    await page.evaluate(() => window.newspaperTest.prefs(1, 1));
    // Reproduce the user's current fields exactly: never promote the paper name.
    await render(page, { style: "newspaper", title: doc.title, newspaperHeader, content,
      newspaperIssue: "EARLIEST GAY INFIDELITY SECT LEADER EVER REGISTERED IN SIRIUS HISTORY!?" });
    await expect(header.locator("h1")).toHaveCount(0);
    await expect(header.locator(".newspaper-nameplate")).toHaveText(doc.title);
    await expect(header).not.toContainText("THE DAILY DISPATCH");
    await render(page, { style: "newspaper", title: "", newspaperHeader,
      newspaperHeadline: "Only the story headline was supplied", content });
    await expect(header).toHaveText("Only the story headline was supplied");
    await expect(page.locator(".newspaper-running-header").first()).toHaveText(/^[—\s]*PAGE 2 OF \d+\s*—$/);
    await render(page, { style: "newspaper", title: "", newspaperHeader, content });
    await expect(header).toHaveCount(0);
  });
}

test("saved headline/deck fields and markdown headings retain their meaning in every print style", async ({ page }) => {
  for (const newspaperHeader of NEWSPAPER_HEADER_STYLES) {
    const doc: LootDocument = { style: "newspaper", title: "The Chronicle", newspaperHeader,
      newspaperSubtitle: "Saved story headline", content: "The complete story." };
    await render(page, doc);
    await expect(page.locator(".newspaper-front-headline")).toHaveText("Saved story headline");
    await render(page, { ...doc, newspaperSubtitle: "Saved supporting deck", content: "# Markdown headline\n\nThe complete story." });
    await expect(page.locator(".newspaper-front-headline")).toHaveText("Markdown headline");
    await expect(page.locator(".newspaper-front-deck")).toHaveText("Saved supporting deck");
    await render(page, { ...doc, newspaperHeadline: "Explicit headline", newspaperDeck: "Explicit deck",
      content: "# Markdown headline\n\n## Markdown subhead\n\nFirst story.\n\n# Another story\n\n## Another deck\n\nSecond story." });
    await expect(page.locator(".newspaper-front-headline")).toHaveText("Explicit headline");
    await expect(page.locator(".newspaper-front-deck")).toHaveText("Explicit deck");
    await expect(page.locator(".newspaper-headline")).toHaveText("Another story");
    await expect(page.locator(".newspaper-subhead")).toHaveText("Another deck");
    await render(page, { ...doc, newspaperHeadline: "", newspaperDeck: "" });
    await expect(page.locator(".newspaper-front-headline, .newspaper-front-deck")).toHaveCount(0);
    await render(page, { ...doc, newspaperHeadline: "", newspaperDeck: "",
      content: "# Heading in the story\n\n## Subheading in the story\n\nThe complete story." });
    await expect(page.locator(".newspaper-front-headline")).toHaveText("Heading in the story");
    await expect(page.locator(".newspaper-front-deck")).toHaveText("Subheading in the story");
  }
});

test("header editor fixes a misplaced headline and preserves distinct fields through serialization", async ({ page }, info) => {
  await page.evaluate(async () => {
    const { createNewspaperHeaderFields } = await import("../../src/newspaperHeaderFields.ts");
    const doc: LootDocument = { style: "newspaper", title: "The Hidden Light",
      newspaperIssue: "Sect leader exposed as witnesses break their silence", content: "The story begins here." };
    const wrap = document.createElement("div");
    wrap.id = "header-editor";
    wrap.style.cssText = "width:620px;padding:16px;background:#1d150c";
    const update = () => window.newspaperTest.render(JSON.parse(JSON.stringify(doc)));
    wrap.append(createNewspaperHeaderFields(doc, update));
    document.body.prepend(wrap);
    update();
  });
  await page.getByRole("button", { name: "Use edition text as the story headline" }).click();
  await expect(page.getByRole("textbox", { name: "Main story headline", exact: true })).toHaveValue("Sect leader exposed as witnesses break their silence");
  await expect(page.getByRole("textbox", { name: "Edition, date & price", exact: true })).toHaveValue("");
  await expect(page.locator(".newspaper-front-headline")).toHaveText("Sect leader exposed as witnesses break their silence");
  await page.getByRole("textbox", { name: "Story subheading", exact: true }).fill("The guard confirms an inquiry is underway.");
  await page.getByRole("textbox", { name: "Edition, date & price", exact: true }).fill("Vol. IV • 21 Midsummer • 2 cp");
  await expect(page.locator(".newspaper-front-deck")).toHaveText("The guard confirms an inquiry is underway.");
  await expect(page.locator(".newspaper-edition-line")).toHaveText("Vol. IV • 21 Midsummer • 2 cp");
  await page.locator("#header-editor").screenshot({ path: info.outputPath("header-fields.png") });
  await expect(page.getByRole("button", { name: "Use edition text as the story headline" })).toBeHidden();
  await page.getByRole("textbox", { name: "Main story headline", exact: true }).fill("");
  await expect(page.locator(".newspaper-front-headline")).toHaveCount(0);
  await expect(page.locator(".newspaper-nameplate")).toHaveText("The Hidden Light");
});

test("print header comparison for visual review", async ({ page }, info) => {
  const specimens = [];
  for (const newspaperHeader of NEWSPAPER_HEADER_STYLES) {
    await render(page, { style: "newspaper", title: "The Hidden Light", newspaperHeader,
      newspaperHeadline: "Sect leader exposed as witnesses break their silence",
      newspaperDeck: "An inquiry opens after the guard uncovers a secret correspondence.",
      newspaperIssue: "Vol. IV • 21 Midsummer • 2 cp", content });
    specimens.push({ label: NEWSPAPER_HEADER_META[newspaperHeader].label,
      html: await page.locator(".newspaper-front-header").evaluate(node => node.outerHTML) });
  }
  await page.evaluate(specimens => {
    const gallery = document.createElement("main");
    gallery.style.cssText = "display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;padding:24px";
    for (const specimen of specimens) {
      const card = document.createElement("section");
      const label = document.createElement("h2");
      label.textContent = specimen.label;
      label.style.cssText = "font:600 18px 'Segoe UI';color:#ece3c9;margin:0 0 12px";
      const paper = document.createElement("article");
      paper.className = "paper paper-newspaper is-single";
      paper.style.cssText = "width:100%;min-width:0;--font-scale:1";
      paper.innerHTML = specimen.html;
      card.append(label, paper);
      gallery.append(card);
    }
    document.body.replaceChildren(gallery);
  }, specimens);
  await page.screenshot({ path: info.outputPath("print-header-comparison.png"), fullPage: true });
});

for (const newspaperLayout of ["auto", "hero", "column-inset", "gazette-mosaic"] as const) {
  for (let count = 0; count <= 10; count++) {
    test(`ordered picture widths: ${newspaperLayout}, ${count} pictures`, async ({ page }, info) => {
      const story = paragraphs.slice(0, 4).join("\n\n");
      const images = Array.from({ length: count }, (_, index) => ({
        ...picture(index % 2 ? 1 : 0), caption: `Ordered picture ${index + 1}`,
        width: (index % 2 ? "page" : "column") as "page" | "column",
      }));
      await render(page, { style: "newspaper", title: "The Illustrated Gazette", newspaperLayout,
        newspaperHeadline: "The harbor opens its gates", content: story, images });
      const result = await measure(page);
      checkGeometry(result);
      expect(normalize(result.text)).toBe(normalize(story));
      expect(result.images).toHaveLength(count);
      expect(await page.locator(".newspaper-caption").allTextContents()).toEqual(images.map(image => image.caption));
      for (const image of result.images) expect(image.width / image.height).toBeCloseTo(image.ratio, 1);
      for (const slot of await page.locator('[data-image-width="page"]').all()) {
        const bounds = await slot.evaluate(node => ({
          width: node.getBoundingClientRect().width,
          page: node.closest(".newspaper-page-slide")!.getBoundingClientRect().width,
          inColumn: Boolean(node.closest(".newspaper-column")),
        }));
        expect(bounds.inColumn).toBe(false);
        expect(bounds.width).toBeCloseTo(bounds.page, 0);
      }
      for (const slot of await page.locator('[data-image-width="column"]').all()) {
        expect(await slot.evaluate(node => {
          const col = node.closest(".newspaper-column");
          return Boolean(col) && node.getBoundingClientRect().width <= col!.getBoundingClientRect().width + 1;
        })).toBe(true);
      }
      if (count === 4) {
        await page.evaluate(() => window.newspaperTest.goTo(0));
        await page.locator(".paper").screenshot({ path: info.outputPath("mixed-picture-widths.png") });
      }
    });
  }
}

test("picture editor reorders whole records and saves width choices", async ({ page }, info) => {
  const images = [picture(0), picture(1), picture(2)];
  await page.evaluate(async images => {
    const { createNewspaperImageManager } = await import("../../src/newspaperImageManager.ts");
    const doc: LootDocument = { style: "newspaper", title: "The Gazette", content: "The harbor opens.\n\nWitnesses gather.\n\nThe report continues.", images };
    const wrap = document.createElement("div");
    wrap.id = "picture-editor";
    wrap.style.cssText = "width:620px;padding:12px;background:#1d150c";
    const update = () => window.newspaperTest.render(JSON.parse(JSON.stringify(doc)));
    wrap.append(createNewspaperImageManager(doc, update));
    document.body.prepend(wrap);
    update();
  }, images);
  await expect(page.getByRole("button", { name: "Move picture 1 earlier" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Move picture 3 later" })).toBeDisabled();
  await page.getByRole("combobox", { name: "Picture 2 width", exact: true }).selectOption("page");
  await page.getByRole("button", { name: "Move picture 2 earlier" }).click();
  await expect(page.getByRole("textbox", { name: "Picture 1 caption", exact: true })).toHaveValue("Archive illustration 2");
  await expect(page.getByRole("combobox", { name: "Picture 1 width", exact: true })).toHaveValue("page");
  await page.getByRole("combobox", { name: "Picture 2 width", exact: true }).selectOption("column");
  await page.getByRole("button", { name: "Move picture 2 later" }).click();
  await page.evaluate(() => window.newspaperTest.settle());
  await expect(page.getByRole("textbox", { name: "Picture 3 caption", exact: true })).toHaveValue("Archive illustration 1");
  await expect(page.getByRole("combobox", { name: "Picture 3 width", exact: true })).toHaveValue("column");
  expect(await page.locator(".newspaper-caption").allTextContents()).toEqual(["Archive illustration 2", "Archive illustration 3", "Archive illustration 1"]);
  await page.locator("#picture-editor").screenshot({ path: info.outputPath("picture-controls.png") });
});

test("full-width inline pictures keep story anchors, captions, and order through resize", async ({ page }) => {
  const image = picture(1);
  const intro = paragraphs[0];
  const middle = paragraphs[1];
  const ending = paragraphs[2];
  await render(page, { style: "newspaper", title: "The Gazette",
    content: `${intro}\n\n![Across the whole page|engraving|page](${image.url})\n\n${middle}\n\n![Inside a column|column](${image.url})\n\n${ending}` });
  for (const [width, scale] of [[1280, 1], [880, 1.4], [1440, 1]]) {
    await page.setViewportSize({ width, height: 1100 });
    await page.evaluate(scale => window.newspaperTest.prefs(scale), scale);
    await page.evaluate(() => window.newspaperTest.settle());
    const result = await measure(page);
    checkGeometry(result);
    expect(normalize(result.text)).toBe(normalize([intro, middle, ending].join(" ")));
    expect(result.images).toHaveLength(2);
    const blocks = await page.locator("[data-story-block]").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-story-block")));
    expect(blocks).toEqual([...blocks].sort());
    await expect(page.locator(".newspaper-slot-page .newspaper-print-engraving")).toHaveCount(1);
  }
});

for (const newspaperLayout of ["auto", "hero", "column-inset", "gazette-mosaic"] as const) {
  test(`full-width picture edge cases: ${newspaperLayout}`, async ({ page }) => {
    const images = Array.from({ length: 10 }, (_, i) => ({ ...picture(i), caption: `Wide photograph ${i}`, width: "page" as const }));
    await page.setViewportSize({ width: 880, height: 1100 });
    await render(page, { style: "newspaper", title: "The Illustrated Review", newspaperLayout,
      newspaperHeadline: "A long headline introducing a collection of ten archive photographs",
      newspaperDeck: "Every illustration keeps its place in this special edition.",
      content: "The complete story.", images });
    await page.evaluate(() => window.newspaperTest.prefs(1.4));
    await page.evaluate(() => window.newspaperTest.settle());
    const result = await measure(page);
    checkGeometry(result);
    expect(normalize(result.text)).toBe("The complete story.");
    expect(result.images).toHaveLength(10);
    expect(await page.locator(".newspaper-caption").allTextContents()).toEqual(images.map(image => image.caption));
    for (const image of result.images) expect(image.width / image.height).toBeCloseTo(image.ratio, 1);
  });
}

test("default hero pictures cannot jump ahead of a picture set to column width", async ({ page }) => {
  const images = [{ ...picture(0), width: "column" as const }, picture(1), picture(2)];
  await render(page, { style: "newspaper", title: "Gazette", newspaperLayout: "hero", images, content });
  const result = await measure(page);
  checkGeometry(result);
  expect(await page.locator(".newspaper-caption").allTextContents()).toEqual(images.map(image => image.caption));
  await expect(page.locator(".newspaper-slot-hero")).toHaveCount(0);
  await expect(page.locator(".newspaper-lead-band")).toHaveCount(1);
});

test("reordered pictures retain their sequence across explicit story breaks", async ({ page }) => {
  const images = Array.from({ length: 7 }, (_, i) => ({ ...picture(i), caption: `Attachment ${i}`,
    width: (i % 2 ? "column" : "page") as "column" | "page" })).reverse();
  await render(page, { style: "newspaper", title: "Gazette", images,
    content: "First story.\n\n---\n\nSecond story.\n\n---\n\nThird story." });
  const result = await measure(page);
  checkGeometry(result);
  expect(normalize(result.text)).toBe("First story. Second story. Third story.");
  expect(await page.locator(".newspaper-caption").allTextContents()).toEqual(images.map(image => image.caption));
});

test("a full-width picture can sit between two text regions on the same page", async ({ page }, info) => {
  const image = picture(1);
  const intro = "Witnesses gathered along the harbor as the gates opened. The first ships sailed beneath the bridge while the city watch recorded their arrival.";
  const ending = "The council has promised to reopen the market tomorrow. Traders expect a busy season, with more vessels due to arrive before the end of the week.";
  await render(page, { style: "newspaper", title: "The Illustrated Gazette", newspaperHeadline: "A new dawn at the harbor",
    content: `${intro}\n\n![The harbor at first light|page](${image.url})\n\n${ending}` });
  const result = await measure(page);
  checkGeometry(result);
  expect(result.pageCount).toBe(1);
  expect(normalize(result.text)).toBe(`${intro} ${ending}`);
  const order = await page.locator(".newspaper-content-area").evaluate(node => Array.from(node.children).map(child => child.className));
  expect(order).toEqual(["newspaper-reading-region", "newspaper-slot newspaper-slot-page", "newspaper-reading-region"]);
  const imageWidth = result.images[0].width;
  const sheet = (await page.locator(".newspaper-page-slide").boundingBox())!;
  expect(imageWidth / sheet.width).toBeGreaterThan(.9);
  await page.locator(".paper").screenshot({ path: info.outputPath("full-width-story-picture.png") });
});
