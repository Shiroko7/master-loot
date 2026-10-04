import test from "node:test";
import assert from "node:assert/strict";
import {
  VIEW_EXPIRY_MS, ViewPresenceState, describeViewing, isViewUpdate, readViewingStatus, samePlayerRoster,
  type ViewLocation, type ViewUpdate,
} from "../src/viewPresenceState.ts";

const book: ViewLocation = {
  kind: "document", id: "book", name: "Captain's journal", sourceId: "chest",
  page: 1, lastPage: 1, pageCount: 4,
};
function update(sessionId: string, location: ViewLocation | null, sequence = 1, closed = false): ViewUpdate {
  return { sessionId, location, sequence, hidden: false, closed };
}

test("reader takes precedence over underlying windows and their heartbeats", () => {
  const state = new ViewPresenceState();
  const loot: ViewLocation = { kind: "loot", id: "chest", name: "Chest" };
  state.update(update("loot", loot), 100);
  state.update(update("reader", book), 200);
  state.update(update("loot", loot, 2), 300);
  assert.equal(state.current(300)?.location.kind, "document");
  state.update(update("reader", null, 2, true), 400);
  assert.deepEqual(state.current(400)?.location, loot);
});

test("heartbeats do not steal the latest window at the same priority", () => {
  const state = new ViewPresenceState();
  const loot: ViewLocation = { kind: "loot", id: "chest", name: "Chest" };
  const inventory: ViewLocation = { kind: "inventory", id: "player", name: "Alice" };
  state.update(update("loot", loot), 100);
  state.update(update("inventory", inventory), 200);
  state.update(update("loot", loot, 2), 300);
  assert.equal(state.current(300)?.location.kind, "inventory");
});

test("out-of-order page changes and delayed heartbeats cannot overwrite a close", () => {
  const state = new ViewPresenceState();
  state.update(update("reader", { ...book, page: 3, lastPage: 3 }, 3), 100);
  state.update(update("reader", book, 2), 110);
  assert.equal(state.current(110)?.location.page, 3);
  state.update(update("reader", null, 4, true), 120);
  state.update(update("reader", book, 5), 130);
  assert.equal(state.current(130), undefined);
});

test("an abruptly destroyed reader expires while its underlying window remains live", () => {
  const state = new ViewPresenceState();
  const loot: ViewLocation = { kind: "loot", id: "chest", name: "Chest" };
  state.update(update("reader", book), 100);
  state.update(update("loot", loot), 100 + VIEW_EXPIRY_MS - 1);
  assert.equal(state.current(100 + VIEW_EXPIRY_MS)?.location.kind, "loot");
  assert.equal(state.current(100 + 2 * VIEW_EXPIRY_MS), undefined);
});

test("a missing entry can recover without reopening the iframe", () => {
  const state = new ViewPresenceState();
  state.update(update("reader", book), 100);
  state.update(update("reader", null, 2), 200);
  assert.equal(state.current(200), undefined);
  state.update(update("reader", book, 3), 300);
  assert.deepEqual(state.current(300)?.location, book);
});

test("view messages and expired or malformed metadata are rejected", () => {
  assert.ok(isViewUpdate(update("reader", book)));
  for (const invalid of [null, {}, { ...update("reader", book), sequence: -1 },
    update("reader", { ...book, page: 9 }), { ...update("reader", book), hidden: "yes" },
    update("reader", book, 1, true), update("reader", { ...book, pageCount: NaN })]) {
    assert.equal(isViewUpdate(invalid), false);
  }
  assert.equal(readViewingStatus({ location: book, hidden: false, updatedAt: 100 }, 100 + VIEW_EXPIRY_MS), undefined);
  assert.equal(readViewingStatus({ location: book, hidden: false, updatedAt: NaN }, 100), undefined);
});

test("page ranges, background tabs, and visible endings describe progress without claiming completion", () => {
  const status = { location: { ...book, page: 3, lastPage: 4 }, hidden: true, updatedAt: 100 };
  assert.deepEqual(describeViewing(status), {
    summary: "Reading: Captain's journal · background tab", progress: "Pages 3–4 of 4 · last page",
  });
  assert.equal(describeViewing({ ...status, location: { kind: "document", id: "letter", name: "Letter", atEnd: true } }).progress,
    "End of document visible");
  assert.equal(describeViewing(undefined).summary, "Not viewing anything");
});

test("metadata changes do not count as roster changes", () => {
  const player = { id: "alice", connectionId: "connection", name: "Alice", role: "PLAYER", color: "blue", metadata: {} };
  assert.ok(samePlayerRoster([player], [{ ...player, metadata: { reading: true } }]));
  assert.equal(samePlayerRoster([player], [{ ...player, connectionId: "reconnected" }]), false);
  assert.equal(samePlayerRoster([player], [{ ...player, name: "Alicia" }]), false);
  assert.equal(samePlayerRoster([player], []), false);
});
