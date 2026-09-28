/**
 * Emoji picker for loot icons: a button showing the current emoji that
 * opens a searchable, categorised grid of fantasy-loot emoji. A "Custom"
 * field still accepts any emoji typed or pasted, so nothing is lost for
 * people who want one outside the list. Built with textContent only.
 */

type Entry = [emoji: string, keywords: string];

const CATEGORIES: { name: string; entries: Entry[] }[] = [
  {
    name: "Weapons & armor",
    entries: [
      ["⚔️", "swords weapon blade crossed"],
      ["🗡️", "dagger knife blade weapon"],
      ["🏹", "bow arrow ranged weapon"],
      ["🪓", "axe weapon wood"],
      ["🔨", "hammer mace weapon tool"],
      ["⛏️", "pick pickaxe mining"],
      ["🔱", "trident spear weapon"],
      ["🪃", "boomerang throw"],
      ["🛡️", "shield armor defense"],
      ["🪖", "helmet armor"],
      ["🥾", "boots armor feet"],
      ["🧤", "gloves gauntlets hands"],
      ["🦺", "vest armor breastplate chainmail mail cuirass"],
      ["🥋", "gi armor padded leather robe monk"],
      ["🤺", "fencer knight armor plate duel"],
      ["🦾", "gauntlet armor plate vambrace arm"],
      ["⛑️", "helm helmet armor"],
      ["🧥", "cloak coat cape"],
      ["👘", "robe kimono vestment"],
      ["🔫", "gun pistol firearm"],
      ["💣", "bomb explosive"],
      ["🧨", "dynamite explosive firework"],
      ["⛓️", "chain chains shackles"],
    ],
  },
  {
    name: "Magic & potions",
    entries: [
      ["🪄", "wand magic spell"],
      ["🧪", "potion flask vial alchemy"],
      ["⚗️", "alembic alchemy potion"],
      ["🔮", "crystal ball orb divination"],
      ["✨", "sparkles magic glitter"],
      ["🌟", "star glowing magic"],
      ["🔥", "fire flame burn"],
      ["❄️", "ice frost cold snow"],
      ["⚡", "lightning thunder shock"],
      ["🌙", "moon night lunar"],
      ["☀️", "sun light day"],
      ["💀", "skull death necromancy"],
      ["🦴", "bone bones remains"],
      ["🕯️", "candle light ritual"],
      ["🧿", "amulet eye ward protection"],
      ["🪬", "hamsa amulet charm ward"],
      ["📿", "prayer beads holy rosary"],
      ["🩸", "blood drop"],
      ["☠️", "poison skull crossbones death"],
      ["🌀", "portal vortex swirl"],
      ["💫", "dizzy star magic spell"],
      ["☄️", "comet meteor fire"],
      ["🌑", "new moon dark shadow eclipse"],
      ["🌈", "rainbow prismatic"],
      ["🌪️", "tornado whirlwind storm air"],
      ["🌊", "wave water sea"],
      ["💧", "drop water tear"],
      ["🫧", "bubbles water"],
      ["👁️", "eye beholder sight scrying"],
      ["🧠", "brain mind psychic"],
      ["🫀", "heart anatomical organ"],
      ["🦷", "tooth fang"],
      ["🕸️", "web spider cobweb"],
      ["🔯", "hexagram star arcane"],
      ["☯️", "yin yang balance"],
      ["🪦", "tombstone grave headstone"],
      ["⚰️", "coffin vampire death"],
    ],
  },
  {
    name: "Treasure",
    entries: [
      ["💰", "money bag gold coins treasure"],
      ["🪙", "coin gold money"],
      ["💎", "gem diamond jewel"],
      ["💍", "ring jewel"],
      ["👑", "crown king queen royal"],
      ["🏆", "trophy cup chalice prize"],
      ["🏺", "urn amphora vase"],
      ["🗝️", "key old skeleton"],
      ["🔑", "key"],
      ["📦", "box crate chest"],
      ["🧰", "toolbox chest box"],
      ["🎁", "gift present box"],
      ["🪞", "mirror"],
      ["⚱️", "urn funeral ashes"],
      ["🔔", "bell"],
      ["🎖️", "medal badge honor"],
      ["⚜️", "fleur de lis heraldry crest noble"],
      ["🐚", "shell conch sea"],
      ["🦪", "pearl oyster"],
      ["🪷", "lotus flower sacred"],
      ["🗿", "statue idol head moai"],
      ["🪨", "rock stone ore"],
      ["🔗", "link chain"],
    ],
  },
  {
    name: "Documents",
    entries: [
      ["📜", "scroll parchment document"],
      ["✉️", "letter envelope mail"],
      ["📕", "book red tome"],
      ["📖", "book open journal"],
      ["📘", "book blue tome"],
      ["📗", "book green tome"],
      ["📚", "books library"],
      ["📓", "notebook journal diary"],
      ["📔", "notebook decorated diary"],
      ["📰", "newspaper news"],
      ["🗺️", "map world treasure"],
      ["🖋️", "pen quill ink"],
      ["✒️", "nib pen ink"],
      ["🪪", "id card identity papers"],
      ["🏷️", "tag label"],
      ["📌", "pin notice"],
      ["📃", "page parchment document"],
      ["🧾", "receipt contract bill"],
    ],
  },
  {
    name: "Gear & tools",
    entries: [
      ["🎒", "backpack bag pack"],
      ["👝", "pouch bag purse"],
      ["🧭", "compass navigation"],
      ["🔦", "torch flashlight light"],
      ["🏮", "lantern light"],
      ["🪢", "rope knot"],
      ["🪜", "ladder"],
      ["🔧", "wrench tool"],
      ["🪚", "saw tool"],
      ["🧵", "thread sewing"],
      ["🪡", "needle sewing"],
      ["⚖️", "scales balance justice"],
      ["⏳", "hourglass time"],
      ["🔭", "telescope spyglass"],
      ["🔒", "lock padlock"],
      ["🧲", "magnet"],
      ["🎲", "dice game"],
      ["🃏", "card joker game"],
      ["🎻", "violin fiddle instrument music"],
      ["🪕", "banjo lute instrument music"],
      ["🥁", "drum instrument music"],
      ["📯", "horn instrument"],
      ["⚓", "anchor ship"],
      ["⛺", "tent camp"],
      ["🪔", "oil lamp diya light"],
      ["🧹", "broom witch sweep"],
      ["🪤", "trap snare"],
      ["🪝", "hook grapple"],
      ["🧺", "basket"],
      ["🪣", "bucket pail"],
      ["🛢️", "barrel keg"],
      ["🫖", "teapot kettle"],
      ["🕰️", "clock time"],
      ["🪵", "wood log timber"],
      ["🧱", "brick stone"],
      ["🛶", "canoe boat"],
    ],
  },
  {
    name: "Food & drink",
    entries: [
      ["🍺", "beer ale tankard drink"],
      ["🍷", "wine drink"],
      ["🍶", "sake bottle drink"],
      ["🍾", "bottle champagne"],
      ["🥩", "meat steak food"],
      ["🍖", "meat bone food"],
      ["🍗", "chicken leg food"],
      ["🍞", "bread food"],
      ["🧀", "cheese food"],
      ["🍎", "apple fruit food"],
      ["🍄", "mushroom fungus"],
      ["🍯", "honey pot"],
      ["🧂", "salt"],
      ["🐟", "fish food"],
      ["🥚", "egg"],
      ["🌿", "herb plant leaf"],
      ["🌾", "grain wheat"],
      ["🌹", "rose flower"],
      ["🍇", "grapes fruit"],
      ["🌰", "chestnut nut acorn"],
      ["🍀", "clover luck four leaf"],
      ["🌱", "sprout seed plant"],
      ["🥀", "wilted rose flower dead"],
      ["🪻", "hyacinth flower herb"],
    ],
  },
  {
    name: "Creatures",
    entries: [
      ["🐉", "dragon"],
      ["🐲", "dragon face"],
      ["🦄", "unicorn"],
      ["🐺", "wolf"],
      ["🐍", "snake serpent"],
      ["🕷️", "spider"],
      ["🦇", "bat"],
      ["🦉", "owl"],
      ["🐦‍⬛", "raven crow bird"],
      ["🐴", "horse steed"],
      ["🐈‍⬛", "cat black"],
      ["👻", "ghost spirit"],
      ["🧟", "zombie undead"],
      ["🧙", "wizard mage"],
      ["🧝", "elf"],
      ["👹", "ogre demon oni"],
      ["🪶", "feather"],
      ["🧚", "fairy fey pixie"],
      ["🧞", "genie djinn"],
      ["🧛", "vampire undead"],
      ["🧜", "merfolk mermaid"],
      ["🧌", "troll"],
      ["👺", "goblin tengu demon"],
      ["🐙", "octopus kraken"],
      ["🦑", "squid kraken"],
      ["🦂", "scorpion"],
      ["🦅", "eagle griffon bird"],
      ["🐗", "boar"],
      ["🦌", "stag deer"],
      ["🐻", "bear"],
      ["🐀", "rat"],
      ["🐸", "frog toad"],
      ["🪲", "beetle bug"],
      ["🥚", "egg dragon"],
    ],
  },
];

