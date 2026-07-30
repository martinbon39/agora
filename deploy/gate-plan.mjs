// The shared plan — node deploy/gate-plan.mjs
//
// A project board is prose and append-only. It can say "I am starting on the
// parser", but it cannot make that exclusive, and the failure it therefore does
// not prevent is the expensive one: two agents independently building
// overlapping mechanisms for the same job, invisible until both are finished.
//
// So the property under test is not "tasks can be listed". It is that a task has
// exactly ONE holder, that taking one is atomic, and that a session can only act
// as itself here — the plan is worthless if an agent can release someone else's
// work or claim on their behalf.
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agora-plan-"));
process.env.AGORA_DATA_DIR = path.join(tmp, "data");
process.env.AGORA_PROJECTS_DIR = path.join(tmp, "projects");
process.env.AGORA_ALLOWED_EMAIL = "owner@example.com";

const { initDb, sessions, projects, plan } = await import("../server/dist/db.js");
const db = initDb();
const { initAuthDb, requireAuth, issueSessionFor } = await import("../server/dist/auth.js");
initAuthDb(db);
const { planRoutes } = await import("../server/dist/routes/plan.js");

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const P = path.join(tmp, "projects", "shared");
const OTHER = path.join(tmp, "projects", "elsewhere");
fs.mkdirSync(P, { recursive: true });
fs.mkdirSync(OTHER, { recursive: true });
projects.insert({ path: P, name: "shared", owner_email: "owner@example.com" });
projects.insert({ path: OTHER, name: "elsewhere", owner_email: "owner@example.com" });

const mk = (id, name, project) => {
  sessions.insert({
    id,
    name,
    project_path: project,
    harness: "claude",
    command: "claude",
    status: "running",
    agent_state: "idle",
    created_at: Date.now(),
    last_activity: Date.now(),
  });
  return sessions.get(id).hook_token;
};
// A and B share a project — nothing below is caught by tenant scoping. C is
// elsewhere, and exists to prove the plan does not leak across projects.
const tokenA = mk("s-a", "athena", P);
const tokenB = mk("s-b", "hermes", P);
const tokenC = mk("s-c", "charon", OTHER);

const app = Fastify();
await app.register(cookie);
app.get("/test-login/owner", async (_req, reply) => {
  issueSessionFor(reply);
  return { ok: true };
});
requireAuth(app);
await app.register(planRoutes);
const login = await app.inject({ method: "GET", url: "/test-login/owner" });
const ownerCookie = login.cookies.find((c) => c.name === "agora_session").value;

const act = (token, payload) =>
  app.inject({
    method: "POST",
    url: "/api/hooks/plan",
    headers: { "x-agora-hook": token },
    payload,
  });
const list = async (token) => {
  const res = await app.inject({
    method: "GET",
    url: "/api/hooks/plan",
    headers: { "x-agora-hook": token },
  });
  return JSON.parse(res.body).tasks;
};

// ---- adding ------------------------------------------------------------
const added = await act(tokenA, { action: "add", title: "write the parser" });
check("an agent can add a task", added.statusCode === 200, `${added.statusCode}`);
const T = JSON.parse(added.body).task.id;
await act(tokenA, { action: "add", title: "write the docs" });
check("and both sessions in the project see it", (await list(tokenB)).length === 2);
check(
  "REFUSED: a session in another project sees none of it",
  (await list(tokenC)).length === 0,
  `charon saw ${(await list(tokenC)).length}`
);

// ---- the property this table exists for -------------------------------
const claimA = await act(tokenA, { action: "claim", id: T });
check(
  "the first claim succeeds and names its holder — the positive control",
  claimA.statusCode === 200 && JSON.parse(claimA.body).task.claimed_by === "s-a",
  `${claimA.statusCode}`
);
const claimB = await act(tokenB, { action: "claim", id: T });
check(
  "REFUSED: a second agent cannot take a held task — this is the whole point",
  claimB.statusCode === 409,
  `got ${claimB.statusCode} ${claimB.body.slice(0, 90)}`
);
check(
  "REFUSED: and the refusal says who holds it, so the other agent can pick something else",
  /athena/.test(claimB.body),
  claimB.body.slice(0, 120)
);
check(
  "the holder may re-claim its own task — a retry after a dropped connection is not an error",
  (await act(tokenA, { action: "claim", id: T })).statusCode === 200
);
check(
  "REFUSED: and that did not quietly transfer it",
  plan.get(T).claimed_by === "s-a"
);

