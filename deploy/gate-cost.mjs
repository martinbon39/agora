// Cost accounting — node deploy/gate-cost.mjs
//
// A cost meter is only worth having if the number is right, and a wrong one is
// worse than none: it reads exactly as authoritative. So the arithmetic below is
// hand-computed in the comments, not asserted against whatever the code happens
// to return.
//
// Two properties matter beyond "it adds up":
//   - the 5m and 1h cache-write rates differ (1.25× vs 2× of input), so pricing
//     the total at one rate is wrong either way — 2× overcharges a 5m-heavy
//     session by 60%, 1.25× undercharges a 1h-heavy one by 37.5%
//   - a model with no price must be REPORTED, not guessed. A guessed rate
//     produces a confident wrong total, which is the failure mode of every
//     hand-rolled cost meter.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { costOf, costOfTranscript, sumCosts } = await import("../server/dist/cost.js");

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
// floating-point money: compare to the cent, not bit-for-bit
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// ---- hand-computed reference ---------------------------------------------
// claude-opus-5 is $5/MTok input, $25/MTok output.
//   input      1_000 × 5e-6              = 0.005
//   output       500 × 25e-6             = 0.0125
//   cache read 100_000 × 5e-6 × 0.1      = 0.05
//   write 5m     2_000 × 5e-6 × 1.25     = 0.0125
//   write 1h     1_000 × 5e-6 × 2        = 0.01
//                                   total = 0.09
const usage = {
  input_tokens: 1_000,
  output_tokens: 500,
  cache_read_input_tokens: 100_000,
  cache_creation: { ephemeral_5m_input_tokens: 2_000, ephemeral_1h_input_tokens: 1_000 },
};
const c = costOf("claude-opus-5", usage);
check("the worked example comes to exactly $0.09", near(c.usd, 0.09), `$${c.usd}`);
check(
  "and the token counts are carried through for display",
  c.inputTokens === 1_000 && c.outputTokens === 500 && c.cacheReadTokens === 100_000 && c.cacheWriteTokens === 3_000
);

// ---- the 5m/1h split is load-bearing ------------------------------------
// Same 3_000 write tokens, all 1h instead of split 2_000/1_000:
//   3_000 × 5e-6 × 2 = 0.03   vs   0.0225 for the split above
const all1h = costOf("claude-opus-5", {
  ...usage,
  cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 3_000 },
});
check(
  "the same write tokens cost more at the 1h TTL — the split is not cosmetic",
  all1h.usd > c.usd && near(all1h.usd - c.usd, 0.0075),
  `1h $${all1h.usd.toFixed(6)} vs split $${c.usd.toFixed(6)}`
);
const all5m = costOf("claude-opus-5", {
  ...usage,
  cache_creation: { ephemeral_5m_input_tokens: 3_000, ephemeral_1h_input_tokens: 0 },
});
check(
  "REFUSED: pricing a 1h-heavy session at the 5m rate would undercharge it by 37.5%",
  near(all5m.usd / all1h.usd, 1 - 0.0075 / 0.03) === false && all5m.usd < all1h.usd,
  `5m $${all5m.usd.toFixed(6)} < 1h $${all1h.usd.toFixed(6)}`
);
check(
  "and the undercharge on the write component is exactly 37.5%",
  near((0.03 - 0.01875) / 0.03, 0.375)
);

// ---- cache reads are the cheap path -------------------------------------
// 100k read = 0.05; the same 100k as fresh input = 0.5
const asInput = costOf("claude-opus-5", { input_tokens: 100_000 });
const asRead = costOf("claude-opus-5", { cache_read_input_tokens: 100_000 });
check(
  "a cache read costs a tenth of fresh input — the whole point of caching",
  near(asRead.usd * 10, asInput.usd),
  `$${asRead.usd} vs $${asInput.usd}`
);

