import React from 'react';
import { font } from '../brand/tokens';

// classic post-it palette from web/src/canvas/nodes/StickyNode.tsx:8-13
export const STICKY_COLORS: Record<'amber' | 'rose' | 'sky' | 'lime', { bg: string; ink: string }> =
  {
    amber: { bg: '#f6d365', ink: '#3f3413' },
    rose: { bg: '#f7a8c4', ink: '#4a1a2c' },
    sky: { bg: '#8fd3f4', ink: '#123a4d' },
    lime: { bg: '#b7e4a0', ink: '#25401a' },
  };

/** A post-it. Radius 8, not 14 — stickies are paper, not app chrome. */
export const StickyNode: React.FC<{
  width: number;
  height: number;
  text: string;
  color?: 'amber' | 'rose' | 'sky' | 'lime';
  author?: string;
}> = ({ width, height, text, color = 'amber', author }) => {
  const palette = STICKY_COLORS[color];
  // the app sizes the note with clamp(13px, 5.5cqw, 42px); resolve it here
  const bodySize = Math.min(42, Math.max(13, width * 0.055));

  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        width,
        height,
        overflow: 'hidden',
        borderRadius: 8,
        background: palette.bg,
        color: palette.ink,
        boxShadow: '0 10px 28px rgb(0 0 0 / 40%)',
        fontFamily: font.sans,
      }}
    >
      <div
        style={{
          display: 'flex',
          height: 28,
          flexShrink: 0,
          alignItems: 'center',
          gap: 6,
          padding: '0 8px',
          boxSizing: 'border-box',
        }}
      >
        {(Object.keys(STICKY_COLORS) as (keyof typeof STICKY_COLORS)[]).map((name) => (
          <span
            key={name}
            style={{
              width: 12,
              height: 12,
              borderRadius: '50%',
              background: STICKY_COLORS[name].bg,
              border: '1px solid rgb(0 0 0 / 20%)',
              boxSizing: 'border-box',
            }}
          />
        ))}
      </div>
      <div
        style={{
          minHeight: 0,
          flex: 1,
          padding: '0 12px 12px',
          fontSize: bodySize,
          fontWeight: 500,
          lineHeight: 1.4,
          whiteSpace: 'pre-wrap',
          overflowWrap: 'break-word',
          boxSizing: 'border-box',
        }}
      >
        {text}
      </div>
      {author && (
        <div
          style={{
            flexShrink: 0,
            padding: '0 12px 6px',
            textAlign: 'right',
            fontSize: 10,
            fontStyle: 'italic',
            fontWeight: 600,
            opacity: 0.55,
          }}
        >
          — {author}
        </div>
      )}
    </div>
  );
};
