// Mobile gate — run: `npm run dev -w web` then `node deploy/gate-mobile-ime.mjs`
// Proof of the two mobile behaviors, in the REAL frontend (vite dev + real xterm):
//
//  1. Input integrity on touch devices. Android keyboards (GBoard, dictation)
//     drive xterm through IME composition, and xterm re-emits the same text
//     through several internal paths — duplicated input, sometimes the whole
//     line again (xterm.js #3600, unfixed in 6.0). On coarse-pointer devices
//     TerminalView takes the input path over (textarea-value diffing); these
//     tests replay adversarial GBoard sequences and assert the pty receives
//     exactly what was typed. Desktop keeps xterm's pipeline + ghost filter.
//
//  2. The mobile layout toggle: focus view (session wall → full-screen
//     terminal) by default, canvas behind the TopBar switch.
//
// Playwright resolution mirrors deploy/repro-xterm-scale.mjs: a local
// `playwright` install wins, else PLAYWRIGHT_CORE + CHROMIUM env (defaults).
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const PW_CORE =
  process.env.PLAYWRIGHT_CORE ??
  "/home/orbit/projects/ai-showrunner-refonte/node_modules/playwright-core";
const EXE =
  process.env.CHROMIUM ??
  "/home/orbit/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell";

let chromium;
let launchOpts = {};
try {
  ({ chromium } = await import("playwright"));
} catch {
  if (!existsSync(PW_CORE) || !existsSync(EXE)) {
    console.log("SKIP: no playwright/Chromium found — set PLAYWRIGHT_CORE and CHROMIUM");
    process.exit(0);
  }
  ({ chromium } = await import(pathToFileURL(path.join(PW_CORE, "index.mjs"))));
  launchOpts = { executablePath: EXE };
}

const BASE = "http://localhost:5173";
const SESSION = {
  id: "s1", name: "proof", project_path: "/home/agora", harness: "shell",
  command: "bash", status: "running", agent_state: "idle",
  created_at: Date.now(), last_activity: Date.now(),
};
const WALL_ENTRY = {
  id: "s1", name: "proof", project_path: "/home/orbit", harness: "shell",
  agent_state: "idle", preview: "welcome",
};

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch(launchOpts);

/** Wire the API/WS mocks and pty capture into a page. */
const rig = async (page, ptyInput) => {
  await page.route("**/api/**", (r) => r.fulfill({ json: {} }));
  await page.route("**/api/auth/me", (r) => r.fulfill({ json: { authed: true, enrolled: true, google: false } }));
  await page.route("**/api/sessions", (r) => r.fulfill({ json: { sessions: [SESSION] } }));
  await page.route("**/api/projects", (r) => r.fulfill({ json: { projects: [] } }));
  await page.route("**/api/notifications", (r) => r.fulfill({ json: { notifications: [], unread: 0 } }));
  await page.route("**/api/wall", (r) => r.fulfill({ json: { sessions: [WALL_ENTRY] } }));
  await page.routeWebSocket(/\/ws\/events/, () => {});
  await page.routeWebSocket(/\/ws\/sessions\/.*\/attach/, (ws) => {
    ws.onMessage((m) => {
      const msg = JSON.parse(typeof m === "string" ? m : m.toString());
      if (msg.t === "i") ptyInput.push(msg.d);
    });
    ws.send(Buffer.from("welcome\r\n", "utf8"));
  });
};

/** What the pty's line editor would hold after these chunks (\x7f = rubout). */
const applied = (chunks) => {
  let s = "";
  for (const ch of chunks.join("")) {
    if (ch === "\x7f") s = s.slice(0, -1);
    else s += ch;
  }
  return s;
};

