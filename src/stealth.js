/**
 * Light anti-automation patches inspired by Chromium/Firefox automation gaps.
 * Not a full fingerprint suite — enough to stop the trivial `navigator.webdriver`
 * tripwire that ChatGPT/CF use against old Playwright headless.
 */

/** Script injected before any page JS (CDP / Playwright addInitScript). */
export const STEALTH_INIT_SCRIPT = `
(() => {
  try {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
      configurable: true,
    });
  } catch {}
  try {
    // Chromium exposes window.chrome in real Chrome; headless sometimes doesn't.
    if (!window.chrome) {
      window.chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}) };
    }
  } catch {}
  try {
    const original = Navigator.prototype.permissions?.query;
    if (original) {
      Navigator.prototype.permissions.query = function (parameters) {
        if (parameters && parameters.name === 'notifications') {
          return Promise.resolve({ state: Notification.permission });
        }
        return original.call(this, parameters);
      };
    }
  } catch {}
  try {
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
      configurable: true,
    });
  } catch {}
  try {
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
      configurable: true,
    });
  } catch {}
})();
`;

/**
 * Apply stealth to a Playwright BrowserContext (and existing pages).
 */
export async function applyStealthToContext(context) {
  if (!context?.addInitScript) return { ok: false };
  await context.addInitScript(STEALTH_INIT_SCRIPT);
  for (const page of context.pages?.() || []) {
    try {
      await page.addInitScript(STEALTH_INIT_SCRIPT);
      await page.evaluate(STEALTH_INIT_SCRIPT).catch(() => {});
    } catch {
      /* page may be mid-nav */
    }
  }
  return { ok: true };
}
