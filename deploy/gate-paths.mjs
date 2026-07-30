// Path-containment gate — node deploy/gate-paths.mjs (build the server first).
//
// agora gives each tenant its own directory root, which promotes a cosmetic
// string check into a tenant boundary. This gate pins the boundary.
//
// The bug it exists for: three call sites compared with `root + path.sep` and
// one compared with the bare root, so "/srv/projects-evil" tested as inside
// "/srv/projects". Harmless when one person owns the box. With per-tenant
// roots, `workspaces/alice-bob` reads as inside `workspaces/alice`.
//
// Every refusal below is paired with the case that must still be ALLOWED —
// a containment check that refuses everything would otherwise score perfect.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agora-paths-"));
process.env.AGORA_DATA_DIR = path.join(tmp, "data");
process.env.AGORA_PROJECTS_DIR = path.join(tmp, "projects");
// A PASSING run never reaches tmux: every request below is refused with 400
// before spawnSession. A run against BROKEN code does spawn for real — which is
// how this gate's own failure-verification left two live sessions on the shared
// socket, one of them in $HOME. So it takes a socket of its own and kills it on
// the way out. (This box carries ~30 abandoned argos-gate-* sockets from gates
// that did the first half and skipped the second.)
const GATE_SOCKET = `agora-gate-paths-${process.pid}`;
process.env.AGORA_TMUX_SOCKET = GATE_SOCKET;

const ROOT = path.join(tmp, "projects");
const EVIL = path.join(tmp, "projects-evil"); // sibling sharing the root's prefix
const INSIDE = path.join(ROOT, "alpha");
const OUTSIDE = path.join(tmp, "outside");
fs.mkdirSync(INSIDE, { recursive: true });
fs.mkdirSync(EVIL, { recursive: true });
fs.mkdirSync(OUTSIDE, { recursive: true });
fs.writeFileSync(path.join(OUTSIDE, "secret.txt"), "not yours");
fs.writeFileSync(path.join(INSIDE, "ok.txt"), "yours");

// a symlink planted inside the root, pointing out of it — agents write files
// in these directories, so this is the realistic escape, not `..`
fs.symlinkSync(path.join(OUTSIDE, "secret.txt"), path.join(INSIDE, "innocent.txt"));

// a root that is ITSELF a symlink: the naive fix for the symlink case
// (realpath the target, compare to the literal root) breaks this
const LINKED_ROOT = path.join(tmp, "linked-root");
fs.symlinkSync(ROOT, LINKED_ROOT);

const { withinRoot, withinRootReal } = await import("../server/dist/paths.js");

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

// ---- withinRoot: the textual boundary ------------------------------------
check(
  "the root itself is inside itself — the positive control the sibling test needs",
  withinRoot(ROOT, ROOT)
);
check("a child is inside", withinRoot(ROOT, INSIDE));
check("a deep child is inside", withinRoot(ROOT, path.join(INSIDE, "a", "b", "c.txt")));

check(
  "REFUSED: a sibling sharing the root's prefix — projects-evil is NOT inside projects",
  !withinRoot(ROOT, EVIL),
  "this is the bug the gate exists for"
);
check(
  "REFUSED: and a path under that sibling either",
  !withinRoot(ROOT, path.join(EVIL, "x.txt"))
);
check("REFUSED: `..` climbs out", !withinRoot(ROOT, path.join(ROOT, "..", "outside")));
check("REFUSED: an unrelated absolute path", !withinRoot(ROOT, "/etc/passwd"));
check(
  "REFUSED: the parent of the root is not inside the root",
  !withinRoot(ROOT, tmp)
);

// per-tenant roots: the case the whole exercise is for
const ALICE = path.join(ROOT, "alice");
const ALICE_BOB = path.join(ROOT, "alice-bob");
fs.mkdirSync(ALICE, { recursive: true });
fs.mkdirSync(ALICE_BOB, { recursive: true });
check("alice's own file is inside alice", withinRoot(ALICE, path.join(ALICE, "f.txt")));
check(
  "REFUSED: tenant alice-bob does not sit inside tenant alice",
  !withinRoot(ALICE, ALICE_BOB),
  "the tenant boundary"
);

