// Text out of a .docx without a dependency. The server image has no textutil and no LibreOffice, and a
// .docx is only a zip holding word/document.xml, so the central directory is read by hand and the one
// part inflated with node:zlib.
import { inflateRawSync } from "node:zlib";

export const isZip = (buf) => buf?.length > 4 && buf.readUInt32LE(0) === 0x04034b50;

export function zipEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a zip archive (no end-of-central-directory record)");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let k = 0; k < count && buf.readUInt32LE(p) === 0x02014b50; k++) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    // Sizes come from the central directory because Word writes data descriptors after streamed entries,
    // leaving the local header's sizes at zero.
    out.set(name, () => {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      return method === 0 ? data : inflateRawSync(data);
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const XML_ENTITIES = { lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" };
const unxml = (s) => s.replace(/&(lt|gt|quot|apos|amp);/g, (_, n) => XML_ENTITIES[n])
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));

// Only what Word displays: run text, tabs, breaks, paragraph and cell ends. Field codes (w:instrText),
// tracked deletions (w:delText) and drawing offsets are XML text too, and reading every text node prints
// them as if they were part of the policy.
export function wordXmlText(xml) {
  let out = "";
  for (const m of String(xml).matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\b[^>]*\/>|<w:cr\/>|<w:noBreakHyphen\/>|<\/w:p>|<\/w:tc>/g)) {
    const tag = m[0];
    if (m[1] !== undefined) out += unxml(m[1]);
    else if (tag === "<w:tab/>") out += "\t";
    else if (tag === "<w:noBreakHyphen/>") out += "-";
    else if (tag === "</w:tc>") out += "\t";
    else out += "\n";
  }
  return out.replace(/[ \t]*\t[ \t]*/g, "\t").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

// The body, then endnotes and footnotes (TSBA puts its legal citations there).
export function docxText(buf) {
  const parts = zipEntries(buf);
  const read = (name) => (parts.has(name) ? parts.get(name)().toString("utf8") : "");
  if (!parts.has("word/document.xml")) throw new Error("the archive has no word/document.xml; it is not a Word document");
  const body = wordXmlText(read("word/document.xml"));
  const notes = ["word/endnotes.xml", "word/footnotes.xml"].map((n) => wordXmlText(read(n))).filter((t) => t.length > 2).join("\n");
  return notes ? `${body}\n\nNotes:\n${notes}` : body;
}
