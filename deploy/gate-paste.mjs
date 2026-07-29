// Paste gate — run from a dev machine: `npm run dev -w web` then `node deploy/gate-paste.mjs`
// (needs `npm i playwright` + `npx playwright install chromium` somewhere on PATH of node)
// Browser-level proof of the argos paste path.
// Drives the REAL frontend (vite dev, real TerminalView + real xterm) in a real
// Chromium, with the browser's actual clipboard and actual Ctrl+V keystrokes.
// The attach WebSocket is mocked in the test, so we capture exactly what the
// terminal would send to the pty (and therefore to Claude Code inside tmux).
import { chromium } from "playwright";

const BASE = "http://localhost:5173";
const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const SESSION = {
  id: "s1",
  name: "proof",
  project_path: "/home/orbit",
  harness: "shell",
  command: "bash",
  status: "running",
  agent_state: "idle",
  created_at: Date.now(),
  last_activity: Date.now(),
};

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms = 4000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await sleep(100);
  }
  return false;
};

const browser = await chromium.launch();
const context = await browser.newContext();
await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
const page = await context.newPage();

const ptyInput = []; // ce que le terminal envoie au pty ({t:"i",d:...})
const uploads = []; // captured POST /api/uploads calls

// --- network mocks (the real server runs on the VPS, not on the dev box) ---
await page.route("**/api/**", (r) => r.fulfill({ json: {} }));
await page.route("**/api/auth/me", (r) =>
  r.fulfill({ json: { authed: true, enrolled: true, google: false } })
);
await page.route("**/api/sessions", (r) => r.fulfill({ json: { sessions: [SESSION] } }));
await page.route("**/api/projects", (r) => r.fulfill({ json: { projects: [] } }));
await page.route("**/api/notifications", (r) =>
  r.fulfill({ json: { notifications: [], unread: 0 } })
);
await page.route("**/api/uploads/**", async (r) => {
  uploads.push(r.request().postDataJSON());
  await r.fulfill({
    json: { path: "/home/orbit/.orbit/uploads/s1/x.png", url: "/uploads/s1/x.png", pasteable: true },
  });
});
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

const setClipboard = (items) =>
  page.evaluate(async ({ items, PNG_1PX }) => {
    const reps = {};
    for (const [mime, val] of Object.entries(items)) {
      reps[mime] =
        mime === "image/png"
          ? new Blob([Uint8Array.from(atob(PNG_1PX), (c) => c.charCodeAt(0))], { type: mime })
          : new Blob([val], { type: mime });
    }
    await navigator.clipboard.write([new ClipboardItem(reps)]);
  }, { items, PNG_1PX });

const sentText = () => ptyInput.join("");
const CTRL_V = "\x16";

// --- A. Ctrl+V with TEXT in the clipboard ---------------------------------
await setClipboard({ "text/plain": "ORBIT-TEXTE-42" });
ptyInput.length = 0;
uploads.length = 0;
await page.keyboard.press("Control+v");
await waitFor(() => sentText().includes("ORBIT-TEXTE-42"));
check("A1: pasted text reaches the pty", sentText().includes("ORBIT-TEXTE-42"),
  JSON.stringify(sentText().slice(0, 60)));
check("A2: no literal \\x16 (Ctrl+V) is sent", !sentText().includes(CTRL_V),
  JSON.stringify(sentText().slice(0, 60)));
check("A3: no image is uploaded", uploads.length === 0, `${uploads.length} upload(s)`);

// --- B. Ctrl+V with an IMAGE alone (a screenshot) -------------------------
await setClipboard({ "image/png": true });
ptyInput.length = 0;
uploads.length = 0;
await page.keyboard.press("Control+v");
await waitFor(() => uploads.length > 0 && sentText().includes(CTRL_V));
check("B1: the image is uploaded to the server", uploads.length === 1, `${uploads.length} upload(s)`);
check("B2: \\x16 is sent AFTER the upload (so Claude Code ingests it)", sentText().includes(CTRL_V));
check("B3: no stray empty bracketed-paste", !sentText().includes("\x1b[200~"),
  JSON.stringify(sentText()));

// --- C. Ctrl+V with TEXT plus a stray bitmap (the Office/Windows case) ----
await setClipboard({ "text/plain": "TEXTE-PRIORITAIRE", "image/png": true });
ptyInput.length = 0;
uploads.length = 0;
await page.keyboard.press("Control+v");
await waitFor(() => sentText().includes("TEXTE-PRIORITAIRE"));
check("C1: text wins", sentText().includes("TEXTE-PRIORITAIRE"),
  JSON.stringify(sentText().slice(0, 60)));
check("C2: the stray bitmap is NOT uploaded", uploads.length === 0, `${uploads.length} upload(s)`);
check("C3: no \\x16 is sent", !sentText().includes(CTRL_V));

await browser.close();
console.log(results.every(Boolean) ? "\nALL GREEN" : "\nFAILURES");
process.exit(results.every(Boolean) ? 0 : 1);
