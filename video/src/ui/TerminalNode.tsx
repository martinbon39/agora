import React from 'react';
import { c, font, node, type AgentState, type Harness } from '../brand/tokens';
import { HarnessAvatar } from './HarnessAvatar';

// state pill recipes from web/src/canvas/nodes/TerminalNode.tsx:140-153
const PILL: Record<string, { bg: string; ink: string }> = {
  needs_approval: { bg: 'rgb(251 113 133 / 0.10)', ink: '#fb7185' },
  working: { bg: 'rgb(251 191 36 / 0.10)', ink: '#fbbf24' },
  idle: { bg: 'rgb(52 211 153 / 0.10)', ink: '#34d399' },
};

/**
 * The .canvas-node chrome around a session. `glowColor`/`glowStrength` is the
 * "someone is watching this terminal" treatment — at 1 it matches the app's
 * `0 0 0 2.5px COLOR, 0 0 22px COLOR88` viewer shadow, at 0 the plain node
 * shadow; the ring and bloom widths interpolate linearly in between.
 */
export const TerminalNode: React.FC<{
  name: string;
  harness: Harness;
  state: AgentState;
  path?: string;
  stateLabel?: string;
  viewers?: { name: string; color: string }[];
  width: number;
  height: number;
  selected?: boolean;
  glowColor?: string;
  glowStrength?: number;
  children: React.ReactNode;
}> = ({
  name,
  harness,
  state,
  path,
  stateLabel,
  viewers = [],
  width,
  height,
  selected,
  glowColor,
  glowStrength = 0,
  children,
}) => {
  const glow = glowColor && glowStrength > 0;
  const boxShadow = glow
    ? `0 0 0 ${2.5 * glowStrength}px ${glowColor}, 0 0 ${22 * glowStrength}px ${glowColor}88, ${node.shadow}`
    : node.shadow;

  const pill = stateLabel ? (PILL[state] ?? PILL.idle) : undefined;

  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        width,
        height,
        overflow: 'hidden',
        borderRadius: node.radius,
        border: node.border,
        background: c.card,
        boxShadow,
        outline: selected ? '2px solid rgb(54 111 251 / 0.7)' : undefined,
        outlineOffset: selected ? 1 : undefined,
        fontFamily: font.sans,
      }}
    >
      <header
        style={{
          display: 'flex',
          height: node.headerHeight,
          flexShrink: 0,
          alignItems: 'center',
          gap: 8,
          borderBottom: `1px solid ${c.border}`,
          padding: '0 8px',
          boxSizing: 'border-box',
        }}
      >
        <span style={{ display: 'inline-flex', transform: 'scale(0.9)' }}>
          <HarnessAvatar harness={harness} state={state} size="sm" ringColor={c.card} />
        </span>
        <span
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: c.foreground,
            whiteSpace: 'nowrap',
          }}
        >
          {name}
        </span>
        {pill && (
          <span
            style={{
              borderRadius: 999,
              padding: '2px 8px',
              fontSize: 10,
              fontWeight: 500,
              background: pill.bg,
              color: pill.ink,
              whiteSpace: 'nowrap',
            }}
          >
            {stateLabel}
          </span>
        )}
        {viewers.map((v) => (
          <span
            key={v.name}
            style={{
              maxWidth: 96,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              borderRadius: 999,
              padding: '1px 6px',
              fontSize: 9,
              fontWeight: 700,
              background: v.color,
              color: '#1c1917',
            }}
          >
            {v.name}
          </span>
        ))}
        <span
          style={{
            minWidth: 0,
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            textAlign: 'right',
            fontSize: 10,
            color: `${c.muted}b3`,
          }}
        >
          {path ?? ''}
        </span>
      </header>
      <div style={{ minHeight: 0, flex: 1 }}>{children}</div>
    </div>
  );
};
