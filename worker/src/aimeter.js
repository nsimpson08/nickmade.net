// The AI meter (Nick, 2026-10-30: "we would need to be absolutely sure there wasn't a way it could balloon to $1000
// from some errant ai running nonstop"). Every Workers AI call in both Workers (this one and nickmade.net's, which has
// the same file) goes through aiRun(): it refuses when the AI is switched off (the Owner page's switch) or when today's
// or this month's total would pass its ceiling, and records what each call cost.
//
// The totals are in D1 (nickmade-golf, which both Workers have: GOLF_DB here, GOLF on the site) because D1 adds to a
// number in one step: each call reserves its units with INSERT ... ON CONFLICT DO UPDATE SET n = n + ? RETURNING n, so
// calls at the same moment are counted one after another and can't all slip under the ceiling. (A first version kept
// them in KV: 50 calls at once all got through, and the count even went down.) No meter, no AI: it fails closed.
//
// Units are Workers AI's "neurons" (10,000 a day free; past that $0.011 per 1,000 on Workers Paid). A call is reserved
// at GUESS (more than any of ours costs), then corrected to what Workers AI says it cost. Ceilings: DAY_MAX neurons and
// CALLS_MAX calls a UTC day (Workers AI's day), MONTH_MAX a month. Worst case past the free allowance: (30,000 - 10,000)
// x $0.011 / 1,000 = $0.22 a day, and the month's ceiling stops it before $7.
//
// Table ai_meter (period TEXT PRIMARY KEY, n REAL, calls INTEGER): rows "day:YYYY-MM-DD", "month:YYYY-MM",
// "by:YYYY-MM-DD:<label>" (who used what today), and "off" (n = 1 when switched off).

export const DAY_MAX = 30000;
export const CALLS_MAX = 600;
export const MONTH_MAX = 600000;
const GUESS = { vision: 4000, text: 600 }; // (reserved per call: more than any of ours costs, so calls at once can't pass the ceiling by much)

export class AIStopped extends Error {}
const db = (env) => env.GOLF_DB || env.GOLF;
const ids = () => { const t = new Date().toISOString(); return { day: "day:" + t.slice(0, 10), month: "month:" + t.slice(0, 7), by: "by:" + t.slice(0, 10) + ":" }; };
let ready = false;
async function setup(d) {
  if (ready) return;
  await d.prepare("CREATE TABLE IF NOT EXISTS ai_meter (period TEXT PRIMARY KEY, n REAL NOT NULL DEFAULT 0, calls INTEGER NOT NULL DEFAULT 0)").run();
  ready = true;
}
const ADD = "INSERT INTO ai_meter (period, n, calls) VALUES (?, ?, ?) ON CONFLICT(period) DO UPDATE SET n = n + excluded.n, calls = calls + excluded.calls RETURNING n, calls";

// the meter's state, for the Owner page
export async function aiState(env) {
  const d = db(env), p = ids();
  if (!d) return { off: true, day: { n: 0, calls: 0 }, month: { n: 0, calls: 0 }, max: { day: DAY_MAX, calls: CALLS_MAX, month: MONTH_MAX } };
  await setup(d);
  const rows = (await d.prepare("SELECT period, n, calls FROM ai_meter WHERE period IN (?, ?, 'off') OR period LIKE ?").bind(p.day, p.month, p.by + "%").all()).results || [];
  const get = (k) => rows.find((r) => r.period === k) || { n: 0, calls: 0 };
  const by = {};
  rows.filter((r) => r.period.startsWith(p.by)).forEach((r) => { by[r.period.slice(p.by.length)] = r.n; });
  return { off: get("off").n === 1, day: { n: get(p.day).n, calls: get(p.day).calls, by }, month: { n: get(p.month).n, calls: get(p.month).calls }, max: { day: DAY_MAX, calls: CALLS_MAX, month: MONTH_MAX } };
}
export async function aiSwitch(env, on) {
  const d = db(env);
  await setup(d);
  await d.prepare("INSERT INTO ai_meter (period, n, calls) VALUES ('off', ?, 0) ON CONFLICT(period) DO UPDATE SET n = excluded.n").bind(on ? 0 : 1).run();
  return aiState(env);
}

// env.AI.run, metered. label: who's asking ("scorecard", "food"...), so the Owner page can say who used what today.
export async function aiRun(env, model, input, label) {
  const d = db(env);
  if (!env.AI || !d) throw new AIStopped("The AI isn't set up.");
  await setup(d);
  const off = await d.prepare("SELECT n FROM ai_meter WHERE period = 'off'").first();
  if (off && off.n === 1) throw new AIStopped("The AI is switched off (Owner page).");
  const p = ids(), tag = String(label || "other").replace(/[^\w-]/g, "").slice(0, 30) || "other";
  const guess = GUESS[JSON.stringify(input.messages || []).includes("image_url") ? "vision" : "text"];
  // reserve it (one step each, in one batch), then refuse and give it back if that passed a ceiling
  const [day, month] = (await d.batch([d.prepare(ADD).bind(p.day, guess, 1), d.prepare(ADD).bind(p.month, guess, 1), d.prepare(ADD).bind(p.by + tag, guess, 1)])).map((r) => (r.results || [])[0] || {});
  if (!(day.n <= DAY_MAX) || !(day.calls <= CALLS_MAX) || !(month.n <= MONTH_MAX)) {
    await d.batch([d.prepare(ADD).bind(p.day, -guess, -1), d.prepare(ADD).bind(p.month, -guess, -1), d.prepare(ADD).bind(p.by + tag, -guess, -1)]);
    throw new AIStopped(month.n > MONTH_MAX ? "This month's AI allowance is used up." : "Today's AI allowance is used up.");
  }
  // (a call that fails keeps its reservation: counting too much is safe, too little isn't)
  const out = await env.AI.run(model, input);
  const real = out && out.usage && +out.usage.neurons;
  if (real > 0 && Math.abs(real - guess) > 0.5) {
    const diff = real - guess; // (what it really cost, in place of the guess)
    await d.batch([d.prepare(ADD).bind(p.day, diff, 0), d.prepare(ADD).bind(p.month, diff, 0), d.prepare(ADD).bind(p.by + tag, diff, 0)]).catch(() => {});
  }
  return out;
}
