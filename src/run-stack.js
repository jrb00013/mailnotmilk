/**
 * Background hub + browser relay.
 * Prefer Chrome extension (normal shortcut, any site) → CDP → Playwright.
 */

import { ensureHub, openUrl } from "./open.js";
import * as browser from "./browser.js";
import { relayTick } from "./relay.js";
import { cdpUp, ensureChromeCdp } from "./chrome-session.js";
import * as ext from "./ext-bridge.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export async function cdpAvailable(cdpUrl = "http://127.0.0.1:9222") {
  return cdpUp(cdpUrl);
}

export function extensionDir() {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "extension");
}

/** Wait until the Chrome extension has said hello (or timeout). */
export async function waitForExtension({ timeoutMs = 15000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const st = ext.extStatus();
    if (st.connected || st.lastHello) return st;
    await new Promise((r) => setTimeout(r, 400));
  }
  return ext.extStatus();
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
  const preferExtension = opts.preferExtension !== false;
  const useSession =
    opts.useSession !== false &&
    process.env.MAILNOTMILK_NO_SESSION !== "1" &&
    browserName !== "firefox";
  const cdpUrl = opts.cdpUrl || "http://127.0.0.1:9222";
  const port = Number(new URL(cdpUrl).port || 9222);

  console.error(
    `mailnotmilk run: site=${site} peer=${peer} browser=${browserName}`
  );

  const hubUrl = await ensureHub(hubPort);
  console.error(`hub (api only): ${hubUrl}`);

  let attached = false;

  if (preferExtension) {
    console.error(
      `browser: waiting for Chrome extension (load unpacked once from):\n  ${extensionDir()}`
    );
    console.error(
      "  Then open Chrome normally (shortcut), open any AI site, click extension → Use this tab."
    );
    const st = await waitForExtension({ timeoutMs: Number(opts.extWaitMs || 12000) });
    if (st.connected || st.lastHello) {
      console.error("browser: Chrome extension connected — driving your normal tabs (any site)");
      await browser.browserConnect({ mode: "extension" });
      attached = true;
    } else {
      console.error(
        "browser: extension not connected yet — install once: chrome://extensions → Load unpacked → extension/"
      );
    }
  }

  if (!attached && useSession) {
    const sess = await ensureChromeCdp({
      cdpUrl,
      port,
      startIfMissing: opts.startChrome !== false,
      openUrl:
        site === "chatgpt"
          ? "https://chatgpt.com/"
          : site === "deepseek"
            ? "https://chat.deepseek.com/"
            : null,
    });
    if (sess.ok) {
      console.error(
        `browser: CDP fallback ${cdpUrl}` +
          (sess.started ? " (started Chrome)" : "")
      );
      await browser.browserConnect({
        browser: "chrome",
        mode: "cdp",
        cdpUrl,
      });
      attached = true;
    }
  }

  if (!attached) {
    const forceHeaded = site === "chatgpt" || process.env.MAILNOTMILK_HEADED === "1";
    const launchHeadless = forceHeaded ? false : headless;
    console.error(
      `browser: Playwright fallback (${launchHeadless ? "headless" : "headed"})`
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
          forwardedAssistantId: result.forwardedAssistant?.id || null,
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