// ═══════════════════════════ mobile context ═══════════════════════════════
// isMobile makes (pointer: coarse) match — the input takeover arms, and the
// app boots into the focus view (session wall).
{
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  const ptyInput = [];
  await rig(page, ptyInput);

  await page.goto(`${BASE}/#/session/s1`);
  await page.waitForSelector(".xterm textarea", { timeout: 15000 });
  await sleep(300);

  // In-page GBoard simulator: mutates the hidden textarea exactly like the
  // browser does under a soft keyboard, then fires the same event stream —
  // INCLUDING the redundant duplicate paths xterm.js #3600 documents.
  await page.evaluate(() => {
    const ta = document.querySelector(".xterm-helper-textarea");
    const key = (type, keyCode, init = {}) => {
      const e = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
      Object.defineProperty(e, "keyCode", { get: () => keyCode });
      ta.dispatchEvent(e);
    };
    const input = (inputType, data) =>
      ta.dispatchEvent(new InputEvent("input", { inputType, data, bubbles: true, composed: true }));
    const comp = (type, data) =>
      ta.dispatchEvent(new CompositionEvent(type, { data, bubbles: true }));
    window.gboard = {
      key, input, comp,
      // compose a word keystroke by keystroke, then commit it TWICE (the
      // documented duplicate: compositionend path + insertText input path)
      type(word) {
        comp("compositionstart", "");
        let composed = "";
        for (const ch of word) {
          key("keydown", 229, { key: "Unidentified", isComposing: true });
          composed += ch;
          ta.value += ch;
          comp("compositionupdate", composed);
          input("insertCompositionText", composed);
        }
        comp("compositionend", composed);
        input("insertText", composed); // the ghost commit
      },
      // the whole-line recommit: a stray compositionend with nothing new —
      // unpatched, xterm's deferred read resends the accumulated tail
      recommit() {
        comp("compositionstart", "");
        comp("compositionend", ta.value);
        input("insertText", ta.value);
      },
      backspace() {
        key("keydown", 229, { key: "Unidentified" });
        ta.value = ta.value.slice(0, -1);
        input("deleteContentBackward", null);
      },
      autocorrect(from, to) {
        ta.value = ta.value.slice(0, -from.length) + to;
        input("insertReplacementText", to);
      },
      softEnter() {
        key("keydown", 229, { key: "Unidentified" });
        ta.value += "\n";
        input("insertLineBreak", null);
      },
      hardKey(name, code) {
        key("keydown", code, { key: name });
      },
      pasteChip(text) {
        ta.value += text;
        input("insertFromPaste", text);
      },
    };
  });
  const g = (method, ...args) =>
    page.evaluate(([m, a]) => window.gboard[m](...a), [method, args]);
  const count = (needle) => ptyInput.filter((d) => d.includes(needle)).length;

  // --- M1. GBoard word + ghost commit: exactly once ------------------------
  ptyInput.length = 0;
  await g("type", "hello world");
  await sleep(300);
  check("M1: composed text arrives exactly once", applied(ptyInput) === "hello world",
    JSON.stringify(ptyInput));

  // --- M2. stray whole-line recommit: nothing new sent ---------------------
  ptyInput.length = 0;
  await g("recommit");
  await sleep(300);
  check("M2: a whole-line recommit sends nothing", ptyInput.length === 0,
    JSON.stringify(ptyInput));

  // --- M3. same word again AFTER the old 300ms window: sent again, once ----
  ptyInput.length = 0;
  await g("type", " hello world");
  await sleep(450);
  await g("type", " hello world");
  await sleep(300);
  check("M3: genuine repetition survives, each copy once",
    applied(ptyInput) === " hello world hello world", JSON.stringify(ptyInput));

  // --- M4. autocorrect rewrites the tail ----------------------------------
  ptyInput.length = 0;
  await g("type", " helo");
  await g("autocorrect", "helo", "hello");
  await sleep(300);
  check("M4: autocorrect lands as rubout + fix", applied(ptyInput) === " hello",
    JSON.stringify(ptyInput));

  // --- M5. soft-keyboard backspace -----------------------------------------
  ptyInput.length = 0;
  await g("backspace");
  await sleep(200);
  check("M5: soft backspace = one DEL", ptyInput.join("") === "\x7f",
    JSON.stringify(ptyInput));

  // --- M6. hard Enter goes through xterm, once; typing after still clean ---
  ptyInput.length = 0;
  await g("hardKey", "Enter", 13);
  await sleep(200);
  await g("type", "ok");
  await sleep(300);
  check("M6: Enter then fresh text", ptyInput[0] === "\r" && applied(ptyInput.slice(1)) === "ok",
    JSON.stringify(ptyInput));

  // --- M7. soft Enter (229 + insertLineBreak) maps to \r -------------------
  ptyInput.length = 0;
  await g("softEnter");
  await sleep(200);
  check("M7: soft Enter = one CR", ptyInput.join("") === "\r", JSON.stringify(ptyInput));

  // --- M8. arrows still flow through xterm ---------------------------------
  ptyInput.length = 0;
  await g("hardKey", "ArrowUp", 38);
  await sleep(200);
  check("M8: ArrowUp = one CSI A", ptyInput.join("") === "\x1b[A", JSON.stringify(ptyInput));

  // --- M9. GBoard clipboard chip: text lands once, newlines become CR ------
  ptyInput.length = 0;
  await g("pasteChip", "alpha\nbeta");
  await sleep(200);
  check("M9: paste chip once, LF→CR", ptyInput.join("") === "alpha\rbeta",
    JSON.stringify(ptyInput));

  // --- M10. double letters are not eaten -----------------------------------
  ptyInput.length = 0;
  await g("type", " aa");
  await sleep(300);
  check("M10: 'aa' stays 'aa'", applied(ptyInput) === " aa", JSON.stringify(ptyInput));

  // ═══ layout toggle ═══
  await page.goto(`${BASE}/`);
  const newBtn = page.locator('[aria-label="New session"]');
  await newBtn.waitFor({ timeout: 10000 }).catch(() => {});
  check("V1: mobile boots into the focus view (wall + new-session button)",
    await newBtn.isVisible().catch(() => false));

  const wallCard = page.locator("text=proof").first();
  await wallCard.waitFor({ timeout: 10000 }).catch(() => {});
  check("V2: the session wall lists the live session",
    await wallCard.isVisible().catch(() => false));

  await page.click('[aria-label="Switch to canvas"]');
  const canvas = page.locator(".canvas-flow");
  await canvas.waitFor({ timeout: 10000 }).catch(() => {});
  check("V3: TopBar toggle swaps to the canvas", await canvas.isVisible().catch(() => false));

  await page.click('[aria-label="Switch to focus view"]');
  await newBtn.waitFor({ timeout: 10000 }).catch(() => {});
  check("V4: toggle swaps back to the focus view", await newBtn.isVisible().catch(() => false));

  await page.click("text=proof");
  const term = page.locator(".terminal-container");
  await term.waitFor({ timeout: 10000 }).catch(() => {});
  check("V5: tapping a wall card opens the full-screen terminal",
    await term.isVisible().catch(() => false));

  await page.click('[aria-label="Back"]');
  await newBtn.waitFor({ timeout: 10000 }).catch(() => {});
  check("V6: back returns to the wall", await newBtn.isVisible().catch(() => false));

  await ctx.close();
}

