// Masked type reveal.
//
// A word sits inside a box with overflow hidden and slides up from 110% of its
// own height. Nothing scales and nothing overshoots: the mask is doing all the
// work, and the only thing that says "impact" is that the motion finishes
// exactly on the beat.

import React from 'react';
import { useCurrentFrame } from 'remotion';
import { REVEAL, STAGGER_WORD, reveal } from './motion';

export const RevealWords: React.FC<{
  children: string;
  /** frame the FIRST word finishes arriving on */
  at: number;
  stagger?: number;
  duration?: number;
  style?: React.CSSProperties;
  wordStyle?: (index: number) => React.CSSProperties;
  gap?: number;
}> = ({ children, at, stagger = STAGGER_WORD, duration = REVEAL, style, wordStyle, gap = 0.28 }) => {
  const frame = useCurrentFrame();
  const words = children.split(' ');
  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', ...style }}>
      {words.map((w, i) => {
        const t = reveal(frame, at + i * stagger, duration);
        return (
          <span
            key={`${w}-${i}`}
            style={{
              display: 'inline-block',
              overflow: 'hidden',
              // the mask has to clear descenders and the type's own leading,
              // otherwise the tail of a g or y peeks out before the reveal
              paddingBottom: '0.14em',
              marginBottom: '-0.14em',
              marginRight: i === words.length - 1 ? 0 : `${gap}em`,
            }}
          >
            <span
              style={{
                display: 'inline-block',
                transform: `translateY(${(1 - t) * 110}%)`,
                ...(wordStyle ? wordStyle(i) : null),
              }}
            >
              {w}
            </span>
          </span>
        );
      })}
    </span>
  );
};

/** The same treatment for a single block of text that should not be split. */
export const RevealLine: React.FC<{
  children: React.ReactNode;
  at: number;
  duration?: number;
  style?: React.CSSProperties;
}> = ({ children, at, duration = REVEAL, style }) => {
  const frame = useCurrentFrame();
  const t = reveal(frame, at, duration);
  return (
    <span
      style={{
        display: 'inline-block',
        overflow: 'hidden',
        paddingBottom: '0.14em',
        marginBottom: '-0.14em',
        ...style,
      }}
    >
      <span style={{ display: 'inline-block', transform: `translateY(${(1 - t) * 110}%)` }}>
        {children}
      </span>
    </span>
  );
};
