/**
 * Background hub + browser relay. No login flow. No hub UI by default.
 * Prefer attaching to the user's Chrome session via CDP when possible.
 */

import { ensureHub, openUrl } from "./open.js";
import * as browser from "./browser.js";
import { relayTick } from "./relay.js";
import { cdpUp, ensureChromeCdp } from "./chrome-session.js";

export async function cdpAvailable(cdpUrl = "http://127.0.0.1:9222") {
  return cdpUp(cdpUrl);
}

/**
 * @param {object} opts
 */
export async function runStack(opts = {}) {
  const site = opts.site || process.env.MAILNOTMILK_SITE || "chatgpt";
  const peer = opts.peer || process.env.MAILNOTMILK_PEER || "claude";
  const browserName =
    opts.browser || process.env.MAILNOTMILK_BROWSER || "chrome";
  const hubPort = Number(opts.hubPort || process.env.MAILNOTMILK_HUB_PORT || 7879);
  const waitMs = Number(opts.waitMs ?? 20000);
  const intervalMs = Number(opts.intervalMs ?? 8000);
  const loop = opts.loop !== false;
  const headless =
    opts.headless === undefined
      ? process.env.MAILNOTMILK_HEADED !== "1"
      : Boolean(opts.headless);
  const openBrowser = Boolean(opts.openBrowser);
  // Default: use the user's Chrome session (CDP). Login is never required.
  const useSession =
    opts.useSession !== false &&
    process.env.MAILNOTMILK_NO_SESSION !== "1" &&
    browserName !== "firefox";
  const cdpUrl = opts.cdpUrl || "http://127.0.0.1:9222";
  const port = Number(new URL(cdpUrl).port || 9222);

  console.error(
    `mailnotmilk run: site=${site} peer=${peer} browser=${browserName} session=${useSession}`
  );

  const hubUrl = await ensureHub(hubPort);
  console.error(`hub (api only): ${hubUrl}`);

  let attached = false;
  if (useSession) {
    const sess = await ensureChromeCdp({
      cdpUrl,
      port,
      startIfMissing: opts.startChrome !== false,
      openUrl:
        site === "chatgpt"
          ? "https://chatgpt.com/"
          : site === "deepseek"
            ? "https://chat.deepseek.com/"
            : "https://chatgpt.com/",
    });
    if (sess.ok) {
      console.error(
        `browser: using Chrome session via CDP ${cdpUrl}` +
          (sess.started ? " (started Chrome)" : " (already running)")
      );
      console.error(
        "  If you see Cloudflare “Verify you are human”, click it once in that Chrome window."
      );
      await browser.browserConnect({
        browser: "chrome",
        mode: "cdp",
        cdpUrl,
      });
      attached = true;
    } else {
      console.error(`browser: could not attach Chrome session (${sess.error}) — launch fallback`);
    }
  }

  if (!attached) {
    // ChatGPT Cloudflare blocks headless / bundled Chromium — force headed system Chrome
    const forceHeaded = site === "chatgpt" || process.env.MAILNOTMILK_HEADED === "1";
    const launchHeadless = forceHeaded ? false : headless;
    console.error(
      `browser: Playwright ${browserName === "firefox" ? "Firefox" : "Chrome"} ` +
        `(${launchHeadless ? "headless" : "headed"}) — click Cloudflare if it appears`
    );
    await browser.browserConnect({
      browser: browserName === "firefox" ? "firefox" : "chrome",
      mode: "launch",
      headless: launchHeadless,
    });
  }

  const status = browser.browserStatus();
  const alreadyOnSite =
    status.url &&
    ((site === "chatgpt" && /chatgpt\.com|chat\.openai\.com/i.test(status.url)) ||
      (site === "deepseek" && /deepseek\.com/i.test(status.url)) ||
      (site === "gemini" && /gemini\.google\.com/i.test(status.url)));
  if (!alreadyOnSite) {
    await browser.browserOpenAi({ site });
  } else {
    console.error(`browser: already on ${status.url}`);
  }

  if (openBrowser) {
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
      console.error("\n—— PASTE INTO PEER AGENT (or use mailnotmilk MCP join_chat) ——\n");
      console.error(result.invite.pasteForPeer);
      console.error("");
    }
    console.log(
      JSON.stringify(
        {
          chatId,
          extracted: result.extracted,
          forwardedId: result.forwarded?.id || null,
          peerReplyId: result.peerReply?.id || null,
          hub: hubUrl,
          browser: browser.browserStatus(),
        },
        null,
        2
      )
    );
    return result;
  };

  const first = await tick();
  if (!loop) {
    await browser.browserDisconnect();
    return { hubUrl, chatId, first };
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
