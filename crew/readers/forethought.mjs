// --- Forethought CAPS knowledge bases ----------------------------------------------------------------
// Forethought Consulting writes and hosts board policy for most Louisiana parishes. Its current viewer,
// app.forethoughtconsulting.com/kb/<board-slug>, is a Next.js app that renders nothing server-side: the
// manual is fetched by a server action, getKnowledgeBaseDocuments(slug), which returns every policy (and
// every set of board minutes) with full HTML in one React Server Components stream, 6-15 MB per board.
// Measured 2026-10-10 against lincoln-parish-school-board, east-baton-rouge-parish-school-board and
// st-tammany-parish-school-board.
//
// A server action is addressed by a build-specific id, not a name, so the id is scraped from the page's
// JavaScript and re-scraped whenever the app answers "Server action not found". The action refuses a
// POST without an Origin header (403).
//
// caps.forethoughtconsulting.com/kb/<uuid> is the older viewer and a different app; its uuid is not the
// slug and returns nothing from this action.
import { htmlToPlain, termHits, printedDates, ttlCache, norm } from "./policy-text.mjs";

const FT = "https://app.forethoughtconsulting.com";
const ACTION = "getKnowledgeBaseDocuments";

export function forethoughtSlug(input) {
  const s = String(input ?? "").trim();
  if (/caps\.forethoughtconsulting\.com/i.test(s)) return { caps: true };
  const m = s.match(/forethoughtconsulting\.com\/kb\/([a-z0-9-]+)/i);
  if (m) return { slug: m[1].toLowerCase() };
  return /^[a-z0-9][a-z0-9-]{2,80}$/i.test(s) ? { slug: s.toLowerCase() } : {};
}

export const forethoughtUrl = (slug, id) => `${FT}/kb/${slug}/manual?doc=${id}`;

// The React flight format: rows of `<hex id>:<json>\n`, except text rows, `<hex id>:T<hex byte length>,<bytes>`
// with no terminator. Values refer to other rows as "$<hex id>" (or "$@<hex id>" for a promise).
export function parseFlight(buf) {
  const rows = new Map();
  let i = 0;
  while (i < buf.length) {
    const colon = buf.indexOf(0x3a, i);
    if (colon < 0) break;
    const id = buf.subarray(i, colon).toString().trim();
    i = colon + 1;
    if (buf[i] === 0x54) {
      const comma = buf.indexOf(0x2c, i);
      const len = parseInt(buf.subarray(i + 1, comma).toString(), 16);
      rows.set(id, buf.subarray(comma + 1, comma + 1 + len).toString("utf8"));
      i = comma + 1 + len;
      continue;
    }
    let nl = buf.indexOf(0x0a, i);
    if (nl < 0) nl = buf.length;
    const line = buf.subarray(i, nl).toString("utf8");
    i = nl + 1;
    try { rows.set(id, JSON.parse(line)); } catch { rows.set(id, line); }
  }
  const resolve = (v, depth = 0) => {
    if (depth > 64) return v;
    if (typeof v === "string" && v[0] === "$") {
      if (v === "$undefined") return undefined;
      if (v.startsWith("$$")) return v.slice(1);
      if (v.startsWith("$D")) return v.slice(2);
      const ref = v.match(/^\$@?([0-9a-f]+)$/);
      return ref && rows.has(ref[1]) ? resolve(rows.get(ref[1]), depth + 1) : v;
    }
    if (Array.isArray(v)) return v.map((x) => resolve(x, depth + 1));
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolve(x, depth + 1)]));
    return v;
  };
  return resolve(rows.get("0"));
}

const actionCache = ttlCache(60 * 60 * 1000);
const docsCache = ttlCache(60 * 60 * 1000);

async function get(url, { fetchImpl, ua }, timeout = 30000) {
  const res = await fetchImpl(url, { headers: { "User-Agent": ua, Accept: "text/html,*/*" }, signal: AbortSignal.timeout(timeout) });
  return { status: res.status, body: await res.text() };
}

