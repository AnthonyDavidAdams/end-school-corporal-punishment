// Re-fetches every source in a scan result and checks the recorded quote is actually in it.
// Nothing merges without this. Usage: node tools/verify-scan.mjs out-C-1.json [out-C-2.json ...]
//
// Writes <file>.verified.json (the records that passed) and <file>.failed.json (everything else, with
// a reason), so a slice can be merged in part rather than held whole because one source is unreachable.
//
// It checks the quote against a copy this script fetched in this run, not against the copy the scanning
// agent read. That is the whole point: an agent that transcribed from a browser, or from a stale cache,
// or from the wrong district's manual, produces a record that looks exactly like a good one.
import { readFileSync, writeFileSync } from "node:fs";

const SERVER = "https://escp-mcp-production.up.railway.app/mcp";
// A connection that times out is not a failed verification, it is no verification, and the difference
// matters: the first version of this threw on one connect timeout and took the whole run with it.
// Transport errors are retried and then reported as unverified, never as a bad record.
async function call(name, args, ms = 300000) {
  let last = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise(r => setTimeout(r, 4000 * attempt));
    try {
      const r = await fetch(SERVER, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
        signal: AbortSignal.timeout(ms),
      });
      const text = await r.text();
      const line = text.split("\n").find(l => l.startsWith("data: "));
      if (!line) { last = `server said: ${text.slice(0, 160)}`; continue; }
      try { return JSON.parse(JSON.parse(line.slice(6)).result.content[0].text); }
      catch { return { _err: line.slice(0, 300) }; }
    } catch (e) { last = `${e.cause?.code || e.name}: ${e.message}`.slice(0, 160); }
  }
  return { _err: `crew server unreachable after 3 attempts (${last})`, _transport: true };
}

