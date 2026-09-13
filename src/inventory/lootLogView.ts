import OBR from "@owlbear-rodeo/sdk";
import "@fontsource/cinzel/600.css";
import "../styles/ui.css";
import { LOOT_LOG_MODAL_ID } from "../constants";
import { closeWindow, setupWindowResizer } from "../windowResizer";
import { LootLogService } from "./LootLogService";
import { TransferManager } from "./TransferManager";
import type { LootLogEntry } from "../modules/inventory/UserInventoryModel";

const app = document.getElementById("app")!;

let logs: LootLogEntry[] = [];
let role: "GM" | "PLAYER" = "PLAYER";
let myUserId = "";
let query = "";
let selectedUser = "";
let selectedSource = "";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  return node;
}

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
}

function render(): void {
  app.innerHTML = "";
  const panel = el("div", "panel");

  // Header
  const header = el("div", "panel-header");
  const title = el("h1", "panel-title");
  title.textContent = "📜 Loot Activity Log";
  header.append(title);

  const actions = el("div", "header-actions");

  // Quick Undo button
  const quickUndoBtn = el("button", "btn-icon");
  quickUndoBtn.textContent = "↩️";
  quickUndoBtn.title = "Undo Most Recent Action (Ctrl+Z)";
  quickUndoBtn.onclick = async () => {
    quickUndoBtn.disabled = true;
    const res = await TransferManager.undoMostRecent(role === "GM" ? undefined : myUserId);
    quickUndoBtn.disabled = false;
    if (!res.success) {
      alert(res.error || "No action available to undo.");
    } else {
      logs = await LootLogService.getLogs();
      renderList();
    }
  };

  // Quick Redo button
  const quickRedoBtn = el("button", "btn-icon");
  quickRedoBtn.textContent = "↪️";
  quickRedoBtn.title = "Redo Most Recent Undone Action (Ctrl+Y)";
  quickRedoBtn.onclick = async () => {
    quickRedoBtn.disabled = true;
    const res = await TransferManager.redoMostRecent(role === "GM" ? undefined : myUserId);
    quickRedoBtn.disabled = false;
    if (!res.success) {
      alert(res.error || "No action available to redo.");
    } else {
      logs = await LootLogService.getLogs();
      renderList();
    }
  };

  const historyGroup = el("div", "header-btn-group");
  historyGroup.append(quickUndoBtn, quickRedoBtn);
  actions.append(historyGroup);

  const closeBtn = el("button", "btn-icon");
  closeBtn.textContent = "✕";
  closeBtn.title = "Close";
  closeBtn.onclick = () => void closeWindow(LOOT_LOG_MODAL_ID);
  actions.append(closeBtn);

  header.append(actions);
  panel.append(header);

  // Filters
  const filtersRow = el("div", "log-filters");

  const searchInput = el("input", "filter-input");
  searchInput.type = "text";
  searchInput.placeholder = "Filter by item name...";
  searchInput.value = query;
  searchInput.oninput = () => {
    query = searchInput.value.toLowerCase().trim();
    renderList();
  };

  const userSelect = el("select", "filter-select");
  const defaultUserOpt = el("option");
  defaultUserOpt.value = "";
  defaultUserOpt.textContent = "All Users";
  userSelect.append(defaultUserOpt);

  const uniqueUsers = Array.from(new Set(logs.map((l) => l.userName).filter(Boolean)));
  for (const u of uniqueUsers) {
    const opt = el("option");
    opt.value = u;
    opt.textContent = u;
    opt.selected = selectedUser === u;
    userSelect.append(opt);
  }
  userSelect.onchange = () => {
    selectedUser = userSelect.value;
    renderList();
  };

  const sourceSelect = el("select", "filter-select");
  const defaultSourceOpt = el("option");
  defaultSourceOpt.value = "";
  defaultSourceOpt.textContent = "All Sources";
  sourceSelect.append(defaultSourceOpt);

  const uniqueSources = Array.from(new Set(logs.map((l) => l.sourceName).filter(Boolean)));
  for (const s of uniqueSources) {
    const opt = el("option");
    opt.value = s;
    opt.textContent = s;
    opt.selected = selectedSource === s;
    sourceSelect.append(opt);
  }
  sourceSelect.onchange = () => {
    selectedSource = sourceSelect.value;
    renderList();
  };

  filtersRow.append(searchInput, userSelect, sourceSelect);
  panel.append(filtersRow);

  // Body container
  const body = el("div", "panel-body log-table-wrapper");
  panel.append(body);

  const footer = el("div", "panel-footer");
  footer.id = "log-footer";
  panel.append(footer);

  app.append(panel);

  function renderList(): void {
    body.innerHTML = "";
    const filtered = logs.filter((entry) => {
      if (query && !entry.itemName.toLowerCase().includes(query)) return false;
      if (selectedUser && entry.userName !== selectedUser) return false;
      if (selectedSource && entry.sourceName !== selectedSource) return false;
      return true;
    });

    if (filtered.length === 0) {
      const note = el("div", "empty-note");
      note.textContent = logs.length === 0 ? "No loot events recorded yet." : "No matching records found.";
      body.append(note);
    } else {
      const table = el("table", "log-table");
      const thead = el("thead");
      const headRow = el("tr");

      const ths = ["Timestamp", "Action", "User", "Item", "Qty", "Source", "Target", "Undo / Redo"];
      for (const text of ths) {
        const th = el("th");
        th.textContent = text;
        headRow.append(th);
      }
      thead.append(headRow);
      table.append(thead);

      const tbody = el("tbody");
      for (const entry of filtered) {
        const row = el("tr");
        if (entry.undone) {
          row.classList.add("log-row-undone");
        }

        const timeTd = el("td");
        timeTd.textContent = formatTime(entry.timestamp);

        const actionTd = el("td");
        const badge = el("span", `badge badge-${entry.action}`);
        badge.textContent = entry.action;
        actionTd.append(badge);

        if (entry.undone) {
          const undoneBadge = el("span", "badge badge-undone");
          undoneBadge.textContent = "Undone";
          undoneBadge.style.marginLeft = "4px";
          actionTd.append(undoneBadge);
        }

        const userTd = el("td");
        userTd.textContent = entry.userName;

        const itemTd = el("td", "log-item");
        itemTd.textContent = entry.itemName;

        const qtyTd = el("td");
        qtyTd.textContent = `×${entry.quantity}`;

        const sourceTd = el("td");
        sourceTd.textContent = `${entry.sourceName} (${entry.sourceType === "token_bag" ? "Bag" : "Player"})`;

        const targetTd = el("td");
        if (entry.action === "DELETE") {
          targetTd.textContent = "🗑️ Deleted";
        } else if (entry.action === "CREATE") {
          targetTd.textContent = `${entry.targetName} (Created)`;
        } else {
          targetTd.textContent = `${entry.targetName} (${entry.targetType === "token_bag" ? "Bag" : "Player"})`;
        }

        const rollbackTd = el("td");
        const canAct = role === "GM" || entry.userId === myUserId;

        if (entry.undone) {
          const redoWrapper = el("div");
          redoWrapper.style.display = "flex";
          redoWrapper.style.alignItems = "center";
          redoWrapper.style.gap = "6px";

          const doneSpan = el("span", "setting-hint");
          doneSpan.textContent = "Rolled back";

          const redoBtn = el("button", "btn btn-xs");
          redoBtn.textContent = "↪️ Redo";
          redoBtn.title = canAct ? "Redo this action (Ctrl+Y)" : "Only the initiator or GM can redo this action";
          if (!canAct) {
            redoBtn.disabled = true;
          } else {
            redoBtn.onclick = async () => {
              const confirmMsg =
                entry.action === "DELETE"
                  ? `Redo deletion of ${entry.quantity}× "${entry.itemName}" from ${entry.sourceName}?`
                  : entry.action === "CREATE"
                  ? `Redo creation of ${entry.quantity}× "${entry.itemName}" in ${entry.sourceName}?`
                  : `Redo this transaction and deliver ${entry.quantity}× "${entry.itemName}" to ${entry.targetName}?`;

              if (confirm(confirmMsg)) {
                redoBtn.disabled = true;
                redoBtn.textContent = "…";
                const res = await TransferManager.redoLogEntry(entry.id);
                if (!res.success) {
                  alert(res.error || "Failed to redo action.");
                  redoBtn.disabled = false;
                  redoBtn.textContent = "↪️ Redo";
                } else {
                  logs = await LootLogService.getLogs();
                  renderList();
                }
              }
            };
          }
          redoWrapper.append(doneSpan, redoBtn);
          rollbackTd.append(redoWrapper);
        } else {
          const undoBtn = el("button", "btn btn-xs");
          undoBtn.textContent = "↩️ Undo";
          undoBtn.title = canAct ? "Undo this action (Ctrl+Z)" : "Only the initiator or GM can undo this action";
          if (!canAct) {
            undoBtn.disabled = true;
          } else {
            undoBtn.onclick = async () => {
              const confirmMsg =
                entry.action === "DELETE"
                  ? `Undo deletion and restore ${entry.quantity}× "${entry.itemName}" to ${entry.sourceName}?`
                  : entry.action === "CREATE"
                  ? `Undo creation and remove ${entry.quantity}× "${entry.itemName}" from ${entry.sourceName}?`
                  : `Undo this transaction and return ${entry.quantity}× "${entry.itemName}" to ${entry.sourceName}?`;

              if (confirm(confirmMsg)) {
                undoBtn.disabled = true;
                undoBtn.textContent = "…";
                const res = await TransferManager.rollbackLogEntry(entry.id);
                if (!res.success) {
                  alert(res.error || "Failed to rollback action.");
                  undoBtn.disabled = false;
                  undoBtn.textContent = "↩️ Undo";
                } else {
                  logs = await LootLogService.getLogs();
                  renderList();
                }
              }
            };
          }
          rollbackTd.append(undoBtn);
        }

        row.append(timeTd, actionTd, userTd, itemTd, qtyTd, sourceTd, targetTd, rollbackTd);
        tbody.append(row);
      }

      table.append(tbody);
      body.append(table);
    }

    const footerEl = document.getElementById("log-footer");
    if (footerEl) {
      footerEl.textContent = `Showing ${filtered.length} of ${logs.length} total event${logs.length === 1 ? "" : "s"}`;
    }
  }

  renderList();
}

