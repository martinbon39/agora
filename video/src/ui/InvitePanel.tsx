// The multiplayer panel, rebuilt from web/src/components/SharePanel.tsx.
//
// This is the product's own invite affordance, not a blue rectangle that says
// "Invite": the popover the UserRoundPlus button opens, with the email field,
// the scope select, the primary submit, and the row that appears once a link
// has been minted. Everything the app renders at 12-14px is here at 2.25x, so
// the proportions are the app's and only the scale is the film's.
//
// Presentational only, like every other component in this folder: no Remotion
// hooks, no transitions, no internal state. `press`, `reveal` and `copied` are
// driven per frame by the scene, so the click cannot drift off the beat it is
// cut to.

import React from 'react';
import { c, font, node } from '../brand/tokens';

// ---------------------------------------------------------------------------
// Layout. Every box has an explicit height so the hit point below is arithmetic
// rather than a guess — the scene aims the cursor at it and must land on it.

// Every number below is the app's own value at 2.25x; the app's px is in ().
const W = 720; // w-80 (320)
const PAD = 28; // p-3 (12)
const HEADER_H = 122; // title (38) + 6 + two lines of description (78)
const GAP = 26; // gap-3 (12)
const ROW_H = 72; // h-8 (32)
const FIELD_GAP = 14; // gap-1.5 (6)
const BTN_W = 180; // fixed, so the hit point never depends on text metrics
const RADIUS = 14; // rounded-md (6)
const LINK_H = 140; // padding 18 + label 31 + gap 10 + row 63 + padding 18
const LINK_BLOCK_H = GAP + LINK_H;

/**
 * The centre of the primary "Invite" button, relative to the panel's own
 * top-left. The scene adds the panel's position and puts the cursor tip exactly
 * here — a cursor next to the button it is pressing reads as a miss.
 */
export const INVITE_HOTSPOT = {
  x: W - PAD - BTN_W / 2,
  y: PAD + HEADER_H + GAP + ROW_H / 2,
} as const;

/** Panel height at rest and fully open, for anything that needs to centre it. */
export const INVITE_PANEL = {
  width: W,
  height: PAD + HEADER_H + GAP + ROW_H + FIELD_GAP + ROW_H + PAD,
  openHeight: PAD + HEADER_H + GAP + ROW_H + FIELD_GAP + ROW_H + PAD + LINK_BLOCK_H,
} as const;

// ---------------------------------------------------------------------------
// The three lucide glyphs the panel uses, at the app's own 2px stroke.

const IconUserRoundPlus: React.FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ flexShrink: 0 }}
  >
    <path d="M2 21a8 8 0 0 1 13.292-6" />
    <circle cx="10" cy="8" r="5" />
    <path d="M19 16v6" />
    <path d="M22 19h-6" />
  </svg>
);

const IconChevronDown: React.FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="m6 9 6 6 6-6" />
  </svg>
);

const IconCheck: React.FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth={2.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ flexShrink: 0 }}
  >
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

export type InvitePanelProps = {
  /** True from the frame the button is clicked. Gates the link row. */
  pressed: boolean;
  /** 0..1 depress. 1 is fully held down. */
  press: number;
  /** 0..1 for the link row growing out of the bottom of the panel. */
  reveal: number;
  /** 0..1 for the copy button flipping to its copied state. */
  copied?: number;
  /** Who is being invited, and where they land. */
  email?: string;
  scope?: string;
  /** The minted sign-in link. Mono, because it is a thing you hand over. */
  link?: string;
};

