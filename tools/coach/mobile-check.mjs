// Drives the live coach at phone size and saves screenshots: node tools/coach/mobile-check.mjs <outdir>
import { chromium } from "playwright";
const out = process.argv[2];
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" });
const p = await ctx.newPage(); await p.goto("https://earthpilot.org/kids/coach/?v=4", { waitUntil: "networkidle" });
await p.screenshot({ path: `${out}/m1-intake.png` });
await p.click("#burger"); await p.waitForTimeout(400); await p.screenshot({ path: `${out}/m2-menu.png` });
await p.click("#closeside"); await p.waitForTimeout(300);
for (const t of ["Parent", "Grades 1 to 2", "At home", "Meltdowns or shutting down", "Daily", "Less sleep lately"]) await p.click(`.chips button:text-is("${t}")`);
await p.click("#intake .go button"); await p.waitForTimeout(600); await p.screenshot({ path: `${out}/m3-dots.png` });
await p.waitForSelector(".cmsg.bot:not(.wait)", { timeout: 60000 }); await p.waitForTimeout(300); await p.screenshot({ path: `${out}/m4-reply.png` });
await p.fill("#say", "Bedtime is 10 or 11 most nights, he fights it. Meltdowns are mostly mornings when getting ready."); await p.screenshot({ path: `${out}/m5-typing.png` });
await b.close(); console.log("done");
