// Find a district's elected board members on its own website: name, role (president, vice president,
// member, trustee, place N), an office email if the district publishes one, and the term end if shown.
// Public pages only; nothing is guessed. Free-mail addresses and anything that is not a district-domain
// mailbox are dropped, so a member whose only published address is a personal one is recorded by name.
//
// Every page is read in a real browser (Playwright, one Chromium for the whole run) because a large
// share of district sites (Apptegy, Finalsite, SharpSchool behind F5) answer a plain fetch with a
// JavaScript challenge and nothing else. At most three pages are open at once; 5xx answers are retried
// with a backoff; images, fonts and media are never requested.
//
// Usage: node harvest-board.mjs [--in data/outreach/policy-lag.json] [--out data/contacts/board-members.jsonl]
//                               [--start 0] [--limit 250] [--only 4818180,4808090] [--concurrency 3] [--redo]
// Resumable: a district whose nces_id is already in the output is skipped unless --redo.
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPolicyLag } from "./build-policy-lag.mjs";
const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const abs = (p) => isAbsolute(p) ? p : join(root, p);

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith("--") ? [a.slice(2), all[i + 1]?.startsWith("--") || all[i + 1] === undefined ? true : all[i + 1]] : []).filter((x) => x.length));
const IN = abs(args.in || "data/outreach/policy-lag.json");
const OUT = abs(args.out || "data/contacts/board-members.jsonl");
const START = Number(args.start || 0), LIMIT = Number(args.limit || 250), CONC = Math.min(3, Number(args.concurrency || 3));
const ONLY = args.only ? new Set(String(args.only).split(",")) : null;
const TODAY = new Date().toISOString().slice(0, 10);
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const MAX_PAGES = 10;
const DISTRICT_MS = 150_000; // a slow site gets two and a half minutes, then the next district

