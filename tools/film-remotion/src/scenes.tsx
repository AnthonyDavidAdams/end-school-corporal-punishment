// @ts-nocheck
// Motion-graphic scenes, timed to the narration's word timestamps where it matters.
// Each scene reads its figures and labels from the script (`scene.fig`) and its timing phrases from `scene.cues`;
// a scene without them renders the Texas edition's defaults, so public/data.json (the v3 film) is unchanged.
import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion";
import { C, FONT, FONT_B, fade, easeOut, fmt } from "./theme";
import { Eyebrow, phraseTimes, spokenProgress } from "./captions";

const Bg: React.FC<{ children: any }> = ({ children }) => (
  <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 40%, ${C.navy2} 0%, ${C.navy} 70%)`, fontFamily: FONT, color: C.ink }}>
    {children}
  </AbsoluteFill>
);
const useT = () => { const f = useCurrentFrame(); const { fps } = useVideoConfig(); return { t: f / fps, frame: f, fps }; };
const at = (words, phrase, lead, fallback) => { const p = phraseTimes(words, phrase); return lead + (p ? p.s : fallback); };
const cue = (scene, key, dflt) => (scene.cues && scene.cues[key]) || dflt;
const fig = (scene, key, dflt) => (scene.fig && scene.fig[key] !== undefined ? scene.fig[key] : dflt);
// a number that counts up from the moment the narrator starts saying it
const Count: React.FC<{ to: number; start: number; dur?: number; style: any }> = ({ to, start, dur = 2.2, style }) => {
  const { t } = useT(); const p = easeOut(fade(t, start, start + dur)); const o = fade(t, start - 0.2, start + 0.5);
  return <div style={{ ...style, opacity: o }}>{fmt(to * p)}</div>;
};

export const CounterScene = ({ scene, lead }) => {
  const w = scene.words; const { t } = useT();
  const students = fig(scene, "students", 5359), instances = fig(scene, "instances", 8528), districts = fig(scene, "districts", 284);
  const a1 = at(w, cue(scene, "students", "five thousand"), lead, 0.3), a2 = at(w, cue(scene, "instances", "eight thousand"), lead, 4.4), a3 = at(w, cue(scene, "districts", "two hundred"), lead, 8.2);
  const big = students >= 10000 ? 300 : 340;
  return (
    <Bg>
      <div style={{ position: "absolute", top: 150, left: 0, right: 0, textAlign: "center", opacity: fade(t, a1 - 0.3, a1 + 0.3) }}><Eyebrow>{fig(scene, "eyebrow", "Texas public schools · 2023-24")}</Eyebrow></div>
      <Count to={students} start={a1} dur={2.6} style={{ position: "absolute", top: 230, left: 0, right: 0, textAlign: "center", fontFamily: FONT_B, fontSize: big, lineHeight: 1, letterSpacing: -8 }} />
      <div style={{ position: "absolute", top: 600, left: 0, right: 0, textAlign: "center", fontSize: 56, opacity: fade(t, a1 + 0.4, a1 + 1.0) }}>students struck as punishment</div>
      <div style={{ position: "absolute", top: 760, left: 0, right: 0, textAlign: "center", opacity: fade(t, a2 - 0.2, a2 + 0.5) }}>
        <span style={{ fontFamily: FONT_B, fontSize: 120, color: C.orange }}>{fmt(instances * easeOut(fade(t, a2, a2 + 2.2)))}</span><span style={{ fontSize: 56, marginLeft: 28 }}>separate instances</span>
      </div>
      <div style={{ position: "absolute", top: 900, left: 0, right: 0, textAlign: "center", opacity: fade(t, a3 - 0.2, a3 + 0.5) }}>
        <span style={{ fontFamily: FONT_B, fontSize: 120, color: C.blue }}>{fmt(districts * easeOut(fade(t, a3, a3 + 1.4)))}</span><span style={{ fontSize: 56, marginLeft: 28 }}>districts</span>
      </div>
    </Bg>
  );
};

const QUOTE = "the deliberate infliction of physical pain by hitting, paddling, spanking, slapping, or any other physical force used as a means of discipline.";
export const StatuteScene = ({ scene, lead }) => {
  const w = scene.words; const { t } = useT();
  const quote = fig(scene, "quote", QUOTE);
  const qs = at(w, cue(scene, "quote_start", "the deliberate"), lead, 1.2), qe = lead + (phraseTimes(w, cue(scene, "quote_end", "means of discipline"))?.e ?? 9.5);
  const words = quote.split(" "); const shown = Math.floor(fade(t, qs, qe) * words.length);
  const n1 = at(w, cue(scene, "n1", "does not require"), lead, 12.5), n2 = at(w, cue(scene, "n2", "does not recommend"), lead, 16), n3 = at(w, cue(scene, "n3", "It permits"), lead, 19);
  const n4 = scene.cues && scene.cues.sub ? at(w, scene.cues.sub, lead, 21) + 1.5 : at(w, "Every year", lead, 21);
  const size = words.length > 16 ? 84 : 96;
  return (
    <Bg>
      <div style={{ position: "absolute", left: 160, top: 140, opacity: fade(t, 0, 0.8) }}><Eyebrow>{fig(scene, "eyebrow", "Texas Education Code · §37.0011(a)")}</Eyebrow></div>
      <div style={{ position: "absolute", left: 160, top: 230, width: 1600, fontSize: size, lineHeight: 1.25, fontFamily: FONT_B }}>
        &ldquo;{words.map((x, i) => <span key={i} style={{ opacity: i < shown ? 1 : 0.08 }}>{x}{i < words.length - 1 ? " " : ""}</span>)}&rdquo;
      </div>
      <div style={{ position: "absolute", left: 160, top: 760, fontSize: 56, fontFamily: FONT_B, color: C.orange, opacity: fade(t, n1, n1 + 0.5) }}>Not required.</div>
      <div style={{ position: "absolute", left: 640, top: 760, fontSize: 56, fontFamily: FONT_B, color: C.orange, opacity: fade(t, n2, n2 + 0.5) }}>Not recommended.</div>
      <div style={{ position: "absolute", left: 1250, top: 760, fontSize: 56, fontFamily: FONT_B, color: C.blue, opacity: fade(t, n3, n3 + 0.5) }}>Permitted.</div>
      <div style={{ position: "absolute", left: 160, top: 900, fontSize: 30, color: C.dim, opacity: fade(t, n4 - 1.5, n4 - 0.8) }}>{fig(scene, "sub", "Unless a parent files a signed statement with the board. Every school year.")}</div>
    </Bg>
  );
};

export const BarsScene = ({ scene, lead }) => {
  const w = scene.words; const { t } = useT();
  const rows = fig(scene, "rows", [["2017-18", 13892], ["2021-22", 7324], ["2023-24", 5359]]);
  const cues = cue(scene, "rows", ["thirteen thousand", "seven thousand", "five thousand"]);
  const dflt = [4, 9.5, 12.5];
  const data = rows.map(([y, v], i) => [y, v, at(w, cues[i], lead, dflt[i])]);
  const max = Math.max(...rows.map((r) => r[1])), H = 520; const pctAt = at(w, cue(scene, "pct", "sixty-one"), lead, 16.5); const o = fade(t, pctAt - 0.2, pctAt + 0.6);
  const note = String(fig(scene, "note", "in six years.|No change in the law.")).split("|");
  const big = max >= 10000 ? 84 : 96, bigLast = max >= 10000 ? 104 : 118;
  return (
    <Bg>
      <div style={{ position: "absolute", left: 160, top: 120, opacity: fade(t, 0, 0.8) }}><Eyebrow>{fig(scene, "eyebrow", "Texas students paddled, as reported by districts")}</Eyebrow></div>
      {data.map(([y, v, t0], i) => {
        const p = easeOut(fade(t, t0, t0 + 1.6)); const h = H * v / max * p; const x = 260 + i * 400; const last = i === 2;
        return (
          <React.Fragment key={i}>
            <div style={{ position: "absolute", bottom: 260, left: x, width: 300, height: h, background: last ? C.orange : C.blue, borderRadius: "6px 6px 0 0" }} />
            <div style={{ position: "absolute", left: x - 60, width: 420, textAlign: "center", bottom: 280 + h, fontFamily: FONT_B, fontSize: last ? bigLast : big, opacity: p }}>{fmt(v * p)}</div>
            <div style={{ position: "absolute", left: x - 60, width: 420, textAlign: "center", bottom: 200, fontSize: 40, opacity: p }}>{y}</div>
          </React.Fragment>
        );
      })}
      <div style={{ position: "absolute", left: 1420, top: 380, width: 440, opacity: o }}>
        <div style={{ fontFamily: FONT_B, fontSize: 150, lineHeight: 1, color: C.orange }}>{fig(scene, "pct", "−61%")}</div>
        <div style={{ fontSize: 56, lineHeight: 1.25, marginTop: 16 }}>{note.map((x, i) => <React.Fragment key={i}>{i > 0 && <br />}{x}</React.Fragment>)}</div>
      </div>
    </Bg>
  );
};

// Silhouettes: a boy (straight body) and a girl (flared body), drawn as SVG so they scale cleanly.
const Fig = ({ kind, color, w = 52, style }) => {
  const h = w * 1.85;
  const body = kind === "girl"
    ? `M ${w*0.5} ${w*0.52} L ${w*0.08} ${h*0.72} L ${w*0.92} ${h*0.72} Z M ${w*0.3} ${h*0.72} h ${w*0.4} v ${h*0.28} h -${w*0.4} Z`
    : `M ${w*0.14} ${w*0.52} h ${w*0.72} v ${h*0.48} h -${w*0.72} Z M ${w*0.2} ${h*0.7} h ${w*0.25} v ${h*0.3} h -${w*0.25} Z M ${w*0.55} ${h*0.7} h ${w*0.25} v ${h*0.3} h -${w*0.25} Z`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "inline-block", ...style }}>
      <circle cx={w / 2} cy={w * 0.26} r={w * 0.24} fill={color} />
      <path d={body} fill={color} />
    </svg>
  );
};

export const PictogramScene = ({ scene, lead, T }) => {
  const w = scene.words; const { t } = useT();
  const BOYS = fig(scene, "boys", 83), DIS = fig(scene, "disability", 22);
  const aB = at(w, cue(scene, "boys", "eighty-three"), lead, 2.2), aD = at(w, cue(scene, "disability", "Twenty-two"), lead, 8.2), aN = at(w, cue(scene, "national", "nationally"), lead, 12.5);
  const aBlack = at(w, cue(scene, "black", "Black students"), lead, 14.5), aGirls = at(w, cue(scene, "girls", "Black girls"), lead, 18.5);
  const gridOut = 1 - fade(t, aN - 0.1, aN + 0.5);
  // phase A/B: 100 silhouettes, the boys then the girls; lit count follows the narration
  const nB = Math.floor(easeOut(fade(t, aB, aB + 2.6)) * BOYS), nD = Math.floor(easeOut(fade(t, aD, aD + 2.0)) * DIS);
  const phaseD = t >= aD - 0.3;
  const figs = [];
  for (let i = 0; i < 100; i++) {
    const kind = i < BOYS ? "boy" : "girl";
    const lit = phaseD ? i < nD : i < nB;
    figs.push(<Fig key={i} kind={kind} color={lit ? (phaseD ? C.blue : C.orange) : C.figOff} w={46} style={{ margin: "8px 14px" }} />);
  }
  // phase C: relative likelihood rows (national, 2017-18 federal data as cited by the Secretary of Education)
  const girls = t >= aGirls - 0.2;
  const base = 10, mult = girls ? 40 : 23;
  const grow = easeOut(fade(t, girls ? aGirls : aBlack, (girls ? aGirls : aBlack) + 1.8));
  const nTop = Math.round(base * Math.min(1, grow * 3)), nBot = Math.round(mult * grow);
  const rowIn = fade(t, aN + 0.3, aN + 0.9);   // rows appear as soon as the grid has gone; figures grow on the cue
  const row = (label, n, color, kind, y) => (
    <div style={{ position: "absolute", left: 160, top: y, width: 1640 }}>
      <div style={{ fontFamily: FONT_B, fontSize: 40, color: C.ink, marginBottom: 6, textTransform: "uppercase", letterSpacing: 3 }}>{label}</div>
      <div style={{ lineHeight: 0, whiteSpace: "nowrap" }}>{Array.from({ length: n }).map((_, i) => <Fig key={i} kind={kind} color={color} w={30} style={{ margin: "0 5px" }} />)}</div>
    </div>
  );
  const kind = girls ? "girl" : "boy";
  const headline = girls ? "Black girls: 4× as likely as white girls" : "Black students: 2.3× as likely as white students";
  return (
    <Bg>
      <div style={{ position: "absolute", left: 160, top: 110, opacity: fade(t, 0, 0.8) }}><Eyebrow>{t < aN ? fig(scene, "eyebrow", "Who it lands on · Texas, 2023-24") : "Who it lands on · United States, federal data"}</Eyebrow></div>
      <div style={{ position: "absolute", left: 160, top: 190, width: 1640, lineHeight: 0, opacity: gridOut }}>{figs}</div>
      <div style={{ position: "absolute", left: 160, top: 790, opacity: Math.min(fade(t, aB - 0.2, aB + 0.4), gridOut) }}>
        {phaseD
          ? <><span style={{ fontFamily: FONT_B, fontSize: 150, color: C.blue }}>{nD}</span><span style={{ fontSize: 56, marginLeft: 28 }}>of every 100 have a disability</span></>
          : <><span style={{ fontFamily: FONT_B, fontSize: 150, color: C.orange }}>{nB}</span><span style={{ fontSize: 56, marginLeft: 28 }}>of every 100 are boys</span><span style={{ fontSize: 56, marginLeft: 48, color: C.dim }}>{100 - BOYS} are girls</span></>}
      </div>
      <div style={{ opacity: rowIn }}>
        {row(girls ? "For every 10 white girls paddled" : "For every 10 white students paddled", nTop, C.blue, kind, 300)}
        {row(girls ? "Black girls" : "Black students", nBot, C.orange, kind, 470)}
        <div style={{ position: "absolute", left: 160, top: 740, width: 1640, fontFamily: FONT_B, fontSize: 64, lineHeight: 1.15, color: C.ink, opacity: fade(t, (girls ? aGirls : aBlack) + 0.8, (girls ? aGirls : aBlack) + 1.4) }}>{headline}</div>
        <div style={{ position: "absolute", left: 160, top: 930, fontSize: 30, color: C.dim }}>U.S. Secretary of Education, letter to every governor, March 2023, citing the 2017-18 Civil Rights Data Collection.</div>
      </div>
    </Bg>
  );
};

const WORDS_TX = [["Excessive", "§22.0511: no personal immunity for excessive force"], ["Reasonable", "§22.0512, Penal Code §9.62: job and certificate protected only for reasonable force"], ["Necessary", "§9.62: force justified only to the degree reasonably believed necessary"]];
export const WordsScene = ({ scene, lead, T }) => {
  const w = scene.words; const { t, frame, fps } = useT();
  const dflt = [4.2, 5.6, 7.0];
  const wcues = cue(scene, "words", null);
  const rows = fig(scene, "rows", WORDS_TX).map(([x, c], i) => [x, at(w, wcues ? wcues[i] : x, lead, dflt[i]), c]);
  const aEnd = at(w, cue(scene, "afterward", "decided afterward"), lead, 18);
  const aEv = scene.cues && scene.cues.evidence ? at(w, scene.cues.evidence, lead, 24) : null;
  // national edition: after the three words, the open letter's signatories fill the frame and the named ones take the stage
  const names = fig(scene, "names", null);
  const aNames = names ? at(w, cue(scene, "names", "seventy-nine organizations"), lead, 30) : Infinity;
  const wordsOut = names ? 1 - fade(t, aNames - 0.6, aNames) : 1;
  const stage = (fig(scene, "stage", []) as any[]).map(([phrase, label]) => [label, at(w, phrase, lead, Infinity)]).filter(([, t0]) => t0 < Infinity);
  let cur = -1; for (let i = 0; i < stage.length; i++) if (t >= stage[i][1] - 0.15) cur = i;
  const onStage = cur >= 0 ? stage[cur] : null;
  const sStage = onStage ? spring({ frame: frame - Math.round((onStage[1] - 0.15) * fps), fps, config: { damping: 200, stiffness: 140, mass: 0.8 } }) : 0;
  const gridDim = onStage ? 0.28 : 1;
  const nameAt = (i) => aNames + 0.15 + i * (3.2 / Math.max(1, (names || []).length));   // the whole grid is in within 3.2 s
  return (
    <Bg>
      <div style={{ position: "absolute", left: 160, top: 120, opacity: fade(t, 0, 0.8) * wordsOut }}><Eyebrow>Where the protection for staff stops</Eyebrow></div>
      {rows.map(([x, t0, c], i) => {
        const s = spring({ frame: frame - Math.round(t0 * fps), fps, config: { damping: 18, stiffness: 160, mass: 0.7 } });
        return (
          <React.Fragment key={i}>
            <div style={{ position: "absolute", left: 160, top: 250 + i * 230, fontFamily: FONT_B, fontSize: 170, lineHeight: 1, opacity: s * wordsOut, transform: `scale(${0.96 + 0.04 * s})`, transformOrigin: "left center" }}>{x}<span style={{ color: C.orange }}>.</span></div>
            <div style={{ position: "absolute", left: 1040, top: 300 + i * 230, width: 760, fontSize: 34, lineHeight: 1.3, color: C.dim, opacity: fade(t, t0 + 1.0, t0 + 1.6) * wordsOut }}>{c}</div>
          </React.Fragment>
        );
      })}
      <div style={{ position: "absolute", left: 160, top: 950, fontSize: 56, opacity: fade(t, aEnd - 0.2, aEnd + 0.6) * (aEv ? 1 - fade(t, aEv - 0.5, aEv - 0.1) : 1) * wordsOut }}>Decided afterward. By someone else.</div>
      {aEv !== null && <div style={{ position: "absolute", left: 160, top: 950, fontSize: 56, opacity: fade(t, aEv - 0.1, aEv + 0.5) * wordsOut }}>Measured against <span style={{ fontFamily: FONT_B, color: C.orange }}>the evidence.</span></div>}
      {names && t >= aNames - 0.2 && (
        <>
          <div style={{ position: "absolute", left: 160, top: 110, opacity: fade(t, aNames - 0.2, aNames + 0.5) }}><Eyebrow>{fig(scene, "letter_eyebrow", "Open letter · November 2016")}</Eyebrow></div>
          <div style={{ position: "absolute", left: 160, top: 190, width: 1640, display: "flex", flexWrap: "wrap", gap: "6px 8px", opacity: gridDim }}>
            {names.map((n, i) => {
              const s = spring({ frame: frame - Math.round(nameAt(i) * fps), fps, config: { damping: 200, stiffness: 150, mass: 0.7 } });
              return <div key={i} style={{ fontSize: 21, lineHeight: 1.15, color: C.ink, padding: "4px 10px", background: "rgba(255,255,255,0.05)", borderLeft: `2px solid ${C.blue}`, opacity: s, transform: `translateY(${(1 - s) * 14}px)`, whiteSpace: "nowrap" }}>{n}</div>;
            })}
          </div>
          {onStage && (
            <div style={{ position: "absolute", left: 160, right: 160, top: 0, bottom: 0, display: "flex", alignItems: "center", justifyContent: "center", opacity: sStage, transform: `scale(${0.94 + 0.06 * sStage})` }}>
              <div style={{ background: "rgba(11,31,51,0.94)", borderLeft: `10px solid ${C.orange}`, padding: "36px 64px 40px 52px", maxWidth: 1500, fontFamily: FONT_B, fontSize: onStage[0].length > 40 ? 64 : 92, lineHeight: 1.1, color: C.ink, textAlign: "left" }}>{onStage[0]}</div>
            </div>
          )}
        </>
      )}
    </Bg>
  );
};

export const SentenceScene = ({ scene, lead, T }) => {
  const w = scene.words; const { t } = useT();
  const s = "The Board prohibits the use of corporal punishment in the District.";
  const qs = at(w, "The Board", lead, 0.6), qe = lead + (phraseTimes(w, "the District")?.e ?? 4.8);
  const n = Math.floor(fade(t, qs, qe) * s.length); const caret = Math.floor(t * 2) % 2 === 0 && t < qe + 0.4 ? "|" : "";
  const a2 = at(w, "whole policy", lead, 5.6);
  return (
    <Bg>
      <div style={{ position: "absolute", left: 160, top: 200, opacity: fade(t, 0, 0.6) }}><Eyebrow>{fig(scene, "eyebrow", "Policy FO(LOCAL) · adopted by 291 Texas boards")}</Eyebrow></div>
      <div style={{ position: "absolute", left: 160, top: 300, width: 1620, fontFamily: FONT_B, fontSize: 110, lineHeight: 1.15 }}>&ldquo;{s.slice(0, n)}<span style={{ color: C.orange }}>{caret}</span>{n >= s.length ? "”" : ""}</div>
      <div style={{ position: "absolute", left: 160, top: 860, fontSize: 56, opacity: fade(t, a2 - 0.3, a2 + 0.4) }}>One sentence. <span style={{ fontFamily: FONT_B, color: C.orange }}>That is the whole policy.</span></div>
    </Bg>
  );
};

export const CloseScene = ({ scene, lead, T }) => {
  const { t } = useT(); const w = scene.words;
  const a1 = at(w, "Find your", lead, 0.2), a2 = at(w, "earthpilot", lead, 1.6), a3 = at(w, "Safe Schools", lead, 5.0);
  return (
    <Bg>
      <div style={{ position: "absolute", left: "50%", top: 360, transform: "translateX(-50%)", width: 380 * easeOut(fade(t, 0, 1.2)), height: 6, background: C.orange, borderRadius: 3 }} />
      {fig(scene, "lede", null) && <div style={{ position: "absolute", top: 420, left: 160, right: 160, textAlign: "center", fontFamily: FONT_B, fontSize: 84, lineHeight: 1.2, opacity: fade(t, 0.6, 1.4) * (1 - fade(t, a1 - 0.9, a1 - 0.3)) }}>{fig(scene, "lede", "")}</div>}
      <div style={{ position: "absolute", top: 400, left: 0, right: 0, textAlign: "center", fontFamily: FONT_B, fontSize: 120, opacity: fade(t, a1, a1 + 0.8) }}>Find your district.</div>
      <div style={{ position: "absolute", top: 560, left: 0, right: 0, textAlign: "center", fontSize: 64, color: C.blue, opacity: fade(t, a2, a2 + 0.8) }}>{fig(scene, "url", "earthpilot.org/kids/state/TX")}</div>
      <div style={{ position: "absolute", top: 700, left: 0, right: 0, textAlign: "center", fontSize: 36, color: C.dim, opacity: fade(t, a2 + 1.2, a2 + 2) }}>Every district's own policy, in its own words, with its source.</div>
      <div style={{ position: "absolute", top: 900, left: 0, right: 0, textAlign: "center", opacity: fade(t, a3, a3 + 0.8) }}><Eyebrow>Safe Schools Project · a project of EarthPilot</Eyebrow></div>
    </Bg>
  );
};

export const MOTION = { counter: CounterScene, statute: StatuteScene, bars: BarsScene, pictogram: PictogramScene, words: WordsScene, sentence: SentenceScene, close: CloseScene };
