// Render each deck slide to PNG frames, one per reveal state. State k shows the first k children of the
// content wrapper; the pinned chrome (band, title bar, footer) is always visible.
// Usage: node render.mjs <slidesDir> <outDir> [slide ids...]
import { chromium } from "/Users/anthony/end-school-corporal-punishment/node_modules/playwright/index.mjs";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const [slidesDir, outDir, ...only] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const S = "/private/tmp/claude-501/-Users-anthony/bbf1be70-efdc-46e2-a99b-280c9f858c0e/scratchpad";
const CSS = `
@font-face{font-family:'Carlito';src:url(file://${S}/Carlito-Regular.ttf)}
@font-face{font-family:'Carlito Bold';src:url(file://${S}/Carlito-Bold.ttf)}
html,body{margin:0;padding:0;width:1920px;height:1080px;overflow:hidden;background:#fff}
section{position:relative;width:1920px;height:1080px;box-sizing:border-box;overflow:hidden;display:flex}
section *{box-sizing:border-box}
aside{display:none}
h1,h2,h3,p,ul,ol{margin:0}
h1,h2,h3{font-weight:600;line-height:1.1}
p{line-height:1.4}
b{font-family:'Carlito Bold',Arial,sans-serif;font-weight:400}
img{display:block}
table{border-collapse:collapse;width:100%}
th,td{padding:0.35em 0.6em;border:1px solid #C2DAED;vertical-align:top}
.hidden{visibility:hidden}
`;
const order = JSON.parse(readFileSync(join(slidesDir, "..", "deck.json"), "utf8")).order;
const ids = only.length ? only : order;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const manifest = {};
for (const id of ids) {
  let html = readFileSync(join(slidesDir, id + ".html"), "utf8");
  html = html.replace(/src="\/_blob\/9f6c9baa5ed0eb33e49762cfdb4a105a"/g, `src="file://${S}/stairwell.jpg"`);
  const tmp = join(outDir, `__${id}.html`);
  writeFileSync(tmp, `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${html}</body></html>`);
  await page.goto("file://" + resolve(tmp), { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  // the content wrapper: first direct child of <section> that is not position:absolute
  const n = await page.evaluate(() => {
    const sec = document.querySelector("section");
    const kids = [...sec.children].filter((e) => getComputedStyle(e).position !== "absolute" && e.tagName !== "ASIDE");
    const wrap = kids[0]; if (!wrap) return 0;
    wrap.id = "__wrap"; wrap.style.position = "relative"; return wrap.children.length;
  });
  const states = Math.max(1, n);
  manifest[id] = states;
  for (let k = 1; k <= states; k++) {
    await page.evaluate((k) => {
      const w = document.getElementById("__wrap"); if (!w) return;
      [...w.children].forEach((c, i) => c.classList.toggle("hidden", i >= k));
    }, k);
    await page.screenshot({ path: join(outDir, `${id}-${String(k).padStart(2, "0")}.png`), type: "png" });
  }
  // a "full" frame with everything visible, used for the cover and as the slide's resting frame
  await page.evaluate(() => { const w = document.getElementById("__wrap"); if (w) [...w.children].forEach((c) => c.classList.remove("hidden")); });
  await page.screenshot({ path: join(outDir, `${id}-full.png`), type: "png" });
  console.log(id, "states:", states);
}
writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 1));
await browser.close();