export const InvitePanel: React.FC<InvitePanelProps> = ({
  pressed,
  press,
  reveal,
  copied = 0,
  email = 'lea@gmail.com',
  scope = '"agora" canvas only',
  link = 'https://agora.local/#/join/9c41f8a2d7',
}) => {
  const isCopied = copied > 0.5;

  return (
    <div
      style={{
        boxSizing: 'border-box',
        width: W,
        padding: PAD,
        borderRadius: 18,
        border: `1px solid ${c.border}`,
        background: c.popover,
        boxShadow: node.shadow,
        fontFamily: font.sans,
      }}
    >
      {/* header */}
      <div style={{ height: HEADER_H, overflow: 'hidden' }}>
        <p
          style={{
            margin: 0,
            height: 38,
            fontSize: 32,
            fontWeight: 600,
            letterSpacing: -0.4,
            color: c.foreground,
          }}
        >
          Multiplayer
        </p>
        <p
          style={{
            margin: '6px 0 0',
            fontSize: 26,
            lineHeight: '39px',
            color: c.muted,
          }}
        >
          Invite someone and send them the link. They collaborate live: canvas,
          cursors, terminals.
        </p>
      </div>

      {/* the form: an email, where they land, and the button that mints a link */}
      <div style={{ marginTop: GAP }}>
        <div style={{ display: 'flex', gap: FIELD_GAP }}>
          <div
            style={{
              boxSizing: 'border-box',
              display: 'flex',
              flex: 1,
              minWidth: 0,
              alignItems: 'center',
              height: ROW_H,
              padding: `0 ${22}px`,
              borderRadius: RADIUS,
              border: `1px solid ${c.input}`,
              fontSize: 26,
              color: c.foreground,
            }}
          >
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {email}
            </span>
          </div>

          <div
            style={{
              boxSizing: 'border-box',
              display: 'flex',
              width: BTN_W,
              flexShrink: 0,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              height: ROW_H,
              borderRadius: RADIUS,
              background: c.primary,
              color: '#ffffff',
              fontSize: 26,
              fontWeight: 500,
              // the depress: it goes down on the beat and comes back up
              transform: `scale(${1 - 0.045 * press})`,
              filter: `brightness(${1 - 0.14 * press})`,
            }}
          >
            <IconUserRoundPlus size={28} color="#ffffff" />
            Invite
          </div>
        </div>

        <div
          style={{
            boxSizing: 'border-box',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            height: ROW_H,
            marginTop: FIELD_GAP,
            padding: '0 18px',
            borderRadius: RADIUS,
            border: `1px solid ${c.input}`,
            fontSize: 26,
            color: c.foreground,
          }}
        >
          {scope}
          <IconChevronDown size={26} color={c.muted} />
        </div>
      </div>

      {/* what the press produces: a link, readable once, ready to hand over */}
      <div style={{ height: LINK_BLOCK_H * reveal, overflow: 'hidden' }}>
        {pressed && (
          <div
            style={{
              boxSizing: 'border-box',
              marginTop: GAP,
              height: LINK_H,
              padding: 18,
              borderRadius: RADIUS,
              border: `1px solid ${c.input}`,
              background: 'rgb(255 255 255 / 4%)',
              opacity: Math.min(1, reveal * 1.6),
            }}
          >
            <p
              style={{
                margin: 0,
                height: 31,
                fontSize: 22,
                lineHeight: '31px',
                color: c.muted,
              }}
            >
              Sign-in link for{' '}
              <span style={{ fontWeight: 500, color: c.foreground }}>{email}</span>, shown
              once, copy it now.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
              <div
                style={{
                  boxSizing: 'border-box',
                  display: 'flex',
                  flex: 1,
                  minWidth: 0,
                  alignItems: 'center',
                  height: 63,
                  padding: '0 14px',
                  borderRadius: 10,
                  border: `1px solid ${isCopied ? c.primary : c.input}`,
                  fontFamily: font.mono,
                  fontSize: 22,
                  color: c.foreground,
                }}
              >
                <span
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {link}
                </span>
              </div>
              <div
                style={{
                  boxSizing: 'border-box',
                  display: 'flex',
                  width: 150,
                  flexShrink: 0,
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  height: 63,
                  borderRadius: 10,
                  background: c.primary,
                  color: '#ffffff',
                  fontSize: 22,
                  fontWeight: 500,
                }}
              >
                {isCopied && <IconCheck size={20} color="#ffffff" />}
                {isCopied ? 'Copied' : 'Copy'}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
