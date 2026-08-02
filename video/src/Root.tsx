import React from 'react';
import { Composition } from 'remotion';
import { DURATION, FPS } from './lib/beats';
import { Film } from './Film';

export const RemotionRoot: React.FC = () => (
  <Composition
    id="AgoraFilm"
    component={Film}
    durationInFrames={DURATION}
    fps={FPS}
    width={1920}
    height={1080}
  />
);
