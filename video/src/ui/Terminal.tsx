import React from 'react';
import { font, term } from '../brand/tokens';

export type TermSpan = { text: string; color?: string; dim?: boolean; bold?: boolean };
export type TermLine = { spans: TermSpan[] };

/**
 * A dead-simple xterm stand-in: styled spans over term.background.
 * `visibleChars` truncates the whole block after N characters (counted across
 * lines, line breaks free), so typing is driven per frame from outside. Lines
 * past the budget still occupy their height — no reflow while text types.
 */
export const Terminal: React.FC<{
  lines: TermLine[];
  fontSize?: number;
  visibleChars?: number;
  showCursor?: boolean;
  padding?: number;
}> = ({ lines, fontSize = 13.5, visibleChars, showCursor, padding = 10 }) => {
  let budget = visibleChars ?? Infinity;

  // index of the last line that shows at least one character (cursor goes there)
  let cursorLine = 0;
  if (visibleChars !== undefined) {
    let seen = 0;
    for (let i = 0; i < lines.length; i++) {
      const len = lines[i].spans.reduce((n, s) => n + s.text.length, 0);
      if (seen < visibleChars) cursorLine = i;
      seen += len;
    }
  } else {
    cursorLine = lines.length - 1;
  }

  const caret = (
    <span
      style={{
        display: 'inline-block',
        width: '0.6em',
        height: '1.1em',
        verticalAlign: '-0.18em',
        background: term.cursor,
      }}
    />
  );

  return (
    <div
      style={{
        background: term.background,
        padding,
        fontFamily: font.mono,
        fontSize,
        lineHeight: 1.25,
        color: term.foreground,
        height: '100%',
        overflow: 'hidden',
        boxSizing: 'border-box',
      }}
    >
      {lines.map((line, i) => (
        <div key={i} style={{ whiteSpace: 'pre', minHeight: '1.25em' }}>
          {line.spans.map((span, j) => {
            if (budget <= 0) return null;
            const text = span.text.slice(0, budget);
            budget -= span.text.length;
            return (
              <span
                key={j}
                style={{
                  color: span.color ?? term.foreground,
                  opacity: span.dim ? 0.6 : 1,
                  fontWeight: span.bold ? 700 : 400,
                }}
              >
                {text}
              </span>
            );
          })}
          {showCursor && i === cursorLine && caret}
        </div>
      ))}
    </div>
  );
};
