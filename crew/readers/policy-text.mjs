// What the policy readers share: turning vendor HTML into quotable text, finding the sentences that
// matter, and holding an index long enough that a verifier re-reading a district costs the vendor nothing.

export function htmlToPlain(html) {
  return String(html ?? "")
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&#0?39;|&apos;|&rsquo;|&lsquo;/gi, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/gi, '"').replace(/&sect;/gi, "\u00a7").replace(/&ndash;/gi, "\u2013").replace(/&mdash;/gi, "\u2014")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/[ \t\u00a0]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function termHits(text, terms, { per = 3 } = {}) {
  const body = String(text ?? "");
  const low = body.toLowerCase();
  const hits = [];
  for (const t of terms) {
    const needle = String(t).toLowerCase();
    let i = 0, n = 0;
    while (n < per) {
      const at = low.indexOf(needle, i);
      if (at < 0) break;
      const s0 = Math.max(0, at - 240), e0 = Math.min(body.length, at + needle.length + 360);
      hits.push({ term: t, context: (s0 ? "\u2026 " : "") + body.slice(s0, e0).replace(/\s+/g, " ").trim() + (e0 < body.length ? " \u2026" : "") });
      i = at + needle.length; n++;
    }
  }
  return hits;
}

// Policy dates as the document prints them. Vendors' own date fields are often empty or record when a
// file was last touched in the CMS, which is not when the board acted.
export function printedDates(text) {
  const DATE = String.raw`([A-Z][a-z]+\.? \d{1,2},? \d{4}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})`;
  const all = (label) => [...String(text ?? "").matchAll(new RegExp(`${label}:?\\s*${DATE}`, "g"))].map((m) => m[1]);
  const adopted = all(String.raw`(?:(?:Date )?Adopted|Adoption Date|Date of Adoption)`);
  const revised = all(String.raw`(?:(?:Last |Date )?Revised|Revision Date)`);
  return { adopted: adopted[0] ?? null, revised: revised.length ? revised : null };
}

export function ttlCache(ms) {
  const store = new Map();
  return {
    get: (k) => { const hit = store.get(k); return hit && Date.now() - hit.at < ms ? hit.value : null; },
    set: (k, value) => { store.set(k, { at: Date.now(), value }); return value; },
    delete: (k) => store.delete(k),
  };
}

// One request at a time per vendor, at least `ms` apart, however many agents are calling.
export function pacer(ms) {
  let queue = Promise.resolve(), last = 0;
  return () => {
    queue = queue.then(async () => {
      const wait = ms - (Date.now() - last);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      last = Date.now();
    });
    return queue;
  };
}

export const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
