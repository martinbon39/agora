import React from 'react';
import { Composition } from 'remotion';
import { DURATION, FPS } from './lib/beats';
import { Film } from './Film';
import { LoopCanvas } from './loops/LoopCanvas';
import { LoopMultiplayer } from './loops/LoopMultiplayer';
import { LoopAgents } from './loops/LoopAgents';
import { LoopPersist } from './loops/LoopPersist';

// The README loops, rendered to GIF. Purpose-built rather than cut out of the
// film: a GIF has no inter-frame compression, so a cinematic shot with a moving
// camera and film grain costs megabytes a second. Five seconds of the film came
// to 6MB and was not finished. These are flat, short, and loop seamlessly.
const LOOPS = [
  ['LoopMultiplayer', LoopMultiplayer],
  ['LoopCanvas', LoopCanvas],
  ['LoopAgents', LoopAgents],
  ['LoopPersist', LoopPersist],
] as const;

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="AgoraFilm"
      component={Film}
      durationInFrames={DURATION}
      fps={FPS}
      width={1920}
      height={1080}
    />
    {LOOPS.map(([id, component]) => (
      <Composition
        key={id}
        id={id}
        component={component}
        durationInFrames={120}
        fps={30}
        width={1000}
        height={560}
      />
    ))}
  </>
);
