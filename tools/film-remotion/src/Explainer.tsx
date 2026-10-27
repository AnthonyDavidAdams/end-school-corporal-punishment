// @ts-nocheck
// "Two girls, one sentence": the paper-collage explainer. Seedance clips sit on cream card stock as a taped
// cut-out; the words are paper too: black blocks with white condensed capitals, red strips for the phrase
// that matters, a typewriter card in the corner for the fact or the attribution. Data: public/explainer/data.json
// (tools/explainer/make.py stage). See tools/explainer/STYLE.md for the rules.
import React, { useEffect, useState } from "react";
import { AbsoluteFill, Audio, Sequence, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig, interpolate, spring, continueRender, delayRender } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade as fadeT } from "@remotion/transitions/fade";

const PAPER = "#F3EDE0", INK = "#161616", RED = "#C8331F", NAVY = "#1B2E4B", KRAFT = "#B48A5A", WHITE = "#FBF8F1";
const BLOCK = "'Anton', Impact, 'Arial Narrow', sans-serif";
const TYPE = "'Courier Prime', 'Courier New', monospace";
const MARKER = "'Permanent Marker', 'Comic Sans MS', cursive";

export function layout(data) {
  const { fps, lead, tail, xf } = data; let t = 0; const out = [];
  for (const s of data.scenes) { const T = s.vo_dur + lead + tail; if (out.length) t -= xf; out.push({ ...s, T, start: t, frames: Math.round(T * fps) }); t += T; }
  return { scenes: out, total: t };
}
export const totalFrames = (data) => Math.round(layout(data).total * data.fps) + 1;

const Fonts: React.FC = () => {
  const [h] = useState(() => delayRender("fonts"));
  useEffect(() => {
    const el = document.createElement("style");
    el.textContent = `@font-face{font-family:'Anton';src:url(${staticFile("fonts/Anton-Regular.ttf")})}
      @font-face{font-family:'Courier Prime';src:url(${staticFile("fonts/CourierPrime-Regular.ttf")})}
      @font-face{font-family:'Courier Prime';font-weight:700;src:url(${staticFile("fonts/CourierPrime-Bold.ttf")})}
      @font-face{font-family:'Permanent Marker';src:url(${staticFile("fonts/PermanentMarker-Regular.ttf")})}`;
    document.head.appendChild(el);
    Promise.all([document.fonts.load("40px 'Anton'"), document.fonts.load("40px 'Courier Prime'"), document.fonts.load("40px 'Permanent Marker'")]).then(() => continueRender(h)).catch(() => continueRender(h));
  }, []);
  return null;
};

