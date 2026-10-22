// --- BoardDocs (Diligent) ---------------------------------------------------------------------------
// BoardDocs carries board policy for much of Florida and Tennessee and a long tail elsewhere. The Public
// page is a jQuery shell; the policy list, each policy and the site search are POSTs the page makes to
// Domino agents under Board.nsf. Those answer a plain form POST with no session or cookies, so no
// browser is needed. Measured 2026-10-10 against fl/pcsfl, fla/vcsfl, fl/hendry, tn/scsk12, fla/orcpsfl.
//
// CloudFront in front of go.boarddocs.com answers 403 to anything that does not look like a browser:
// a bare `Mozilla/5.0` or the crawler string alone is refused. The campaign UA is accepted.
import { htmlToPlain, termHits, ttlCache, pacer, norm } from "./policy-text.mjs";

const BD = "https://go.boarddocs.com";

// The state segment is not always the postal code: Orange and Volusia live under fla/, Pinellas and
// Hendry under fl/. A bare site name is tried under each.
const STATE_SEGMENTS = { fl: ["fl", "fla"] };

export function boardDocsPaths(site, state) {
  const s = String(site ?? "").trim();
  const url = s.match(/boarddocs\.com\/([a-z]{2,5})\/([A-Za-z0-9_-]+)/i);
  if (url) return [`${url[1].toLowerCase()}/${url[2]}`];
  const path = s.match(/^\/?([a-z]{2,5})\/([A-Za-z0-9_-]+)\/?$/i);
  if (path) return [`${path[1].toLowerCase()}/${path[2]}`];
  if (/^[A-Za-z0-9_-]+$/.test(s) && state) {
    const st = String(state).toLowerCase();
    return (STATE_SEGMENTS[st] ?? [st]).map((x) => `${x}/${s}`);
  }
  return [];
}

export const boardDocsUrl = (path, id) => `${BD}/${path}/Board.nsf/goto?open&id=${id}`;

const turn = pacer(750);
const indexCache = ttlCache(60 * 60 * 1000);
const itemCache = ttlCache(60 * 60 * 1000);

async function post(path, agent, form, { fetchImpl, ua, timeout = 30000 }) {
  await turn();
  const res = await fetchImpl(`${BD}/${path}/Board.nsf/${agent}?open`, {
    method: "POST",
    headers: {
      "User-Agent": ua,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      Accept: "text/html, */*; q=0.01",
      Referer: `${BD}/${path}/Board.nsf/Public`,
    },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(timeout),
  });
  return { status: res.status, body: await res.text() };
}

