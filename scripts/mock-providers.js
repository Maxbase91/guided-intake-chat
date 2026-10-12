// Fake Gemini, Groq and Mistral endpoints for local tests: no keys, no network, deterministic answers.
// install() wraps global fetch; calls to the three provider hosts are answered here, everything else passes through.
//
// Each provider has a mode: "ok" (default), "429" (rate limited), "500" (server error) or "empty" (blank answer).
// Set it with MOCK_GEMINI / MOCK_GROQ / MOCK_MISTRAL, or at runtime with configure({ gemini: "429" }).
//
// Answers follow the shape the app asks for:
//   chat turns   -> asks the first item in still_needed (with a suggestion when the item expects one)
//   suggestions  -> {"suggestion": ...}
//   documents    -> description, brd, detail, compact, l4_final, quality_remarks
//   anything else (status ping) -> {"ok": true}
// Trigger words in the user's latest message: MOCK_LEAK (reply leaks internal field names),
// MOCK_OFFTOPIC (assessment flags the answer as off-topic). configure({ nextChat: {...} }) overrides fields of the next chat answer.

const HOSTS = { gemini: "generativelanguage.googleapis.com", groq: "api.groq.com", mistral: "api.mistral.ai" };
const state = { modes: { gemini: "ok", groq: "ok", mistral: "ok" }, calls: [], nextChat: null };

function configure(opts = {}) {
  for (const p of Object.keys(HOSTS)) if (opts[p]) state.modes[p] = String(opts[p]);
  if (opts.resetCalls) state.calls = [];
  if ("nextChat" in opts) state.nextChat = opts.nextChat || null;   // fields merged into the next chat answer only
  return snapshot();
}
const snapshot = () => ({ modes: { ...state.modes }, calls: state.calls.slice() });

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

function pick(re, s) { const m = String(s || "").match(re); return m ? m[1] : null; }

function chatAnswer(user) {
  const extra = state.nextChat; state.nextChat = null;
  return { ...baseChatAnswer(user), ...(extra || {}) };
}

function baseChatAnswer(user) {
  let still = [];
  try { still = JSON.parse(pick(/still_needed \(ask the first unknown one\): (\[.*\])\s*$/m, user) || "[]"); } catch { still = []; }
  const latest = pick(/Latest user message:\n([\s\S]*?)\n\n\[STATE\]/, user) || "";
  const next = still[0];
  if (!next) return { facts: {}, reply: "Thanks, I have what I need.", asking: "", choices: [], complete: true, suggestion: "", corrections: {}, answers_question: true, assessment: { fact: "", ok: true, issue: "", follow_up: "", score: 9 } };
  const ask = String(next.ask || `Could you tell me about ${String(next.label || next.key).toLowerCase()}`).replace(/[.?\s]*$/, "?");
  const suggestion = next.suggest ? (next.lines ? next.lines.map((l) => `${l}: Mock suggestion for ${String(l).toLowerCase()} tailored to this request`).join("\n") : "Mock suggestion tailored to this request; reviewed by the business owner") : "";
  let reply = `Thanks, that is clear. ${ask}`;
  if (/MOCK_LEAK/.test(latest)) reply = `I set ict_outsourcing to true and personal_data to false in the facts JSON. ${ask}`;
  const assessment = /MOCK_OFFTOPIC/.test(latest)
    ? { fact: next.key, ok: false, issue: "off-topic", follow_up: `That doesn't seem to answer my question. ${ask}`, score: 1 }
    : { fact: "", ok: true, issue: "", follow_up: "", score: 8 };
  return { facts: {}, reply, asking: next.key, choices: [], complete: false, suggestion, corrections: {}, answers_question: true, assessment };
}

