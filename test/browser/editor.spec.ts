import { test, expect, type FrameLocator, type Page } from "@playwright/test";

declare global {
  interface Window {
    editorTest: { reload(): void };
  }
}

/** Opens the letter; `reopened` expects the editor to have kept it open. */
async function open(page: Page, reopened = false): Promise<FrameLocator> {
  const editor = page.frameLocator('iframe[title="editor"]');
  if (!reopened) await editor.getByText("Long letter").click();
  await expect(editor.locator("textarea.doc-content")).toBeVisible();
  return editor;
}

/** Scroll both the content box and the pane well down, cursor at line 80. */
async function goDeep(editor: FrameLocator) {
  return editor.locator("textarea.doc-content").evaluate((box: HTMLTextAreaElement) => {
    const at = box.value.indexOf("Line 80 ");
    box.setSelectionRange(at, at);
    box.scrollTop = 900;
    box.dispatchEvent(new Event("scroll"));
    const pane = box.closest<HTMLElement>(".editor-detail")!;
    pane.scrollTop = pane.scrollHeight;
    pane.dispatchEvent(new Event("scroll"));
    return { text: box.scrollTop, pane: pane.scrollTop, at };
  });
}

const place = (editor: FrameLocator) =>
  editor.locator("textarea.doc-content").evaluate((box: HTMLTextAreaElement) => ({
    text: box.scrollTop,
    pane: box.closest<HTMLElement>(".editor-detail")!.scrollTop,
    caret: box.selectionStart,
    value: box.value,
  }));

test.beforeEach(async ({ page }) => {
  await page.goto("/test/browser/editor.html");
  await page.evaluate(() => localStorage.clear());
});

test("a picture from Owlbear goes in at the cursor without jumping to the top", async ({ page }) => {
  const editor = await open(page);
  const before = await goDeep(editor);
  expect(before.text).toBeGreaterThan(0);
  await editor.getByRole("button", { name: /From Owlbear/ }).click();
  await expect.poll(async () => (await place(editor)).value).toContain("](https://example.com/upload.png)");
  const after = await place(editor);
  expect(after.value.indexOf("![](https://example.com/upload.png)")).toBe(before.at + 1);
  expect(after.text).toBeCloseTo(before.text, -1);
  expect(after.pane).toBeCloseTo(before.pane, -1);
});

test("switching tabs and reopening the editor return to the same item and place", async ({ page }) => {
  const editor = await open(page);
  const before = await goDeep(editor);
  await editor.getByRole("button", { name: "Style", exact: true }).click();
  await editor.getByRole("button", { name: "Write", exact: true }).click();
  let after = await place(editor);
  expect(after.text).toBeCloseTo(before.text, -1);
  expect(after.caret).toBe(before.at);
  expect(after.pane).toBeCloseTo(before.pane, -1);

  await page.evaluate(() => window.editorTest.reload());
  await open(page, true);
  await expect.poll(async () => (await place(editor)).text).toBeGreaterThan(before.text - 10);
  after = await place(editor);
  expect(after.caret).toBe(before.at);
  expect(after.pane).toBeCloseTo(before.pane, -1);
});
