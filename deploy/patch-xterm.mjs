// Selection & mouse hit-testing in a terminal rendered under a CSS
// `transform: scale()` ancestor — which is every terminal on the canvas, since
// React Flow scales its whole viewport with the zoom level.
//
// xterm.js maps mouse events to cells as (clientX - rect.left) / cellWidth:
// the numerator is in *visually scaled* pixels while the cell metrics are
// unscaled layout pixels, so at zoom z the computed row is z × the row under
// the pointer. Selecting row 30 at zoom 0.9 highlights row 27 — the "selection
// lands above/below the cursor" bug, on every device. Upstream has no
// transform support (xtermjs/xterm.js#3234), hence this surgical patch of the
// installed bundle: divide the pointer offsets by the element's actual render
// scale (rect / offsetWidth) before handing them to the cell math.
//
// Idempotent; wired as root postinstall so any reinstall re-applies it.
// If the needle is gone (xterm upgrade), it fails the install/test LOUDLY:
// re-check whether the new version handles transforms before re-pinning.

import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const target = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../node_modules/@xterm/xterm/lib/xterm.js"
);

const NEEDLE =
  'function i(e,t,i){const s=i.getBoundingClientRect(),r=e.getComputedStyle(i),n=parseInt(r.getPropertyValue("padding-left")),o=parseInt(r.getPropertyValue("padding-top"));return[t.clientX-s.left-n,t.clientY-s.top-o]}';

// Same function, scale-aware. offsetWidth/Height are unscaled layout px while
// the rect is visually scaled — their ratio IS the effective ancestor scale
// (offsetWidth rounds to integers: <0.2% error, a fraction of a cell even at
// the bottom of a tall terminal). Guarded so a hidden element (0×0) keeps
// scale 1 instead of dividing by zero.
const REPLACEMENT =
  'function i(e,t,i){const s=i.getBoundingClientRect(),a=i.offsetWidth&&s.width?s.width/i.offsetWidth:1,c=i.offsetHeight&&s.height?s.height/i.offsetHeight:1,r=e.getComputedStyle(i),n=parseInt(r.getPropertyValue("padding-left")),o=parseInt(r.getPropertyValue("padding-top"));return[(t.clientX-s.left)/a-n,(t.clientY-s.top)/c-o]}';

let src;
try {
  src = readFileSync(target, "utf8");
} catch {
  console.error(`patch-xterm: ${target} not found — install dependencies first`);
  process.exit(1);
}

if (src.includes(REPLACEMENT)) {
  console.log("patch-xterm: already applied");
  process.exit(0);
}

const parts = src.split(NEEDLE);
if (parts.length !== 2) {
  console.error(
    `patch-xterm: expected exactly 1 occurrence of the target function, found ${parts.length - 1}.\n` +
      "The installed @xterm/xterm no longer matches this patch (upgrade?). " +
      "Check whether the new version fixed CSS-transform mouse mapping " +
      "(xtermjs/xterm.js#3234) before updating NEEDLE/REPLACEMENT — " +
      "deploy/repro-xterm-scale.mjs proves it either way."
  );
  process.exit(1);
}

writeFileSync(target, parts.join(REPLACEMENT));
// Vite's dep pre-bundle keys on the lockfile, not dep file contents — a stale
// cache would keep serving the unpatched xterm to `vite dev` forever.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const cache of ["node_modules/.vite", "web/node_modules/.vite"])
  rmSync(path.join(root, cache), { recursive: true, force: true });
console.log("patch-xterm: applied (scale-aware mouse coords)");