OBR.onReady(async () => {
  setupWindowResizer({
    windowKey: "loot-log",
    type: "popover",
    popoverId: LOOT_LOG_MODAL_ID,
    defaultWidth: 820,
    defaultHeight: 600,
    minWidth: 450,
    minHeight: 380,
    maxWidth: 1400,
    maxHeight: 1200,
    centered: true,
  });

  role = await OBR.player.getRole();
  myUserId = await OBR.player.getId();
  logs = await LootLogService.getLogs();
  render();

  LootLogService.onChange((updated) => {
    logs = updated;
    render();
  });

  // Hotkeys: Ctrl+Z for Undo, Ctrl+Y (or Ctrl+Shift+Z) for Redo
  window.addEventListener("keydown", async (e) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) {
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
      e.preventDefault();
      const res = await TransferManager.undoMostRecent(role === "GM" ? undefined : myUserId);
      if (res.success) {
        logs = await LootLogService.getLogs();
        render();
      } else {
        console.warn(res.error);
      }
    } else if (
      ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") ||
      ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "z")
    ) {
      e.preventDefault();
      const res = await TransferManager.redoMostRecent(role === "GM" ? undefined : myUserId);
      if (res.success) {
        logs = await LootLogService.getLogs();
        render();
      } else {
        console.warn(res.error);
      }
    }
  });
});
