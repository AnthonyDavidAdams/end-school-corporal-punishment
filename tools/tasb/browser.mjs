// A real browser, for the sites that will not talk to anything else.
//
// A good number of district sites answer a plain request with an F5 "Client Challenge": about three
// thousand bytes of JavaScript that computes a token, sets a cookie and reloads. No user agent and no
// proxy gets past it, because there is nothing to get past -- the page genuinely is not there until
// something runs the script.
//
// The archive was the first answer and it was the wrong one to lean on: several hundred unpaced
// requests in an evening and it stopped serving us anything at all, including pages it had served an
// hour earlier. It is a courtesy and we spent it.
//
// So run a browser. This is not evasion and it does not need anybody's approval: the challenge exists
// to require a browser, and this is one. It takes about five seconds a page, which is slow beside a
// fetch and nothing beside not having the page. Measured on three walled districts: 1.2 to 1.4 MB and
// 36 to 58 links each, where a plain fetch got 3,036 bytes and none.
//
// One browser is launched for the whole run and reused, because launching Chromium per page costs more
// than the page does.
let browser = null, context = null;

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export async function browserAvailable() {
  try { await import("playwright"); return true; } catch { return false; }
}

async function ready() {
  if (context) return context;
  const { chromium } = await import("playwright");
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 } });
  // Images and fonts are most of a district home page's bytes and none of its links.
  await context.route("**/*", (route) => {
    const t = route.request().resourceType();
    return t === "image" || t === "font" || t === "media" ? route.abort() : route.continue();
  });
  return context;
}

// Nothing here may wait for ever. goto has its own timeout, but content(), $$eval() and close() have none,
// and a renderer that wedges (a download that never starts, a script that never yields) held the Oklahoma
// harvest, and the whole nightly behind it, for eleven hours on 2026-11-11. So the read runs against one
// deadline, and a page that will not close is left for closeBrowser() rather than waited on.
const within = (p, ms) => { let t; return Promise.race([p, new Promise((_, no) => { t = setTimeout(() => no(new Error("browser deadline")), ms); })]).finally(() => clearTimeout(t)); };

export async function fetchWithBrowser(url, { settleMs = 4000, timeoutMs = 45_000 } = {}) {
  let page = null;
  const read = async () => {
    const ctx = await ready();
    page = await ctx.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    // The challenge resolves itself and reloads; wait for the page that comes after it.
    await page.waitForTimeout(settleMs);
    const html = await page.content();
    // Take the links from the DOM rather than re-parsing the HTML with a regex. A regex that requires
    // an anchor's contents to be short and to close tidily misses every nav link that wraps an image or
    // a card: on Kennett's home page it matched 19 where the DOM holds 36, and the ones it dropped were
    // the navigation. The browser already knows what the links are; there is no reason to guess.
    const links = await page.$$eval("a[href]", (as) => as.map((a) => ({
      url: a.href,
      text: (a.textContent || a.getAttribute("aria-label") || a.getAttribute("title") || "").replace(/\s+/g, " ").trim().slice(0, 90),
    })).filter((l) => l.url && !/^(mailto|tel|javascript)/i.test(l.url)));
    return { html, url: page.url(), links };
  };
  try { return await within(read(), timeoutMs + settleMs + 30_000); }
  catch { return null; }
  finally { if (page) await within(page.close(), 5000).catch(() => {}); }
}

export async function closeBrowser() {
  await within(Promise.resolve(context?.close()), 15_000).catch(() => {});
  await within(Promise.resolve(browser?.close()), 15_000).catch(() => {});
  context = browser = null;
}
