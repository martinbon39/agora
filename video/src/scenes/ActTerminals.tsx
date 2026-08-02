// 0:20.8–0:28.8 — act one: the terminal is real, and it outlives you.
//
// The beat that sells this is not the terminal appearing, it is the screen
// dying and coming back with MORE output than it had. That is the whole
// promise: the browser was never where the work was.

import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { c, term, AGENTS } from '../brand/tokens';
import { BAR, BEAT } from '../lib/beats';
import { sp } from '../lib/motion';
import { Caption, Punch, SectionLabel } from '../lib/Caption';
import { Stage } from '../lib/Stage';
import { CanvasBackground } from '../ui/CanvasBackground';
import { Terminal, type TermLine } from '../ui/Terminal';
import { TerminalNode } from '../ui/TerminalNode';
import { HERMES_SESSION } from '../content';

const CHARS = HERMES_SESSION.reduce(
  (n, l) => n + l.spans.reduce((m, s) => m + s.text.length, 0),
  0,
);

// what the session looks like when you come back to it
const LATER: TermLine[] = [
  ...HERMES_SESSION,
  { spans: [{ text: '' }] },
  { spans: [{ text: 'reading ', color: term.brightBlack }, { text: 'src/payments/refund.ts', color: term.blue }] },
  { spans: [{ text: '✓', color: term.green }, { text: ' idempotency keys + 11 tests' }] },
  { spans: [{ text: 'running vitest…', color: term.brightBlack }] },
  { spans: [{ text: '✓', color: term.green }, { text: ' 58 passed' }, { text: '   6h 12m in session', color: term.brightBlack }] },
];

const DIE = BAR * 2; // 192 — the screen goes out on the bar
const DARK = DIE + 8;
const BACK = DIE + 24; // one beat of nothing, then it snaps back

export const ActTerminals: React.FC = () => {
  const frame = useCurrentFrame();

  // Only the gap between the collapse finishing and the snap back is "dead".
  // This used to start at DIE, which hid the collapse itself — and `collapse`
  // clamped at 0.004 forever after, so the terminal spent the rest of the act
  // squashed into a 2px line. The whole point of the act was invisible.
  const dead = frame >= DARK && frame < BACK;

  // the CRT collapse: the picture squeezes to a line and blows out white
  const collapse =
    frame < DIE || frame >= BACK
      ? 1
      : interpolate(frame, [DIE, DARK], [1, 0.004], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });
  const blowout =
    frame < DIE || frame >= DARK
      ? 0
      : interpolate(frame, [DIE, DIE + 4, DARK], [1, 2.6, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });

  const enter = sp(frame, 0, 'glide');
  const snapBack = sp(frame, BACK, 'punch');

  const typed =
    frame < BACK
      ? interpolate(frame, [12, 178], [0, CHARS], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
      : undefined; // after it comes back, everything is already there

  const scale = frame < BACK ? interpolate(enter, [0, 1], [0.94, 1]) : interpolate(snapBack, [0, 1], [1.06, 1]);

  return (
    <Stage>
      <CanvasBackground opacity={0.45} offsetY={frame * 0.25} />

      {!dead && (
        <>
          <SectionLabel title="Close the laptop. It keeps running." />

          <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
            <div
              style={{
                transform: `scale(${scale}) scaleY(${collapse})`,
                filter: blowout > 0.02 ? `brightness(${1 + blowout})` : undefined,
                opacity: frame < BACK ? enter : 1,
              }}
            >
              <TerminalNode
                name="hermes"
                harness={AGENTS.hermes.harness}
                state={frame >= BACK ? 'idle' : 'working'}
                stateLabel={frame >= BACK ? 'idle' : 'working'}
                path="~/projects/checkout"
                width={1180}
                height={600}
              >
                <Terminal
                  lines={frame >= BACK ? LATER : HERMES_SESSION}
                  visibleChars={typed}
                  showCursor
                  fontSize={19}
                  padding={18}
                />
              </TerminalNode>
            </div>
          </AbsoluteFill>
        </>
      )}

      {dead && (
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
          <div
            style={{
              width: interpolate(frame, [DARK, BACK], [1180, 90]),
              height: 2,
              background: '#ffffff',
              opacity: interpolate(frame, [DARK, BACK - 4, BACK - 2], [0.95, 0.35, 0]),
              boxShadow: '0 0 60px rgba(255,255,255,0.6)',
            }}
          />
        </AbsoluteFill>
      )}

      <Caption from={BACK + 6} until={BACK + BAR} y={900}>
        Six hours later. <Punch at={BACK + BEAT + 6}>It never stopped.</Punch>
      </Caption>

      <Caption from={BACK + BAR + 6} y={900} color={c.muted}>
        Every session is a detached <span style={{ color: c.foreground }}>tmux</span> session on your own
        server. Close the tab, restart agora, walk away. The browser was only ever
        a viewer.
      </Caption>
    </Stage>
  );
};