// ---- only the holder may resolve it -----------------------------------
check(
  "REFUSED: a non-holder cannot mark it done",
  (await act(tokenB, { action: "done", id: T })).statusCode === 409
);
check(
  "REFUSED: nor release it — otherwise any agent could free another's work",
  (await act(tokenB, { action: "drop", id: T })).statusCode === 409
);
check("REFUSED: nor block it", (await act(tokenB, { action: "block", id: T, note: "x" })).statusCode === 409);
check("REFUSED: and it is still held by its owner", plan.get(T).status === "claimed");

// ---- blocking hands work over ----------------------------------------
const blocked = await act(tokenA, { action: "block", id: T, note: "needs the schema first" });
check(
  "the holder can say it is stuck, with a reason",
  blocked.statusCode === 200 && plan.get(T).note === "needs the schema first"
);
check(
  "REFUSED: blocking without a reason — a blocked task nobody explained is worse than an open one",
  (await act(tokenA, { action: "block", id: T })).statusCode === 400
);
const takeover = await act(tokenB, { action: "claim", id: T });
check(
  "a BLOCKED task can be taken over — that is what distinguishes it from abandoned",
  takeover.statusCode === 200 && plan.get(T).claimed_by === "s-b",
  `${takeover.statusCode}`
);
check("and taking it over clears the stale reason", plan.get(T).note === null);

// ---- finishing --------------------------------------------------------
check("the new holder can finish it", (await act(tokenB, { action: "done", id: T })).statusCode === 200);
check(
  "REFUSED: a finished task cannot be re-claimed — done is not a resting state to grab from",
  (await act(tokenA, { action: "claim", id: T })).statusCode === 409,
  plan.get(T).status
);

// ---- acting as yourself ----------------------------------------------
// The token decides. A session naming another one in the body must not borrow it.
const t2 = JSON.parse((await act(tokenA, { action: "add", title: "second" })).body).task.id;
await act(tokenB, { action: "claim", id: t2 });
const forged = await act(tokenA, { action: "drop", id: t2, session: "s-b" });
check(
  "REFUSED: A claiming to be B cannot release B's task",
  forged.statusCode === 409 && plan.get(t2).claimed_by === "s-b",
  `got ${forged.statusCode}, holder ${plan.get(t2).claimed_by}`
);

// ---- cross-project ---------------------------------------------------
check(
  "REFUSED: a session elsewhere cannot claim this project's task, and is told it is unknown rather than forbidden",
  (await act(tokenC, { action: "claim", id: t2 })).statusCode === 404
);
check("REFUSED: and the holder is unchanged", plan.get(t2).claimed_by === "s-b");

// ---- the human sees the same list -----------------------------------
const dash = await app.inject({
  method: "GET",
  url: `/api/plan?project=${encodeURIComponent(P)}`,
  cookies: { agora_session: ownerCookie },
});
check(
  "the dashboard reads the same plan the agents do — one object, not two",
  dash.statusCode === 200 && JSON.parse(dash.body).tasks.length === plan.list(P).length,
  `${dash.statusCode}`
);
const dashOther = await app.inject({
  method: "GET",
  url: `/api/plan?project=${encodeURIComponent(path.join(tmp, "projects", "not-a-project"))}`,
  cookies: { agora_session: ownerCookie },
});
check(
  "REFUSED: and an unregistered project has no plan to read",
  dashOther.statusCode === 403,
  `${dashOther.statusCode}`
);

