import { test, expect, type Page } from "@playwright/test";

declare global {
  interface Window {
    presenceTest: {
      open(user: string, doc?: string): void;
      loot(user: string): void;
      inventory(user: string): void;
      inventoryReader(user: string, owner: string, doc: string): void;
      action(user: string): void;
      remove(label: string): void;
      changeScene(): void;
      removeDocument(doc: string): void;
      disconnect(user: string): void;
    };
  }
}
async function prepare(page: Page) {
  await page.goto("/test/browser/presence.html");
  const panel = page.frameLocator('iframe[title="gm panel"]');
  await panel.getByRole("button", { name: "🎒 Players", exact: true }).click();
  await expect(panel.getByText("Alice", { exact: true })).toBeVisible();
  return panel;
}

test("all players' readers report live pages, retain position on scene changes, and clear on close", async ({ page }, testInfo) => {
  const panel = await prepare(page);
  await page.evaluate(() => { window.presenceTest.open("alice"); window.presenceTest.open("bob", "book"); });
  const alice = panel.locator('[data-player-connection-id="alice-connection"]');
  const bob = panel.locator('[data-player-connection-id="bob-connection"]');
  await expect(alice.getByText("Reading: Captain's journal", { exact: true })).toBeVisible();
  await expect(alice.getByText("Page 1 of 3", { exact: true })).toBeVisible();
  await expect(bob.getByText("Page 1 of 3", { exact: true })).toBeVisible();
  const aliceReader = page.frameLocator('iframe[title="alice reader"]');
  await expect(aliceReader.locator(".doc-viewers")).toContainText("Also viewing:");
  await expect(aliceReader.locator('[data-viewer-id="bob"]')).toContainText("Page 1 of 3");
  await page.locator('iframe[title="gm panel"]').screenshot({ path: testInfo.outputPath("players-viewing.png") });
  const reader = aliceReader;
  await reader.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(alice.getByText("Page 2 of 3", { exact: true })).toBeVisible();
  await page.evaluate(() => window.presenceTest.changeScene());
  await expect(reader.locator(".page-nav span")).toHaveText("2 / 3");
  await reader.locator(".doc-page").click();
  await page.keyboard.press("ArrowRight");
  await expect(alice.getByText("Page 3 of 3 · last page", { exact: true })).toBeVisible();
  await page.frameLocator('iframe[title="bob reader"]').getByRole("button", { name: "Next page", exact: true }).click();
  await expect(bob.getByText("Page 2 of 3", { exact: true })).toBeVisible();
  await expect(reader.locator('[data-viewer-id="bob"]')).toContainText("Page 2 of 3");
  await reader.getByRole("button", { name: "Close", exact: true }).click();
  await expect(alice.getByText("Not viewing anything", { exact: true })).toBeVisible();
  await page.evaluate(() => window.presenceTest.disconnect("bob"));
  await expect(bob).toHaveCount(0);
});

test("pictures and ID cards report their viewers, and removing the viewed item clears presence", async ({ page }) => {
  const panel = await prepare(page);
  await page.evaluate(() => { window.presenceTest.open("alice", "portrait"); window.presenceTest.open("bob", "card"); });
  const alice = panel.locator('[data-player-connection-id="alice-connection"]');
  const bob = panel.locator('[data-player-connection-id="bob-connection"]');
  await expect(alice.getByText("Viewing: Captain's portrait", { exact: true })).toBeVisible();
  await expect(bob.getByText("Viewing: Guild papers", { exact: true })).toBeVisible();
  await page.evaluate(() => window.presenceTest.removeDocument("card"));
  await expect(bob.getByText("Not viewing anything", { exact: true })).toBeVisible();
});

test("text resizing reports the reader's actual page count", async ({ page }) => {
  const panel = await prepare(page);
  await page.evaluate(() => window.presenceTest.open("alice", "long-book"));
  const reader = page.frameLocator('iframe[title="alice reader"]');
  const progress = panel.locator('[data-player-connection-id="alice-connection"] .player-reading-progress');
  await expect(progress).toContainText("Page 1 of");
  const before = Number((await reader.locator(".page-nav span").textContent())!.split("/")[1]);
  await reader.getByRole("button", { name: "Larger text", exact: true }).click();
  await reader.getByRole("button", { name: "Larger text", exact: true }).click();
  await expect.poll(async () => Number((await reader.locator(".page-nav span").textContent())!.split("/")[1])).toBeGreaterThan(before);
  const total = Number((await reader.locator(".page-nav span").textContent())!.split("/")[1]);
  await expect(progress).toHaveText(`Page 1 of ${total}`);
});

