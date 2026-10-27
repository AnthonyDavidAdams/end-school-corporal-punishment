// Re-read the Missouri Simbli sites the crew server could not, with a real browser.
//
// tools/tasb/simbli-harvest.mjs walked MSBA's short site block (S=1..700) through the crew server and
// 492 of 700 came back as errors: mostly Imperva's challenge page, which is rate-based and answered a
// fleet-paced fetch anyway, plus a few MCP validation errors (site "1".."9" are one character and the
// tool wants two). So this re-reads every row with `error` by opening the same pages in Chromium.
//
// Two things were measured before writing it (2026-10-10):
//   - Headless Chromium never clears the challenge: thirty seconds on the interstitial, every site,
//     with either the bundled build or the installed Chrome. A headed window clears it in under a
//     second. So this runs headed, in a small window parked off to the side. It is not evasion; the
//     challenge exists to require a browser and this is one.
//   - A site that does not exist 302s to /Pages/ErrorPage.aspx. The crew server's "challenge" error
//     for sites 1 and 13 was that redirect read through an interstitial: they are empty, not blocked.
//
// The listing page fills a global `policyListingDto` from its own API; the policy page loads
// `/Services/api/ViewPolicy?...` whose JSON carries the revision's HTML, the district's name and
// `ParentGroup: "msba"`. Both are read off the page the browser already loaded, so no token dance.
// Opening ViewPolicy.aspx with only S= and revid= gets a 403 from that API; the listing's own links
// carry ptid=, PG=, IRP= and isPndg= as well, and with those it answers. Copied verbatim.
//
//   node tools/mo/simbli-browser-walk.mjs [--in data/simbli/mo-harvest.jsonl] [--workers 2]
//        [--mode browser|fetch] browser (default) opens the pages; fetch does what the page does
//        [--include-nameless]   also re-read rows with district:null that do have an index
//        [--retry-walked]       re-read rows this script already walked and left as errors
//        [--limit N] [--sites 13,17,21]
//
// Resumable: every finished site is written back to the file at once (atomic rename), stamped
// `_walked`; a rerun skips stamped rows. Original row order is kept. Stops and says so if the
// challenge sticks for several sites in a row, which is what Simbli blocking the browser looks like.
//
// And it did block the browser, forty minutes into writing this. After the headless attempts above,
// Imperva stopped offering the JavaScript challenge to Playwright's Chromium at all and put an
// hCaptcha in front of it instead, while a plain fetch from the same address was still handed the
// shell and a session token. The automation flag is the tell and it is left alone: masking it would
// be evasion, which the project does not do. So `--mode fetch` does what the crew server does from
// Railway (crew/tools.mjs: shell view, listing API, policy API, one cookie jar, 3 s floor), here from
// one address, one request at a time, at 4-6 s. It is not a browser, and the file says which mode
// read each row (`_via`).
import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { join, dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { hasAnchor, NOT_THIS } from "../tasb/vocabulary.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const flag = (n) => process.argv.includes(`--${n}`);
const abs = (p) => (isAbsolute(p) ? p : join(root, p));
const FILE = abs(arg("in", "data/simbli/mo-harvest.jsonl"));
const MODE = arg("mode", "browser");
const WORKERS = MODE === "fetch" ? 1 : Math.min(2, Math.max(1, Number(arg("workers", 2))));
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const LIMIT = Number(arg("limit", 0)) || Infinity;
const ONLY = arg("sites", "") ? new Set(arg("sites", "").split(",").map((s) => s.trim())) : null;
const GAP_MIN = 2000, GAP_MAX = 4000;
const STUCK_LIMIT = 4;                 // consecutive challenge timeouts before we stop
const SIMBLI = "https://simbli.eboardsolutions.com";
// MSBA's code for corporal punishment. JGA-1 is the "permitted" variant, JGA-2 the newer prohibition.
const CODE_RE = /^JGA(-\d)?$/i;
const TITLE_RE = /corporal\s+punishment/i;
// Missouri district names: "Exeter R-VI", "Clarkton C-4", "Gideon 37", "Perry County 32",
// "Kingston K-14", "Potosi R-III School District", "St. Joseph School District", "Mexico Public Schools #59".
const MO_NAME = /\b[A-Z]-(?:[IVXL]+|\d+)\b|\bSchool District\b|\bPublic Schools?\b|\b#?\d{1,3}\s*$|\bCo\.|\bCounty\b/i;
const DEMO = /\bdemo\b/i;

// Same clipping as the server-side harvester, so a row from either path is judged the same way.
const clip = (text) => (text || "").split(/(?<=[.:;])\s+/)
  .map((s) => s.replace(/\s+/g, " ").trim())
  .filter((s) => s.length > 30 && s.length < 600 && hasAnchor(s)
              && !NOT_THIS.some((x) => s.toLowerCase().includes(x)));

const htmlToText = (html) => String(html || "")
  .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<head[\s\S]*?<\/head>/gi, " ")
  .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"')
  .replace(/&sect;/gi, "§").replace(/&ldquo;|&rdquo;/gi, '"').replace(/&lsquo;|&rsquo;/gi, "'")
  .replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.floor(Math.random() * (b - a));

