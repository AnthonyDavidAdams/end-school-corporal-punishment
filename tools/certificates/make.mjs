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
const url = arg("url", "https://earthpilot.org/kids/state/KS/"), out = arg("out", "out/certificates/derby");
const qr = readFileSync(arg("qr", "out/certificates/qr-derby.svg"), "utf8").replace(/<\?xml[^>]*>/, "");
const logo = "data:image/png;base64," + readFileSync(new URL("../../site/assets/earthpilot.png", import.meta.url)).toString("base64");
const signature = "data:image/png;base64," + readFileSync(new URL("../../assets/signature/anthony-david-adams.png", import.meta.url)).toString("base64");
const STATE = { KS: "Kansas", MO: "Missouri", OK: "Oklahoma", TX: "Texas", KY: "Kentucky", IN: "Indiana", NC: "North Carolina", AR: "Arkansas", GA: "Georgia", MS: "Mississippi", AL: "Alabama", TN: "Tennessee", LA: "Louisiana", FL: "Florida", SC: "South Carolina", WY: "Wyoming", AZ: "Arizona" }[state] || state;

// Filigree: one corner ornament drawn once, mirrored to the other three; a thin double rule between.
const corner = `<g fill="none" stroke="#B7791F" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
<path d="M4 96 C 4 60, 20 30, 60 18 C 80 12, 96 8, 96 4"/>
<path d="M4 96 C 10 70, 26 46, 54 36 C 66 32, 78 24, 86 14"/>
<path d="M14 92 C 18 74, 30 58, 50 50 C 58 47, 64 42, 66 36 C 60 40, 52 40, 48 36 C 54 34, 60 30, 62 24 C 56 28, 48 30, 42 28 C 48 24, 54 18, 54 12 C 48 16, 40 20, 34 20 C 38 14, 42 8, 40 4"/>
<path d="M22 86 C 28 76, 36 68, 46 64 C 42 70, 40 76, 42 82 C 38 78, 34 74, 30 74"/>
<path d="M64 46 C 72 42, 78 36, 80 28 C 76 34, 70 38, 64 38"/>
<path d="M30 60 C 24 64, 20 70, 20 78 C 24 72, 28 68, 34 66"/>
<circle cx="47" cy="47" r="2.4" fill="#B7791F" stroke="none"/><circle cx="66" cy="36" r="1.4" fill="#B7791F" stroke="none"/><circle cx="36" cy="66" r="1.4" fill="#B7791F" stroke="none"/><circle cx="62" cy="24" r="1.1" fill="#B7791F" stroke="none"/><circle cx="24" cy="62" r="1.1" fill="#B7791F" stroke="none"/>
<path d="M4 4 C 30 12, 60 40, 96 96" opacity=".25" stroke-width=".6"/>
</g>`;
const vine = `<svg width="100%" height="14" viewBox="0 0 400 14" preserveAspectRatio="none" style="display:block"><g fill="none" stroke="#B7791F" stroke-width=".8" opacity=".9"><path d="M0 7 Q 12 0 24 7 T 48 7 T 72 7 T 96 7 T 120 7 T 144 7 T 168 7 T 192 7 T 216 7 T 240 7 T 264 7 T 288 7 T 312 7 T 336 7 T 360 7 T 384 7 T 408 7"/><g fill="#B7791F" stroke="none">${Array.from({length:17},(_,i)=>`<circle cx="${i*24+12}" cy="7" r="1.1"/>`).join("")}</g></g></svg>`;
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Safe School certificate: ${name}, ${STATE}</title>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=Great+Vibes&family=Source+Sans+3:wght@400;600&display=swap" rel="stylesheet">
<style>
@page{size:11in 8.5in;margin:0}html,body{margin:0;background:#fff}
.sheet{position:relative;width:11in;height:8.5in;background:#FFFEFA;color:#0D132D;font-family:'Cormorant Garamond',Georgia,serif;overflow:hidden}
.frame{position:absolute;inset:.42in;border:1px solid #B7791F}.frame2{position:absolute;inset:.5in;border:2px solid #0D132D}.frame3{position:absolute;inset:.58in;border:.5px solid #B7791F}
.corner{position:absolute;width:100px;height:100px}.tl{top:.64in;left:.64in}.tr{top:.64in;right:.64in;transform:scaleX(-1)}.bl{bottom:.64in;left:.64in;transform:scaleY(-1)}.br{bottom:.64in;right:.64in;transform:scale(-1,-1)}.vine{position:absolute;left:1.9in;right:1.9in}.vtop{top:.66in}.vbot{bottom:.64in}
.inner{position:absolute;inset:1.02in 1.2in 1.22in;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:space-between;gap:8px}
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
.no{position:absolute;bottom:.84in;left:0;right:0;text-align:center;font-family:'Source Sans 3',sans-serif;font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:#8B95A5}
</style></head><body><div class="sheet">
<div class="frame"></div><div class="frame2"></div><div class="frame3"></div>
<svg class="corner tl" viewBox="0 0 100 100">${corner}</svg><svg class="corner tr" viewBox="0 0 100 100">${corner}</svg><svg class="corner bl" viewBox="0 0 100 100">${corner}</svg><svg class="corner br" viewBox="0 0 100 100">${corner}</svg><div class="vine vtop">${vine}</div><div class="vine vbot">${vine}</div>
<div class="inner">
  <div>
    <div class="mark"><img src="${logo}" alt=""><span>EarthPilot · Safe Schools Project</span></div>
    <h1>Safe School</h1><div class="sub">Recognition for the ${year} school year</div>
    <div class="rule"></div>
    <div class="pres">is presented to</div>
    <div class="name">${name}</div><div class="state">${STATE}${sup ? ` &middot; ${sup}, Superintendent` : ""}</div>
  </div>
  <div>
    <p class="body">for a written board policy that <b>prohibits corporal punishment</b> in every school it governs, joining the 33 states that prohibit it by law and the position of</p>
<div class="orgs"><span>American Academy of Pediatrics <i>2023</i></span><span>American Psychological Association <i>2016</i></span><span>American Academy of Child &amp; Adolescent Psychiatry <i>2012</i></span><span>National Association of School Psychologists <i>2021</i></span><span>National PTA</span><span>U.S. Secretary of Education <i>2023</i></span><span>ACLU, NAACP, NEA, Children's Defense Fund <i>2016 open letter</i></span></div>
    <blockquote>“${quote}”<small>Board policy ${code} · recorded at earthpilot.org/kids</small></blockquote>
  </div>
  <div class="foot">
    <div class="sig"><img class="handimg" src="${signature}" alt="Anthony David Adams"><div class="line"></div><div class="who">Anthony David Adams · Founder, EarthPilot</div></div>
    <div class="seal"><img src="${logo}" alt=""></div>
    <div class="qr">${qr}<small>Live record · scan</small></div>
  </div>
</div>
<div class="no">Certificate ${state}-${name.replace(/\W+/g, "").toUpperCase().slice(0, 10)}-${year.replace(/\D/g, "")} · verify at earthpilot.org/kids/state/${state}/</div>
</div></body></html>`;
writeFileSync(`${out}.html`, html);
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1056, height: 816 }, deviceScaleFactor: 2 });
await p.setContent(html, { waitUntil: "networkidle" }); await p.waitForTimeout(800);
await p.pdf({ path: `${out}.pdf`, width: "11in", height: "8.5in", printBackground: true, preferCSSPageSize: true });
await p.screenshot({ path: `${out}.png`, fullPage: false }); await b.close();
console.log(`wrote ${out}.html, ${out}.pdf, ${out}.png`);
