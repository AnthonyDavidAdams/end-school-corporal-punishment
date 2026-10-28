// @ts-nocheck
import React from "react";
import { Composition } from "remotion";
import { Film, totalFrames } from "./Film";
import data from "../public/data.json";
import national from "../public/data-national.json";
import { Explainer, totalFrames as explainerFrames } from "./Explainer";
import edata from "../public/explainer/data.json";

export const Root: React.FC = () => (
  <>
  <Composition id="Explainer" component={Explainer} durationInFrames={Math.max(2, explainerFrames(edata))} fps={edata.fps} width={1920} height={1080} defaultProps={{ data: edata, vertical: false }} />
  <Composition id="ExplainerVertical" component={Explainer} durationInFrames={Math.max(2, explainerFrames(edata))} fps={edata.fps} width={1080} height={1920} defaultProps={{ data: edata, vertical: true }} />
  <Composition
    id="OneSentence"
    component={Film}
    durationInFrames={totalFrames(data)}
    fps={data.fps}
    width={1920}
    height={1080}
    defaultProps={{ data }}
  />
  {/* The national edition: tools/film/script-national.json staged by tools/film/national.py into public/data-national.json */}
  <Composition
    id="OneSentenceNational"
    component={Film}
    durationInFrames={totalFrames(national)}
    fps={national.fps}
    width={1920}
    height={1080}
    defaultProps={{ data: national }}
  />

  </>
);