// Quotes are compared on words, not characters. A PDF extractor breaks "state-issued" across a line as
// "state- issued" and turns quotes into smart quotes, so a character comparison fails on records that
// are in fact perfect. What must not be forgiven is different words.
const norm = s => String(s ?? "")
  .replace(/&amp;/g, "&").replace(/&#34;/g, '"').replace(/&#39;/g, "'").replace(/&#8211;|&#8212;/g, "-")
  .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[‐-―]/g, "-")
  .replace(/ /g, " ").replace(/­/g, "")
  .toLowerCase().replace(/-\s+/g, "-").replace(/[^a-z0-9'"().,;:$%&/-]+/g, " ").replace(/\s+/g, " ").trim();

const pass = [], fail = [];
for (const file of process.argv.slice(2)) {
  for (const r of JSON.parse(readFileSync(file, "utf8"))) {
    const tag = `${r.state} ${r.name}`;
    if (r.status === "unknown") { pass.push({ file, r, how: "unknown, nothing to check" }); console.log(`--   ${tag}: unknown`); continue; }
    // source_text is the documented escape hatch: the contributor read a document this server cannot
    // parse -- a .docx, a scan -- and attached the text. It is weaker evidence and it is not a failed
    // verification, so it is reported as its own thing rather than lumped in with a quote that is not
    // in its source, which is a different and much worse problem.
    if (r.source_text) {
      const inAttached = norm(r.source_text).includes(norm(r.quote ?? ""));
      if (inAttached) { pass.push({ file, r, how: "agent-attested, quote matches the attached text" }); console.log(`ATT  ${tag}: agent-attested (server cannot parse the source), quote is in the attached text`); }
      else { fail.push({ file, r, why: "source_text is attached but the quote is not in it" }); console.log(`FAIL ${tag}: quote is not in its own attached text`); }
      continue;
    }
    if (!r.source || !r.quote) { fail.push({ file, r, why: "status is not unknown but there is no source and quote" }); console.log(`FAIL ${tag}: no source/quote`); continue; }
    const q = norm(r.quote), head = q.split(" ").slice(0, 10).join(" ");
    let body = "", how = "", detail = "";
    if (/pol\.tasb\.org/.test(r.source)) {
      const key = r.source.match(/key=(\d+)/)?.[1];
      const res = await call("fetch_tasb_policy", { district_key: key, code: r.policy_code?.replace(/\(.*/, "") || "FO" });
      if (res._transport) { fail.push({ file, r, why: res._err }); console.log(`HOLD ${tag}: ${res._err}`); continue; }
      body = norm(res.local || ""); how = `TASB key ${key}`; detail = `${res.update || "?"} ${res.date_issued || ""}`;
    } else if (/simbli\.eboardsolutions/.test(r.source)) {
      const site = r.source.match(/S=(\d+)/)?.[1];
      const res = await call("fetch_simbli_policy", { site, terms: ["corporal punishment"] });
      if (res._transport) { fail.push({ file, r, why: res._err }); console.log(`HOLD ${tag}: ${res._err}`); continue; }
      body = norm(JSON.stringify(res)); how = `Simbli S=${site}`;
      if (/challenge|bot protection|_err/i.test(JSON.stringify(res))) { fail.push({ file, r, why: `Simbli answered a bot challenge for S=${site}; unverifiable right now, not wrong` }); console.log(`HOLD ${tag}: Simbli blocked`); continue; }
    } else {
      const res = await call("fetch_document", { url: r.source, terms: ["corporal punishment", "paddl", "spank", "prohibit"], context_words: 220, toc: false });
      if (res._transport) { fail.push({ file, r, why: res._err }); console.log(`HOLD ${tag}: ${res._err}`); continue; }
      if (res._err || res.bytes === undefined) { fail.push({ file, r, why: `source did not fetch: ${JSON.stringify(res).slice(0, 160)}` }); console.log(`FAIL ${tag}: source did not fetch`); continue; }
      body = norm((res.hits || []).map(h => h.context).join(" ")); how = `document ${res.bytes}B ${res.page_count || "?"}p`;
      detail = res.needs_ocr ? "NEEDS OCR" : "";
      // A term hit returns a window around the term, and a quote longer than the window is cut in half
      // by it. Carlisle's policy is verbatim on page 62 and this reported it missing, which would have
      // thrown away a good record. So when the windows do not contain the quote, read the pages they
      // point at in full before saying anything.
      if (q && !body.includes(q)) {
        // Searching the generic terms again would land on the same pages. Carlisle's policy is on page
        // 62 and the four standing terms returned pages 1, 2, 3, 15, 34, 35, 46, 49, 51 and 55 -- the
        // one page that mattered was not among them. So the second pass asks for phrases out of the
        // quote itself, which is the only thing guaranteed to be where the quote is.
        const words = String(r.quote).split(/\s+/).filter(Boolean);
        const phrases = [words.slice(0, 6).join(" "), words.slice(Math.floor(words.length / 2), Math.floor(words.length / 2) + 6).join(" ")]
          .map(x => x.replace(/[^\w\s'-]/g, " ").trim()).filter(x => x.split(/\s+/).length >= 3);
        if (phrases.length) {
          const again = await call("fetch_document", { url: r.source, terms: phrases, context_words: 260, toc: false });
          const body2 = norm((again.hits || []).map(h => h.context).join(" "));
          if (body2.includes(q)) { body = body2; how += " (found by phrase)"; }
          else {
            const pages = [...new Set([...(again.hits || []), ...(res.hits || [])].map(h => h.page).filter(Boolean))].slice(0, 8);
            for (const pg of pages) {
              const full = await call("fetch_document", { url: r.source, pages: String(pg), toc: false });
              if (full.text && norm(full.text).includes(q)) { body = norm(full.text); how += ` p${pg}`; break; }
            }
          }
        }
      }
    }
    if (q && body.includes(q)) { pass.push({ file, r, how: `${how} exact` }); console.log(`OK   ${tag}  ${how} ${detail}`); }
    else if (head && body.includes(head)) { pass.push({ file, r, how: `${how} opening matched` }); console.log(`OK*  ${tag}  ${how} ${detail} (quote spans the fetched windows; opening 10 words matched)`); }
    else { fail.push({ file, r, why: `quote not found in the source as fetched (${how})` }); console.log(`FAIL ${tag}: quote not in source (${how})`); }
  }
}
for (const [name, list] of [["verified", pass], ["failed", fail]]) {
  const byFile = {};
  for (const x of list) (byFile[x.file] ||= []).push(name === "verified" ? x.r : { ...x.r, _why: x.why });
  for (const [f, rs] of Object.entries(byFile)) writeFileSync(f.replace(/\.json$/, `.${name}.json`), JSON.stringify(rs, null, 1));
}
console.log(`\n${pass.length} verified, ${fail.length} not`);
for (const x of fail) console.log(`  ${x.r.state} ${x.r.name}: ${x.why}`);
