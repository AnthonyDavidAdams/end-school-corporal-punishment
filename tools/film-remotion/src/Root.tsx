// @ts-nocheck
import React from "react";
import { Composition } from "remotion";
import { Film, totalFrames } from "./Film";
import data from "../public/data.json";

export const Root: React.FC = () => (
  <Composition
    id="OneSentence"
    component={Film}
    durationInFrames={totalFrames(data)}
    fps={data.fps}
    width={1920}
    height={1080}
    defaultProps={{ data }}
  />
);
