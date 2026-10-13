// API tests for api/llm.js (the Vercel function), with provider calls stubbed. Run: npm run test:api
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const API = path.join(__dirname, "..", "..", "api", "llm.js");
const ENV_KEYS = ["GEMINI_API_KEY", "GROQ_API_KEY", "MISTRAL_API_KEY", "ACCESS_CODE", "LLM_PROVIDER", "GEMINI_MODEL", "GEMINI_FALLBACK_MODEL", "GROQ_MODEL", "MISTRAL_MODEL"];
const realFetch = global.fetch;
let savedEnv, calls;

// a fresh copy of the function per test, as after a cold start (its cooldown memory is module state)
function load() { delete require.cache[require.resolve(API)]; return require(API); }

const reply = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const geminiOk = (text = '{"ok":true}') => reply(200, { candidates: [{ content: { parts: [{ text }] } }] });
const chatOk = (text = '{"ok":true}') => reply(200, { choices: [{ message: { content: text } }] });

// stub fetch: routes[provider] decides the answer for each call; model lists answer by default
function stub(routes) {
  global.fetch = async (url, init = {}) => {
    const u = new URL(url), method = init.method || "GET";
    const provider = u.hostname.includes("googleapis") ? "gemini" : u.hostname.includes("groq") ? "groq" : u.hostname.includes("mistral") ? "mistral" : "other";
    const body = init.body ? JSON.parse(init.body) : null;
    const model = provider === "gemini" ? decodeURIComponent(u.pathname.split("/models/")[1].split(":")[0]) : body && body.model;
    if (method === "GET" && u.pathname.endsWith("/models")) {
      if (routes.models && routes.models[provider]) return routes.models[provider]();
      return reply(200, { data: (provider === "groq" ? ["llama-3.3-70b-versatile", "openai/gpt-oss-20b"] : ["ministral-8b-latest"]).map((id) => ({ id })) });
    }
    calls.push({ provider, model, body, headers: init.headers });
    const r = routes[provider];
    if (!r) throw new Error(`unexpected call to ${provider}`);
    return r({ model, body, n: calls.filter((c) => c.provider === provider).length });
  };
}

function call(handler, { method = "POST", query = {}, headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; }, json(o) { resolve({ status: this.statusCode, body: o, headers: this.headers }); return this; } };
    Promise.resolve(handler({ method, query, headers, body }, res)).catch(reject);
  });
}
const chatBody = (extra = {}) => ({ system: "Reply with JSON", history: [{ role: "user", content: "hello" }], ...extra });

beforeEach(() => { savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]])); ENV_KEYS.forEach((k) => delete process.env[k]); calls = []; });
afterEach(() => { global.fetch = realFetch; ENV_KEYS.forEach((k) => (savedEnv[k] === undefined ? delete process.env[k] : (process.env[k] = savedEnv[k]))); });

test("GET reports no providers when no key is set", async () => {
  const r = await call(load(), { method: "GET" });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: false, provider: null, providers: { gemini: false, groq: false, mistral: false }, accessRequired: false });
  assert.equal(r.headers["cache-control"], "no-store");
});

test("GET reports configured providers and the access requirement without leaking secrets", async () => {
  Object.assign(process.env, { GROQ_API_KEY: "secret-groq", MISTRAL_API_KEY: "secret-mistral", ACCESS_CODE: "letmein" });
  const r = await call(load(), { method: "GET" });
  assert.equal(r.body.ok, true);
  assert.equal(r.body.provider, "groq");
  assert.deepEqual(r.body.providers, { gemini: false, groq: true, mistral: true });
  assert.equal(r.body.accessRequired, true);
  assert.doesNotMatch(JSON.stringify(r.body), /secret|letmein/);
});

test("verify endpoint accepts the right access code and rejects a wrong one", async () => {
  process.env.ACCESS_CODE = "letmein";
  const h = load();
  assert.equal((await call(h, { method: "GET", query: { verify: "1" }, headers: { "x-access-code": "letmein" } })).status, 200);
  const t0 = Date.now();
  const bad = await call(h, { method: "GET", query: { verify: "1" }, headers: { "x-access-code": "nope" } });
  assert.equal(bad.status, 401);
  assert.ok(Date.now() - t0 >= 650, "a wrong code is answered slowly to discourage guessing");
  delete process.env.ACCESS_CODE;
  assert.equal((await call(h, { method: "GET", query: { verify: "1" } })).status, 200, "no code configured: always open");
});