// deterministic wobble so a render is the same every time
const wob = (i: number, k = 1) => ((((i + 7) * 9301 + 49297) % 233280) / 233280 - 0.5) * k;
// a torn edge: a jagged polygon clip-path, seeded by index
const torn = (i: number) => {
  const pts = []; const n = 14;
  for (let k = 0; k <= n; k++) pts.push(`${(k / n) * 100}% ${wob(i * 31 + k, 7) + 3}%`);
  for (let k = n; k >= 0; k--) pts.push(`${(k / n) * 100}% ${97 + wob(i * 17 + k, 7)}%`);
  return `polygon(${pts.join(",")})`;
};
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// Words as paper: each word pops in on its timestamp. Highlighted phrases get the red strip.
const Words: React.FC<{ scene: any; lead: number; vertical: boolean }> = ({ scene, lead, vertical }) => {
  const frame = useCurrentFrame(); const { fps } = useVideoConfig(); const t = frame / fps - lead;
  const witness = scene.voice === "witness";
  const size = vertical ? 60 : (witness ? 46 : 52);
  const cap = vertical ? 20 : (witness ? 44 : 36);
  const hlWords = new Set((scene.highlight || []).flatMap((h) => h.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(" ")).map(norm).filter(Boolean));
  const lines = []; let cur = [], len = 0;
  scene.words.forEach((w, idx) => { if (len + w.w.length > cap && cur.length) { lines.push(cur); cur = []; len = 0; } cur.push({ ...w, idx }); len += w.w.length + 1; });
  if (cur.length) lines.push(cur);
  let li = lines.findIndex((L) => t < L[L.length - 1].e + 0.4); if (li < 0) li = lines.length - 1;
  const show = lines.slice(Math.max(0, li - 1), li + 1);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: vertical ? 300 : 70, padding: `0 ${vertical ? 50 : 120}px`, textAlign: "center" }}>
      {show.map((L, j) => (
        <div key={L[0].idx} style={{ lineHeight: 1.0, minHeight: size * 1.45, marginTop: 6 }}>
          {L.map((w) => {
            const f0 = Math.round((w.s + lead) * fps); if (frame < f0) return null;
            const sIn = spring({ frame: frame - f0, fps, config: { damping: 18, stiffness: 260, mass: 0.5 } });
            const hl = hlWords.has(norm(w.w));
            const bg = witness ? WHITE : hl ? RED : INK; const fg = witness ? INK : WHITE;
            const font = witness ? TYPE : BLOCK;
            return (
              <span key={w.idx} style={{ display: "inline-block", margin: "0 5px", padding: witness ? "6px 10px" : "4px 14px 2px", background: bg, color: fg, fontFamily: font,
                fontSize: hl ? size * 1.12 : size, fontWeight: witness ? 700 : 400, textTransform: witness ? "none" : "uppercase", letterSpacing: witness ? 0 : 1,
                clipPath: torn(w.idx), boxShadow: "0 3px 0 rgba(0,0,0,0.18)", transform: `scale(${0.7 + 0.3 * sIn}) rotate(${wob(w.idx, 4)}deg)`, opacity: Math.min(1, sIn * 1.5) }}>{w.w}</span>
            );
          })}
        </div>
      ))}
    </div>
  );
};

// The typewriter card: the fact, the attribution, or the state line, taped to the corner.
const Card: React.FC<{ text: string; lead: number; vertical: boolean; i: number }> = ({ text, lead, vertical, i }) => {
  const frame = useCurrentFrame(); const { fps } = useVideoConfig();
  if (!text) return null;
  const f0 = Math.round((lead + 0.4) * fps);
  const sIn = spring({ frame: frame - f0, fps, config: { damping: 20, stiffness: 160, mass: 0.7 } });
  if (frame < f0) return null;
  return (
    <div style={{ position: "absolute", top: vertical ? 160 : 44, right: vertical ? 40 : 110, transform: `rotate(${wob(i, 5) - 2}deg) translateY(${(1 - sIn) * -20}px)`, opacity: sIn }}>
      <div style={{ background: WHITE, padding: "14px 22px 16px", fontFamily: TYPE, fontSize: vertical ? 30 : 28, color: INK, maxWidth: vertical ? 520 : 560, lineHeight: 1.3, boxShadow: "0 6px 18px rgba(22,22,22,0.18)", clipPath: torn(i + 3) }}>{text}</div>
      <div style={{ position: "absolute", top: -12, left: "38%", width: 90, height: 26, background: "rgba(200,51,31,0.85)", transform: "rotate(-6deg)", boxShadow: "0 1px 2px rgba(0,0,0,0.2)" }} />
    </div>
  );
};

