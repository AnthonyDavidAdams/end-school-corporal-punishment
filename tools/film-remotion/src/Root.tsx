// @ts-nocheck
import React from "react";
import { Composition } from "remotion";
import { Film, totalFrames } from "./Film";
import data from "../public/data.json";
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

  </>
);