// ---- withinRootReal: the symlink boundary --------------------------------
const planted = path.join(INSIDE, "innocent.txt");
check(
  "the textual check ALLOWS the planted symlink — proving the second layer is not redundant",
  withinRoot(INSIDE, planted)
);
check(
  "REFUSED: withinRootReal follows it out and says no",
  !withinRootReal(INSIDE, planted),
  "statSync/readSync would have followed it off the box"
);
check(
  "a real file inside is still allowed by withinRootReal — not a blanket refusal",
  withinRootReal(INSIDE, path.join(INSIDE, "ok.txt"))
);
check(
  "a symlinked ROOT contains children expressed through it — resolving only the target and comparing to the literal root would refuse this",
  withinRootReal(LINKED_ROOT, path.join(LINKED_ROOT, "alpha", "ok.txt"))
);
check(
  "REFUSED: but the same file named through the REAL root is not 'under' the symlinked root — the textual layer runs first and is not a normalizer",
  !withinRootReal(LINKED_ROOT, path.join(ROOT, "alpha", "ok.txt"))
);
check(
  "REFUSED: a path that does not exist cannot be judged contained",
  !withinRootReal(INSIDE, path.join(INSIDE, "nope.txt"))
);

// ---- the route that had the bug ------------------------------------------
// POST /api/sessions validates cwd BEFORE it ever reaches tmux, so this stays
// hermetic. The positive control is the SECOND error message: a path that
// passes containment fails later on "directory not found", which proves the
// containment check let it through rather than refusing everything.
const Fastify = (await import("fastify")).default;
const cookie = (await import("@fastify/cookie")).default;
const { initDb } = await import("../server/dist/db.js");
const db = initDb();
const { initAuthDb, issueSessionFor, requireAuth } = await import("../server/dist/auth.js");
initAuthDb(db);
const { sessionRoutes } = await import("../server/dist/routes/sessions.js");

const app = Fastify();
await app.register(cookie);
// test-only login on a path requireAuth leaves public (same shape as gate-scope)
app.get("/test-login/owner", async (_req, reply) => {
  issueSessionFor(reply);
  return { ok: true };
});
requireAuth(app);
await app.register(sessionRoutes);
const login = await app.inject({ method: "GET", url: "/test-login/owner" });
const token = login.cookies.find((c) => c.name === "agora_session").value;

const post = (projectPath) =>
  app.inject({
    method: "POST",
    url: "/api/sessions",
    cookies: { agora_session: token },
    payload: { harness: "shell", projectPath },
  });

const escaped = await post("../projects-evil");
check(
  "REFUSED: POST /api/sessions cannot start a session in the prefix-sharing sibling",
  escaped.statusCode === 400 && /stay under the projects dir/.test(escaped.body),
  `got ${escaped.statusCode} ${escaped.body.slice(0, 90)}`
);

const climbed = await post("../../outside");
check(
  "REFUSED: nor anywhere reached by climbing out",
  climbed.statusCode === 400 && /stay under the projects dir/.test(climbed.body),
  `got ${climbed.statusCode}`
);

const home = await post(path.relative(ROOT, os.homedir()));
check(
  "REFUSED: nor the home directory — argos allowed this explicitly, a shared box must not",
  home.statusCode === 400 && /stay under the projects dir/.test(home.body),
  `got ${home.statusCode} ${home.body.slice(0, 90)}`
);

const missing = await post("does-not-exist-yet");
check(
  "ALLOWED past containment: a legitimate path fails later on 'directory not found'",
  missing.statusCode === 400 && /directory not found/.test(missing.body),
  "the positive control — without it, a check that refuses everything would pass"
);

await app.close();
fs.rmSync(tmp, { recursive: true, force: true });
// leave no tmux server behind, even if a broken run spawned one
spawnSync("tmux", ["-L", GATE_SOCKET, "kill-server"], { stdio: "ignore" });
// kill-server stops the server but leaves the socket FILE in /tmp/tmux-<uid>/.
// Harmless, but it is where the ~30 stale argos-gate-* entries on the reference
// box come from, so unlink it too.
fs.rmSync(path.join(os.tmpdir(), `tmux-${process.getuid()}`, GATE_SOCKET), { force: true });

const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} pass`);
process.exit(failed ? 1 : 0);
