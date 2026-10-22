// TSBA policy manuals: Tennessee districts whose board policy the Tennessee School Boards Association
// hosts. tsba.net/<district>-board-of-education-policy-manual/ is a table of policy numbers, each linked
// to a SharePoint guest link. A guest link serves an Office viewer, not the file; the viewer page carries
// a FileGetUrl that downloads the .docx, but only for the session the guest link just opened, so the
// cookies have to be carried by hand across the redirects.
import { execFile } from "node:child_process";
import { docxText, isZip } from "./docx.mjs";

const TSBA = "https://tsba.net";
const SP_HOST = /^https:\/\/tsbanet(?:-my)?\.sharepoint\.com\//i;
const SITEMAP_TTL_MS = 24 * 60 * 60 * 1000;
let sitemap = null;

const slugify = (s) => String(s).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const clean = (s) => String(s ?? "").replace(/<[^>]+>/g, " ").replace(/&#8211;|&ndash;/g, "\u2013").replace(/&#8217;|&rsquo;/g, "\u2019").replace(/&amp;/g, "&").replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ").trim();

function jar() {
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

// fetch's own redirect handling drops the Set-Cookie headers of the hops in between, and the FedAuth
// cookie SharePoint needs is set on one of those hops.
async function session(url, j, send, UA, { binary = false } = {}) {
  let current = url;
  for (let hop = 0; hop < 10; hop++) {
    const res = await send(current, {
      headers: { "User-Agent": UA, Accept: binary ? "*/*" : "text/html,application/xhtml+xml,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9", ...(j.header() ? { Cookie: j.header() } : {}) },
      redirect: "manual", signal: AbortSignal.timeout(30000),
    });
    j.absorb(res);
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) { current = new URL(loc, current).toString(); continue; }
    if (!res.ok) throw new Error(`SharePoint answered HTTP ${res.status} at ${current.slice(0, 120)}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return { final: current, buf, type: (res.headers.get("content-type") ?? "").toLowerCase() };
  }
  throw new Error("SharePoint redirected more than ten times");
}

// The engine's PDF reader fetches the URL itself, without this session's cookies, and SharePoint answers
// that with a redirect page. poppler-utils is in the server image for OCR, so pdftotext reads the bytes.
function pdfText(buf) {
  return new Promise((resolve, reject) => {
    const child = execFile("pdftotext", ["-q", "-", "-"], { maxBuffer: 16 * 1024 * 1024, timeout: 60000 }, (err, stdout) => (err ? reject(new Error(`pdftotext failed: ${err.message}`)) : resolve(stdout)));
    child.stdin.end(buf);
  });
}

// Every manual TSBA hosts, from the site's own sitemap. A district that is not in it publishes its
// policy somewhere else, and saying so is more useful than a 404.
async function manuals(send, UA) {
  if (sitemap && Date.now() - sitemap.at < SITEMAP_TTL_MS) return sitemap.urls;
  const res = await send(`${TSBA}/wp-sitemap-posts-page-1.xml`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(25000) });
  if (!res.ok) throw new Error(`tsba.net sitemap answered HTTP ${res.status}`);
  const urls = [...(await res.text()).matchAll(/<loc>([^<]*-policy-manual\/?)<\/loc>/g)].map((m) => m[1]);
  sitemap = { at: Date.now(), urls };
  return urls;
}

const SUFFIX = /-(?:board-of-education|schools?-board-of-education|city-schools-board-of-education)?-?policy-manual\/?$/;
export function resolveManual(urls, district) {
  const want = slugify(String(district).replace(/\b(school district|board of education|public schools|schools?)\b/gi, ""));
  const named = urls.map((u) => ({ url: u, slug: u.replace(/\/$/, "").split("/").pop().replace(SUFFIX, "") }));
  const exact = named.filter((m) => m.slug === want || m.slug === `${want}-county` || m.slug === `${want}-city`);
  if (exact.length) return { match: exact[0].url, near: exact.slice(1).map((m) => m.url) };
  const near = named.filter((m) => m.slug.includes(want) || want.includes(m.slug)).map((m) => m.url);
  return { match: near.length === 1 ? near[0] : null, near };
}

// A SharePoint guest link or a tsba.net manual page, from any URL; null for anything else.
export function tsbaTarget(input) {
  const s = String(input ?? "").trim();
  if (SP_HOST.test(s)) return { guest_link: s };
  const m = s.match(/(?:^|[/.])tsba\.net\/([a-z0-9-]+-policy-manual)(?=\/|[?#]|$)/i);
  return m ? { manual: `${TSBA}/${m[1].toLowerCase()}/` } : null;
}

// The rows of the manual page whose policy number is `code`, with their guest links. Manuals list a
// policy twice when TSBA has published a "Mobile" PDF beside the Word file; the Word file is the policy.
export function policyLinks(html, code) {
  const rows = [...String(html).matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((m) => m[0]);
  const want = String(code).trim();
  const out = [];
  for (const row of rows) {
    const cells = [...row.matchAll(/<td[\s\S]*?<\/td>/gi)].map((m) => clean(m[0]));
    if (!cells.some((c) => c === want)) continue;
    const href = row.match(/href="([^"]+)"/i)?.[1]?.replace(/&amp;/g, "&");
    if (!href || !SP_HOST.test(href)) continue;
    const kind = href.match(/\/:([a-z]):\//i)?.[1]?.toLowerCase() ?? null;
    out.push({ code: want, title: cells.find((c) => c && c !== want) ?? null, link: href, kind: kind === "w" ? "docx" : kind === "b" ? "pdf" : kind });
  }
  return out.sort((a, b) => Number(b.kind === "docx") - Number(a.kind === "docx"));
}

// TSBA's header block prints the dates as label/value cells: "Issued Date: 08/10/23" and, for the
// policy it replaced, "Rescinds: 6.314 Issued: 11/12/09".
export function tsbaDates(text) {
  const t = String(text);
  const issued = t.match(/Issued Date:\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i)?.[1] ?? null;
  // In the PDF layout the "Issued Date" cell falls between the rescinded code and its "Issued:" date.
  const resc = t.match(/Rescinds:\s*(\d\.\d{3})?[\s\S]{0,80}?\bIssued:\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
  return { issued_date: issued, rescinds: resc ? { code: resc[1] ?? null, issued: resc[2] } : null };
}

export function registerTsba(server, ctx, { z, text, fail, documents }, { UA, fetch: send }) {
  async function readGuestLink(link) {
    const cached = documents?.read?.(link);
    if (cached?.text && cached.text.length > 100) return { text: cached.text, final_url: cached.final_url ?? link, format: cached.format ?? null, from_cache: true };
    const j = jar();
    const viewer = await session(link, j, send, UA);
    const html = viewer.buf.toString("utf8");
    let download = html.match(/"FileGetUrl"\s*:\s*"([^"]+)"/)?.[1]?.replace(/\\u0026/g, "&").replace(/\\\//g, "/") ?? null;
    let viaPdf = false;
    if (!download) {
      // A ":b:" link lands on the library view instead of the viewer; its id= parameter is the file's path.
      const id = new URL(viewer.final).searchParams.get("id");
      if (id && /\.pdf$/i.test(id)) { download = new URL(id, viewer.final).toString(); viaPdf = true; }
    }
    if (!download) throw new Error(`the guest link opened (${viewer.final.slice(0, 100)}) but the page carried no FileGetUrl to download the file from`);
    const file = await session(download, j, send, UA, { binary: true });
    if (viaPdf) {
      if (file.buf.subarray(0, 5).toString() !== "%PDF-") throw new Error(`the PDF download answered ${file.type || "an unknown type"} (${file.buf.length} bytes) rather than a PDF`);
      const body = (await pdfText(file.buf)).trim();
      if (body.length < 100) throw new Error("the PDF downloaded but pdftotext read almost nothing from it");
      documents?.put?.(link, body, { content_type: "application/pdf", extracted_by: "tsba-pdf (pdftotext)", final_url: download, format: "pdf" });
      return { text: body, final_url: download, format: "pdf" };
    }
    if (!isZip(file.buf)) throw new Error(`the download answered ${file.type || "an unknown type"} (${file.buf.length} bytes) rather than a Word file; SharePoint probably asked for a sign-in`);
    const body = docxText(file.buf);
    if (body.length > 100) documents?.put?.(link, body, { content_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", extracted_by: "tsba-docx", final_url: download, format: "docx" });
    return { text: body, final_url: download, format: "docx" };
  }

  server.registerTool(
    "fetch_tsba_policy",
    {
      title: "Read a Tennessee district's TSBA board policy",
      description:
        "Many Tennessee districts publish board policy through the Tennessee School Boards Association: a page on tsba.net listing each policy, linked to a SharePoint guest link that a plain fetch cannot open. This opens it and returns the policy's text. " +
        "Corporal punishment is TSBA policy 6.314, the default. Give the district name (e.g. 'Henry County', 'Lexington'), its tsba.net policy-manual URL, or the SharePoint guest link itself. " +
        "Returns the 'Issued Date' printed on the policy, which is how you date it, and the policy it rescinded with that one's issue date. The text is cached under the guest link, so cite the guest link as `source` and your quote verifies.",
      inputSchema: {
        district: z.string().trim().min(2).describe("District name, its tsba.net/...-policy-manual/ URL, or a tsbanet.sharepoint.com guest link"),
        code: z.string().trim().regex(/^\d\.\d{3}$/).default("6.314").describe("TSBA policy number; 6.314 is Corporal Punishment"),
      },
    },
    async ({ district, code = "6.314" }) => {
      let manual = null, rows = [], link = null;
      const target = tsbaTarget(district);
      if (target?.guest_link) link = target.guest_link;
      else {
        if (target?.manual) manual = target.manual;
        else {
          let urls;
          try { urls = await manuals(send, UA); }
          catch (err) { return fail(`Could not read tsba.net's list of manuals: ${err.message}`, { next: "Retry once; if tsba.net is down, pass the district's tsba.net policy-manual URL or a guest link directly." }); }
          const r = resolveManual(urls, district);
          if (!r.match) {
            return fail(r.near.length ? `'${district}' matches more than one TSBA-hosted manual.` : `TSBA does not host a policy manual for '${district}'. Of ${urls.length} manuals on tsba.net, none matches.`, {
              candidates: r.near.slice(0, 10),
              next: r.near.length
                ? "Call again with the right manual URL from candidates."
                : "This district publishes board policy somewhere else (its own site, BoardDocs, Simbli, or PDFs). Find its Board Policy link there. Do not record unknown on the strength of this alone.",
            });
          }
          manual = r.match;
        }
        let page;
        try {
          const res = await send(manual, { headers: { "User-Agent": UA, Accept: "text/html,*/*" }, redirect: "follow", signal: AbortSignal.timeout(25000) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          page = await res.text();
        } catch (err) { return fail(`tsba.net answered ${err.message} for ${manual}.`, { next: "Check the manual URL; TSBA's slugs are <district>-board-of-education-policy-manual." }); }
        rows = policyLinks(page, code);
        if (!rows.length) return fail(`The manual at ${manual} lists no policy ${code}.`, { manual, next: "Corporal punishment is 6.314 in TSBA's numbering; a district may also address it in 6.300 Code of Conduct or 6.313 Discipline Procedures. Try those codes." });
        link = rows[0].link;
      }

      let got;
      try { got = await readGuestLink(link); }
      catch (err) {
        const alt = rows.find((r) => r.link !== link);
        if (alt) { try { got = await readGuestLink(alt.link); link = alt.link; } catch { /* report the first failure */ } }
        if (!got) return fail(`The SharePoint guest link could not be read: ${err.message}`, { manual, source: link, next: "Retry once. If it still fails, file a report_issue with this guest link; meanwhile read the policy yourself and submit with source_text." });
      }

      const docTerms = ctx.crew?.crew?.document_terms ?? ["corporal punishment"];
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
      const board = got.text.match(/^\s*([^\n\t]*Board of Education)/)?.[1]?.trim() ?? null;
      return text({
        district: board, manual, code, title: rows.find((r) => r.link === link)?.title ?? null,
        source: link, format: got.format ?? null,
        ...tsbaDates(got.text),
        chars: got.text.length, hits, text: got.text.slice(0, 40000),
        ...(got.from_cache ? { from_cache: true } : {}),
        next: "Cite `source` (the guest link) and quote from `text`. Date the policy by `issued_date`; `rescinds.issued` is the policy it replaced. Check `district` against the district you meant: TSBA manuals for same-named counties are easy to confuse.",
      });
    }
  );

  return ["fetch_tsba_policy"];
}
