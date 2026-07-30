/**
 * What a session has cost, derived from Claude Code's own transcript.
 *
 * Two decisions worth stating, because the obvious implementations are both
 * wrong in ways that are hard to notice:
 *
 * 1. DERIVED, NOT ACCUMULATED. Upstream shipped a `total_cost` column and a
 *    `sessions.addCost()` accessor, and nothing ever called them — so the
 *    column read 0 forever. Filling it in by incrementing on each hook event
 *    would have been worse than empty: a replayed hook, a revived session or a
 *    restart mid-turn double-counts, and there is no way to tell a wrong total
 *    from a right one after the fact. The transcript is the ledger; summing it
 *    is idempotent and can be recomputed from scratch at any time.
 *
 * 2. AN UNKNOWN MODEL IS REPORTED, NOT GUESSED. A price table goes stale, and a
 *    number priced at a guessed rate looks exactly as authoritative as a correct
 *    one. Unpriced tokens are counted separately and surfaced, so the answer is
 *    "$4.10 plus 12k tokens on a model I have no price for" rather than a
 *    confident wrong total.
 */
import fs from "node:fs";

/**
 * USD per million tokens. Source: the bundled Anthropic pricing reference,
 * cached 2026-06-24 — not from memory, and not to be edited from memory either.
 *
 * Cache multipliers are applied to the INPUT rate, per the same reference:
 *   read           0.1×   (a hit is the cheap path, by an order of magnitude)
 *   write, 5m TTL  1.25×
 *   write, 1h TTL  2×
 *
 * The 5m/1h distinction is why the two are summed separately: a transcript's
 * `cache_creation` object splits them, and pricing the total at a single rate is
 * wrong in whichever direction you pick — everything at 2× overcharges a
 * 5m-heavy session by 60%, everything at 1.25× undercharges a 1h-heavy one by
 * 37.5%. Real sessions here carry both fields, so there is no reason to guess.
 */
const CACHE_READ = 0.1;
const CACHE_WRITE_5M = 1.25;
const CACHE_WRITE_1H = 2;

interface Price {
  input: number;
  output: number;
}

const PRICES: Record<string, Price> = {
  "claude-fable-5": { input: 10, output: 50 },
  "claude-mythos-5": { input: 10, output: 50 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-opus-4-5": { input: 5, output: 25 },
  // Sonnet 5 carries an introductory rate through 2026-08-31 ($2/$10). The
  // standard rate is used here on purpose: a bill that comes in under the
  // estimate is a good surprise, and the intro price expires on a date this
  // table will outlive.
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-sonnet-4-5": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

/** Fast mode is the same model at a different price, and the transcript says
 *  which one ran in `usage.speed`. Opus 5 only. */
const FAST_PRICES: Record<string, Price> = {
  "claude-opus-5": { input: 10, output: 50 },
  "claude-opus-4-8": { input: 10, output: 50 },
};

export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  };
  speed?: string;
}

export interface CostBreakdown {
  usd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Tokens on a model with no entry in the table — excluded from `usd`. */
  unpricedTokens: number;
  /** Which models those were, so the table can be updated deliberately. */
  unpricedModels: string[];
}

const empty = (): CostBreakdown => ({
  usd: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  unpricedTokens: 0,
  unpricedModels: [],
});

function priceFor(model: string, usage: Usage): Price | null {
  if (usage.speed === "fast" && FAST_PRICES[model]) return FAST_PRICES[model];
  return PRICES[model] ?? null;
}

/** One assistant message's cost. */
export function costOf(model: string, usage: Usage): CostBreakdown {
  const out = empty();
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const read = usage.cache_read_input_tokens ?? 0;
  // Prefer the split. Without it, charge the total at the 5m rate — not as a
  // conservative choice but because 5m is the API's default TTL, so it is the
  // correct assumption for a payload that never mentioned an hour.
  const w5 = usage.cache_creation?.ephemeral_5m_input_tokens;
  const w1 = usage.cache_creation?.ephemeral_1h_input_tokens;
  const split = w5 !== undefined || w1 !== undefined;
  const write5 = split ? (w5 ?? 0) : (usage.cache_creation_input_tokens ?? 0);
  const write1 = split ? (w1 ?? 0) : 0;

  out.inputTokens = input;
  out.outputTokens = output;
  out.cacheReadTokens = read;
  out.cacheWriteTokens = write5 + write1;

  const price = priceFor(model, usage);
  if (!price) {
    out.unpricedTokens = input + output + read + write5 + write1;
    if (model) out.unpricedModels = [model];
    return out;
  }
  const perToken = price.input / 1_000_000;
  out.usd =
    input * perToken +
    output * (price.output / 1_000_000) +
    read * perToken * CACHE_READ +
    write5 * perToken * CACHE_WRITE_5M +
    write1 * perToken * CACHE_WRITE_1H;
  return out;
}

function merge(a: CostBreakdown, b: CostBreakdown): CostBreakdown {
  return {
    usd: a.usd + b.usd,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    unpricedTokens: a.unpricedTokens + b.unpricedTokens,
    unpricedModels: [...new Set([...a.unpricedModels, ...b.unpricedModels])],
  };
}

/**
 * Sum a Claude Code transcript, once per API response.
 *
 * ONE RESPONSE, ONE BILL — and the transcript does not make that easy. Claude
 * Code writes one JSONL line per CONTENT BLOCK, and every line of a multi-block
 * response repeats the same `usage` object verbatim under the same
 * `message.id`. On a real session here, 140 of 220 responses spanned multiple
 * lines, up to four each, so summing lines inflated the total by roughly 2×.
 * Nothing about the shape hints at it: the lines have distinct uuids, and the
 * arithmetic looks perfect right up until you check it against the message ids.
 * So dedupe on `message.id` and count each response exactly once.
 *
 * Also skips `<synthetic>` — the model Claude Code names for messages it
 * produced locally rather than billing for. Pricing those invents spend.
 */
export function costOfTranscript(file: string): CostBreakdown {
  let total = empty();
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return total;
  }
  const counted = new Set<string>();
  let anonymous = 0;
  for (const line of text.split("\n")) {
    if (!line) continue;
    let ev: { message?: { id?: string; model?: string; usage?: Usage } };
    try {
      ev = JSON.parse(line);
    } catch {
      continue; // a half-written last line is normal on a live session
    }
    const msg = ev.message;
    if (!msg?.usage) continue;
    const model = msg.model ?? "";
    if (!model || model === "<synthetic>") continue;
    // No id means nothing to dedupe against; key it uniquely so it still counts
    // rather than being silently collapsed into a previous response.
    const key = msg.id ?? `anon-${anonymous++}`;
    if (counted.has(key)) continue;
    counted.add(key);
    total = merge(total, costOf(model, msg.usage));
  }
  return total;
}

export function sumCosts(all: CostBreakdown[]): CostBreakdown {
  return all.reduce(merge, empty());
}
