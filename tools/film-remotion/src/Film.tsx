// @ts-nocheck
import React, { useEffect, useState } from "react";
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame, useVideoConfig, interpolate, continueRender, delayRender } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade as fadeT } from "@remotion/transitions/fade";
import { C } from "./theme";
import { ClipScene, SplitScene, OutcomesScene } from "./clipscenes";
import { MOTION } from "./scenes";

// Each scene lasts narration + lead + tail; scenes overlap by the crossfade.
export function layout(data) {
  const { fps, lead, tail, xf } = data; let t = 0; const out = [];
  for (const s of data.scenes) {
    const T = s.vo_dur + lead + tail; if (out.length) t -= xf;
    out.push({ ...s, T, start: t, frames: Math.round(T * fps) }); t += T;
  }
  return { scenes: out, total: t };
}
export const totalFrames = (data) => Math.round(layout(data).total * data.fps) + 1;

const Fonts: React.FC = () => {
  const [h] = useState(() => delayRender("fonts"));
  useEffect(() => {
    const css = `@font-face{font-family:'Carlito';src:url(${staticFile("fonts/Carlito-Regular.ttf")})} @font-face{font-family:'Carlito Bold';src:url(${staticFile("fonts/Carlito-Bold.ttf")})}`;
    const el = document.createElement("style"); el.textContent = css; document.head.appendChild(el);
    Promise.all([document.fonts.load("40px 'Carlito'"), document.fonts.load("40px 'Carlito Bold'")]).then(() => continueRender(h));
  }, []);
  return null;
};

const Scene: React.FC<{ s: any; lead: number; tts: string }> = ({ s, lead, tts }) => {
  let body = null;
  if (s.kind === "clip") body = <ClipScene scene={s} T={s.T} lead={lead} />;
  else if (s.kind === "split") body = <SplitScene scene={s} T={s.T} lead={lead} />;
  else if (s.kind === "split-motion") body = <OutcomesScene scene={s} T={s.T} lead={lead} />;
  else { const M = MOTION[s.scene]; body = <M scene={s} lead={lead} T={s.T} />; }
  return (
    <AbsoluteFill>
      {body}
      <Sequence from={Math.round(lead * 30)} premountFor={30}><Audio src={staticFile(`${tts}/${s.id}.mp3`)} /></Sequence>
    </AbsoluteFill>
  );
};

// Music bed: quiet under narration, a touch louder in the gaps, fades out at the end.
const Bed: React.FC<{ data: any; scenes: any[]; total: number }> = ({ data, scenes, total }) => {
  const frame = useCurrentFrame(); const { fps } = useVideoConfig(); const t = frame / fps;
  const speaking = scenes.some((s) => t >= s.start + data.lead && t <= s.start + data.lead + s.vo_dur);
  const base = speaking ? 0.11 : 0.2;
  const env = Math.min(interpolate(t, [0, 3], [0, 1], { extrapolateRight: "clamp" }), interpolate(t, [total - 7, total - 0.5], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  return <Audio src={staticFile("music/bed.wav")} loop volume={base * env} />;
};

export const Film: React.FC<{ data: any }> = ({ data }) => {
  const { scenes, total } = layout(data); const { fps } = useVideoConfig(); const frame = useCurrentFrame();
  const fadeIn = interpolate(frame, [0, Math.round(1.2 * fps)], [0, 1], { extrapolateRight: "clamp" });
  const fadeOut = interpolate(frame / fps, [total - 1.5, total], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ background: C.navy }}>
      <Fonts />
      <AbsoluteFill style={{ opacity: Math.min(fadeIn, fadeOut) }}>
        <TransitionSeries>
          {scenes.map((s, i) => (
            <React.Fragment key={s.id}>
              {i > 0 && <TransitionSeries.Transition presentation={fadeT()} timing={linearTiming({ durationInFrames: Math.round(data.xf * fps) })} />}
              <TransitionSeries.Sequence durationInFrames={s.frames}><Scene s={s} lead={data.lead} tts={data.tts || "tts"} /></TransitionSeries.Sequence>
            </React.Fragment>
          ))}
        </TransitionSeries>
      </AbsoluteFill>
      <Bed data={data} scenes={scenes} total={total} />
    </AbsoluteFill>
  );
};
