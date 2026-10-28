// @ts-nocheck
import React from "react";
import { AbsoluteFill, OffthreadVideo, Img, staticFile, useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion";
import { C, FONT, FONT_B, fade, easeOut } from "./theme";
import { KineticCaptions, phraseTimes } from "./captions";

// How long each Kling clip is (seconds) so it can be slowed to fit the narration.
const CLIP_LEN = { paddle: 5.04, hallway: 10.04, classroom: 10.04, boardroom: 5.04, sunrise: 10.04, two_desks: 10.04, ava_hall: 10.04, emma_hall: 10.04, ava_desk: 5.04, emma_desk: 5.04, boardroom_us: 5.04, sunrise_us: 10.04 };   // *_us: the national edition's re-made shots
// clips whose source still carried thin black letterbox bars: start zoomed enough to crop them off
const BASE = { hallway: 1.08, boardroom: 1.08, sunrise: 1.08, classroom: 1.0, paddle: 1.0, boardroom_us: 1.0, sunrise_us: 1.0 };

const SlowClip: React.FC<{ name: string; T: number; style?: any; drift?: number }> = ({ name, T, style, drift = 0 }) => {
  const frame = useCurrentFrame(); const { fps } = useVideoConfig(); const t = frame / fps;
  const rate = Math.min(1, CLIP_LEN[name] / T);          // never faster than real time
  const scale = (BASE[name] || 1) * (1 + 0.045 * easeOut(t / T));   // slow push-in across the scene
  const x = drift * easeOut(t / T);
  return (
    <AbsoluteFill style={{ overflow: "hidden", ...style }}>
      <OffthreadVideo src={staticFile(`clips/${name}.mp4`)} playbackRate={rate} muted
        style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${scale}) translateX(${x}px)`, transformOrigin: "50% 50%" }} />
    </AbsoluteFill>
  );
};

// Letterbox vignette so captions read over bright frames
const Grade: React.FC<{ strength?: number }> = ({ strength = 0.35 }) => (
  <AbsoluteFill style={{ background: `linear-gradient(180deg, rgba(11,31,51,${strength * 0.6}) 0%, rgba(11,31,51,0) 30%, rgba(11,31,51,0) 60%, rgba(11,31,51,${strength}) 100%)` }} />
);

export const ClipScene: React.FC<{ scene: any; T: number; lead: number }> = ({ scene, T, lead }) => (
  <AbsoluteFill style={{ background: C.navy }}>
    <SlowClip name={scene.clip} T={T} drift={scene.id === "s02_hallway" ? -30 : 0} />
    <Grade />
    <KineticCaptions scene={scene} lead={lead} T={T} />
  </AbsoluteFill>
);

// Two hallways side by side; captions go to the side the narrator is on.
export const SplitScene: React.FC<{ scene: any; T: number; lead: number }> = ({ scene, T, lead }) => {
  const frame = useCurrentFrame(); const { fps } = useVideoConfig(); const t = frame / fps;
  const sw = spring({ frame, fps, config: { damping: 200, stiffness: 60 } });
  const switchAt = lead + (phraseTimes(scene.words, "Emma's school")?.s ?? T / 2);
  const leftHi = scene.highlight.slice(0, 2), rightHi = scene.highlight.slice(2);
  const L = { ...scene, highlight: leftHi }, R = { ...scene, highlight: rightHi };
  const focus = t < switchAt ? 0 : 1;   // 0 = Ava side lit, 1 = Emma side lit
  const dimL = interpolate(t, [switchAt, switchAt + 0.8], [0, 0.45], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const dimR = interpolate(t, [0, 0.01, switchAt, switchAt + 0.8], [0.45, 0.45, 0.45, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const label = (txt, side) => (
    <div style={{ position: "absolute", top: 72, [side]: 72, fontFamily: FONT_B, fontSize: 52, color: C.ink, letterSpacing: 4, textTransform: "uppercase", opacity: sw }}>
      {txt}
    </div>
  );
  return (
    <AbsoluteFill style={{ background: C.navy }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: 956, height: 1080, overflow: "hidden" }}>
        <SlowClip name={scene.left} T={T} />
        <AbsoluteFill style={{ background: `rgba(11,31,51,${dimL})` }} />
        <Grade />
        {label(scene.labels.left, "left")}
        <KineticCaptions scene={L} lead={lead} T={T} endAt={switchAt - 0.4} />
      </div>
      <div style={{ position: "absolute", left: 964, top: 0, width: 956, height: 1080, overflow: "hidden" }}>
        <SlowClip name={scene.right} T={T} />
        <AbsoluteFill style={{ background: `rgba(11,31,51,${dimR})` }} />
        <Grade />
        {label(scene.labels.right, "left")}
        <KineticCaptions scene={R} lead={lead} T={T} />
      </div>
      <div style={{ position: "absolute", left: 956, top: 0, width: 8, height: 1080, background: C.orange, opacity: sw }} />
    </AbsoluteFill>
  );
};

// The outcomes: two dimmed stills, cards stacking on each side as the narrator reaches each finding.
const CUES_L = ["hit someone again", "anxious or depressed", "fall behind", "own children"];
const CUES_R = ["Taught expectations", "consequence that fits", "Practice", "improved behavior"];

export const OutcomesScene: React.FC<{ scene: any; T: number; lead: number }> = ({ scene, T, lead }) => {
  const frame = useCurrentFrame(); const { fps } = useVideoConfig(); const t = frame / fps;
  const col = (name, cues, cards, side, accent) => {
    const x = side === "left" ? 0 : 964;
    const switchAt = lead + (phraseTimes(scene.words, scene.switch || "Emma's school")?.s ?? T / 2);
    const lit = side === "left" ? interpolate(t, [switchAt, switchAt + 1], [1, 0.55], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : interpolate(t, [switchAt, switchAt + 1], [0.55, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    return (
      <div style={{ position: "absolute", left: x, top: 0, width: 956, height: 1080, overflow: "hidden" }}>
        <Img src={staticFile(`img/${name}.jpg`)} style={{ width: "100%", height: "100%", objectFit: "cover", filter: `brightness(${0.45 * lit + 0.2})`, transform: `scale(${1 + 0.03 * easeOut(t / T)})` }} />
        <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(11,31,51,0.1) 0%, rgba(11,31,51,0.75) 100%)" }} />
        <div style={{ position: "absolute", top: 72, left: 72, fontFamily: FONT_B, fontSize: 52, color: C.ink, letterSpacing: 4, textTransform: "uppercase" }}>{side === "left" ? "Ava" : "Emma"}</div>
        {cards.map((c, i) => {
          const pt = phraseTimes(scene.words, cues[i]); const at = lead + (pt ? pt.s : 0);
          const f0 = Math.round(at * fps);
          const s = spring({ frame: frame - f0, fps, config: { damping: 200, stiffness: 110, mass: 0.9 } });
          if (frame < f0) return null;
          return (
            <div key={i} style={{ position: "absolute", left: 72, top: 520 + i * 118, opacity: s, transform: `translateX(${(1 - s) * -30}px)` }}>
              <div style={{ display: "inline-block", background: "rgba(11,31,51,0.82)", borderLeft: `8px solid ${accent}`, padding: "18px 34px 20px 28px" }}>
                <div style={{ fontFamily: FONT_B, fontSize: 48, color: C.ink, lineHeight: 1.1 }}>{c}</div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };
  const src = interpolate(t, [T - 6, T - 5], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ background: C.navy }}>
      {col(scene.left, (scene.cues && scene.cues.left) || CUES_L, scene.cards.left, "left", C.orange)}
      {col(scene.right, (scene.cues && scene.cues.right) || CUES_R, scene.cards.right, "right", C.blue)}
      <div style={{ position: "absolute", left: 956, top: 0, width: 8, height: 1080, background: C.orange }} />
      <div style={{ position: "absolute", left: 72, bottom: 36, width: 1776, fontFamily: FONT, fontSize: 24, color: C.dim, opacity: src }}>{scene.sources}</div>
    </AbsoluteFill>
  );
};
