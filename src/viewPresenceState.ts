export const VIEW_HEARTBEAT_MS = 5_000;
export const VIEW_EXPIRY_MS = 20_000;

type RosterPlayer = { id: string; connectionId: string; name: string; role: string; color: string };
/** Presence/selection events must not rebuild inventory forms or steal focus. */
export function samePlayerRoster(previous: RosterPlayer[], next: RosterPlayer[]): boolean {
  return previous.length === next.length && previous.every((player, index) => {
    const other = next[index];
    return player.id === other.id && player.connectionId === other.connectionId &&
      player.name === other.name && player.role === other.role && player.color === other.color;
  });
}

export interface ViewLocation {
  kind: "document" | "picture" | "idcard" | "loot" | "inventory";
  id: string;
  name: string;
  sourceId?: string;
  page?: number;
  lastPage?: number;
  pageCount?: number;
  atEnd?: boolean;
}

export interface ViewUpdate {
  sessionId: string;
  sequence: number;
  location: ViewLocation | null;
  hidden: boolean;
  closed: boolean;
}

export interface ViewingStatus {
  location: ViewLocation;
  hidden: boolean;
  updatedAt: number;
}

export function describeViewingProgress(location: ViewLocation): string {
  if (location.page !== undefined) {
    const progress = location.page === location.lastPage
      ? `Page ${location.page} of ${location.pageCount}`
      : `Pages ${location.page}–${location.lastPage} of ${location.pageCount}`;
    return location.lastPage === location.pageCount ? `${progress} · last page` : progress;
  }
  return location.kind === "document" && location.atEnd ? "End of document visible" : "";
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isViewLocation(value: unknown): value is ViewLocation {
  if (!record(value) || typeof value.id !== "string" || typeof value.name !== "string") return false;
  if (!["document", "picture", "idcard", "loot", "inventory"].includes(String(value.kind))) return false;
  if (value.sourceId !== undefined && typeof value.sourceId !== "string") return false;
  if (value.atEnd !== undefined && typeof value.atEnd !== "boolean") return false;
  const hasPages = value.page !== undefined || value.lastPage !== undefined || value.pageCount !== undefined;
  if (hasPages) {
    if (value.kind !== "document") return false;
    for (const key of ["page", "lastPage", "pageCount"]) {
      if (!Number.isSafeInteger(value[key]) || Number(value[key]) < 1) return false;
    }
    if (Number(value.page) > Number(value.lastPage) || Number(value.lastPage) > Number(value.pageCount)) return false;
  }
  return true;
}

export function isViewUpdate(value: unknown): value is ViewUpdate {
  return record(value) && typeof value.sessionId === "string" && value.sessionId.length > 0 &&
    Number.isSafeInteger(value.sequence) && Number(value.sequence) > 0 && typeof value.hidden === "boolean" &&
    typeof value.closed === "boolean" && (!value.closed || value.location === null) &&
    (value.location === null || isViewLocation(value.location));
}

export function readViewingStatus(value: unknown, now = Date.now()): ViewingStatus | undefined {
  if (!record(value) || !isViewLocation(value.location) || typeof value.hidden !== "boolean" ||
    typeof value.updatedAt !== "number" || !Number.isFinite(value.updatedAt) ||
    now - value.updatedAt >= VIEW_EXPIRY_MS) return undefined;
  return value as unknown as ViewingStatus;
}

/** One session per iframe: a reader takes precedence over the windows underneath. */
export class ViewPresenceState {
  private sessions = new Map<string, ViewUpdate & { receivedAt: number; changedAt: number }>();

  update(message: ViewUpdate, now: number): void {
    const previous = this.sessions.get(message.sessionId);
    if (previous && message.sequence <= previous.sequence) return;
    // A close is final for this iframe, even if a delayed heartbeat arrives later.
    if (previous?.closed) return;
    const unchanged = previous && JSON.stringify(previous.location) === JSON.stringify(message.location) &&
      previous.hidden === message.hidden;
    this.sessions.set(message.sessionId, {
      ...message, receivedAt: now, changedAt: unchanged ? previous.changedAt : now,
    });
  }

  current(now: number): ViewingStatus | undefined {
    let selected: (ViewUpdate & { receivedAt: number; changedAt: number }) | undefined;
    const priority = (session: ViewUpdate) =>
      (session.location?.kind === "document" || session.location?.kind === "picture" || session.location?.kind === "idcard" ? 2 : 1);
    for (const [id, session] of this.sessions) {
      if (now - session.receivedAt >= VIEW_EXPIRY_MS) {
        // Retain recent close tombstones to reject messages in flight.
        if (session.location !== null) this.sessions.set(id, { ...session, location: null, receivedAt: now });
        else this.sessions.delete(id);
        continue;
      }
      if (!session.location) continue;
      if (!selected || priority(session) > priority(selected) ||
        (priority(session) === priority(selected) && session.changedAt > selected.changedAt)) selected = session;
    }
    return selected?.location ? {
      location: selected.location, hidden: selected.hidden, updatedAt: selected.receivedAt,
    } : undefined;
  }
}

export function describeViewing(status: ViewingStatus | undefined): { summary: string; progress: string } {
  if (!status) return { summary: "Not viewing anything", progress: "" };
  const { location, hidden } = status;
  const verb = location.kind === "document" ? "Reading" : location.kind === "loot" ? "Browsing loot" :
    location.kind === "inventory" ? "Viewing inventory" : "Viewing";
  const summary = `${verb}: ${location.name}${hidden ? " · background tab" : ""}`;
  return { summary, progress: describeViewingProgress(location) };
}
