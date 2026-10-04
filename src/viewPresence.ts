import OBR from "@owlbear-rodeo/sdk";
import { VIEWING_CHANNEL, VIEWING_KEY } from "./constants";
import {
  VIEW_HEARTBEAT_MS, ViewPresenceState, isViewUpdate,
  type ViewLocation, type ViewUpdate,
} from "./viewPresenceState";

/** Report to this player's background iframe, which alone owns their shared status. */
export function createViewReporter(): { show(location: ViewLocation | null): void; close(): Promise<void> } {
  const sessionId = crypto.randomUUID();
  let sequence = 0;
  let location: ViewLocation | null = null;
  let closed = false;
  let signature = "";
  const send = async (): Promise<void> => {
    const update: ViewUpdate = { sessionId, sequence: ++sequence, location, hidden: document.hidden, closed };
    try {
      await OBR.broadcast.sendMessage(VIEWING_CHANNEL, update, { destination: "LOCAL" });
    } catch (error) {
      console.warn("Master Loot: could not report viewing status", error);
    }
  };
  const heartbeat = window.setInterval(() => { if (location && !closed) void send(); }, VIEW_HEARTBEAT_MS);
  const visibility = () => { if (location && !closed) void send(); };
  document.addEventListener("visibilitychange", visibility);
  const unsubscribe = OBR.broadcast.onMessage(VIEWING_CHANNEL, (event) => {
    if (event.data === "REQUEST_VIEWS" && location && !closed) void send();
  });
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    location = null;
    window.clearInterval(heartbeat);
    document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("pagehide", onPageHide);
    unsubscribe();
    await send();
  };
  const onPageHide = () => { void close(); };
  window.addEventListener("pagehide", onPageHide);
  return {
    show(next) {
      if (closed) return;
      const nextSignature = JSON.stringify(next);
      if (nextSignature === signature) return;
      signature = nextSignature;
      location = next;
      void send();
    },
    close,
  };
}

/** Runs for GMs and players, even when the action panel is closed. */
export async function startViewPresence(): Promise<void> {
  const connectionId = await OBR.player.getConnectionId();
  const state = new ViewPresenceState();
  let lastSignature: string | undefined;
  let dirty = false;
  let writing = false;

  // Serialize metadata writes: a slow page update must never overwrite a close.
  const publish = async (): Promise<void> => {
    dirty = true;
    if (writing) return;
    writing = true;
    try {
      while (dirty) {
        dirty = false;
        const status = state.current(Date.now());
        const signature = JSON.stringify(status ?? null);
        if (signature === lastSignature) continue;
        await OBR.player.setMetadata({ [VIEWING_KEY]: status ?? null });
        lastSignature = signature;
      }
    } catch (error) {
      console.warn("Master Loot: could not share viewing status", error);
    } finally {
      writing = false;
    }
  };
  OBR.broadcast.onMessage(VIEWING_CHANNEL, (event) => {
    if (event.connectionId !== connectionId || !isViewUpdate(event.data)) return;
    state.update(event.data, Date.now());
    void publish();
  });
  window.setInterval(() => { void publish(); }, VIEW_HEARTBEAT_MS);
  await publish(); // Discard status left over from a previous extension connection.
  await OBR.broadcast.sendMessage(VIEWING_CHANNEL, "REQUEST_VIEWS", { destination: "LOCAL" });
}
