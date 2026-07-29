// Claude-account gate — node deploy/gate-accounts.mjs (build the server first).
//
// Two accounts, one machine. Claude Code keeps its identity in
// CLAUDE_CONFIG_DIR: `.credentials.json` for the tokens, `.claude.json` for who
// they belong to. Pointing that variable elsewhere gives another account —
// verified on 2.1.220 — but it moves EVERYTHING with it: CLAUDE.md, agents,
// skills, settings (hooks!), past transcripts. An agent launched in a bare
// config dir would lose the whole harness and answer as a stranger.
//
// So this gate pins both halves: the identity really is separate, and the
// harness really is shared. Plus the one that would cost real money — a
// terminal must sign in as ITS PROJECT'S account, including when it is revived
// or spawned by another agent.
//
// Hermetic: its own data dir and a fake ~/.claude, nothing real is touched.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "argos-accounts-"));
process.env.ARGOS_DATA_DIR = path.join(tmp, "data");
process.env.ARGOS_PROJECTS_DIR = path.join(tmp, "projects");

// a stand-in for the user's real ~/.claude, so the gate never reads or writes it
const HOME_CLAUDE = path.join(tmp, "home-claude");
fs.mkdirSync(path.join(HOME_CLAUDE, "agents"), { recursive: true });
fs.mkdirSync(path.join(HOME_CLAUDE, "projects", "some-project"), { recursive: true });
fs.writeFileSync(path.join(HOME_CLAUDE, "CLAUDE.md"), "# Martin's harness rules\n");
fs.writeFileSync(path.join(HOME_CLAUDE, "settings.json"), '{"hooks":{}}\n');
fs.writeFileSync(path.join(HOME_CLAUDE, "agents", "search-worker.md"), "worker\n");
fs.writeFileSync(path.join(HOME_CLAUDE, "projects", "some-project", "notes.md"), "memory\n");
fs.writeFileSync(path.join(HOME_CLAUDE, ".credentials.json"), '{"token":"PERSONAL"}');
fs.writeFileSync(
  path.join(HOME_CLAUDE, ".claude.json"),
  JSON.stringify({ oauthAccount: { emailAddress: "perso@example.com", organizationName: "Perso" } })
);
// accounts.ts reads CLAUDE_CONFIG_DIR as "the default account" when set
process.env.CLAUDE_CONFIG_DIR = HOME_CLAUDE;

const accounts = await import("../server/dist/accounts.js");
const { initDb, projectSettings } = await import("../server/dist/db.js");
initDb();

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

// --- the default account ---------------------------------------------------
let list = accounts.list();
check("the existing ~/.claude shows up as the default account", list[0]?.id === "", list[0]?.id);
check(
  "and is labelled with the address it is signed in as",
  list[0]?.email === "perso@example.com" && list[0]?.loggedIn === true,
  `${list[0]?.email} loggedIn=${list[0]?.loggedIn}`
);
check(
  "the default account sets no CLAUDE_CONFIG_DIR (it IS the default)",
  list[0]?.configDir === null
);

// --- a second account ------------------------------------------------------
const work = accounts.create("Work");
check("a second account gets its own config directory", !!work.configDir, work.configDir);
check("it starts signed out", work.loggedIn === false && work.email === null);

// THE point: the harness follows, the identity does not.
const inWork = (f) => path.join(work.configDir, f);
check(
  "the harness follows: CLAUDE.md, settings, agents and transcripts are shared",
  ["CLAUDE.md", "settings.json", "agents", "projects"].every(
    (f) => fs.existsSync(inWork(f)) && fs.readlinkSync(inWork(f)) === path.join(HOME_CLAUDE, f)
  ),
  "a bare config dir would strip the agent of every rule it works under"
);
check(
  "reading through the link really reaches the shared content",
  fs.readFileSync(inWork("CLAUDE.md"), "utf8").includes("harness rules") &&
    fs.readFileSync(path.join(inWork("projects"), "some-project", "notes.md"), "utf8") === "memory\n"
);
check(
  "the identity does NOT follow: credentials are not linked in",
  !fs.existsSync(inWork(".credentials.json")),
  "sharing them would defeat the entire feature"
);

// simulate signing in as the second account
fs.writeFileSync(inWork(".credentials.json"), '{"token":"WORK"}');
fs.writeFileSync(
  inWork(".claude.json"),
  JSON.stringify({ oauthAccount: { emailAddress: "martin@company.com", organizationName: "ACME" } })
);
list = accounts.list();
const workNow = list.find((a) => a.id === work.id);
check(
  "once signed in, the account reports the right address",
  workNow?.email === "martin@company.com" && workNow?.organization === "ACME",
  `${workNow?.email} / ${workNow?.organization}`
);
check(
  "and the default account is untouched by it",
  list[0].email === "perso@example.com" &&
    fs.readFileSync(path.join(HOME_CLAUDE, ".credentials.json"), "utf8").includes("PERSONAL"),
  "signing into one account must never overwrite the other's tokens"
);

// --- what a session is launched with ---------------------------------------
const PROJ_A = path.join(tmp, "projects", "alpha");
const PROJ_B = path.join(tmp, "projects", "beta");
projectSettings.setAccount(PROJ_A, work.id);
check(
  "a project set to an account resolves to that config dir",
  accounts.configDirFor(projectSettings.account(PROJ_A)) === work.configDir
);
check(
  "a project with no setting resolves to null — the default account",
  accounts.configDirFor(projectSettings.account(PROJ_B)) === null,
  "so argos leaves CLAUDE_CONFIG_DIR unset and Claude uses ~/.claude"
);
check(
  "an account that no longer exists falls back to the default, not to a broken dir",
  accounts.configDirFor("deleted-account") === null
);
projectSettings.setAccount(PROJ_A, null);
check("a project can be put back on the default", projectSettings.account(PROJ_A) === null);

// --- links are repaired, not assumed ---------------------------------------
fs.rmSync(inWork("agents"));
fs.mkdirSync(path.join(HOME_CLAUDE, "skills"), { recursive: true });
accounts.configDirFor(work.id);
check(
  "resolving an account repairs missing links and picks up new shared dirs",
  fs.existsSync(inWork("agents")) && fs.existsSync(inWork("skills")),
  "an account made before skills/ existed must still get it"
);

// --- removal ---------------------------------------------------------------
accounts.remove(work.id);
check("removing an account deletes its directory", !fs.existsSync(work.configDir));
check(
  "and does NOT follow its links into the real config",
  fs.readFileSync(path.join(HOME_CLAUDE, "CLAUDE.md"), "utf8").includes("harness rules") &&
    fs.existsSync(path.join(HOME_CLAUDE, "agents")) &&
    fs.existsSync(path.join(HOME_CLAUDE, "projects", "some-project", "notes.md")),
  "rm -rf through a symlinked projects/ would have eaten every transcript"
);
check(
  "the default account can never be removed",
  (() => {
    try {
      accounts.remove("");
      return false;
    } catch {
      return true;
    }
  })()
);

fs.rmSync(tmp, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} pass`);
process.exit(failed ? 1 : 0);