// A Seedance clip as a taped cut-out on the card stock, slowed to the narration, with a slow push-in.
const Clip: React.FC<{ scene: any; T: number; vertical: boolean; i: number }> = ({ scene, T, vertical, i }) => {
  const frame = useCurrentFrame(); const { fps, width, height } = useVideoConfig(); const t = frame / fps;
  const rate = Math.min(1, (scene.clip_len || 5) / T);
  const scale = 1 + 0.06 * Math.min(1, t / T);
  const w = vertical ? width - 70 : width - 180, h = vertical ? Math.round(w * 9 / 16) : height - 290;
  return (
    <div style={{ position: "absolute", left: (width - w) / 2, top: vertical ? 330 : 60, width: w, height: h, transform: `rotate(${wob(i + 11, 1.6)}deg)` }}>
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: KRAFT, boxShadow: "0 22px 50px rgba(22,22,22,0.22)", clipPath: torn(i + 5) }}>
        <OffthreadVideo src={staticFile(`explainer/clips/${scene.id}.mp4`)} playbackRate={rate} muted style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${scale})` }} />
      </div>
      <div style={{ position: "absolute", top: -14, left: 60, width: 120, height: 30, background: "rgba(255,255,255,0.55)", transform: "rotate(-5deg)", boxShadow: "0 1px 2px rgba(0,0,0,0.15)" }} />
      <div style={{ position: "absolute", bottom: -12, right: 80, width: 120, height: 30, background: "rgba(255,255,255,0.55)", transform: "rotate(7deg)", boxShadow: "0 1px 2px rgba(0,0,0,0.15)" }} />
    </div>
  );
};

const Scene: React.FC<{ s: any; lead: number; vertical: boolean; i: number }> = ({ s, lead, vertical, i }) => (
  <AbsoluteFill>
    <Clip scene={s} T={s.T} vertical={vertical} i={i} />
    <Card text={s.card} lead={lead} vertical={vertical} i={i} />
    <Words scene={s} lead={lead} vertical={vertical} />
    <Sequence from={Math.round(lead * 30)} premountFor={30}><Audio src={staticFile(`explainer/tts/${s.id}.mp3`)} /></Sequence>
  </AbsoluteFill>
);

// Cream card stock with fibre and a soft vignette; a few ballpoint doodles in the margins.
const Paper: React.FC<{ vertical: boolean }> = ({ vertical }) => (
  <AbsoluteFill style={{ background: PAPER }}>
    <AbsoluteFill style={{ opacity: 0.5, backgroundImage: "radial-gradient(rgba(22,22,22,0.05) 1px, transparent 1px), radial-gradient(rgba(180,138,90,0.08) 1px, transparent 1px)", backgroundSize: "7px 7px, 11px 11px", backgroundPosition: "0 0, 3px 5px" }} />
    <AbsoluteFill style={{ background: "radial-gradient(ellipse at center, rgba(255,255,255,0) 50%, rgba(120,100,70,0.22) 100%)" }} />
    <div style={{ position: "absolute", left: 40, bottom: 26, fontFamily: MARKER, color: NAVY, fontSize: 24, opacity: 0.5, transform: "rotate(-6deg)" }}>one sentence</div>
    <div style={{ position: "absolute", right: 40, bottom: 24, fontFamily: MARKER, color: NAVY, fontSize: 22, opacity: 0.45, transform: "rotate(5deg)" }}>safe schools project</div>
  </AbsoluteFill>
);

const Title: React.FC<{ data: any; vertical: boolean }> = ({ data, vertical }) => {
  const frame = useCurrentFrame(); const { fps } = useVideoConfig();
  const o = interpolate(frame, [0, Math.round(0.8 * fps)], [0, 1], { extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", top: vertical ? 70 : 14, left: vertical ? 0 : 120, right: vertical ? 0 : undefined, textAlign: vertical ? "center" : "left", opacity: o }}>
      <span style={{ display: "inline-block", background: INK, color: WHITE, fontFamily: BLOCK, textTransform: "uppercase", fontSize: vertical ? 40 : 30, padding: "4px 14px 2px", clipPath: torn(99), transform: "rotate(-1.5deg)" }}>{data.state_name}</span>
    </div>
  );
};

export const Explainer: React.FC<{ data: any; vertical?: boolean }> = ({ data, vertical = false }) => {
  const { scenes, total } = layout(data); const { fps } = useVideoConfig(); const frame = useCurrentFrame();
  const fadeIn = interpolate(frame, [0, Math.round(0.8 * fps)], [0, 1], { extrapolateRight: "clamp" });
  const fadeOut = interpolate(frame / fps, [total - 1.2, total], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill>
      <Fonts /><Paper vertical={vertical} />
      <AbsoluteFill style={{ opacity: Math.min(fadeIn, fadeOut) }}>
        <TransitionSeries>
          {scenes.map((s, i) => (
            <React.Fragment key={s.id}>
              {i > 0 && <TransitionSeries.Transition presentation={fadeT()} timing={linearTiming({ durationInFrames: Math.round(data.xf * fps) })} />}
              <TransitionSeries.Sequence durationInFrames={s.frames}><Scene s={s} lead={data.lead} vertical={vertical} i={i} /></TransitionSeries.Sequence>
            </React.Fragment>
          ))}
        </TransitionSeries>
        <Title data={data} vertical={vertical} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
