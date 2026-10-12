// A Safe School certificate: letter landscape, EarthPilot navy and gold, thin-line filigree border, the
// district's own policy sentence, a QR code to its live page, and Anthony's signature. Renders HTML to a
// print-quality PDF and a PNG preview with Playwright.
//   node tools/certificates/make.mjs --state KS --name "Derby" --code JDA --quote "..." --url ... --qr out/certificates/qr.svg --out out/certificates/derby
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const state = arg("state", "KS"), name = arg("name", "Derby"), code = arg("code", "JDA"), year = arg("year", "2026–27");
const quote = arg("quote", "Corporal punishment shall not be permitted in the school district.");
const sup = arg("superintendent", "");
const level = arg("level", "district");            // district (board policy), school (a school's own handbook) or state (a statute)
const governor = arg("governor", ""), year_banned = arg("since", "");
const school = arg("school", ""), principal = arg("principal", ""), doc = arg("document", level === "school" ? "student handbook" : "board policy");
const url = arg("url", "https://earthpilot.org/kids/state/KS/"), out = arg("out", "out/certificates/derby");
const qr = readFileSync(arg("qr", "out/certificates/qr-derby.svg"), "utf8").replace(/<\?xml[^>]*>/, "");
const logo = "data:image/png;base64," + readFileSync(new URL("../../site/assets/earthpilot.png", import.meta.url)).toString("base64");
const signature = "data:image/png;base64," + readFileSync(new URL("../../assets/signature/anthony-david-adams.png", import.meta.url)).toString("base64");
const STATE = { AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "the District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming" }[state] || state;