// ═══════════════════════════ fine-pointer context ═════════════════════════
// Fine pointer: the takeover must stay dark; xterm's pipeline + the ghost
// filter keep desktop behavior byte-identical. A narrow viewport routes the
// app to the focus view so the terminal mounts without a canvas — the input
// pipeline under test is decided by the POINTER, not the layout.
{
  const ctx = await browser.newContext({ viewport: { width: 600, height: 800 } });
  const page = await ctx.newPage();
  const ptyInput = [];
  await rig(page, ptyInput);

  await page.goto(`${BASE}/#/session/s1`);
  await page.waitForSelector(".xterm textarea", { timeout: 15000 });
  await page.click(".terminal-container");
  await sleep(300);

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

  // --- D0. double Ctrl+V before any composition passes ----------------------
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  await page.evaluate(() => navigator.clipboard.writeText("PASTE-X"));
  ptyInput.length = 0;
  await page.keyboard.press("Control+v");
  await sleep(100);
  await page.keyboard.press("Control+v");
  await sleep(400);
  check("D0: a deliberate double paste (desktop) = 2 sends", count("PASTE-X") === 2,
    `got ${count("PASTE-X")}x`);

  // --- D1. desktop IME chunk arrives exactly once ---------------------------
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

  // --- D3. repeated desktop keystrokes are never filtered -------------------
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

  await ctx.close();
}

await browser.close();
console.log(results.every(Boolean) ? "\nALL GREEN" : "\nFAILURES");
process.exit(results.every(Boolean) ? 0 : 1);
