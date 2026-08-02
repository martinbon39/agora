import React from 'react';
import { font } from '../brand/tokens';

/**
 * The exact multiplayer arrow from web/src/canvas/PresenceLayer.tsx. Absolutely
 * positioned at x,y; no transition, no animation — it is moved every frame.
 */
export const Cursor: React.FC<{
  x: number;
  y: number;
  name: string;
  color: string;
  scale?: number;
  opacity?: number;
}> = ({ x, y, name, color, scale = 1, opacity = 1 }) => (
  <div
    style={{
      position: 'absolute',
      left: 0,
      top: 0,
      transform: `translate(${x}px, ${y}px) scale(${scale})`,
      transformOrigin: 'top left',
      opacity,
      pointerEvents: 'none',
    }}
  >
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      style={{ filter: 'drop-shadow(0 1px 2px rgb(0 0 0 / 50%))' }}
    >
      <path
        fill={color}
        stroke="rgba(0,0,0,0.4)"
        strokeWidth={1}
        d="M4 2l16 7.6-7.1 2L9.6 19 4 2z"
      />
    </svg>
    <span
      style={{
        display: 'block',
        width: 'max-content',
        maxWidth: 160,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        marginLeft: 14,
        marginTop: -2,
        borderRadius: 999,
        padding: '2px 8px',
        fontFamily: font.sans,
        fontSize: 10,
        fontWeight: 600,
        background: color,
        color: '#1c1917',
      }}
    >
      {name}
    </span>
  </div>
);
