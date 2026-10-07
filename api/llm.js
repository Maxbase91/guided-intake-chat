// Vercel serverless function: keeps the LLM API keys on the server.
//
// Environment variables (Vercel > Project > Settings > Environment Variables):
//   GEMINI_API_KEY         Google AI Studio key
//   GROQ_API_KEY           Groq key (set one or both)
//   LLM_PROVIDER           optional: "gemini" or "groq" goes first (default: Gemini first if set)
//   GEMINI_MODEL           optional, default "gemini-2.5-flash"
//   GEMINI_FALLBACK_MODEL  optional, default "gemini-2.5-flash-lite"
//   GROQ_MODEL             optional; if missing or unavailable, the best model the account can use is picked automatically
//   ACCESS_CODE            optional: callers must send it in the x-access-code header
//
// GET /api/llm             -> which providers are configured (no secrets)
// GET /api/llm?check=1     -> live check of every provider (needs the access code header or ?code=)

const MAX_MESSAGES = 60;
const MAX_CHARS = 80000;
const CALL_TIMEOUT_MS = 25000;          // per model call
const TOTAL_BUDGET_MS = 55000;          // stay inside the 60s function limit
const COOLDOWN_MS = 5 * 60 * 1000;      // skip a model for 5 minutes after a quota error

// Preferred Groq models, best first. The first one the account can use is taken.
const GROQ_PREFERRED = [
  "openai/gpt-oss-120b",
  "llama-3.3-70b-versatile",
  "meta-llama/llama-4-maverick-17b-128e-instruct",
  "moonshotai/kimi-k2-instruct",
  "qwen/qwen3-32b",
  "meta-llama/llama-4-scout-17b-16e-instruct",
  "openai/gpt-oss-20b",
  "llama-3.1-8b-instant",
];

class LlmError extends Error { constructor(msg, status) { super(msg); this.status = status; } }
const isQuota = (e) => e && (e.status === 429 || /quota|rate limit|resource_exhausted|too many requests/i.test(e.message || ""));
const isModelMissing = (e) => e && (e.status === 404 || /does not exist|not found|decommissioned|not supported|no access|do not have access/i.test(e.message || ""));
const isJsonModeIssue = (e) => e && /json|response_format/i.test(e.message || "") && e.status === 400;