test("POST needs the access code when one is configured", async () => {
  Object.assign(process.env, { GEMINI_API_KEY: "k", ACCESS_CODE: "letmein" });
  stub({ gemini: () => geminiOk() });
  const h = load();
  assert.equal((await call(h, { body: chatBody() })).status, 401);
  assert.equal((await call(h, { body: chatBody(), headers: { "x-access-code": "wrong" } })).status, 401);
  const ok = await call(h, { body: chatBody(), headers: { "x-access-code": "letmein" } });
  assert.equal(ok.status, 200);
  assert.equal(calls.length, 1);
});

test("POST without any key explains what to configure", async () => {
  const r = await call(load(), { body: chatBody() });
  assert.equal(r.status, 500);
  assert.match(r.body.error, /No API key configured/);
});

test("other methods are rejected", async () => {
  process.env.GEMINI_API_KEY = "k";
  assert.equal((await call(load(), { method: "PUT", body: chatBody() })).status, 405);
});

test("invalid or oversized requests are rejected before any provider is called", async () => {
  process.env.GEMINI_API_KEY = "k";
  stub({ gemini: () => geminiOk() });
  const h = load();
  const bad = [
    {},
    { system: "", history: [{ role: "user", content: "x" }] },
    { system: "s", history: [] },
    { system: "s", history: [{ role: "system", content: "x" }] },
    { system: "s", history: [{ role: "user", content: 42 }] },
    { system: "s", history: Array.from({ length: 61 }, () => ({ role: "user", content: "x" })) },
    { system: "s".repeat(80001), history: [{ role: "user", content: "x" }] },
    "not json",
  ];
  for (const body of bad) assert.equal((await call(h, { body })).status, 400, JSON.stringify(body).slice(0, 80));
  assert.equal(calls.length, 0);
});

test("a JSON string body is accepted (as Vercel passes it without a content type)", async () => {
  process.env.GEMINI_API_KEY = "k";
  stub({ gemini: () => geminiOk('{"reply":"hi"}') });
  const r = await call(load(), { body: JSON.stringify(chatBody()) });
  assert.equal(r.status, 200);
  assert.equal(r.body.text, '{"reply":"hi"}');
});

test("default order is Gemini first, with the system prompt and roles mapped for Gemini", async () => {
  Object.assign(process.env, { GEMINI_API_KEY: "k", GROQ_API_KEY: "k", MISTRAL_API_KEY: "k" });
  stub({ gemini: () => geminiOk() });
  const r = await call(load(), { body: chatBody({ history: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }, { role: "user", content: "c" }] }) });
  assert.deepEqual({ provider: r.body.provider, model: r.body.model, fallbacks: r.body.fallbacks }, { provider: "gemini", model: "gemini-2.5-flash", fallbacks: 0 });
  const sent = calls[0].body;
  assert.equal(sent.systemInstruction.parts[0].text, "Reply with JSON");
  assert.deepEqual(sent.contents.map((c) => c.role), ["user", "model", "user"]);
  assert.equal(sent.generationConfig.responseMimeType, "application/json");
  assert.equal(calls[0].headers["x-goog-api-key"], "k", "the key travels in a header, not the URL");
});

test("LLM_PROVIDER puts the chosen provider first", async () => {
  Object.assign(process.env, { GEMINI_API_KEY: "k", GROQ_API_KEY: "k", LLM_PROVIDER: "groq" });
  stub({ groq: () => chatOk() });
  const r = await call(load(), { body: chatBody() });
  assert.equal(r.body.provider, "groq");
  assert.equal(r.body.model, "llama-3.3-70b-versatile");
});

test("a rate-limited Gemini falls back to the lite model, then to Groq, and is skipped while cooling down", async () => {
  Object.assign(process.env, { GEMINI_API_KEY: "k", GROQ_API_KEY: "k" });
  stub({ gemini: () => reply(429, { error: { message: "Resource exhausted. Please retry in 30s." } }), groq: () => chatOk() });
  const h = load();
  const r1 = await call(h, { body: chatBody() });
  assert.equal(r1.status, 200);
  assert.equal(r1.body.provider, "groq");
  assert.equal(r1.body.fallbacks, 2);
  assert.deepEqual(calls.map((c) => c.model), ["gemini-2.5-flash", "gemini-2.5-flash-lite", "llama-3.3-70b-versatile"]);
  calls = [];
  const r2 = await call(h, { body: chatBody() });
  assert.equal(r2.body.provider, "groq");
  assert.ok(!calls.some((c) => c.provider === "gemini"), "Gemini is not called again during its cooldown");
});

