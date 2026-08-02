import React from 'react';
import { GRAIN_URL } from '../brand/tokens';

/** Full-bleed fractal-noise overlay — the SVG itself carries its 3.5% opacity. */
export const Grain: React.FC<{ opacity?: number }> = ({ opacity = 1 }) => (
  <div
    style={{
      position: 'absolute',
      inset: 0,
      backgroundImage: GRAIN_URL,
      backgroundSize: '256px 256px',
      backgroundRepeat: 'repeat',
      pointerEvents: 'none',
      opacity,
    }}
  />
);
