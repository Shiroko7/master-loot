import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { packLoot, packValue, unpackLoot, unpackValue } from "../src/metadataCodec.ts";
import type { LootContainer } from "../src/types.ts";

// Real, non-repetitive prose so the measured ratio is honest.
const letter = readFileSync(new URL("../README.md", import.meta.url), "utf8").slice(0, 8_000);

function sample(): LootContainer {
  return {
    enabled: true,
    takeable: false,
    name: "Smuggler's chest",
    folders: ["Letters"],
    updatedAt: 1_780_000_000_000,
    items: [
      {
        id: "3f1c2b1e-8a4d-4c55-9f7e-2a8b6d0c1e11",
        kind: "document",
        name: "Coded letter",
        quantity: 1,
        rarity: "none",
        icon: "✉️",
        folder: "Letters",
        description: "",
        document: { style: "letter", title: "To the Captain", content: letter, font: "caveat" },
      },
      {
        id: "a1",
        kind: "currency",
        name: "Coins",
        quantity: 1,
        rarity: "none",
        icon: "🪙",
        coins: { gp: 12, sp: 0 },
      },
      { id: "b2", kind: "idcard", name: "Papers", quantity: 1, rarity: "none", icon: "🪪", profile: {} },
      { id: "c3", kind: "item", name: "Dagger", quantity: 2, rarity: "rare", icon: "🗡️" },
    ],
  };
}

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

test("packLoot round-trips and restores defaults", () => {
  const loot = sample();
  const restored = unpackLoot(packLoot(loot))!;
  assert.equal(restored.items[0].document!.content, letter);
  assert.equal(restored.items[0].quantity, 1);
  assert.equal(restored.items[0].rarity, "none");
  assert.equal(restored.items[3].quantity, 2);
  assert.equal(restored.items[3].kind, "item");
  assert.deepEqual(restored.items[1].coins, { gp: 12, sp: 0 });
  assert.deepEqual(restored.items[2].profile, {});
  assert.equal(restored.takeable, false);
  assert.equal(restored.enabled, true);
  assert.deepEqual(restored.folders, ["Letters"]);
});

test("packLoot is much smaller than plain JSON", () => {
  const loot = sample();
  const plain = bytes(loot);
  const packed = bytes(packLoot(loot));
  console.log(`plain ${plain} B -> packed ${packed} B (${Math.round((packed / plain) * 100)}%)`);
  assert.ok(packed < plain * 0.7);
});

test("unpackLoot reads legacy plain containers and returns editable copies", () => {
  const legacy = sample();
  const a = unpackLoot(legacy)!;
  a.items.push({ id: "x", kind: "item", name: "New", quantity: 1, rarity: "none", icon: "" });
  const b = unpackLoot(legacy)!;
  assert.equal(b.items.length, 4);
  const packed = packLoot(legacy);
  unpackLoot(packed)!.items.length = 0;
  assert.equal(unpackLoot(packed)!.items.length, 4);
});

test("small values stay plain when compression doesn't help", () => {
  assert.deepEqual(packValue([]), []);
  assert.deepEqual(unpackValue(packValue({ a: 1 })), { a: 1 });
  assert.equal(unpackLoot({ nope: true }), undefined);
  assert.equal(unpackLoot("z1garbage"), undefined);
});
