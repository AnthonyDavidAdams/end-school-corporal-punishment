// --- BoardPolicyOnline (MicroScribe) -----------------------------------------------------------
// BoardPolicyOnline carries board policy for most of North Carolina (NCSBA model codes such as 4300)
// and the South Carolina districts on SCSBA's "Policies Online" (codes such as JK). v3 is a Blazor
// Server app: the HTML is a 5 KB shell, there is no JSON API, and the policy text only ever travels over
// the app's SignalR connection. So this reader is a small Blazor client: it opens the same connection a
// browser does, answers the handful of JavaScript calls the page makes, and reads the text out of the
// render batches. No browser is involved, and every request is a plain fetch.
//
// Measured 2026-10-10 against greene, warren, florence, hampton_consolidated and clarendon_county.
//
// Things that look optional and are not:
// - The page asks the browser a few questions over JS interop (time zone, media queries, touch support).
//   Answering null to one that expects a boolean throws inside the app, which then renders "An unknown
//   error occurred while processing your request." in place of the policy. Each answer below is the one
//   a desktop browser gives.
// - The legacy host boardpolicyonline.com resets every TLS handshake from Node and curl alike, so
//   ?b=<key>&s=<id> links are translated to their v3 route rather than fetched.
// - Section ids are global and sequential across all boards, so they cannot be guessed per district.
//   They are found the way a person finds them: by searching the manual and opening the hits.

const BPO = "https://v3.boardpolicyonline.com";