// ---------- text patterns ----------
const FREEMAIL = /@(gmail|yahoo|hotmail|aol|outlook|icloud|msn|live|ymail|comcast|att|sbcglobal|bellsouth|verizon|charter|cox|me|mac|protonmail|proton|windstream|suddenlink|centurylink|earthlink|juno|netzero|mail|email|yandex|zoho|gmx)\.(com|net|me|org)$/i;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const ROLE = /\b(?:president|vice[\s-]*president|vice[\s-]*chair(?:man|woman|person)?|chair(?:man|woman|person)?|secretary|treasurer|clerk|trustee|member|director|at[\s-]*large|single[\s-]*member|place\s*[:#]?\s*\d+|district\s*[:#]?\s*\d+|position\s*[:#]?\s*\d+|seat\s*[:#]?\s*\d+|zone\s*[:#]?\s*\d+|ward\s*[:#]?\s*\d+|precinct\s*[:#]?\s*\d+|region\s*[:#]?\s*\d+|area\s*[:#]?\s*\d+|post\s*[:#]?\s*\d+)\b/i;
const ROLE_EXCLUDE = /superintendent|principal|senat|house district|legislat|congress|state representative|u\.?s\.? representative|commissioner|mayor|council|liaison|cabinet|coordinator|specialist|manager|counselor|nurse|teacher|director of|of (?:schools|finance|curriculum|technology|transportation|operations|human|special|student|instruction|federal|food|child|maintenance|athletics|communications|personnel|business|testing|safety|security|facilities)|assistant|executive|secretary to|administrative|staff|team member|members? of|membership|member since|member login|remember|meeting|agenda|minutes|polic|handbook|email|e-mail|phone|contact|directory|login|menu|search|calendar|office|message|welcome|letter|'s\b|’s\b|elected officials|candidate|election|committee chair|chair of|district office|district website|district home|district\s*(?:calendar|news|info)|school district|school board\s+(?:of|meeting|home)|\bisd\b|\bcisd\b|schools?\b|county\b|parish\b|university|college|foundation|chamber|bank|company|inc\b|llc|\d{3}[-.)]\s*\d{3}|@|http|www\./i;
const STOP = /\b(?:front|row|send|message|email|click|photo|pictured|left|right|standing|seated|not|and|or|the|liaison|cabinet|attached|elections|legislative|representative|superintendent|educator|executive|form|decision|making|owner|engineer|attorney|realtor|consultant|pharmacist|physician|accountant|banker|businessman|businesswoman|homemaker|rancher|insurance|agent|sales|voting|elect|bio|biography|profile|photo|image|picture|headshot|school|schools|district|board|county|parish|isd|cisd|high|elementary|middle|academy|primary|intermediate|junior|senior|meeting|meetings|agenda|agendas|minutes|office|contact|email|phone|home|about|news|calendar|staff|student|students|parent|parents|department|departments|services|program|programs|policy|policies|welcome|read|learn|click|here|view|menu|search|login|skip|facebook|twitter|instagram|youtube|copyright|rights|reserved|privacy|site|web|map|powered|portal|links|events|lunch|breakfast|directory|employment|careers|jobs|athletics|library|technology|transportation|nutrition|special|education|curriculum|bus|pay|apply|enroll|enrollment|register|registration|report|reports|forms|handbook|code|conduct|safety|health|resources|community|foundation|alumni|donate|volunteer|teacher|teachers|coach|principal|superintendent|assistant|director|coordinator|secretary|clerk|treasurer|president|member|members|trustee|trustees|chair|vice|term|terms|expires|elected|place|position|seat|zone|ward|precinct|area|region|address|street|road|avenue|drive|suite|box|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|july|september|october|november|december|public|notice|open|close|closed|hours|fax|call|visit|more|all|new|our|your|my|us|we|press|release|spotlight|featured|important|information|info|quick|upcoming|latest|recent|announcement|announcements|covid|mission|vision|values|history|facts|overview|profile|accountability|budget|finance|financial|bond|tax|rate|plan|strategic|improvement|goals|committee|council|association|union|chamber|commerce|city|town|state|texas|oklahoma|georgia|louisiana|mississippi|alabama|arkansas|tennessee|indiana|missouri|kansas|kentucky|carolina|florida|arizona|central|unified|independent|consolidated|regular|session|workshop|work|training|conference|summit|week|month|year|time|date|location|room|building|campus|center|annex|administration|administrative|admin|title|ix|ada|section|notice|non|discrimination|nondiscrimination|equal|opportunity|accessibility|translate|language|english|spanish|español|español|sign|log|out|in|up|view|download|print|share|subscribe|feed|rss|live|stream|video|photo|photos|gallery|bulletin|dashboard|skyward|powerschool|canvas|google|classroom|office365|clever|infinite|tyler|frontline|edlio|apptegy|finalsite|blackboard|sharpschool|schoolwires|weebly|wix|site|sitemap|questions|faq|help|support|feedback|survey|wellness|counseling|guidance|discipline|attendance|dress|grading|testing|assessment|gifted|talented|dyslexia|esl|bilingual|migrant|homeless|foster|military|mckinney|vento|child|find|sb|hb|covid|free|reduced|meal|meals|menu|menus|cafeteria|lifetouch|yearbook|graduation|commencement|prom|homecoming|football|basketball|baseball|softball|soccer|volleyball|tennis|wrestling|ffa|fccla|robotics|uil|stem|steam|cte|career|technical|college|university|scholarship|scholarships|tuition|fees|fee|payment|payments|online|virtual|remote|hybrid|distance|learning|teaching|instruction|instructional|academic|academics|grades|pre|k|kindergarten|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|grade|level|levels|campus|campuses|facility|facilities|maintenance|operations|custodial|grounds|warehouse|purchasing|procurement|bids|rfp|rfq|vendors|vendor|contractors|construction|projects|project|capital|range|comprehensive|annual|monthly|weekly|daily|back|next|previous|prev|last|top|bottom|left|right|main|primary|secondary|content|header|footer|navigation|nav|toggle|dropdown|expand|collapse|accordion|tab|tabs|panel|modal|dialog|popup|alert|alerts|notification|notifications|emergency|weather|closing|closings|delay|delays|cancellation|cancellations|early|late|dismissal|release|schedule|schedules|calendar|calendars|holiday|holidays|break|breaks|vacation|semester|semesters|quarter|quarters|trimester|period|periods|blocks|lunch|recess|study|library|media|lab|labs|computer|computers|technology|tech|it|network|wifi|internet|device|devices|chromebook|chromebooks|ipad|ipads|laptop|laptops|one|two|three|four|five|six|seven|eight|nine|ten|cte)\b/i;
const HONOR = "(?:Dr|Mr|Mrs|Ms|Miss|Mx|Rev|Hon|Judge|Pastor|Coach|Sen|Rep|Fr|Sr|Bro|Dcn|Capt|Col|Maj|Sgt|Lt|Rabbi|Bishop|Elder)\\.?";
const SUFFIX = "(?:Jr|Sr|II|III|IV|V|Ph\\.?D|Ed\\.?D|M\\.?D|D\\.?D\\.?S|D\\.?V\\.?M|C\\.?P\\.?A|Esq|R\\.?N|Pharm\\.?D|M\\.?Ed|M\\.?B\\.?A|M\\.?S|B\\.?S|B\\.?A|J\\.?D|D\\.?O|P\\.?E|LPC|LCSW|FNP|PA-C|NP|DNP|CFP|AIA)\\.?";
const WORD = "(?:[A-Z][a-zA-Z'’\\-]*\\.?|[A-Z]\\.|d[ei]|De|Del|Della|Di|La|Le|Van|Von|Der|Den|Mc|Mac|St\\.?|O')";
const NICK = "(?:\\s+(?:\"[^\"]{1,20}\"|“[^”]{1,20}”|\\([^)]{1,20}\\)|'[^']{1,20}'))?";
const NAME_RE = new RegExp(`^(?:${HONOR}\\s+)?((?:[A-Z][a-zA-Z'’\\-]*\\.?|[A-Z]\\.)${NICK}(?:\\s+${WORD}){1,3})(?:,?\\s+${SUFFIX})*,?\\s*$`);
const LASTFIRST = /^([A-Z][a-zA-Z'’\-]+(?:\s+[A-Z][a-zA-Z'’\-]+)?),\s+([A-Z][a-zA-Z'’\-]+(?:\s+[A-Z]\.?)?(?:\s+[A-Z][a-zA-Z'’\-]+)?)$/;
const DATE = "(?:(?:\\d{1,2}\\/)?20\\d\\d|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?,?\\s*20\\d\\d)";
const TERM = new RegExp(`(?:term|expires?|expiration|exp\\.?|through|until|ends?)[^\\d\\n]{0,30}?(${DATE}(?:\\s*(?:[-–—]|to|through|until)\\s*${DATE})?)`, "i");
const DATERANGE = new RegExp(`(${DATE})\\s*(?:[-–—]|to|through|until)\\s*(${DATE})`, "i");