const ALL: Entry[] = CATEGORIES.flatMap((c) => c.entries);
const RECENT_KEY = "master-loot:recent-emoji";
const RECENT_MAX = 12;

function readRecent(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((e) => typeof e === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

function pushRecent(emoji: string): void {
  try {
    const list = [emoji, ...readRecent().filter((e) => e !== emoji)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // Convenience only.
  }
}

/** Only one picker panel is open at a time. */
let closeOpenPanel: (() => void) | null = null;

export interface EmojiPicker {
  el: HTMLElement;
  /** Current value. */
  get value(): string;
  set value(emoji: string);
}

export function createEmojiPicker(
  initial: string,
  onChange: (emoji: string) => void,
  options: { label?: string } = {},
): EmojiPicker {
  let value = initial;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "emoji-picker-button";
  button.ariaLabel = options.label ?? "Choose icon";
  button.title = "Choose an icon";
  button.ariaHasPopup = "dialog";
  const face = document.createElement("span");
  face.className = "emoji-picker-face";
  const caret = document.createElement("span");
  caret.className = "emoji-picker-caret";
  caret.textContent = "▾";
  button.append(face, caret);

  const render = () => {
    face.textContent = value || "❔";
  };
  render();

  const choose = (emoji: string) => {
    value = emoji;
    render();
    pushRecent(emoji);
    onChange(emoji);
  };

  const open = () => {
    closeOpenPanel?.();
    const panel = document.createElement("div");
    panel.className = "emoji-panel";
    panel.setAttribute("role", "dialog");
    panel.ariaLabel = "Choose an icon";

    const search = document.createElement("input");
    search.type = "search";
    search.className = "emoji-search";
    search.placeholder = "Search: sword, potion, key…";

    const body = document.createElement("div");
    body.className = "emoji-panel-body";

    const cell = (emoji: string, hint: string) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "emoji-cell";
      if (emoji === value) b.classList.add("selected");
      b.textContent = emoji;
      b.title = hint;
      b.onclick = () => {
        choose(emoji);
        close();
      };
      return b;
    };

    const section = (title: string, entries: Entry[]) => {
      if (entries.length === 0) return;
      const heading = document.createElement("div");
      heading.className = "emoji-section-title";
      heading.textContent = title;
      const grid = document.createElement("div");
      grid.className = "emoji-grid";
      for (const [emoji, words] of entries) grid.append(cell(emoji, words.split(" ")[0]));
      body.append(heading, grid);
    };

    const fill = () => {
      body.textContent = "";
      const query = search.value.trim().toLowerCase();
      if (query) {
        const seen = new Set<string>();
        const hits = ALL.filter(([emoji, words]) => {
          if (seen.has(emoji) || !words.includes(query)) return false;
          seen.add(emoji);
          return true;
        });
        if (hits.length) section("Results", hits);
        else {
          const none = document.createElement("div");
          none.className = "emoji-empty";
          none.textContent = "No match. Type or paste any emoji in Custom below.";
          body.append(none);
        }
        return;
      }
      const recent = readRecent();
      if (recent.length) {
        section("Recent", recent.map((e) => [e, ALL.find(([x]) => x === e)?.[1] ?? "recent"] as Entry));
      }
      for (const category of CATEGORIES) section(category.name, category.entries);
    };
    search.oninput = fill;

    const custom = document.createElement("div");
    custom.className = "emoji-custom";
    const customLabel = document.createElement("span");
    customLabel.textContent = "Custom";
    const customInput = document.createElement("input");
    customInput.maxLength = 8;
    customInput.placeholder = "Any emoji";
    customInput.value = value;
    const customOk = document.createElement("button");
    customOk.type = "button";
    customOk.className = "btn btn-xs";
    customOk.textContent = "Use";
    const useCustom = () => {
      const emoji = customInput.value.trim();
      if (!emoji) return;
      choose(emoji);
      close();
    };
    customOk.onclick = useCustom;
    customInput.onkeydown = (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        useCustom();
      }
    };
    custom.append(customLabel, customInput, customOk);

    panel.append(search, body, custom);
    document.body.append(panel);
    fill();

    // Place under the button, kept inside the window.
    const place = () => {
      const r = button.getBoundingClientRect();
      const w = panel.offsetWidth;
      const h = panel.offsetHeight;
      let left = Math.min(r.left, window.innerWidth - w - 8);
      left = Math.max(8, left);
      let top = r.bottom + 4;
      if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 4);
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
    };
    place();

    const onDown = (event: PointerEvent) => {
      const t = event.target as Node;
      if (!panel.contains(t) && !button.contains(t)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
        button.focus();
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", place);

    function close(): void {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", place);
      panel.remove();
      button.ariaExpanded = "false";
      if (closeOpenPanel === close) closeOpenPanel = null;
    }
    closeOpenPanel = close;
    button.ariaExpanded = "true";
    search.focus();
  };

  button.onclick = () => {
    if (button.ariaExpanded === "true") closeOpenPanel?.();
    else open();
  };

  return {
    el: button,
    get value() {
      return value;
    },
    set value(emoji: string) {
      value = emoji;
      render();
    },
  };
}
