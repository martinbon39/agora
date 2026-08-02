import React from 'react';
import { c, type AgentState, type Harness } from '../brand/tokens';
import { BRAND_ICONS } from './BrandIcons';

// Circle tint per harness, same recipe as web/src/components/HarnessAvatar.tsx
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

/** The real brand marks (see BrandIcons.tsx). Same name and props as before,
 *  so every existing call site keeps working. */
export const HarnessGlyph: React.FC<{ harness: Harness; size?: number }> = ({
  harness,
  size = 16,
}) => {
  const Icon = BRAND_ICONS[harness];
  return <Icon size={size} />;
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
