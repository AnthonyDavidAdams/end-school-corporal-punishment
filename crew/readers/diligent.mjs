// --- Diligent Community (formerly CivicWeb) --------------------------------------------------------
// Arkansas, South Carolina and some Florida districts publish policy through Diligent Community. The
// policy pages are a React app, so a plain fetch of a /document/<guid>/ link returns a shell with no
// policy in it. Behind it, the public folder tree answers a plain GET one level at a time, and the same
// /document/<guid>/ address with ?printPdf=true returns the policy as a real PDF. Measured 2026-10-10
// against nlrsd, bentonvillek12, greenville-sc and okaloosaschools.
//
// A tenant is reachable under three hostnames: <t>.diligent.community (redirects), <t>.community.highbond.com
// and <t>.community.diligentoneplatform.com. The last is where the others land, so it is the one cited.
import { termHits, printedDates, ttlCache, norm } from "./policy-text.mjs";

const HOST = /^([a-z0-9-]+)\.(?:diligent\.community|community\.diligentoneplatform\.com|community\.highbond\.com)$/i;

export function diligentTenant(input) {
  const s = String(input ?? "").trim();
  try { const h = new URL(s.includes("://") ? s : `https://${s}`).hostname; const m = h.match(HOST); if (m) return m[1].toLowerCase(); } catch { /* not a URL */ }
  return /^[a-z0-9][a-z0-9-]{1,40}$/i.test(s) ? s.toLowerCase() : null;
}

const base = (t) => `https://${t}.community.diligentoneplatform.com`;
export const diligentUrl = (t, guid) => `${base(t)}/document/${guid}/`;
const indexCache = ttlCache(60 * 60 * 1000);

async function getJson(url, { fetchImpl, ua }) {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetchImpl(url, { headers: { "User-Agent": ua, Accept: "application/json, text/plain, */*" }, signal: AbortSignal.timeout(30000) });
      const body = await res.text();
      let json; try { json = JSON.parse(body); } catch { json = undefined; }
      if (res.ok || res.status === 404) return { status: res.status, json };
      last = new Error(`HTTP ${res.status}`);
    } catch (err) { last = err; }
    await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
  }
  throw last;
}

// The listing answers one folder at a time; a district runs to 10-30 folders and 300-500 policies.
// Siblings are read four at a time, which keeps a cold index to about ten seconds.
async function listing(tenant, opts) {
  const hit = indexCache.get(tenant);
  if (hit) return { ...hit, from_cache: true };
  const root = await getJson(`${base(tenant)}/api/policies/policyPublicList`, opts);
  if (!Array.isArray(root.json)) return null;
  const policies = [];
  let level = [{ items: root.json, path: [] }];
  while (level.length) {
    const next = [];
    for (const { items, path } of level) {
      for (const p of items) {
        if (p.folder) next.push({ guid: p.guid, path: [...path, p.title] });
        else policies.push({ guid: p.guid, code: p.code || null, title: (p.title ?? "").trim(), folder: path.join(" / ") || null, extension: p.extension || null, modified: p.dateModified ?? null, url: diligentUrl(tenant, p.guid) });
      }
    }
    level = [];
    for (let i = 0; i < next.length; i += 4) {
      const batch = await Promise.all(next.slice(i, i + 4).map(async (f) => {
        const r = await getJson(`${base(tenant)}/api/policies/policyPublicList?id=${f.guid}`, opts).catch(() => null);
        return Array.isArray(r?.json) ? { items: r.json, path: f.path } : null;
      }));
      level.push(...batch.filter(Boolean));
    }
  }
  return indexCache.set(tenant, { tenant, policies });
}

// Codes live in the code field on some tenants and lead the title on others ("4.39 CORPORAL PUNISHMENT").
const codeOf = (p) => p.code || (p.title.match(/^\s*([A-Z]{0,4}[-\s]?\d[\w.-]*)\s/)?.[1] ?? null);

const STUDENT_DISCIPLINE = (t) => /corporal|paddl|physical punish/i.test(t) || (/student|pupil/i.test(t) && /disciplin|conduct|behavio/i.test(t));

