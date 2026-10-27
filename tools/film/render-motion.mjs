// Render the motion-graphic scenes of the film to mp4: frames at 30 fps via Playwright, then ffmpeg.
// Usage: node render-motion.mjs <sceneId=sceneName:T> ...   e.g. s03_counter=counter:13.0
import { chromium } from "/Users/anthony/end-school-corporal-punishment/node_modules/playwright/index.mjs";
import { mkdirSync, rmSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const FPS = 30; const F = "/private/tmp/claude-501/-Users-anthony/bbf1be70-efdc-46e2-a99b-280c9f858c0e/scratchpad/film";
const jobs = process.argv.slice(2).map((a) => { const [id, rest] = a.split("="); const [scene, T] = rest.split(":"); return { id, scene, T: parseFloat(T) }; });
const browser = await chromium.launch();
// every scene renders in its own page at the same time; jpeg frames encode much faster than png
await Promise.all(jobs.map(async (j) => {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await page.goto("file://" + F + "/motion.html", { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  const overlay = j.scene === "overlay";
  const dir = overlay ? `${F}/overlays/${j.id}` : `${F}/frames/${j.id}`; rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const n = Math.ceil(j.T * FPS);
  const items = overlay ? (JSON.parse(readFileSync(`${F}/script.json`, "utf8")).scenes.find((s) => s.id === j.id).overlays || []) : null;
  for (let i = 0; i < n; i++) {
    if (overlay) await page.evaluate(([items, t, T]) => window.drawOverlay(items, t, T), [items, i / FPS, j.T]);
    else await page.evaluate(([s, t, T]) => window.draw(s, t, T), [j.scene, i / FPS, j.T]);
    if (overlay) await page.screenshot({ path: `${dir}/${String(i).padStart(5, "0")}.png`, type: "png", omitBackground: true });
    else await page.screenshot({ path: `${dir}/${String(i).padStart(5, "0")}.jpg`, type: "jpeg", quality: 94 });
  }
  await page.close();
  if (!overlay) {
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", `${dir}/%05d.jpg`, "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", `${F}/clips/${j.id}.mp4`]);
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(j.id, n, "frames", overlay ? "(overlay png)" : "");
}));
await browser.close();