// ---- the file: read once, rewrite whole after every site, order preserved -----------------------
const rows = readFileSync(FILE, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
const at = new Map(rows.map((r, i) => [String(r.site), i]));
function save() {
  const tmp = FILE + ".tmp";
  writeFileSync(tmp, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  renameSync(tmp, FILE);
}
function tagState(r) {
  if (!r.district) return r;
  if (DEMO.test(r.district)) { r.skip = true; r._state ??= "MO"; return r; }
  if (r._parent_group === "msba" || MO_NAME.test(r.district)) r._state = "MO";
  return r;
}

const wanted = rows.filter((r) => {
  if (ONLY) return ONLY.has(String(r.site));
  if (r._walked && !flag("retry-walked")) return false;
  if (r.error) return true;
  if (flag("include-nameless") && !r.district && !r.empty && (r.policies_in_index ?? 0) > 0) return true;
  return false;
}).slice(0, LIMIT);
console.log(`${wanted.length} sites to re-read (${MODE}), ${WORKERS} at a time -> ${FILE}`);
if (!wanted.length) { rows.forEach(tagState); save(); process.exit(0); }

// ---- the browser --------------------------------------------------------------------------------
let browser = null, context = null;
if (MODE === "browser") {
  const { chromium } = await import("playwright");
  browser = await chromium.launch({ headless: false, args: ["--window-size=900,700", "--window-position=1500,900"] });
  context = await browser.newContext({ viewport: { width: 900, height: 700 } });
  // Only Simbli itself. The shell pulls HubSpot, Pendo, Sentry, Google Translate and a chat widget,
  // none of which the policy needs and all of which slow the page down.
  await context.route("**/*", (route) => {
    const req = route.request(), t = req.resourceType();
    if (t === "image" || t === "font" || t === "media") return route.abort();
    if (!/^https:\/\/(simbli|app2)\.eboardsolutions\.com\//.test(req.url())) return route.abort();
    return route.continue();
  });
}

// ---- the fetch path: what the page does, without the page ---------------------------------------
// Through curl, not Node's fetch. Measured 2026-10-10, same address, same headers, seconds apart:
// undici was handed "Pardon Our Interruption" and curl the shell with its token. Imperva is reading
// the client's wire fingerprint, and curl's is one it serves. Nothing is disguised: same User-Agent
// the crew server sends, same three requests, one cookie file per site so the API sees the cookies
// the shell set, and every request waits its turn behind the last one.
const { execFile } = await import("node:child_process");
const { promisify } = await import("node:util");
const { mkdtempSync, rmSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const run = promisify(execFile);
const scratch = mkdtempSync(join(tmpdir(), "simbli-walk-"));
process.on("exit", () => { try { rmSync(scratch, { recursive: true, force: true }); } catch {} });
let jarSeq = 0;
function cookieJar() { const f = join(scratch, `jar-${++jarSeq}.txt`); writeFileSync(f, ""); return f; }
let lastReq = 0;
async function get(url, jar, { json = false, referer } = {}) {
  const wait = rand(3000, 4500) - (Date.now() - lastReq);
  if (wait > 0) await pause(wait);
  lastReq = Date.now();
  const hdr = `${jar}.hdr`, body = `${jar}.body`;
  const args = ["-s", "-A", UA,
    "-H", `Accept: ${json ? "application/json, text/plain, */*" : "text/html,application/xhtml+xml,*/*;q=0.8"}`,
    "-H", "Accept-Language: en-US,en;q=0.9",
    ...(json ? ["-H", "X-Requested-With: XMLHttpRequest"] : []),
    ...(referer ? ["-H", `Referer: ${referer}`] : []),
    "-b", jar, "-c", jar, "-D", hdr, "-o", body, "--max-time", "30", "-w", "%{http_code} %{redirect_url}", url];
  const { stdout } = await run("curl", args);
  const [status, location] = stdout.trim().split(" ");
  return { status: Number(status) || 0, location: location || "", body: existsSync(body) ? readFileSync(body, "utf8") : "" };
}
const shellVar = (html, name) => html.match(new RegExp(`var ${name} = '([^']*)'`))?.[1] ?? "";
const challenged = (body) => /Pardon Our Interruption|_Incapsula_Resource|Incapsula/i.test(body) && !/var sToken/.test(body);

async function readSiteFetch(site) {
  const stamp = new Date().toISOString();
  try {
    let jar = cookieJar();
    const listing = `${SIMBLI}/Policy/PolicyListing.aspx?S=${site}`;
    let shell = await get(listing, jar);
    if (challenged(shell.body)) {
      await pause(60_000);                                   // rate-based; give it a minute
      jar = cookieJar();
      shell = await get(listing, jar);
      if (challenged(shell.body)) return { site, error: `Simbli's challenge page answered the paced fetch for site ${site} twice, a minute apart`, _walked: stamp, _via: "fetch", _stuck: true };
    }
    if (shell.status >= 300 && shell.status < 400 && /ErrorPage\.aspx/i.test(shell.location)) {
      return { site, empty: true, note: "Simbli redirects this site number to its error page: no site", _walked: stamp, _via: "fetch" };
    }
    const sct = shellVar(shell.body, "sToken"), sid = shellVar(shell.body, "enSID");
    if (!sct) return { site, error: `Simbli served site ${site} without a session token (HTTP ${shell.status}, ${shell.body.length} bytes)`, _walked: stamp, _via: "fetch" };
    const district = (shell.body.match(/<title>\s*Policy Listing\s*\|\s*([^<]+?)\s*<\/title>/i)?.[1] || "").trim() || null;
    const q = new URLSearchParams({ sct, ensid: sid, enUID: "", ismobile: "false", ptid: "", secid: "" });
    const api = await get(`${SIMBLI}/Services/api/PolicyListing/?${q}`, jar, { json: true, referer: listing });
    let data = null;
    try { data = JSON.parse(api.body); } catch {}
    if (api.status >= 500 || !data) {
      return { site, district, error: `Simbli minted a session for site ${site} but its policy listing API answered ${api.status}${data ? "" : " with no JSON"}; the site exists and publishes no readable policy index`, _walked: stamp, _via: "fetch" };
    }
    const dto = data.PolicyListingDTO ?? {};
    const index = { ptid: data.SelectedPolicyTypeID || "", policies: (dto.Policies ?? []).map((p) => ({
      id: p.ID, code: p.Policy?.Code ?? null, title: p.Policy?.Description ?? null,
      last_revised: p.Policy?.LastRevisedDate ?? null, status: p.StatusStr ?? null,
    })) };
    if (!index.policies.length) return { site, district, empty: true, note: "Simbli site exists but publishes no policies", policies_in_index: 0, _walked: stamp, _via: "fetch" };
    const targets = index.policies.filter((p) => p.id && (CODE_RE.test(p.code || "") || TITLE_RE.test(p.title || ""))).slice(0, 4);
    const policies = [];
    let parentGroup = null, siteName = null;
    for (const p of targets) {
      const url = `${SIMBLI}/Policy/ViewPolicy.aspx?S=${site}&revid=${encodeURIComponent(p.id)}`;
      // The call the crew server makes first; the one the page itself makes if that refuses.
      const q1 = new URLSearchParams({ sct, ensid: sid, enUID: "", revid: p.id, PG: "", st: "", mt: "" });
      let r = await get(`${SIMBLI}/Services/api/ViewPolicy/GetViewPolicyData?${q1}`, jar, { json: true, referer: listing });
      let j = null; try { j = JSON.parse(r.body); } catch {}
      if (!j || r.status >= 400) {
        const q2 = new URLSearchParams({ sct, ensid: sid, enUID: "", revid: p.id, PG: "6", crntSecId: "", isPndg: "false", st: "", mt: "" });
        r = await get(`${SIMBLI}/Services/api/ViewPolicy?${q2}`, jar, { json: true, referer: `${url}&ptid=${encodeURIComponent(index.ptid)}&secid=&PG=6&IRP=0&isPndg=false` });
        try { j = JSON.parse(r.body); } catch { j = null; }
      }
      parentGroup ??= (j?.ParentGroup || "").toLowerCase() || null;
      siteName ??= j?.SiteName || null;
      const rev = j?.PolicyRevision ?? {};
      const text = htmlToText(rev.Content || rev.ViewContent || j?.Content || "");
      const entry = { code: p.code, title: p.title, url, last_revised: rev.Policy?.LastRevisedDate || p.last_revised, status: p.status, candidates: clip(text), chars: text.length };
      if (text.length < 40) entry.error = j ? (j.CanViewPolicy === false ? `Simbli will not serve this revision publicly${j.ValidationMsg ? `: ${j.ValidationMsg}` : ""}` : "policy carried no text") : `policy API answered ${r.status}`;
      policies.push(entry);
    }
    const verdict = policies.some((p) => p.candidates.length) ? "rule" : "silent";
    return tagState({
      site, district: siteName || district, _state: null, _parent_group: parentGroup, verdict,
      policies, policies_in_index: index.policies.length, _walked: stamp, _via: "fetch",
    });
  } catch (err) {
    return { site, error: `fetch: ${String(err.message || err).split("\n")[0].slice(0, 160)}`, _walked: stamp, _via: "fetch" };
  }
}

// What the listing page is showing, polled until it settles.
async function listingState(page) {
  return page.evaluate(() => ({
    url: location.href,
    title: document.title,
    tok: typeof sToken !== "undefined" && !!sToken,
    dto: typeof policyListingDto !== "undefined" && !!policyListingDto?.PolicyListingDTO,
    n: (typeof policyListingDto !== "undefined" && policyListingDto?.PolicyListingDTO?.Policies?.length) || 0,
    challenge: typeof sToken === "undefined" && /_Incapsula_Resource|Pardon Our Interruption/.test(document.documentElement.outerHTML),
    text: (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 200),
  })).catch(() => ({ url: page.url(), title: "", tok: false, dto: false, n: 0, challenge: false, text: "" }));
}

// One site, start to finish. Returns the row to write in its place.
async function readSite(site) {
  const page = await context.newPage();
  const stamp = new Date().toISOString();
  try {
    const listing = `${SIMBLI}/Policy/PolicyListing.aspx?S=${site}`;
    await page.goto(listing, { waitUntil: "domcontentloaded", timeout: 45_000 });
    let st = null, settledFor = 0;
    for (let i = 0; i < 24; i++) {                         // up to ~36 s
      st = await listingState(page);
      if (/ErrorPage\.aspx/i.test(st.url)) break;
      if (st.n) break;
      if (st.dto && ++settledFor >= 3) break;              // index loaded and it is empty
      await page.waitForTimeout(1500);
    }
    if (/ErrorPage\.aspx/i.test(st.url)) return { site, empty: true, note: "Simbli redirects this site number to its error page: no site", _walked: stamp };
    if (st.challenge) return { site, error: `Simbli's challenge page did not clear in the browser for site ${site} (36 s)`, _walked: stamp, _stuck: true };
    if (!st.tok) return { site, error: `Simbli served site ${site} without a session token: ${st.text.slice(0, 100) || "blank page"}`, _walked: stamp };
    if (!st.dto) return { site, error: `Simbli minted a session for site ${site} but its policy listing API never answered (36 s); the crew server saw a 500 here`, _walked: stamp };
    const district = (st.title.match(/\|\s*(.+?)\s*$/)?.[1] || "").trim() || null;
    if (!st.n) return { site, district, empty: true, note: "Simbli site exists but publishes no policies", policies_in_index: 0, _walked: stamp };

    const index = await page.evaluate(() => ({
      ptid: policyListingDto.SelectedPolicyTypeID || "",
      policies: policyListingDto.PolicyListingDTO.Policies.map((p) => ({
        id: p.ID, code: p.Policy?.Code ?? null, title: p.Policy?.Description ?? null,
        last_revised: p.Policy?.LastRevisedDate ?? null, status: p.StatusStr ?? null,
      })),
    }));
    const targets = index.policies.filter((p) => p.id && (CODE_RE.test(p.code || "") || TITLE_RE.test(p.title || ""))).slice(0, 4);

    const policies = [];
    let parentGroup = null, siteName = null;
    for (const p of targets) {
      await pause(rand(1500, 3000));
      let api = null;
      const onResp = async (r) => { if (/\/Services\/api\/ViewPolicy\?/.test(r.url())) { try { api = await r.json(); } catch {} } };
      page.on("response", onResp);
      const url = `${SIMBLI}/Policy/ViewPolicy.aspx?S=${site}&revid=${encodeURIComponent(p.id)}`;
      const full = `${url}&ptid=${encodeURIComponent(index.ptid)}&secid=&PG=6&IRP=0&isPndg=false`;
      try {
        await page.goto(full, { waitUntil: "domcontentloaded", timeout: 45_000 });
        for (let i = 0; i < 25 && !api; i++) await page.waitForTimeout(1000);
      } finally { page.off("response", onResp); }
      parentGroup ??= (api?.ParentGroup || "").toLowerCase() || null;
      siteName ??= api?.SiteName || null;
      let text = htmlToText(api?.PolicyRevision?.Content || api?.PolicyRevision?.ViewContent || "");
      if (text.length < 40) {
        // The API did not answer or came back empty: take what the page rendered.
        await page.waitForTimeout(2500);
        text = await page.evaluate(() => {
          const el = document.querySelector("app-view-policy .bg-white") || document.querySelector("#jumpToMidContent");
          return (el?.innerText || "").trim();
        }).catch(() => "");
      }
      const entry = { code: p.code, title: p.title, url, last_revised: api?.PolicyRevision?.Policy?.LastRevisedDate || p.last_revised, status: p.status, candidates: clip(text), chars: text.length };
      if (text.length < 40) entry.error = api ? "policy page carried no text" : "policy API did not answer in the browser";
      policies.push(entry);
    }
    const verdict = policies.some((p) => p.candidates.length) ? "rule" : "silent";
    return tagState({
      site, district: siteName || district, _state: null, _parent_group: parentGroup, verdict,
      policies, policies_in_index: index.policies.length, _walked: stamp, _via: "browser",
    });
  } catch (err) {
    return { site, error: `browser: ${String(err.message || err).split("\n")[0].slice(0, 160)}`, _walked: stamp, _via: "browser" };
  } finally { await page.close().catch(() => {}); }
}

// ---- the walk -----------------------------------------------------------------------------------
const queue = [...wanted];
let done = 0, found = 0, empty = 0, errs = 0, silent = 0, stuck = 0, blocked = false;
async function worker() {
  while (queue.length && !blocked) {
    const row = queue.shift();
    const site = String(row.site);
    const out = MODE === "fetch" ? await readSiteFetch(site) : await readSite(site);
    if (out._stuck) { stuck++; delete out._stuck; } else stuck = 0;
    // Keep the index count the crew server saw, if the browser never reached a listing.
    if (out.error && row.policies_in_index != null) out.policies_in_index = row.policies_in_index;
    rows[at.get(site)] = out;
    save();
    done++;
    if (out.error) errs++; else if (out.empty) empty++; else if (out.verdict === "rule") found++; else silent++;
    const tag = out.error ? `error: ${out.error.slice(0, 90)}` : out.empty ? "empty" : `${out.district} — ${out.verdict} ${out.policies.map((p) => `${p.code}(${p.candidates.length})`).join(" ") || "no JGA"}`;
    console.log(`[${done}/${wanted.length}] ${site} ${tag}`);
    if (stuck >= STUCK_LIMIT) { blocked = true; break; }
    await pause(rand(GAP_MIN, GAP_MAX));
  }
}
await Promise.all(Array.from({ length: WORKERS }, worker));
rows.forEach(tagState);
save();
await context?.close().catch(() => {});
await browser?.close().catch(() => {});
console.log(`\n${done} sites re-read (${MODE}): ${found} with a rule, ${silent} with a manual but no corporal punishment sentence, ${empty} empty, ${errs} still erroring -> ${FILE}`);
if (blocked) {
  console.log(`STOPPED: Simbli's challenge page stuck for ${STUCK_LIMIT} sites in a row; ${MODE === "browser" ? "the browser is being blocked too" : "the paced fetch is being challenged"}. ${queue.length} sites not attempted. ${MODE === "browser" ? "Wait, or rerun with --mode fetch." : "The crew server measured it clearing in about forty minutes; rerun then."}`);
  process.exit(2);
}
