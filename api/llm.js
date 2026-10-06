// Vercel serverless function: keeps the LLM API key on the server.
//
// Environment variables (Vercel > Project > Settings > Environment Variables):
//   GEMINI_API_KEY   Google AI Studio key   (set this, or GROQ_API_KEY)
//   GROQ_API_KEY     Groq key
//   LLM_PROVIDER     optional: "gemini" or "groq" (default: whichever key is set, Gemini first)
//   GEMINI_MODEL     optional, default "gemini-2.5-flash"
//   GEMINI_FALLBACK_MODEL optional, used when the main model hits its quota (default "gemini-2.5-flash-lite")
//   GROQ_MODEL       optional, default "llama-3.3-70b-versatile"
//   ACCESS_CODE      optional: if set, callers must send it in the x-access-code header

const MAX_MESSAGES = 60;
const MAX_CHARS = 80000;

function pickProvider() {
  const want = (process.env.LLM_PROVIDER || "").toLowerCase();
  if (want === "groq" && process.env.GROQ_API_KEY) return "groq";
  if (want === "gemini" && process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.GROQ_API_KEY) return "groq";
  return null;
}

class LlmError extends Error { constructor(msg, status) { super(msg); this.status = status; } }
const isQuota = (e) => e && (e.status === 429 || /quota|rate limit|resource_exhausted/i.test(e.message || ""));

async function callGemini(system, history, model = process.env.GEMINI_MODEL || "gemini-2.5-flash") {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: history.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
      generationConfig: { temperature: 0.3, responseMimeType: "application/json" },
    }),
  });
  const d = await r.json();
  if (!r.ok) throw new LlmError(d?.error?.message || `Gemini error ${r.status}`, r.status);
  return (d.candidates?.[0]?.content?.parts || []).filter((p) => p.text && !p.thought).map((p) => p.text).join("");
}

async function callGroq(system, history) {
  const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, ...history.map((m) => ({ role: m.role, content: m.content }))],
    }),
  });
  const d = await r.json();
  if (!r.ok) throw new LlmError(d?.error?.message || `Groq error ${r.status}`, r.status);
  return d.choices?.[0]?.message?.content || "";
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const provider = pickProvider();

  if (req.method === "GET") {
    return res.status(200).json({
      ok: !!provider,
      provider,
      providers: { gemini: !!process.env.GEMINI_API_KEY, groq: !!process.env.GROQ_API_KEY },
      accessRequired: !!process.env.ACCESS_CODE,
    });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (process.env.ACCESS_CODE && req.headers["x-access-code"] !== process.env.ACCESS_CODE) {
    return res.status(401).json({ error: "Access code required" });
  }
  if (!provider) return res.status(500).json({ error: "No API key configured on the server. Set GEMINI_API_KEY or GROQ_API_KEY in Vercel." });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const system = String(body?.system || "");
  const history = Array.isArray(body?.history) ? body.history : [];
  const valid = history.every((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string");
  const size = system.length + history.reduce((n, m) => n + (m.content || "").length, 0);
  if (!system || !history.length || !valid || history.length > MAX_MESSAGES || size > MAX_CHARS) {
    return res.status(400).json({ error: "Invalid or oversized request" });
  }

  // Try the main provider, then fall back on quota or rate-limit errors:
  // Gemini main model -> Gemini fallback model -> Groq (if key set), or Groq -> Gemini.
  const attempts = [];
  if (provider === "gemini") {
    attempts.push(["gemini", () => callGemini(system, history)]);
    const fb = process.env.GEMINI_FALLBACK_MODEL || "gemini-2.5-flash-lite";
    if (fb !== (process.env.GEMINI_MODEL || "gemini-2.5-flash")) attempts.push(["gemini", () => callGemini(system, history, fb)]);
    if (process.env.GROQ_API_KEY) attempts.push(["groq", () => callGroq(system, history)]);
  } else {
    attempts.push(["groq", () => callGroq(system, history)]);
    if (process.env.GEMINI_API_KEY) attempts.push(["gemini", () => callGemini(system, history)]);
  }
  let last;
  for (const [name, run] of attempts) {
    try {
      const text = await run();
      return res.status(200).json({ text, provider: name });
    } catch (e) {
      last = e;
      if (!isQuota(e)) break;
    }
  }
  const quota = isQuota(last);
  return res.status(quota ? 429 : 502).json({ error: last?.message || "AI call failed", quota });
};