function docAnswer(system) {
  const nd = /"detail":\{/.test(system);
  const description = nd
    ? { name: "Mock HR and payroll platform", tagline: "Accurate pay, less manual work", headline: "A managed HR and payroll platform that replaces manual spreadsheets and an end-of-life tool, giving HR one reliable process for paying employees accurately and on time across the countries covered.",
        exec: "The organisation needs a managed HR and payroll platform. Today payroll depends on an end-of-life tool and manual spreadsheets, which creates errors and rework.\n\nThe platform gives HR and payroll teams one process with an audit trail and self-service for employees.",
        audience: "HR and payroll teams and all employees", functions: "HR, Finance", problem: "End-of-life payroll tool and manual spreadsheets",
        capabilities: ["Payroll calculation", "Employee self-service", "Audit trail"], benefits: ["Accurate pay", "Less manual work"], usp: "One managed platform", kpis: ["Payroll accuracy"], regulatory: "" }
    : { name: "Mock service", summary: "The organisation buys a mock service for this request.", audience: "", problem: "", functions: "", capabilities: ["Mock capability one", "Mock capability two"], benefits: ["Mock benefit"], difference: "", success: "", regulatory: "", narrative: "The organisation buys a mock service for this request." };
  const out = {
    description,
    brd: { background: "Mock background.", objectives: ["Mock objective"], success_criteria: ["Mock success criterion"], scope_in: ["Mock scope"], scope_out: [],
      requirements: [{ type: "Functional", text: "The supplier shall provide the mock service.", priority: "Must" }, { type: "Service level", text: "The supplier shall meet the agreed service levels.", priority: "Should" }],
      deliverables: ["Mock deliverable"], milestones: [{ milestone: "Start", timing: "To be determined" }], timeline: "", location: "", volumes: "", service_levels: [], supplier_requirements: [], risk_and_compliance: [],
      commercials: [], evaluation: [{ criterion: "Quality", weight: "60%" }, { criterion: "Price", weight: "40%" }], stakeholders: [{ role: "Business owner", who: "To be determined" }], assumptions: [], dependencies: [], open_points: [] },
    quality_remarks: [],
  };
  if (nd) {
    out.detail = { purpose: "Mock purpose.", scope_in: ["The Service Provider shall run the mock service."], scope_out: [], our_deps: [], assumptions: [], delivery: "", timeline: "", deliverables: [], acceptance: "", acceptance_test: "", service_levels: [], kpis: [], tools: [], qualifications: "", volumes: "", access: [], gov_meetings: "", reporting: "", change_mgmt: "", escalation: "", supplier_docs: "", open_points: [] };
    out.compact = "The Service Provider shall provide a managed HR and payroll platform for the organisation, replacing an end-of-life payroll tool and manual spreadsheets, with employee self-service, an audit trail and support for payroll in the countries covered, starting as agreed.";
    out.l4_final = { code: "", match: 0, reason: "", uncertainty: "" };
  }
  return out;
}

function answerFor(system, user) {
  if (/You are the intake assistant/.test(system)) return chatAnswer(user);
  if (/\{"suggestion":"\.\.\."\}/.test(system)) return { suggestion: pick(/A generic draft to improve on[^:]*: ([\s\S]*?)\n\nJSON only\./, user) || "A tailored answer for this request, reviewed by the business owner" };
  if (/"brd":\{/.test(system)) return docAnswer(system);
  return { ok: true };
}

function failure(provider, mode) {
  if (mode === "429") {
    if (provider === "mistral") return json(429, { message: "Requests rate limit exceeded" }, { "retry-after": "1" });
    if (provider === "groq") return json(429, { error: { message: "Rate limit reached for model. Please try again in 1.5s." } }, { "retry-after": "2" });
    return json(429, { error: { message: "Resource has been exhausted (e.g. check quota). Please retry in 2s." } });
  }
  if (mode === "500") return json(500, provider === "mistral" ? { message: "Internal server error" } : { error: { message: `${provider} mock internal error` } });
  return null;
}

async function handle(provider, url, init) {
  const u = new URL(url);
  const method = (init && init.method) || "GET";
  if (method === "GET" && /\/models$/.test(u.pathname)) {
    const ids = provider === "groq" ? ["llama-3.3-70b-versatile", "openai/gpt-oss-20b"] : ["ministral-8b-latest", "mistral-small-latest"];
    return json(200, { data: ids.map((id) => ({ id, active: true })) });
  }
  const body = init && init.body ? JSON.parse(init.body) : {};
  const model = provider === "gemini" ? decodeURIComponent(pick(/models\/([^:]+):generateContent/, u.pathname) || "") : body.model;
  const mode = state.modes[provider];
  state.calls.push({ provider, model, mode, at: Date.now() });
  const fail = failure(provider, mode);
  if (fail) return fail;
  let system, user;
  if (provider === "gemini") { system = body.systemInstruction?.parts?.[0]?.text || ""; user = (body.contents || []).map((c) => c.parts.map((p) => p.text).join("")).join("\n"); }
  else { system = (body.messages || []).find((m) => m.role === "system")?.content || ""; user = (body.messages || []).filter((m) => m.role !== "system").map((m) => m.content).join("\n"); }
  const text = mode === "empty" ? "" : JSON.stringify(answerFor(system, user));
  if (provider === "gemini") return json(200, { candidates: [{ content: { parts: [{ text }] } }] });
  return json(200, { choices: [{ message: { content: text } }] });
}

let installed = false;
function install() {
  if (installed) return;
  installed = true;
  const realFetch = global.fetch;
  global.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    const provider = Object.keys(HOSTS).find((p) => { try { return new URL(url).hostname === HOSTS[p]; } catch { return false; } });
    if (!provider) return realFetch(input, init);
    if (init && init.signal && init.signal.aborted) throw init.signal.reason;
    return handle(provider, url, init);
  };
  for (const p of Object.keys(HOSTS)) { const v = process.env[`MOCK_${p.toUpperCase()}`]; if (v) state.modes[p] = v; }
}

module.exports = { install, configure, snapshot };
