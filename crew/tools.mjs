import { readFileSync } from "node:fs";
import { join } from "node:path";
// Tools that belong to this campaign rather than to Ground Crew.
//
// Finding a school district's handbook and reading Texas board policy are problems specific to US
// school districts. The engine stays general; this file knows about Apptegy, Finalsite and TASB.
//
// Loaded automatically by the server when it finds crew/tools.mjs. Exports registerTools.

// A real browser string, because some vendor WAFs reject anything else, plus who we actually are and
// where to complain. Tested against Simbli, which accepts even a bare bot string: there is no cost to
// being identifiable, and a campaign whose only asset is its credibility should not be crawling school
// district websites in disguise. If a vendor blocks us, we would rather they could write to us.
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 groundcrew/0.4 (+https://github.com/AnthonyDavidAdams/end-school-corporal-punishment)";

// The handful of hosts that serve most district documents. A link to one of these is almost
// certainly a real document rather than a navigation page.
const DOC_HOSTS = [
  { host: "resources.finalsite.net", vendor: "Finalsite" },
  { host: "core-docs.s3", vendor: "Apptegy (core-docs)" },
  { host: "files-backend.assets.thrillshare.com", vendor: "Apptegy (Thrillshare)" },
  { host: "files.smartsites.parentsquare.com", vendor: "ParentSquare SmartSites" },
  { host: "4.files.edl.io", vendor: "Edlio" },
  { host: "content.myconnectsuite.com", vendor: "ConnectSuite" },
  { host: "manuals.boardbook.org", vendor: "BoardBook" },
  { host: "docs.google.com", vendor: "Google Docs" },
  { host: "drive.google.com", vendor: "Google Drive" },
];

const HANDBOOK = /student[\s_%-]*(?:\/?parent[\s_%-]*)?handbook|parent[\s_%-]*student[\s_%-]*handbook|family[\s_%-]*handbook|code[\s_%-]*of[\s_%-]*conduct|student[\s_%-]*code/i;
const YEAR = /(20\d{2})\s*[-–—/]\s*(?:20)?(\d{2})/;

const safe = (u) => { try { return decodeURIComponent(u); } catch { return u; } };

// A Google Docs link that can actually be downloaded as a PDF.
function googlePdf(url) {
  const m = String(url).match(/\/document\/d\/([a-zA-Z0-9_-]+)/) || String(url).match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (!m) return null;
  return /\/document\//.test(url)
    ? `https://docs.google.com/document/d/${m[1]}/export?format=pdf`
    : `https://drive.google.com/uc?export=download&id=${m[1]}`;
}

function schoolYearFrom(text) {
  const m = String(text).match(YEAR);
  if (!m) return null;
  const a = Number(m[1]), b = Number(m[2].length === 2 ? `20${m[2]}` : m[2]);
  return b === a + 1 ? `${a}-${String(b).slice(2)}` : null;
}

// A TASB policy manual page runs to about a megabyte, and the sections are served in the order
// LEGAL, LOCAL, REGULATION. Truncating the HTML therefore drops LOCAL -- the only section that
// establishes what a district does -- while keeping LEGAL, which is identical everywhere and
// establishes nothing. Austin ISD's page is 924,240 characters and the old 900,000 cap silently cut
// it four thousand characters short of the answer. So: a cap large enough for the real documents,
// and a flag when it bites, because a silent partial read is worse than a failure.
const MAX_HTML_CHARS = 4_000_000;

// A lot of district sites answer with an F5 "Client Challenge" or simply drop the connection, and it
// is worth being precise about why, because two plausible theories were tested and both were wrong.
//
// It is not the user agent. Head to head on 2026-09-20, woodvilleeagles.org, whitehallsd.org and
// rivercrestcolts.org each served the same 1.1-1.2 MB page to a Chrome string and to a crawler string,
// back to back. The earlier observation that `curl/8.0` got through where Chrome did not was two
// requests minutes apart inside a rate-limit window, not a rule.
//
// It is the rate. The challenge follows a burst from one address and clears on its own, which means a
// single failure says almost nothing and a retry a few seconds later usually succeeds. So: retry,
// briefly and with a different user agent each time, since that costs nothing if a site ever does care.
// What actually fixes this class of failure is fewer agents through one address, not a cleverer header.
const CRAWLER_UA = "groundcrew/0.4 (+https://github.com/AnthonyDavidAdams/end-school-corporal-punishment)";
const CHALLENGE = /Client Challenge|Pardon Our Interruption|_Incapsula_Resource|Just a moment\.\.\./i;

async function getOnce(url, fetchImpl, ua, expect) {
  const res = await fetchImpl(url, {
    headers: { ...(ua ? { "User-Agent": ua } : {}), Accept: "text/html,*/*" },
    redirect: "follow", signal: AbortSignal.timeout(25000),
    // Handed to the egress layer so a vendor serving this address a stub gets routed around. Ignored
    // when no proxy pool is configured.
    ...(expect ? { expect } : {}),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const full = await res.text();
  return { html: full.slice(0, MAX_HTML_CHARS), final: res.url, truncated: full.length > MAX_HTML_CHARS, source_chars: full.length };
}

async function getText(url, fetchImpl, expect) {
  // "Not a challenge page and over 5,000 characters" is too weak a test on its own. A caller that
  // knows what the page must contain passes `expect`, and a response that lacks it is treated as a
  // failed read rather than a short document -- which is what TASB's 70,000-byte stub was.
  const good = (r) => !CHALLENGE.test(r.html) && r.source_chars > 5000 && (!expect || expect(r.html));
  let first = null;
  try {
    first = await getOnce(url, fetchImpl, UA, expect);
    if (good(first)) return first;
  } catch { /* fall through and try as a crawler */ }
  for (const [i, ua] of [CRAWLER_UA, null, UA].entries()) {
    await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    try {
      const alt = await getOnce(url, fetchImpl, ua, expect);
      if (good(alt) || (!CHALLENGE.test(alt.html) && alt.source_chars > (first?.source_chars ?? 0))) {
        return { ...alt, retried: true, ua_used: ua ?? "none" };
      }
    } catch { /* try the next one */ }
  }
  if (first) return first;
  throw new Error(`nothing served this URL after four attempts across ten seconds. These sites rate-limit by address and clear on their own, so this is usually worth retrying later rather than worked around.`);
}

function links(html, base) {
  const out = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi)) {
    let abs; try { abs = new URL(m[1].trim(), base).toString(); } catch { continue; }
    out.push({ url: abs, text: m[2].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() });
  }
  return out;
}


// --- Simbli (eBOARDsolutions) ------------------------------------------------------------------
// Simbli hosts board policy for a large share of Alabama, Georgia and Kentucky districts. The pages
// are an Angular shell: a plain fetch gets 18 KB of chrome and no policy text, which is why scans of
// these districts kept coming back empty. The shell does carry a per-session token, and the two APIs
// behind it answer an ordinary fetch that presents that token and the session cookies. So no browser
// is needed — only the page view that mints the session, then the same two calls the page makes.

const SIMBLI = "https://simbli.eboardsolutions.com";

// Imperva hands out a session on the first page view and refuses the APIs without those cookies,
// so one jar has to carry the whole conversation.
function cookieJar() {
  const store = new Map();
  return {
    header: () => [...store.entries()].map(([k, v]) => `${k}=${v}`).join("; "),
    get: (name) => store.get(name) ?? null,
    absorb: (res) => {
      for (const c of res.headers.getSetCookie?.() ?? []) {
        const [pair] = c.split(";");
        const i = pair.indexOf("=");
        if (i > 0) store.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
      }
    },
  };
}

// Imperva counts requests per source address per minute, and a scan that ignores that gets the whole
// server blocked for everyone using it, not just the agent that caused it. So the floor is enforced
// here rather than left to whoever is calling: every Simbli request in this process queues behind the
// last one. Measured: roughly 130 requests inside five minutes trips the challenge, and it clears on
// its own in about forty. One request every three seconds is an order of magnitude under that, and
// still walks a whole state's districts inside an hour.
const SIMBLI_MIN_INTERVAL_MS = 3000;
let simbliQueue = Promise.resolve();
let simbliLast = 0;
function simbliTurn() {
  simbliQueue = simbliQueue.then(async () => {
    const wait = SIMBLI_MIN_INTERVAL_MS - (Date.now() - simbliLast);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    simbliLast = Date.now();
  });
  return simbliQueue;
}

// Simbli's own page code sends `Authorization: Bearer <auth_Token cookie>` on these API calls, which
// looks like a contract this tool is missing. It is not one, and the check is written down here so the
// next person does not spend an afternoon on it: `auth_Token` is set by JavaScript and never appears in
// the shell's Set-Cookie, and the listing API answers 200 to the request below with no bearer at all.
// Measured 2026-09-20 against site 36031758.
let simbliSend = fetch;   // replaced at registration with the pooled sender
let vendorFetch = fetch; // ditto: the pooled sender for other rate-limiting vendors
async function simbliGet(url, jar, fetchImpl, { json = false, referer } = {}) {
  await simbliTurn();
  // Simbli rate-limits by source address, so where a proxy pool is configured these go out across it.
  // With none configured egressFetch is fetch and nothing changes. The User-Agent is unchanged either
  // way: this spreads load, it does not disguise who is asking.
  const res = await simbliSend(url, {
    headers: {
      "User-Agent": UA,
      Accept: json ? "application/json, text/plain, */*" : "text/html,application/xhtml+xml,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      ...(json ? { "X-Requested-With": "XMLHttpRequest" } : {}),
      ...(referer ? { Referer: referer } : {}),
      ...(jar.header() ? { Cookie: jar.header() } : {}),
    },
    redirect: "follow",
    signal: AbortSignal.timeout(30000),
  });
  jar.absorb(res);
  return { status: res.status, body: await res.text() };
}

const shellVar = (html, name) => html.match(new RegExp(`var ${name} = '([^']*)'`))?.[1] ?? "";

// The S= number identifies the district. Accept it bare or inside any Simbli URL.
export function simbliSiteId(input) {
  const s = String(input ?? "").trim();
  if (/^\d{2,12}$/.test(s)) return s;
  return s.match(/[?&]S=(\d{2,12})/i)?.[1] ?? null;
}

// Simbli sits behind Imperva, which answers a burst of requests with an interstitial instead of an
// error code. It is worth naming, because it is temporary and a wrong district key is not.
const challenged = (body) => /Pardon Our Interruption|Incapsula|_Incapsula_Resource/i.test(body) && !/var sToken/.test(body);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// The index is the expensive part and the least volatile: two requests to learn what a district
// publishes, and it changes when a board votes, not between one agent's call and the next one's.
// Caching it for an hour removes two Simbli requests from every repeat read of the same district,
// which on a fleet re-reading a district to verify it is most of the traffic.
// TASB rate-limits like Simbli does, and for the same reason: one district is read once by a scanner
// and again by each agent checking it. Cache the response and pace the misses.
const TASB_TTL_MS = 60 * 60 * 1000;
const tasbCache = new Map();
const TASB_MIN_INTERVAL_MS = 1500;
let tasbQueue = Promise.resolve(), tasbLast = 0;
function tasbTurn() {
  tasbQueue = tasbQueue.then(async () => {
    const wait = TASB_MIN_INTERVAL_MS - (Date.now() - tasbLast);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    tasbLast = Date.now();
  });
  return tasbQueue;
}

const SIMBLI_INDEX_TTL_MS = 60 * 60 * 1000;
const simbliIndexCache = new Map();

// The policy index: every code, title and revision id the district publishes.
async function simbliListing(site, fetchImpl) {
  const hit = simbliIndexCache.get(site);
  if (hit && Date.now() - hit.at < SIMBLI_INDEX_TTL_MS) return { ...hit.index, from_cache: true };
  const fresh = await simbliListingLive(site, fetchImpl);
  simbliIndexCache.set(site, { at: Date.now(), index: fresh });
  return fresh;
}

async function simbliListingLive(site, fetchImpl) {
  const jar = cookieJar();
  const page = `${SIMBLI}/Policy/PolicyListing.aspx?S=${site}`;
  let shell = await simbliGet(page, jar, fetchImpl);
  if (challenged(shell.body)) {
    // A fresh jar and a few seconds is usually enough; the challenge is rate-based, not a block.
    await pause(4000);
    shell = await simbliGet(page, cookieJar(), fetchImpl);
    if (challenged(shell.body)) throw new Error(`Simbli's bot protection answered with a challenge page for site ${site} rather than the policy listing. This is rate-based and clears on its own; wait a minute and call again.`);
  }
  const sct = shellVar(shell.body, "sToken");
  const sid = shellVar(shell.body, "enSID");
  if (!sct) throw new Error(`Simbli did not mint a session for site ${site} (HTTP ${shell.status}, ${shell.body.length} bytes). Check the S= number against the district's own policy link.`);
  const q = new URLSearchParams({ sct, ensid: sid, enUID: "", ismobile: "false", ptid: "", secid: "" });
  const api = await simbliGet(`${SIMBLI}/Services/api/PolicyListing/?${q}`, jar, fetchImpl, { json: true, referer: page });
  let data;
  try { data = JSON.parse(api.body); } catch { throw new Error(`Simbli's policy listing did not return JSON for site ${site} (HTTP ${api.status}).`); }
  // A 500 here is not the rate limiter: the page was served and a session token was minted, so the
  // request got through and the API itself refused it. Worth saying differently, because "wait and
  // retry" is the right response to a challenge and the wrong response to this.
  if (api.status >= 500) throw new Error(`Simbli served the page for site ${site} and then answered ${api.status} on its own policy listing API. The shell loaded and a session was minted, so this is not the rate limiter. Retrying will not help; check the S= number, and file a report_issue if it is right.`);
  const dto = data?.PolicyListingDTO ?? {};
  const policies = (dto.Policies ?? []).map((p) => ({
    code: p.Policy?.Code ?? null,
    title: p.Policy?.Description ?? null,
    revid: p.ID ?? null,
    status: p.StatusStr ?? null,
    last_revised: p.Policy?.LastRevisedDate ?? null,
    originally_adopted: p.Policy?.OriginalAdoptedDate ?? null,
    url: p.ID ? `${SIMBLI}/Policy/ViewPolicy.aspx?S=${site}&revid=${encodeURIComponent(p.ID)}` : null,
  })).filter((p) => p.code);
  return { jar, sct, sid, page, sections: (dto.PolicySections ?? []).map((x) => x.DisplayFullName ?? x.Name).filter(Boolean), policies };
}

// The text of one policy. The session token is per session, not per page, so the listing's token works
// here and the ViewPolicy page view can be skipped -- a third of the requests for a district scan.
async function simbliPolicy(ctxs, site, revid) {
  const { jar, sct, sid } = ctxs;
  const page = `${SIMBLI}/Policy/ViewPolicy.aspx?S=${site}&revid=${encodeURIComponent(revid)}`;
  const q = new URLSearchParams({ sct, ensid: sid, enUID: "", revid, PG: "", st: "", mt: "" });
  const api = await simbliGet(`${SIMBLI}/Services/api/ViewPolicy/GetViewPolicyData?${q}`, jar, ctxs.fetchImpl, { json: true, referer: `${SIMBLI}/Policy/PolicyListing.aspx?S=${site}` });
  let data;
  try { data = JSON.parse(api.body); } catch { throw new Error(`Simbli returned no policy data for revision ${revid} (HTTP ${api.status}).`); }
  if (!data) throw new Error(`Simbli has no policy at revision ${revid}. Re-read the listing; revision ids change when a policy is revised.`);
  if (data.CanViewPolicy === false) throw new Error(`Simbli will not serve revision ${revid} publicly${data.ValidationMsg ? `: ${data.ValidationMsg}` : "."}`);
  const rev = data.PolicyRevision ?? {};
  const html = rev.Content ?? rev.ViewContent ?? data.Content ?? "";
  const text = String(html)
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"')
    .replace(/&sect;/gi, "\u00a7")
    .replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return {
    page, text,
    district: data.SiteName ?? null,
    policy: rev.Policy ?? null,
    attachments: (rev.Attachments ?? []).length,
    cross_references: (data.CrossRefs ?? []).length,
    raw_chars: String(html).length,
  };
}

// Apptegy districts serve the same page to everybody and the documents are not in it: the site renders
// its file list from a CMS that answers, unauthenticated, at a section id embedded in the page. So the
// id is scraped once and the folder tree is walked through the API, which is not challenged even when
// the district's own site is. A district whose HTML we cannot get at all is still out of reach; many
// Apptegy sites serve theirs fine and those are the ones this rescues.
const THRILLSHARE = "https://thrillshare-cmsv2.services.thrillshare.com/api/v2/s";
// Folder names likely to hold discipline policy. This orders the walk rather than restricting it: the
// first version only descended into folders matching this, and on the district it was written for the
// handbooks sit two levels down inside a folder called plainly "District", which matches nothing here.
// A promising name goes first; everything else still gets visited until the budget runs out.
const DOC_FOLDERS = /handbook|discipline|conduct|polic|board|state required|student|district|parent/i;
async function apptegyDocuments(html, fetchImpl, limit = 60) {
  const section = html.match(/api\/v2\/s\/(\d+)\/documents/)?.[1];
  if (!section) return null;
  const get = async (u) => {
    for (let i = 0; i < 3; i++) {                       // the CMS returns sporadic empty responses
      try {
        const r = await fetchImpl(u, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(20000) });
        if (r.ok) return await r.json();
      } catch { /* retry */ }
      await new Promise((res) => setTimeout(res, 800 * (i + 1)));
    }
    return null;
  };
  const out = [], queue = [{ id: null, depth: 0 }], seen = new Set();
  let visited = 0;
  while (queue.length && out.length < limit && visited < 24) {
    const { id, depth } = queue.shift();
    if (seen.has(String(id))) continue;
    seen.add(String(id));
    const j = await get(id === null ? `${THRILLSHARE}/${section}/documents` : `${THRILLSHARE}/${section}/documents?folder_id=${id}`);
    visited++;
    if (!j) continue;
    for (const d of j.documents ?? []) {
      if (d.url) out.push({ title: d.file_name ?? null, url: d.url, vendor: "Apptegy (Thrillshare) CMS", folder: j.meta?.current_folder ?? null });
    }
    if (depth >= 3) continue;
    const kids = (j.items ?? []).filter((it) => it.id && it.folder_name).map((it) => ({ id: it.id, depth: depth + 1, name: it.folder_name }));
    kids.sort((a, b) => Number(DOC_FOLDERS.test(b.name)) - Number(DOC_FOLDERS.test(a.name)));
    for (const k of kids) queue.push(k);
  }
  return { section, documents: out };
}