// warm-instance memory (lost on cold start, which is fine)
const cooldown = new Map();             // "provider:model" -> until timestamp
let groqModelCache = null;              // { model, at }

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
  const r = await fetch("https://api.groq.com/openai/v1/models", {
    signal: AbortSignal.timeout(8000),
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new LlmError(d?.error?.message || `Groq error ${r.status}`, r.status);
  return (d.data || []).filter((m) => m.active !== false).map((m) => m.id);
}

async function pickGroqModel(force) {
  if (!force && groqModelCache && Date.now() - groqModelCache.at < 30 * 60 * 1000) return groqModelCache.model;
  const ids = await groqModels();
  const usable = ids.filter((id) => !/whisper|guard|tts|playai|distil|embed|vision-only|compound/i.test(id));
  const wanted = [process.env.GROQ_MODEL, ...GROQ_PREFERRED].filter(Boolean);
  const model = wanted.find((w) => usable.includes(w)) || usable[0];
  if (!model) throw new LlmError("No usable Groq chat model on this account", 404);
  groqModelCache = { model, at: Date.now() };
  return model;
}

async function callGroqWith(model, system, history, jsonMode = true) {
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      messages: [{ role: "system", content: system }, ...history.map((m) => ({ role: m.role, content: m.content }))],
    }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new LlmError(d?.error?.message || `Groq error ${r.status}`, r.status);
  const text = (d.choices?.[0]?.message?.content || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  if (!text) throw new LlmError("Groq returned an empty answer", 502);
  return text;
}

// Groq with self-healing: unknown model -> pick another; JSON mode refused -> plain mode
async function callGroq(system, history, info) {
  let model = (groqModelCache && groqModelCache.model) || process.env.GROQ_MODEL || GROQ_PREFERRED[0];
  info.model = model;
  try {
    return await callGroqWith(model, system, history);
  } catch (e) {
    if (isModelMissing(e)) {
      model = await pickGroqModel(true); info.model = model;
      return await callGroqWith(model, system, history);
    }
    if (isJsonModeIssue(e)) return await callGroqWith(model, system, history, false);
    throw e;
  }
}

function plan() {
  const gem = !!process.env.GEMINI_API_KEY, groq = !!process.env.GROQ_API_KEY;
  const gMain = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const gFb = process.env.GEMINI_FALLBACK_MODEL || "gemini-2.5-flash-lite";
  const gemini = gem ? [{ provider: "gemini", model: gMain }, ...(gFb !== gMain ? [{ provider: "gemini", model: gFb }] : [])] : [];
  const groqs = groq ? [{ provider: "groq", model: "auto" }] : [];
  const groqFirst = (process.env.LLM_PROVIDER || "").toLowerCase() === "groq";
  return groqFirst ? [...groqs, ...gemini] : [...gemini, ...groqs];
}

async function runAttempt(a, system, history) {
  const info = { provider: a.provider, model: a.model };
  const text = a.provider === "gemini" ? await callGemini(system, history, a.model) : await callGroq(system, history, info);
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
      providers: { gemini: !!process.env.GEMINI_API_KEY, groq: !!process.env.GROQ_API_KEY },
      accessRequired: !!process.env.ACCESS_CODE,
    };
    const q = req.query || {};
    if (!q.check) return res.status(200).json(base);
    const code = req.headers["x-access-code"] || q.code;
    if (process.env.ACCESS_CODE && code !== process.env.ACCESS_CODE) return res.status(401).json({ error: "Access code required" });
    const checks = [];
    for (const a of steps) {
      const t0 = Date.now();
      try {
        const r = await runAttempt(a, 'Reply with the JSON object {"ok":true}', [{ role: "user", content: "ping, answer in json" }]);
        checks.push({ ...r.info, ok: true, ms: Date.now() - t0 });
      } catch (e) {
        checks.push({ provider: a.provider, model: a.model, ok: false, ms: Date.now() - t0, error: short(e.message), quota: isQuota(e) });
      }
    }
    return res.status(200).json({ ...base, checks });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (process.env.ACCESS_CODE && req.headers["x-access-code"] !== process.env.ACCESS_CODE) {
    return res.status(401).json({ error: "Access code required" });
  }
  if (!steps.length) return res.status(500).json({ error: "No API key configured on the server. Set GEMINI_API_KEY or GROQ_API_KEY in Vercel." });

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
  const started = Date.now(), failures = [];
  const now = Date.now();
  let ordered = steps.filter((a) => !(cooldown.get(`${a.provider}:${a.model}`) > now));
  if (!ordered.length) ordered = steps; // everything cooling down: try anyway
  for (const a of ordered) {
    if (Date.now() - started > TOTAL_BUDGET_MS - CALL_TIMEOUT_MS && failures.length) break;
    try {
      const { text, info } = await runAttempt(a, system, history);
      return res.status(200).json({ text, provider: info.provider, model: info.model, fallbacks: failures.length });
    } catch (e) {
      if (isQuota(e)) cooldown.set(`${a.provider}:${a.model}`, Date.now() + COOLDOWN_MS);
      failures.push({ provider: a.provider, model: a.model, error: short(e.message), quota: isQuota(e) });
    }
  }
  const allQuota = failures.length && failures.every((f) => f.quota);
  const slow = failures.some((f) => /timeout|aborted/i.test(f.error));
  return res.status(allQuota ? 429 : slow ? 504 : 502).json({
    error: allQuota ? "All AI providers are at their usage limit" : slow ? "The AI took too long to answer" : "No AI provider could answer",
    quota: !!allQuota,
    attempts: failures,
  });
};
