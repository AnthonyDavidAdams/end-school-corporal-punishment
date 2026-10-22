// KASB Policy Online (Sparq Online Publishing): board policy for a large share of Kansas districts.
//
// The browse page is an Angular shell and a plain fetch of it carries no policy. The page's own JSON API
// answers an ordinary unauthenticated request, so no browser is needed: one call for the root of the
// manual, one per folder to list it, and one for each policy read. Tested 2026-10-10 on Udall USD 463,
// Holton USD 336 and Wellington USD 353; the API served the same bytes with and without a User-Agent.

const KASB = "https://policy.kasb.org";
const API = `${KASB}/sopapi`;
const PARTNER = "kansas";
const NO_SHOWSET = /ShowSet has no collections/i;

// The district's ShowSet, bare or inside any policy.kasb.org URL. A browse URL also names the
// collection and the policy, which lets a caller who already has a link skip the index.
export function kasbTarget(input) {
  const s = String(input ?? "").trim();
  const m = s.match(/policy\.kasb\.org\/(?:sopapi\/[a-z]+\/[a-z]+\/)?kansas\/(?:browse\/)?([A-Za-z0-9_-]+)(?:\/([A-Za-z0-9_-]+))?(?:\/(sop\d+))?/i);
  if (m) return { showset: m[1], collection: m[2] ?? null, sop: m[3] ?? null };
  if (/^[A-Za-z0-9_-]{3,60}$/.test(s)) return { showset: s, collection: null, sop: null };
  return null;
}

export const kasbBrowseUrl = (showset, collection, sop) => `${KASB}/${PARTNER}/browse/${showset}/${collection}/${sop}`;

// Some responses are a JSON document whose value is itself a JSON string.
function decode(body) {
  let j = JSON.parse(body);
  if (typeof j === "string") j = JSON.parse(j);
  return j;
}