async function scrapeActionId(slug, opts) {
  const page = await get(`${FT}/kb/${slug}/manual`, opts);
  if (page.status === 404) return { missing: true };
  if (page.status !== 200) throw new Error(`Forethought answered HTTP ${page.status} for the ${slug} manual page.`);
  const chunks = [...new Set([...page.body.matchAll(/\/_next\/static\/chunks\/[A-Za-z0-9_.~-]+\.js(?:\?[^"'\s]*)?/g)].map((m) => m[0]))];
  const re = new RegExp(`createServerReference\\)\\("([0-9a-f]{20,})"[^)]{0,200}?"${ACTION}"`);
  for (let i = 0; i < chunks.length; i += 6) {
    const found = await Promise.all(chunks.slice(i, i + 6).map(async (c) => {
      try { return (await get(`${FT}${c}`, opts)).body.match(re)?.[1] ?? null; } catch { return null; }
    }));
    const id = found.find(Boolean);
    if (id) return { id };
  }
  throw new Error(`none of the ${chunks.length} scripts on the ${slug} manual page defines ${ACTION}. Forethought has changed how the manual loads; file a report_issue.`);
}

async function callAction(slug, actionId, { fetchImpl, ua }) {
  const res = await fetchImpl(`${FT}/kb/${slug}/manual`, {
    method: "POST",
    headers: {
      "User-Agent": ua,
      "Next-Action": actionId,
      Origin: FT,
      Accept: "text/x-component",
      "Content-Type": "text/plain;charset=UTF-8",
    },
    body: JSON.stringify([slug]),
    signal: AbortSignal.timeout(90000),
  });
  return { status: res.status, buf: Buffer.from(await res.arrayBuffer()) };
}

// Only the policies are kept: the minutes are most of the stream and none of what a scan cites.
async function knowledgeBase(slug, opts) {
  const hit = docsCache.get(slug);
  if (hit) return { ...hit, from_cache: true };
  let action = actionCache.get("id");
  let fresh = false;
  if (!action) {
    const s = await scrapeActionId(slug, opts);
    if (s.missing) return null;
    action = actionCache.set("id", s.id);
    fresh = true;
  }
  let r = await callAction(slug, action, opts);
  if (r.status === 404 && !fresh) {
    const s = await scrapeActionId(slug, opts);
    if (s.missing) return null;
    action = actionCache.set("id", s.id);
    r = await callAction(slug, action, opts);
  }
  if (r.status !== 200) throw new Error(`Forethought's ${ACTION} answered HTTP ${r.status}${r.buf.length < 200 ? `: ${r.buf.toString().trim()}` : ""}.`);
  const docs = parseFlight(r.buf)?.a;
  if (!Array.isArray(docs)) throw new Error(`Forethought's ${ACTION} answered in a shape this reader does not recognise (${r.buf.length} bytes). File a report_issue.`);
  const policies = docs
    .filter((d) => !d.is_folder && (d.document_type ?? d.documentType) === "policy")
    .map((d) => ({ id: d.id, title: String(d.title ?? "").trim(), status: d.status ?? null, updated_at: d.updated_at ?? d.updatedAt ?? null, html: d.content ?? "" }));
  return docsCache.set(slug, { slug, documents: docs.length, policies });
}

// "JDA, Corporal Punishment", "JGCFB - Behavioral Health Services"
const codeOf = (title) => title.match(/^([A-Z]{1,8}(?:-\d+)?)\s*(?:,|\s-\s)/)?.[1] ?? null;

export function registerForethought(server, { z, text, fail, documents, fetchImpl, ua, terms }) {
  const opts = { fetchImpl, ua };
  const docTerms = terms?.length ? terms : ["corporal punishment"];
  server.registerTool(
    "fetch_forethought_policy",
    {
      title: "Read a Louisiana district's board policy on Forethought CAPS",
      description:
        "Forethought Consulting hosts board policy for most Louisiana school boards at app.forethoughtconsulting.com/kb/<board-slug>, a JavaScript app that a plain fetch reads as empty. This loads the whole manual the way the page does and searches it. " +
        "Pass the board's slug (e.g. 'lincoln-parish-school-board') or its knowledge-base URL. Called with only that, it returns every policy whose text mentions corporal punishment, titles about it first, with the text and the passages. Louisiana's corporal punishment policy is usually JDA; GAMC (Investigations) often mentions it too. Add a code ('JDA') or terms to read particular policies. " +
        "Revision dates come from the policy's own revision history. The text is cached under the ?doc= URL returned, so submit that as `source`.",
      inputSchema: {
        kb: z.string().trim().min(3).describe("The board's knowledge-base slug or URL, e.g. 'east-baton-rouge-parish-school-board'"),
        code: z.string().trim().optional().describe("A policy code, e.g. 'JDA'"),
        terms: z.array(z.string().min(2)).optional().describe("Match policy titles against these"),
        limit: z.number().int().min(1).max(6).optional().describe("How many matching policies to return in full (default 3)"),
        full_index: z.boolean().optional().describe("Return every policy title in the manual (default false)"),
      },
    },
    async ({ kb, code, terms: titleTerms, limit = 3, full_index = false }) => {
      const { slug, caps } = forethoughtSlug(kb);
      if (caps) return fail("That is the older caps.forethoughtconsulting.com viewer, whose id this reader cannot use. The same board is published at app.forethoughtconsulting.com/kb/<board-name-slug>, e.g. 'st-tammany-parish-school-board'; pass that slug.");
      if (!slug) return fail(`'${kb}' is not a Forethought knowledge base. Pass the slug from app.forethoughtconsulting.com/kb/<slug>.`);
      let base;
      try { base = await knowledgeBase(slug, opts); }
      catch (err) { return fail(err.message, { kb: `${FT}/kb/${slug}` }); }
      if (!base) return fail(`Forethought has no knowledge base called '${slug}'. Slugs are the board's name in lower case with hyphens, e.g. 'lincoln-parish-school-board'.`);
      if (!base.policies.length) return fail(`The '${slug}' knowledge base exists but published no policies (${base.documents} documents, none of them policy).`);

      const out = { kb: `${FT}/kb/${slug}`, policies_in_manual: base.policies.length };
      if (full_index) out.index = base.policies.map((p) => ({ id: p.id, code: codeOf(p.title), title: p.title, status: p.status, url: forethoughtUrl(slug, p.id) }));
      const plain = new Map(base.policies.map((p) => [p.id, htmlToPlain(p.html)]));
      let wanted;
      if (code) wanted = base.policies.filter((p) => norm(codeOf(p.title)) === norm(code));
      else if (titleTerms?.length) wanted = base.policies.filter((p) => titleTerms.some((t) => p.title.toLowerCase().includes(String(t).toLowerCase())));
      else {
        const inText = base.policies.filter((p) => docTerms.some((t) => plain.get(p.id).toLowerCase().includes(String(t).toLowerCase())));
        const byTitle = (p) => Number(/corporal|paddl/i.test(p.title));
        wanted = inText.sort((a, b) => byTitle(b) - byTitle(a));
      }
      out.matched = wanted.map((p) => ({ id: p.id, code: codeOf(p.title), title: p.title, status: p.status, url: forethoughtUrl(slug, p.id) }));
      if (!wanted.length) {
        out.next = code || titleTerms?.length
          ? "Nothing matched. Call again with full_index true to see every policy title."
          : `No published policy in this manual mentions ${docTerms.join(", ")}. That is a finding about the policy manual, not about practice; check the student handbook too before recording the district.`;
        return text(out);
      }

      out.policies = wanted.slice(0, limit).map((p) => {
        const body = plain.get(p.id);
        const url = forethoughtUrl(slug, p.id);
        if (body.length > 100) documents?.put?.(url, body, { content_type: "text/html", extracted_by: "forethought-server-action" });
        const printed = printedDates(body);
        return {
          id: p.id, code: codeOf(p.title), title: p.title, status: p.status,
          adopted: printed.adopted, revised: printed.revised,
          latest_revised: body.match(/Latest revised\s*Revised:?\s*([A-Z][a-z]+\.? \d{1,2},? \d{4})/)?.[1] ?? printed.revised?.at(-1) ?? null,
          kb_updated_at: p.updated_at,
          url, chars: body.length, hits: termHits(body, docTerms), text: body.slice(0, 40000),
        };
      });
      out.next = "Cite the policy's `url` as `source` and quote from its `text`. Date it by `latest_revised`, which is the board's own revision history; `kb_updated_at` is when Forethought last republished the page. Forethought's site warns its copy may lag what the board adopted, so say in notes that the source is the Forethought-published manual.";
      return text(out);
    }
  );
  return "fetch_forethought_policy";
}
