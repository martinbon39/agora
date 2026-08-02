import React from 'react';
import { c, font, node, type Harness } from '../brand/tokens';
import { HarnessGlyph } from './HarnessAvatar';

export type ChatMessage = {
  author: string;
  to?: string;
  text: string;
  time: string;
  human?: boolean;
  harness?: Harness;
};

// verbatim from web/src/canvas/nodes/ChatNode.tsx:11-15
function agentHue(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

/** Body with @mentions highlighted, colored like the mentioned agent. */
const ChatBody: React.FC<{ body: string; fontSize: number }> = ({ body, fontSize }) => {
  const parts = body.split(/(@[\w-]+)/g);
  return (
    <p
      style={{
        margin: 0,
        whiteSpace: 'pre-wrap',
        overflowWrap: 'break-word',
        lineHeight: 1.625,
        fontSize,
        color: `${c.foreground}e6`,
      }}
    >
      {parts.map((p, i) =>
        p.startsWith('@') ? (
          <span
            key={i}
            style={{
              background: 'rgb(255 255 255 / 7%)',
              borderRadius: 3,
              padding: '0 4px',
              fontWeight: 500,
              color: `hsl(${agentHue(p.slice(1))} 70% 70%)`,
            }}
          >
            {p}
          </span>
        ) : (
          p
        )
      )}
    </p>
  );
};

const MegaphoneGlyph: React.FC = () => (
  <svg
    width={14}
    height={14}
    viewBox="0 0 24 24"
    fill="none"
    stroke="#fbbf24"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ flexShrink: 0 }}
  >
    <path d="m3 11 18-5v12L3 14v-3z" />
    <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
  </svg>
);

/** The project board node — announcements read, never pushed. */
export const ChatNode: React.FC<{
  width: number;
  height: number;
  messages: ChatMessage[];
  visibleCount?: number;
  title?: string;
  /** Drop the soft shadow entirely. For GIF loops: a 34px blur is palette poison. */
  noShadow?: boolean;
}> = ({ width, height, messages, visibleCount, title = 'Project board', noShadow }) => {
  const shown = visibleCount === undefined ? messages : messages.slice(0, visibleCount);
  // the app sizes the body with clamp(12px, 3.2cqw, 17px); resolve it here
  const bodySize = Math.min(17, Math.max(12, width * 0.032));

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
        boxShadow: noShadow ? 'none' : node.shadow,
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
          padding: '0 10px',
          boxSizing: 'border-box',
        }}
      >
        <MegaphoneGlyph />
        <span style={{ fontSize: 12, fontWeight: 500, color: c.foreground, whiteSpace: 'nowrap' }}>
          {title}
        </span>
        <span
          style={{
            minWidth: 0,
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: 10,
            color: `${c.muted}99`,
          }}
        >
          read, never pushed
        </span>
      </header>

      <div
        style={{
          minHeight: 0,
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          overflow: 'hidden',
          padding: 10,
          boxSizing: 'border-box',
        }}
      >
        {shown.map((m, i) => {
          const hue = agentHue(m.author);
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <span
                style={{
                  marginTop: 2,
                  display: 'flex',
                  width: 20,
                  height: 20,
                  flexShrink: 0,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '50%',
                  backgroundColor: m.human
                    ? 'rgb(139 92 246 / 0.25)'
                    : `hsl(${hue} 60% 50% / 0.22)`,
                  boxShadow: m.human
                    ? undefined
                    : `inset 0 0 0 1px hsl(${hue} 60% 55% / 0.5)`,
                }}
              >
                {m.human ? (
                  <span style={{ fontSize: 9, fontWeight: 600, color: '#c4b5fd' }}>M</span>
                ) : (
                  <HarnessGlyph harness={m.harness ?? 'shell'} size={11} />
                )}
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <p
                  style={{
                    margin: 0,
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 6,
                  }}
                >
                  <span
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontSize: 11,
                      fontWeight: 600,
                      color: m.human ? 'rgb(167 139 250)' : `hsl(${hue} 65% 72%)`,
                    }}
                  >
                    {m.author}
                  </span>
                  {m.to && (
                    <span style={{ flexShrink: 0, fontSize: 10, color: `${c.muted}b3` }}>
                      →{' '}
                      <span style={{ color: `hsl(${agentHue(m.to)} 65% 72%)` }}>{m.to}</span>
                    </span>
                  )}
                  <span
                    style={{
                      flexShrink: 0,
                      fontSize: 9,
                      fontVariantNumeric: 'tabular-nums',
                      color: `${c.muted}80`,
                    }}
                  >
                    {m.time}
                  </span>
                </p>
                <ChatBody body={m.text} fontSize={bodySize} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