export async function registerTools(server, ctx, { z, text, fail, documents, egressFetch }) {
  const fetchImpl = ctx.fetchImpl ?? fetch;
  // Where the engine has a proxy pool configured, vendor requests go out across it. Handed in rather
  // than imported, because this file is loaded from the crew directory and the engine lives elsewhere.
  vendorFetch = egressFetch ? egressFetch(fetchImpl) : fetchImpl;
  simbliSend = vendorFetch;

  // A contributor is assigned a scope like "TX: districts 11-20" and has to be able to turn that into
  // ten named districts without asking anyone. The worklist is published and ordered (most students
  // struck first), so the slice is just positions in that order -- deterministic, so two agents given
  // the same scope get the same districts, and so a scope means the same thing tomorrow as today.
  server.registerTool(
    "get_worklist",
    {
      title: "The districts in your scope",
      description:
        "Turn the scope you were assigned into the actual districts to read: name, state, NCES id, how many students it reported striking, and its address and website where the federal directory has them. " +
        "Call this first, right after claim_task. A scope like 'TX: districts 11-20' means positions 11 to 20 of Texas in the published worklist, which is ordered by how many children each district reported striking. A bare state means every unchecked district in it. " +
        "Every district here told the federal government it struck a student in 2023-24 and none has ever been read.",
      inputSchema: {
        scope: z.string().trim().min(1).describe("The scope from your lease, e.g. 'TX: districts 11-20' or 'MS'"),
      },
    },
    async ({ scope }) => {
      // A scope that names one district returns exactly what the Mothership already knows about it:
      // which documents were read and found silent, which URL is walled and how, and what is being
      // asked for. The queue used to hand out slices of a worklist; now it hands out the residue that
      // machines could not finish, and a contributor should not have to rediscover what was tried.
      try {
        const residue = JSON.parse(readFileSync(join(ctx.crewDir ?? "/crew", "data/residue.json"), "utf8"));
        const one = residue.find((r) => r.scope.toLowerCase() === String(scope).trim().toLowerCase());
        if (one) return text({ scope: one.scope, district: one.name, state: one.state, nces_id: one.nces_id ?? null,
          students_struck_2023_24: one.students, website: one.website ?? null, ask: one.ask, already_tried: one.tried,
          next: "Do what `ask` says. Submit with submit_finding; if the server cannot read your source, attach source_text. If the district genuinely has no written policy, say so in notes -- that is a finding too." });
      } catch { /* no residue file on this server; fall through to the state worklist */ }
      let wl;
      try {
        wl = JSON.parse(readFileSync(join(ctx.crewDir ?? "/crew", "data/worklist.json"), "utf8"));
      } catch {
        return fail("The worklist is not readable on this server. Report this with report_issue; do not guess at districts.");
      }
      const st = String(scope).trim().split(/[:,]/)[0].trim().toUpperCase();
      const inState = wl.districts.filter((d) => d.state === st);
      if (!inState.length) {
        return fail(`No unchecked districts for '${st}'. Either the scope is not a state code or that state is finished.`, { states: Object.keys(wl.by_state) });
      }
      const m = String(scope).match(/(\d+)\s*-\s*(\d+)/);
      // Positions are 1-based because that is how the scope is written and how a person reads it.
      const from = m ? Math.max(1, Number(m[1])) : 1;
      const to = m ? Number(m[2]) : inState.length;
      const districts = inState.slice(from - 1, to);
      return text({
        scope,
        state: st,
        districts,
        count: districts.length,
        of_unchecked_in_state: inState.length,
        children_in_this_slice: districts.reduce((a, d) => a + (d.students || 0), 0),
        ordered_by: "students reported struck in 2023-24, descending; positions are stable so a scope means the same districts every time",
        next: "For each one: find its own policy document, open it, quote the sentence that settles the question, then submit_finding. A district you genuinely cannot read is status 'unknown' with notes saying what you tried.",
        worklist_generated: wl.generated,
      });
    }
  );

  server.registerTool(
    "resolve_handbook",
    {
      title: "Find a district's current handbook",
      description:
        "Given a district website, return candidate handbook and code-of-conduct documents, newest school year first, with the page each link was found on and the vendor hosting it. " +
        "Discovery is the expensive half of a district scan and it is the same handful of hosts every time: Finalsite, Apptegy, ParentSquare, Edlio, BoardBook, Google Docs. " +
        "Feed the winner to fetch_document rather than opening it yourself. If nothing comes back, the district's site is probably JavaScript-only or behind a bot challenge; say so in a report_issue and fall back to reading it yourself.",
      inputSchema: {
        website: z.string().url().describe("The district's website, from the NCES record"),
        district: z.string().optional().describe("District name, used only to label the result"),
        state: z.string().length(2).optional(),
        max_pages: z.number().int().min(1).max(8).optional().describe("How many pages to look at (default 4)"),
      },
    },
    async ({ website, district, state, max_pages = 4 }) => {
      const origin = (() => { try { return new URL(website).origin; } catch { return null; } })();
      if (!origin) return fail(`'${website}' is not a usable URL.`);

      // A Simbli URL is not a page to crawl; it is a policy system with an index. Hand it straight over.
      if (/simbli\.eboardsolutions\.com/i.test(website)) {
        const site = simbliSiteId(website);
        return text({
          district: district ?? null, state: state ?? null, website,
          board_policy_system: site ? { vendor: "Simbli (eBOARDsolutions)", site } : { vendor: "Simbli (eBOARDsolutions)", site: null },
          candidates: [],
          next: site
            ? `This district's policy lives on Simbli, which serves nothing to a plain fetch. Call fetch_simbli_policy with site ${site}.`
            : "This is a Simbli URL but it carries no S= district key; find the district's own policy link, which does.",
        });
      }
      const HUB = /parent|student|famil|handbook|conduct|polic|document|resource|about|district/i;
      const seen = new Set(), queue = [website];
      const candidates = [];
      const policySystems = new Map();
      let pages = 0, apptegy = null;
      while (queue.length && pages < max_pages) {
        const page = queue.shift();
        if (seen.has(page)) continue;
        seen.add(page);
        let got; try { got = await getText(page, fetchImpl); } catch { continue; }
        pages++;
        if (!apptegy && /api\/v2\/s\/\d+\/documents/.test(got.html)) {
          apptegy = await apptegyDocuments(got.html, fetchImpl);
          for (const d of apptegy?.documents ?? []) {
            if (!HANDBOOK.test(`${d.title} ${d.folder}`)) continue;
            if (candidates.some((c) => c.url === d.url)) continue;
            candidates.push({ title: d.title, url: d.url, vendor: d.vendor, school_year: schoolYearFrom(`${d.title} ${d.folder}`), found_on: `${d.folder ?? "CMS"} (Apptegy CMS section ${apptegy.section})` });
          }
        }
        for (const l of links(got.html, got.final)) {
          const hay = `${l.text} ${safe(l.url)}`;
          // Board policy usually is not a file at all: it is a link out to a policy vendor. Note it,
          // because the tool that reads that vendor is the answer for this district.
          if (/simbli\.eboardsolutions\.com/i.test(l.url)) {
            const site = simbliSiteId(l.url);
            if (site && !policySystems.has(site)) policySystems.set(site, { vendor: "Simbli (eBOARDsolutions)", site, read_with: "fetch_simbli_policy", found_on: got.final, link_text: l.text.slice(0, 120) || null });
          } else if (/pol\.tasb\.org/i.test(l.url)) {
            const key = l.url.match(/[?&]key=(\d{1,6})/i)?.[1] ?? l.url.match(/\/Code\/(\d{1,6})/i)?.[1];
            if (key && !policySystems.has(key)) policySystems.set(key, { vendor: "TASB Policy Online", district_key: key, read_with: "fetch_tasb_policy", found_on: got.final, link_text: l.text.slice(0, 120) || null });
          }
          const isDoc = /\.(pdf|docx?)(\?|#|$)/i.test(l.url) || DOC_HOSTS.some((d) => l.url.includes(d.host));
          if (HANDBOOK.test(hay) && isDoc) {
            const vendor = DOC_HOSTS.find((d) => l.url.includes(d.host))?.vendor ?? "district site";
            const download = googlePdf(l.url) ?? l.url;
            if (!candidates.some((c) => c.url === download)) {
              candidates.push({ title: l.text.slice(0, 120) || null, url: download, original_link: download === l.url ? undefined : l.url, vendor, school_year: schoolYearFrom(hay), found_on: got.final });
            }
          }
        }
        if (pages < max_pages) {
          for (const l of links(got.html, got.final)) {
            try { if (new URL(l.url).origin !== origin) continue; } catch { continue; }
            if (HUB.test(`${l.text} ${l.url}`) && !/\.(pdf|docx?|jpe?g|png)(\?|#|$)/i.test(l.url) && !seen.has(l.url) && queue.length < 12) queue.push(l.url);
          }
        }
      }
      const rank = (c) => (c.school_year ? Number(c.school_year.slice(0, 4)) : 0);
      candidates.sort((a, b) => rank(b) - rank(a));
      const systems = [...policySystems.values()];
      return text({
        district: district ?? null, state: state ?? null, website, pages_examined: pages,
        ...(apptegy ? { apptegy_cms_section: apptegy.section, apptegy_documents_found: apptegy.documents.length } : {}),
        candidates,
        board_policy_systems: systems,
        next: candidates.length
          ? "Pass the newest candidate to fetch_document. Check its school_year against the current one before quoting it."
          : systems.length
            ? `No handbook file, but this district publishes board policy through ${systems.map((x) => x.vendor).join(" and ")}. Call ${systems[0].read_with} with ${systems[0].site ?? systems[0].district_key}. Board policy is the better source anyway: it is what the board voted on.`
            : "Nothing found. The site is probably JavaScript-rendered or behind a bot challenge; read it yourself and submit with source_text, and file a report_issue so the pattern gets added.",
      });
    }
  );

  server.registerTool(
    "fetch_tasb_policy",
    {
      title: "Read a Texas district's board policy",
      description:
        "Texas districts publish board policy through TASB Policy Online, which serves text to a browser but refuses a plain server fetch. This reads it for you. " +
        "FO(LOCAL) is the corporal punishment policy; FO(LEGAL) is the statute it rests on. Returns each separately with the update number and issue date from the footer, which is how you date the policy. " +
        "The district key is the number in a pol.tasb.org URL, for example 1133 for Mount Pleasant ISD.",
      inputSchema: {
        district_key: z.string().regex(/^\d{1,6}$/).describe("The district's TASB key, the number in pol.tasb.org/Policy/Code/<key>"),
        code: z.string().trim().default("FO").describe("Policy code, e.g. FO for student discipline and corporal punishment"),
        include_legal: z.boolean().optional().describe("Also return the full LEGAL body (default false). LEGAL is the state statute, identical in every district, and roughly 35,000 characters; it never establishes a district's own policy, so a scan does not need it. Its update and issue date come back either way."),
      },
    },
    async ({ district_key, code = "FO", include_legal = false }) => {
      // Policy/Code redirects here; go straight to it.
      const url = `https://pol.tasb.org/PolicyOnline/PolicyDetails?key=${district_key}&code=${encodeURIComponent(code)}`;
      let got;
      // Same amplification that broke Simbli: an agent reads a district's policy, then every agent
      // checking that agent's quote reads it again. Twenty Texas districts scanned and re-checked put
      // TASB over its limit and thirteen came back "none could open the source" -- unverifiable
      // findings about a source that had answered minutes earlier. Held for an hour, and paced.
      const cached = tasbCache.get(url);
      if (cached && Date.now() - cached.at < TASB_TTL_MS) got = cached.got;
      else {
        await tasbTurn();
        // What a rendered TASB policy page has that a stub does not.
        //
        // The marker alone is not enough: the navigation index lists "FO(LOCAL)" as a link label, so a
        // 70,000-byte page of nav passes a marker test while containing none of the policy. On a real
        // page the first marker sits at byte 793,671 of 875,082 -- the body comes first and the marker
        // closes it -- so size is the honest signal, together with the DATE ISSUED footer that only
        // appears when a section actually rendered. Smallest real page seen is several hundred KB.
        const wantsPolicy = (html) =>
          html.length > 200_000 &&
          /DATE ISSUED/i.test(html) &&
          new RegExp(`${code}\\((LOCAL|LEGAL|REGULATION|EXHIBIT)\\)`, "i").test(html);
        try { got = await getText(url, vendorFetch, wantsPolicy); } catch (err) { return fail(`TASB returned ${err.message} for key ${district_key}. Check the key, or read it yourself and submit with source_text.`); }
        tasbCache.set(url, { at: Date.now(), got });
      }
      const plain = got.html
        .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
        .replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

      // On TASB the FO(LOCAL) / FO(LEGAL) marker sits at the END of its section, followed by the
      // district name and the update footer. So a section runs backwards from its marker to the
      // previous marker (or the start of the policy body).
      const markerRe = new RegExp(`${code}\\((LOCAL|LEGAL|REGULATION|EXHIBIT)\\)`, "gi");
      const markers = [...plain.matchAll(markerRe)].map((m) => ({ label: m[1].toUpperCase(), start: m.index, end: m.index + m[0].length }));
      const bodies = {};
      let prevEnd = 0;
      for (const mk of markers) {
        const body = plain
          .slice(prevEnd, mk.start)
          // drop the district-name line that trails each section
          .replace(/\s*[A-Z][A-Z .'-]{3,60}\s*$/, "")
          .replace(/\s+/g, " ")
          .trim();
        if (body.length > 200 && !bodies[mk.label]) bodies[mk.label] = body.slice(0, 40000);
        prevEnd = mk.end;
      }
      // Each section is preceded by the page's table of contents; drop it.
      const trimNav = (t) => {
        if (!t) return t;
        const head = t.slice(0, 2500);
        const m = [...head.matchAll(/Adopted:\s*[0-9/]{6,10}/g)].pop();
        return m ? t.slice(m.index + m[0].length).trim() : t;
      };
      const cut = (label) => (bodies[label] ? trimNav(bodies[label]) : null);
      // Districts date a policy either "UPDATE 126" (a TASB-wide release) or "LDU 2016.07" (a local
      // district update). Austin uses the second, and reading only the first dated its local policy
      // from someone else's release.
      const footerFrom = (t) => {
        const m = String(t ?? "").match(/(UPDATE\s+\d+|LDU\s+[0-9.]+)\s*DATE ISSUED:?\s*([0-9/\-]+)/i);
        return m ? { update: m[1].replace(/\s+/g, " ").toUpperCase(), date_issued: m[2] } : null;
      };
      const footer = plain.match(/(?:UPDATE\s+\d+|LDU\s+[0-9.]+)\s*DATE ISSUED:?\s*([0-9/\-]+)/i);
      const local = cut("LOCAL"), legal = cut("LEGAL");
      if (!local && !legal) {
        // TASB answers 200 with a member picker when the key matches no district, so the tell is the
        // page's size and its "Change Active Member" prompt, not an error code.
        const noMember = plain.length < 4000 && /Change Active Member|part of the name of a member/i.test(plain);
        return fail(
          noMember
            ? `TASB served its member picker instead of a policy manual for key ${district_key}. Checked against other policy codes and against the manual root, it does the same every time, so this district's manual is not currently being published: it has left Policy Online, withdrawn the manual, or changed key. This is not a fault in the key you passed and not a temporary error worth retrying.`
            : plain.length < 40_000
              ? `TASB served only ${plain.length} characters for this key -- a real policy page is several hundred thousand. This address is being given a stub rather than the manual, which is a fetch problem and not a missing policy. Read it yourself and submit with source_text.`
              : "TASB answered but no LOCAL or LEGAL section was found for this code.",
          {
            url, chars: plain.length, truncated: got.truncated ?? false,
            next: noMember
              ? "Go to the district's own site instead: find its board policy or student handbook, read the corporal punishment section there, and submit with source_text. Do not record the district as unknown on the strength of this alone -- TASB not carrying a manual says nothing about what the district does."
              : "Check the policy code, or read it yourself and submit with source_text.",
          }
        );
      }
      // Hand back the sentences that matter rather than making the agent scan 7,000 characters.
      const terms = ctx.crew.crew.document_terms ?? ["corporal punishment"];
      const hits = [];
      for (const [label, body] of [["LOCAL", local], ["LEGAL", legal]]) {
        if (!body) continue;
        const low = body.toLowerCase();
        for (const term of terms) {
          const t = String(term).toLowerCase();
          let i = 0, n = 0;
          while (n < 3) {
            const at = low.indexOf(t, i);
            if (at < 0) break;
            const s0 = Math.max(0, at - 220), e0 = Math.min(body.length, at + t.length + 320);
            hits.push({ section: label, term, context: (s0 ? "… " : "") + body.slice(s0, e0).trim() + (e0 < body.length ? " …" : "") });
            i = at + t.length; n++;
          }
        }
      }

      // Cache the LOCAL text under the URL a finding will cite, so submit_finding verifies against the
      // text this agent actually read rather than downloading a megabyte of policy manual again.
      if (local && local.length > 200) documents?.put?.(url, local, { content_type: "text/html", extracted_by: "tasb-local" });

      const localFooter = footerFrom(bodies.LOCAL ? plain.slice(0, (markers.find((m) => m.label === "LOCAL")?.end ?? 0) + 400) : null);
      const out = {
        district_key, code, source: url,
        hits,
        local,
        local_chars: local ? local.length : 0,
        legal_chars: legal ? legal.length : 0,
        update: localFooter?.update ?? (footer ? footer[0].replace(/\s*DATE ISSUED[\s\S]*$/i, "").replace(/\s+/g, " ").toUpperCase() : null),
        date_issued: localFooter?.date_issued ?? (footer ? footer[1] : null),
        note: "Quote LOCAL for what this district does; LEGAL is the statute and is identical across districts, so it does not establish a district's own policy.",
      };
      if (include_legal) out.legal = legal;
      else if (legal) out.legal_omitted = "LEGAL is the state statute, the same in every district. Pass include_legal true if you actually need it.";
      if (got.truncated) out.warning = `The page was ${got.source_chars} characters and was read up to ${MAX_HTML_CHARS}; a section may be missing. Report this.`;
      return text(out);
    }
  );

  server.registerTool(
    "fetch_simbli_policy",
    {
      title: "Read a district's board policy on Simbli",
      description:
        "Simbli (eBOARDsolutions) carries board policy for much of Alabama, Georgia and Kentucky. Its pages are JavaScript-only, so a plain fetch of a Simbli URL returns navigation and no policy; this reads the same data the page reads. " +
        "Called with only a district, it returns the whole policy index — every code, title, revision id and revision date — so you can see what the district actually has. Add a code or terms and it also returns the text of the matching policy, the passages mentioning corporal punishment, and the date the policy was last revised, which is how you date it. " +
        "The text is cached against the ViewPolicy URL, so submit that URL as `source` and your quote verifies against what you read here. " +
        "Reading a district a second time is free: the index is cached for an hour and a policy already read is served from the server's copy without touching Simbli, so verifying somebody else's finding costs the vendor nothing. Codes differ by district: Etowah County calls it 6.17 Corporal Punishment, Blount County has it inside 05.13 Discipline. Search by term, not by an assumed code.",
      inputSchema: {
        site: z.string().trim().min(2).describe("The district's Simbli key: the number after S= in a simbli.eboardsolutions.com URL, or the whole URL"),
        code: z.string().trim().optional().describe("An exact policy code from the index, e.g. '6.17'"),
        revid: z.string().trim().optional().describe("A revision id from the index, when you already know which policy you want"),
        terms: z.array(z.string().min(3)).optional().describe("Match policy titles against these. Defaults to corporal punishment and discipline."),
        full_index: z.boolean().optional().describe("Return every policy in the index rather than the matches (default false)"),
      },
    },
    async ({ site: siteArg, code, revid, terms, full_index = false }) => {
      const site = simbliSiteId(siteArg);
      if (!site) return fail(`'${siteArg}' does not contain a Simbli district key. Look for S=<number> in the district's policy URL.`);

      let index;
      try { index = await simbliListing(site, fetchImpl); }
      catch (err) { return fail(err.message, { site, next: "Check the S= number against the district's own policy link, then file a report_issue if it looks right." }); }
      index.fetchImpl = fetchImpl;

      const match = terms?.length ? terms : ["corporal punishment", "discipline", "student conduct"];
      const wanted = revid ? index.policies.filter((p) => p.revid === revid)
        : code ? index.policies.filter((p) => p.code === code)
        : index.policies.filter((p) => match.some((t) => (p.title ?? "").toLowerCase().includes(String(t).toLowerCase())));

      const out = {
        site,
        sections: index.sections,
        policies_in_index: index.policies.length,
        matched: wanted.map((p) => ({ code: p.code, title: p.title, last_revised: p.last_revised, url: p.url })),
      };
      if (full_index) out.index = index.policies;

      if (!wanted.length) {
        out.next = `Nothing in the index matched. ${index.policies.length} policies are published; call again with full_index true to see them all, then pass the code you want.`;
        return text(out);
      }

      // Read the matches, newest section of the manual first. Two is enough to settle the question
      // and keeps a 170-policy district from turning into 170 requests.
      const docTerms = ctx.crew.crew.document_terms ?? ["corporal punishment"];
      out.policies = [];
      for (const p of wanted.slice(0, 3)) {
        let got;
        // Already read this policy? Use the copy the server kept. A verifier re-reading a district to
        // check someone else's quote is the commonest reason this tool is called twice, and going back
        // to Simbli for text we already hold is how a fleet rate-limits itself out of its own work.
        // read(), not get(): get() would FETCH a url it has not seen, and fetching a Simbli url returns
        // the JavaScript shell rather than the policy. read() only ever answers from the cache.
        const cached = documents?.read?.(p.url);
        if (cached?.text && cached.text.length > 100) {
          got = { text: cached.text, page: cached.final_url ?? p.url, from_cache: true };
        } else {
          try { got = await simbliPolicy(index, site, p.revid); }
          catch (err) { out.policies.push({ code: p.code, title: p.title, url: p.url, error: err.message }); continue; }
        }

        // Cache it under the URL a person would cite, so submit_finding can verify against this text.
        if (!got.from_cache && got.text.length > 100) documents?.put?.(p.url, got.text, { content_type: "text/html", extracted_by: "simbli-api", final_url: got.page });

        const low = got.text.toLowerCase();
        const hits = [];
        for (const t of docTerms) {
          const needle = String(t).toLowerCase();
          let i = 0, n = 0;
          while (n < 3) {
            const at = low.indexOf(needle, i);
            if (at < 0) break;
            const s0 = Math.max(0, at - 240), e0 = Math.min(got.text.length, at + needle.length + 360);
            hits.push({ term: t, context: (s0 ? "\u2026 " : "") + got.text.slice(s0, e0).replace(/\s+/g, " ").trim() + (e0 < got.text.length ? " \u2026" : "") });
            i = at + needle.length; n++;
          }
        }
        out.district ??= got.district ?? null;
        out.policies.push({
          code: p.code, title: p.title, url: p.url,
          last_revised: p.last_revised, originally_adopted: p.originally_adopted, status: p.status,
          chars: got.text.length, attachments: got.attachments,
          hits, text: got.text.slice(0, 40000),
        });
      }
      out.next = "Cite the policy's `url` as `source` and quote from its `text`. `last_revised` is the date the district last touched it; use that, not today. If a policy has attachments, they are not in this text.";
      return text(out);
    }
  );

  return ["resolve_handbook", "fetch_tasb_policy", "fetch_simbli_policy"];
}
