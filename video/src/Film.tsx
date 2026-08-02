import React from 'react';
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { FONT_CSS } from './brand/fonts';
import { c, font } from './brand/tokens';
import { M, S } from './lib/beats';
import { BeatPump, Flash, Grade } from './lib/Stage';
import { ColdOpen } from './scenes/ColdOpen';
import { Slams } from './scenes/Slams';
import { MachineGun } from './scenes/MachineGun';
import { LogoDrop } from './scenes/LogoDrop';
import { ActLaptop } from './scenes/ActLaptop';
import { ActCanvas } from './scenes/ActCanvas';
import { ActHarnesses } from './scenes/ActHarnesses';
import { ActAgentTalk } from './scenes/ActAgentTalk';
import { ActMultiplayer } from './scenes/ActMultiplayer';
import { Climax } from './scenes/Climax';
import { Lockup } from './scenes/Lockup';

/**
 * The two impacts are the only places the whole frame gets hit. A flash that
 * lasts three frames at 60fps reads as force; one that lasts ten reads as a
 * dissolve, which is the opposite of what we want.
 */
const Impacts: React.FC = () => {
  const frame = useCurrentFrame();
  const hit = (at: number, len = 4, peak = 0.85) =>
    frame >= at && frame < at + len ? peak * (1 - (frame - at) / len) : 0;
  return <Flash opacity={Math.max(hit(M.drop), hit(M.lockup, 5, 0.9))} />;
};

export const Film: React.FC = () => (
  <AbsoluteFill
    style={{
      background: c.background,
      fontFamily: font.sans,
      color: c.foreground,
      // stop sub-pixel jitter on the big type when things scale
      WebkitFontSmoothing: 'antialiased',
    }}
  >
    {/* data-URI @font-face: nothing to fetch, so nothing for the renderer to
        wait on. font-display:block keeps a frame from ever drawing in a
        fallback face. */}
    <style>{FONT_CSS}</style>

    <Audio src={staticFile('score.wav')} />

    <Sequence from={S.coldOpen.from} durationInFrames={S.coldOpen.dur}>
      <ColdOpen />
    </Sequence>
    <Sequence from={S.slams.from} durationInFrames={S.slams.dur}>
      <Slams />
    </Sequence>
    <Sequence from={S.machineGun.from} durationInFrames={S.machineGun.dur}>
      <MachineGun />
    </Sequence>
    <Sequence from={S.logo.from} durationInFrames={S.logo.dur}>
      <LogoDrop />
    </Sequence>
    <Sequence from={S.canvas.from} durationInFrames={S.canvas.dur}>
      <ActCanvas />
    </Sequence>
    <Sequence from={S.multiplayer.from} durationInFrames={S.multiplayer.dur}>
      <ActMultiplayer />
    </Sequence>
    <Sequence from={S.agentTalk.from} durationInFrames={S.agentTalk.dur}>
      <ActAgentTalk />
    </Sequence>
    <Sequence from={S.harnesses.from} durationInFrames={S.harnesses.dur}>
      <ActHarnesses />
    </Sequence>
    <Sequence from={S.laptop.from} durationInFrames={S.laptop.dur}>
      <ActLaptop />
    </Sequence>
    <Sequence from={S.climax.from} durationInFrames={S.climax.dur}>
      <Climax />
    </Sequence>
    <Sequence from={S.lockup.from} durationInFrames={S.lockup.dur}>
      <Lockup />
    </Sequence>

    {/* graded as one piece, not nine */}
    <BeatPump amount={0.028} from={M.build} />
    <Grade />
    <Impacts />
  </AbsoluteFill>
);
