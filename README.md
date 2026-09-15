# Master Loot

An [Owlbear Rodeo](https://www.owlbear.rodeo) extension for WoW-style looting with a
focus on **immersive written loot** — letters, scrolls, books and journals rendered on
aged paper with handwritten fonts, so your players never have to leave the VTT to read
a handout.

## How it works

- **GM**: right-click any token (a fallen enemy, a chest, a bookshelf…) → **Loot**.
  Fill it with items and documents, then flip on **Lootable**.
- Items can be grouped into **folders** (e.g. civil letters / official letters /
  log books): **+ Folder** creates one, then drag & drop items onto its header
  to file them (drag onto empty list space to un-file). Double-click or ✎
  renames, ✕ dissolves a folder while keeping its items. Players see the same
  collapsible sections in the loot popup; empty folders stay GM-only.
- **5e.tools import**: paste an item link (e.g.
  `https://5e.tools/items.html#armor%20of%20invulnerability_xdmg`) into the editor's
  import box. The item is fetched, cleaned of 5etools markup and shown as a preview —
  accept it and it lands in the loot with name, rarity, icon, a readable description
  and the original link (shown to players under the description).
- **Coins**: **+ Coins** adds a currency item with explicit platinum / gold /
  electrum / silver / copper amounts (D&D 5e rates: 1 pp = 10 gp, 1 gp = 10 sp,
  1 ep = 5 sp, 1 sp = 10 cp). Players click the coins to see the breakdown and
  a live **“Worth in …”** converter — e.g. what that heap of copper and silver
  is worth in gold. The same converter sits in the editor while you type
  amounts.
- **ID cards**: **+ ID Card** adds identification papers — a minimalistic
  parchment credential with portrait, name, occupation, rank, affiliation
  (guild, sect, order…), ancestry, sex, age, marital status, hometown,
  issuing authority and clerk's notes. Every field is optional and only appears when filled in,
  so the same card works for a western guild charter or an eastern sect
  registry. The editor shows a live preview; players click the card to
  inspect it.
- A glowing WoW-style loot-sack badge appears attached to the token, plus a video-game
  style golden sparkle (an animated GPU shader) twinkling over the art.
- The ⚙ **Settings** panel (action panel header, GM only) holds room-wide
  options: the **badge corner** (e.g. move it if another extension already
  marks that corner — existing badges migrate automatically) and a custom
  **badge image** (any URL or a file you drop in `public/`, e.g.
  `/my-badge.png`; square images look best, empty restores the built-in
  sack). Changing either updates every badge already in the scene.
- **Players**: click the badge to open a loot popup.
  Clicking a written item opens it as a full document — letter, scroll, book or
  journal — each with its own paper texture and typography, plus an optional
  paper condition (fancy, crumpled, water-damaged, bloodstained, burnt, …).
- Books and journals are **paginated**: text fills fixed pages automatically and
  readers flip through them with the ‹ › flipper on the paper (or arrow keys).
  A line containing only `---` forces a page break exactly there (en/em
  dashes, underscores and `* * *` pasted from other editors work too).
  Letters and scrolls stay one continuous sheet (`---` becomes a `* * *`
  section divider); the **Layout** picker in the editor's Style tab overrides
  either default. A paragraph wrapped in `*asterisks*` renders as an
  editorial note in a neutral serif — the narrator describing the object
  (e.g. `*Several pages are torn out.*`) rather than ink written on it.
- Readers can adjust **text size** and **zoom** independently; the preference is
  remembered per browser (localStorage).

## Data & persistence

- Loot lives in the token's **item metadata** (`com.shiro.master-loot/loot`), so
  Owlbear Rodeo syncs it to every player and persists it with the scene.
- Every save is also mirrored to the GM's **browser localStorage** per room as a
  backup. If a token loses its loot (deleted, scene mishap), reopening the editor on
  it offers a one-click **Restore**.
- Reading preferences (font size / zoom) are stored in each user's localStorage.

Documents are capped at 10,000 characters to stay under Owlbear Rodeo's per-item
metadata size limit.

## Development

```bash
npm install
npm run dev
```

Then add `http://localhost:5173/manifest.json` as an extension in Owlbear Rodeo.
CORS for the OBR origin is preconfigured in `vite.config.ts` (dev + preview) and in
`netlify.toml` (production), so no extra setup is needed.

## Deploy to Netlify

The repo ships with `netlify.toml` (build command, publish dir, CORS headers):

- **Git-based**: push the repo and "Import from Git" in Netlify — settings are
  picked up automatically.
- **CLI**: `npx netlify-cli deploy --prod` (after `npm run build`, publish `dist`).

Once deployed, install with `https://<your-site>.netlify.app/manifest.json`.

## Project layout

| Path                    | Purpose                                                     |
| ----------------------- | ----------------------------------------------------------- |
| `public/manifest.json`  | OBR extension manifest (action popover + background script) |
| `src/background.ts`     | Context menus, badge-click detection, badge cleanup         |
| `src/action.ts`         | Toolbar action panel: all loot containers in the scene      |
| `src/lootView.ts`       | Player-facing loot popup (WoW-style slots)                  |
| `src/documentView.ts`   | Immersive document reader with font-size/zoom controls      |
| `src/editor.ts`         | GM editor with live paper preview and localStorage restore  |
| `src/fiveETools.ts`     | 5e.tools link parsing, data fetching and item conversion    |
| `src/paperRender.ts`    | Shared, XSS-safe paper renderer                             |
| `src/styles/paper.css`  | Letter / scroll / book / journal styles + paper conditions  |

Baseline scope: players **view** loot; taking/claiming items is a future feature
(the data model already carries quantities to support it).

## Texture credits

The paper-condition overlays blend real photographs (`src/textures/`):

- Crumpled — ["Crumpled olive green paper"](https://commons.wikimedia.org/wiki/File:Crumpled_olive_green_paper.jpg),
  photos-public-domain.com, Public Domain, via Wikimedia Commons.
- Stained & Water-damaged — ["Coffee Stains Texture 08"](https://commons.wikimedia.org/wiki/File:Coffee_Stains_Texture_08_(3731108469).jpg)
  by Jacob Gube, CC BY-SA 2.0, via Wikimedia Commons.

The remaining conditions (burnt, bloodstained, old, rough, fancy) are procedural
CSS so localized damage can hug the corners and edges of any paper size.
