import * as store from "./store.js";
import { formatInboxLines } from "./format.js";
import { detectProvider } from "./identity.js";

/**
 * Poll inbox and print new mail. Returns a stop() function.
 */
export function watchInbox({
  agentId = detectProvider(),
  room = null,
  intervalMs = 1500,
  onMessage = null,
  ack = false,
  signal = null,
} = {}) {
  let lastSeen = 0;
  let stopped = false;
  const id = agentId;

  const tick = async () => {
    if (stopped) return;
    const items = store.checkInbox(id, { limit: 50, room });
    const fresh = items.filter((m) => m.id > lastSeen);
    for (const m of fresh) {
      if (m.id > lastSeen) lastSeen = m.id;
      const line = formatInboxLines([m])[0];
      if (onMessage) onMessage(m, line);
      else console.log(`[mailnotmilk] ${line}`);
      if (ack) store.readMessage(id, m.id);
    }
  };

  const timer = setInterval(() => {
    tick().catch((err) => console.error("[mailnotmilk watch]", err.message));
  }, Math.max(250, Number(intervalMs) || 1500));

  tick().catch(() => {});

  const stop = () => {
    stopped = true;
    clearInterval(timer);
  };

  if (signal) {
    signal.addEventListener("abort", stop, { once: true });
  }

  return stop;
}