// ---- the handoff outlives the session that wrote it --------------------
// `agora send` needs a live, linked recipient. What a holder learned has to
// reach whoever picks the work up next — who usually does not exist yet — so it
// lives on the TASK, not on the channel.
const H = JSON.parse((await act(tokenA, { action: "add", title: "port the parser" })).body).task.id;
await act(tokenA, { action: "claim", id: H });
await act(tokenA, { action: "done", id: H, note: "the lexer tests are the slow part; run them alone" });
check(
  "finishing a task can leave a note behind",
  plan.get(H).note === "the lexer tests are the slow part; run them alone",
  String(plan.get(H).note)
);
check("REFUSED: and the task is genuinely done, not reopened by the note", plan.get(H).status === "done");

const H2 = JSON.parse((await act(tokenA, { action: "add", title: "port the emitter" })).body).task.id;
await act(tokenA, { action: "claim", id: H2 });
await act(tokenA, { action: "block", id: H2, note: "waiting on the schema" });
const takeover2 = await act(tokenB, { action: "claim", id: H2 });
check(
  "claiming a task hands the previous holder's note to the new one",
  JSON.parse(takeover2.body).inherited === "waiting on the schema",
  JSON.parse(takeover2.body).inherited
);
check(
  "REFUSED: and it is cleared afterwards, so a stale reason cannot be read as current",
  plan.get(H2).note === null,
  String(plan.get(H2).note)
);
const fresh = JSON.parse((await act(tokenA, { action: "add", title: "nothing inherited" })).body).task.id;
check(
  "a task nobody has held hands over nothing — the positive control",
  JSON.parse((await act(tokenA, { action: "claim", id: fresh })).body).inherited === null
);
const refused = await act(tokenB, { action: "claim", id: fresh });
check(
  "REFUSED: a refused claim hands over nothing either — it would leak the note to a non-holder",
  refused.statusCode === 409 && JSON.parse(refused.body).inherited === undefined,
  `${refused.statusCode}`
);

// ---- atomicity, for real ----------------------------------------------
// Everything above is SEQUENTIAL, so it proves exclusivity and not atomicity: a
// naive read-then-write would pass all of it, because by the time the second
// claim runs the first has already committed. The race needs genuine
// concurrency, and better-sqlite3 is synchronous, so one process cannot
// interleave with itself — this forks real ones.
const raceTask = plan.add(P, "everyone wants this one");
const child = path.join(tmp, "claimer.mjs");
// The children must actually overlap. An earlier version just spawned eight and
// hoped: node takes ~100ms to start, which staggered them well past any race
// window, and a deliberately NON-ATOMIC claim passed this test 25/25. So they
// synchronise on a wall-clock barrier and spin until it, then claim.
fs.writeFileSync(
  child,
  [
    `const { initDb, plan } = await import(${JSON.stringify(path.resolve("server/dist/db.js"))});`,
    `initDb();`,
    `const startAt = Number(process.argv[3]);`,
    `while (Date.now() < startAt) {}`,
    `const ok = plan.claim(${raceTask.id}, process.argv[2], process.argv[2]);`,
    `console.log(ok ? "WON" : "lost");`,
  ].join("\n") + "\n"
);
const { execFile } = await import("node:child_process");
const startAt = Date.now() + 1500; // comfortably past eight node startups
const runChild = (who) =>
  new Promise((resolve) => {
    execFile(process.execPath, [child, who, String(startAt)], (err, stdout) =>
      resolve((stdout || "").trim() || `error:${err?.code}`)
    );
  });
const contenders = ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"];
const outcomes = await Promise.all(contenders.map(runChild));
const winners = outcomes.filter((o) => o === "WON").length;
check(
  "exactly one of eight processes claiming at the same instant wins",
  winners === 1,
  `${winners} winners: ${outcomes.join(",")}`
);
check(
  "and the row agrees with whoever won",
  contenders.includes(String(plan.get(raceTask.id).claimed_by)),
  String(plan.get(raceTask.id).claimed_by)
);

await app.close();
fs.rmSync(tmp, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} pass`);
process.exit(failed ? 1 : 0);
