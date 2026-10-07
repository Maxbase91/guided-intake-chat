// Vercel serverless function: keeps the LLM API keys on the server.
//
// Environment variables (Vercel > Project > Settings > Environment Variables):
//   GEMINI_API_KEY         Google AI Studio key
//   GROQ_API_KEY           Groq key
//   MISTRAL_API_KEY        Mistral key (free "Experiment" plan works; set any one or more)
//   LLM_PROVIDER           optional: "gemini", "groq" or "mistral" goes first (default order: Gemini, Groq, Mistral)
//   GEMINI_MODEL           optional, default "gemini-2.5-flash"
//   GEMINI_FALLBACK_MODEL  optional, default "gemini-2.5-flash-lite"
//   GROQ_MODEL             optional; if missing or unavailable, the best model the account can use is picked automatically
//   MISTRAL_MODEL          optional; default rotation mistral-medium-latest, mistral-small-latest, open-mistral-nemo
//   ACCESS_CODE            optional: callers must send it in the x-access-code header
//
// GET /api/llm             -> which providers are configured (no secrets)
// GET /api/llm?check=1     -> live check of every provider (needs the access code header or ?code=)

const MAX_MESSAGES = 60;
const MAX_CHARS = 80000;
const CALL_TIMEOUT_MS = 25000;          // per model call
const TOTAL_BUDGET_MS = 55000;          // stay inside the 60s function limit
const DEFAULT_COOLDOWN_S = 60;          // skip a limited model this long if the provider gives no time

// Preferred Groq models, best first. The first one the account can use is taken.
const GROQ_PREFERRED = [
  "openai/gpt-oss-120b",
  "moonshotai/kimi-k2-instruct-0905",
  "llama-3.3-70b-versatile",
  "meta-llama/llama-4-maverick-17b-128e-instruct",
  "moonshotai/kimi-k2-instruct",
  "qwen/qwen3-32b",
  "meta-llama/llama-4-scout-17b-16e-instruct",
  "openai/gpt-oss-20b",
  "llama-3.1-8b-instant",
];

// Mistral models, best first. Each has its own rate limit, so they rotate like Groq.
const MISTRAL_PREFERRED = ["mistral-medium-latest", "mistral-small-latest", "open-mistral-nemo"];

class LlmError extends Error { constructor(msg, status) { super(msg); this.status = status; } }
const isQuota = (e) => e && (e.status === 429 || /quota|rate limit|resource_exhausted|too many requests/i.test(e.message || ""));
const isModelMissing = (e) => e && (e.status === 404 || /does not exist|not found|decommissioned|not supported|no access|do not have access/i.test(e.message || ""));
const isJsonModeIssue = (e) => e && /json|response_format/i.test(e.message || "") && e.status === 400;

// warm-instance memory (lost on cold start, which is fine)
const cooldown = new Map();             // "provider:model" -> until timestamp
let groqListCache = null;               // { ids, at }

