// One terminal, drawn as whichever harness is actually running in it.
//
// Every terminal in the film goes through here, so a session is never generic
// text: claude sessions get Claude Code's interface, codex sessions get Codex's,
// gemini gets Gemini's. That is the difference between claiming the product runs
// any engine and showing it.

import React from 'react';
import type { Harness } from '../brand/tokens';
import { TuiClaude, type TuiEvent, type TuiStatus } from '../ui/TuiClaude';
import { TuiCodex } from '../ui/TuiCodex';
import { TuiGemini } from '../ui/TuiGemini';

export type { TuiEvent, TuiStatus };

export const Session: React.FC<{
  harness: Harness;
  width: number;
  /** the node's BODY height: the node height minus its 36px header */
  height: number;
  events?: TuiEvent[];
  visibleCount?: number;
  status?: TuiStatus;
  spinnerFrame?: number;
  promptText?: string;
  fontSize?: number;
}> = ({ harness, ...rest }) => {
  if (harness === 'codex') return <TuiCodex {...rest} />;
  if (harness === 'gemini') return <TuiGemini {...rest} />;
  return <TuiClaude {...rest} />;
};
