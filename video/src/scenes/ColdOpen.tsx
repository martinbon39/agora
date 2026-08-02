// 0:00–0:03 — the cold open.
//
// Almost nothing happens, on purpose. The rest of the film never stops moving,
// so the only way the machine-gun section reads as fast is if this reads as
// still. One prompt, nine keystrokes, and the keystrokes are audible: the score
// puts a tick on each of these frames.

import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { c, font, term } from '../brand/tokens';
import { appEase } from '../lib/motion';
import { SIXTEENTH } from '../lib/beats';
import { Stage } from '../lib/Stage';

// Just the caret the product's own sessions use. It used to read
// "orbit@server ~ %", which names a machine nobody has heard of and says
// nothing: the shot is a person asking an agent a question, not a shell demo.
const PROMPT = '›';
const TYPED = 'how do i win this hackathon';

// keystrokes land on 16ths from frame 96 — the same frames as the ticks in the score
const TYPE_FROM = 96;
const TYPE_TO = 174; // one keystroke tick per 16th across the bar
const SEND = 228; // the return key, on the beat: bar 2, beat 1.5
const ANSWER = 276; // and the agent answers the only way it can

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

  // The question holds for most of a bar before it is sent. It used to be typed
  // and cut six frames later, which is not long enough to read a sentence.
  const sent = frame >= SEND;
  // pressing return: the line flashes, the prompt locks, a fresh caret drops
  const sendFlash = sent ? Math.max(0, 1 - (frame - SEND) / 10) : 0;

  const answered = frame >= ANSWER;
  const answerIn = interpolate(frame, [ANSWER, ANSWER + 14], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: appEase,
  });

  const swell = interpolate(frame, [ANSWER + 40, 384], [0, 1], {
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
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
        <div
          style={{
            fontFamily: font.mono,
            fontSize: 30,
            letterSpacing: 0.5,
            display: 'flex',
            alignItems: 'center',
            transform: `translateY(${sent ? -interpolate(frame, [SEND, SEND + 12], [0, 22], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }) : 0}px)`,
            opacity: interpolate(frame, [0, 20], [0, 1], {
              extrapolateRight: 'clamp',
            }),
          }}
        >
          <span style={{ color: term.brightBlack }}>{PROMPT}&nbsp;</span>
          <span
            style={{
              color: term.foreground,
              // the line lights up for a few frames as it is submitted
              textShadow: sendFlash > 0 ? `0 0 ${18 * sendFlash}px ${term.cursor}` : undefined,
            }}
          >
            {text}
          </span>
          {!sent && (
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
          )}
        </div>
        {/* the answer: the repo, which is the actual answer to the question */}
        {answered && (
          <div
            style={{
              marginTop: 20,
              fontFamily: font.mono,
              fontSize: 30,
              letterSpacing: 0.5,
              color: c.primary,
              opacity: answerIn,
              transform: `translateY(${(1 - answerIn) * 8}px)`,
            }}
          >
            github.com/martinbon39/agora
          </div>
        )}

        {/* the next prompt, waiting, the way a shell does after you hit return */}
        {sent && answered && (
          <div
            style={{
              marginTop: 16,
              fontFamily: font.mono,
              fontSize: 30,
              letterSpacing: 0.5,
              display: 'flex',
              alignItems: 'center',
              opacity: interpolate(frame, [SEND + 6, SEND + 18], [0, 1], {
                extrapolateLeft: 'clamp',
                extrapolateRight: 'clamp',
              }),
            }}
          >
            <span style={{ color: term.brightBlack }}>{PROMPT}&nbsp;</span>
            <span
              style={{
                display: 'inline-block',
                width: 15,
                height: 34,
                background: term.cursor,
                opacity: blink,
              }}
            />
          </div>
        )}
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
