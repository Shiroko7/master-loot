import {
  COIN_KINDS,
  COIN_META,
  coinsToCopper,
  formatCoinValue,
  type CoinKind,
  type CoinPurse,
} from "./types";

/** Colored per-denomination chips (e.g. [12 gp] [5 sp]); empty ones hidden. */
export function buildCoinChips(coins: CoinPurse): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "coin-chips";
  for (const kind of COIN_KINDS) {
    const count = coins[kind] ?? 0;
    if (count <= 0) continue;
    const chip = document.createElement("span");
    chip.className = "coin-chip";
    chip.style.setProperty("--coin", COIN_META[kind].color);
    chip.title = COIN_META[kind].name;
    chip.textContent = `${count.toLocaleString()} ${kind}`;
    wrap.append(chip);
  }
  if (wrap.childElementCount === 0) {
    const empty = document.createElement("span");
    empty.className = "coin-empty";
    empty.textContent = "No coins";
    wrap.append(empty);
  }
  return wrap;
}

/**
 * "Worth in ⟨denomination⟩ = value" row. `update()` recomputes from the
 * live purse, so callers can wire it to their inputs; `onPick` lets them
 * remember the chosen denomination across re-renders.
 */
export function buildCoinConverter(
  getCoins: () => CoinPurse,
  initial: CoinKind = "gp",
  onPick?: (kind: CoinKind) => void,
): { root: HTMLElement; update(): void } {
  const root = document.createElement("div");
  root.className = "coin-convert";

  const caption = document.createElement("span");
  caption.textContent = "Worth in";

  const select = document.createElement("select");
  for (const kind of COIN_KINDS) {
    const option = document.createElement("option");
    option.value = kind;
    option.textContent = `${COIN_META[kind].name} (${kind})`;
    option.selected = kind === initial;
    select.append(option);
  }

  const worth = document.createElement("strong");
  worth.className = "worth";

  const update = (): void => {
    const target = select.value as CoinKind;
    worth.textContent = formatCoinValue(coinsToCopper(getCoins()), target);
  };
  select.onchange = () => {
    update();
    onPick?.(select.value as CoinKind);
  };
  update();

  root.append(caption, select, worth);
  return { root, update };
}
