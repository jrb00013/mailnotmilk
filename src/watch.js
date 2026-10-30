import * as store from "./store.js";
import { formatInboxLines } from "./format.js";
import { detectProvider } from "./identity.js";

const MAX_PAGE = 100;
const MAX_SEEN = 10_000;

/**
 * Poll inbox and print new mail. Returns a stop() function.
 *
 * Uses a seen-id set and pages through the whole unread inbox instead of
 * remembering only the highest id from the first page. `checkInbox` sorts by
 * priority before id, so the old `id > lastSeen` shortcut silently dropped
 * messages whenever there was more than one page of unread mail: the first
 * page was reprinted forever and the rest were never delivered.
 */
export function watchInbox({
  agentId = detectProvider(),
  room = null,
  intervalMs = 1500,
  onMessage = null,
  ack = false,
  signal = null,
  limit = MAX_PAGE,
} = {}) {
  const id = agentId;
  const pageSize = Math.min(Math.max(Number(limit) || MAX_PAGE, 1), MAX_PAGE);
  const seen = new Set();
  let stopped = false;
  let running = false;

  const markSeen = (messageId) => {
    seen.add(messageId);
    // Long-lived watchers without --ack keep every unread id. Bound the set so
    // memory does not grow forever; an evicted message is simply delivered
    // again if it is still unread.
    while (seen.size > MAX_SEEN) {
      const oldest = seen.values().next().value;
      seen.delete(oldest);
    }
  };

  const collect = () => {
    const batch = [];
    let offset = 0;
    for (;;) {
      const items = store.checkInbox(id, { limit: pageSize, room, offset });
      for (const m of items) {
        if (!seen.has(m.id)) batch.push(m);
      }
      if (items.length < pageSize) break;
      offset += items.length;
    }
    return batch;
  };

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      // Collect first, acknowledge second. Acking while paging would remove
      // rows and shift the offset under us.
      for (const m of collect()) {
        if (stopped) return;
        markSeen(m.id);
        const line = formatInboxLines([m])[0];
        if (onMessage) onMessage(m, line);
        else console.log(`[mailnotmilk] ${line}`);
        if (ack) store.readMessage(id, m.id);
      }
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    tick().catch((err) => console.error("[mailnotmilk watch]", err.message));
  }, Math.max(250, Number(intervalMs) || 1500));

  tick().catch(() => {});

  const stop = () => {
    stopped = true;
    clearInterval(timer);
    if (signal) signal.removeEventListener("abort", stop);
  };

  if (signal) {
    signal.addEventListener("abort", stop, { once: true });
  }

  return stop;
}
