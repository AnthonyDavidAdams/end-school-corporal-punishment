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

async function getText(url, fetchImpl) {
  const res = await fetchImpl(url, { headers: { "User-Agent": UA, Accept: "text/html,*/*" }, redirect: "follow", signal: AbortSignal.timeout(25000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const full = await res.text();
  return { html: full.slice(0, MAX_HTML_CHARS), final: res.url, truncated: full.length > MAX_HTML_CHARS, source_chars: full.length };
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

async function simbliGet(url, jar, fetchImpl, { json = false, referer } = {}) {
  await simbliTurn();
  const res = await fetchImpl(url, {
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

// The policy index: every code, title and revision id the district publishes.
async function simbliListing(site, fetchImpl) {
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

export async function registerTools(server, ctx, { z, text, fail, documents }) {
  const fetchImpl = ctx.fetchImpl ?? fetch;

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
      let pages = 0;
      while (queue.length && pages < max_pages) {
        const page = queue.shift();
        if (seen.has(page)) continue;
        seen.add(page);
        let got; try { got = await getText(page, fetchImpl); } catch { continue; }
        pages++;
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
      try { got = await getText(url, fetchImpl); } catch (err) { return fail(`TASB returned ${err.message} for key ${district_key}. Check the key, or read it yourself and submit with source_text.`); }
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
        "The text is cached against the ViewPolicy URL, so submit that URL as `source` and your quote verifies against what you read here. Codes differ by district: Etowah County calls it 6.17 Corporal Punishment, Blount County has it inside 05.13 Discipline. Search by term, not by an assumed code.",
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
        try { got = await simbliPolicy(index, site, p.revid); }
        catch (err) { out.policies.push({ code: p.code, title: p.title, url: p.url, error: err.message }); continue; }

        // Cache it under the URL a person would cite, so submit_finding can verify against this text.
        if (got.text.length > 100) documents?.put?.(p.url, got.text, { content_type: "text/html", extracted_by: "simbli-api", final_url: got.page });

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
