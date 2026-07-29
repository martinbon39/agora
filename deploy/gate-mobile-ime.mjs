// Mobile IME gate — run: `npm run dev -w web` then `node deploy/gate-mobile-ime.mjs`
// (needs playwright + chromium, cf. gate-paste.mjs)
// Proof of the mobile-IME de-duplication filter (xterm.js #3600).
// Replays, in the REAL frontend (vite dev + real xterm), the event sequence an
// Android keyboard (GBoard / voice dictation) produces: an IME composition
// followed by a redundant commit. Unguarded, xterm emits the same text down
// TWO internal paths and the pty receives it twice. Also checks that genuine
// repetitions are never filtered out.
import { chromium } from "playwright";

const BASE = "http://localhost:5173";
const SESSION = {
  id: "s1", name: "proof", project_path: "/home/agora", harness: "shell",
  command: "bash", status: "running", agent_state: "idle",
  created_at: Date.now(), last_activity: Date.now(),
};

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const ptyInput = [];

await page.route("**/api/**", (r) => r.fulfill({ json: {} }));
await page.route("**/api/auth/me", (r) => r.fulfill({ json: { authed: true, enrolled: true, google: false } }));
await page.route("**/api/sessions", (r) => r.fulfill({ json: { sessions: [SESSION] } }));
await page.route("**/api/projects", (r) => r.fulfill({ json: { projects: [] } }));
await page.route("**/api/notifications", (r) => r.fulfill({ json: { notifications: [], unread: 0 } }));
await page.routeWebSocket(/\/ws\/events/, () => {});
await page.routeWebSocket(/\/ws\/sessions\/.*\/attach/, (ws) => {
  ws.onMessage((m) => {
    const msg = JSON.parse(typeof m === "string" ? m : m.toString());
    if (msg.t === "i") ptyInput.push(msg.d);
  });
  ws.send(Buffer.from("welcome\r\n", "utf8"));
});

await page.goto(`${BASE}/#/session/s1`);
await page.waitForSelector(".xterm textarea", { timeout: 15000 });
await page.click(".terminal-container");
await sleep(300);

// The GBoard sequence: an IME composition (no real keydown) plus a redundant
// commit. This is the pattern described in xterm.js #3600 and the CodeMirror
// diagnosis: input arrives as composition events, then the keyboard commits
// the same text through an insertText input — xterm emits both.
const gboardCompose = (text) =>
  page.evaluate((text) => {
    const ta = document.querySelector(".xterm-helper-textarea");
    ta.dispatchEvent(new CompositionEvent("compositionstart", { data: "", bubbles: true }));
    ta.value += text;
    ta.dispatchEvent(new CompositionEvent("compositionupdate", { data: text, bubbles: true }));
    ta.dispatchEvent(new CompositionEvent("compositionend", { data: text, bubbles: true }));
    ta.dispatchEvent(
      new InputEvent("input", { inputType: "insertText", data: text, bubbles: true, composed: true })
    );
  }, text);

const count = (needle) => ptyInput.filter((d) => d.includes(needle)).length;

// --- D0. AVANT toute composition (= desktop) : double Ctrl+V rapide passe --
// The filter is armed only by IME composition events; a desktop never emits
// any, so nothing is ever filtered there.
await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
await page.evaluate(() => navigator.clipboard.writeText("PASTE-X"));
ptyInput.length = 0;
await page.keyboard.press("Control+v");
await sleep(100);
await page.keyboard.press("Control+v");
await sleep(400);
check("D0: a deliberate double paste (desktop) = 2 sends", count("PASTE-X") === 2,
  `got ${count("PASTE-X")}x`);

// --- D1. dictation/GBoard: the text must arrive exactly ONCE --------------
ptyInput.length = 0;
await gboardCompose("hello world");
await sleep(400);
check("D1: an IME chunk arrives exactly once", count("hello world") === 1,
  `got ${count("hello world")}x  ${JSON.stringify(ptyInput)}`);

// --- D2. re-dictating the SAME text after a pause still works -------------
ptyInput.length = 0;
await gboardCompose("encore");
await sleep(450); // > the dedup window (300ms)
await gboardCompose("encore");
await sleep(400);
check("D2: the same text re-dictated after a pause = 2 sends", count("encore") === 2,
  `got ${count("encore")}x`);

// --- D3. repeated desktop keystrokes are never filtered --------------------
ptyInput.length = 0;
await page.keyboard.type("aa", { delay: 30 });
await sleep(200);
check("D3: 'aa' typed fast = 2 characters through", ptyInput.join("") === "aa",
  JSON.stringify(ptyInput.join("")));

// --- D4. a repeat paste AFTER the post-composition window is never filtered
await page.evaluate(() => navigator.clipboard.writeText("PASTE-Y"));
await sleep(1100); // past the composition window (1s)
ptyInput.length = 0;
await page.keyboard.press("Control+v");
await sleep(100);
await page.keyboard.press("Control+v");
await sleep(400);
check("D4: a double paste 1s after dictation = 2 sends", count("PASTE-Y") === 2,
  `got ${count("PASTE-Y")}x`);

await browser.close();
console.log(results.every(Boolean) ? "\nALL GREEN" : "\nFAILURES");
process.exit(results.every(Boolean) ? 0 : 1);
