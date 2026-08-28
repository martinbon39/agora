// Behavioral proof for deploy/patch-xterm.mjs: drag-select across ONE visible
// row of an xterm terminal rendered under `transform: scale()` (what every
// canvas terminal lives in — React Flow scales its viewport with the zoom),
// and assert the selection is the row under the pointer.
//
// Unpatched xterm 5.5 selects row × scale instead (drag row 20 at zoom 0.8 →
// ROW-16). Not part of the test chain — it needs a Chromium — but this is the
// script to rerun before bumping @xterm/xterm: if it passes on the NEW version
// unpatched, upstream fixed xtermjs/xterm.js#3234 and the patch can be dropped.
//
// Usage: node deploy/repro-xterm-scale.mjs [scale]
//   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core (has a default)
//   CHROMIUM=/path/to/headless_shell               (has a default)

import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const XTERM_JS = path.join(root, "node_modules/@xterm/xterm/lib/xterm.js");
const XTERM_CSS = path.join(root, "node_modules/@xterm/xterm/css/xterm.css");
const PW =
  process.env.PLAYWRIGHT_CORE ??
  "/home/orbit/projects/ai-showrunner-refonte/node_modules/playwright-core";
const EXE =
  process.env.CHROMIUM ??
  "/home/orbit/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell";

if (!existsSync(PW) || !existsSync(EXE)) {
  console.log("SKIP: no playwright-core/Chromium found — set PLAYWRIGHT_CORE and CHROMIUM");
  process.exit(0);
}
const { chromium } = await import(pathToFileURL(path.join(PW, "index.mjs")));

const SCALE = Number(process.argv[2] ?? 0.8);
const TARGET_ROW = 20; // 1-based

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
await page.setContent(`
  <div id="wrap" style="transform: scale(${SCALE}); transform-origin: 0 0;">
    <div id="term" style="width: 800px; height: 500px;"></div>
  </div>`);
await page.addStyleTag({ path: XTERM_CSS });
await page.addScriptTag({ path: XTERM_JS });

await page.evaluate(() => {
  const term = new window.Terminal({ fontSize: 13.5, lineHeight: 1.25, scrollback: 0 });
  window.term = term;
  term.open(document.getElementById("term"));
  for (let r = 1; r <= term.rows; r++)
    term.write(`ROW-${String(r).padStart(2, "0")} ${"x".repeat(30)}${r < term.rows ? "\r\n" : ""}`);
});
await page.waitForTimeout(300);

const box = await page.evaluate(() => {
  const r = document.querySelector(".xterm-screen").getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height, rows: window.term.rows };
});
const cellH = box.height / box.rows;
const y = box.top + (TARGET_ROW - 0.5) * cellH;

await page.mouse.move(box.left + 2, y);
await page.mouse.down();
await page.mouse.move(box.left + box.width * 0.4, y, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(100);

const sel = await page.evaluate(() => window.term.getSelection());
console.log(`dragged across visual row ${TARGET_ROW} at scale ${SCALE}`);
console.log(`selection: ${JSON.stringify(sel)}`);
const ok = sel.includes(`ROW-${TARGET_ROW}`);
console.log(ok ? "PASS: selection is the row under the pointer" : "FAIL: selection is offset");
await browser.close();
process.exit(ok ? 0 : 1);
