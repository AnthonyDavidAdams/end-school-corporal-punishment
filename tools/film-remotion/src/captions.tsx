// @ts-nocheck
import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { C, FONT_B, FONT } from "./theme";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

// Find where a phrase starts and ends in the narration's word list (seconds from the start of the voice).
export function phraseTimes(words, phrase) {
  const target = phrase.split(/\s+/).map(norm).filter(Boolean);
  for (let i = 0; i + target.length <= words.length; i++) {
    let ok = true;
    for (let k = 0; k < target.length; k++) if (norm(words[i + k].w) !== target[k]) { ok = false; break; }
    if (ok) return { s: words[i].s, e: words[i + target.length - 1].e };
  }
  // fallback: first word only
  const first = words.findIndex((w) => norm(w.w) === target[0]);
  return first >= 0 ? { s: words[first].s, e: words[first].e } : null;
}

// Lower-third cards that land on the narrator's phrases. `screen` maps a spoken phrase to what is shown.
export const KineticCaptions: React.FC<{ scene: any; lead: number; T: number; endAt?: number; align?: "left" | "right" }> = ({ scene, lead, T, endAt, align = "left" }) => {
  const frame = useCurrentFrame(); const { fps } = useVideoConfig(); const t = frame / fps;
  const items = (scene.highlight || []).map((h) => {
    const pt = phraseTimes(scene.words, h); if (!pt) return null;
    return { text: (scene.screen && scene.screen[h]) || h, at: lead + pt.s };
  }).filter(Boolean);
  return (
    <>
      {items.map((it, i) => {
        const end = i + 1 < items.length ? items[i + 1].at - 0.5 : (endAt ?? T - 1.0);
        const f0 = Math.round(it.at * fps);
        const sIn = spring({ frame: frame - f0, fps, config: { damping: 200, stiffness: 120, mass: 0.8 } });
        const out = interpolate(t, [end, end + 0.45], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        const o = Math.min(sIn, out); if (o <= 0) return null;
        const cap = it.text.charAt(0).toUpperCase() + it.text.slice(1);
        return (
          <div key={i} style={{ position: "absolute", bottom: 120, [align]: 120, opacity: o, transform: `translateY(${(1 - sIn) * 26}px)` }}>
            <div style={{ display: "inline-block", background: "rgba(11,31,51,0.80)", borderLeft: `8px solid ${C.orange}`, padding: "22px 40px 24px 32px" }}>
              <div style={{ fontFamily: FONT_B, fontSize: 58, lineHeight: 1.1, color: C.ink, letterSpacing: -0.5 }}>{cap}</div>
            </div>
          </div>
        );
      })}
    </>
  );
};

// A single word or phrase that lights up while it is spoken (used inside motion scenes).
export function spokenProgress(words, phrase, lead, t) {
  const pt = phraseTimes(words, phrase); if (!pt) return 0;
  return interpolate(t, [lead + pt.s, lead + pt.e], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
}

export const Eyebrow: React.FC<{ children: any; style?: any }> = ({ children, style }) => (
  <div style={{ fontFamily: FONT, fontSize: 34, letterSpacing: 6, textTransform: "uppercase", color: C.blue, ...style }}>{children}</div>
);
