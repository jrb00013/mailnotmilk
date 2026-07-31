/**
 * Start hub + browser relay stack (used by ./run.sh and ./install.sh --run).
 */

import http from "node:http";
import { ensureHub, openUrl } from "./open.js";
import * as browser from "./browser.js";
import { relayTick } from "./relay.js";

function probeHttp(url, timeoutMs = 400) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode > 0 && res.statusCode < 500);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(false);
    });
  });
}

export async function cdpAvailable(cdpUrl = "http://127.0.0.1:9222") {
  const base = cdpUrl.replace(/\/$/, "");
  return probeHttp(`${base}/json/version`);
}

/**
 * @param {object} opts
 * @param {string} [opts.site]
 * @param {string} [opts.peer]
 * @param {string} [opts.browser]
 * @param {number} [opts.hubPort]
 * @param {number} [opts.waitMs]
 * @param {number} [opts.intervalMs]
 * @param {boolean} [opts.loop]
 * @param {boolean} [opts.headless]
 * @param {boolean} [opts.openBrowser]
 * @param {string} [opts.cdpUrl]
 * @param {string|null} [opts.chatId]
 */
export async function runStack(opts = {}) {
  const site = opts.site || process.env.MAILNOTMILK_SITE || "chatgpt";
  const peer = opts.peer || process.env.MAILNOTMILK_PEER || "claude";
  const browserName =
    opts.browser || process.env.MAILNOTMILK_BROWSER || "chrome";
  const hubPort = Number(opts.hubPort || process.env.MAILNOTMILK_HUB_PORT || 7879);
  const waitMs = Number(opts.waitMs ?? 20000);
  const intervalMs = Number(opts.intervalMs ?? 8000);
  const loop = opts.loop !== false; // default loop for ./run.sh
  const headless = Boolean(opts.headless);
  const cdpUrl = opts.cdpUrl || "http://127.0.0.1:9222";

  console.error(`mailnotmilk run: site=${site} peer=${peer} browser=${browserName}`);

  const hubUrl = await ensureHub(hubPort);
  console.error(`hub: ${hubUrl}`);

  const useCdp =
    browserName !== "firefox" && (await cdpAvailable(cdpUrl));
  if (useCdp) {
    console.error(`browser: attaching CDP ${cdpUrl}`);
    await browser.browserConnect({
      browser: "chrome",
      mode: "cdp",
      cdpUrl,
      headless: false,
    });
  } else {
    if (browserName !== "firefox") {
      console.error(
        `browser: CDP not found at ${cdpUrl} — launching Playwright Chrome.\n` +
          `  Tip: restart Chrome with: google-chrome --remote-debugging-port=9222`
      );
    } else {
      console.error("browser: launching Playwright Firefox");
    }
    await browser.browserConnect({
      browser: browserName === "firefox" ? "firefox" : "chrome",
      mode: "launch",
      headless,
    });
  }

  // Prefer existing ChatGPT tab if CDP; otherwise navigate
  const status = browser.browserStatus();
  const alreadyOnSite =
    status.url &&
    ((site === "chatgpt" && /chatgpt\.com|chat\.openai\.com/i.test(status.url)) ||
      (site === "deepseek" && /deepseek\.com/i.test(status.url)));
  if (!alreadyOnSite) {
    await browser.browserOpenAi({ site });
  } else {
    console.error(`browser: already on ${status.url}`);
  }

  if (opts.openBrowser !== false) {
    await openUrl(hubUrl).catch(() => {});
  }

  let chatId = opts.chatId || null;
  const tick = async () => {
    const result = await relayTick({
      chatId,
      site,
      peer,
      waitPeerMs: waitMs,
      sendPeerReplyToBrowser: true,
      title: `Browser ${site} ↔ ${peer}`,
    });
    chatId = result.chat?.id || chatId;
    if (result.invite?.pasteForPeer) {
      console.error("\n—— PASTE INTO CLAUDE CODE / CURSOR / OPENCODE ——\n");
      console.error(result.invite.pasteForPeer);
      console.error(`\nHub chat: ${result.invite.joinUrl}\n`);
    }
    console.log(
      JSON.stringify(
        {
          chatId,
          extracted: result.extracted,
          forwardedId: result.forwarded?.id || null,
          peerReplyId: result.peerReply?.id || null,
          hub: hubUrl,
        },
        null,
        2
      )
    );
    return result;
  };

  await tick();
  if (!loop) {
    await browser.browserDisconnect();
    return { hubUrl, chatId };
  }

  console.error(`relay loop running (every ${intervalMs}ms). ctrl-c to stop.`);
  const ac = new AbortController();
  const onSig = () => ac.abort();
  process.on("SIGINT", onSig);
  process.on("SIGTERM", onSig);

  while (!ac.signal.aborted) {
    await new Promise((r) => setTimeout(r, intervalMs));
    if (ac.signal.aborted) break;
    try {
      await tick();
    } catch (err) {
      console.error(`relay tick error: ${err.message}`);
    }
  }

  process.off("SIGINT", onSig);
  process.off("SIGTERM", onSig);
  await browser.browserDisconnect().catch(() => {});
  return { hubUrl, chatId };
}