test("presence updates preserve focused inventory inputs", async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => window.presenceTest.inventory("bob"));
  const inventory = page.frameLocator('iframe[title="bob inventory"]');
  const search = inventory.getByPlaceholder("🔍 Search items, tags, notes…");
  await expect(search).toBeVisible();
  await search.focus();
  await page.evaluate(() => window.presenceTest.open("alice"));
  await expect(page.frameLocator('iframe[title="gm panel"]').getByText("Reading: Captain's journal", { exact: true })).toBeVisible();
  await expect(search).toBeFocused();
  await expect(page.frameLocator('iframe[title="gm panel"]').getByText("Viewing inventory: Bob", { exact: true })).toBeVisible();
});

test("an abruptly closed iframe expires without requiring a close message", async ({ page }) => {
  const panel = await prepare(page);
  await page.clock.install();
  await page.evaluate(() => window.presenceTest.open("alice"));
  const alice = panel.locator('[data-player-connection-id="alice-connection"]');
  await expect(alice.getByText("Reading: Captain's journal", { exact: true })).toBeVisible();
  await page.evaluate(() => window.presenceTest.remove("alice reader"));
  await page.clock.runFor(25_000);
  await expect(alice.getByText("Not viewing anything", { exact: true })).toBeVisible();
});

test("background visibility is shared and returning to the reader clears the marker", async ({ page }) => {
  const panel = await prepare(page);
  await page.evaluate(() => window.presenceTest.open("alice"));
  const reader = page.frameLocator('iframe[title="alice reader"]');
  const alice = panel.locator('[data-player-connection-id="alice-connection"]');
  await expect(alice.getByText("Reading: Captain's journal", { exact: true })).toBeVisible();
  await reader.locator("body").evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(alice.getByText("Reading: Captain's journal · background tab", { exact: true })).toBeVisible();
  await reader.locator("body").evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(alice.getByText("Reading: Captain's journal", { exact: true })).toBeVisible();
});

test("late panels receive current presence and closing a reader restores the underlying loot view", async ({ page }) => {
  const panel = await prepare(page);
  const alice = panel.locator('[data-player-connection-id="alice-connection"]');
  await page.evaluate(() => window.presenceTest.loot("alice"));
  await expect(alice.getByText("Browsing loot: Captain's chest", { exact: true })).toBeVisible();
  await page.evaluate(() => window.presenceTest.open("alice"));
  await expect(alice.getByText("Reading: Captain's journal", { exact: true })).toBeVisible();
  await page.evaluate(() => window.presenceTest.action("bob"));
  const otherPanel = page.frameLocator('iframe[title="bob panel"]');
  await otherPanel.getByRole("button", { name: "🎒 Players", exact: true }).click();
  await expect(otherPanel.getByText("Reading: Captain's journal", { exact: true })).toBeVisible();
  await page.frameLocator('iframe[title="alice reader"]').getByRole("button", { name: "Close", exact: true }).click();
  await expect(alice.getByText("Browsing loot: Captain's chest", { exact: true })).toBeVisible();
});

test("continuous documents report the visible end and stop reporting it when scrolled back", async ({ page }) => {
  const panel = await prepare(page);
  await page.evaluate(() => window.presenceTest.open("alice", "letter"));
  const alice = panel.locator('[data-player-connection-id="alice-connection"]');
  const reader = page.frameLocator('iframe[title="alice reader"]');
  await expect(alice.getByText("Reading: Long letter", { exact: true })).toBeVisible();
  await expect(alice.locator(".player-reading-progress")).toBeHidden();
  await reader.locator(".doc-scroll").evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(alice.getByText("End of document visible", { exact: true })).toBeVisible();
  await reader.locator(".doc-scroll").evaluate((el) => { el.scrollTop = 0; });
  await expect(alice.locator(".player-reading-progress")).toBeHidden();
});

test("the reader's same-document list excludes unrelated documents", async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => { window.presenceTest.open("alice", "book"); window.presenceTest.open("bob", "letter"); });
  const reader = page.frameLocator('iframe[title="alice reader"]');
  await expect(reader.locator(".doc-viewers")).toBeHidden();
});
