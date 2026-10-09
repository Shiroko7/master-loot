import { test, expect, type FrameLocator, type Locator, type Page } from "@playwright/test";
import { GROUPS_KEY, ORDER_KEY } from "../../src/constants";
import type { ContainerGroup } from "../../src/containerGroups";

declare global {
  interface Window {
    groupsTest: { metadata(): Record<string, unknown>; changeScene(): void; reopen(user: string): void };
  }
}

const names = (scope: FrameLocator | Locator) =>
  scope.locator(".container-row:visible .name").allTextContents();
const groups = async (page: Page) =>
  (await page.evaluate(() => window.groupsTest.metadata()))[GROUPS_KEY] as ContainerGroup[];

async function open(page: Page) {
  await page.goto("/test/browser/groups.html");
  const gm = page.frameLocator('iframe[title="gm panel"]');
  await expect(gm.locator(".container-row")).toHaveCount(6);
  return { gm, alice: page.frameLocator('iframe[title="alice panel"]') };
}

async function addGroup(gm: FrameLocator, name: string) {
  await gm.getByRole("button", { name: "📁 + Group" }).click();
  const input = gm.locator(".folder-rename");
  await expect(input).toBeFocused();
  await input.fill(name);
  await input.press("Enter");
  await expect(gm.locator(".folder-label", { hasText: name })).toBeVisible();
}

const section = (gm: FrameLocator, name: string) =>
  gm.locator(".container-group", { has: gm.locator(".folder-label", { hasText: name }) });
const grip = (gm: FrameLocator, name: string) =>
  gm.locator(".container-row", { hasText: name }).locator(".drag-handle");

test("without groups the list is the plain one, with only the add button", async ({ page }) => {
  const { gm } = await open(page);
  await expect(gm.locator(".folder-head")).toHaveCount(0);
  await expect(gm.getByRole("button", { name: "📁 + Group" })).toBeVisible();
  await expect(gm.getByRole("button", { name: /Collapse all/ })).toHaveCount(0);
});

test("containers are filed into groups by dragging, and groups fold away", async ({ page }) => {
  const { gm, alice } = await open(page);
  await addGroup(gm, "Crows");
  await addGroup(gm, "Sect");
  // Naming a group survives unrelated scene changes arriving mid-typing.
  await gm.locator(".folder-label", { hasText: "Sect" }).dblclick();
  await gm.locator(".folder-rename").fill("Sect discip");
  await page.evaluate(() => window.groupsTest.changeScene());
  await expect(gm.locator(".folder-rename")).toHaveValue("Sect discip");
  await gm.locator(".folder-rename").press("Enter");
  await expect(gm.locator(".folder-label", { hasText: "Sect discip" })).toBeVisible();

  await grip(gm, "Messagercrow").dragTo(section(gm, "Crows").locator(".group-rows"));
  await expect(section(gm, "Crows").locator(".folder-count")).toHaveText("1");
  await grip(gm, "Fat Crow").dragTo(section(gm, "Crows").locator(".container-row").first(), {
    targetPosition: { x: 150, y: 4 },
  });
  await expect.poll(() => names(section(gm, "Crows"))).toEqual(["Fat Crow", "Messagercrow"]);
  await expect(section(gm, "Crows").locator(".folder-count")).toHaveText("2");
  await expect(section(gm, "Ungrouped").locator(".folder-count")).toHaveText("4");

  // A collapsed group takes a container dropped on its heading.
  await section(gm, "Sect discip").locator(".folder-head").click();
  await grip(gm, "Zhao Feng").dragTo(section(gm, "Sect discip").locator(".folder-head"));
  await expect(section(gm, "Sect discip").locator(".folder-count")).toHaveText("1");
  await expect(gm.locator(".container-row:visible", { hasText: "Zhao Feng" })).toHaveCount(0);
  expect((await groups(page)).map((group) => [group.name, group.tokens])).toEqual([
    ["Crows", ["fat", "crow"]],
    ["Sect discip", ["zhao"]],
  ]);
  expect((await page.evaluate(() => window.groupsTest.metadata()))[ORDER_KEY]).toHaveLength(6);

  // Fold everything, then open one group; the choice survives reopening the panel.
  await gm.getByRole("button", { name: /Collapse all/ }).click();
  await expect(gm.locator(".container-row:visible")).toHaveCount(0);
  await section(gm, "Crows").locator(".folder-head").click();
  expect(await names(gm)).toEqual(["Fat Crow", "Messagercrow"]);
  await page.evaluate(() => window.groupsTest.reopen("gm"));
  const again = gm;
  await expect(again.getByRole("button", { name: /Collapse all/ })).toBeVisible();
  await expect(again.locator(".folder-head")).toHaveCount(3);
  expect(await names(again)).toEqual(["Fat Crow", "Messagercrow"]);
  await again.getByRole("button", { name: /Collapse all/ }).click();
  await again.getByRole("button", { name: /Expand all/ }).click();
  await expect(again.locator(".container-row:visible")).toHaveCount(6);

  // Players never see the GM's groups: just what is lootable, in the
  // GM's arrangement read top to bottom.
  await expect(alice.locator(".folder-head, .group-toolbar")).toHaveCount(0);
  expect(await names(alice)).toEqual(["Lee Ji-Woo", "Ye Rin", "Messagercrow"]);

  // Dissolving a group keeps its containers.
  await section(again, "Crows").getByTitle("Dissolve group (its containers are kept)").click();
  await expect(again.locator(".folder-label", { hasText: "Crows" })).toHaveCount(0);
  await expect(again.locator(".container-row")).toHaveCount(6);
  await expect(section(again, "Ungrouped").locator(".folder-count")).toHaveText("5");
});