test("Groq rotates to the next model when one is rate limited", async () => {
  process.env.GROQ_API_KEY = "k";
  stub({ groq: ({ model }) => (model === "llama-3.3-70b-versatile" ? reply(429, { error: { message: "Rate limit reached. Please try again in 7.5s." } }) : chatOk()) });
  const r = await call(load(), { body: chatBody() });
  assert.equal(r.status, 200);
  assert.equal(r.body.model, "openai/gpt-oss-20b");
});

test("Groq retries without JSON mode when a model rejects response_format", async () => {
  process.env.GROQ_API_KEY = "k";
  stub({ groq: ({ body }) => (body.response_format ? reply(400, { error: { message: "response_format json_object is invalid for this model" } }) : chatOk('{"ok":true}')) });
  const r = await call(load(), { body: chatBody() });
  assert.equal(r.status, 200);
  assert.ok(calls.some((c) => !c.body.response_format), "second attempt drops response_format");
});

// Was a known bug: a JSON-mode error that also says "not supported" took the first retry branch (still JSON mode) and skipped the model.
test("Groq drops JSON mode even when the error says 'not supported'", async () => {
  process.env.GROQ_API_KEY = "k";
  stub({ groq: ({ body }) => (body.response_format ? reply(400, { error: { message: "`response_format.type` `json_object` is not supported with this model" } }) : chatOk('{"ok":true}')) });
  const r = await call(load(), { body: chatBody() });
  assert.equal(r.status, 200);
});

test("an empty Gemini answer moves on to the next provider", async () => {
  Object.assign(process.env, { GEMINI_API_KEY: "k", GROQ_API_KEY: "k" });
  stub({ gemini: () => reply(200, { candidates: [{ content: { parts: [] } }] }), groq: () => chatOk() });
  const r = await call(load(), { body: chatBody() });
  assert.equal(r.body.provider, "groq");
});

test("when every provider is rate limited the answer is 429 with a retry time", async () => {
  Object.assign(process.env, { GEMINI_API_KEY: "k", GROQ_API_KEY: "k" });
  stub({ gemini: () => reply(429, { error: { message: "quota exceeded, retry in 5s" } }), groq: () => reply(429, { error: { message: "Rate limit reached. Please try again in 4s." } }) });
  const r = await call(load(), { body: chatBody() });
  assert.equal(r.status, 429);
  assert.equal(r.body.quota, true);
  assert.equal(typeof r.body.retryAfter, "number");
  assert.ok(r.body.retryAfter >= 1 && r.body.retryAfter <= 6, `retryAfter ${r.body.retryAfter}`);
});

test("when every provider fails for other reasons the answer is 502 with the attempts listed", async () => {
  Object.assign(process.env, { GEMINI_API_KEY: "k", GROQ_API_KEY: "k" });
  stub({ gemini: () => reply(500, { error: { message: "internal" } }), groq: () => reply(500, { error: { message: "internal" } }) });
  const r = await call(load(), { body: chatBody() });
  assert.equal(r.status, 502);
  assert.equal(r.body.error, "No AI provider could answer");
  assert.ok(r.body.attempts.length >= 3);
  assert.doesNotMatch(JSON.stringify(r.body), /"k"/, "no key in the error output");
});

test("x-force-provider limits the run to one provider", async () => {
  Object.assign(process.env, { GEMINI_API_KEY: "k", GROQ_API_KEY: "k", MISTRAL_API_KEY: "k" });
  stub({ mistral: () => chatOk() });
  const r = await call(load(), { body: chatBody(), headers: { "x-force-provider": "mistral" } });
  assert.equal(r.status, 200);
  assert.equal(r.body.provider, "mistral");
  assert.deepEqual([...new Set(calls.map((c) => c.provider))], ["mistral"]);
});

test("the live check needs the access code and reports each provider", async () => {
  Object.assign(process.env, { GEMINI_API_KEY: "k", GROQ_API_KEY: "k", ACCESS_CODE: "letmein" });
  stub({ gemini: ({ model }) => (model === "gemini-2.5-flash" ? geminiOk() : reply(429, { error: { message: "quota" } })), groq: () => chatOk() });
  const h = load();
  assert.equal((await call(h, { method: "GET", query: { check: "1" } })).status, 401);
  const r = await call(h, { method: "GET", query: { check: "1", code: "letmein" } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.checks.map((c) => [c.provider, c.ok]), [["gemini", true], ["gemini", false], ["groq", true]]);
  assert.equal(r.body.checks[1].quota, true);
  assert.ok(Array.isArray(r.body.groqRotation));
});
