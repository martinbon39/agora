import React, { useId } from 'react';
import { c } from '../brand/tokens';

/**
 * The react-flow dot grid over the app background. offsetX/offsetY shift the
 * pattern so the canvas can pan underneath the nodes.
 */
export const CanvasBackground: React.FC<{
  width?: number;
  height?: number;
  offsetX?: number;
  offsetY?: number;
  opacity?: number;
}> = ({ width, height, offsetX = 0, offsetY = 0, opacity = 1 }) => {
  const id = useId();
  return (
    <svg
      width={width ?? '100%'}
      height={height ?? '100%'}
      style={{ position: 'absolute', inset: 0, display: 'block', opacity }}
    >
      <defs>
        <pattern
          id={id}
          width={30}
          height={30}
          patternUnits="userSpaceOnUse"
          patternTransform={`translate(${offsetX} ${offsetY})`}
        >
          <circle cx={1.2} cy={1.2} r={1.2} fill="#77736b55" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={c.background} />
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
};
