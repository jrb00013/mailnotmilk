/**
 * Tunable latency knobs for browser round-trips.
 * Set MAILNOTMILK_FAST=0 to keep legacy slow waits.
 */

function envNum(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function envFlag(name, fallback = true) {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return !["0", "false", "no", "off"].includes(String(v).toLowerCase());
}

/** Fast path is on by default. */
export function fastMode() {
  return envFlag("MAILNOTMILK_FAST", true);
}

export function latency() {
  const fast = fastMode();
  return {
    fast,
    // After navigation / CF
    postNavSettleMs: envNum("MAILNOTMILK_POST_NAV_MS", fast ? 200 : 1500),
    cfPollMs: envNum("MAILNOTMILK_CF_POLL_MS", fast ? 400 : 1500),
    cfClearExtraMs: envNum("MAILNOTMILK_CF_CLEAR_EXTRA_MS", fast ? 0 : 2000),
    cfDefaultTimeoutMs: envNum("MAILNOTMILK_CF_TIMEOUT_MS", fast ? 45_000 : 180_000),
    // Composer / send
    composerRetryMs: envNum("MAILNOTMILK_COMPOSER_RETRY_MS", fast ? 200 : 1500),
    composerRetries: envNum("MAILNOTMILK_COMPOSER_RETRIES", fast ? 8 : 2),
    postSendMs: envNum("MAILNOTMILK_POST_SEND_MS", fast ? 150 : 1200),
    // Assistant settle
    assistantPollMs: envNum("MAILNOTMILK_ASSISTANT_POLL_MS", fast ? 250 : 400),
    assistantIdleMs: envNum("MAILNOTMILK_ASSISTANT_IDLE_MS", fast ? 700 : 1200),
    assistantTimeoutMs: envNum("MAILNOTMILK_ASSISTANT_TIMEOUT_MS", fast ? 90_000 : 120_000),
    // CDP lifecycle
    cdpProbeMs: envNum("MAILNOTMILK_CDP_PROBE_MS", fast ? 100 : 250),
    cdpStopWaitMs: envNum("MAILNOTMILK_CDP_STOP_WAIT_MS", fast ? 250 : 800),
    // Cookie jar cache
    cookieCacheTtlMs: envNum("MAILNOTMILK_COOKIE_CACHE_MS", fast ? 60_000 : 5_000),
    // Skip full disconnect when already on same CDP endpoint
    reuseCdpSession: envFlag("MAILNOTMILK_REUSE_CDP", fast),
  };
}
