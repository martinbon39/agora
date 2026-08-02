import React from 'react';
import { c, type AgentState, type Harness } from '../brand/tokens';

// Circle tint per harness — same recipe as web/src/components/HarnessAvatar.tsx
// (claude = brand terracotta at 12%, gemini = blue-500/10, the rest stone-500/10).
const HARNESS_BG: Record<Harness, string> = {
  claude: `${c.claude}1f`,
  shell: 'rgb(120 113 108 / 0.12)',
  codex: 'rgb(120 113 108 / 0.10)',
  opencode: 'rgb(120 113 108 / 0.10)',
  gemini: 'rgb(59 130 246 / 0.10)',
};

const STATUS_COLOR: Record<AgentState, string> = {
  unknown: '#57534e',
  idle: c.idle,
  working: c.working,
  needs_approval: c.needsApproval,
};

/** Hand-drawn brand glyphs — they only need to read at a glance. */
export const HarnessGlyph: React.FC<{ harness: Harness; size?: number }> = ({
  harness,
  size = 16,
}) => {
  switch (harness) {
    case 'claude':
      // eight-ray starburst in the Anthropic terracotta
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <g stroke={c.claude} strokeWidth={2.4} strokeLinecap="round">
            <line x1={12} y1={4} x2={12} y2={20} />
            <line x1={4} y1={12} x2={20} y2={12} />
            <line x1={6.6} y1={6.6} x2={17.4} y2={17.4} />
            <line x1={17.4} y1={6.6} x2={6.6} y2={17.4} />
          </g>
        </svg>
      );
    case 'gemini':
      // four-point sparkle
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <path
            fill="#3b82f6"
            d="M12 2c1 6 4 9 10 10-6 1-9 4-10 10-1-6-4-9-10-10 6-1 9-4 10-10z"
          />
        </svg>
      );
    case 'codex':
      // interlocking petal knot
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <g stroke={c.foreground} strokeWidth={1.6} fill="none">
            <ellipse cx={12} cy={12} rx={9} ry={3.8} />
            <ellipse cx={12} cy={12} rx={9} ry={3.8} transform="rotate(60 12 12)" />
            <ellipse cx={12} cy={12} rx={9} ry={3.8} transform="rotate(120 12 12)" />
          </g>
        </svg>
      );
    case 'opencode':
      // square terminal with a block caret
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <rect
            x={4}
            y={4}
            width={16}
            height={16}
            rx={3}
            fill="none"
            stroke={c.foreground}
            strokeWidth={1.8}
          />
          <rect x={8} y={12} width={4.5} height={4.5} fill={c.foreground} />
        </svg>
      );
    case 'shell':
      // classic prompt: chevron + underscore
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <g stroke={c.foreground} strokeWidth={2} strokeLinecap="round" fill="none">
            <path d="M5 7l5 5-5 5" />
            <line x1={13} y1={17} x2={19} y2={17} />
          </g>
        </svg>
      );
  }
};

export const HarnessAvatar: React.FC<{
  harness: Harness;
  state: AgentState;
  size?: 'sm' | 'md';
  exited?: boolean;
  ringColor?: string;
  pingScale?: number;
  pingOpacity?: number;
}> = ({
  harness,
  state,
  size = 'md',
  exited,
  ringColor = c.sidebar,
  pingScale = 1,
  pingOpacity = 0,
}) => {
  const circle = size === 'md' ? 36 : 28;
  const icon = size === 'md' ? 18 : 14;
  const dot = size === 'md' ? 12 : 10;

  return (
    <span
      style={{
        position: 'relative',
        display: 'inline-flex',
        flexShrink: 0,
        opacity: exited ? 0.4 : 1,
        filter: exited ? 'grayscale(1)' : undefined,
      }}
    >
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: circle,
          height: circle,
          borderRadius: '50%',
          background: HARNESS_BG[harness],
        }}
      >
        <HarnessGlyph harness={harness} size={icon} />
      </span>
      {!exited && (
        <span
          style={{
            position: 'absolute',
            bottom: -2,
            right: -2,
            width: dot,
            height: dot,
            borderRadius: '50%',
            background: STATUS_COLOR[state],
            boxShadow: `0 0 0 2px ${ringColor}`,
          }}
        >
          {state === 'needs_approval' && (
            <span
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: '50%',
                background: 'rgb(244 63 94 / 0.6)',
                transform: `scale(${pingScale})`,
                opacity: pingOpacity,
              }}
            />
          )}
        </span>
      )}
    </span>
  );
};
