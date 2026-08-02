// 0:00–0:03 — the cold open.
//
// Almost nothing happens, on purpose. The rest of the film never stops moving,
// so the only way the machine-gun section reads as fast is if this reads as
// still. One prompt, nine keystrokes, and the keystrokes are audible: the score
// puts a tick on each of these frames.

import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { c, font, term } from '../brand/tokens';
import { SIXTEENTH } from '../lib/beats';
import { Stage } from '../lib/Stage';

const PROMPT = 'orbit@server ~ %';
const TYPED = 'how do i win this hackathon';

// keystrokes land on 16ths from frame 96 — the same frames as the ticks in the score
const TYPE_FROM = 96;
const TYPE_TO = 186; // one keystroke tick per 16th across the bar

export const ColdOpen: React.FC = () => {
  const frame = useCurrentFrame();

  const typed = Math.max(
    0,
    Math.min(
      TYPED.length,
      Math.round(((frame - TYPE_FROM) / (TYPE_TO - TYPE_FROM)) * TYPED.length),
    ),
  );
  const text = frame < TYPE_FROM ? '' : TYPED.slice(0, typed);

  // the app's own caret: a 1.1s opacity loop between 1 and 0.15
  const blink = interpolate(frame % 66, [0, 33, 34, 66], [1, 1, 0.15, 0.15]);

  // once the line is typed, the screen starts to breathe — the reversed swell
  // in the score is already pulling toward the cut
  const swell = interpolate(frame, [150, 192], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <Stage background="#0d0d0d">
      <AbsoluteFill
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          transform: `scale(${1 + swell * 0.06})`,
        }}
      >
        <div
          style={{
            fontFamily: font.mono,
            fontSize: 30,
            letterSpacing: 0.5,
            display: 'flex',
            alignItems: 'center',
            opacity: interpolate(frame, [0, 20], [0, 1], {
              extrapolateRight: 'clamp',
            }),
          }}
        >
          <span style={{ color: term.brightBlack }}>{PROMPT}&nbsp;</span>
          <span style={{ color: term.foreground }}>{text}</span>
          <span
            style={{
              display: 'inline-block',
              width: 15,
              height: 34,
              marginLeft: 3,
              background: term.cursor,
              opacity: frame >= TYPE_FROM && typed < TYPED.length ? 1 : blink,
            }}
          />
        </div>
      </AbsoluteFill>

      {/* the accent creeping in under the cut */}
      <AbsoluteFill
        style={{
          pointerEvents: 'none',
          background: 'radial-gradient(60% 40% at 50% 50%, rgba(255,255,255,0.07), transparent 70%)',
          opacity: swell,
        }}
      />
    </Stage>
  );
};