const ENTITIES = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", ndash: "\u2013", mdash: "\u2014", rsquo: "\u2019", lsquo: "\u2018", rdquo: "\u201d", ldquo: "\u201c", sect: "\u00a7", hellip: "\u2026" };
export function kasbText(html) {
  return String(html ?? "")
    .replace(/<head[\s\S]*?<\/head>|<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

// "Approved: 8/26/91; 8/10/26" is the board's own history of the policy. The "KASB Recommendation"
// line under it is when KASB revised its model text, not anything this board did.
export function kasbDates(text) {
  const approved = String(text).match(/Approved:\s*([^\n]*)/i)?.[1] ?? null;
  const rec = String(text).match(/KASB Recommendation\s*[\u2013\u2014-]?\s*([^\n]*)/i)?.[1] ?? null;
  const list = (s) => (s ? s.split(/[;,]/).map((x) => x.trim()).filter((x) => /\d/.test(x)) : []);
  const approvedList = list(approved);
  return { approved: approvedList, last_approved: approvedList.at(-1) ?? null, kasb_recommendation: list(rec) };
}

const codeOf = (title) => String(title ?? "").match(/^([A-Z]{1,6}(?:-[A-Z0-9]+)?)\b/)?.[1] ?? null;

export function registerKasb(server, ctx, { z, text, fail, documents }, { UA, fetch: send }) {
  const get = async (url) => {
    const res = await send(url, { headers: { "User-Agent": UA, Accept: "application/json, text/plain, */*" }, signal: AbortSignal.timeout(25000) });
    const body = await res.text();
    if (!res.ok) throw new Error(`KASB answered HTTP ${res.status} for ${url}`);
    try { return decode(body); } catch { throw new Error(`KASB did not return JSON for ${url} (${body.length} bytes)`); }
  };

  // The index changes when a board votes, not between one agent's read and the next one's check.
  const INDEX_TTL_MS = 60 * 60 * 1000;
  const indexCache = new Map();
  async function index(showset) {
    const hit = indexCache.get(showset.toLowerCase());
    if (hit && Date.now() - hit.at < INDEX_TTL_MS) return { ...hit.index, from_cache: true };
    const root = await get(`${API}/toc/getshowset/${PARTNER}/${encodeURIComponent(showset)}`);
    if (!Array.isArray(root) || !root.length || root.every((n) => NO_SHOWSET.test(n.title ?? "") || !n.code)) return null;
    const policies = [], folders = [];
    const queue = root.map((n) => ({ node: n, path: [] }));
    let requests = 1;
    while (queue.length && requests < 80) {
      const { node, path } = queue.shift();
      if (!node.hasChildren) continue;
      let kids;
      try { kids = await get(`${API}/toc/getchildren/${PARTNER}/${encodeURIComponent(showset)}/${node.collectionCode}/${node.code}/${node.id}`); }
      catch { continue; }
      requests++;
      const here = [...path, node.title];
      folders.push(here.join(" > "));
      for (const k of kids ?? []) {
        if (k.hasChildren) queue.push({ node: k, path: here });
        if (!k.isEmptyDoc && k.code) {
          policies.push({ code: codeOf(k.title), title: k.title, sop: k.code, collection: k.collectionCode, section: here.slice(1).join(" > ") || null, url: kasbBrowseUrl(showset, k.collectionCode, k.code) });
        }
      }
    }
    const fresh = { manual: root[0]?.title ?? null, folders, policies, requests };
    indexCache.set(showset.toLowerCase(), { at: Date.now(), index: fresh });
    return fresh;
  }

  async function readPolicy(showset, collection, sop) {
    const url = kasbBrowseUrl(showset, collection, sop);
    const cached = documents?.read?.(url);
    if (cached?.text && cached.text.length > 40) return { url, text: cached.text, title: cached.title ?? null, from_cache: true };
    const api = `${API}/document/getdocument/${PARTNER}/${encodeURIComponent(showset)}/${collection}/${sop}`;
    const doc = await get(api);
    if (!doc || !doc.html) throw new Error(`KASB returned no policy body for ${sop}.`);
    const body = kasbText(doc.html);
    if (body.length > 40) documents?.put?.(url, body, { content_type: "text/html", extracted_by: "kasb-sopapi", final_url: api, title: doc.title ?? null });
    return { url, text: body, title: doc.title ?? null, viewable: doc.isViewable ?? null, platform_modified: doc.dtModified ?? null };
  }

  server.registerTool(
    "fetch_kasb_policy",
    {
      title: "Read a Kansas district's board policy on KASB",
      description:
        "Kansas districts that subscribe to KASB's policy service publish their manual at policy.kasb.org, a JavaScript page that a plain fetch reads as empty. This reads the same data the page reads. " +
        "Give it the district's ShowSet (the name after /kansas/browse/ in its policy link, e.g. Udallusd463) or the link itself. ShowSets cannot be guessed from the USD number; take it from the district's own Board Policy link. " +
        "With no code it finds the policy titled Corporal Punishment (KASB's model code is JDA) and returns its text, the passages that matter, and the board's 'Approved:' dates, which are how you date it. The 'KASB Recommendation' dates are KASB's model revisions, not the board's. " +
        "The text is cached under the browse URL it returns, so cite that as `source` and your quote verifies.",
      inputSchema: {
        showset: z.string().trim().min(3).describe("The district's KASB ShowSet, or any policy.kasb.org URL for the district"),
        code: z.string().trim().optional().describe("A policy code from the manual, e.g. 'JDA' (corporal punishment) or 'JCDA' (student conduct)"),
        terms: z.array(z.string().min(3)).optional().describe("Match policy titles against these instead. Defaults to corporal punishment."),
        full_index: z.boolean().optional().describe("Return every policy in the manual rather than the matches (default false)"),
      },
    },
    async ({ showset: arg, code, terms, full_index = false }) => {
      const target = kasbTarget(arg);
      if (!target) return fail(`'${arg}' is not a KASB ShowSet or policy.kasb.org URL.`, { next: "Find the district's Board Policy link; on KASB it reads policy.kasb.org/kansas/browse/<ShowSet>/..." });
      const { showset } = target;

      if (target.collection && target.sop && !code && !terms?.length) {
        try {
          const one = await readPolicy(showset, target.collection, target.sop);
          return text(shape(showset, null, [{ ...one, code: codeOf(one.title), sop: target.sop }]));
        } catch (err) { return fail(err.message, { showset, next: "Call again with just the ShowSet to see the manual's index." }); }
      }

      let idx;
      try { idx = await index(showset); }
      catch (err) { return fail(`KASB could not be read for ShowSet ${showset}: ${err.message}`, { next: "This API has answered plain requests reliably; retry once, then file a report_issue." }); }
      if (!idx) {
        return fail(`KASB has no manual under the ShowSet '${showset}'. ShowSets are spelled the way the district's own link spells them (e.g. Udallusd463) and cannot be guessed from the USD number.`, {
          showset,
          next: "Open the district's site and find its Board Policy link. If it points somewhere other than policy.kasb.org (BoardDocs, Simbli, PDFs), this district is not on KASB; read it there.",
        });
      }

      const match = (terms?.length ? terms : ["corporal punishment"]).map((t) => String(t).toLowerCase());
      const wanted = code
        ? idx.policies.filter((p) => (p.code ?? "").toUpperCase() === code.toUpperCase())
        : idx.policies.filter((p) => match.some((t) => (p.title ?? "").toLowerCase().includes(t)));
      const out = {
        showset, manual: idx.manual, policies_in_manual: idx.policies.length,
        matched: wanted.map((p) => ({ code: p.code, title: p.title, section: p.section, url: p.url })),
      };
      if (full_index) out.index = idx.policies.map(({ code: c, title, section, url }) => ({ code: c, title, section, url }));
      if (!wanted.length) {
        out.next = code
          ? `No policy coded ${code} in this manual. Call with full_index true to see what it has; districts sometimes renumber or fold a policy into another.`
          : `No policy title matched. Search student conduct and discipline instead (code JCDA), or call with full_index true. A manual with no corporal punishment policy is worth saying so in notes, not a reason to record unknown.`;
        return text(out);
      }
      const read = [];
      for (const p of wanted.slice(0, 3)) {
        try { read.push({ ...(await readPolicy(showset, p.collection, p.sop)), code: p.code, sop: p.sop, section: p.section }); }
        catch (err) { read.push({ code: p.code, title: p.title, url: p.url, error: err.message }); }
      }
      return text({ ...out, ...shape(showset, idx.manual, read) });
    }
  );

  function shape(showset, manual, read) {
    const docTerms = ctx.crew?.crew?.document_terms ?? ["corporal punishment"];
    return {
      showset, manual,
      policies: read.map((r) => {
        if (r.error) return r;
        const low = r.text.toLowerCase();
        const hits = [];
        for (const t of docTerms) {
          const needle = String(t).toLowerCase();
          let i = 0, n = 0;
          while (n < 3) {
            const at = low.indexOf(needle, i);
            if (at < 0) break;
            const s0 = Math.max(0, at - 240), e0 = Math.min(r.text.length, at + needle.length + 360);
            hits.push({ term: t, context: (s0 ? "\u2026 " : "") + r.text.slice(s0, e0).replace(/\s+/g, " ").trim() + (e0 < r.text.length ? " \u2026" : "") });
            i = at + needle.length; n++;
          }
        }
        return { code: r.code ?? null, title: r.title, section: r.section ?? null, url: r.url, ...kasbDates(r.text), chars: r.text.length, hits, text: r.text.slice(0, 40000), ...(r.from_cache ? { from_cache: true } : {}) };
      }),
      next: "Cite the policy's `url` as `source` and quote from its `text`. Date it by `last_approved`, the newest board approval printed on the policy; `kasb_recommendation` is KASB's model history and does not date this board's action.",
    };
  }

  return ["fetch_kasb_policy"];
}