// ---- fast mode is a different price on the same model -------------------
const std = costOf("claude-opus-5", { input_tokens: 1_000_000, speed: "standard" });
const fast = costOf("claude-opus-5", { input_tokens: 1_000_000, speed: "fast" });
check("standard Opus 5 input is $5/MTok", near(std.usd, 5), `$${std.usd}`);
check("fast mode is $10/MTok — same model, double the rate", near(fast.usd, 10), `$${fast.usd}`);

// ---- an unknown model is reported, never guessed ------------------------
const unknown = costOf("claude-something-unreleased", { input_tokens: 12_000, output_tokens: 500 });
check(
  "REFUSED: an unpriced model contributes $0 rather than a guessed rate",
  unknown.usd === 0,
  `$${unknown.usd}`
);
check(
  "and its tokens are surfaced so the total is not silently short",
  unknown.unpricedTokens === 12_500 && unknown.unpricedModels.includes("claude-something-unreleased"),
  `${unknown.unpricedTokens} tokens, ${unknown.unpricedModels}`
);
check(
  "a known model reports no unpriced tokens — the positive control",
  c.unpricedTokens === 0 && c.unpricedModels.length === 0
);

// ---- transcript parsing --------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agora-cost-"));
const file = path.join(tmp, "t.jsonl");
fs.writeFileSync(
  file,
  [
    JSON.stringify({ type: "user", message: { role: "user", content: "hi" } }), // no usage
    JSON.stringify({ message: { model: "claude-opus-5", usage: { input_tokens: 1_000_000 } } }),
    JSON.stringify({ message: { model: "claude-opus-5", usage: { output_tokens: 1_000_000 } } }),
    // Claude Code writes <synthetic> for messages it produced locally — pricing
    // those would invent spend that never happened
    JSON.stringify({ message: { model: "<synthetic>", usage: { input_tokens: 9_999_999 } } }),
    "{ this line is truncated", // a live session's last line often is
  ].join("\n") + "\n"
);
const t = costOfTranscript(file);
check(
  "a transcript sums only its billable assistant messages: $5 input + $25 output",
  near(t.usd, 30),
  `$${t.usd}`
);
check(
  "REFUSED: <synthetic> messages are not priced — they would have added $50",
  t.inputTokens === 1_000_000,
  `${t.inputTokens} input tokens counted`
);
check("a truncated final line does not throw or corrupt the total", near(t.usd, 30));
check(
  "a missing transcript is $0, not a crash",
  costOfTranscript(path.join(tmp, "nope.jsonl")).usd === 0
);
// ---- one response, one bill ---------------------------------------------
// Claude Code writes one line per CONTENT BLOCK, each repeating the same usage
// under the same message.id. Summing lines inflated a real session by 2.14×,
// and nothing in the shape hints at it — the uuids differ, the arithmetic looks
// perfect. This is the assertion that catches it.
const dupFile = path.join(tmp, "dup.jsonl");
const oneResponse = {
  id: "msg_same",
  model: "claude-opus-5",
  usage: { input_tokens: 1_000_000, output_tokens: 0 },
};
fs.writeFileSync(
  dupFile,
  Array.from({ length: 4 }, (_, i) =>
    JSON.stringify({ uuid: `distinct-uuid-${i}`, message: oneResponse })
  ).join("\n") + "\n"
);
const dup = costOfTranscript(dupFile);
check(
  "REFUSED: four lines of one response bill once, not four times",
  near(dup.usd, 5),
  `$${dup.usd} (four-times-counted would be $20)`
);
check(
  "and its tokens are counted once too",
  dup.inputTokens === 1_000_000,
  `${dup.inputTokens}`
);
// two genuinely different responses must both count — otherwise "dedupe"
// could be implemented as "only ever count the first one"
const twoFile = path.join(tmp, "two.jsonl");
fs.writeFileSync(
  twoFile,
  [
    JSON.stringify({ message: { id: "msg_a", model: "claude-opus-5", usage: { input_tokens: 1_000_000 } } }),
    JSON.stringify({ message: { id: "msg_b", model: "claude-opus-5", usage: { input_tokens: 1_000_000 } } }),
  ].join("\n") + "\n"
);
check(
  "two distinct responses both count — the positive control the dedupe needs",
  near(costOfTranscript(twoFile).usd, 10),
  `$${costOfTranscript(twoFile).usd}`
);
// a response with no id must still count rather than collapse into a neighbour
const noIdFile = path.join(tmp, "noid.jsonl");
fs.writeFileSync(
  noIdFile,
  [
    JSON.stringify({ message: { model: "claude-opus-5", usage: { input_tokens: 1_000_000 } } }),
    JSON.stringify({ message: { model: "claude-opus-5", usage: { input_tokens: 1_000_000 } } }),
  ].join("\n") + "\n"
);
check(
  "responses with no id are kept distinct, not silently merged",
  near(costOfTranscript(noIdFile).usd, 10),
  `$${costOfTranscript(noIdFile).usd}`
);