// how long the provider asks us to wait, in seconds ("try again in 7.6s", "retry in 8h25m57s", retry-after header)
function retrySeconds(e, fallbackS = DEFAULT_COOLDOWN_S) {
  const m = String(e && e.message || "");
  let s = null;
  const a = m.match(/try again in\s+([\d.]+)\s*s/i); if (a) s = parseFloat(a[1]);
  const b = m.match(/retry in\s+(?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?/i); if (!s && b && (b[1] || b[2] || b[3])) s = (+b[1] || 0) * 3600 + (+b[2] || 0) * 60 + (parseFloat(b[3]) || 0);
  if (!s && e && e.retryAfter) s = e.retryAfter;
  if (!s && /per ?day|daily|RPD/i.test(m)) s = 3600;
  return Math.min(Math.max(s || fallbackS, 1), 6 * 3600);
}
const cool = (key, e, fallbackS) => cooldown.set(key, Date.now() + retrySeconds(e, fallbackS) * 1000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let IGNORE_COOLDOWN = false;            // the status check always tests for real
const coolingFor = (key) => IGNORE_COOLDOWN ? 0 : Math.max(0, ((cooldown.get(key) || 0) - Date.now()) / 1000);

const short = (m) => String(m || "").replace(/\s+/g, " ").slice(0, 160);

async function callGemini(system, history, model) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const r = await fetch(url, {
    method: "POST",
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: history.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
      generationConfig: {
        temperature: 0.3,
        responseMimeType: "application/json",
        ...(/flash/i.test(model) ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
      },
    }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new LlmError(d?.error?.message || `Gemini error ${r.status}`, r.status);
  const text = (d.candidates?.[0]?.content?.parts || []).filter((p) => p.text && !p.thought).map((p) => p.text).join("");
  if (!text) throw new LlmError("Gemini returned an empty answer", 502);
  return text;
}

async function groqModels() {
  if (groqListCache && Date.now() - groqListCache.at < 30 * 60 * 1000) return groqListCache.ids;
  const r = await fetch("https://api.groq.com/openai/v1/models", {
    signal: AbortSignal.timeout(8000),
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new LlmError(d?.error?.message || `Groq error ${r.status}`, r.status);
  const ids = (d.data || []).filter((m) => m.active !== false).map((m) => m.id)
    .filter((id) => /gpt-oss|llama|qwen|kimi|mistral|gemma|deepseek/i.test(id) && !/whisper|guard|tts|orpheus|playai|distil|embed|compound|vision|safeguard/i.test(id));
  groqListCache = { ids, at: Date.now() };
  return ids;
}

// candidate Groq models in preference order; Groq limits apply per model, so rotating multiplies capacity
async function groqCandidates() {
  let ids = null;
  try { ids = await groqModels(); } catch (e) { ids = null; }
  const wanted = [process.env.GROQ_MODEL, ...GROQ_PREFERRED].filter(Boolean);
  const list = ids ? [...wanted.filter((w) => ids.includes(w)), ...ids.filter((i) => !wanted.includes(i))].slice(0, 6) : wanted;
  return [...new Set(list)];
}

async function callGroqWith(model, system, history, opts = {}) {
  const extra = opts.minimal ? {} : /gpt-oss/i.test(model) ? { reasoning_effort: "low" } : /qwen3/i.test(model) ? { reasoning_format: "hidden" } : {};
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      max_tokens: 4000,
      ...(opts.noJson ? {} : { response_format: { type: "json_object" } }),
      ...extra,
      messages: [{ role: "system", content: system }, ...history.map((m) => ({ role: m.role, content: m.content }))],
    }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new LlmError(d?.error?.message || `Groq error ${r.status}`, r.status); e.retryAfter = parseFloat(r.headers?.get?.("retry-after")) || null; throw e; }
  const text = (d.choices?.[0]?.message?.content || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  if (!text) throw new LlmError("Groq returned an empty answer", 502);
  return text;
}

// try Groq models in turn; each one self-heals for unsupported options
async function callGroq(system, history, info, deadline) {
  const models = await groqCandidates();
  let last = null, tried = 0;
  for (const model of models) {
    if (coolingFor(`groq:${model}`) > 0) continue;
    if (Date.now() > deadline) break;
    tried++; info.model = model;
    try {
      try { return await callGroqWith(model, system, history); }
      catch (e) {
        if (e.status === 400 && /reasoning|property|parameter|unsupported|not supported/i.test(e.message)) return await callGroqWith(model, system, history, { minimal: true });
        if (e.status === 400 && /json|response_format/i.test(e.message)) return await callGroqWith(model, system, history, { minimal: true, noJson: true });
        throw e;
      }
    } catch (e) {
      last = e;
      if (isQuota(e)) cool(`groq:${model}`, e);
      else if (isModelMissing(e)) cooldown.set(`groq:${model}`, Date.now() + 6 * 3600 * 1000);
    }
  }
  if (!tried) { const e = new LlmError("All Groq models are at their usage limit", 429); e.waitFor = Math.min(...models.map((m) => coolingFor(`groq:${m}`)).filter((x) => x > 0)); throw e; }
  const e = last || new LlmError("Groq could not answer", 502);
  const w = models.map((m) => coolingFor(`groq:${m}`)).filter((x) => x > 0 && x < 3600);
  if (w.length) e.waitFor = Math.min(...w);
  throw e;
}

let mistralListCache = null;
async function mistralCandidates() {
  let ids = null;
  if (mistralListCache && Date.now() - mistralListCache.at < 30 * 60 * 1000) ids = mistralListCache.ids;
  else {
    try {
      const r = await fetch("https://api.mistral.ai/v1/models", { signal: AbortSignal.timeout(8000), headers: { Authorization: `Bearer ${process.env.MISTRAL_API_KEY}` } });
      const d = await r.json().catch(() => ({}));
      if (r.ok) { ids = (d.data || []).map((m) => m.id); mistralListCache = { ids, at: Date.now() }; await sleep(1100); }
    } catch (e) { ids = null; }
  }
  const wanted = [process.env.MISTRAL_MODEL, ...MISTRAL_PREFERRED].filter(Boolean);
  return [...new Set(ids ? wanted.filter((w) => ids.includes(w)).concat(ids.length && !wanted.some((w) => ids.includes(w)) ? ids.filter((i) => /small|medium|large|nemo/.test(i)).slice(0, 2) : []) : wanted)];
}

async function callMistralWith(model, system, history, jsonMode = true) {
  const r = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.MISTRAL_API_KEY}` },
    body: JSON.stringify({
      model, temperature: 0.3, max_tokens: 4000,
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      messages: [{ role: "system", content: system }, ...history.map((m) => ({ role: m.role, content: m.content }))],
    }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = d?.message || d?.error?.message || d?.detail || `Mistral error ${r.status}`;
    const e = new LlmError(typeof msg === "string" ? msg : JSON.stringify(msg), r.status);
    e.retryAfter = parseFloat(r.headers?.get?.("retry-after")) || null; throw e;
  }
  const c = d.choices?.[0]?.message?.content;
  const text = (Array.isArray(c) ? c.map((x) => x.text || "").join("") : (c || "")).trim();
  if (!text) throw new LlmError("Mistral returned an empty answer", 502);
  return text;
}

async function callMistral(system, history, info, deadline) {
  const models = await mistralCandidates();
  let last = null, tried = 0;
  for (const model of models) {
    if (coolingFor(`mistral:${model}`) > 0) continue;
    if (Date.now() > deadline) break;
    tried++; info.model = model;
    try {
      const attempt = async () => {
        try { return await callMistralWith(model, system, history); }
        catch (e) { if (e.status === 400 && /json|response_format/i.test(e.message)) return await callMistralWith(model, system, history, false); throw e; }
      };
      try { return await attempt(); }
      catch (e) {
        // the free plan allows about one request per second: wait a moment and try the same model once more
        if (isQuota(e) && Date.now() + 1500 < deadline) { await sleep(Math.min(Math.max((retrySeconds(e, 1.2)) * 1000, 1200), 5000)); return await attempt(); }
        throw e;
      }
    } catch (e) {
      last = e;
      if (isQuota(e)) cool(`mistral:${model}`, e, 3);
      else if (isModelMissing(e) || e.status === 401 || e.status === 403) cooldown.set(`mistral:${model}`, Date.now() + 6 * 3600 * 1000);
    }
  }
  const w = models.map((m) => coolingFor(`mistral:${m}`)).filter((x) => x > 0 && x < 3600);
  const e = last || new LlmError(tried ? "Mistral could not answer" : "All Mistral models are at their usage limit", tried ? 502 : 429);
  if (w.length) e.waitFor = Math.min(...w);
  throw e;
}

function plan() {
  const gem = !!process.env.GEMINI_API_KEY, groq = !!process.env.GROQ_API_KEY;
  const gMain = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const gFb = process.env.GEMINI_FALLBACK_MODEL || "gemini-2.5-flash-lite";
  const gemini = gem ? [{ provider: "gemini", model: gMain }, ...(gFb !== gMain ? [{ provider: "gemini", model: gFb }] : [])] : [];
  const groqs = groq ? [{ provider: "groq", model: "rotating" }] : [];
  const mistrals = process.env.MISTRAL_API_KEY ? [{ provider: "mistral", model: "rotating" }] : [];
  const order = { gemini, groq: groqs, mistral: mistrals };
  const firstPick = (process.env.LLM_PROVIDER || "").toLowerCase();
  const names = ["gemini", "groq", "mistral"];
  const seq = names.includes(firstPick) ? [firstPick, ...names.filter((n) => n !== firstPick)] : names;
  return seq.flatMap((n) => order[n]);
}

async function runAttempt(a, system, history, deadline = Date.now() + TOTAL_BUDGET_MS) {
  const info = { provider: a.provider, model: a.model };
  const text = a.provider === "gemini" ? await callGemini(system, history, a.model)
    : a.provider === "groq" ? await callGroq(system, history, info, deadline)
    : await callMistral(system, history, info, deadline);
  return { text, info };
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const steps = plan();
  const first = steps[0] && steps[0].provider;

  if (req.method === "GET") {
    const base = {
      ok: steps.length > 0,
      provider: first || null,
      providers: { gemini: !!process.env.GEMINI_API_KEY, groq: !!process.env.GROQ_API_KEY, mistral: !!process.env.MISTRAL_API_KEY },
      accessRequired: !!process.env.ACCESS_CODE,
    };
    const q = req.query || {};
    if (!q.check) return res.status(200).json(base);
    const code = req.headers["x-access-code"] || q.code;
    if (process.env.ACCESS_CODE && code !== process.env.ACCESS_CODE) return res.status(401).json({ error: "Access code required" });
    const checks = [];
    IGNORE_COOLDOWN = true;
    for (const a of steps) {
      const t0 = Date.now();
      try {
        const r = await runAttempt(a, 'Reply with the JSON object {"ok":true}', [{ role: "user", content: "ping, answer in json" }]);
        checks.push({ ...r.info, ok: true, ms: Date.now() - t0 });
      } catch (e) {
        checks.push({ provider: a.provider, model: a.model, ok: false, ms: Date.now() - t0, error: short(e.message), status: e.status || null, quota: isQuota(e) });
      }
    }
    IGNORE_COOLDOWN = false;
    let groqRotation = null, mistralRotation = null;
    try { if (process.env.GROQ_API_KEY) groqRotation = await groqCandidates(); } catch (e) {}
    try { if (process.env.MISTRAL_API_KEY) mistralRotation = await mistralCandidates(); } catch (e) {}
    return res.status(200).json({ ...base, checks, groqRotation, mistralRotation });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (process.env.ACCESS_CODE && req.headers["x-access-code"] !== process.env.ACCESS_CODE) {
    return res.status(401).json({ error: "Access code required" });
  }
  if (!steps.length) return res.status(500).json({ error: "No API key configured on the server. Set GEMINI_API_KEY, GROQ_API_KEY or MISTRAL_API_KEY in Vercel." });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const system = String(body?.system || "");
  const history = Array.isArray(body?.history) ? body.history : [];
  const valid = history.every((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string");
  const size = system.length + history.reduce((n, m) => n + (m.content || "").length, 0);
  if (!system || !history.length || !valid || history.length > MAX_MESSAGES || size > MAX_CHARS) {
    return res.status(400).json({ error: "Invalid or oversized request" });
  }

  // Try every configured model in order. Any failure moves on to the next one.
  const started = Date.now(), failures = [], deadline = started + TOTAL_BUDGET_MS;
  const waits = [];
  for (const a of steps) {
    const key = `${a.provider}:${a.model}`;
    if (a.provider === "gemini" && coolingFor(key) > 0) { waits.push(coolingFor(key)); failures.push({ provider: a.provider, model: a.model, error: "at its limit, skipped", quota: true }); continue; }
    if (Date.now() - started > TOTAL_BUDGET_MS - CALL_TIMEOUT_MS && failures.length) break;
    try {
      const { text, info } = await runAttempt(a, system, history, deadline);
      return res.status(200).json({ text, provider: info.provider, model: info.model, fallbacks: failures.length });
    } catch (e) {
      if (isQuota(e) && a.provider === "gemini") { cool(key, e); waits.push(coolingFor(key)); }
      if (e.waitFor) waits.push(e.waitFor);
      failures.push({ provider: a.provider, model: a.model, error: short(e.message), quota: isQuota(e) });
    }
  }
  const allQuota = failures.length && failures.every((f) => f.quota);
  const retryAfter = waits.length ? Math.ceil(Math.min(...waits)) : null;
  const slow = failures.some((f) => /timeout|aborted/i.test(f.error));
  return res.status(allQuota ? 429 : slow ? 504 : 502).json({
    error: allQuota ? "All AI providers are at their usage limit" : slow ? "The AI took too long to answer" : "No AI provider could answer",
    quota: !!allQuota,
    retryAfter,
    attempts: failures,
  });
};
