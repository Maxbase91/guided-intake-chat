/*! guided-intake-chat | (c) 2026 Maximilian Ziermann. All rights reserved.
    Authorship fingerprint MZ-ff2381bf5d621e7b | See LICENSE and NOTICE. */
// What the admin page may change, and nothing else. sanitize() rebuilds a configuration document from what was sent:
// known items and fields only, with their types and lengths. Anything else in the request is dropped. The structure
// the code relies on (which thresholds, channels, categories, facts and rules exist, and the attributes of a rule's
// outcomes) comes from the seed and cannot be edited.
const Engine = require("../../engine.js");
const { SEED } = require("./seed");

const text = (v, max, dflt = "") => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max) : dflt);
const int = (v, min, max, dflt) => (Number.isInteger(v) && v >= min && v <= max ? v : dflt);
const MODES = ["enforce", "advise", "inform"];
const MAX = { rows: 30, conditions: 6, tests: 40, list: 20 };
const FACTS = Object.fromEntries(SEED.facts.map((f) => [f.key, f]));

// a condition value: a number, true/false, a short text, a list of short texts, or a reference to a threshold
function value(v) {
  if (v && typeof v === "object" && !Array.isArray(v)) return typeof v.param === "string" ? { param: text(v.param, 40) } : null;
  if (Array.isArray(v)) return v.slice(0, MAX.list).map((x) => (typeof x === "string" ? text(x, 60) : x)).filter((x) => ["string", "number", "boolean"].includes(typeof x));
  if (typeof v === "boolean" || (typeof v === "number" && isFinite(v))) return v;
  return typeof v === "string" ? text(v, 60) : null;
}
// in a test case a number can be a threshold, plus or minus something: { param, plus }
const givenValue = (v) => (v && typeof v === "object" && !Array.isArray(v) && typeof v.param === "string" ? { param: text(v.param, 40), ...(Number.isInteger(v.plus) && v.plus ? { plus: Math.max(-1e9, Math.min(1e9, v.plus)) } : {}) } : value(v));
const condition = (c) => (c && typeof c === "object" ? { fact: text(c.fact, 40), op: text(c.op, 20), ...(Engine.OPS[c.op] && !Engine.OPS[c.op].value ? {} : { value: value(c.value) }) } : null);

function rule(seedRule, r) {
  r = r && typeof r === "object" ? r : {};
  const labels = new Map((Array.isArray(r.outcomes) ? r.outcomes : []).map((o) => [o && o.key, o && o.label]));
  const rows = (Array.isArray(r.rows) ? r.rows : []).slice(0, MAX.rows).filter((x) => x && typeof x === "object").map((x) => {
    const row = { when: (Array.isArray(x.when) ? x.when : []).slice(0, MAX.conditions).map(condition).filter(Boolean), then: text(x.then, 40) };
    const t = text(x.text, 600);
    return t ? { ...row, text: t } : row;
  });
  const tests = (Array.isArray(r.tests) ? r.tests : []).slice(0, MAX.tests).filter((x) => x && typeof x === "object").map((t) => ({
    name: text(t.name, 120, "Test"),
    given: Object.fromEntries(Object.entries(t.given && typeof t.given === "object" && !Array.isArray(t.given) ? t.given : {}).filter(([k]) => FACTS[k]).map(([k, v]) => [k, givenValue(v)]).filter(([, v]) => v !== null && !Array.isArray(v))),
    expect: text(t.expect, 40),
  }));
  return {
    id: seedRule.id, name: text(r.name, 120, seedRule.name), step: seedRule.step, placeholders: [...(seedRule.placeholders || [])],
    mode: MODES.includes(r.mode) ? r.mode : seedRule.mode, clause: text(r.clause, 300), decides: text(r.decides, 400, seedRule.decides),
    outcomes: seedRule.outcomes.map((o) => ({ ...o, label: text(labels.get(o.key), 120, o.label) || o.label })),
    rows, tests,
  };
}

// -> a clean document, or null when the request is not a configuration at all
function sanitize(doc) {
  if (!doc || typeof doc !== "object" || !["params", "channels", "categories", "rules"].every((k) => Array.isArray(doc[k]))) return null;
  const by = (list, key) => new Map(list.filter((x) => x && typeof x === "object").map((x) => [x[key], x]));
  const params = by(doc.params, "key"), channels = by(doc.channels, "key"), categories = by(doc.categories, "id"), rules = by(doc.rules, "id");
  const questions = by(Array.isArray(doc.questions) ? doc.questions : [], "key"), guidance = by(Array.isArray(doc.guidance) ? doc.guidance : [], "key");
  const catIds = new Set(["_", ...SEED.categories.map((c) => c.id)]);
  return {
    params: SEED.params.map((p) => { const v = (params.get(p.key) || {}).value; return { ...p, value: typeof v === "number" && isFinite(v) && v >= 0 && v <= 1e12 ? v : p.value }; }),
    channels: SEED.channels.map((c) => {
      const x = channels.get(c.key) || {};
      const out = { ...c, name: text(x.name, 60, c.name) || c.name, days: text(x.days, 20, c.days) || c.days, lead_days: int(x.lead_days, 0, 365, c.lead_days) };
      if ("short_days" in c) Object.assign(out, { short_days: text(x.short_days, 20, c.short_days) || c.short_days, short_lead_days: int(x.short_lead_days, 0, 365, c.short_lead_days) });
      return out;
    }),
    categories: SEED.categories.map((c) => { const x = categories.get(c.id) || {}; return { id: c.id, name: text(x.name, 80, c.name) || c.name, cm_mandatory: x.cm_mandatory === true, renewals_calendar: x.renewals_calendar === true }; }),
    facts: structuredClone(SEED.facts),
    rules: SEED.rules.map((r) => rule(r, rules.get(r.id))),
    // a question's texts can be changed only where the code asks it the same way every time (the seed has them)
    questions: SEED.questions.map((q) => {
      const x = questions.get(q.key) || {}, out = { key: q.key, label: text(x.label, 80) || q.label };
      if ("q" in q) out.q = text(x.q, 400) || q.q;
      if ("ex" in q) out.ex = typeof x.ex === "string" ? text(x.ex, 400) : q.ex;
      if ("why" in q) out.why = typeof x.why === "string" ? text(x.why, 400) : q.why;
      return out;
    }),
    // guidance texts per category; "_" is the text for any other category
    guidance: SEED.guidance.map((g) => {
      const x = guidance.get(g.key) || {}, sent = x.texts && typeof x.texts === "object" && !Array.isArray(x.texts) ? x.texts : g.texts;
      const texts = {};
      for (const [k, v] of Object.entries(sent)) if (catIds.has(k)) { const t = text(v, 600); if (t) texts[k] = t; }
      if ("_" in g.texts && !texts._) texts._ = g.texts._;
      return { ...g, texts: Object.fromEntries(Object.keys(texts).sort((a, b) => (a === "_" ? -1 : b === "_" ? 1 : a.localeCompare(b))).map((k) => [k, texts[k]])) };
    }),
  };
}

module.exports = { sanitize, text };