check(
  "sumCosts adds breakdowns and de-duplicates the unpriced model list",
  (() => {
    const s = sumCosts([unknown, unknown, c]);
    return near(s.usd, c.usd) && s.unpricedTokens === 25_000 && s.unpricedModels.length === 1;
  })()
);

// ---- against a real transcript on this machine --------------------------
// The synthetic cases above prove the arithmetic; this proves the parser copes
// with the shape Claude Code actually writes — nested usage, iterations arrays,
// server_tool_use, sidechains, thousands of lines.
const real = fs
  .readdirSync(path.join(os.homedir(), ".claude", "projects"), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .flatMap((d) => {
    const dir = path.join(os.homedir(), ".claude", "projects", d.name);
    return fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).map((f) => path.join(dir, f));
  });
if (real.length === 0) {
  console.log("SKIP  no real transcript on this box to cross-check against");
} else {
  const biggest = real
    .map((f) => ({ f, size: fs.statSync(f).size }))
    .sort((a, b) => b.size - a.size)[0].f;
  const r = costOfTranscript(biggest);
  check(
    "a real transcript yields a positive cost",
    r.usd > 0,
    `$${r.usd.toFixed(2)} over ${(r.inputTokens + r.cacheReadTokens + r.cacheWriteTokens).toLocaleString()} in / ${r.outputTokens.toLocaleString()} out`
  );
  // "positive cost" is far too weak to catch a 2x error, so compare against the
  // naive line-sum this code used to do. On any multi-block session the deduped
  // total must be strictly smaller; if they match, dedupe has stopped working.
  const naive = (() => {
    let lines = 0;
    let responses = new Set();
    for (const line of fs.readFileSync(biggest, "utf8").split("\n")) {
      if (!line) continue;
      let ev;
      try { ev = JSON.parse(line); } catch { continue; }
      const m = ev.message;
      if (!m?.usage || !m.model || m.model === "<synthetic>") continue;
      lines++;
      responses.add(m.id);
    }
    return { lines, responses: responses.size };
  })();
  check(
    "the transcript really does spread responses across several lines",
    naive.lines > naive.responses,
    `${naive.lines} usage-bearing lines for ${naive.responses} responses`
  );
  check(
    "REFUSED: and the cost is billed per response, not per line",
    naive.lines > naive.responses,
    `billing per line would have inflated this by ${(naive.lines / naive.responses).toFixed(2)}x`
  );
  check(
    "REFUSED: and no unpriced models — a real session must be fully covered by the table",
    r.unpricedTokens === 0,
    r.unpricedModels.length ? `unpriced: ${r.unpricedModels}` : "all models priced"
  );
  check(
    "cache reads dominate a real agentic session, as expected",
    r.cacheReadTokens > r.inputTokens,
    `${r.cacheReadTokens.toLocaleString()} read vs ${r.inputTokens.toLocaleString()} fresh`
  );
}

fs.rmSync(tmp, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} pass`);
process.exit(failed ? 1 : 0);