// Every book the site publishes and every active policy in it. Null when the path is not a BoardDocs site.
async function listing(path, opts) {
  const hit = indexCache.get(path);
  if (hit) return { ...hit, from_cache: true };
  const b = await post(path, "BD-GetPolicyBooks", {}, opts);
  if (b.status === 404) return null;
  if (b.status === 403) throw new Error(`BoardDocs refused the request for ${path} (HTTP 403). Its CDN blocks non-browser clients; if this persists, file a report_issue.`);
  if (b.status !== 200) throw new Error(`BoardDocs answered HTTP ${b.status} listing policy books for ${path}.`);
  const books = [...b.body.matchAll(/role="menuitem" aria-label="([^"]*)"/g)].map((m) => htmlToPlain(m[1]));
  const policies = [];
  for (const book of books) {
    const r = await post(path, "BD-GetPolicies", { status: "active", book }, opts);
    if (r.status !== 200) continue;
    let section = null;
    for (const m of r.body.matchAll(/<section\b[^>]*>([\s\S]*?)<\/section>|<a\b[^>]*\bunique=\s*"([A-Z0-9]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
      if (m[1] !== undefined) { section = htmlToPlain(m[1].replace(/<!--[\s\S]*?-->/g, "")); continue; }
      const code = htmlToPlain(m[3].match(/<b>([\s\S]*?)<\/b>/)?.[1] ?? "") || null;
      const title = htmlToPlain(m[3].replace(/<b>[\s\S]*?<\/b>/, "").replace(/<div class="icons">[\s\S]*$/, ""));
      policies.push({ id: m[2], code, title, book, section, url: boardDocsUrl(path, m[2]) });
    }
  }
  return indexCache.set(path, { path, books, policies });
}

// Site search covers policy bodies, agenda items, minutes and attachments. It returns nothing at all
// unless every content filter the page sends is present, even when only policies are wanted.
async function search(path, query, opts) {
  const r = await post(path, "SEARCH", { searchstring: query, meetings: "1", policies: "1", library: "1", minutes: "1", attachments: "1" }, { ...opts, timeout: 60000 });
  if (r.status !== 200) throw new Error(`BoardDocs search answered HTTP ${r.status}.`);
  const out = [];
  for (const block of r.body.split(/(?=<div class="result )/)) {
    const head = block.match(/^<div class="result [^"]*" type="([^"]*)" unique="([^"]*)"(?: parentunique="([^"]*)")?/);
    if (!head) continue;
    const divs = [...block.matchAll(/<div(?: class="(\w+)")?>([\s\S]*?)<\/div>/g)].map((m) => ({ cls: m[1] ?? null, text: htmlToPlain(m[2]) }));
    const href = block.match(/class="file" href="([^"]+)"/)?.[1];
    out.push({
      type: head[1], id: head[2], parent_id: head[3] ?? null,
      title: divs.filter((d) => !d.cls)[1]?.text ?? divs.find((d) => !d.cls)?.text ?? null,
      summary: divs.find((d) => d.cls === "htmlsummary")?.text ?? null,
      date: divs.find((d) => d.cls === "date")?.text ?? null,
      on: divs.find((d) => d.cls === "parentdescription")?.text ?? null,
      url: href ? new URL(href, BD).toString() : head[1] === "policy" ? boardDocsUrl(path, head[2]) : null,
    });
  }
  return out;
}

async function readItem(path, id, opts) {
  const key = `${path}#${id}`;
  const hit = itemCache.get(key);
  if (hit) return hit;
  const r = await post(path, "BD-GetPolicyItem", { id }, opts);
  if (r.status !== 200 || !/view-policy-item/.test(r.body)) throw new Error(`BoardDocs has no public policy ${id} on ${path} (HTTP ${r.status}). Ids come from the listing; re-read it.`);
  const meta = {};
  for (const m of r.body.matchAll(/<div class="col leftcol">([\s\S]*?)<\/div><div class="col rightcol">([\s\S]*?)<\/div>/g)) meta[htmlToPlain(m[1])] = htmlToPlain(m[2]);
  const start = r.body.indexOf('key="publicbody">');
  const end = r.body.indexOf('filetype="public"');
  const body = start >= 0 ? r.body.slice(start + 17, end > start ? end : undefined) : "";
  const f = await post(path, "BD-GetPublicFiles", { id }, opts);
  const files = f.status === 200
    ? [...f.body.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => ({ name: htmlToPlain(m[2]), url: new URL(m[1], BD).toString() }))
    : [];
  return itemCache.set(key, { meta, text: htmlToPlain(body), files });
}

const STUDENT_DISCIPLINE = (t) => /corporal|paddl|physical punish/i.test(t) || (/student|pupil/i.test(t) && /disciplin|conduct|behavio/i.test(t));
const NOT_K12 = /postsecondary|adult|employee|staff|administrator|personnel|board member/i;

export function registerBoardDocs(server, { z, text, fail, documents, fetchImpl, ua, terms }) {
  const opts = { fetchImpl, ua };
  const docTerms = terms?.length ? terms : ["corporal punishment"];
  server.registerTool(
    "fetch_boarddocs_policy",
    {
      title: "Read a district's board policy on BoardDocs",
      description:
        "BoardDocs (go.boarddocs.com/<state>/<site>/Board.nsf/Public) carries board policy for much of Florida and Tennessee. The page is JavaScript-driven, so a plain fetch gets navigation and no policy; this reads the same data the page reads. " +
        "Pass the site as it appears in the district's BoardDocs URL ('fl/pcsfl', 'fla/vcsfl', or the whole URL). Called with only a site, it runs BoardDocs' own full-text search for corporal punishment, matches policy titles about student discipline, and returns the text of the best matches with their adopted and revised dates as printed. " +
        "Add a code ('5500.07', '6022') or a policy id to read one policy, terms to match titles, or query to search other wording. Some districts (Volusia, Memphis-Shelby) publish the policy only as an attached PDF; those attachments are read too and their URL is what you cite.",
      inputSchema: {
        site: z.string().trim().min(2).describe("The BoardDocs site: 'fl/pcsfl', 'fla/vcsfl', a go.boarddocs.com URL, or the bare site name together with state"),
        state: z.string().trim().length(2).optional().describe("Two-letter state, only needed when site is a bare name like 'pcsfl'"),
        policy_id: z.string().trim().regex(/^[A-Z0-9]{8,16}$/).optional().describe("A policy's BoardDocs id (the id= in a goto link), when you already know which policy you want"),
        code: z.string().trim().optional().describe("A policy code from the index, e.g. '5500.07', '6022', '208'"),
        terms: z.array(z.string().min(3)).optional().describe("Match policy titles against these instead of the default student-discipline match"),
        query: z.string().trim().min(3).optional().describe("Run BoardDocs' full-text search for this (default 'corporal punishment' when nothing else is given)"),
        limit: z.number().int().min(1).max(6).optional().describe("How many matching policies to read in full (default 3)"),
        full_index: z.boolean().optional().describe("Return every policy in the index (default false)"),
      },
    },
    async ({ site, state, policy_id, code, terms: titleTerms, query, limit = 3, full_index = false }) => {
      const paths = boardDocsPaths(site, state);
      if (!paths.length) return fail(`'${site}' is not a BoardDocs site. Pass the '<state>/<site>' segment from the district's go.boarddocs.com URL, e.g. 'fl/pcsfl', or a bare site name with state.`);
      let path = null, index = null;
      try {
        for (const p of paths) { index = await listing(p, opts); if (index) { path = p; break; } }
      } catch (err) { return fail(err.message, { tried: paths }); }
      if (!path) return fail(`BoardDocs has no site at ${paths.map((p) => `${BD}/${p}`).join(" or ")}.`, { next: "Open the district's own board-policy link and pass the '<state>/<site>' part of its go.boarddocs.com URL exactly; Florida districts use both fl/ and fla/." });

      const out = { site: path, public_page: `${BD}/${path}/Board.nsf/Public`, books: index.books, policies_in_index: index.policies.length };
      if (!index.policies.length) out.no_policy_book = "This BoardDocs site publishes no policy book. The district keeps its policy somewhere else (Orange County FL, for one, publishes on its own website); BoardDocs here holds only meetings. Search results below are meeting documents, not adopted policy.";
      if (full_index) out.index = index.policies;

      const byId = new Map(index.policies.map((p) => [p.id, p]));
      const picked = [];
      const add = (p) => { if (p && !picked.some((x) => x.id === p.id)) picked.push(p); };
      if (policy_id) add(byId.get(policy_id) ?? { id: policy_id, url: boardDocsUrl(path, policy_id) });
      else if (code) {
        const want = norm(code);
        for (const p of index.policies) {
          const c = norm(p.code), lead = norm(String(p.code ?? "").split(/\s+-\s+|\s/)[0]);
          if (c === want || lead === want || c.replace(/^[a-z]+(?=\d)/, "") === want) add(p);
        }
      } else if (titleTerms?.length) {
        for (const p of index.policies) if (titleTerms.some((t) => `${p.code ?? ""} ${p.title}`.toLowerCase().includes(String(t).toLowerCase()))) add(p);
      }
      const runSearch = query || (!policy_id && !code && !titleTerms?.length);
      if (runSearch) {
        const q = query ?? docTerms[0];
        let results = [];
        try { results = await search(path, q, opts); }
        catch (err) { out.search_error = `${err.message} The title match below still ran.`; }
        const pol = results.filter((r) => r.type === "policy");
        out.search = {
          query: q,
          policy_results: pol.map((r) => ({ id: r.id, title: r.title, summary: r.summary, in_active_index: byId.has(r.id), url: r.url })),
          other_results: results.filter((r) => r.type !== "policy").slice(0, 10).map(({ type, title, date, on, url }) => ({ type, title, date, on, url })),
          other_results_total: results.filter((r) => r.type !== "policy").length,
        };
        // Search matches staff-discipline and adult-education codes as readily as the K-12 one, and only
        // ranks by its own relevance. Inactive policies are reported above but not read as current.
        const ql = q.toLowerCase();
        const score = (r) => ((r.summary ?? "").toLowerCase().includes(ql) ? 2 : 0) + (STUDENT_DISCIPLINE(r.title ?? "") ? 2 : 0) - (NOT_K12.test(r.title ?? "") ? 3 : 0);
        const ranked = pol.filter((r) => byId.has(r.id)).sort((a, b) => score(b) - score(a));
        if (!policy_id && !code && !titleTerms?.length) for (const p of index.policies) if (/corporal|paddl/i.test(p.title)) add(p);
        for (const r of ranked) add(byId.get(r.id));
        if (!policy_id && !code && !titleTerms?.length) for (const p of index.policies) if (STUDENT_DISCIPLINE(p.title)) add(p);
      }
      out.matched = picked.map(({ id, code: c, title, url }) => ({ id, code: c, title, url }));
      if (!picked.length) {
        out.next = index.policies.length
          ? `Nothing matched. ${index.policies.length} policies are published; call again with full_index true and pass the code you want.`
          : "No policy book here. Find where the district publishes board policy (its own site, or a handbook) and read that instead.";
        return text(out);
      }

      out.policies = [];
      for (const p of picked.slice(0, limit)) {
        let item;
        try { item = await readItem(path, p.id, opts); }
        catch (err) { out.policies.push({ id: p.id, code: p.code, title: p.title, url: p.url, error: err.message }); continue; }
        const m = item.meta;
        const url = boardDocsUrl(path, p.id);
        const header = ["Book", "Section", "Title", "Code", "Status", "Adopted", "Last Revised", "Prior Revised Dates", "Last Reviewed"]
          .filter((k) => m[k]).map((k) => `${k}: ${m[k]}`).join("\n");
        // The goto page serves this same text to a plain fetch; caching it anyway means the quote is
        // checked against exactly what was read here.
        if (item.text.length > 100) documents?.put?.(url, `${header}\n\n${item.text}`, { content_type: "text/html", extracted_by: "boarddocs-policyitem" });
        const entry = {
          id: p.id, code: m.Code ?? p.code ?? null, title: m.Title ?? p.title ?? null, book: m.Book ?? p.book ?? null, section: m.Section ?? p.section ?? null,
          status: m.Status ?? null, adopted: m.Adopted ?? null, last_revised: m["Last Revised"] ?? null,
          ...(m["Prior Revised Dates"] ? { prior_revised: m["Prior Revised Dates"] } : {}),
          ...(m["Last Reviewed"] ? { last_reviewed: m["Last Reviewed"] } : {}),
          url, chars: item.text.length, hits: termHits(item.text, docTerms), text: item.text.slice(0, 40000),
        };
        if (item.files.length) {
          entry.attachments = [];
          // The body is empty on districts that post the policy as a PDF; read those. Where the body
          // already answers, attachments are listed but not downloaded.
          const readFiles = !entry.hits.length && documents?.get;
          for (const f of item.files) {
            if (!readFiles || !/\.pdf(\?|$)/i.test(f.url) || entry.attachments.filter((a) => a.chars !== undefined).length >= 2) { entry.attachments.push(f); continue; }
            try {
              const doc = await documents.get(f.url);
              const hits = termHits(doc.text, docTerms);
              entry.attachments.push({ ...f, chars: doc.text.length, pages: doc.page_count, extracted_by: doc.extracted_by, hits, ...(item.text.length < 500 ? { text: doc.text.slice(0, 40000) } : {}) });
            } catch (err) { entry.attachments.push({ ...f, error: err.message }); }
          }
        }
        entry.cite = entry.hits.length ? url : entry.attachments?.find((a) => a.hits?.length)?.url ?? url;
        out.policies.push(entry);
      }
      out.next = "Cite each policy's `cite` as `source` and quote from its text (or the attachment's). `adopted` and `last_revised` are as BoardDocs prints them; use `last_revised` to date the policy. A status other than Active means it is not current policy.";
      return text(out);
    }
  );
  return "fetch_boarddocs_policy";
}
