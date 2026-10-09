/**
 * Groups of loot containers in the GM's Loot panel ("Bandit camp", "Town
 * NPCs"…), so a busy scene can be filed away and collapsed. Groups are saved
 * in scene metadata; which ones are collapsed is each GM's own view and
 * stays in their browser.
 */

export interface ContainerGroup {
  /** Stable across renames, so collapsed state survives them. */
  id: string;
  name: string;
  /** Token ids, in display order. */
  tokens: string[];
}

/** Collapsed-state id of the section holding containers in no group. */
export const UNGROUPED_ID = "~ungrouped";

export interface GroupedContainers {
  ungrouped: string[];
  groups: { group: ContainerGroup; tokens: string[] }[];
}

/** Reads saved groups, dropping anything malformed. */
export function readGroups(raw: unknown): ContainerGroup[] {
  if (!Array.isArray(raw)) return [];
  const groups: ContainerGroup[] = [];
  const seen = new Set<string>();
  for (const entry of raw as Partial<ContainerGroup>[]) {
    if (!entry || typeof entry.id !== "string" || typeof entry.name !== "string") continue;
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    groups.push({
      id: entry.id,
      name: entry.name,
      tokens: Array.isArray(entry.tokens)
        ? entry.tokens.filter((id): id is string => typeof id === "string")
        : [],
    });
  }
  return groups;
}

/**
 * Sorts the scene's containers (`ordered`, already in display order) into
 * their groups. Group members keep the group's own order; ids saved in a
 * group that no longer have loot are skipped, and a token listed in two
 * groups shows in the first only.
 */
export function groupContainers(
  ordered: string[],
  groups: ContainerGroup[],
): GroupedContainers {
  const present = new Set(ordered);
  const placed = new Set<string>();
  const sections = groups.map((group) => {
    const tokens = group.tokens.filter((id) => {
      if (!present.has(id) || placed.has(id)) return false;
      placed.add(id);
      return true;
    });
    return { group, tokens };
  });
  return {
    ungrouped: ordered.filter((id) => !placed.has(id)),
    groups: sections,
  };
}

/** "New group", "New group 2"… whichever is not taken yet. */
export function newGroupName(groups: ContainerGroup[]): string {
  const taken = new Set(groups.map((group) => group.name));
  let name = "New group";
  for (let n = 2; taken.has(name); n++) name = `New group ${n}`;
  return name;
}
