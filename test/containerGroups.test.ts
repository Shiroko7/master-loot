import test from "node:test";
import assert from "node:assert/strict";
import { groupContainers, newGroupName, readGroups, type ContainerGroup } from "../src/containerGroups.ts";

const group = (id: string, tokens: string[], name = id): ContainerGroup => ({ id, name, tokens });

test("saved groups are read defensively", () => {
  assert.deepEqual(readGroups(undefined), []);
  assert.deepEqual(readGroups({ id: "a" }), []);
  assert.deepEqual(
    readGroups([null, { id: "a", name: "A", tokens: ["x", 3, "y"] }, { id: "a", name: "Dup" }, { name: "No id" }, { id: "b", name: "B" }]),
    [group("a", ["x", "y"], "A"), group("b", [], "B")],
  );
});

test("containers keep the group's order; the rest stay ungrouped in panel order", () => {
  const layout = groupContainers(["a", "b", "c", "d", "e"], [group("g1", ["d", "b"]), group("g2", [])]);
  assert.deepEqual(layout.ungrouped, ["a", "c", "e"]);
  assert.deepEqual(layout.groups.map((entry) => [entry.group.id, entry.tokens]), [["g1", ["d", "b"]], ["g2", []]]);
});

test("stale ids are skipped and a token shows in its first group only", () => {
  const layout = groupContainers(["a", "b"], [group("g1", ["gone", "a"]), group("g2", ["a", "b", "b"])]);
  assert.deepEqual(layout.ungrouped, []);
  assert.deepEqual(layout.groups.map((entry) => entry.tokens), [["a"], ["b"]]);
});

test("new groups get a free name", () => {
  assert.equal(newGroupName([]), "New group");
  assert.equal(newGroupName([group("1", [], "New group"), group("2", [], "New group 2")]), "New group 3");
});