const titleCase = (s) => s.replace(/[A-Za-z'’\-]+/g, (w) => /^(?:II|III|IV|V)$/.test(w) ? w : w[0].toUpperCase() + w.slice(1).toLowerCase()).replace(/\bMc([a-z])/g, (m, c) => "Mc" + c.toUpperCase());
function nameOf(line) {
  let s = line.replace(/\s+/g, " ").trim().replace(/[:;]+$/, "").replace(/^[-–—•·*]+\s*/, "").replace(/^(?:Jr|Sr|II|III|IV)\.?\s+/, "").trim();
  if (s.length < 5 || s.length > 48) return null;
  if (/^[A-Z'’\-. ]+$/.test(s) && /[A-Z]{2,}\s+[A-Z]{2,}/.test(s)) s = titleCase(s);
  if (STOP.test(s)) return null;
  if (ROLE.test(s)) return null;
  const lf = s.match(LASTFIRST); if (lf && !STOP.test(lf[1]) && !STOP.test(lf[2])) return `${lf[2]} ${lf[1]}`;
  const m = s.match(NAME_RE); if (!m) return null;
  const words = m[1].split(/\s+/).filter((w) => !/^["“(']/.test(w));
  if (words.length < 2 || words.length > 5) return null;
  if (words.every((w) => w.length <= 2)) return null;
  return m[1].replace(/\s+/g, " ");
}
function roleOf(line) {
  let s = line.replace(/\s+/g, " ").trim().replace(/^\([^)]*\)\s*/, "").replace(/^[-–—•·*]+\s*/, "").replace(/^board\s+/i, "").replace(/^(?:school\s+)?board\s+/i, "");
  if (s.length > 70 || !ROLE.test(s) || ROLE_EXCLUDE.test(s)) return null;
  if (nameOf(s)) return null; // a line that is itself a name
  // Trim leading honorific-type fragments like "Position:".
  s = s.replace(/^(?:position|role|title|office)\s*[:\-–]\s*/i, "").replace(/[,;|(]?\s*(?:term|expires?|exp\.|elected|serving|since)\b.*$/i, "").replace(/[,:;]+$/, "").trim();
  if (!ROLE.test(s)) return null;
  s = s.replace(/\b(place|district|position|seat|zone|ward|precinct|region|area|post)\s*[:#]\s*(\d)/gi, "$1 $2").replace(/\s{2,}/g, ", ");
  return titleCase(s).replace(/\bVice\s*-\s*/i, "Vice ").replace(/\bAt\s*-\s*Large/i, "At-Large").slice(0, 60);
}
function termOf(raw) {
  // "Term Start: 2021  Term End: 2027": the start is not the answer.
  const line = raw.replace(/\b(?:term\s*)?(?:start|started|began|begin|since|elected)\s*[:\-]?\s*(?:\d{1,2}\/)?20\d\d/gi, " ");
  // A term end is a year still ahead of the page; an earlier year is when service began, not when it ends.
  const ok = (v) => v && Number((v.match(/20\d\d/) || [0])[0]) >= 2024 ? v.replace(/\s+/g, " ").trim() : null;
  const bare = line.match(new RegExp(`^${DATE}$`, "i")); if (bare) return ok(bare[0]);
  const r = line.match(DATERANGE); if (r) return ok(r[2]);
  const m = line.match(TERM); if (m) return ok(m[1]);
  return null;
}
const normName = (n) => n.toLowerCase().replace(/"[^"]*"|“[^”]*”|\([^)]*\)|'[^']*'/g, "").replace(/\b(?:dr|mr|mrs|ms|miss|rev|hon|jr|sr|ii|iii|iv|phd|edd|md)\b\.?/g, "").replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();

// Walk the page's text lines and pair names with roles. Layout is either name-then-role (cards, most
// tables) or role-then-name (some tables, headings); the page's first name decides which, and a role on
// the same line (`Jane Doe, President`; `President: Jane Doe`; `Jane Doe (Place 3)`) needs no deciding.
export function extractMembers(lines, mailtos = []) {
  // Several members on one caption line ("Jane Doe, President; John Roe, Member") split at the semicolons;
  // a surname on its own line with a comma ("Brooks,") joins the given name on the next ("Justin").
  const raw = lines.flatMap((l) => l.split("\t")).flatMap((l) => (/;/.test(l) || l.length > 90) && (l.match(new RegExp(ROLE.source, "gi")) || []).length >= 2 ? l.split(/[;,]/) : [l]).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const L = [];
  for (let i = 0; i < raw.length; i++) {
    if (/^[A-Z][a-zA-Z'’\-]+\s*,$/.test(raw[i]) && i + 1 < raw.length && /^[A-Z][a-zA-Z'’\-]+(?:\s+[A-Z]\.?)?$/.test(raw[i + 1])) { L.push(`${raw[i + 1]} ${raw[i].replace(/\s*,$/, "")}`); i++; }
    else L.push(raw[i]);
  }
  const items = L.map((l) => {
    const same = sameLine(l);
    return { line: l, name: same?.name ?? nameOf(l), role: same?.role ?? roleOf(l), sameRole: same?.role ?? null, term: termOf(l) };
  });
  const nameIdx = items.map((it, i) => it.name ? i : -1).filter((i) => i >= 0);
  if (!nameIdx.length) return [];
  // Orientation vote: for each name without an inline role, which direction holds the nearest role?
  let before = 0, after = 0;
  for (const i of nameIdx) {
    if (items[i].sameRole) continue;
    const b = scan(items, i, -1, 3), a = scan(items, i, +1, 3);
    if (b >= 0 && a < 0) before++; else if (a >= 0 && b < 0) after++;
    else if (a >= 0 && b >= 0) { if (i - b < a - i) before++; else if (a - i < i - b) after++; }
  }
  // Tie (alternating list): the first name decides.
  if (before === after) { const i = nameIdx[0]; const b = scan(items, i, -1, 3); before = b >= 0 ? 1 : 0; after = b >= 0 ? 0 : 1; }
  const roleFirst = before > after;
  const out = new Map();
  for (const i of nameIdx) {
    const it = items[i];
    let role = it.sameRole;
    if (!role) { const j = scan(items, i, roleFirst ? -1 : +1, 3); if (j >= 0) role = items[j].role; else { const k = scan(items, i, roleFirst ? +1 : -1, 1); if (k >= 0) role = items[k].role; } }
    if (!role) continue;
    // Term and email: on the member's own lines, i.e. before the next name in either direction.
    const term = it.term ?? near(items, i, 4, (x) => x.term, roleFirst);
    let email = (it.line.match(EMAIL) || [])[0] ?? near(items, i, 4, (x) => (x.line.match(EMAIL) || [])[0], roleFirst);
    const key = normName(it.name);
    if (!email) { const last = key.split(" ").pop(), first = key.split(" ")[0]; for (const m of mailtos) { const ctx = normName(m.ctx || ""); const local = m.email.split("@")[0].toLowerCase(); if (ctx.includes(key) || (last.length >= 4 && (ctx.includes(last) && ctx.includes(first)) ) || (last.length >= 4 && local.includes(last) && (local.includes(first) || local.startsWith(first[0])))) { email = m.email; break; } } }
    if (email && (FREEMAIL.test(email) || /example|sentry|wixpress|\.png$|\.jpg$/i.test(email))) email = null;
    email = email ? email.toLowerCase() : null;
    const prev = out.get(key);
    if (prev) { prev.role ||= role; prev.email ||= email; prev.term_ends ||= term; }
    else out.set(key, { name: it.name, role, email, term_ends: term });
  }
  return [...out.values()];
}
// A member's details sit after the name when names lead (cards, most tables) and between the role and
// the next role when roles lead; never read into a neighbour's block.
function near(items, i, max, fn, roleFirst) {
  for (const dir of roleFirst ? [+1, -1] : [+1]) for (let d = 1; d <= max; d++) {
    const j = i + dir * d; if (j < 0 || j >= items.length || items[j].name) break;
    if (roleFirst && items[j].role && !items[j].sameRole) break;
    const v = fn(items[j]); if (v) return v;
  }
  return null;
}
function scan(items, i, dir, max) {
  for (let d = 1; d <= max; d++) { const j = i + dir * d; if (j < 0 || j >= items.length) return -1; if (items[j].name) return -1; if (items[j].role) return j; }
  return -1;
}
function sameLine(l) {
  if (l.length > 90) return null;
  let m = l.match(/^(.+?)\s*\(([^)]{3,40})\)\s*$/); if (m) { const n = nameOf(m[1]), r = roleOf(m[2]); if (n && r) return { name: n, role: r }; }
  for (const sep of [/\s+[-–—|]\s+/, /\s*[,:;|]\s+/, /\s+[-–—]\s*/]) {
    const parts = l.split(sep).map((s) => s.trim()).filter(Boolean);
    if (parts.length < 2 || parts.length > 4) continue;
    // Leading honorific+name, then role fragments: "Jane Doe, Vice President, Place 3"
    for (let k = 0; k < parts.length; k++) {
      const n = nameOf(parts[k]); if (!n) continue;
      const rest = parts.filter((_, j) => j !== k).map(roleOf).filter(Boolean);
      if (rest.length) return { name: n, role: rest.join(", ").slice(0, 60) };
    }
    const lf = l.match(/^([A-Z][a-zA-Z'’\-]+),\s+([A-Z][a-zA-Z'’\-]+)\s*[-–—|:]\s*(.+)$/); // "Doe, Jane - President"
    if (lf) { const r = roleOf(lf[3]); if (r && !STOP.test(lf[1]) && !STOP.test(lf[2])) return { name: `${lf[2]} ${lf[1]}`, role: r }; }
  }
  m = l.match(/^(.+?)\s+((?:Vice[\s-]*)?President|Vice[\s-]*Chair(?:man|woman|person)?|Chair(?:man|woman|person)?|Secretary|Treasurer|Trustee|Member)\s*$/i); // "Jane Doe President"
  if (m) { const n = nameOf(m[1]); if (n) return { name: n, role: titleCase(m[2]) }; }
  m = l.match(/^((?:Vice[\s-]*)?President|Vice[\s-]*Chair(?:man|woman|person)?|Chair(?:man|woman|person)?|Secretary|Treasurer|Trustee|Member)\s*[:\-–—]?\s+(.+)$/i); // "President Jane Doe"
  if (m) { const n = nameOf(m[2]); if (n) return { name: n, role: titleCase(m[1]) }; }
  return null;
}

// ---------- link scoring ----------
const BOARD_STRONG = /board of (?:education|trustees|directors|school)|school board|board members?\b|our board|meet (?:the |your |our )?board|board of ed\b|\btrustees\b|education board|^(?:the )?board$|boe\b|board bios|board profiles|who is on the board/i;
const BOARD_WEAK = /\bboard\b/i;
const BOARD_NOT = /bulletin|job|dashboard|article|earns|recogni|celebrat|congratulat|honor|announce|documents|files|legislat|senat|congress|representative|elected official|boarding|polic|meeting|agenda|minutes|boarddocs|message|goals|highlights|briefs|recap|news|video|live|stream|apply|election|candidate|docs|portal|calendar|packet|workshop|spotlight|award|recognition|resolution|evaluation|budget|bond|report|handbook|training|conference|appreciation|month|elect|filing|vacancy|application|facebook|twitter|instagram|youtube|linkedin|tasb|gssa|osba|msba|whiteboard|keyboard|onboard|scoreboard|billboard|chalkboard|clipboard|smartboard|leaderboard|chessboard|board game|headboard|surfboard|skateboard/i;
const SUB_MEMBERS = /members?\b|meet (?:the|our|your)|who we are|trustees|biograph|profiles|bios?\b|directory|roster|officers/i;
const ABOUT = /^(?:about(?: us)?|our district|district(?: info| information| profile)?|administration|leadership|district office|central office|about the district|our schools|governance)$/i;
const CONTACT_BOARD = /contact (?:the |your |our |a )?(?:board|trustees?)|email (?:the |your |our |a )?(?:board|trustees?)|board (?:contact|feedback|comment|input|inquiry|question)|message (?:the |your |our )?board|write (?:to )?(?:the )?board|public comment|speak to the board|talk to the board|ask the board|let's talk|contact form/i;
const SOCIAL = /facebook|twitter|x\.com|instagram|youtube|linkedin|vimeo|tiktok|google\.com|apple\.com|play\.google|docs\.google|drive\.google|boarddocs|tasb\.org|gamutonline|legistar|granicus|civicplus\.com\/calendar/i;
function baseDomain(h) { const p = h.replace(/^www\./, "").split("."); return p.length > 2 && /^(?:k12|us|org|com|net|edu)$/i.test(p[p.length - 2]) ? p.slice(-3).join(".") : p.slice(-2).join("."); }
function scoreLink(l, host) {
  let u; try { u = new URL(l.url); } catch { return 0; }
  if (!/^https?:$/.test(u.protocol) || SOCIAL.test(u.href)) return 0;
  if (/\.(pdf|docx?|xlsx?|pptx?|zip|jpe?g|png|gif)(\?|$)/i.test(u.pathname)) return 0;
  const t = (l.text || "").trim(), path = decodeURIComponent(u.pathname + u.search).replace(/[-_+]/g, " ");
  const same = baseDomain(u.hostname) === baseDomain(host);
  let s = 0;
  if (BOARD_STRONG.test(t) && !BOARD_NOT.test(t)) s += 3; else if (BOARD_WEAK.test(t) && !BOARD_NOT.test(t)) s += 1;
  if (/board/i.test(path) && !BOARD_NOT.test(path)) s += 1;
  if (/board.?(?:of.?)?(?:education|trustees|directors|members)|school.?board|trustees|our.?board|\/boe\b/i.test(path) && !BOARD_NOT.test(path)) s += 2;
  if (!same && s < 3) return 0;
  if (!same) s -= 1;
  if (/#|javascript:/.test(l.url) && u.pathname === "/") return 0;
  return s;
}

// ---------- browser ----------
let browser = null, ctx = null;
async function openBrowser() {
  const { chromium } = await import("playwright");
  browser = await chromium.launch({ headless: true });
  ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 }, locale: "en-US" });
  await ctx.route("**/*", (route) => { const t = route.request().resourceType(); return ["image", "font", "media", "stylesheet"].includes(t) ? route.abort() : route.continue(); });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHALLENGE = /Client Challenge|_imp_apg_|challenge-container|Just a moment|cf-browser-verification|Please enable JavaScript and reload|Checking your browser|Verifying you are human/i;

async function readPage(page, url, budget) {
  if (budget.n >= MAX_PAGES || Date.now() > budget.deadline) { if (Date.now() > budget.deadline) budget.errors.push("district time budget spent"); return null; } budget.n++;
  let status = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 35_000 });
      status = resp?.status() ?? 0;
      if (status >= 500 || status === 429) { await sleep([2000, 6000, 12000][attempt]); continue; }
      break;
    } catch (e) {
      if (attempt === 2) { budget.errors.push(`${url}: ${String(e.message).split("\n")[0].slice(0, 80)}`); return null; }
      if (/ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_REFUSED|ERR_CERT|ERR_SSL/.test(e.message)) { budget.errors.push(`${url}: ${e.message.match(/net::\w+/)?.[0] || "nav error"}`); return null; }
      await sleep(2000 * (attempt + 1));
    }
  }
  // 403/406/409 are what some F5 and Cloudflare fronts return with the challenge page; read on and let the content decide.
  if (status >= 400 && ![403, 406, 409].includes(status)) { budget.errors.push(`${url}: HTTP ${status}`); return null; }
  await page.waitForTimeout(1500);
  for (let i = 0; i < 2; i++) { const c = await page.content().catch(() => ""); if (!CHALLENGE.test(c) || c.length > 20_000) break; await page.waitForTimeout(5000); }
  try {
    const data = await page.evaluate(() => {
      const vis = (document.body?.innerText || "");
      const links = [...document.querySelectorAll("a[href]")].map((a) => ({ url: a.href, text: (a.textContent || a.getAttribute("aria-label") || a.getAttribute("title") || "").replace(/\s+/g, " ").trim().slice(0, 90) })).filter((l) => l.url && !/^(mailto|tel|javascript):/i.test(l.url));
      const mailtos = [...document.querySelectorAll("a[href^='mailto:']")].map((a) => ({ email: decodeURIComponent(a.getAttribute("href").slice(7).split("?")[0]).trim(), ctx: ((a.closest("li,tr,article,section,figure,.card,.staff,.member,.person,.profile,.bio,div,p") || a.parentElement)?.textContent || "").replace(/\s+/g, " ").slice(0, 300) }));
      const boardMail = [...new Set([...mailtos.map((m) => m.email), ...((document.body?.innerText || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [])].filter((e) => /^(?:[a-z.]*board[a-z.]*|trustees?|boe|schoolboard|boardmembers?|boardoftrustees|boardofeducation)@/i.test(e)))];
      const hasForm = [...document.querySelectorAll("form")].some((f) => f.querySelector("textarea") && !/search/i.test(f.getAttribute("role") || f.id || f.className || ""));
      // Hidden text too (tabs, accordions, dropdown menus): mark block boundaries, then read textContent.
      for (const e of document.querySelectorAll("script,style,noscript,svg,template")) e.remove();
      for (const e of document.querySelectorAll("br,p,div,li,tr,td,th,h1,h2,h3,h4,h5,h6,section,article,header,footer,dt,dd,figcaption,blockquote,span,a,strong,b,em,label")) { if (/^(SPAN|A|STRONG|B|EM|LABEL)$/.test(e.tagName) && !/^(block|flex|grid|table|list-item)/.test(getComputedStyle(e).display)) continue; e.insertAdjacentText("beforebegin", "\n"); e.insertAdjacentText("afterend", "\n"); }
      const all = document.body?.textContent || "";
      return { title: document.title, vis, all, links, mailtos, hasForm, boardMail };
    });
    const toLines = (s) => s.split(/\n|\t/).map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 4000);
    return { url: page.url(), title: data.title, lines: toLines(data.vis), allLines: toLines(data.all), links: data.links, mailtos: data.mailtos, hasForm: data.hasForm, boardMail: data.boardMail || [] };
  } catch (e) { budget.errors.push(`${url}: ${String(e.message).slice(0, 60)}`); return null; }
}

function membersFrom(p) {
  if (LEGIS.test(p.title || "") || LEGIS.test(p.url)) return [];
  let m = extractMembers(p.lines, p.mailtos);
  if (m.length < 3) { const m2 = extractMembers(p.allLines, p.mailtos); if (m2.length > m.length) m = m2; }
  // A staff directory looks like a long board. Boards are five to nine; keep a sane cap and flag it.
  return m.slice(0, 15);
}
const LEGIS = /legislat|senat|congress|representative|elected officials/i;
const isBoardish = (p) => !LEGIS.test(p.title || "") && !LEGIS.test(p.url) && BOARD_STRONG.test(p.title || "") || /board/i.test(p.url) || BOARD_STRONG.test(p.lines.slice(0, 40).join(" | "));

async function harvest(t) {
  const budget = { n: 0, errors: [], deadline: Date.now() + DISTRICT_MS };
  const page = await ctx.newPage();
  const row = { state: t.state, nces_id: t.nces_id, name: t.name, board_page: null, members: [], contact_form: null, board_email: null, checked: TODAY, notes: "" };
  const notes = [];
  try {
    if (!t.website) { row.notes = "no website on record"; return row; }
    let site = /^https?:\/\//.test(t.website) ? t.website : `https://${t.website}`;
    let home = await readPage(page, site, budget);
    if (!home && site.startsWith("https://")) { site = site.replace(/^https:/, "http:"); home = await readPage(page, site, budget); }
    if (!home) { row.notes = `site unreachable: ${budget.errors.join("; ").slice(0, 200)}`; return row; }
    const host = new URL(home.url).hostname;
    const seen = new Set([home.url.split("#")[0]]);
    const candidates = (p) => [...new Map(p.links.map((l) => [l.url.split("#")[0], { ...l, s: scoreLink(l, host) }]).filter(([u, l]) => l.s > 0 && !seen.has(u))).values()].sort((a, b) => b.s - a.s);
    let queue = candidates(home);
    // No board link on the home page: look one level down on About/District pages, then guess.
    if (!queue.length) {
      const about = home.links.filter((l) => ABOUT.test((l.text || "").trim()) && !seen.has(l.url.split("#")[0])).slice(0, 2);
      for (const l of about) { seen.add(l.url.split("#")[0]); const p = await readPage(page, l.url, budget); if (p) queue.push(...candidates(p)); }
      queue.sort((a, b) => b.s - a.s);
    }
    if (!queue.length) {
      const origin = new URL(home.url).origin;
      const slug = home.links.map((l) => l.url.match(/\/o\/([^/]+)\//)?.[1]).find(Boolean);
      const guesses = ["/board", "/board-of-trustees", "/board-of-education", "/school-board", "/about/board-of-education", "/about-us/board-of-education", "/page/board-of-trustees", "/page/board-of-education", "/page/school-board"];
      if (slug) guesses.unshift(`/o/${slug}/page/board-of-trustees`, `/o/${slug}/page/board-of-education`, `/o/${slug}/page/school-board`, `/o/${slug}/page/board-members`);
      queue = guesses.slice(0, 5).map((g) => ({ url: origin + g, text: g, s: 1 }));
      notes.push("no board link found; tried common paths");
    }
    let best = null, bestPage = null;
    const boardish = [];
    for (const c of queue.slice(0, 4)) {
      if (budget.n >= MAX_PAGES) break;
      const u = c.url.split("#")[0]; if (seen.has(u)) continue; seen.add(u);
      const p = await readPage(page, c.url, budget); if (!p) continue;
      if (isBoardish(p)) boardish.push(p);
      let m = membersFrom(p);
      if (m.length > (best?.length ?? 0)) { best = m; bestPage = p; }
      if (m.length >= 3) break;
      // Sub-pages of a board page: "Board Members", "Meet the Board", "Trustees".
      const subs = [...new Map(p.links.filter((l) => !seen.has(l.url.split("#")[0]) && (SUB_MEMBERS.test(l.text || "") || BOARD_STRONG.test(l.text || "")) && !BOARD_NOT.test(l.text || "") && scoreLink(l, host) > 0).map((l) => [l.url.split("#")[0], l])).values()].slice(0, 2);
      for (const l of subs) {
        if (budget.n >= MAX_PAGES) break;
        seen.add(l.url.split("#")[0]);
        const sp = await readPage(page, l.url, budget); if (!sp) continue;
        if (isBoardish(sp)) boardish.push(sp);
        const sm = membersFrom(sp);
        if (sm.length > (best?.length ?? 0)) { best = sm; bestPage = sp; }
        if (sm.length >= 3) break;
      }
      if ((best?.length ?? 0) >= 3) break;
    }
    const pagesForForm = [bestPage, ...boardish].filter(Boolean);
    // A mailbox for the whole board (board@, trustees@, schoolboard@) on the district's domain.
    row.board_email = pagesForForm.flatMap((p) => p.boardMail).map((e) => e.toLowerCase()).find((e) => !FREEMAIL.test(e)) ?? null;
    for (const p of pagesForForm) {
      const f = p.links.find((l) => CONTACT_BOARD.test(l.text || "") && !SOCIAL.test(l.url));
      if (f) { row.contact_form = f.url; break; }
      if (p.hasForm && /contact|comment|message|email|form/i.test(p.lines.join(" "))) { row.contact_form = p.url; break; }
    }
    if (best && best.length) {
      row.board_page = bestPage.url; row.members = best;
      if (best.length < 3) notes.push("fewer than three names parsed; page may list members in an image, PDF or widget");
      if (best.length >= 12) notes.push("twelve or more names; page may mix board and staff");
    } else if (boardish.length) {
      row.board_page = boardish[0].url; notes.push("board page found but no member names parsed (image, PDF, embedded widget, or names without roles)");
    } else {
      notes.push("no board page found");
    }
    if (!row.contact_form) { const g = home.links.find((l) => /^contact(?: us)?$/i.test((l.text || "").trim())); if (g) notes.push(`site contact page: ${g.url}`); }
    if (budget.errors.length) notes.push(`errors: ${budget.errors.slice(0, 3).join("; ").slice(0, 240)}`);
    row.notes = notes.join(". ");
    return row;
  } finally { await page.close().catch(() => {}); }
}

// ---------- run ----------
if (import.meta.url === `file://${process.argv[1]}`) {
  await openBrowser();
  // The input may lack enrollment (so the order is arbitrary) or a website the district record or the
  // state contact files do carry; fill both from the same build that produces the file, biggest first.
  const built = new Map(buildPolicyLag().map((r) => [String(r.nces_id), r]));
  const targets = JSON.parse(readFileSync(IN, "utf8")).map((t) => { const b = built.get(String(t.nces_id)); return { ...t, website: t.website || b?.website || null, enrollment: t.enrollment || b?.enrollment || 0 }; }).sort((a, b) => b.enrollment - a.enrollment);
  mkdirSync(dirname(OUT), { recursive: true });
  const existing = existsSync(OUT) ? readFileSync(OUT, "utf8").split("\n").filter(Boolean) : [];
  const picked = ONLY ? targets.filter((t) => ONLY.has(String(t.nces_id))) : targets.slice(START, START + LIMIT);
  // --redo replaces the rows for the districts picked, so the file keeps one line per district.
  if (args.redo) { const ids = new Set(picked.map((t) => String(t.nces_id))); writeFileSync(OUT, existing.filter((l) => !ids.has(String(JSON.parse(l).nces_id))).map((l) => l + "\n").join("")); }
  const done = new Set(args.redo ? [] : existing.map((l) => JSON.parse(l).nces_id));
  const slice = picked.filter((t) => !done.has(String(t.nces_id)));
  console.log(`${slice.length} districts to try (${done.size} already in ${OUT})`);
  let i = 0; const stats = { tried: 0, board: 0, members: 0, emails: 0, formOnly: 0 };
  const worker = async () => {
    while (i < slice.length) {
      const t = slice[i++];
      const t0 = Date.now();
      let row;
      try { row = await Promise.race([harvest(t), new Promise((_, rej) => setTimeout(() => rej(new Error("hard timeout")), DISTRICT_MS + 90_000))]); } catch (e) { row = { state: t.state, nces_id: t.nces_id, name: t.name, board_page: null, members: [], contact_form: null, checked: TODAY, notes: `error: ${String(e.message).slice(0, 120)}` }; }
      appendFileSync(OUT, JSON.stringify(row) + "\n");
      stats.tried++; if (row.board_page) stats.board++; if (row.board_email) stats.boardMail = (stats.boardMail || 0) + 1; stats.members += row.members.length; stats.emails += row.members.filter((m) => m.email).length; if (row.contact_form && !row.members.some((m) => m.email)) stats.formOnly++;
      const mark = row.members.length >= 3 ? "✓" : row.members.length ? "~" : row.board_page ? "·" : "×";
      console.log(`${mark} ${t.state} ${t.name.slice(0, 30).padEnd(31)} ${row.members.length} members, ${row.members.filter((m) => m.email).length} emails${row.contact_form ? ", form" : ""}  ${((Date.now() - t0) / 1000).toFixed(0)}s  ${row.notes.slice(0, 70)}`);
    }
  };
  await Promise.all(Array.from({ length: CONC }, worker));
  await browser.close();
  console.log(`tried ${stats.tried}; board pages ${stats.board}; members ${stats.members}; with office email ${stats.emails}; board mailboxes ${stats.boardMail || 0}; contact form only ${stats.formOnly}`);
  process.exit(0);
}