// The board key and, when present, the section, from a bare key or any BoardPolicyOnline URL:
// v3 /b/<key>/s/<id>, legacy ?b=<key>&s=<id>, /bl/?b=<key>, and the #&&hs=<id> button links.
export function bpoTarget(input) {
  const s = String(input ?? "").trim();
  if (/^[A-Za-z0-9_]{2,60}$/.test(s)) return { key: s, section: null };
  const path = s.match(/boardpolicyonline\.com\/b\/(?:bl\/)?([A-Za-z0-9_]+)(?:\/s\/(\d+))?/i);
  if (path) return { key: path[1], section: path[2] ?? null };
  const key = s.match(/[?&]b=([A-Za-z0-9_]+)/i)?.[1];
  if (!key) return null;
  return { key, section: s.match(/[?&#]s=(\d+)/i)?.[1] ?? s.match(/[&#]hs=(\d+)/i)?.[1] ?? null };
}

export const bpoSectionUrl = (key, section) => `${BPO}/b/${key}/s/${section}`;

// ---- MessagePack, as much as the SignalR "blazorpack" protocol uses ----
function pack(v, out = []) {
  if (v === null || v === undefined) out.push(0xc0);
  else if (v === true) out.push(0xc3);
  else if (v === false) out.push(0xc2);
  else if (typeof v === "number") {
    if (!Number.isInteger(v) || v < 0) throw new Error(`pack: unsupported number ${v}`);
    if (v < 128) out.push(v);
    else out.push(0xce, (v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
  } else if (typeof v === "string") {
    const b = Buffer.from(v, "utf8");
    if (b.length < 32) out.push(0xa0 | b.length);
    else if (b.length < 256) out.push(0xd9, b.length);
    else if (b.length < 65536) out.push(0xda, b.length >> 8, b.length & 255);
    else out.push(0xdb, (b.length >>> 24) & 255, (b.length >>> 16) & 255, (b.length >>> 8) & 255, b.length & 255);
    for (const x of b) out.push(x);
  } else if (Array.isArray(v)) {
    if (v.length < 16) out.push(0x90 | v.length); else out.push(0xdc, v.length >> 8, v.length & 255);
    for (const x of v) pack(x, out);
  } else {
    const ks = Object.keys(v);
    out.push(0x80 | ks.length);
    for (const k of ks) { pack(k, out); pack(v[k], out); }
  }
  return out;
}

function unpack(buf, pos = 0) {
  const b = buf[pos++];
  const take = (n, f) => { const v = f(pos, n); pos += n; return v; };
  const str = (n) => take(n, (p) => buf.toString("utf8", p, p + n));
  const bin = (n) => take(n, (p) => buf.subarray(p, p + n));
  const many = (n, isMap) => {
    const o = isMap ? {} : [];
    for (let i = 0; i < n; i++) {
      const a = unpack(buf, pos); pos = a.pos;
      if (!isMap) { o.push(a.v); continue; }
      const c = unpack(buf, pos); pos = c.pos; o[a.v] = c.v;
    }
    return o;
  };
  let v;
  if (b < 0x80) v = b;
  else if (b >= 0xe0) v = b - 256;
  else if ((b & 0xf0) === 0x80) v = many(b & 15, true);
  else if ((b & 0xf0) === 0x90) v = many(b & 15, false);
  else if ((b & 0xe0) === 0xa0) v = str(b & 31);
  else switch (b) {
    case 0xc0: v = null; break;
    case 0xc2: v = false; break;
    case 0xc3: v = true; break;
    case 0xc4: v = bin(take(1, (p) => buf[p])); break;
    case 0xc5: v = bin(take(2, (p) => buf.readUInt16BE(p))); break;
    case 0xc6: v = bin(take(4, (p) => buf.readUInt32BE(p))); break;
    case 0xca: v = take(4, (p) => buf.readFloatBE(p)); break;
    case 0xcb: v = take(8, (p) => buf.readDoubleBE(p)); break;
    case 0xcc: v = take(1, (p) => buf[p]); break;
    case 0xcd: v = take(2, (p) => buf.readUInt16BE(p)); break;
    case 0xce: v = take(4, (p) => buf.readUInt32BE(p)); break;
    case 0xcf: v = take(8, (p) => Number(buf.readBigUInt64BE(p))); break;
    case 0xd0: v = take(1, (p) => buf.readInt8(p)); break;
    case 0xd1: v = take(2, (p) => buf.readInt16BE(p)); break;
    case 0xd2: v = take(4, (p) => buf.readInt32BE(p)); break;
    case 0xd3: v = take(8, (p) => Number(buf.readBigInt64BE(p))); break;
    case 0xd9: v = str(take(1, (p) => buf[p])); break;
    case 0xda: v = str(take(2, (p) => buf.readUInt16BE(p))); break;
    case 0xdb: v = str(take(4, (p) => buf.readUInt32BE(p))); break;
    case 0xdc: v = many(take(2, (p) => buf.readUInt16BE(p)), false); break;
    case 0xdd: v = many(take(4, (p) => buf.readUInt32BE(p)), false); break;
    case 0xde: v = many(take(2, (p) => buf.readUInt16BE(p)), true); break;
    default: throw new Error(`unpack: unsupported type 0x${b.toString(16)}`);
  }
  return { v, pos };
}

// SignalR binary framing: each message is preceded by its length as a 7-bit varint.
function frame(msg) {
  const body = Buffer.from(pack(msg));
  const len = [];
  let n = body.length;
  do { let x = n & 0x7f; n >>>= 7; if (n) x |= 0x80; len.push(x); } while (n);
  return Buffer.concat([Buffer.from(len), body]);
}

function unframe(buf) {
  const out = [];
  let pos = 0;
  while (pos < buf.length) {
    let n = 0, shift = 0, b;
    do { b = buf[pos++]; n |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80);
    out.push(unpack(buf.subarray(pos, pos + n)).v);
    pos += n;
  }
  return out;
}

// ---- Render batches ----
// The layout is fixed by ASP.NET Core's RenderBatchWriter: five int32 offsets at the end (updated
// components, reference frames, disposed components, disposed handlers, string table). Reference frames
// are 20 bytes each and are everything a batch inserts, which is all this reader needs: it never has to
// rebuild the DOM, only to see the policy markup, the hidden field holding the current section id, and
// the search result items with their click handlers.
function readBatch(data) {
  const b = Buffer.from(data);
  const tbl = b.readInt32LE(b.length - 4);
  const strings = [];
  for (let p = tbl; p + 4 <= b.length - 20; p += 4) {
    let at = b.readInt32LE(p);
    if (at < 0 || at >= tbl) break;
    let n = 0, shift = 0, x;
    do { x = b[at++]; n |= (x & 0x7f) << shift; shift += 7; } while (x & 0x80);
    strings.push(b.toString("utf8", at, at + n));
  }
  const str = (i) => (i === -1 ? null : strings[i] ?? null);
  const rf = b.readInt32LE(b.length - 16);
  const count = b.readInt32LE(rf);
  const frames = [];
  for (let k = 0; k < count; k++) {
    const f = rf + 4 + 20 * k;
    const type = b.readInt32LE(f);
    if (type === 1) frames.push({ t: "el", name: str(b.readInt32LE(f + 8)), len: b.readInt32LE(f + 4) });
    else if (type === 2) frames.push({ t: "text", s: str(b.readInt32LE(f + 4)) });
    else if (type === 3) frames.push({ t: "attr", name: str(b.readInt32LE(f + 4)), value: str(b.readInt32LE(f + 8)), handler: Number(b.readBigUInt64LE(f + 12)) });
    else if (type === 8) frames.push({ t: "markup", s: str(b.readInt32LE(f + 4)) });
    else frames.push({ t: type });
  }
  return frames;
}

// What a 1280-pixel desktop answers to the JS interop calls whose results the app actually uses.
function jsAnswer(identifier, argsJson, resultType, handle) {
  if (resultType === 1) return { __jsObjectId: 100000 + handle };
  switch (identifier) {
    case "getUserTimeZone": return "America/New_York";
    case "TelerikBlazor.getLocationHost": return new URL(BPO).host;
    case "TelerikBlazor.supportsTouchEvents": return false;
    case "Blazor._internal.PageTitle.getAndRemoveExistingTitle": return "";
    case "TelerikBlazor.initMediaQuery": {
      let media = "";
      try { media = JSON.parse(argsJson)?.[1]?.media ?? ""; } catch { /* no media */ }
      return [...media.matchAll(/(min|max)-width:\s*(\d+)px/g)].every(([, k, n]) => (k === "min" ? 1280 >= +n : 1280 <= +n));
    }
    default: return null;
  }
}

const APP_ERROR = /An unknown error occurred while processing your request/;
const SECTION_VALUE = /^\d{5,9}$/;

class Circuit {
  constructor(fetchImpl, ua) {
    this.fetch = fetchImpl;
    this.ua = ua;
    this.helper = null;      // the page's DotNetObjectReference, handed to SetDotNetHelper
    this.renderer = null;    // the renderer's interop object, which receives DOM events
    this.callId = 0;
    this.section = null;     // the hidden field the app keeps the displayed section id in
    this.navSection = null;  // the section id the app last pushed into the address bar
    this.contents = [];      // every policy body rendered, in order
    this.tree = new Map();   // search result items by data-treeindex
    this.searchStatus = null;
    this.appError = false;
    this.closed = null;
  }

  headers(extra = {}) { return { "User-Agent": this.ua, "X-Requested-With": "XMLHttpRequest", ...extra }; }

  async open(pageUrl) {
    const res = await this.fetch(pageUrl, { headers: { "User-Agent": this.ua, Accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`BoardPolicyOnline answered HTTP ${res.status} for ${pageUrl}`);
    const html = await res.text();
    const records = [...html.matchAll(/<!--Blazor:(\{[\s\S]*?\})-->/g)]
      .map((m) => { try { return JSON.parse(m[1]); } catch { return null; } })
      .filter((r) => r?.type);
    if (!records.length) throw new Error(`BoardPolicyOnline served ${html.length} bytes with no Blazor component markers for ${pageUrl}; the app has changed shape and this reader needs updating.`);
    records.forEach((r, i) => { r.uniqueId = i; });
    const neg = await (await this.fetch(`${BPO}/_blazor/negotiate?negotiateVersion=1`, { method: "POST", headers: this.headers(), signal: AbortSignal.timeout(20000) })).json();
    if (!neg?.connectionToken) throw new Error("BoardPolicyOnline's negotiate call returned no connection token.");
    this.url = `${BPO}/_blazor?id=${encodeURIComponent(neg.connectionToken)}`;
    await this.poll();
    await this.post(Buffer.from('{"protocol":"blazorpack","version":1}\x1e'));
    this.handshake = false;
    await this.send([1, {}, "0", "StartCircuit", [`${BPO}/`, pageUrl, JSON.stringify(records), ""], []]);
  }

  async post(body) {
    const res = await this.fetch(this.url, { method: "POST", body, headers: this.headers({ "Content-Type": "application/octet-stream" }), signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`BoardPolicyOnline refused a message on the connection (HTTP ${res.status}).`);
  }

  send(msg) { return this.post(frame(msg)); }

  // A long poll the server holds open until it has something to say. Cut short after a while so a
  // quiet page does not hold the caller for the server's full ninety seconds.
  async poll(ms = 12000) {
    let res;
    try {
      res = await this.fetch(`${this.url}&_=${Date.now()}`, { headers: this.headers({ Accept: "*/*" }), signal: AbortSignal.timeout(ms) });
    } catch { return Buffer.alloc(0); }
    if (res.status === 204 || res.status === 404) { this.closed = `the server closed the connection (HTTP ${res.status})`; return Buffer.alloc(0); }
    if (!res.ok) throw new Error(`BoardPolicyOnline's connection poll answered HTTP ${res.status}.`);
    return Buffer.from(await res.arrayBuffer());
  }

  invokeDotNet(objectId, method, args) {
    return this.send([1, {}, null, "BeginInvokeDotNetFromJS", [String(++this.callId), null, method, objectId, JSON.stringify(args)], []]);
  }

  click(handler) {
    const mouse = { detail: 1, screenX: 0, screenY: 0, clientX: 0, clientY: 0, offsetX: 0, offsetY: 0, pageX: 0, pageY: 0, movementX: 0, movementY: 0, button: 0, buttons: 0, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, type: "click" };
    return this.invokeDotNet(this.renderer, "DispatchEventAsync", [{ eventHandlerId: handler, eventName: "click", eventFieldInfo: null }, mouse]);
  }

  // Read and answer messages until `done` says so or time runs out.
  async pump(done, ms) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (done(this)) return true;
      if (this.closed) throw new Error(`BoardPolicyOnline ended the session: ${this.closed}.`);
      let buf = await this.poll(Math.max(1000, Math.min(12000, until - Date.now())));
      if (!this.handshake) {
        const i = buf.indexOf(0x1e);
        if (i < 0) continue;
        this.handshake = true;
        buf = buf.subarray(i + 1);
      }
      if (buf.length) for (const m of unframe(buf)) await this.handle(m);
    }
    return done(this);
  }

  // Until nothing has arrived for `quietMs`: the page has finished what it does on its own.
  async settle(quietMs, ms) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (this.closed) throw new Error(`BoardPolicyOnline ended the session: ${this.closed}.`);
      const buf = await this.poll(quietMs);
      if (!buf.length) return true;
      for (const m of unframe(buf)) await this.handle(m);
    }
    return false;
  }

  async handle(m) {
    if (m[0] === 7) { this.closed = m[1] || "close message"; return; }
    if (m[0] === 3 && m[2] === "0" && (m[3] === 1 || !m[4])) { this.closed = `StartCircuit failed${m[4] ? `: ${m[4]}` : ""}`; return; }
    if (m[0] !== 1) return;
    const [, , , target, args] = m;
    if (target === "JS.RenderBatch") {
      this.absorb(readBatch(args[1]));
      await this.send([1, {}, null, "OnRenderCompleted", [args[0], null], []]);
    } else if (target === "JS.BeginInvokeJS") {
      const [handle, identifier, argsJson, resultType] = args;
      const ref = /"__dotNetObject":(\d+)/.exec(argsJson ?? "");
      if (identifier === "SetDotNetHelper" && ref) this.helper = Number(ref[1]);
      if (identifier === "Blazor._internal.attachWebRendererInterop" && ref) this.renderer = Number(ref[1]);
      if (identifier === "Blazor._internal.navigationManager.navigateTo") {
        try { this.navSection = JSON.parse(JSON.parse(argsJson)[1]?.historyEntryState ?? "null")?.Id || this.navSection; } catch { /* no state */ }
      }
      if (handle) await this.send([1, {}, null, "EndInvokeJSFromDotNet", [handle, true, JSON.stringify([handle, true, jsAnswer(identifier, argsJson, resultType, handle)])], []]);
    } else if (target === "JS.Error") {
      this.closed = `the app reported an error: ${String(args?.[0]).slice(0, 200)}`;
    }
  }

  absorb(frames) {
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      if (f.t === "attr" && f.name === "value" && SECTION_VALUE.test(f.value ?? "")) this.section = f.value;
      if ((f.t === "markup" || f.t === "text") && f.s) {
        if (APP_ERROR.test(f.s)) this.appError = true;
        const status = f.s.match(/Search complete\.\s*(\d+) results? found/i);
        if (status) this.searchStatus = Number(status[1]);
        if (f.t === "markup" && f.s.includes('id="policy-content-title"')) {
          this.contents.push({ html: f.s, title: plain(f.s.match(/<h1[^>]*id="policy-content-title"[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? ""), section: this.section });
        }
      }
      if (f.t === "el" && f.name === "li") this.treeItem(frames.slice(i, i + f.len));
    }
  }

  // A search result is a TreeView item whose label starts with its hit count, "(3) Policy Code: 4300 ...".
  // That count is what tells it apart from the manual's own table of contents, which uses the same
  // component. Folders carry a toggle; documents do not.
  treeItem(sub) {
    const attrs = [];
    for (let k = 1; k < sub.length && sub[k].t === "attr"; k++) attrs.push(sub[k]);
    const attr = (name) => attrs.find((a) => a.name === name);
    const index = attr("data-treeindex")?.value;
    if (!index) return;
    const texts = [];
    let toggle = null;
    for (let k = 1; k < sub.length; k++) {
      const f = sub[k];
      if (f.t === "el" && f.name === "ul") break;
      if (f.t === "text" && f.s?.trim()) texts.push(f.s.trim());
      if (f.t === "attr" && f.name === "class" && /k-treeview-toggle/.test(f.value ?? "")) {
        toggle = sub.slice(Math.max(1, k - 4), k).reverse().find((a) => a.t === "attr" && a.name === "onclick")?.handler ?? sub.slice(k + 1, k + 4).find((a) => a.t === "attr" && a.name === "onclick")?.handler ?? -1;
      }
    }
    if (texts[0] !== "(" || texts[2] !== ")") return;
    this.tree.set(index, {
      index,
      label: texts.slice(3).join(" ").trim(),
      count: Number(texts[1]),
      click: attr("onclick")?.handler ?? null,
      toggle,
      expanded: attr("aria-expanded")?.value === "true",
      selected: attr("aria-selected")?.value === "true",
    });
  }
}

function plain(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|li|ol|ul|tr|table|h[1-6]|article|blockquote)\b[^>]*>/gi, "\n")
    .replace(/<\/?t[dh]\b[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;|&rsquo;|&lsquo;/gi, "'").replace(/&ldquo;|&rdquo;/gi, '"')
    .replace(/&sect;/gi, "\u00a7").replace(/&ndash;/gi, "\u2013").replace(/&mdash;/gi, "\u2014")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/[ \t\r\f\v]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

// "Policy Code: 4300 Student Code of Conduct" (NCSBA) or "Policy JKA RESTRAINT, SECLUSION, ..." (SCSBA).
export function bpoTitle(title) {
  const m = String(title).match(/^(Policy|Regulation|Exhibit|Form|Administrative (?:Rule|Regulation|Procedure))(?:\s+Code:)?\s+([A-Z0-9][A-Za-z0-9.\-\/]*)\s+(.+)$/i);
  return m ? { kind: m[1], code: m[2], name: m[3].trim() } : { kind: null, code: null, name: String(title).trim() };
}

// The footer dates. NCSBA manuals write "Adopted: July 19, 2010" then "Revised:" and one date per line;
// SCSBA manuals open with "Issued 10/23" and close with "Adopted 5/2/22; Revised 10/3/23", and an old
// adoption is often only a month: "Adopted 11/06".
const DATE = /(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b\d{1,2}\/\d{2,4}\b(?!\/)/g;
export function bpoDates(text) {
  const t = String(text);
  const issued = t.match(/\bIssued\s+(\d{1,2}\/\d{2,4})/)?.[1] ?? null;
  const at = [...t.matchAll(/\bAdopted\b/g)].pop()?.index;
  if (at === undefined) return { issued, adopted: null, revised: [], last_revised: null, dates_line: null };
  const block = t.slice(at, at + 700).split(/\n\s*(?:Legal Reference|Cross Reference|Legal References|Cross References)/i)[0];
  const adoptedPart = block.split(/\bRevised\b/i)[0];
  const adopted = adoptedPart.match(DATE)?.[0] ?? null;
  const revisedPart = block.slice(adoptedPart.length);
  const revised = revisedPart.match(DATE) ?? [];
  return {
    issued,
    adopted,
    revised,
    last_revised: revised.length ? revised[revised.length - 1] : null,
    dates_line: block.replace(/\s+/g, " ").trim().slice(0, 400),
  };
}

// One circuit at a time per process. A circuit is a few dozen requests over ten to forty seconds, and
// MicroScribe hosts every board on one service; a fleet opening them in parallel would be the burst
// that gets the server's address refused.
let queue = Promise.resolve();
function exclusive(job) {
  const run = queue.then(job, job);
  queue = run.catch(() => {});
  return run;
}

async function withCircuit(fetchImpl, ua, pageUrl, fn) {
  return exclusive(async () => {
    const c = new Circuit(fetchImpl, ua);
    try {
      await c.open(pageUrl);
      return await fn(c);
    } finally {
      if (c.url) await fetchImpl(c.url, { method: "DELETE", headers: c.headers(), signal: AbortSignal.timeout(5000) }).catch(() => {});
    }
  });
}

const READ_MS = 40_000;

export async function bpoReadSection(key, section, { fetchImpl = fetch, ua }) {
  const url = bpoSectionUrl(key, section);
  return withCircuit(fetchImpl, ua, url, async (c) => {
    const shown = () => c.contents.find((x) => x.section === section || (c.navSection === section && x.title));
    await c.pump(() => shown() || c.appError, READ_MS);
    const got = shown();
    if (!got) {
      if (c.appError) throw new Error(`BoardPolicyOnline's app failed while rendering section ${section} of '${key}' ("An unknown error occurred"). Retry once; if it repeats, report_issue with the URL.`);
      throw new Error(`BoardPolicyOnline did not render a policy for section ${section} of '${key}' within ${READ_MS / 1000} seconds. Check the section id in a browser; ids are global, so one copied from another board shows that board's policy or nothing.`);
    }
    const html = got.html.match(/<article[^>]*policy-content-content[^>]*>([\s\S]*?)<\/article>/)?.[1] ?? got.html;
    return { url, section, title: got.title, text: plain(html) };
  });
}

// Search the manual the way the page's own search box does, then open each hit to learn its section id.
// The first hit is displayed by the search itself; the rest are clicked. A folder that the results tree
// left collapsed is expanded first, so a hit is not missed for being in a closed branch.
export async function bpoSearch(key, query, { fetchImpl = fetch, ua, maxHits = 8 }) {
  return withCircuit(fetchImpl, ua, `${BPO}/b/${key}`, async (c) => {
    await c.pump(() => c.helper !== null && c.renderer !== null, 20_000);
    if (c.helper === null || c.renderer === null) throw new Error(`BoardPolicyOnline did not finish loading the manual for '${key}'. Check the key against the district's own policy link.`);
    // The page loads its table of contents after the first render; a search sent before that settles is
    // answered with an exception.
    await c.settle(2500, 20_000);
    await c.invokeDotNet(c.helper, "LoadSearch", [query]);
    await c.pump(() => c.searchStatus !== null || c.appError, 30_000);
    if (c.appError) throw new Error(`BoardPolicyOnline's app failed while searching '${key}' for "${query}". Retry once; if it repeats, report_issue.`);
    if (c.searchStatus === null) throw new Error(`BoardPolicyOnline did not answer a search of '${key}' within 30 seconds.`);
    if (c.searchStatus === 0) return { results: 0, hits: [] };
    // The first hit's body is rendered before the results tree that lists it.
    await c.pump(() => c.contents.length > 0, 10_000);
    await c.settle(2500, 20_000);

    for (let round = 0; round < 6; round++) {
      const closed = [...c.tree.values()].filter((n) => n.toggle && n.toggle > 0 && !n.expanded);
      if (!closed.length) break;
      for (const n of closed) {
        n.expanded = true;
        const before = c.tree.size;
        await c.click(n.toggle);
        await c.pump(() => c.tree.size > before, 6000);
      }
    }

    const leaves = [...c.tree.values()].filter((n) => !n.toggle).sort((a, b) => a.index.localeCompare(b.index, "en", { numeric: true }));
    const hits = [];
    for (const leaf of leaves.slice(0, maxHits)) {
      let section = c.contents.find((x) => x.title === leaf.label && x.section)?.section ?? null;
      if (!section && leaf.click) {
        const seen = c.contents.length, before = c.section;
        await c.click(leaf.click);
        await c.pump(() => c.contents.slice(seen).some((x) => x.title === leaf.label), 15_000);
        // The hidden section field and the body arrive in either order; give the field a moment.
        await c.pump(() => c.section !== before, 3000);
        if (c.section !== before && c.contents.slice(seen).some((x) => x.title === leaf.label)) section = c.section;
      }
      hits.push({ title: leaf.label, matches_in_document: leaf.count, section });
    }
    return { results: c.searchStatus, hits, more: Math.max(0, leaves.length - maxHits) };
  });
}

const SEARCH_TTL_MS = 60 * 60 * 1000;
const searchCache = new Map();

export function registerBoardPolicyOnline(server, { z, text, fail, documents, fetchImpl = fetch, ua, terms = ["corporal punishment"] }) {
  server.registerTool(
    "fetch_boardpolicyonline_policy",
    {
      title: "Read a district's board policy on BoardPolicyOnline",
      description:
        "BoardPolicyOnline (MicroScribe; boardpolicyonline.com) carries board policy for most North Carolina districts and the South Carolina districts on SCSBA's Policies Online. Its pages are a Blazor app that serves no text to a plain fetch; this reads the policy the way the page does. " +
        "Give the board key (the b= value or the /b/<key>/ part of the district's link, e.g. greene, warren, florence, hampton_consolidated, clarendon_county) and either a section id you already have, or a search. With no section it searches the manual for `query` (default 'corporal punishment'), lists every hit with its section id, and returns the text of the first few. Pass `code` to keep only the hit with that policy code (NC 4300, SC JK). " +
        "Each policy comes back with its title, code, Issued/Adopted/Revised dates as printed in the policy, plain text, and the passages mentioning corporal punishment. The text is cached under its v3 section URL, so cite that URL as `source` and your quote verifies against what you read here. A search takes twenty to sixty seconds; reading a section already read is instant.",
      inputSchema: {
        board: z.string().trim().min(2).describe("Board key, e.g. 'greene', or any BoardPolicyOnline URL for the district"),
        section: z.string().regex(/^\d{3,9}$/).optional().describe("A section id from a /b/<key>/s/<id> URL, when you already have one"),
        query: z.string().trim().min(2).optional().describe("What to search the manual for (default 'corporal punishment'; with only `code` given, the code itself)"),
        code: z.string().trim().optional().describe("Keep only hits with this policy code, e.g. '4300' or 'JK'"),
        max_policies: z.number().int().min(1).max(5).optional().describe("How many hits to read in full (default 3)"),
      },
    },
    async ({ board, section: sectionArg, query, code, max_policies = 3 }) => {
      const target = bpoTarget(board);
      if (!target) return fail(`'${board}' does not contain a BoardPolicyOnline board key. Look for b=<key> or /b/<key>/ in the district's policy link.`);
      const { key } = target;
      const section = sectionArg ?? target.section;
      const opts = { fetchImpl, ua };

      const read = async (id) => {
        const url = bpoSectionUrl(key, id);
        const cached = documents?.read?.(url);
        if (cached?.extracted_by === "boardpolicyonline-blazor" && cached.text?.length > 20) return { url, section: id, title: cached.bpo_title ?? null, text: cached.text, from_cache: true };
        const got = await bpoReadSection(key, id, opts);
        if (got.text.length > 20) documents?.put?.(url, got.text, { content_type: "text/html", extracted_by: "boardpolicyonline-blazor", bpo_title: got.title });
        return got;
      };
      const describe = (got) => {
        const low = got.text.toLowerCase();
        const passages = [];
        for (const t of terms) {
          const needle = String(t).toLowerCase();
          let i = 0;
          while (passages.length < 6) {
            const at = low.indexOf(needle, i);
            if (at < 0) break;
            const s0 = Math.max(0, at - 240), e0 = Math.min(got.text.length, at + needle.length + 360);
            passages.push({ term: t, context: (s0 ? "\u2026 " : "") + got.text.slice(s0, e0).replace(/\s+/g, " ").trim() + (e0 < got.text.length ? " \u2026" : "") });
            i = at + needle.length;
          }
        }
        const t = bpoTitle(got.title ?? "");
        return { title: got.title, code: t.code, url: got.url, section: got.section, ...bpoDates(got.text), chars: got.text.length, from_cache: got.from_cache ?? false, hits: passages, text: got.text.slice(0, 40000) };
      };
      const dateNote = "Dates are as printed in the policy: `adopted` is the original adoption, `last_revised` the latest revision listed, `issued` the SCSBA issue stamp. Check `dates_line` before relying on them.";

      if (section) {
        try { return text({ board: key, policies: [describe(await read(section))], next: `Cite the policy's url as source and quote from its text. ${dateNote}` }); }
        catch (err) { return fail(err.message, { board: key, section }); }
      }

      const q = query ?? (code ? code : "corporal punishment");
      const ck = `${key}|${q.toLowerCase()}`;
      let found = searchCache.get(ck);
      if (!found || Date.now() - found.at > SEARCH_TTL_MS) {
        try { found = { at: Date.now(), ...(await bpoSearch(key, q, opts)) }; }
        catch (err) { return fail(err.message, { board: key, query: q, next: "If you have a section id from the district's own site or a handbook link, call again with `section`." }); }
        searchCache.set(ck, found);
      }
      const listed = found.hits.map((h) => ({ ...h, code: bpoTitle(h.title).code, url: h.section ? bpoSectionUrl(key, h.section) : null }));
      const wanted = code ? listed.filter((h) => (h.code ?? "").toLowerCase() === code.toLowerCase()) : listed;
      const out = { board: key, query: q, results: found.results, hits: listed, ...(found.more ? { hits_not_opened: found.more } : {}) };
      if (!wanted.length) {
        out.next = found.results
          ? `No hit has code '${code}'. The hits are listed; call again with one of their section ids, or with a different query.`
          : `The manual has no match for "${q}". Try the policy's title words, or 'discipline'. A manual with no mention of corporal punishment is a finding about the manual, not proof of the district's practice.`;
        return text(out);
      }
      out.policies = [];
      for (const h of wanted.filter((x) => x.section).slice(0, max_policies)) {
        try {
          const got = await read(h.section);
          if (got.title && h.title && got.title !== h.title) {
            out.policies.push({ title: h.title, section: h.section, url: h.url, error: `Section ${h.section} shows '${got.title}', not the search hit '${h.title}'. The section id was misread; open the hit in a browser and pass its id.` });
            continue;
          }
          out.policies.push(describe(got));
        } catch (err) { out.policies.push({ title: h.title, section: h.section, url: h.url, error: err.message }); }
      }
      out.next = `Cite a policy's url as source and quote from its text. ${dateNote} Hits not read in full can be read by passing their section.`;
      return text(out);
    }
  );
  return ["fetch_boardpolicyonline_policy"];
}
