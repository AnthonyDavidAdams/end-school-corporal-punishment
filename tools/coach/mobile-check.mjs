// Drives the live coach and saves screenshots of each state. node tools/coach/mobile-check.mjs <outdir> [phone|desktop]
import { chromium } from "playwright";
const out = process.argv[2], mode = process.argv[3] || "phone", tag = mode === "phone" ? "m" : "d";
const b = await chromium.launch();
const ctx = await b.newContext(mode === "phone"
  ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" }
  : { viewport: { width: 1280, height: 800 } });
const p = await ctx.newPage(); await p.goto("https://earthpilot.org/kids/coach/?v=" + Date.now(), { waitUntil: "networkidle" });
await p.screenshot({ path: `${out}/${tag}1-start.png` });
await p.click("#openquiz"); await p.waitForTimeout(300); await p.screenshot({ path: `${out}/${tag}2-quiz.png` });
await p.click("#closemodal"); await p.waitForTimeout(200);
await p.click('.startrole button:text-is("I am a parent")');
await p.fill("#start textarea", "My daughter is in second grade. Every morning getting dressed turns into a meltdown, crying and refusing. I end up yelling and we are late.");
await p.click("#start button[type=submit]"); await p.waitForTimeout(500); await p.screenshot({ path: `${out}/${tag}3-dots.png` });
await p.waitForSelector(".cmsg.bot:not(.wait)", { timeout: 60000 }); await p.waitForTimeout(300); await p.screenshot({ path: `${out}/${tag}4-reply.png` });
await b.close(); console.log("done", mode);