export function registerDiligent(server, { z, text, fail, documents, fetchImpl, ua, terms }) {
  const opts = { fetchImpl, ua };
  const docTerms = terms?.length ? terms : ["corporal punishment"];
  server.registerTool(
    "fetch_diligent_policy",
    {
      title: "Read a district's board policy on Diligent Community",
      description:
        "Diligent Community (<district>.diligent.community, also *.community.diligentoneplatform.com and *.community.highbond.com; formerly CivicWeb) carries board policy for many Arkansas and South Carolina districts and some in Florida. Its policy pages are a JavaScript app, so a plain fetch of a /document/ link returns no policy; this walks the public policy tree and reads each policy's PDF rendering. " +
        "Called with only a tenant it returns the policies whose titles concern corporal punishment or student discipline, with their text, the passages mentioning corporal punishment, and the adopted and revised dates as printed in the policy. Add a code ('4.39', 'JD', '04-32') to read one policy, or terms to match titles. " +
        "The text is cached under the /document/<guid>/ URL, so submit that as `source` and the quote verifies against what you read here.",
      inputSchema: {
        tenant: z.string().trim().min(2).describe("The district's Diligent name (e.g. 'nlrsd', 'greenville-sc') or any URL on its Diligent site"),
        code: z.string().trim().optional().describe("A policy code, e.g. '4.39', 'JD', '04-32'"),
        guid: z.string().trim().regex(/^[0-9a-f-]{36}$/i).optional().describe("A policy's guid from the index or a /document/<guid>/ link"),
        terms: z.array(z.string().min(2)).optional().describe("Match policy titles against these instead of the default student-discipline match"),
        limit: z.number().int().min(1).max(6).optional().describe("How many matching policies to read in full (default 3)"),
        full_index: z.boolean().optional().describe("Return every policy in the index (default false)"),
      },
    },
    async ({ tenant: tenantArg, code, guid, terms: titleTerms, limit = 3, full_index = false }) => {
      const tenant = diligentTenant(tenantArg);
      if (!tenant) return fail(`'${tenantArg}' is not a Diligent Community site. Pass the first label of the hostname, e.g. 'nlrsd' from nlrsd.diligent.community.`);
      let index;
      try { index = await listing(tenant, opts); }
      catch (err) { return fail(`Diligent did not answer for ${tenant}: ${err.message}. This is usually transient; try again in a minute.`); }
      if (!index) return fail(`${base(tenant)} has no public policy library. Either '${tenant}' is not this district's Diligent name, or the district publishes meetings there but keeps policy elsewhere.`, { next: "Check the hostname on the district's own board-policy link. If the district's policy is somewhere else, read it there." });

      const out = { tenant, site: `${base(tenant)}/Portal/Policy.aspx`, policies_in_index: index.policies.length };
      if (full_index) out.index = index.policies.map(({ guid: g, code: c, title, folder, modified }) => ({ guid: g, code: codeOf({ code: c, title }), title, folder, modified }));
      let wanted;
      if (guid) wanted = index.policies.filter((p) => p.guid.toLowerCase() === guid.toLowerCase());
      else if (code) wanted = index.policies.filter((p) => norm(codeOf(p)) === norm(code));
      else if (titleTerms?.length) wanted = index.policies.filter((p) => titleTerms.some((t) => p.title.toLowerCase().includes(String(t).toLowerCase())));
      else {
        const cp = index.policies.filter((p) => /corporal|paddl/i.test(p.title));
        wanted = [...cp, ...index.policies.filter((p) => !cp.includes(p) && STUDENT_DISCIPLINE(p.title))];
      }
      out.matched = wanted.map((p) => ({ guid: p.guid, code: codeOf(p), title: p.title, folder: p.folder, url: p.url }));
      if (!wanted.length) {
        out.next = `Nothing matched. ${index.policies.length} policies are published; call again with full_index true, then pass the code you want.`;
        return text(out);
      }

      out.policies = [];
      for (const p of wanted.slice(0, limit)) {
        const pdf = `${p.url}?printPdf=true`;
        let doc, detail = null;
        try {
          detail = (await getJson(`${base(tenant)}/api/policy/${p.guid}/PublicPolicyDetail?includePath=false`, opts)).json ?? null;
          if (!documents?.get) throw new Error("this server has no document reader to extract the PDF");
          doc = await documents.get(pdf);
        } catch (err) { out.policies.push({ guid: p.guid, code: codeOf(p), title: p.title, url: p.url, pdf, error: err.message }); continue; }
        const body = String(doc.text ?? "");
        if (body.length > 100) documents.put?.(p.url, body, { content_type: "application/pdf", extracted_by: `diligent-printpdf/${doc.extracted_by ?? "pdf"}`, final_url: pdf, page_count: doc.page_count, page_offsets: doc.page_offsets });
        const printed = printedDates(body);
        const day = (d) => (d ? String(d).slice(0, 10) : null);
        out.policies.push({
          guid: p.guid, code: codeOf(p), title: p.title, folder: p.folder,
          adopted: printed.adopted ?? day(detail?.adoptedDate),
          revised: printed.revised ?? (detail?.revisedDate ? [day(detail.revisedDate)] : null),
          ...(detail?.lastReviewedDate ? { last_reviewed: day(detail.lastReviewedDate) } : {}),
          published_file_modified: p.modified,
          url: p.url, pdf, chars: body.length, extracted_by: doc.extracted_by ?? null,
          hits: termHits(body, docTerms), text: body.slice(0, 40000),
        });
      }
      out.next = "Cite the policy's `url` as `source` and quote from its `text`. `adopted` and `revised` are read from the policy itself; `published_file_modified` is when the file was last touched in Diligent and is not a board action, so do not date a policy by it.";
      return text(out);
    }
  );
  return "fetch_diligent_policy";
}