// Guilloché: the engraved banknote border, generated. Hypotrochoid rosettes tiled along a band, a wave-line
// field behind the text, and a scalloped outer edge, all in EarthPilot navy at low weight. No stock art.
const W = 1056, H = 816;                      // 11in x 8.5in at 96px/in
const NAVY = "#0D132D", GOLD = "#B7791F";
function hypo(cx, cy, R, r, d, turns, steps = 720) {
  const pts = [];
  for (let i = 0; i <= steps; i++) { const t = (i / steps) * Math.PI * 2 * turns; const x = cx + (R - r) * Math.cos(t) + d * Math.cos(((R - r) / r) * t); const y = cy + (R - r) * Math.sin(t) - d * Math.sin(((R - r) / r) * t); pts.push(`${x.toFixed(1)},${y.toFixed(1)}`); }
  return `<polyline points="${pts.join(" ")}" fill="none" stroke="${NAVY}" stroke-width=".32" opacity=".34"/>`;
}
function rosette(cx, cy, size) {
  // three nested spirograph curves make one medallion
  return hypo(cx, cy, size, size * 0.29, size * 0.4, 13, 900) + hypo(cx, cy, size * 0.74, size * 0.21, size * 0.26, 7, 600) + hypo(cx, cy, size * 0.5, size * 0.12, size * 0.18, 9, 500) + `<circle cx="${cx}" cy="${cy}" r="${(size*0.12).toFixed(1)}" fill="none" stroke="${GOLD}" stroke-width=".6"/>`;
}
function waves(x0, y0, w, h, rows = 70, amp = 2.2, period = 60) {
  let out = "";
  for (let i = 0; i < rows; i++) { const y = y0 + (i / rows) * h; let d = `M${x0},${y.toFixed(1)}`; for (let x = x0; x <= x0 + w; x += 4) d += ` L${x},${(y + amp * Math.sin((x / period) * Math.PI * 2 + i * 0.35)).toFixed(1)}`; out += `<path d="${d}" fill="none" stroke="${NAVY}" stroke-width=".3" opacity=".16"/>`; }
  return out;
}
function band() {
  // the border band: medallions spaced so a medallion sits exactly on each corner, with the spacing
  // worked out per axis; ribbons use the same spacing so their crests meet the medallion centers.
  const B = 42; const nx = Math.round((W - 2 * B) / 72), ny = Math.round((H - 2 * B) / 72);
  const sx = (W - 2 * B) / nx, sy = (H - 2 * B) / ny; let out = "";
  const cells = [];
  for (let i = 0; i <= nx; i++) { cells.push([B + i * sx, B]); cells.push([B + i * sx, H - B]); }
  for (let j = 1; j < ny; j++) { cells.push([B, B + j * sy]); cells.push([W - B, B + j * sy]); }
  const ribbon = (pts) => { let d = ""; for (const [x, y] of pts) d += (d ? " L" : "M") + `${x.toFixed(1)},${y.toFixed(1)}`; return `<path d="${d}" fill="none" stroke="${NAVY}" stroke-width=".35" opacity=".38"/>`; };
  for (const k of [-1, 1]) for (const ph of [0, Math.PI]) {
    const top = [], bot = [], left = [], right = [];
    for (let i = 0; i <= Math.round((W - 2 * B) / 2); i++) { const x = B + i * 2 * (W - 2 * B) / (2 * Math.round((W - 2 * B) / 2)); const dy = 16 * Math.sin((x - B) / sx * Math.PI * 2 + ph) * k; top.push([x, B + dy]); bot.push([x, H - B + dy]); }
    for (let j = 0; j <= Math.round((H - 2 * B) / 2); j++) { const y = B + j * 2 * (H - 2 * B) / (2 * Math.round((H - 2 * B) / 2)); const dx = 16 * Math.sin((y - B) / sy * Math.PI * 2 + ph) * k; left.push([B + dx, y]); right.push([W - B + dx, y]); }
    out += ribbon(top) + ribbon(bot) + ribbon(left) + ribbon(right);
  }
  for (const [cx, cy] of cells) out += rosette(cx, cy, 28);
  // corners get a slightly larger medallion, drawn last so it sits on top
  for (const [cx, cy] of [[B, B], [W - B, B], [B, H - B], [W - B, H - B]]) out += rosette(cx, cy, 34);
  return out;
}
function scallop() {
  // the outer edge: an exact number of arcs per side, so every corner is a full arc meeting a full arc
  const m = 12; const r0 = 9;
  const nx = Math.round((W - 2 * m) / (2 * r0)), ny = Math.round((H - 2 * m) / (2 * r0));
  const rx = (W - 2 * m) / (2 * nx), ry = (H - 2 * m) / (2 * ny);
  let d = `M${m},${m}`;
  for (let i = 0; i < nx; i++) d += ` A${rx.toFixed(2)},${rx.toFixed(2)} 0 0 1 ${(m + (i + 1) * 2 * rx).toFixed(2)},${m}`;
  for (let j = 0; j < ny; j++) d += ` A${ry.toFixed(2)},${ry.toFixed(2)} 0 0 1 ${W - m},${(m + (j + 1) * 2 * ry).toFixed(2)}`;
  for (let i = nx; i > 0; i--) d += ` A${rx.toFixed(2)},${rx.toFixed(2)} 0 0 1 ${(m + (i - 1) * 2 * rx).toFixed(2)},${H - m}`;
  for (let j = ny; j > 0; j--) d += ` A${ry.toFixed(2)},${ry.toFixed(2)} 0 0 1 ${m},${(m + (j - 1) * 2 * ry).toFixed(2)}`;
  return `<path d="${d} Z" fill="#F7F8FB" stroke="${NAVY}" stroke-width="1" opacity=".9"/>`;
}
const background = `<svg class="bg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
${scallop()}
<rect x="20" y="20" width="${W - 40}" height="${H - 40}" fill="none" stroke="${NAVY}" stroke-width=".8" opacity=".7"/>
<rect x="24" y="24" width="${W - 48}" height="${H - 48}" fill="none" stroke="${GOLD}" stroke-width=".5"/>
${band()}
<rect x="76" y="76" width="${W - 152}" height="${H - 152}" fill="#FFFFFF"/>
${waves(76, 76, W - 152, H - 152)}
<rect x="76" y="76" width="${W - 152}" height="${H - 152}" fill="none" stroke="${NAVY}" stroke-width=".8"/>
<rect x="80" y="80" width="${W - 160}" height="${H - 160}" fill="none" stroke="${GOLD}" stroke-width=".5"/>
</svg>`;
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Safe School certificate: ${name}, ${STATE}</title>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=Great+Vibes&family=Source+Sans+3:wght@400;600&display=swap" rel="stylesheet">
<style>
@page{size:11in 8.5in;margin:0}html,body{margin:0;background:#fff}
.sheet{position:relative;width:11in;height:8.5in;background:#fff;color:#0D132D;font-family:'Cormorant Garamond',Georgia,serif;overflow:hidden}
.frame{position:absolute;inset:.42in;border:1px solid #B7791F}.frame2{position:absolute;inset:.5in;border:2px solid #0D132D}.frame3{position:absolute;inset:.58in;border:.5px solid #B7791F}
.corner{position:absolute;width:100px;height:100px}.tl{top:.64in;left:.64in}.tr{top:.64in;right:.64in;transform:scaleX(-1)}.bl{bottom:.64in;left:.64in;transform:scaleY(-1)}.br{bottom:.64in;right:.64in;transform:scale(-1,-1)}.vine{position:absolute;left:1.9in;right:1.9in}.vtop{top:.66in}.vbot{bottom:.64in}
.inner{position:absolute;inset:1.12in 1.4in 1.3in;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:space-between;gap:8px}
.mark{display:flex;align-items:center;gap:12px;font-family:'Source Sans 3',sans-serif;letter-spacing:.32em;text-transform:uppercase;font-size:11px;color:#5A6577}.mark img{width:34px;height:34px;border-radius:50%}
h1{font-weight:600;font-size:48px;letter-spacing:.08em;margin:2px 0 0;color:#0D132D}
.sub{font-family:'Source Sans 3',sans-serif;letter-spacing:.3em;text-transform:uppercase;font-size:11px;color:#B7791F;margin-top:6px}
.rule{width:220px;height:1px;background:linear-gradient(90deg,transparent,#B7791F,transparent);margin:14px auto}
.pres{font-style:italic;font-size:17px;color:#5A6577}.name{font-weight:600;font-size:42px;margin:0;line-height:1.1}.state{font-size:18px;color:#5A6577;letter-spacing:.08em}
.body{font-size:17px;line-height:1.5;max-width:7.3in;color:#293340;margin:0 0 6px}.body b{color:#0D132D}.orgs{display:flex;flex-wrap:wrap;justify-content:center;gap:4px 14px;max-width:8in;margin:0 auto 4px;font-family:'Source Sans 3',sans-serif;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:#0D132D}.orgs i{font-style:normal;color:#B7791F;margin-left:3px}
blockquote{margin:6px auto 0;max-width:6.6in;font-style:italic;font-size:18px;line-height:1.4;color:#0D132D}blockquote small{display:block;font-style:normal;font-family:'Source Sans 3',sans-serif;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#5A6577;margin-top:6px}
.foot{width:100%;display:grid;grid-template-columns:1fr auto 1fr;align-items:end;gap:20px}
.sig{text-align:center}.sig .handimg{height:62px;width:auto;display:block;margin:0 auto -6px}.sig .line{width:220px;height:1px;background:#0D132D;margin:0 auto 5px}.sig .who{font-family:'Source Sans 3',sans-serif;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#5A6577}
.seal{width:118px;height:118px;border-radius:50%;border:1.5px solid #B7791F;display:flex;align-items:center;justify-content:center;position:relative}.seal:before{content:"";position:absolute;inset:6px;border-radius:50%;border:.5px solid #B7791F}.seal img{width:62px;height:62px;border-radius:50%}
.qr{text-align:center}.qr svg{width:84px;height:84px;display:block;margin:0 auto 4px}.qr small{font-family:'Source Sans 3',sans-serif;font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;color:#5A6577}
.no{position:absolute;bottom:1.02in;left:0;right:0;text-align:center;font-family:'Source Sans 3',sans-serif;font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:#8B95A5}
.bg{position:absolute;inset:.22in;width:calc(100% - .44in);height:calc(100% - .44in)}</style></head><body><div class="sheet">
${background}
<div class="inner">
  <div>
    <div class="mark"><img src="${logo}" alt=""><span>EarthPilot · Safe Schools Project</span></div>
    <h1>${level === "state" ? "Safe Schools State" : "Safe School"}</h1><div class="sub">Recognition for the ${year} school year</div>
    <div class="rule"></div>
    <div class="pres">is presented to</div>
    <div class="name">${level === "school" ? school : level === "state" ? `The State of ${STATE}` : name}</div><div class="state">${level === "school" ? `${name} &middot; ${STATE}${principal ? ` &middot; ${principal}, Principal` : ""}` : level === "state" ? `${governor ? `Governor ${governor}` : ""}${governor && year_banned ? " &middot; " : ""}${year_banned ? `prohibited since ${year_banned}` : ""}` : `${STATE}${sup ? ` &middot; ${sup}, Superintendent` : ""}`}</div>
  </div>
  <div>
    <p class="body">${level === "state" ? `for a law that <b>prohibits corporal punishment in every public school</b> in the state, one of the 33 states that have done so, and in keeping with the position of` : level === "school" ? `for a written ${doc} that <b>prohibits corporal punishment</b> at the school, joining the 33 states that prohibit it by law and the position of` : `for a written board policy that <b>prohibits corporal punishment</b> in every school it governs, joining the 33 states that prohibit it by law and the position of`}</p>
<div class="orgs"><span>American Academy of Pediatrics <i>2023</i></span><span>American Psychological Association <i>2016</i></span><span>American Academy of Child &amp; Adolescent Psychiatry <i>2012</i></span><span>National Association of School Psychologists <i>2021</i></span><span>National PTA</span><span>U.S. Secretary of Education <i>2023</i></span><span>ACLU, NAACP, NEA, Children's Defense Fund <i>2016 open letter</i></span></div>
    <blockquote>“${quote}”<small>${level === "state" ? code : level === "school" ? `${doc.charAt(0).toUpperCase() + doc.slice(1)}${code ? ` · ${code}` : ""}` : `Board policy ${code}`} · recorded at earthpilot.org/kids</small></blockquote>
  </div>
  <div class="foot">
    <div class="sig"><img class="handimg" src="${signature}" alt="Anthony David Adams"><div class="line"></div><div class="who">Anthony David Adams · Founder, EarthPilot</div></div>
    <div class="seal"><img src="${logo}" alt=""></div>
    <div class="qr">${qr}<small>Live record · scan</small></div>
  </div>
</div>
<div class="no">Certificate ${state}-${(level === "school" ? school : level === "state" ? "STATE" : name).replace(/\W+/g, "").toUpperCase().slice(0, 10)}-${year.replace(/\D/g, "")} · verify at earthpilot.org/kids/state/${state}/</div>
</div></body></html>`;
writeFileSync(`${out}.html`, html);
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1056, height: 816 }, deviceScaleFactor: 2 });
await p.setContent(html, { waitUntil: "networkidle" }); await p.waitForTimeout(800);
await p.pdf({ path: `${out}.pdf`, width: "11in", height: "8.5in", printBackground: true, preferCSSPageSize: true });
await p.screenshot({ path: `${out}.png`, fullPage: false }); await b.close();
console.log(`wrote ${out}.html, ${out}.pdf, ${out}.png`);
